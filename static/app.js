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
    const btnPrimaryAction = document.getElementById('btnPrimaryAction') || document.getElementById('btnLiveCall');
    const primaryBtnIcon = document.getElementById('primaryBtnIcon');
    const primaryBtnLabel = document.getElementById('primaryBtnLabel');
    const btnLiveCall = btnPrimaryAction; // Backward compatibility alias

    const nodeSTT = document.getElementById('nodeSTT');
    const nodeLLM = document.getElementById('nodeLLM');
    const nodeTTS = document.getElementById('nodeTTS');
    const textLLM = document.getElementById('textLLM');
    const textTTS = document.getElementById('textTTS');
    const connectionStatus = document.getElementById('connectionStatus');
    const badgePipeline = document.getElementById('badgePipeline');

    const btnModeGroq = document.getElementById('btnModeGroq');
    const btnModeOpenAI = document.getElementById('btnModeOpenAI');
    const btnModeGemini = document.getElementById('btnModeGemini');
    const btnModeCloud = btnModeGroq; // Backward compatibility alias
    const btnModeLocal = null;

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

    const sectionGroqSettings = document.getElementById('sectionGroqSettings');
    const sectionOpenAISettings = document.getElementById('sectionOpenAISettings');
    const sectionGeminiSettings = document.getElementById('sectionGeminiSettings');

    const groqStatusBadge = document.getElementById('groqStatusBadge');
    const openaiStatusBadge = document.getElementById('openaiStatusBadge');
    const geminiStatusBadge = document.getElementById('geminiStatusBadge');

    const selectGroqModel = document.getElementById('selectGroqModel');
    const selectOpenAIModel = document.getElementById('selectOpenAIModel');
    const selectGeminiModel = document.getElementById('selectGeminiModel');

    const inputGroqKey = document.getElementById('inputGroqKey');
    const inputOpenAIKey = document.getElementById('inputOpenAIKey');
    const inputGeminiKey = document.getElementById('inputGeminiKey');

    const btnTestGroq = document.getElementById('btnTestGroq');
    const btnTestOpenAI = document.getElementById('btnTestOpenAI');
    const btnTestGemini = document.getElementById('btnTestGemini');
    const testGroqResult = document.getElementById('testGroqResult');
    const testOpenAIResult = document.getElementById('testOpenAIResult');
    const testGeminiResult = document.getElementById('testGeminiResult');

    const inputElevenKey = document.getElementById('inputElevenKey');
    const selectElevenVoice = document.getElementById('selectElevenVoice');
    const selectLocalVoice = document.getElementById('selectLocalVoice');
    const selectSilenceDuration = document.getElementById('selectSilenceDuration');
    const selectMemoryMode = document.getElementById('selectMemoryMode');

    // Toast
    const toastContainer = document.getElementById('toastContainer');

    // ----------------------------------------------------
    // State Architecture Constants & Single Source of Truth
    // ----------------------------------------------------
    const MODE_LIVE_CALL = 'live_call';
    const MODE_CLICK_TO_TALK = 'click_to_talk';

    const STATE_IDLE = 'idle';
    const STATE_LIVE_LISTENING = 'live_listening';
    const STATE_RECORDING = 'recording';
    const STATE_PROCESSING = 'processing';
    const STATE_SPEAKING = 'speaking';
    const STATE_STOPPING = 'stopping';
    const STATE_ERROR = 'error';

    // Centralized interaction state
    const sessionState = {
        mode: MODE_LIVE_CALL,     // 'live_call' | 'click_to_talk'
        status: STATE_IDLE,       // 'idle' | 'live_listening' | 'recording' | 'processing' | 'speaking' | 'stopping' | 'error'
        turnId: 0,
        abortController: null,
        errorMessage: ''
    };

    // Shared runtime dependencies
    let currentMode = 'local'; // 'local' | 'cloud' | 'openai'
    let currentAudio = null;
    let conversationHistory = [];
    const recorder = new AudioRecorder();

    // Legacy sync flags
    let isLiveCallActive = false;
    let isRecording = false;
    let isProcessing = false;
    let isSpeaking = false;

    // Optional safety timer for prolonged live-call silence
    let liveCallInactivityTimer = null;
    const INACTIVITY_TIMEOUT_MS = 60000; // 60s idle safety

    function startInactivityTimer() {
        clearInactivityTimer();
        if (sessionState.mode !== MODE_LIVE_CALL || sessionState.status === STATE_IDLE) return;
        liveCallInactivityTimer = setTimeout(() => {
            if (sessionState.mode === MODE_LIVE_CALL && sessionState.status === STATE_LIVE_LISTENING && !recorder.hasSpokenInTurn) {
                console.log('Prolonged silence detected. Safely ending live call.');
                endLiveCall();
                showToast('Live call ended due to inactivity', 'info');
            }
        }, INACTIVITY_TIMEOUT_MS);
    }

    function clearInactivityTimer() {
        if (liveCallInactivityTimer) {
            clearTimeout(liveCallInactivityTimer);
            liveCallInactivityTimer = null;
        }
    }

    // Canvas Visualizer Setup
    const canvasCtx = visualizerCanvas ? visualizerCanvas.getContext('2d') : null;
    let visualizerAnimationId = null;

    checkStatus();

    // Mode Toggle Controls (Groq vs OpenAI vs Gemini cloud pipeline engines)
    function setPipelineMode(mode) {
        if (mode === 'cloud' || mode === 'local') mode = 'groq';
        currentMode = mode;

        if (btnModeGroq) btnModeGroq.classList.toggle('active', mode === 'groq');
        if (btnModeOpenAI) btnModeOpenAI.classList.toggle('active', mode === 'openai');
        if (btnModeGemini) btnModeGemini.classList.toggle('active', mode === 'gemini');

        if (mode === 'openai') {
            if (badgePipeline) badgePipeline.innerText = 'OpenAI API';
            if (textLLM) textLLM.innerText = 'OpenAI (gpt-4o-mini)';
            if (textTTS) textTTS.innerText = 'Neural Voice';
            if (metricLLMSub) metricLLMSub.innerText = 'OpenAI';
            if (metricTTSSub) metricTTSSub.innerText = 'Selected TTS';
            if (connectionStatus) connectionStatus.innerHTML = '● <span style="color: var(--accent-blue);">Active (OpenAI)</span>';
        } else if (mode === 'gemini') {
            if (badgePipeline) badgePipeline.innerText = 'Google Gemini';
            if (textLLM) textLLM.innerText = 'Gemini 2.5 Flash';
            if (textTTS) textTTS.innerText = 'Neural Voice';
            if (metricLLMSub) metricLLMSub.innerText = 'Gemini';
            if (metricTTSSub) metricTTSSub.innerText = 'Selected TTS';
            if (connectionStatus) connectionStatus.innerHTML = '● <span style="color: #a855f7;">Active (Gemini)</span>';
        } else {
            // Groq default
            if (badgePipeline) badgePipeline.innerText = 'Groq Cloud';
            if (textLLM) textLLM.innerText = 'Groq (LPU)';
            if (textTTS) textTTS.innerText = 'ElevenLabs';
            if (metricLLMSub) metricLLMSub.innerText = 'Groq LPU';
            if (metricTTSSub) metricTTSSub.innerText = 'ElevenLabs';
            if (connectionStatus) connectionStatus.innerHTML = '● <span style="color: var(--accent-cyan);">Active (Groq)</span>';
        }

        if (selectPipelineMode) selectPipelineMode.value = mode;
        if (sectionGroqSettings) sectionGroqSettings.style.display = (mode === 'groq') ? 'block' : 'none';
        if (sectionOpenAISettings) sectionOpenAISettings.style.display = (mode === 'openai') ? 'block' : 'none';
        if (sectionGeminiSettings) sectionGeminiSettings.style.display = (mode === 'gemini') ? 'block' : 'none';
    }

    async function switchProvider(mode) {
        setPipelineMode(mode);
        try {
            const res = await fetch('/api/save-keys', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ llm_provider: mode })
            });
            if (res.ok) {
                showToast(`Switched active provider to ${mode.toUpperCase()}`, 'info');
                await checkStatus();
            }
        } catch (err) {
            console.warn('Failed to switch provider on backend:', err);
        }
    }

    if (btnModeGroq) btnModeGroq.addEventListener('click', () => switchProvider('groq'));
    if (btnModeOpenAI) btnModeOpenAI.addEventListener('click', () => switchProvider('openai'));
    if (btnModeGemini) btnModeGemini.addEventListener('click', () => switchProvider('gemini'));

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

    // Conversation Memory mode listener (Atomic / Single-turn vs Multi-turn)
    if (selectMemoryMode) {
        const savedMemory = localStorage.getItem('voice_memory_mode') || 'atomic';
        selectMemoryMode.value = savedMemory;
        selectMemoryMode.addEventListener('change', (e) => {
            const mode = e.target.value;
            localStorage.setItem('voice_memory_mode', mode);
            updateMessageCount();
            showToast(`Conversation memory: ${mode === 'atomic' ? 'Atomic (Single Turn)' : 'Multi-Turn'}`, 'info');
        });
    }

    // ----------------------------------------------------
    // SVG Icons Map for Primary Action Button
    // ----------------------------------------------------
    const ICONS = {
        call: `<svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/></svg>`,
        endCall: `<svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11H7v-2h10v2z"/></svg>`,
        mic: `<svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z"/></svg>`,
        stop: `<svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`,
        spinner: `<svg class="spin-icon" width="18" height="18" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" opacity="0.25"></circle><path fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path></svg>`,
        speaker: `<svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>`
    };

    // ----------------------------------------------------
    // Centralized UI Update Function
    // ----------------------------------------------------
    function updateUI() {
        const { mode, status, errorMessage } = sessionState;

        // 1. Mode Selector Tabs
        if (mode === MODE_LIVE_CALL) {
            if (modeLive) {
                modeLive.classList.add('active');
                modeLive.setAttribute('aria-selected', 'true');
            }
            if (modeClick) {
                modeClick.classList.remove('active');
                modeClick.setAttribute('aria-selected', 'false');
            }
        } else {
            if (modeClick) {
                modeClick.classList.add('active');
                modeClick.setAttribute('aria-selected', 'true');
            }
            if (modeLive) {
                modeLive.classList.remove('active');
                modeLive.setAttribute('aria-selected', 'false');
            }
        }

        // 2. Dynamic Primary Action Button
        let btnLabel = 'Start Live Call';
        let btnIcon = ICONS.call;
        let btnClass = 'primary-action-btn btn-state-start';
        let btnDisabled = false;

        if (mode === MODE_LIVE_CALL) {
            if (status === STATE_IDLE || status === STATE_ERROR) {
                btnLabel = 'Start Live Call';
                btnIcon = ICONS.call;
                btnClass = 'primary-action-btn btn-state-start';
                btnDisabled = false;
            } else if (status === STATE_STOPPING) {
                btnLabel = 'Ending Call...';
                btnIcon = ICONS.spinner;
                btnClass = 'primary-action-btn btn-state-danger';
                btnDisabled = true;
            } else {
                // Active Live Call (listening, recording, processing, speaking)
                btnLabel = 'End Live Call';
                btnIcon = ICONS.endCall;
                btnClass = 'primary-action-btn btn-state-danger';
                btnDisabled = false;
            }
        } else {
            // Click to Talk Mode
            if (status === STATE_IDLE || status === STATE_ERROR) {
                btnLabel = 'Start Talking';
                btnIcon = ICONS.mic;
                btnClass = 'primary-action-btn btn-state-start';
                btnDisabled = false;
            } else if (status === STATE_RECORDING) {
                btnLabel = 'Stop Recording';
                btnIcon = ICONS.stop;
                btnClass = 'primary-action-btn btn-state-recording';
                btnDisabled = false;
            } else if (status === STATE_PROCESSING) {
                btnLabel = 'Processing...';
                btnIcon = ICONS.spinner;
                btnClass = 'primary-action-btn btn-state-processing';
                btnDisabled = true;
            } else if (status === STATE_SPEAKING) {
                btnLabel = 'Playing Response...';
                btnIcon = ICONS.speaker;
                btnClass = 'primary-action-btn btn-state-speaking';
                btnDisabled = true;
            } else if (status === STATE_STOPPING) {
                btnLabel = 'Stopping...';
                btnIcon = ICONS.spinner;
                btnClass = 'primary-action-btn btn-state-processing';
                btnDisabled = true;
            }
        }

        if (btnPrimaryAction) {
            btnPrimaryAction.className = btnClass;
            btnPrimaryAction.disabled = btnDisabled;
            if (primaryBtnIcon) primaryBtnIcon.innerHTML = '';
            if (primaryBtnLabel) primaryBtnLabel.innerText = btnLabel;
            else btnPrimaryAction.innerText = btnLabel;
        }

        // 3. Central Microphone Orb (Mode-Aware Appearance & Interactivity)
        if (voiceOrb) {
            voiceOrb.className = 'voice-orb';

            if (status === STATE_RECORDING || status === STATE_LIVE_LISTENING) {
                voiceOrb.classList.add('recording');
            } else if (status === STATE_PROCESSING) {
                voiceOrb.classList.add('processing');
            } else if (status === STATE_SPEAKING) {
                voiceOrb.classList.add('speaking');
            }

            if (mode === MODE_CLICK_TO_TALK) {
                if (status === STATE_PROCESSING || status === STATE_SPEAKING || status === STATE_STOPPING) {
                    voiceOrb.classList.add('disabled', 'non-interactive');
                    voiceOrb.title = status === STATE_SPEAKING ? 'Playing response...' : 'Processing...';
                } else if (status === STATE_RECORDING) {
                    voiceOrb.title = 'Click to stop recording';
                } else {
                    voiceOrb.title = 'Click to start recording';
                }
            } else {
                // Live Call
                if (status === STATE_IDLE || status === STATE_ERROR) {
                    voiceOrb.title = 'Click to start Live Call';
                } else {
                    voiceOrb.title = 'In Call - Click to end';
                }
            }
        }

        // 4. Status Heading & Contextual Subtext
        if (statusHeading && statusSubtext) {
            switch (status) {
                case STATE_IDLE:
                    statusHeading.innerText = 'Ready to talk';
                    statusSubtext.innerText = mode === MODE_LIVE_CALL
                        ? 'Start a hands-free conversation. The assistant listens and responds automatically.'
                        : 'Press Start Talking or tap the microphone to record your message.';
                    break;

                case STATE_LIVE_LISTENING:
                    statusHeading.innerText = "I'm listening...";
                    statusSubtext.innerText = 'Speak naturally, pause when done (hands-free)';
                    break;

                case STATE_RECORDING:
                    statusHeading.innerText = "I'm listening...";
                    statusSubtext.innerText = mode === MODE_LIVE_CALL
                        ? 'Speak naturally, pause when done'
                        : 'Recording... Click Stop or tap orb when finished';
                    break;

                case STATE_PROCESSING:
                    statusHeading.innerText = 'Thinking...';
                    statusSubtext.innerText = 'Processing your speech and generating response';
                    break;

                case STATE_SPEAKING:
                    statusHeading.innerText = 'Speaking...';
                    statusSubtext.innerText = mode === MODE_LIVE_CALL
                        ? 'Listening will resume automatically'
                        : 'Playing audio response';
                    break;

                case STATE_STOPPING:
                    statusHeading.innerText = 'Ending session...';
                    statusSubtext.innerText = 'Wrapping up connection';
                    break;

                case STATE_ERROR:
                    statusHeading.innerText = 'Error';
                    statusSubtext.innerText = errorMessage || (mode === MODE_LIVE_CALL ? 'Click Start Live Call to retry' : 'Click Start Talking to retry');
                    break;
            }
        }

        // 5. Node Pipeline Visual Indicators
        if (nodeSTT) {
            nodeSTT.className = 'node' + (status === STATE_PROCESSING ? ' active' : '');
        }
        if (nodeLLM) {
            nodeLLM.className = 'node' + (status === STATE_PROCESSING ? ' active-llm' : '');
        }
        if (nodeTTS) {
            nodeTTS.className = 'node' + (status === STATE_SPEAKING ? ' active-tts' : '');
        }

        // Sync legacy booleans for any dependent references
        isLiveCallActive = (mode === MODE_LIVE_CALL && status !== STATE_IDLE && status !== STATE_ERROR);
        isRecording = (status === STATE_RECORDING || status === STATE_LIVE_LISTENING);
        isProcessing = (status === STATE_PROCESSING);
        isSpeaking = (status === STATE_SPEAKING);
    }

    function setSessionStatus(newStatus, errorMsg = '') {
        sessionState.status = newStatus;
        sessionState.errorMessage = errorMsg;
        updateUI();
    }

    // ----------------------------------------------------
    // Unified Session Teardown
    // ----------------------------------------------------
    async function cleanupActiveSession() {
        sessionState.turnId++;
        if (sessionState.abortController) {
            try { sessionState.abortController.abort(); } catch (e) {}
            sessionState.abortController = null;
        }

        clearInactivityTimer();
        stopVisualizer();

        if (currentAudio) {
            try {
                currentAudio.pause();
                currentAudio.currentTime = 0;
            } catch (e) {}
            currentAudio = null;
        }

        if (recorder && recorder.isRecording) {
            try {
                await recorder.stop();
            } catch (e) {}
        }
    }

    // ----------------------------------------------------
    // Mode Switching Logic
    // ----------------------------------------------------
    async function setSessionMode(newMode) {
        if (sessionState.mode === newMode) return;

        // Cleanly stop any active recording or playback
        await cleanupActiveSession();

        sessionState.mode = newMode;
        setSessionStatus(STATE_IDLE);

        showToast(newMode === MODE_LIVE_CALL ? 'Switched to Live Call mode' : 'Switched to Click to Talk mode', 'info');
    }

    // ----------------------------------------------------
    // Audio Recorder Callbacks
    // ----------------------------------------------------
    recorder.onVolumeChange = (vol) => {
        if (!recorder.isRecording || recorder.isMuted) return;
        if (vol > 0.08) {
            clearInactivityTimer();
        }
        const scale = 1 + vol * 0.3;
        if (voiceOrb) {
            voiceOrb.style.transform = `scale(${scale})`;
        }
    };

    recorder.onSpeechStart = () => {
        clearInactivityTimer();
        if (sessionState.mode === MODE_LIVE_CALL && sessionState.status === STATE_LIVE_LISTENING) {
            setSessionStatus(STATE_RECORDING);
        }
    };

    // Instant transcript path (< 50ms) for Live Call
    recorder.onSpeechTranscript = async (text) => {
        clearInactivityTimer();
        if (sessionState.mode === MODE_LIVE_CALL && !isProcessing && !isSpeaking && text) {
            recorder.setMuted(true);
            await processText(text);
        }
    };

    // Audio blob fallback path for Live Call
    recorder.onSilenceDetected = async (wavBlob) => {
        clearInactivityTimer();
        if (sessionState.mode === MODE_LIVE_CALL && !isProcessing && !isSpeaking && wavBlob) {
            recorder.setMuted(true);
            await processAudio(wavBlob);
        }
    };

    function startVisualizer() {
        if (!recorder.analyser || !canvasCtx) return;
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
                gradient.addColorStop(0, '#10b981');
                gradient.addColorStop(1, '#6ee7b7');

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
        if (canvasCtx && visualizerCanvas) {
            canvasCtx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
        }
        if (voiceOrb) {
            voiceOrb.style.transform = 'scale(1)';
        }
    }

    // ----------------------------------------------------
    // Shared Recording & Call Lifecycle Operations
    // ----------------------------------------------------

    // --- Live Call ---
    async function startLiveCall() {
        if (sessionState.mode !== MODE_LIVE_CALL) return;
        if (sessionState.status !== STATE_IDLE && sessionState.status !== STATE_ERROR) return;

        if (currentAudio) {
            try { currentAudio.pause(); } catch (e) {}
            currentAudio = null;
        }

        try {
            await recorder.start(true); // Start continuous Live VAD mode
            startVisualizer();
            setSessionStatus(STATE_LIVE_LISTENING);
            startInactivityTimer();
            showToast('Live call connected', 'success');
        } catch (err) {
            console.error('Live call microphone error:', err);
            showToast('Microphone error: ' + err.message, 'error');
            setSessionStatus(STATE_ERROR, err.message);
        }
    }

    async function endLiveCall() {
        if (sessionState.mode !== MODE_LIVE_CALL) return;
        if (sessionState.status === STATE_IDLE) return;

        setSessionStatus(STATE_STOPPING);
        await cleanupActiveSession();
        setSessionStatus(STATE_IDLE);
        showToast('Live call ended', 'info');
    }

    // --- Click to Talk (Unified Single Session) ---
    async function startClickToTalkRecording() {
        if (sessionState.mode !== MODE_CLICK_TO_TALK) return;
        if (sessionState.status !== STATE_IDLE && sessionState.status !== STATE_ERROR) return;

        if (currentAudio) {
            try { currentAudio.pause(); } catch (e) {}
            currentAudio = null;
        }

        try {
            await recorder.start(false); // Manual mode (non-VAD raw capture)
            setSessionStatus(STATE_RECORDING);
            startVisualizer();
        } catch (err) {
            console.error('Click to Talk mic error:', err);
            showToast('Microphone error: ' + err.message, 'error');
            setSessionStatus(STATE_ERROR, err.message);
        }
    }

    async function stopClickToTalkRecording() {
        if (sessionState.mode !== MODE_CLICK_TO_TALK) return;
        if (sessionState.status !== STATE_RECORDING) return;

        setSessionStatus(STATE_PROCESSING);
        stopVisualizer();

        try {
            const wavBlob = await recorder.stop();
            if (!wavBlob || wavBlob.size < 600) {
                showToast('Recording was too short. Speak and press stop when done.', 'info');
                setSessionStatus(STATE_IDLE);
                return;
            }
            await processAudio(wavBlob);
        } catch (err) {
            console.error('Recording stop error:', err);
            showToast('Recording failed: ' + err.message, 'error');
            setSessionStatus(STATE_ERROR, err.message);
        }
    }

    // ----------------------------------------------------
    // Unified Action Handlers (Button & Orb Call the Exact Same Functions)
    // ----------------------------------------------------
    async function handlePrimaryActionClick() {
        if (sessionState.mode === MODE_LIVE_CALL) {
            if (sessionState.status === STATE_IDLE || sessionState.status === STATE_ERROR) {
                await startLiveCall();
            } else {
                await endLiveCall();
            }
        } else {
            // Click to Talk
            if (sessionState.status === STATE_IDLE || sessionState.status === STATE_ERROR) {
                await startClickToTalkRecording();
            } else if (sessionState.status === STATE_RECORDING) {
                await stopClickToTalkRecording();
            }
            // During processing / speaking, clicks are ignored safely
        }
    }

    async function handleOrbClick() {
        if (sessionState.mode === MODE_LIVE_CALL) {
            if (sessionState.status === STATE_IDLE || sessionState.status === STATE_ERROR) {
                await startLiveCall();
            } else {
                await endLiveCall();
            }
        } else {
            // Click to Talk
            if (sessionState.status === STATE_IDLE || sessionState.status === STATE_ERROR) {
                await startClickToTalkRecording();
            } else if (sessionState.status === STATE_RECORDING) {
                await stopClickToTalkRecording();
            }
            // During processing / speaking, clicks are ignored safely
        }
    }

    // Backward-compatible setState wrapper for legacy callers
    function setState(state, message = '') {
        switch (state) {
            case 'IDLE':
                setSessionStatus(STATE_IDLE);
                break;
            case 'RECORDING':
                setSessionStatus(STATE_RECORDING);
                break;
            case 'STT':
            case 'LLM':
            case 'TTS':
                setSessionStatus(STATE_PROCESSING);
                break;
            case 'SPEAKING':
                setSessionStatus(STATE_SPEAKING);
                break;
            case 'ERROR':
                setSessionStatus(STATE_ERROR, message);
                break;
        }
    }

    // ----------------------------------------------------
    // API Audio & Text Pipeline Processing
    // ----------------------------------------------------
    async function processAudio(wavBlob) {
        const turnId = ++sessionState.turnId;
        sessionState.abortController = new AbortController();

        setSessionStatus(STATE_PROCESSING);
        if (nodeSTT) nodeSTT.classList.add('active');

        const customKeys = getCustomConfig();
        const memoryMode = localStorage.getItem('voice_memory_mode') || 'atomic';
        const historyToSend = (memoryMode === 'atomic') ? [] : conversationHistory;

        const formData = new FormData();
        formData.append('audio', wavBlob, 'recording.wav');
        formData.append('history', JSON.stringify(historyToSend));
        formData.append('keys', JSON.stringify(customKeys));

        try {
            const response = await fetch('/api/process-audio', {
                method: 'POST',
                body: formData,
                signal: sessionState.abortController.signal
            });

            const data = await response.json();

            // Guard against superseded turns or cancelled operations
            if (turnId !== sessionState.turnId) return;

            if (!response.ok || data.error) {
                const stage = data.stage ? `[${data.stage}] ` : '';
                showToast(`${stage}${data.message || 'Error processing audio'}`, 'error');
                setSessionStatus(STATE_ERROR, data.message);
                if (sessionState.mode === MODE_LIVE_CALL && recorder.isRecording) {
                    recorder.setMuted(false);
                    setTimeout(() => {
                        if (sessionState.mode === MODE_LIVE_CALL && sessionState.status === STATE_ERROR) {
                            setSessionStatus(STATE_LIVE_LISTENING);
                        }
                    }, 2000);
                }
                return;
            }

            handleSuccessResponse(data, true, turnId);

        } catch (err) {
            if (err.name === 'AbortError') return;
            if (turnId !== sessionState.turnId) return;

            showToast('Network / Server Error: ' + err.message, 'error');
            setSessionStatus(STATE_ERROR, err.message);
            if (sessionState.mode === MODE_LIVE_CALL && recorder.isRecording) {
                recorder.setMuted(false);
                setTimeout(() => {
                    if (sessionState.mode === MODE_LIVE_CALL && sessionState.status === STATE_ERROR) {
                        setSessionStatus(STATE_LIVE_LISTENING);
                    }
                }, 2000);
            }
        }
    }

    async function processText(text) {
        if (!text || !text.trim()) return;
        if (sessionState.status === STATE_PROCESSING || sessionState.status === STATE_SPEAKING) return;

        const turnId = ++sessionState.turnId;
        sessionState.abortController = new AbortController();

        setSessionStatus(STATE_PROCESSING);
        appendUserMessage(text.trim());

        const customKeys = getCustomConfig();
        const memoryMode = localStorage.getItem('voice_memory_mode') || 'atomic';
        const historyToSend = (memoryMode === 'atomic') ? [] : conversationHistory;

        try {
            const response = await fetch('/api/process-text', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: text.trim(),
                    conversation_history: historyToSend,
                    custom_keys: customKeys
                }),
                signal: sessionState.abortController.signal
            });

            const data = await response.json();
            if (turnId !== sessionState.turnId) return;

            if (!response.ok || data.error) {
                const stage = data.stage ? `[${data.stage}] ` : '';
                showToast(`${stage}${data.message || 'Error processing text'}`, 'error');
                setSessionStatus(STATE_ERROR, data.message);
                return;
            }

            handleSuccessResponse(data, false, turnId);

        } catch (err) {
            if (err.name === 'AbortError') return;
            if (turnId !== sessionState.turnId) return;

            showToast('Network / Server Error: ' + err.message, 'error');
            setSessionStatus(STATE_ERROR, err.message);
        }
    }

    function handleSuccessResponse(data, appendUser = true, turnId) {
        if (turnId && turnId !== sessionState.turnId) return;

        if (data.metrics) {
            if (metricSTT) metricSTT.innerText = `${data.metrics.stt_time_ms} ms`;
            if (metricLLM) metricLLM.innerText = `${data.metrics.llm_time_ms} ms`;
            if (metricTTS) metricTTS.innerText = `${data.metrics.tts_time_ms} ms`;
            if (metricTotal) metricTotal.innerText = `${data.metrics.total_time_ms} ms`;
        }

        if (appendUser && data.user_text) {
            appendUserMessage(data.user_text);
        }
        
        appendAssistantMessage(data.assistant_text, data.audio_url, data.metrics);

        conversationHistory.push({ role: 'user', content: data.user_text });
        conversationHistory.push({ role: 'assistant', content: data.assistant_text });
        updateMessageCount();

        if (data.audio_url) {
            playAudioResponse(data.audio_url, turnId);
        } else {
            if (sessionState.mode === MODE_LIVE_CALL) {
                recorder.setMuted(false);
                setSessionStatus(STATE_LIVE_LISTENING);
            } else {
                setSessionStatus(STATE_IDLE);
            }
        }
    }

    function playAudioResponse(audioUrl, turnId) {
        clearInactivityTimer();
        if (currentAudio) {
            try {
                currentAudio.pause();
                currentAudio.currentTime = 0;
            } catch (e) {}
            currentAudio = null;
        }

        currentAudio = new Audio(audioUrl);
        setSessionStatus(STATE_SPEAKING);

        // Mute mic while assistant speaks
        if (sessionState.mode === MODE_LIVE_CALL) {
            recorder.setMuted(true);
        }

        let isPlaybackFinished = false;
        const restoreAfterPlayback = () => {
            if (isPlaybackFinished) return;
            isPlaybackFinished = true;
            currentAudio = null;

            if (turnId && turnId !== sessionState.turnId) return;

            if (sessionState.mode === MODE_LIVE_CALL) {
                recorder.setMuted(false);
                startInactivityTimer();
                setSessionStatus(STATE_LIVE_LISTENING);
            } else {
                setSessionStatus(STATE_IDLE);
            }
        };

        // Instant pre-arm 100ms before audio completes for zero delay in live call
        currentAudio.ontimeupdate = () => {
            if (!currentAudio) return;
            if (currentAudio.duration && (currentAudio.duration - currentAudio.currentTime <= 0.12)) {
                restoreAfterPlayback();
            }
        };

        currentAudio.onended = () => {
            restoreAfterPlayback();
        };

        currentAudio.onerror = () => {
            restoreAfterPlayback();
            showToast('Error playing audio stream', 'error');
        };

        currentAudio.play().catch(e => {
            console.warn('Auto-play blocked or failed:', e);
            restoreAfterPlayback();
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
            ${latencyHtml ? `
                <div class="bubble-meta">
                    ${latencyHtml}
                </div>
            ` : ''}
        `;
        chatHistory.appendChild(bubble);
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    window.playSnippet = (url) => {
        playAudioResponse(url, ++sessionState.turnId);
    };

    function updateMessageCount() {
        const turns = Math.floor(conversationHistory.length / 2);
        if (messageCountEl) {
            const memoryMode = localStorage.getItem('voice_memory_mode') || 'atomic';
            const badge = memoryMode === 'atomic' ? ' (Atomic)' : '';
            messageCountEl.innerText = `${turns} turn${turns === 1 ? '' : 's'}${badge}`;
        }
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
        setSessionStatus(STATE_IDLE);
        showToast('Conversation cleared.', 'success');
    }

    // ----------------------------------------------------
    // User Interactions & Event Listeners
    // ----------------------------------------------------

    // Mode selectors
    if (modeLive) {
        modeLive.addEventListener('click', () => {
            setSessionMode(MODE_LIVE_CALL);
        });
    }

    if (modeClick) {
        modeClick.addEventListener('click', () => {
            setSessionMode(MODE_CLICK_TO_TALK);
        });
    }

    // Primary Action Button (State-Aware)
    if (btnPrimaryAction) {
        btnPrimaryAction.addEventListener('click', (e) => {
            e.preventDefault();
            handlePrimaryActionClick();
        });
    }

    // Central Microphone Orb (Mode-Aware)
    if (voiceOrb) {
        voiceOrb.addEventListener('click', (e) => {
            e.preventDefault();
            handleOrbClick();
        });

        // Keyboard accessibility for Orb
        voiceOrb.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleOrbClick();
            }
        });
    }

    // Spacebar shortcut
    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
            e.preventDefault();
            handlePrimaryActionClick();
        }
    });

    // Chat input bar
    if (chatForm) {
        chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const text = textInput ? textInput.value : '';
            if (text) {
                textInput.value = '';
                processText(text);
            }
        });
    }

    if (btnClearChat) {
        btnClearChat.addEventListener('click', clearChat);
    }

    // Initialize UI on load
    updateUI();

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

    // ----------------------------------------------------
    // Provider Connection Testing & Status Management
    // ----------------------------------------------------
    async function testProviderConnection(provider, btnEl, resultEl, badgeEl, modelSelectEl, keyInputEl) {
        if (!btnEl || !resultEl) return;
        const originalText = btnEl.innerText;
        btnEl.disabled = true;
        btnEl.innerText = 'Testing...';
        resultEl.style.display = 'block';
        resultEl.innerHTML = `<span style="color: var(--text-muted); font-size: 0.8rem;">Testing connection to ${provider}...</span>`;
        if (badgeEl) {
            badgeEl.className = 'status-badge badge-checking';
            badgeEl.innerText = 'Testing';
        }

        const modelVal = modelSelectEl ? modelSelectEl.value : undefined;
        const keyVal = keyInputEl && keyInputEl.value.trim() ? keyInputEl.value.trim() : undefined;
        try {
            const res = await fetch('/api/llm/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider, model: modelVal, api_key: keyVal })
            });
            const data = await res.json();
            const isConnected = data.connected === true || data.status === 'Connected' || data.status === 'success';
            if (isConnected) {
                resultEl.innerHTML = `<span style="color: var(--accent-emerald-dark); font-size: 0.8rem; font-weight: 600;">✓ ${escapeHtml(data.message || 'Connected successfully!')}</span>`;
                if (badgeEl) {
                    badgeEl.className = 'status-badge badge-connected';
                    badgeEl.innerText = 'Connected';
                }
                showToast(`${provider.toUpperCase()} connection verified!`, 'success');
            } else {
                const errText = data.error || data.message || 'Connection failed';
                resultEl.innerHTML = `<span style="color: var(--accent-rose); font-size: 0.8rem;">✗ ${escapeHtml(errText)}</span>`;
                if (badgeEl) {
                    badgeEl.className = 'status-badge badge-error';
                    const st = (data.status || '').toLowerCase();
                    if (st.includes('auth')) {
                        badgeEl.innerText = 'Auth Failed';
                    } else if (st.includes('model')) {
                        badgeEl.innerText = 'Model Unavailable';
                    } else if (st.includes('not configured')) {
                        badgeEl.className = 'status-badge badge-not-configured';
                        badgeEl.innerText = 'Not Configured';
                    } else {
                        badgeEl.innerText = data.status || 'Provider Unavailable';
                    }
                }
                showToast(`${provider.toUpperCase()} test failed: ${errText}`, 'error');
            }
        } catch (err) {
            resultEl.innerHTML = `<span style="color: var(--accent-rose); font-size: 0.8rem;">✗ Error: ${escapeHtml(err.message)}</span>`;
            if (badgeEl) {
                badgeEl.className = 'status-badge badge-error';
                badgeEl.innerText = 'Network Error';
            }
        } finally {
            btnEl.disabled = false;
            btnEl.innerText = originalText;
        }
    }

    if (btnTestGroq) {
        btnTestGroq.addEventListener('click', () => {
            testProviderConnection('groq', btnTestGroq, testGroqResult, groqStatusBadge, selectGroqModel, inputGroqKey);
        });
    }
    if (btnTestOpenAI) {
        btnTestOpenAI.addEventListener('click', () => {
            testProviderConnection('openai', btnTestOpenAI, testOpenAIResult, openaiStatusBadge, selectOpenAIModel, inputOpenAIKey);
        });
    }
    if (btnTestGemini) {
        btnTestGemini.addEventListener('click', () => {
            testProviderConnection('gemini', btnTestGemini, testGeminiResult, geminiStatusBadge, selectGeminiModel, inputGeminiKey);
        });
    }

    settingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const selectedProvider = selectPipelineMode ? selectPipelineMode.value : currentMode;
        const payload = {
            llm_provider: selectedProvider,
            pipeline_mode: selectedProvider,
            groq_model: selectGroqModel ? selectGroqModel.value : undefined,
            openai_model: selectOpenAIModel ? selectOpenAIModel.value : undefined,
            gemini_model: selectGeminiModel ? selectGeminiModel.value : undefined,
            groq_api_key: inputGroqKey && inputGroqKey.value.trim() ? inputGroqKey.value.trim() : undefined,
            openai_api_key: inputOpenAIKey && inputOpenAIKey.value.trim() ? inputOpenAIKey.value.trim() : undefined,
            gemini_api_key: inputGeminiKey && inputGeminiKey.value.trim() ? inputGeminiKey.value.trim() : undefined,
            elevenlabs_api_key: inputElevenKey && inputElevenKey.value.trim() ? inputElevenKey.value.trim() : undefined,
            elevenlabs_voice_id: selectElevenVoice ? selectElevenVoice.value : undefined,
            local_voice: selectLocalVoice ? selectLocalVoice.value : undefined
        };

        // Filter out undefined keys so backend preserves existing server credentials
        const cleanPayload = {};
        for (const [k, v] of Object.entries(payload)) {
            if (v !== undefined) cleanPayload[k] = v;
        }

        try {
            const res = await fetch('/api/save-keys', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cleanPayload)
            });

            if (res.ok) {
                showToast('Pipeline configuration saved!', 'success');
                closeModal();
                setPipelineMode(selectedProvider);
                if (inputGroqKey) inputGroqKey.value = '';
                if (inputOpenAIKey) inputOpenAIKey.value = '';
                if (inputGeminiKey) inputGeminiKey.value = '';
                if (inputElevenKey) inputElevenKey.value = '';
                await checkStatus();
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
            llm_provider: currentMode,
            memory_mode: localStorage.getItem('voice_memory_mode') || 'atomic',
            groq_model: selectGroqModel ? selectGroqModel.value : undefined,
            openai_model: selectOpenAIModel ? selectOpenAIModel.value : undefined,
            gemini_model: selectGeminiModel ? selectGeminiModel.value : undefined,
            local_voice: selectLocalVoice ? selectLocalVoice.value : 'en-US-JennyNeural'
        };
    }

    function populateSelectOptions(selectEl, models, currentModel) {
        if (!selectEl || !models || models.length === 0) return;
        const previousVal = currentModel || selectEl.value;
        const exists = models.includes(previousVal);
        let html = '';
        if (previousVal && !exists) {
            html += `<option value="${escapeHtml(previousVal)}" selected>${escapeHtml(previousVal)} (active)</option>`;
        }
        html += models.map(m => `<option value="${escapeHtml(m)}" ${m === previousVal ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('');
        selectEl.innerHTML = html;
    }

    function updateBadge(badgeEl, info) {
        if (!badgeEl) return;
        if (!info || !info.configured) {
            badgeEl.className = 'status-badge badge-not-configured';
            badgeEl.innerText = 'Not Configured';
        } else if (info.status === 'ready' || info.status === 'configured' || info.status === 'Connected' || info.connected === true) {
            badgeEl.className = 'status-badge badge-connected';
            badgeEl.innerText = 'Connected';
        } else if (info.status === 'model_unavailable' || info.status === 'Model Unavailable') {
            badgeEl.className = 'status-badge badge-error';
            badgeEl.innerText = 'Model Unavailable';
        } else if (info.status === 'auth_failed' || info.status === 'Authentication Failed') {
            badgeEl.className = 'status-badge badge-error';
            badgeEl.innerText = 'Auth Failed';
        } else {
            badgeEl.className = 'status-badge badge-connected';
            badgeEl.innerText = 'Configured';
        }
    }

    async function checkStatus() {
        try {
            const res = await fetch('/api/status');
            const data = await res.json();
            
            const activeProvider = data.llm_provider || data.mode || 'groq';
            setPipelineMode(activeProvider);

            // Update badges
            if (data.groq) updateBadge(groqStatusBadge, data.groq);
            if (data.openai) updateBadge(openaiStatusBadge, data.openai);
            if (data.gemini) updateBadge(geminiStatusBadge, data.gemini);

            // Populate models
            if (data.groq && data.groq.available_models) {
                populateSelectOptions(selectGroqModel, data.groq.available_models, data.groq.model);
            }
            if (data.openai && data.openai.available_models) {
                populateSelectOptions(selectOpenAIModel, data.openai.available_models, data.openai.model);
            }
            if (data.gemini && data.gemini.available_models) {
                populateSelectOptions(selectGeminiModel, data.gemini.available_models, data.gemini.model);
            }

            // Update placeholders for configured keys (never exposing raw secrets)
            if (inputGroqKey && data.groq && data.groq.configured) {
                inputGroqKey.placeholder = '•••••••••••••••• (Configured on server)';
            }
            if (inputOpenAIKey && data.openai && data.openai.configured) {
                inputOpenAIKey.placeholder = '•••••••••••••••• (Configured on server)';
            }
            if (inputGeminiKey && data.gemini && data.gemini.configured) {
                inputGeminiKey.placeholder = '•••••••••••••••• (Configured on server)';
            }
            if (inputElevenKey && data.elevenlabs && data.elevenlabs.configured) {
                inputElevenKey.placeholder = '•••••••••••••••• (Configured on server)';
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
