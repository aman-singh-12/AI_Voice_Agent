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
        this.onPartialTranscript = null; // Real-time progressive transcription callback
        this.onSilenceDetected = null;  // WAV fallback
        this.onBargeIn = null;          // Real-time speech interruption / barge-in callback

        // High-Speed Adaptive VAD & Barge-In Parameters (Calibrated to Initial Audio Input Level)
        this.baseThreshold = 0.015;
        this.noiseFloor = 0.008;
        this.silenceDurationMs = 1200; // Pause before triggering AI response
        this.bargeInThreshold = 0.015;  // Same as initial audio input level (baseThreshold = 0.015)
        this.minBargeInFrames = 5;      // Confirmation frames (~230ms) matching initial speech duration
        this.minSpeechDurationMs = 250; // Minimum speech duration to qualify as genuine utterance
        this.antiEchoSettleTimeMs = 120;// Settling window for hardware AEC filter
        this.hasSpokenInTurn = false;
        this.lastSpeechTime = 0;
        this.speechStartTime = null;
        this.isMuted = false;
        this.isAiSpeaking = false;
        this.isAiProcessing = false;
        this.bargeInEnabled = true;
        this.consecutiveBargeInFrames = 0;
        this.aiSpeakingStartTime = 0;
        this.finalTranscriptTimer = null;
        this.minNormalVoiceRms = 0.035;
        this.voiceBandMinHz = 200;
        this.voiceBandMaxHz = 3400;
        this.bargeInSensitivity = (typeof localStorage !== 'undefined' ? localStorage.getItem('voice_ai_bargein_sensitivity') : null) || 'normal';
        this.applyBargeInSensitivity(this.bargeInSensitivity);

        // Device-Isolated External Microphone Management
        this.selectedDeviceId = (typeof localStorage !== 'undefined' ? localStorage.getItem('voice_ai_selected_mic_id') : null) || '';
        this.selectedDeviceLabel = (typeof localStorage !== 'undefined' ? localStorage.getItem('voice_ai_selected_mic_label') : null) || '';
        this.isDeviceDisconnected = false;
        this.allowInternalMic = false;
        this.availableAudioDevices = [];
        this.onDeviceDisconnected = null;
        this.onDeviceConnected = null;
        this.onDevicesChanged = null;
        this._deviceChangeHandlerBound = false;
        this.setupDeviceChangeListener();

        // Native Web Speech Recognition for continuous transcription
        this.recognition = null;
        this.turnStartIndex = 0;
        this.latestResultIndex = 0;
        this.currentLiveTranscript = "";
        this.currentFinalTranscript = "";
        this.currentInterimTranscript = "";
        this.isRecognitionActive = false;
        this.hasNativeSpeechRecognition = ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);
        this.initSpeechRecognition();
    }

    /**
     * Enumerate available audio input devices using mediaDevices API
     */
    async getAudioInputDevices() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
            console.warn('[DEVICE] mediaDevices.enumerateDevices is not supported in this browser.');
            return [];
        }

        try {
            // First pass: retrieve enumerated devices
            let devices = await navigator.mediaDevices.enumerateDevices();
            let audioInputs = devices.filter(d => d.kind === 'audioinput');

            // If device labels are blank/empty (permission not yet granted), probe with temporary stream
            const hasLabels = audioInputs.some(d => d.label && d.label.trim().length > 0);
            if (!hasLabels && navigator.mediaDevices.getUserMedia) {
                try {
                    const probeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    probeStream.getTracks().forEach(t => t.stop());
                    devices = await navigator.mediaDevices.enumerateDevices();
                    audioInputs = devices.filter(d => d.kind === 'audioinput');
                } catch (probeErr) {
                    console.warn('[DEVICE] Permission probe for audio device labels was blocked or cancelled:', probeErr);
                }
            }

            const seen = new Set();
            const formatted = [];
            for (const dev of audioInputs) {
                if (!dev.deviceId || seen.has(dev.deviceId)) continue;
                seen.add(dev.deviceId);
                const label = dev.label || `Microphone (${dev.deviceId.substring(0, 8)}...)`;
                formatted.push({
                    deviceId: dev.deviceId,
                    label: label,
                    groupId: dev.groupId || ''
                });
            }

            this.availableAudioDevices = formatted;
            console.log(`[DEVICE] Available microphones enumerated (${formatted.length} devices found):`, formatted.map(d => d.label));
            return formatted;
        } catch (err) {
            console.error('[DEVICE] Failed to enumerate audio devices:', err);
            return [];
        }
    }

    /**
     * Explicitly select the external microphone and persist in localStorage
     */
    setSelectedDevice(deviceId, label = '') {
        this.selectedDeviceId = deviceId || '';
        this.selectedDeviceLabel = label || '';
        if (deviceId) {
            localStorage.setItem('voice_ai_selected_mic_id', deviceId);
            if (label) localStorage.setItem('voice_ai_selected_mic_label', label);
        } else {
            localStorage.removeItem('voice_ai_selected_mic_id');
            localStorage.removeItem('voice_ai_selected_mic_label');
        }
        this.isDeviceDisconnected = false;
        console.log(`[DEVICE] External microphone selected: "${this.selectedDeviceLabel}" (deviceId="${this.selectedDeviceId}")`);
    }

    /**
     * Check if an audio device label represents an internal/built-in microphone
     */
    isInternalMicrophone(label) {
        if (!label || typeof label !== 'string') return true;
        const l = label.toLowerCase().trim();
        // Clear indicators of internal / built-in laptop microphones
        const internalKeywords = [
            'internal', 'built-in', 'builtin', 'array', 'integrated', 
            'smart sound', 'intel', 'realtek', 'conexant', 'stereo mix',
            'system', 'pc mic', 'laptop'
        ];
        // External indicators that override generic manufacturer names
        const externalKeywords = [
            'usb', 'headset', 'headphone', 'bluetooth', 'wireless', 
            'external', 'fifine', 'blue yeti', 'yeti', 'rode', 'hyperx', 
            'elgato', 'shure', 'samson', 'jbl', 'airpods', 'galaxy buds'
        ];

        const hasExternal = externalKeywords.some(kw => l.includes(kw));
        if (hasExternal) return false;

        const hasInternal = internalKeywords.some(kw => l.includes(kw));
        if (hasInternal) return true;

        return false;
    }

    /**
     * Check if the explicitly selected external microphone is active, live, and unmuted
     */
    isExternalMicActive() {
        if (this.isDeviceDisconnected) return false;
        if (!this.mediaStream || !this.mediaStream.active) return false;
        const tracks = this.mediaStream.getAudioTracks();
        if (!tracks || tracks.length === 0) return false;
        const track = tracks[0];
        if (track.readyState !== 'live' || track.muted) return false;

        // Strict Requirement: Must have an explicitly selected external device
        if (!this.selectedDeviceId) return false;

        const label = track.label || this.selectedDeviceLabel || '';
        if (!this.allowInternalMic && this.isInternalMicrophone(label)) {
            return false;
        }

        const settings = track.getSettings ? track.getSettings() : {};
        if (settings.deviceId && settings.deviceId !== this.selectedDeviceId) {
            return false;
        }
        return true;
    }

    /**
     * Listen for media device additions/removals and handle disconnects
     */
    setupDeviceChangeListener() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.addEventListener) return;
        if (this._deviceChangeHandlerBound) return;
        this._deviceChangeHandlerBound = true;

        navigator.mediaDevices.addEventListener('devicechange', async () => {
            console.log('[DEVICE] Media device configuration change detected by system.');
            const devices = await this.getAudioInputDevices();
            if (this.onDevicesChanged) {
                this.onDevicesChanged(devices);
            }

            if (this.selectedDeviceId) {
                const stillExists = devices.some(d => d.deviceId === this.selectedDeviceId);
                if (!stillExists) {
                    console.warn(`[DEVICE] Selected external microphone "${this.selectedDeviceLabel}" (${this.selectedDeviceId}) is no longer present.`);
                    this.handleDeviceDisconnection('device_unplugged');
                } else if (this.isDeviceDisconnected) {
                    console.log(`[DEVICE] Selected external microphone "${this.selectedDeviceLabel}" re-detected.`);
                    this.isDeviceDisconnected = false;
                    if (this.onDeviceConnected) {
                        this.onDeviceConnected(this.selectedDeviceId, this.selectedDeviceLabel);
                    }
                }
            }
        });
    }

    /**
     * Fail-safe disconnection handler: Stops VAD, disarms barge-in, never falls back to internal mic
     */
    handleDeviceDisconnection(reason = 'track_ended') {
        if (this.isDeviceDisconnected) return;
        this.isDeviceDisconnected = true;
        console.warn(`[DEVICE] External microphone disconnected (reason=${reason})`);
        console.warn(`[DEVICE] Interruption detection disabled. Internal microphone will NOT be used as fallback.`);

        if (this.processor) {
            try { this.processor.disconnect(); } catch (e) {}
            this.processor = null;
        }
        if (this.source) {
            try { this.source.disconnect(); } catch (e) {}
            this.source = null;
        }
        if (this.mediaStream) {
            try {
                this.mediaStream.getTracks().forEach(t => t.stop());
            } catch (e) {}
            this.mediaStream = null;
        }
        this.isRecording = false;

        if (this.onDeviceDisconnected) {
            this.onDeviceDisconnected(this.selectedDeviceId, this.selectedDeviceLabel, reason);
        }
    }

    configureVAD(options = {}) {
        if (typeof options.baseThreshold === 'number') this.baseThreshold = options.baseThreshold;
        if (typeof options.bargeInThreshold === 'number') this.bargeInThreshold = options.bargeInThreshold;
        if (typeof options.minBargeInFrames === 'number') this.minBargeInFrames = options.minBargeInFrames;
        if (typeof options.silenceDurationMs === 'number') this.silenceDurationMs = options.silenceDurationMs;
        if (typeof options.minSpeechDurationMs === 'number') this.minSpeechDurationMs = options.minSpeechDurationMs;
        if (typeof options.antiEchoSettleTimeMs === 'number') this.antiEchoSettleTimeMs = options.antiEchoSettleTimeMs;
        console.log('[VAD] Configured parameters:', {
            baseThreshold: this.baseThreshold,
            bargeInThreshold: this.bargeInThreshold,
            minBargeInFrames: this.minBargeInFrames,
            silenceDurationMs: this.silenceDurationMs,
            minSpeechDurationMs: this.minSpeechDurationMs,
            antiEchoSettleTimeMs: this.antiEchoSettleTimeMs
        });
    }

    setSilenceDuration(ms) {
        this.silenceDurationMs = Math.max(600, Math.min(4000, ms));
        console.log(`[VAD] Silence threshold updated to: ${this.silenceDurationMs}ms`);
    }

    initSpeechRecognition() {
        const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRec) {
            this.hasNativeSpeechRecognition = false;
            this.recognition = null;
            return;
        }
        this.hasNativeSpeechRecognition = true;
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
                    const result = event.results[i];
                    if (!result || !result[0]) continue;
                    const piece = result[0].transcript || '';
                    if (result.isFinal) {
                        if (fullFinal && !fullFinal.endsWith(' ') && !piece.startsWith(' ')) {
                            fullFinal += ' ';
                        }
                        fullFinal += piece;
                        hasFinalChunk = true;
                    } else {
                        if (interim && !interim.endsWith(' ') && !piece.startsWith(' ')) {
                            interim += ' ';
                        }
                        interim += piece;
                    }
                }

                const cleanFinal = fullFinal.trim();
                const cleanInterim = interim.trim();
                let currentText = cleanFinal;
                if (cleanInterim) {
                    currentText = cleanFinal ? `${cleanFinal} ${cleanInterim}` : cleanInterim;
                }
                currentText = currentText.trim();

                // If barge-in prefix was recorded during interruption, ensure it is retained if WebSpeech splits results
                if (this.bargeInPrefix && currentText) {
                    const lowerCurrent = currentText.toLowerCase();
                    const lowerPrefix = this.bargeInPrefix.toLowerCase();
                    if (!lowerCurrent.includes(lowerPrefix)) {
                        currentText = `${this.bargeInPrefix} ${currentText}`.trim();
                    }
                }

                this.currentFinalTranscript = cleanFinal;
                this.currentInterimTranscript = cleanInterim;

                if (currentText) {
                    this.currentLiveTranscript = currentText;
                    this.lastSpeechTime = Date.now();

                    // If AI is currently speaking: pass to onPartialTranscript with isAiSpeaking flag for echo verification & barge-in
                    if (this.isAiSpeaking) {
                        if (this.onPartialTranscript) {
                            this.onPartialTranscript(currentText, {
                                final: cleanFinal,
                                interim: cleanInterim,
                                isFinalChunk: hasFinalChunk,
                                isAiSpeaking: true
                            });
                        }
                        return;
                    }

                    if (!this.hasSpokenInTurn) {
                        this.hasSpokenInTurn = true;
                        this.speechStartTime = Date.now();
                        if (this.onSpeechStart) this.onSpeechStart();
                    }

                    // Expose progressive partial transcript to UI
                    if (this.onPartialTranscript && !this.isMuted) {
                        this.onPartialTranscript(currentText, {
                            final: cleanFinal,
                            interim: cleanInterim,
                            isFinalChunk: hasFinalChunk,
                            isAiSpeaking: false
                        });
                    }

                    // If a final sentence was recognized, schedule a quick turn trigger
                    if (hasFinalChunk && this.isLiveCall) {
                        if (this.finalTranscriptTimer) clearTimeout(this.finalTranscriptTimer);
                        this.finalTranscriptTimer = setTimeout(() => {
                            if (this.hasSpokenInTurn && !this.isMuted && !this.isAiSpeaking) {
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
                if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
                    console.warn('[AudioRecorder] Native speech recognition not allowed or service blocked, falling back to VAD audio buffers.');
                    this.hasNativeSpeechRecognition = false;
                    this.recognition = null;
                } else if (e.error !== 'no-speech') {
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
        this.currentFinalTranscript = "";
        this.currentInterimTranscript = "";
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
        this.currentFinalTranscript = "";
        this.currentInterimTranscript = "";
        this.audioData = [];
        this.bargeInPrefix = '';
        this.bargeInAudioBuffer = [];

        if (transcriptToSend && this.onSpeechTranscript) {
            this.onSpeechTranscript(transcriptToSend);
        } else if (wavBlob && this.onSilenceDetected) {
            this.onSilenceDetected(wavBlob);
        }
    }

    async start(liveMode = false) {
        if (this.isRecording) {
            // Check if active device matches currently selected device
            const currentTrack = this.mediaStream ? this.mediaStream.getAudioTracks()[0] : null;
            const currentSettings = currentTrack && currentTrack.getSettings ? currentTrack.getSettings() : {};
            const currentDeviceId = currentSettings.deviceId || '';

            if (this.selectedDeviceId && currentDeviceId && currentDeviceId !== this.selectedDeviceId) {
                console.log(`[DEVICE] Switching active microphone from "${currentDeviceId}" to requested "${this.selectedDeviceId}".`);
                await this.stop();
            } else if (this.mediaStream && this.mediaStream.active && this.audioContext && this.audioContext.state !== 'closed' && !this.isDeviceDisconnected) {
                // Already recording on correct device - cleanly re-arm without requiring a page refresh
                this.isLiveCall = liveMode;
                this.unmuteAndResetTurn();
                if (this.audioContext.state === 'suspended') {
                    try { await this.audioContext.resume(); } catch (e) {}
                }
                return;
            } else {
                await this.stop();
            }
        }

        this.audioData = [];
        this.isLiveCall = liveMode;
        this.hasSpokenInTurn = false;
        this.lastSpeechTime = 0;
        this.speechStartTime = null;
        this.currentLiveTranscript = "";
        this.currentFinalTranscript = "";
        this.currentInterimTranscript = "";
        this.turnStartIndex = 0;
        this.latestResultIndex = 0;
        this.isMuted = false;
        this.noiseFloor = 0.008;

        // Build exact device-isolated microphone constraints
        const audioConstraints = {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
        };

        if (this.selectedDeviceId) {
            // Enforce exact device constraint: strictly acquire the selected external microphone
            audioConstraints.deviceId = { exact: this.selectedDeviceId };
            console.log(`[DEVICE] Requesting exact external microphone deviceId: "${this.selectedDeviceId}" ("${this.selectedDeviceLabel}")`);
        } else {
            console.warn('[DEVICE] No external microphone explicitly selected. Interruption detection will require explicit external mic.');
        }

        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
        } catch (err) {
            console.error(`[DEVICE] Failed to acquire requested external microphone (${this.selectedDeviceId}):`, err);
            this.isDeviceDisconnected = true;
            if (this.onDeviceDisconnected) {
                this.onDeviceDisconnected(this.selectedDeviceId, this.selectedDeviceLabel, err.message);
            }
            // CRITICAL FAIL-SAFE RULE: NEVER FALL BACK TO THE LAPTOP INTERNAL / DEFAULT MICROPHONE!
            throw new Error(`Failed to open selected external microphone "${this.selectedDeviceLabel || this.selectedDeviceId}". Fallback to internal microphone is strictly prohibited.`);
        }

        // Verify active track belongs to the requested device
        const audioTracks = this.mediaStream.getAudioTracks();
        if (!audioTracks || audioTracks.length === 0) {
            this.mediaStream = null;
            throw new Error('No active audio track found in acquired media stream.');
        }
        const activeTrack = audioTracks[0];
        const trackSettings = activeTrack.getSettings ? activeTrack.getSettings() : {};
        const acquiredDeviceId = trackSettings.deviceId || '';
        const trackLabel = activeTrack.label || '';

        console.log(`[DEVICE] Selected device ID validated: requested="${this.selectedDeviceId}", active="${acquiredDeviceId}", label="${trackLabel}"`);

        if (this.selectedDeviceId && acquiredDeviceId && acquiredDeviceId !== this.selectedDeviceId) {
            activeTrack.stop();
            this.mediaStream = null;
            throw new Error(`Device mismatch: requested "${this.selectedDeviceId}" but browser provided "${acquiredDeviceId}". Internal microphone excluded.`);
        }

        this.isDeviceDisconnected = false;
        if (!this.selectedDeviceId && acquiredDeviceId) {
            this.selectedDeviceId = acquiredDeviceId;
            this.selectedDeviceLabel = trackLabel;
            this.allowInternalMic = this.isInternalMicrophone(trackLabel);
            if (typeof localStorage !== 'undefined') {
                try {
                    localStorage.setItem('voice_ai_selected_mic_id', acquiredDeviceId);
                    localStorage.setItem('voice_ai_selected_mic_label', trackLabel);
                } catch (e) {}
            }
        }
        console.log(`[DEVICE] External microphone connected: "${trackLabel}"`);
        console.log(`[DEVICE] Internal microphone excluded from interruption pipeline`);
        console.log(`[AUDIO] External microphone stream initialized`);

        // Attach lifecycle handlers to active audio track
        activeTrack.onended = () => {
            console.warn(`[DEVICE] External microphone track ended / disconnected: "${this.selectedDeviceLabel || trackLabel}"`);
            this.handleDeviceDisconnection('track_ended');
        };
        activeTrack.onmute = () => {
            console.warn(`[DEVICE] External microphone track muted by system/hardware: "${this.selectedDeviceLabel || trackLabel}"`);
        };
        activeTrack.onunmute = () => {
            console.log(`[DEVICE] External microphone track unmuted: "${this.selectedDeviceLabel || trackLabel}"`);
        };

        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
            throw new Error('Web Audio API is not supported in this browser.');
        }
        this.audioContext = new AudioContextClass();
        if (this.audioContext.state === 'suspended') {
            try { await this.audioContext.resume(); } catch (e) {}
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

                // Dynamic Acoustic Isolation while AI is speaking or LLM is processing
                if (this.isAiSpeaking || this.isAiProcessing) {
                    // Strict Rule: Interruption can ONLY be triggered if the selected external microphone is active and verified!
                    if (!this.isExternalMicActive()) {
                        // Internal microphone or disconnected device has zero authority
                        this.consecutiveBargeInFrames = 0;
                        return;
                    }

                    const elapsedSpeaking = this.isAiSpeaking ? (now - (this.aiSpeakingStartTime || now)) : 999;
                    // Settling window allows browser hardware echo cancellation filter to calibrate when speaker starts playing
                    if (this.bargeInEnabled && elapsedSpeaking > this.antiEchoSettleTimeMs) {
                        // Spectral Voice-Band Verification (Human speech formant frequencies: 200 Hz - 3400 Hz)
                        const isVoiceFrequency = this.isVocalFrequencyPresent();

                        // Calibrated normal conversational speech threshold:
                        // Sounds below normal speech (< 0.035 RMS) or outside voice frequency band are neglected
                        const dynamicBargeInThreshold = Math.max(
                            this.bargeInThreshold || this.baseThreshold,
                            this.noiseFloor * 2.2,
                            this.minNormalVoiceRms || 0.035
                        );
                        if (rms > dynamicBargeInThreshold && isVoiceFrequency) {
                            this.consecutiveBargeInFrames++;
                            if (!this.bargeInAudioBuffer) this.bargeInAudioBuffer = [];
                            this.bargeInAudioBuffer.push(channelCopy);
                            console.log(`[VAD] Monitoring active microphone (rms=${rms.toFixed(4)}, threshold=${dynamicBargeInThreshold.toFixed(4)}, frames=${this.consecutiveBargeInFrames}/${this.minBargeInFrames}, voiceFreq=${isVoiceFrequency})`);
                            if (this.consecutiveBargeInFrames >= this.minBargeInFrames) {
                                // Sustained normal human voice detected in voice frequency band - trigger verified barge-in!
                                console.log(`[VAD] Normal voice speech detected in vocal frequency band (rms=${rms.toFixed(4)})`);
                                console.log(`[VAD] Speech confirmation completed`);
                                console.log(`[BARGE-IN] Normal speech interruption confirmed (rms=${rms.toFixed(4)})`);
                                this.isAiSpeaking = false;
                                this.isAiProcessing = false;
                                this.consecutiveBargeInFrames = 0;
                                this.hasSpokenInTurn = true;
                                this.speechStartTime = now;
                                this.lastSpeechTime = now;
                                // CRITICAL: Preserve all onset speech audio frames from the beginning of speech
                                this.audioData = (this.bargeInAudioBuffer && this.bargeInAudioBuffer.length > 0) ? [...this.bargeInAudioBuffer] : [channelCopy];
                                this.bargeInAudioBuffer = [];

                                if (this.onBargeIn) {
                                    this.onBargeIn('vad');
                                }
                            }
                        } else {
                            this.consecutiveBargeInFrames = 0;
                            this.bargeInAudioBuffer = [];
                            // Adaptively track ambient speaker floor during silence/low RMS in playback
                            this.noiseFloor = this.noiseFloor * 0.96 + rms * 0.04;
                        }
                    } else if (this.isAiSpeaking) {
                        // During anti-echo settling window, adapt noise floor to speaker output
                        this.noiseFloor = this.noiseFloor * 0.90 + rms * 0.10;
                    }
                    return;
                }

                // Normal VAD when AI is not speaking
                if (!this.hasSpokenInTurn) {
                    this.noiseFloor = this.noiseFloor * 0.96 + rms * 0.04;
                }
                const dynamicThreshold = Math.max(this.baseThreshold, this.noiseFloor * 2.2);

                if (rms > dynamicThreshold) {
                    if (!this.hasSpokenInTurn) {
                        this.hasSpokenInTurn = true;
                        this.speechStartTime = now;
                        this.audioData = [];
                        console.log('[VAD] Speech onset detected.');
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
                            if (speechDuration >= this.minSpeechDurationMs) {
                                console.log(`[VAD] End-of-utterance silence detected (${this.silenceDurationMs}ms pause). Triggering turn.`);
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
        console.log(`[VOICE] Continuous microphone capture active (Live Call mode=${liveMode})`);

        if (this.recognition && liveMode) {
            this.restartRecognitionSafe();
        }
    }

    /**
     * Handle mid-utterance barge-in: AI is interrupted while user is speaking.
     * CRITICAL: Preserves the user's ongoing speech, audio buffers, and transcript
     * so the complete sentence is recorded rather than just the last word!
     */
    handleBargeInActive(source = 'barge_in', initialText = '') {
        console.log(`[BARGE-IN] Active mid-utterance interruption transition (source=${source}): preserving ongoing speech buffer and transcript.`);
        this.isAiSpeaking = false;
        this.isAiProcessing = false;
        this.consecutiveBargeInFrames = 0;
        this.hasSpokenInTurn = true;
        this.lastSpeechTime = Date.now();
        if (!this.speechStartTime) {
            this.speechStartTime = Date.now();
        }

        // Store barge-in prefix so initial words are never lost if WebSpeech splits results
        if (initialText && initialText.trim()) {
            this.bargeInPrefix = initialText.trim();
            if (!this.currentLiveTranscript || !this.currentLiveTranscript.includes(this.bargeInPrefix)) {
                this.currentLiveTranscript = this.currentLiveTranscript ? `${this.bargeInPrefix} ${this.currentLiveTranscript}`.trim() : this.bargeInPrefix;
            }
        }

        if (this.finalTranscriptTimer) {
            clearTimeout(this.finalTranscriptTimer);
            this.finalTranscriptTimer = null;
        }
    }

    prepareForNextSpeech() {
        this.hasSpokenInTurn = false;
        this.lastSpeechTime = 0;
        this.speechStartTime = null;
        this.currentLiveTranscript = "";
        this.currentFinalTranscript = "";
        this.currentInterimTranscript = "";
        this.audioData = [];
        this.bargeInPrefix = '';
        this.bargeInAudioBuffer = [];
        this.turnStartIndex = this.latestResultIndex || 0;
        this.consecutiveBargeInFrames = 0;
        this.isMuted = false;
        if (this.finalTranscriptTimer) {
            clearTimeout(this.finalTranscriptTimer);
            this.finalTranscriptTimer = null;
        }
    }

    unmuteAndResetTurn() {
        this.isMuted = false;
        this.hasSpokenInTurn = false;
        this.lastSpeechTime = 0;
        this.speechStartTime = null;
        this.currentLiveTranscript = "";
        this.currentFinalTranscript = "";
        this.currentInterimTranscript = "";
        this.audioData = [];
        this.bargeInPrefix = '';
        this.bargeInAudioBuffer = [];
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
    
    isVocalFrequencyPresent() {
        if (!this.analyser || !this.analyser.frequencyBinCount) {
            return true;
        }
        const freqBins = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(freqBins);
        const sampleRate = (this.audioContext && this.audioContext.sampleRate) || 44100;
        const binWidth = sampleRate / (this.analyser.fftSize || (this.analyser.frequencyBinCount * 2) || 256);
        const minVoiceBin = Math.max(1, Math.floor((this.voiceBandMinHz || 200) / binWidth));
        const maxVoiceBin = Math.min(freqBins.length - 1, Math.ceil((this.voiceBandMaxHz || 3400) / binWidth));

        let sub200Energy = 0;
        for (let i = 0; i < minVoiceBin; i++) {
            sub200Energy += freqBins[i];
        }

        let voiceBandEnergy = 0;
        let totalEnergy = 0;
        for (let i = 0; i < freqBins.length; i++) {
            totalEnergy += freqBins[i];
            if (i >= minVoiceBin && i <= maxVoiceBin) {
                voiceBandEnergy += freqBins[i];
            }
        }

        if (totalEnergy === 0) {
            return true; // Mock test / silent fallback
        }

        const voiceBandRatio = voiceBandEnergy / totalEnergy;

        // Reject if low-frequency drone/rumble (<200Hz, e.g. AC/fan) heavily dominates
        const isSubRumble = (sub200Energy > voiceBandEnergy * 1.5);
        if (isSubRumble) {
            return false;
        }

        // Conversational human speech formants in 200Hz-3400Hz range:
        // Formant energy density must be present in voice band
        return (voiceBandRatio >= 0.20 && voiceBandEnergy >= 30);
    }

    checkBargeIn(rms, isVoiceFrequency = true) {
        const dynamicBargeInThreshold = Math.max(
            this.bargeInThreshold || this.baseThreshold,
            this.noiseFloor * 2.2,
            this.minNormalVoiceRms || 0.035
        );
        if (rms > dynamicBargeInThreshold && isVoiceFrequency) {
            this.consecutiveBargeInFrames++;
            if (this.consecutiveBargeInFrames >= this.minBargeInFrames) {
                this.consecutiveBargeInFrames = 0;
                if (this.onBargeInDetected) this.onBargeInDetected();
                if (this.onBargeIn) this.onBargeIn('vad');
                return true;
            }
        } else {
            this.consecutiveBargeInFrames = 0;
        }
        return false;
    }

    setMuted(muted) {
        this.isMuted = muted;
        this.hasSpokenInTurn = false;
        this.lastSpeechTime = 0;
        this.currentLiveTranscript = "";
        this.currentFinalTranscript = "";
        this.currentInterimTranscript = "";
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
            this.currentFinalTranscript = "";
            this.currentInterimTranscript = "";
            if (this.recognition && this.isLiveCall && this.isRecording) {
                this.restartRecognitionSafe();
            }
        }
    }

    setAiSpeaking(isSpeaking) {
        this.isAiSpeaking = !!isSpeaking;
        this.consecutiveBargeInFrames = 0;
        if (isSpeaking) {
            this.aiSpeakingStartTime = Date.now();
            // Advance turnStartIndex so prior recognition results from before AI spoke are never repeated
            this.turnStartIndex = this.latestResultIndex || 0;
            this.currentLiveTranscript = "";
            this.currentFinalTranscript = "";
            this.currentInterimTranscript = "";
            this.hasSpokenInTurn = false;
            this.lastSpeechTime = 0;
            this.audioData = [];
            if (this.finalTranscriptTimer) {
                clearTimeout(this.finalTranscriptTimer);
                this.finalTranscriptTimer = null;
            }
        } else {
            // When AI stops speaking: only clear buffers if the user is NOT already speaking an interruption
            if (!this.hasSpokenInTurn) {
                this.lastSpeechTime = 0;
                this.currentLiveTranscript = "";
                this.currentFinalTranscript = "";
                this.currentInterimTranscript = "";
                this.audioData = [];
            }
        }
    }

    setBargeInEnabled(enabled) {
        this.bargeInEnabled = !!enabled;
    }

    setAiProcessing(isProcessing) {
        this.isAiProcessing = !!isProcessing;
        this.consecutiveBargeInFrames = 0;
    }

    setBargeInSensitivity(level) {
        this.bargeInSensitivity = level;
        if (typeof localStorage !== 'undefined') {
            try {
                localStorage.setItem('voice_ai_bargein_sensitivity', level);
            } catch (e) {}
        }
        this.applyBargeInSensitivity(level);
    }

    applyBargeInSensitivity(level) {
        switch (level) {
            case 'sensitive':
                // Higher responsiveness, 3 frames confirmation (~140ms)
                this.bargeInThreshold = this.baseThreshold * 0.85; // ~0.01275
                this.minNormalVoiceRms = 0.025;
                this.minBargeInFrames = 3;
                break;
            case 'firm':
                // Strict confirmation, requires deliberate louder speech (~320ms)
                this.bargeInThreshold = this.baseThreshold * 1.5; // ~0.0225
                this.minNormalVoiceRms = 0.048;
                this.minBargeInFrames = 7;
                break;
            case 'normal':
            default:
                // Normal conversational speech level: filters small/below-normal surrounding sounds
                this.bargeInThreshold = this.baseThreshold; // 0.015 (exact match)
                this.minNormalVoiceRms = 0.035;
                this.minBargeInFrames = 5; // ~230ms (matches initial minSpeechDurationMs = 250ms)
                break;
        }
        console.log(`[BARGE-IN] Sensitivity calibrated to "${level}": threshold=${this.bargeInThreshold}, minVoiceRms=${this.minNormalVoiceRms}, minFrames=${this.minBargeInFrames}`);
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
        this.currentFinalTranscript = "";
        this.currentInterimTranscript = "";
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
