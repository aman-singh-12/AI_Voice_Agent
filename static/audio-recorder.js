/**
 * AudioRecorder - Ultra-Low Latency VAD & In-Browser Speech Recognition Engine
 * Provides sub-800ms turnaround for Live Voice Conversations.
 */
class AudioRecorder {
    constructor() {
        this.audioContext = null;
        this.mediaStream = null;
        this.processor = null;
        this.source = null;
        this.analyser = null;
        this.audioData = [];
        this.isRecording = false;
        this.isLiveCall = false;
        this.targetSampleRate = 16000;

        // Callbacks
        this.onVolumeChange = null;
        this.onSpeechStart = null;
        this.onSpeechTranscript = null; // High-speed instant transcribed text (0ms STT latency)
        this.onSilenceDetected = null;  // WAV fallback

        // High-Speed Adaptive VAD Parameters
        this.baseThreshold = 0.015;
        this.noiseFloor = 0.008;
        this.silenceDurationMs = 1200; // Default 1.2s pause before triggering AI response
        this.hasSpokenInTurn = false;
        this.lastSpeechTime = 0;
        this.speechStartTime = null;
        this.isMuted = false;
        this.finalTranscriptTimer = null;

        // Native Web Speech Recognition for continuous transcription
        this.recognition = null;
        this.turnStartIndex = 0;
        this.latestResultIndex = 0;
        this.currentLiveTranscript = "";
        this.isRecognitionActive = false;
        this.hasNativeSpeechRecognition = ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);
        this.initSpeechRecognition();
    }

    setSilenceDuration(ms) {
        this.silenceDurationMs = Math.max(600, Math.min(4000, ms));
        console.log(`VAD Silence threshold updated to: ${this.silenceDurationMs}ms`);
    }

    initSpeechRecognition() {
        if (!this.hasNativeSpeechRecognition) return;
        const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
        try {
            if (this.recognition) {
                try { this.recognition.abort(); } catch (e) {}
            }

            this.recognition = new SpeechRec();
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.lang = 'en-US';

            this.recognition.onstart = () => {
                this.isRecognitionActive = true;
            };

            this.recognition.onresult = (event) => {
                this.latestResultIndex = event.results.length;
                if (this.isMuted) {
                    this.turnStartIndex = event.results.length;
                    return;
                }
                let fullFinal = '';
                let interim = '';
                let hasFinalChunk = false;

                const startIndex = Math.max(0, this.turnStartIndex || 0);
                for (let i = startIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        fullFinal += event.results[i][0].transcript + ' ';
                        hasFinalChunk = true;
                    } else {
                        interim += event.results[i][0].transcript;
                    }
                }

                const currentText = (fullFinal + interim).trim();
                if (currentText) {
                    this.currentLiveTranscript = currentText;
                    this.lastSpeechTime = Date.now();
                    if (!this.hasSpokenInTurn) {
                        this.hasSpokenInTurn = true;
                        this.speechStartTime = Date.now();
                        if (this.onSpeechStart) this.onSpeechStart();
                    }

                    // If a final sentence was recognized, schedule a quick turn trigger
                    if (hasFinalChunk && this.isLiveCall) {
                        if (this.finalTranscriptTimer) clearTimeout(this.finalTranscriptTimer);
                        this.finalTranscriptTimer = setTimeout(() => {
                            if (this.hasSpokenInTurn && !this.isMuted) {
                                this.triggerTurn();
                            }
                        }, Math.min(800, this.silenceDurationMs));
                    }
                }
            };

            this.recognition.onspeechend = () => {
                if (this.hasSpokenInTurn && !this.isMuted && this.isLiveCall) {
                    if (this.finalTranscriptTimer) clearTimeout(this.finalTranscriptTimer);
                    this.finalTranscriptTimer = setTimeout(() => {
                        if (this.hasSpokenInTurn && !this.isMuted) {
                            this.triggerTurn();
                        }
                    }, 600);
                }
            };

            this.recognition.onend = () => {
                this.isRecognitionActive = false;
                if (this.isLiveCall && this.isRecording && !this.isMuted) {
                    this.restartRecognitionSafe();
                }
            };

            this.recognition.onerror = (e) => {
                this.isRecognitionActive = false;
                if (e.error !== 'no-speech') {
                    console.debug('Speech recognition status:', e.error);
                }
            };
        } catch (e) {
            this.recognition = null;
        }
    }

    restartRecognitionSafe() {
        if (!this.hasNativeSpeechRecognition || !this.recognition) return;
        this.turnStartIndex = 0;
        this.latestResultIndex = 0;
        this.currentLiveTranscript = "";
        if (this.isRecognitionActive) {
            try { this.recognition.abort(); } catch (e) {}
            this.isRecognitionActive = false;
        }
        setTimeout(() => {
            if (this.isLiveCall && this.isRecording && !this.isMuted) {
                try {
                    this.recognition.start();
                    this.isRecognitionActive = true;
                } catch (e) {
                    if (e.name !== 'InvalidStateError') {
                        console.debug('Recognition restart status:', e.message);
                    }
                }
            }
        }, 60);
    }

    triggerTurn() {
        if (!this.hasSpokenInTurn || this.isMuted) return;
        if (this.finalTranscriptTimer) {
            clearTimeout(this.finalTranscriptTimer);
            this.finalTranscriptTimer = null;
        }

        const transcriptToSend = (this.currentLiveTranscript || "").trim();
        const wavBlob = this.exportCurrentBuffer();

        // Advance turnStartIndex immediately to the end of recognized results
        // to prevent previous speech from ever leaking into subsequent turns
        if (this.latestResultIndex !== undefined) {
            this.turnStartIndex = this.latestResultIndex;
        }

        this.hasSpokenInTurn = false;
        this.lastSpeechTime = 0;
        this.currentLiveTranscript = "";
        this.audioData = [];

        if (transcriptToSend && this.onSpeechTranscript) {
            this.onSpeechTranscript(transcriptToSend);
        } else if (wavBlob && this.onSilenceDetected) {
            this.onSilenceDetected(wavBlob);
        }
    }

    async start(liveMode = false) {
        if (this.isRecording) {
            // Already recording - cleanly re-arm without requiring a page refresh
            if (this.mediaStream && this.mediaStream.active && this.audioContext && this.audioContext.state !== 'closed') {
                this.isLiveCall = liveMode;
                this.unmuteAndResetTurn();
                if (this.audioContext.state === 'suspended') {
                    try { await this.audioContext.resume(); } catch (e) {}
                }
                return;
            }
            await this.stop();
        }

        this.audioData = [];
        this.isLiveCall = liveMode;
        this.hasSpokenInTurn = false;
        this.lastSpeechTime = 0;
        this.speechStartTime = null;
        this.currentLiveTranscript = "";
        this.turnStartIndex = 0;
        this.latestResultIndex = 0;
        this.isMuted = false;
        this.noiseFloor = 0.008;

        // Request microphone access
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: 44100,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });

        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        this.audioContext = new AudioContextClass();
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
        this.source = this.audioContext.createMediaStreamSource(this.mediaStream);

        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        this.source.connect(this.analyser);

        const bufferSize = 2048;
        this.processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

        this.processor.onaudioprocess = (e) => {
            if (!this.isRecording) return;

            const inputData = e.inputBuffer.getChannelData(0);
            const channelCopy = new Float32Array(inputData);

            let sum = 0;
            for (let i = 0; i < inputData.length; i++) {
                sum += inputData[i] * inputData[i];
            }
            const rms = Math.sqrt(sum / inputData.length);
            const volume = Math.min(1, rms * 5);

            if (this.onVolumeChange && !this.isMuted) {
                this.onVolumeChange(volume);
            }

            if (this.isLiveCall && !this.isMuted) {
                const now = Date.now();

                // Dynamically calibrate ambient noise floor
                if (!this.hasSpokenInTurn) {
                    this.noiseFloor = this.noiseFloor * 0.96 + rms * 0.04;
                }
                const dynamicThreshold = Math.max(this.baseThreshold, this.noiseFloor * 2.2);

                if (rms > dynamicThreshold) {
                    if (!this.hasSpokenInTurn) {
                        this.hasSpokenInTurn = true;
                        this.speechStartTime = now;
                        this.audioData = [];
                        if (this.onSpeechStart) this.onSpeechStart();
                    }
                    this.lastSpeechTime = now;
                    this.audioData.push(channelCopy);
                } else {
                    if (this.hasSpokenInTurn) {
                        this.audioData.push(channelCopy);

                        // Check if silence period elapsed
                        if (this.lastSpeechTime > 0 && (now - this.lastSpeechTime >= this.silenceDurationMs)) {
                            const speechDuration = now - (this.speechStartTime || now);
                            if (speechDuration >= 250) {
                                this.triggerTurn();
                            } else {
                                this.hasSpokenInTurn = false;
                                this.lastSpeechTime = 0;
                                this.audioData = [];
                            }
                        }
                    }
                }
            } else if (!this.isLiveCall) {
                this.audioData.push(channelCopy);
            }
        };

        this.source.connect(this.processor);
        this.processor.connect(this.audioContext.destination);
        this.isRecording = true;

        if (this.recognition && liveMode) {
            this.restartRecognitionSafe();
        }
    }

    unmuteAndResetTurn() {
        this.isMuted = false;
        this.hasSpokenInTurn = false;
        this.lastSpeechTime = 0;
        this.speechStartTime = null;
        this.currentLiveTranscript = "";
        this.audioData = [];
        this.turnStartIndex = 0;
        this.latestResultIndex = 0;
        this.noiseFloor = 0.008;
        if (this.finalTranscriptTimer) {
            clearTimeout(this.finalTranscriptTimer);
            this.finalTranscriptTimer = null;
        }
        if (this.audioContext && this.audioContext.state === 'suspended') {
            try { this.audioContext.resume(); } catch (e) {}
        }
        if (this.recognition && this.isLiveCall && this.isRecording) {
            this.restartRecognitionSafe();
        }
    }

    setMuted(muted) {
        this.isMuted = muted;
        this.hasSpokenInTurn = false;
        this.lastSpeechTime = 0;
        this.currentLiveTranscript = "";
        this.audioData = [];
        if (this.finalTranscriptTimer) {
            clearTimeout(this.finalTranscriptTimer);
            this.finalTranscriptTimer = null;
        }

        if (muted) {
            // Abort speech recognition while muted to completely flush browser recognition buffer
            if (this.recognition) {
                try {
                    this.recognition.abort();
                } catch (e) {}
                this.isRecognitionActive = false;
            }
            this.turnStartIndex = 0;
            this.latestResultIndex = 0;
        } else {
            // Unmuted: restart a clean, fresh recognition instance for the new turn
            this.noiseFloor = 0.008;
            this.turnStartIndex = 0;
            this.latestResultIndex = 0;
            this.currentLiveTranscript = "";
            if (this.recognition && this.isLiveCall && this.isRecording) {
                this.restartRecognitionSafe();
            }
        }
    }

    exportCurrentBuffer() {
        if (this.audioData.length === 0) return null;

        let totalLength = 0;
        for (let i = 0; i < this.audioData.length; i++) {
            totalLength += this.audioData[i].length;
        }

        const mergedBuffer = new Float32Array(totalLength);
        let offset = 0;
        for (let i = 0; i < this.audioData.length; i++) {
            mergedBuffer.set(this.audioData[i], offset);
            offset += this.audioData[i].length;
        }

        const sampleRate = this.audioContext ? this.audioContext.sampleRate : 44100;
        const resampled = this.downsampleBuffer(mergedBuffer, sampleRate, this.targetSampleRate);
        return this.encodeWAV(resampled, this.targetSampleRate);
    }

    async stop() {
        if (!this.isRecording) return null;
        this.isRecording = false;
        this.isLiveCall = false;

        const wavBlob = this.exportCurrentBuffer();

        if (this.recognition) {
            try { this.recognition.abort(); } catch (e) {}
        }
        this.turnStartIndex = 0;
        this.latestResultIndex = 0;
        this.currentLiveTranscript = "";
        if (this.processor) {
            this.processor.disconnect();
            this.processor = null;
        }
        if (this.source) {
            this.source.disconnect();
            this.source = null;
        }
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }
        if (this.audioContext && this.audioContext.state !== 'closed') {
            await this.audioContext.close();
            this.audioContext = null;
        }

        this.audioData = [];
        this.currentLiveTranscript = "";
        return wavBlob;
    }

    downsampleBuffer(buffer, sampleRate, outSampleRate) {
        if (outSampleRate === sampleRate || outSampleRate > sampleRate) {
            return buffer;
        }
        const sampleRateRatio = sampleRate / outSampleRate;
        const newLength = Math.round(buffer.length / sampleRateRatio);
        const result = new Float32Array(newLength);
        let offsetResult = 0;
        let offsetBuffer = 0;
        while (offsetResult < result.length) {
            const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
            let accum = 0, count = 0;
            for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
                accum += buffer[i];
                count++;
            }
            result[offsetResult] = count > 0 ? accum / count : 0;
            offsetResult++;
            offsetBuffer = nextOffsetBuffer;
        }
        return result;
    }

    encodeWAV(samples, sampleRate) {
        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(buffer);

        this.writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + samples.length * 2, true);
        this.writeString(view, 8, 'WAVE');
        this.writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        this.writeString(view, 36, 'data');
        view.setUint32(40, samples.length * 2, true);

        let offset = 44;
        for (let i = 0; i < samples.length; i++, offset += 2) {
            let s = Math.max(-1, Math.min(1, samples[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }

        return new Blob([view], { type: 'audio/wav' });
    }

    writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }
}

window.AudioRecorder = AudioRecorder;
