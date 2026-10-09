/**
 * Voice AI Pipeline Application Logic (Port 8001 - Live Call Hands-Free VAD)
 */

document.addEventListener('DOMContentLoaded', () => {
    // Pipeline DOM Elements
    const voiceOrb = document.getElementById('voiceOrb');
    const visualizerCanvas = document.getElementById('visualizerCanvas');
    const statusHeading = document.getElementById('statusHeading');
    const statusSubtext = document.getElementById('statusSubtext');
    
    const modeLive = document.getElementById('modeLive');
    const modeClick = document.getElementById('modeClick');
    const modeHold = document.getElementById('modeHold');
    const btnLiveCall = document.getElementById('btnLiveCall');

    const nodeSTT = document.getElementById('nodeSTT');
    const nodeLLM = document.getElementById('nodeLLM');
    const nodeTTS = document.getElementById('nodeTTS');
    const textLLM = document.getElementById('textLLM');
    const textTTS = document.getElementById('textTTS');
    const connectionStatus = document.getElementById('connectionStatus');
    const badgePipeline = document.getElementById('badgePipeline');

    const btnModeLocal = document.getElementById('btnModeLocal');
    const btnModeCloud = document.getElementById('btnModeCloud');

    const chatHistory = document.getElementById('chatHistory');
    const emptyState = document.getElementById('emptyState');
    const chatForm = document.getElementById('chatForm');
    const textInput = document.getElementById('textInput');
    const messageCountEl = document.getElementById('messageCount');
    const btnClearChat = document.getElementById('btnClearChat');

    // Metrics
    const metricSTT = document.getElementById('metricSTT');
    const metricLLM = document.getElementById('metricLLM');
    const metricTTS = document.getElementById('metricTTS');
    const metricTotal = document.getElementById('metricTotal');
    const metricLLMSub = document.getElementById('metricLLMSub');
    const metricTTSSub = document.getElementById('metricTTSSub');

    // Settings Modal
    const btnSettings = document.getElementById('btnSettings');
    const settingsModal = document.getElementById('settingsModal');
    const btnCloseModal = document.getElementById('btnCloseModal');
    const btnCancelModal = document.getElementById('btnCancelModal');
    const settingsForm = document.getElementById('settingsForm');
    const selectPipelineMode = document.getElementById('selectPipelineMode');
    const localSettingsSection = document.getElementById('localSettingsSection');
    const cloudSettingsSection = document.getElementById('cloudSettingsSection');

    const selectOllamaModel = document.getElementById('selectOllamaModel');
    const selectLocalVoice = document.getElementById('selectLocalVoice');
    const inputGroqKey = document.getElementById('inputGroqKey');
    const inputElevenKey = document.getElementById('inputElevenKey');
    const selectElevenVoice = document.getElementById('selectElevenVoice');
    const selectSilenceDuration = document.getElementById('selectSilenceDuration');

    // Toast
    const toastContainer = document.getElementById('toastContainer');

    // App State
    let currentMode = 'local'; // 'local' | 'cloud'
    let interactionMode = 'live'; // 'live' | 'click' | 'hold'
    let isLiveCallActive = false;
    let isRecording = false;
    let isProcessing = false;
    let isSpeaking = false;
    let currentAudio = null;
    let conversationHistory = [];
    const recorder = new AudioRecorder();

    // Canvas Visualizer Setup
    const canvasCtx = visualizerCanvas.getContext('2d');
    let visualizerAnimationId = null;

    checkStatus();

    // Mode Toggle Controls (Local vs Cloud)
    function setPipelineMode(mode) {
        currentMode = mode;
        if (mode === 'local') {
            btnModeLocal.classList.add('active');
            btnModeCloud.classList.remove('active');
            badgePipeline.innerText = 'Local Ollama (Qwen 2.5)';
            textLLM.innerText = 'Local Ollama (Qwen 2.5)';
            textTTS.innerText = 'Local Neural Voice';
            metricLLMSub.innerText = 'Local Ollama';
            metricTTSSub.innerText = 'Local TTS';
            connectionStatus.innerHTML = '● <span style="color: var(--accent-emerald);">Port 8001 Local Active (0 Keys Required)</span>';
            if (selectPipelineMode) selectPipelineMode.value = 'local';
            if (localSettingsSection) localSettingsSection.style.display = 'block';
            if (cloudSettingsSection) cloudSettingsSection.style.display = 'none';
        } else {
            btnModeCloud.classList.add('active');
            btnModeLocal.classList.remove('active');
            badgePipeline.innerText = 'Cloud (Groq + 11Labs)';
            textLLM.innerText = 'Groq (LPU Inference)';
            textTTS.innerText = 'ElevenLabs REST API';
            metricLLMSub.innerText = 'Groq LPU';
            metricTTSSub.innerText = 'ElevenLabs';
            connectionStatus.innerHTML = '☁️ <span style="color: var(--accent-cyan);">Cloud Mode Active (Port 8001)</span>';
            if (selectPipelineMode) selectPipelineMode.value = 'cloud';
            if (localSettingsSection) localSettingsSection.style.display = 'none';
            if (cloudSettingsSection) cloudSettingsSection.style.display = 'block';
        }
    }

    btnModeLocal.addEventListener('click', () => setPipelineMode('local'));
    btnModeCloud.addEventListener('click', () => setPipelineMode('cloud'));

    if (selectPipelineMode) {
        selectPipelineMode.addEventListener('change', (e) => {
            setPipelineMode(e.target.value);
        });
    }

    // Silence duration listener
    if (selectSilenceDuration) {
        const savedSilence = localStorage.getItem('voice_silence_ms');
        if (savedSilence) {
            selectSilenceDuration.value = savedSilence;
            recorder.setSilenceDuration(parseInt(savedSilence));
        } else {
            recorder.setSilenceDuration(parseInt(selectSilenceDuration.value || '1600'));
        }

        selectSilenceDuration.addEventListener('change', (e) => {
            const ms = parseInt(e.target.value);
            recorder.setSilenceDuration(ms);
            localStorage.setItem('voice_silence_ms', ms);
            showToast(`Pause delay set to ${(ms/1000).toFixed(1)}s`, 'info');
        });
    }

    // ----------------------------------------------------
    // Recorder VAD & Visualizer Callbacks
    // ----------------------------------------------------
    recorder.onVolumeChange = (vol) => {
        if (!recorder.isRecording || recorder.isMuted) return;
        const scale = 1 + vol * 0.3;
        voiceOrb.style.transform = `scale(${scale})`;
    };

    recorder.onSpeechStart = () => {
        if (isLiveCallActive && !isProcessing && !isSpeaking) {
            voiceOrb.className = 'voice-orb recording';
            statusHeading.innerText = '🎙️ Listening to your question...';
            statusSubtext.innerText = 'Take your time. You can pause or use filler words while thinking.';
        }
    };

    // Instant zero-delay transcript path (< 50ms)
    recorder.onSpeechTranscript = async (text) => {
        if (isLiveCallActive && !isProcessing && !isSpeaking && text) {
            recorder.setMuted(true);
            await processText(text);
        }
    };

    // Audio blob fallback path
    recorder.onSilenceDetected = async (wavBlob) => {
        if (isLiveCallActive && !isProcessing && !isSpeaking && wavBlob) {
            recorder.setMuted(true);
            await processAudio(wavBlob);
        }
    };

    function startVisualizer() {
        if (!recorder.analyser) return;
        const bufferLength = recorder.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        function draw() {
            visualizerAnimationId = requestAnimationFrame(draw);
            recorder.analyser.getByteFrequencyData(dataArray);

            canvasCtx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);

            const barWidth = (visualizerCanvas.width / bufferLength) * 2.5;
            let barHeight;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                barHeight = (dataArray[i] / 255) * visualizerCanvas.height;

                const gradient = canvasCtx.createLinearGradient(0, visualizerCanvas.height, 0, 0);
                gradient.addColorStop(0, '#06b6d4');
                gradient.addColorStop(1, '#8b5cf6');

                canvasCtx.fillStyle = gradient;
                canvasCtx.fillRect(x, visualizerCanvas.height - barHeight, barWidth, barHeight);

                x += barWidth + 1;
            }
        }
        draw();
    }

    function stopVisualizer() {
        if (visualizerAnimationId) {
            cancelAnimationFrame(visualizerAnimationId);
            visualizerAnimationId = null;
        }
        canvasCtx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
        voiceOrb.style.transform = 'scale(1)';
    }

    // ----------------------------------------------------
    // State UI Updates
    // ----------------------------------------------------
    function setState(state, message = '') {
        voiceOrb.className = 'voice-orb';
        nodeSTT.className = 'node';
        nodeLLM.className = 'node';
        nodeTTS.className = 'node';

        switch (state) {
            case 'IDLE':
                isRecording = false;
                isProcessing = false;
                isSpeaking = false;
                if (isLiveCallActive) {
                    voiceOrb.classList.add('speaking');
                    const silenceSec = ((recorder.silenceDurationMs || 1600) / 1000).toFixed(1);
                    statusHeading.innerText = '🟢 In Call (Listening...)';
                    statusSubtext.innerText = `Speak anytime. AI answers after a full ${silenceSec}s pause.`;
                    recorder.setMuted(false);
                } else {
                    statusHeading.innerText = 'Hands-Free Live Call Ready';
                    statusSubtext.innerText = 'Click "Start Live Call" or click the orb to talk';
                    stopVisualizer();
                }
                break;

            case 'RECORDING':
                isRecording = true;
                voiceOrb.classList.add('recording');
                statusHeading.innerText = 'Listening...';
                statusSubtext.innerText = interactionMode === 'hold' ? 'Release when done' : 'Click again when finished';
                startVisualizer();
                break;

            case 'STT':
                isProcessing = true;
                voiceOrb.classList.add('processing');
                nodeSTT.classList.add('active');
                statusHeading.innerText = '1/3 Transcribing Speech...';
                statusSubtext.innerText = 'SpeechRecognition converting audio to text';
                break;

            case 'LLM':
                isProcessing = true;
                voiceOrb.classList.add('processing');
                nodeLLM.classList.add('active-llm');
                statusHeading.innerText = currentMode === 'local' ? '2/3 Generating (Local Qwen)...' : '2/3 Generating (Groq)...';
                statusSubtext.innerText = currentMode === 'local' ? 'Local Ollama Qwen 2.5 reasoning response' : 'Groq LPU reasoning response';
                break;

            case 'TTS':
                isProcessing = true;
                voiceOrb.classList.add('processing');
                nodeTTS.classList.add('active-tts');
                statusHeading.innerText = '3/3 Synthesizing Voice...';
                statusSubtext.innerText = currentMode === 'local' ? 'Local Neural Voice synthesis' : 'ElevenLabs streaming audio';
                break;

            case 'SPEAKING':
                isSpeaking = true;
                voiceOrb.classList.add('speaking');
                statusHeading.innerText = '🔊 Assistant is speaking...';
                statusSubtext.innerText = isLiveCallActive ? 'Microphone will auto-resume listening when done' : 'Playing response';
                break;

            case 'ERROR':
                isRecording = false;
                isProcessing = false;
                isSpeaking = false;
                statusHeading.innerText = 'Error Encountered';
                statusSubtext.innerText = message || 'Click orb to try again';
                if (isLiveCallActive) {
                    setTimeout(() => setState('IDLE'), 2000);
                }
                break;
        }
    }

    // ----------------------------------------------------
    // Live Call Mode Control
    // ----------------------------------------------------
    async function startLiveCall() {
        if (isLiveCallActive) return;
        try {
            await recorder.start(true); // Start in Live VAD mode
            isLiveCallActive = true;
            btnLiveCall.style.background = 'linear-gradient(135deg, #ef4444, #b91c1c)';
            btnLiveCall.style.boxShadow = '0 0 25px rgba(239, 68, 68, 0.5)';
            btnLiveCall.innerHTML = `
                <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11H7v-2h10v2z"/></svg>
                <span>End Live Call</span>
            `;
            startVisualizer();
            setState('IDLE');
            showToast('Live Call Started! Just speak naturally.', 'success');
        } catch (err) {
            showToast('Microphone error: ' + err.message, 'error');
            isLiveCallActive = false;
        }
    }

    async function endLiveCall() {
        if (!isLiveCallActive) return;
        isLiveCallActive = false;
        await recorder.stop();
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }
        btnLiveCall.style.background = 'linear-gradient(135deg, #10b981, #059669)';
        btnLiveCall.style.boxShadow = '0 0 25px rgba(16, 185, 129, 0.4)';
        btnLiveCall.innerHTML = `
            <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/></svg>
            <span>Start Live Call (Hands-Free)</span>
        `;
        setState('IDLE');
        showToast('Live Call Ended.', 'info');
    }

    btnLiveCall.addEventListener('click', () => {
        if (isLiveCallActive) {
            endLiveCall();
        } else {
            startLiveCall();
        }
    });

    // ----------------------------------------------------
    // Manual Recording Flow (Click / Hold)
    // ----------------------------------------------------
    async function startManualRecording() {
        if (isProcessing) return;
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }
        try {
            await recorder.start(false);
            setState('RECORDING');
        } catch (err) {
            showToast('Microphone error: ' + err.message, 'error');
            setState('IDLE');
        }
    }

    async function stopManualRecording() {
        if (!recorder.isRecording) return;
        const liveText = (recorder.currentLiveTranscript || '').trim();
        setState('STT');
        try {
            const wavBlob = await recorder.stop();
            if (liveText) {
                // 0ms instant STT path!
                await processText(liveText);
            } else if (wavBlob && wavBlob.size >= 500) {
                // Whisper Turbo / backend STT fallback
                await processAudio(wavBlob);
            } else {
                showToast('No speech detected.', 'info');
                setState('IDLE');
            }
        } catch (err) {
            showToast('Recording failed: ' + err.message, 'error');
            setState('ERROR', err.message);
        }
    }

    // ----------------------------------------------------
    // API Audio & Text Processing
    // ----------------------------------------------------
    async function processAudio(wavBlob) {
        isProcessing = true;
        setState('STT');

        const formData = new FormData();
        formData.append('audio', wavBlob, 'recording.wav');
        formData.append('history', JSON.stringify(conversationHistory));

        const customKeys = getCustomConfig();
        formData.append('keys', JSON.stringify(customKeys));

        try {
            const response = await fetch('/api/process-audio', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();

            if (!response.ok || data.error) {
                const stage = data.stage ? `[${data.stage}] ` : '';
                showToast(`${stage}${data.message || 'Error processing audio'}`, 'error');
                setState('ERROR', data.message);
                isProcessing = false;
                if (isLiveCallActive) recorder.setMuted(false);
                return;
            }

            handleSuccessResponse(data);

        } catch (err) {
            showToast('Network / Server Error: ' + err.message, 'error');
            setState('ERROR', err.message);
            isProcessing = false;
            if (isLiveCallActive) recorder.setMuted(false);
        }
    }

    async function processText(text) {
        if (!text || !text.trim() || isProcessing) return;

        isProcessing = true;
        setState('LLM');
        appendUserMessage(text.trim());

        const customKeys = getCustomConfig();

        try {
            const response = await fetch('/api/process-text', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: text.trim(),
                    conversation_history: conversationHistory,
                    custom_keys: customKeys
                })
            });

            const data = await response.json();

            if (!response.ok || data.error) {
                const stage = data.stage ? `[${data.stage}] ` : '';
                showToast(`${stage}${data.message || 'Error processing text'}`, 'error');
                setState('ERROR', data.message);
                isProcessing = false;
                return;
            }

            handleSuccessResponse(data, false);

        } catch (err) {
            showToast('Network / Server Error: ' + err.message, 'error');
            setState('ERROR', err.message);
            isProcessing = false;
        }
    }

    function handleSuccessResponse(data, appendUser = true) {
        isProcessing = false;

        if (data.metrics) {
            metricSTT.innerText = `${data.metrics.stt_time_ms} ms`;
            metricLLM.innerText = `${data.metrics.llm_time_ms} ms`;
            metricTTS.innerText = `${data.metrics.tts_time_ms} ms`;
            metricTotal.innerText = `${data.metrics.total_time_ms} ms`;
        }

        if (appendUser && data.user_text) {
            appendUserMessage(data.user_text);
        }
        
        appendAssistantMessage(data.assistant_text, data.audio_url, data.metrics);

        conversationHistory.push({ role: 'user', content: data.user_text });
        conversationHistory.push({ role: 'assistant', content: data.assistant_text });
        updateMessageCount();

        if (data.audio_url) {
            playAudioResponse(data.audio_url);
        } else {
            setState('IDLE');
        }
    }

    function playAudioResponse(audioUrl) {
        if (currentAudio) {
            currentAudio.pause();
        }

        currentAudio = new Audio(audioUrl);
        setState('SPEAKING');

        // Mute mic while speaking
        if (isLiveCallActive) {
            recorder.setMuted(true);
        }

        currentAudio.onended = () => {
            currentAudio = null;
            // Unmute mic and automatically return to listening!
            if (isLiveCallActive) {
                recorder.setMuted(false);
            }
            setState('IDLE');
        };

        currentAudio.onerror = () => {
            currentAudio = null;
            if (isLiveCallActive) {
                recorder.setMuted(false);
            }
            setState('IDLE');
            showToast('Error playing audio stream', 'error');
        };

        currentAudio.play().catch(e => {
            console.warn('Auto-play blocked or failed:', e);
            if (isLiveCallActive) {
                recorder.setMuted(false);
            }
            setState('IDLE');
        });
    }

    // ----------------------------------------------------
    // Transcript Rendering
    // ----------------------------------------------------
    function appendUserMessage(text) {
        if (emptyState) emptyState.style.display = 'none';

        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble user';
        bubble.innerHTML = `
            <div>${escapeHtml(text)}</div>
            <div class="bubble-meta">
                <span>You</span>
                <span>${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
        `;
        chatHistory.appendChild(bubble);
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    function appendAssistantMessage(text, audioUrl, metrics) {
        if (emptyState) emptyState.style.display = 'none';

        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble assistant';

        let latencyHtml = '';
        if (metrics) {
            latencyHtml = `
                <div class="latency-tags">
                    ${metrics.stt_time_ms > 0 ? `<span class="tag stt">STT: ${metrics.stt_time_ms}ms</span>` : ''}
                    <span class="tag llm">LLM: ${metrics.llm_time_ms}ms</span>
                    <span class="tag tts">TTS: ${metrics.tts_time_ms}ms</span>
                    <span class="tag total">${metrics.total_time_ms}ms</span>
                </div>
            `;
        }

        bubble.innerHTML = `
            <div>${escapeHtml(text)}</div>
            <div class="bubble-meta">
                ${latencyHtml}
                ${audioUrl ? `
                    <button class="replay-btn" onclick="window.playSnippet('${audioUrl}')">
                        <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                        Replay
                    </button>
                ` : ''}
            </div>
        `;
        chatHistory.appendChild(bubble);
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    window.playSnippet = (url) => {
        playAudioResponse(url);
    };

    function updateMessageCount() {
        const turns = Math.floor(conversationHistory.length / 2);
        messageCountEl.innerText = `${turns} turn${turns === 1 ? '' : 's'}`;
    }

    function clearChat() {
        conversationHistory = [];
        chatHistory.innerHTML = '';
        if (emptyState) {
            chatHistory.appendChild(emptyState);
            emptyState.style.display = 'flex';
        }
        updateMessageCount();
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }
        setState('IDLE');
        showToast('Conversation cleared.', 'success');
    }

    // ----------------------------------------------------
    // User Interactions & Modes
    // ----------------------------------------------------
    modeLive.addEventListener('click', () => {
        interactionMode = 'live';
        modeLive.classList.add('active');
        modeClick.classList.remove('active');
        modeHold.classList.remove('active');
        startLiveCall();
    });

    modeClick.addEventListener('click', () => {
        if (isLiveCallActive) endLiveCall();
        interactionMode = 'click';
        modeClick.classList.add('active');
        modeLive.classList.remove('active');
        modeHold.classList.remove('active');
        setState('IDLE');
    });

    modeHold.addEventListener('click', () => {
        if (isLiveCallActive) endLiveCall();
        interactionMode = 'hold';
        modeHold.classList.add('active');
        modeLive.classList.remove('active');
        modeClick.classList.remove('active');
        setState('IDLE');
    });

    voiceOrb.addEventListener('click', () => {
        if (interactionMode === 'live') {
            if (isLiveCallActive) endLiveCall();
            else startLiveCall();
        } else if (interactionMode === 'click') {
            if (recorder.isRecording) stopManualRecording();
            else startManualRecording();
        }
    });

    voiceOrb.addEventListener('mousedown', () => {
        if (interactionMode === 'hold') startManualRecording();
    });

    window.addEventListener('mouseup', () => {
        if (interactionMode === 'hold' && recorder.isRecording) stopManualRecording();
    });

    // Spacebar shortcut
    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
            e.preventDefault();
            if (interactionMode === 'live') {
                if (isLiveCallActive) endLiveCall();
                else startLiveCall();
            } else if (interactionMode === 'hold') {
                if (!recorder.isRecording) startManualRecording();
            } else {
                if (recorder.isRecording) stopManualRecording();
                else startManualRecording();
            }
        }
    });

    window.addEventListener('keyup', (e) => {
        if (e.code === 'Space' && interactionMode === 'hold' && recorder.isRecording && document.activeElement.tagName !== 'INPUT') {
            e.preventDefault();
            stopManualRecording();
        }
    });

    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = textInput.value;
        if (text) {
            textInput.value = '';
            processText(text);
        }
    });

    btnClearChat.addEventListener('click', clearChat);

    // ----------------------------------------------------
    // Settings Modal
    // ----------------------------------------------------
    btnSettings.addEventListener('click', () => {
        settingsModal.classList.add('open');
    });

    function closeModal() {
        settingsModal.classList.remove('open');
    }

    btnCloseModal.addEventListener('click', closeModal);
    btnCancelModal.addEventListener('click', closeModal);

    settingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const payload = {
            pipeline_mode: selectPipelineMode.value,
            ollama_model: selectOllamaModel.value,
            local_voice: selectLocalVoice.value,
            groq_api_key: inputGroqKey.value.trim(),
            elevenlabs_api_key: inputElevenKey.value.trim(),
            elevenlabs_voice_id: selectElevenVoice.value
        };

        try {
            const res = await fetch('/api/save-keys', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                showToast('Pipeline configuration saved!', 'success');
                closeModal();
                setPipelineMode(payload.pipeline_mode);
                checkStatus();
            } else {
                showToast('Failed to save settings.', 'error');
            }
        } catch (err) {
            showToast('Error saving settings: ' + err.message, 'error');
        }
    });

    function getCustomConfig() {
        return {
            pipeline_mode: currentMode,
            ollama_model: selectOllamaModel.value || 'qwen2.5:1.5b',
            local_voice: selectLocalVoice.value || 'en-US-JennyNeural',
            groq_api_key: inputGroqKey.value.trim() || undefined,
            elevenlabs_api_key: inputElevenKey.value.trim() || undefined,
            elevenlabs_voice_id: selectElevenVoice.value || undefined
        };
    }

    async function checkStatus() {
        try {
            const res = await fetch('/api/status');
            const data = await res.json();
            
            if (data.mode) {
                setPipelineMode(data.mode);
            }

            if (data.local.installed_models && data.local.installed_models.length > 0) {
                selectOllamaModel.innerHTML = data.local.installed_models
                    .map(m => `<option value="${m}">${m}</option>`)
                    .join('');
            }
        } catch (e) {
            console.warn('Could not fetch status:', e);
        }
    }

    // ----------------------------------------------------
    // Toast Helper
    // ----------------------------------------------------
    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerText = message;
        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.innerText = text;
        return div.innerHTML;
    }
});
