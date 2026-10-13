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

    // Collapsible Conversation Drop-Down Elements
    const mainContainer = document.getElementById('mainContainer');
    const transcriptPanel = document.getElementById('transcriptPanel');
    const panelHeader = document.getElementById('panelHeader');
    const btnToggleTranscript = document.getElementById('btnToggleTranscript');
    const transcriptBody = document.getElementById('transcriptBody');

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
    const selectBargeIn = document.getElementById('selectBargeIn');

    // External Microphone Isolation & Device Selection DOM Elements
    const selectMicDevice = document.getElementById('selectMicDevice');
    const btnRefreshMics = document.getElementById('btnRefreshMics');
    const micStatusBadge = document.getElementById('micStatusBadge');
    const selectedDeviceNameText = document.getElementById('selectedDeviceNameText');
    const bargeInStatusBadge = document.getElementById('bargeInStatusBadge');
    const headerMicPill = document.getElementById('headerMicPill');
    const headerMicDot = document.getElementById('headerMicDot');
    const headerMicLabel = document.getElementById('headerMicLabel');

    // Toast
    const toastContainer = document.getElementById('toastContainer');

    // ----------------------------------------------------
    // State Architecture Constants & Single Source of Truth
    // ----------------------------------------------------
    const MODE_LIVE_CALL = 'live_call';
    const MODE_CLICK_TO_TALK = 'click_to_talk';

    // ----------------------------------------------------
    // Formal State Machine Definitions (Section 11)
    // ----------------------------------------------------
    const STATE_IDLE = 'idle';
    const STATE_LISTENING = 'listening';
    const STATE_USER_SPEAKING = 'user_speaking';
    const STATE_PROCESSING = 'processing';
    const STATE_AI_SPEAKING = 'ai_speaking';
    const STATE_INTERRUPTING = 'interrupting';
    const STATE_STOPPING = 'stopping';
    const STATE_ERROR = 'error';
    const STATE_EXTERNAL_MIC_DISCONNECTED = 'external_mic_disconnected';

    // Backward compatibility aliases for DOM styling and legacy bindings
    const STATE_LIVE_LISTENING = STATE_LISTENING;
    const STATE_RECORDING = STATE_USER_SPEAKING;
    const STATE_SPEAKING = STATE_AI_SPEAKING;

    // Unique Request ID Generator for Full-Duplex Session Tracking
    function generateRequestId() {
        return 'req_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    }

    // Centralized interaction state
    const sessionState = {
        mode: MODE_LIVE_CALL,     // 'live_call' | 'click_to_talk'
        status: STATE_IDLE,       // 'idle' | 'listening' | 'user_speaking' | 'processing' | 'ai_speaking' | 'interrupting' | 'stopping' | 'error'
        turnId: 0,
        abortController: null,
        errorMessage: ''
    };

    // Shared runtime dependencies
    let currentMode = 'local'; // 'local' | 'cloud' | 'openai'
    let currentAudio = null;
    let conversationHistory = [];
    const recorder = new AudioRecorder();

    // WebSocket Client & Streaming Audio Queue State
    let voiceWs = null;
    let wsConnected = false;
    let wsConnecting = false;
    let wsReconnectTimer = null;

    // Active Turn Streaming State
    let activeTurnId = '';
    let activeTurnUserText = '';
    let activeUserBubble = null;
    let activeAssistantBubble = null;
    let activeAssistantText = '';
    let audioQueue = [];
    let isPlayingQueue = false;
    let isTurnResponseComplete = false;
    let audioPlaybackGeneration = 0;
    const interruptedTurnIds = new Set();

    // Legacy sync flags
    let isLiveCallActive = false;
    let isRecording = false;
    let isProcessing = false;
    let isSpeaking = false;

    // Inactivity timer: Automatically turns off live call after 5 seconds of silence in listening session
    let liveCallInactivityTimer = null;
    const INACTIVITY_TIMEOUT_MS = 5000; // 5s silence timeout

    function startInactivityTimer(timeoutMs = INACTIVITY_TIMEOUT_MS) {
        clearInactivityTimer();
        if (sessionState.mode !== MODE_LIVE_CALL || sessionState.status === STATE_IDLE) return;
        liveCallInactivityTimer = setTimeout(() => {
            if (sessionState.mode === MODE_LIVE_CALL && (sessionState.status === STATE_LIVE_LISTENING || sessionState.status === STATE_RECORDING) && !recorder.hasSpokenInTurn) {
                console.log('5s silence detected in listening session. Safely ending live call.');
                endLiveCall();
                showToast('Live call ended after 5s silence', 'info');
            }
        }, timeoutMs);
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

    function openSettingsModalForProvider(provider) {
        setPipelineMode(provider);
        if (settingsModal) {
            settingsModal.classList.add('open');
            setTimeout(() => {
                if (provider === 'groq' && inputGroqKey) inputGroqKey.focus();
                else if (provider === 'openai' && inputOpenAIKey) inputOpenAIKey.focus();
                else if (provider === 'gemini' && inputGeminiKey) inputGeminiKey.focus();
            }, 100);
        }
    }

    function handleAuthOrKeyError(msg) {
        const lower = (msg || '').toLowerCase();
        if (lower.includes('api key') || lower.includes('auth') || lower.includes('not configured') || lower.includes('missing')) {
            openSettingsModalForProvider(currentMode);
        }
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
                const statusData = await checkStatus();
                const providerInfo = (statusData && statusData[mode]) || (statusData && statusData.providers && statusData.providers[mode]);
                if (providerInfo && !providerInfo.configured) {
                    showToast(`${mode.toUpperCase()} API key is not configured. Please enter your API key to continue.`, 'warning');
                    openSettingsModalForProvider(mode);
                } else {
                    showToast(`Switched active provider to ${mode.toUpperCase()}`, 'info');
                    // Seamless hot-switch: if live call is active or listening, cleanly re-arm without refresh
                    if (sessionState.mode === MODE_LIVE_CALL && recorder.isRecording) {
                        recorder.unmuteAndResetTurn();
                        setSessionStatus(STATE_LIVE_LISTENING);
                    }
                }
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

    // Speech interruption (barge-in) listener
    if (selectBargeIn) {
        const savedBargeIn = localStorage.getItem('voice_barge_in');
        if (savedBargeIn) {
            selectBargeIn.value = savedBargeIn;
            recorder.setBargeInEnabled(savedBargeIn === 'enabled');
        } else {
            recorder.setBargeInEnabled(true);
        }

        selectBargeIn.addEventListener('change', (e) => {
            const enabled = e.target.value === 'enabled';
            recorder.setBargeInEnabled(enabled);
            localStorage.setItem('voice_barge_in', e.target.value);
            showToast(`Speech interruption ${enabled ? 'enabled' : 'disabled'}`, 'info');
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

                case STATE_INTERRUPTING:
                    statusHeading.innerText = 'Interrupting...';
                    statusSubtext.innerText = 'Cancelling old response and prioritizing your new speech';
                    break;

                case STATE_STOPPING:
                    statusHeading.innerText = 'Ending session...';
                    statusSubtext.innerText = 'Wrapping up connection';
                    break;

                case STATE_EXTERNAL_MIC_DISCONNECTED:
                    statusHeading.innerText = 'Microphone Disconnected';
                    statusSubtext.innerText = 'Selected external microphone disconnected. Reconnect or reselect in Settings.';
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
        cancelUserBubble();

        activeTurnId = sessionState.turnId;
        interruptAssistantPlayback('session_cleanup');

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
    // Speech Interruption (Barge-in) & Acoustic Echo Isolation
    // ----------------------------------------------------
    function isEchoOfAi(candidateText, aiText) {
        if (!candidateText || !aiText) return false;
        const cleanCandidate = candidateText.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
        const cleanAi = aiText.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
        if (!cleanCandidate || !cleanAi) return false;

        const candidateWords = cleanCandidate.split(/\s+/).filter(Boolean);
        if (candidateWords.length === 0) return false;

        const aiWordsList = cleanAi.split(/\s+/).filter(Boolean);
        const aiWordsSet = new Set(aiWordsList);

        // If candidate is a single common stopword present in AI speech, filter as acoustic feedback
        const commonStopwords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'about', 'it', 'its', 'you', 'your', 'i', 'my', 'we', 'our', 'and', 'or', 'but', 'hello', 'hi']);
        if (candidateWords.length === 1 && commonStopwords.has(candidateWords[0]) && aiWordsSet.has(candidateWords[0])) {
            return true;
        }

        // Direct phrase match: speaker sound picked up word-for-word
        if (candidateWords.length >= 2 && cleanAi.includes(cleanCandidate)) {
            return true;
        }

        // High overlap ratio indicates speaker audio leaking into microphone
        let matched = 0;
        for (const w of candidateWords) {
            if (aiWordsSet.has(w)) matched++;
        }
        const overlap = matched / candidateWords.length;
        return overlap >= 0.65;
    }

    function interruptAssistantPlayback(reason = 'user_barge_in') {
        audioPlaybackGeneration++;
        if (currentAudio) {
            try {
                currentAudio.pause();
                currentAudio.currentTime = 0;
            } catch (e) {
                console.warn(`[AUDIO] Failed to stop active playback (${reason}):`, e);
            }
            currentAudio = null;
        }
        audioQueue = [];
        isPlayingQueue = false;
        isSpeaking = false;
        isTurnResponseComplete = false;
        recorder.setAiSpeaking(false);
        if (nodeTTS) nodeTTS.classList.remove('active');
        console.log(`[AUDIO] Assistant playback interrupted (${reason}); generation=${audioPlaybackGeneration}`);
    }

    function handleBargeIn(source = 'speech', initialText = '') {
        // Strict Hardware Isolation Check: Only the explicitly selected external mic can interrupt
        if (!recorder.isExternalMicActive()) {
            console.warn(`[BARGE-IN] Interruption rejected: Selected external microphone is not active. Internal microphone exclusion enforced. (source=${source})`);
            return;
        }

        const interruptedId = activeTurnId;
        console.log(`[BARGE-IN] External microphone interruption confirmed via ${source} for request_id=${interruptedId}:`, initialText || '(vocal interruption)');

        // Stop playback before invalidating the turn so no stale audio can resume.
        interruptAssistantPlayback('user_barge_in');

        // 3. Mark the active assistant bubble with [Interrupted]
        if (activeAssistantBubble) {
            const contentEl = activeAssistantBubble.querySelector('.assistant-text-content');
            if (contentEl && !contentEl.querySelector('.interrupted-tag')) {
                const tag = document.createElement('span');
                tag.className = 'interrupted-tag';
                tag.textContent = ' [Interrupted]';
                contentEl.appendChild(tag);
            }
        }

        // 4. Conversation History Management (Section 9 & 14):
        // Discard incomplete assistant response! Never save interrupted partial response as a completed message.
        activeAssistantText = '';
        activeAssistantBubble = null;
        activeTurnUserText = null;

        // 5. Notify backend to cancel the running LLM & TTS tasks immediately
        if (interruptedId) {
            interruptedTurnIds.add(interruptedId);
            if (voiceWs && voiceWs.readyState === WebSocket.OPEN) {
                console.log(`[WS] Interrupt event sent for request_id=${interruptedId}`);
                voiceWs.send(JSON.stringify({
                    type: 'interrupt',
                    request_id: interruptedId,
                    turn_id: interruptedId,
                    reason: 'user_barge_in'
                }));
            }
            console.log(`[LLM] Previous generation cancelled for request_id=${interruptedId}`);
            console.log(`[TTS] Previous TTS task cancelled or invalidated for request_id=${interruptedId}`);
            console.log(`[SESSION] Previous response invalidated for request_id=${interruptedId}`);
        }

        // 6. Abort any in-flight REST fetch if active
        if (sessionState.abortController) {
            try { sessionState.abortController.abort(); } catch (e) {}
            sessionState.abortController = null;
        }

        // 7. Transition state machine: AI_SPEAKING/PROCESSING -> INTERRUPTING -> USER_SPEAKING
        recorder.prepareForNextSpeech();
        isProcessing = false;
        clearInactivityTimer();

        if (sessionState.mode === MODE_LIVE_CALL) {
            setSessionStatus(STATE_USER_SPEAKING);
            if (statusHeading) statusHeading.innerText = 'Listening to your query...';
        }

        if (initialText) {
            updateOrCreateUserBubble(initialText, { interim: initialText });
        } else if (!recorder.hasNativeSpeechRecognition) {
            updateOrCreateUserBubble('Listening...', { interim: 'Listening...' });
        }
    }

    // ----------------------------------------------------
    // Audio Recorder Callbacks & Event Bindings
    // ----------------------------------------------------
    recorder.onVolumeChange = (vol) => {
        if (!recorder.isRecording || recorder.isMuted) return;
        const scale = 1 + vol * 0.3;
        if (voiceOrb) {
            voiceOrb.style.transform = `scale(${scale})`;
        }
    };

    recorder.onBargeIn = (source, text) => {
        if (sessionState.status === STATE_AI_SPEAKING || sessionState.status === STATE_SPEAKING || sessionState.status === STATE_PROCESSING || isSpeaking || isPlayingQueue || currentAudio) {
            handleBargeIn(source, text);
        }
    };

    recorder.onSpeechStart = () => {
        clearInactivityTimer();
        console.log(`[VOICE] Speech start detected on external mic. Status=${sessionState.status}`);
        if (sessionState.status === STATE_AI_SPEAKING || sessionState.status === STATE_SPEAKING || sessionState.status === STATE_PROCESSING || isSpeaking || isPlayingQueue || currentAudio) {
            // Strict check: Only external mic VAD can trigger interruption
            if (!recorder.isExternalMicActive()) {
                console.warn('[BARGE-IN] Speech start rejected: External microphone inactive, internal mic rejection enforced.');
                return;
            }
            handleBargeIn(sessionState.status === STATE_PROCESSING ? 'llm_generation_interruption' : 'speech_start');
            return;
        }
        if (sessionState.mode === MODE_LIVE_CALL && (sessionState.status === STATE_LISTENING || sessionState.status === STATE_LIVE_LISTENING)) {
            setSessionStatus(STATE_USER_SPEAKING);
            if (!recorder.hasNativeSpeechRecognition) {
                updateOrCreateUserBubble('Listening...', { interim: 'Listening...' });
            }
        }
    };

    // Progressive real-time transcription updates while user is speaking
    recorder.onPartialTranscript = (text, metadata) => {
        if (sessionState.mode !== MODE_LIVE_CALL) return;
        if (recorder.isMuted) return;
        if (!text || !text.trim()) return;

        // If AI is speaking or LLM is processing: enforce external mic VAD authorization
        if (sessionState.status === STATE_AI_SPEAKING || sessionState.status === STATE_SPEAKING || sessionState.status === STATE_PROCESSING || isSpeaking || isPlayingQueue || (metadata && metadata.isAiSpeaking)) {
            // Native speech recognition in browser uses OS default mic (laptop internal mic).
            // It MUST NOT trigger barge-in unless external mic VAD actively confirmed speech!
            if (!recorder.isExternalMicActive() || !recorder.hasSpokenInTurn) {
                console.log('[BARGE-IN] Partial transcript ignored during AI playback: External mic VAD has not confirmed speech. Internal mic audio excluded.');
                return;
            }
            if (sessionState.status === STATE_AI_SPEAKING || sessionState.status === STATE_SPEAKING || isSpeaking) {
                if (isEchoOfAi(text, activeAssistantText)) {
                    console.log('[Echo Guard] Ignored acoustic echo leak:', text);
                    return;
                }
            }
            // Genuine human interruption confirmed on external microphone!
            handleBargeIn('partial_transcript', text);
        }

        clearInactivityTimer();
        if (sessionState.status === STATE_LISTENING || sessionState.status === STATE_LIVE_LISTENING) {
            setSessionStatus(STATE_USER_SPEAKING);
        }
        updateOrCreateUserBubble(text, metadata);
    };

    // Instant transcript path (< 50ms) for Live Call final utterance
    recorder.onSpeechTranscript = async (text) => {
        clearInactivityTimer();
        if (!text || !text.trim()) return;
        console.log(`[STT] User utterance finalized on external mic: "${text}"`);

        if (sessionState.mode === MODE_LIVE_CALL) {
            if (sessionState.status === STATE_AI_SPEAKING || sessionState.status === STATE_SPEAKING || sessionState.status === STATE_PROCESSING || isSpeaking || isPlayingQueue || currentAudio) {
                if (!recorder.isExternalMicActive() || !recorder.hasSpokenInTurn) {
                    console.log('[BARGE-IN] Final transcript ignored during AI playback: External mic VAD has not confirmed speech. Internal mic audio excluded.');
                    return;
                }
                if (sessionState.status === STATE_AI_SPEAKING || sessionState.status === STATE_SPEAKING || isSpeaking) {
                    if (isEchoOfAi(text, activeAssistantText)) {
                        console.log('[Echo Guard] Dropped final transcript matching AI echo:', text);
                        return;
                    }
                }
                handleBargeIn('speech_final', text);
            }
            // Continuous capture: Prepare buffer for the next utterance without muting the mic
            recorder.prepareForNextSpeech();
            await processText(text);
        }
    };

    // Audio blob fallback path for Live Call (Firefox, Safari, Edge, mobile)
    recorder.onSilenceDetected = async (wavBlob) => {
        clearInactivityTimer();
        if (sessionState.mode === MODE_LIVE_CALL && wavBlob) {
            if (sessionState.status === STATE_AI_SPEAKING || sessionState.status === STATE_SPEAKING || sessionState.status === STATE_PROCESSING || isSpeaking || isPlayingQueue || currentAudio) {
                if (!recorder.isExternalMicActive() || !recorder.hasSpokenInTurn) {
                    console.log('[BARGE-IN] WAV blob ignored during AI playback: External mic VAD has not confirmed speech. Internal mic audio excluded.');
                    return;
                }
                handleBargeIn('silence_final');
            }
            // Continuous capture: Prepare buffer without muting the mic
            recorder.prepareForNextSpeech();
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
                gradient.addColorStop(0, '#0ea5e9');
                gradient.addColorStop(1, '#7dd3fc');

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

    // Safari & Mobile Audio Unlocker for Cross-Browser Auto-Play Support
    function unlockAudio() {
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) {
                if (!window.__unlockedAudioCtx) {
                    window.__unlockedAudioCtx = new AudioContextClass();
                }
                if (window.__unlockedAudioCtx.state === 'suspended') {
                    window.__unlockedAudioCtx.resume();
                }
            }
            if (!window.__silentAudioUnlocked) {
                const dummy = new Audio();
                dummy.src = 'data:audio/wav;base64,UklGRigAAABXQVZFRm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
                dummy.volume = 0.01;
                dummy.play().catch(() => {});
                window.__silentAudioUnlocked = true;
            }
        } catch (e) {}
    }

    // --- Live Call ---
    async function startLiveCall() {
        unlockAudio();
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
        unlockAudio();
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
        unlockAudio();
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
            } else if (sessionState.status === STATE_SPEAKING) {
                handleBargeIn('button_click');
                await startClickToTalkRecording();
            }
        }
    }

    async function handleOrbClick() {
        unlockAudio();
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
            } else if (sessionState.status === STATE_SPEAKING) {
                handleBargeIn('orb_click');
                await startClickToTalkRecording();
            }
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
    // WebSocket Client & Streaming Audio Queue State
    // ----------------------------------------------------
    function initVoiceWebSocket() {
        if (voiceWs && (voiceWs.readyState === WebSocket.OPEN || voiceWs.readyState === WebSocket.CONNECTING)) {
            return;
        }
        if (wsReconnectTimer) {
            clearTimeout(wsReconnectTimer);
            wsReconnectTimer = null;
        }
        wsConnecting = true;
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/voice`;

        try {
            voiceWs = new WebSocket(wsUrl);

            voiceWs.onopen = () => {
                wsConnected = true;
                wsConnecting = false;
                console.log('Voice AI WebSocket /ws/voice connected successfully.');
                const configPayload = getCustomConfig();
                voiceWs.send(JSON.stringify({ type: 'config', keys: configPayload }));
            };

            voiceWs.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    handleWebSocketMessage(data);
                } catch (e) {
                    console.warn('Failed to parse WebSocket message:', e);
                }
            };

            voiceWs.onerror = (err) => {
                console.warn('Voice AI WebSocket error:', err);
                wsConnected = false;
                wsConnecting = false;
            };

            voiceWs.onclose = () => {
                wsConnected = false;
                wsConnecting = false;
                console.log('Voice AI WebSocket closed. Reconnecting in 3s...');
                wsReconnectTimer = setTimeout(initVoiceWebSocket, 3000);
            };
        } catch (e) {
            wsConnecting = false;
            console.warn('Failed to initialize WebSocket:', e);
            wsReconnectTimer = setTimeout(initVoiceWebSocket, 4000);
        }
    }

    function handleWebSocketMessage(data) {
        const msgType = data.type;
        const reqId = data.request_id || data.turn_id;

        if (msgType === 'pong' || msgType === 'config_ack') return;

        if (msgType === 'interrupted' || msgType === 'interrupt_ack') {
            console.log(`[BACKEND] Interruption confirmed by server request_id=${reqId}`);
            return;
        }

        // Guard against stale turns and interrupted turns
        if (reqId && (reqId !== activeTurnId || interruptedTurnIds.has(reqId))) {
            console.debug(`[SESSION] Stale or interrupted response discarded request_id=${reqId} active=${activeTurnId}`);
            return;
        }

        if (msgType === 'transcript') {
            const transcriptText = (data.text || '').trim();
            console.log(`[STT] New user transcript received request_id=${reqId}: "${transcriptText}"`);
            if (transcriptText) {
                activeTurnUserText = transcriptText;
                if (activeUserBubble) {
                    finalizeUserBubble(transcriptText);
                } else {
                    appendUserMessage(transcriptText);
                }
            }
            if (nodeSTT) nodeSTT.classList.remove('active');
            if (nodeLLM) nodeLLM.classList.add('active');
            return;
        }

        if (msgType === 'no_speech') {
            if (nodeSTT) nodeSTT.classList.remove('active');
            cancelUserBubble();
            if (sessionState.mode === MODE_LIVE_CALL) {
                recorder.setMuted(false);
                recorder.setAiSpeaking(false);
                recorder.prepareForNextSpeech();
                setSessionStatus(STATE_LISTENING);
                startInactivityTimer();
            } else {
                showToast('No speech detected. Please speak clearly into your microphone.', 'info');
                setSessionStatus(STATE_IDLE);
            }
            return;
        }

        if (msgType === 'llm_start') {
            setSessionStatus(STATE_PROCESSING);
            if (nodeLLM) nodeLLM.classList.add('active');
            console.log(`[LLM] Response generation started request_id=${reqId}`);
        } else if (msgType === 'text_chunk' || msgType === 'llm_token' || msgType === 'llm_chunk') {
            if (msgType === 'llm_chunk' || msgType === 'llm_token') {
                // Ignore duplicates if text_chunk is already handled
                if (data.type !== 'text_chunk') return;
            }
            // Progressive text delivery
            if (!activeAssistantBubble) {
                activeAssistantBubble = createStreamingAssistantBubble();
            }
            const chunk = data.chunk || data.text || '';
            activeAssistantText += chunk;
            const contentEl = activeAssistantBubble.querySelector('.assistant-text-content');
            if (contentEl) {
                contentEl.innerText = activeAssistantText;
            }
            chatHistory.scrollTop = chatHistory.scrollHeight;
        } else if (msgType === 'audio_chunk' || msgType === 'tts_audio_chunk') {
            if (msgType === 'tts_audio_chunk') return; // Prevent duplicate queuing with audio_chunk
            // Incremental audio delivery
            if (data.audio_data) {
                const segIndex = typeof data.segment_index === 'number' ? data.segment_index : audioQueue.length;
                const audioUrl = `data:audio/mp3;base64,${data.audio_data}`;
                const segment = {
                    turnId: reqId,
                    index: segIndex,
                    audioUrl: audioUrl,
                    text: data.text || ''
                };
                audioQueue.push(segment);
                audioQueue.sort((a, b) => a.index - b.index);

                // Start playback immediately when the first segment is ready!
                if (!isPlayingQueue) {
                    playNextAudioQueueSegment();
                }
            }
        } else if (msgType === 'response_complete') {
            isTurnResponseComplete = true;
            // If all audio segments have already finished playing (or if no audio was sent)
            if (!isPlayingQueue && audioQueue.length === 0) {
                finishTurnPlayback();
            }
        } else if (msgType === 'error' || msgType === 'llm_error') {
            const stage = data.stage ? `[${data.stage}] ` : '';
            const errorMsg = data.message || 'Error occurred';
            showToast(`${stage}${errorMsg}`, 'error');
            recorder.setAiSpeaking(false);
            recorder.setMuted(false);
            setSessionStatus(STATE_ERROR, errorMsg);
            handleAuthOrKeyError(errorMsg);
            if (isPlayingQueue && currentAudio) {
                try { currentAudio.pause(); } catch (e) {}
                currentAudio = null;
            }
            audioQueue = [];
            isPlayingQueue = false;
            isSpeaking = false;
        }
    }

    function playNextAudioQueueSegment() {
        if (audioQueue.length === 0) {
            isPlayingQueue = false;
            if (isTurnResponseComplete) {
                finishTurnPlayback();
            }
            return;
        }

        isPlayingQueue = true;
        isSpeaking = true;
        setSessionStatus(STATE_AI_SPEAKING);
        if (nodeTTS) nodeTTS.classList.add('active');
        if (sessionState.mode === MODE_LIVE_CALL) {
            recorder.setAiSpeaking(true);
        }

        const nextSeg = audioQueue.shift();
        const playbackGeneration = audioPlaybackGeneration;
        if (currentAudio) {
            try { currentAudio.pause(); } catch (e) {}
            currentAudio = null;
        }

        currentAudio = new Audio(nextSeg.audioUrl);
        console.log(`[TTS] Playing audio segment ${nextSeg.index} for request_id=${nextSeg.turnId}`);

        currentAudio.onended = () => {
            if (playbackGeneration !== audioPlaybackGeneration) return;
            currentAudio = null;
            playNextAudioQueueSegment();
        };

        currentAudio.onerror = (err) => {
            if (playbackGeneration !== audioPlaybackGeneration) return;
            console.warn(`[AUDIO] Playback error on segment ${nextSeg.index}:`, err);
            currentAudio = null;
            playNextAudioQueueSegment();
        };

        currentAudio.play().catch(e => {
            if (playbackGeneration !== audioPlaybackGeneration) return;
            console.warn('[AUDIO] Play failed or auto-play prevented:', e);
            currentAudio = null;
            playNextAudioQueueSegment();
        });
    }

    function finishTurnPlayback() {
        isPlayingQueue = false;
        isSpeaking = false;
        currentAudio = null;
        if (nodeTTS) nodeTTS.classList.remove('active');
        if (nodeLLM) nodeLLM.classList.remove('active');
        if (nodeSTT) nodeSTT.classList.remove('active');

        // Append completed turn to conversation history ONLY when successfully completed
        if (activeTurnUserText && activeAssistantText) {
            conversationHistory.push({ role: 'user', content: activeTurnUserText });
            conversationHistory.push({ role: 'assistant', content: activeAssistantText });
            updateMessageCount();
            console.log(`[VOICE] Response completed and recorded to history for request_id=${activeTurnId}`);
        }

        activeTurnUserText = null;
        activeAssistantText = '';
        activeAssistantBubble = null;

        if (sessionState.mode === MODE_LIVE_CALL) {
            recorder.setAiSpeaking(false);
            recorder.prepareForNextSpeech();
            startInactivityTimer();
            setSessionStatus(STATE_LISTENING);
        } else {
            setSessionStatus(STATE_IDLE);
        }
    }

    function createStreamingAssistantBubble() {
        if (emptyState) emptyState.style.display = 'none';

        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble assistant';
        bubble.innerHTML = `
            <div class="assistant-text-content"><span style="color: var(--text-muted); font-style: italic;">Thinking...</span></div>
        `;
        chatHistory.appendChild(bubble);
        chatHistory.scrollTop = chatHistory.scrollHeight;
        return bubble;
    }

    // ----------------------------------------------------
    // API Audio & Text Pipeline Processing
    // ----------------------------------------------------
    async function processAudio(wavBlob) {
        if (!wavBlob) return;
        const requestId = generateRequestId();
        sessionState.turnId++;
        sessionState.abortController = new AbortController();

        setSessionStatus(STATE_PROCESSING);
        if (nodeSTT) nodeSTT.classList.add('active');

        const customKeys = getCustomConfig();

        // WebSocket Streaming Path (Ultra-low latency across all browsers)
        if (voiceWs && voiceWs.readyState === WebSocket.OPEN) {
            activeTurnId = requestId;
            activeTurnUserText = '';
            activeAssistantText = '';
            activeAssistantBubble = null;
            audioQueue = [];
            isPlayingQueue = false;
            isTurnResponseComplete = false;

            const reader = new FileReader();
            reader.onloadend = () => {
                const base64Data = reader.result;
                console.log(`[WS] Submitting audio request_id=${requestId}`);
                voiceWs.send(JSON.stringify({
                    type: 'audio',
                    audio: base64Data,
                    request_id: requestId,
                    turn_id: requestId,
                    history: conversationHistory,
                    keys: customKeys
                }));
            };
            reader.readAsDataURL(wavBlob);
            return;
        }

        // REST Fallback if WebSocket is not connected
        const formData = new FormData();
        formData.append('audio', wavBlob, 'recording.wav');
        formData.append('history', JSON.stringify(conversationHistory));
        formData.append('keys', JSON.stringify(customKeys));

        try {
            const response = await fetch('/api/process-audio', {
                method: 'POST',
                body: formData,
                signal: sessionState.abortController.signal
            });

            const data = await response.json();

            // Guard against superseded turns or cancelled operations
            if (sessionState.abortController.signal.aborted) return;

            if (!response.ok || data.error) {
                const stage = data.stage ? `[${data.stage}] ` : '';
                const errorMsg = data.message || 'Error processing audio';
                showToast(`${stage}${errorMsg}`, 'error');
                recorder.setMuted(false);
                setSessionStatus(STATE_ERROR, errorMsg);
                handleAuthOrKeyError(errorMsg);
                return;
            }

            handleSuccessResponse(data, true, sessionState.turnId);

        } catch (err) {
            if (err.name === 'AbortError') return;

            recorder.setMuted(false);
            showToast('Network / Server Error: ' + err.message, 'error');
            setSessionStatus(STATE_ERROR, err.message);
        }
    }

    async function processText(text) {
        if (!text || !text.trim()) return;
        if (sessionState.status === STATE_PROCESSING || sessionState.status === STATE_AI_SPEAKING || sessionState.status === STATE_SPEAKING || isSpeaking || isPlayingQueue) {
            handleBargeIn('text_input', text);
        }

        const requestId = generateRequestId();
        sessionState.turnId++;
        sessionState.abortController = new AbortController();

        setSessionStatus(STATE_PROCESSING);
        if (activeUserBubble) {
            finalizeUserBubble(text.trim());
        } else {
            appendUserMessage(text.trim());
        }

        // Check if WebSocket is open and connected for fast real-time streaming
        if (voiceWs && voiceWs.readyState === WebSocket.OPEN) {
            activeTurnId = requestId;
            activeTurnUserText = text.trim();
            activeAssistantText = '';
            activeAssistantBubble = null;
            audioQueue = [];
            isPlayingQueue = false;
            isTurnResponseComplete = false;

            console.log(`[WS] Submitting query request_id=${requestId}: "${text.trim()}"`);
            const customKeys = getCustomConfig();
            voiceWs.send(JSON.stringify({
                type: 'text',
                text: text.trim(),
                request_id: requestId,
                turn_id: requestId,
                history: conversationHistory,
                keys: customKeys
            }));
            return;
        }

        // REST Fallback if WebSocket is offline
        const customKeys = getCustomConfig();

        try {
            const response = await fetch('/api/process-text', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: text.trim(),
                    conversation_history: conversationHistory,
                    custom_keys: customKeys
                }),
                signal: sessionState.abortController.signal
            });

            const data = await response.json();
            if (turnId !== sessionState.turnId) return;

            if (!response.ok || data.error) {
                const stage = data.stage ? `[${data.stage}] ` : '';
                const errorMsg = data.message || 'Error processing text';
                showToast(`${stage}${errorMsg}`, 'error');
                recorder.setMuted(false);
                setSessionStatus(STATE_ERROR, errorMsg);
                handleAuthOrKeyError(errorMsg);
                return;
            }

            handleSuccessResponse(data, false, turnId);

        } catch (err) {
            if (err.name === 'AbortError') return;
            if (turnId !== sessionState.turnId) return;

            recorder.setMuted(false);
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
            if (activeUserBubble) {
                finalizeUserBubble(data.user_text);
            } else {
                appendUserMessage(data.user_text);
            }
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
                startInactivityTimer();
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

        // Keep mic active with echo isolation so user can barge in during REST playback
        if (sessionState.mode === MODE_LIVE_CALL) {
            recorder.setAiSpeaking(true);
            recorder.setMuted(false);
        }

        let isPlaybackFinished = false;
        const restoreAfterPlayback = () => {
            if (isPlaybackFinished) return;
            isPlaybackFinished = true;
            currentAudio = null;

            if (turnId && turnId !== sessionState.turnId) return;

            if (sessionState.mode === MODE_LIVE_CALL) {
                recorder.setAiSpeaking(false);
                recorder.setMuted(false);
                recorder.prepareForNextSpeech();
                startInactivityTimer();
                setSessionStatus(STATE_LISTENING);
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
    // Transcript Rendering & Progressive User Transcription
    // ----------------------------------------------------
    function appendUserMessage(text) {
        if (emptyState) emptyState.style.display = 'none';

        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble user';
        bubble.innerHTML = `
            <div class="user-text-content">${escapeHtml(text)}</div>
            <div class="bubble-meta">
                <span>You</span>
                <span class="user-bubble-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
        `;
        chatHistory.appendChild(bubble);
        chatHistory.scrollTop = chatHistory.scrollHeight;
        return bubble;
    }

    function updateOrCreateUserBubble(text, metadata) {
        if (!text || !text.trim()) return null;
        if (emptyState) emptyState.style.display = 'none';

        if (!activeUserBubble || !activeUserBubble.isConnected) {
            const bubble = document.createElement('div');
            bubble.className = 'chat-bubble user interim-bubble';
            bubble.innerHTML = `
                <div class="user-text-content"></div>
                <div class="bubble-meta">
                    <span>You</span>
                    <span class="user-bubble-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
            `;
            chatHistory.appendChild(bubble);
            activeUserBubble = bubble;
        }

        const contentEl = activeUserBubble.querySelector('.user-text-content');
        if (contentEl) {
            const finalPart = (metadata && typeof metadata.final === 'string') ? metadata.final : '';
            const interimPart = (metadata && typeof metadata.interim === 'string') ? metadata.interim : '';

            let html = '';
            if (finalPart) {
                html += `<span class="final-text">${escapeHtml(finalPart)}</span>`;
            }
            if (interimPart) {
                if (finalPart) html += ' ';
                html += `<span class="interim-text">${escapeHtml(interimPart)}</span>`;
            }
            if (!finalPart && !interimPart && text) {
                html += `<span class="interim-text">${escapeHtml(text)}</span>`;
            }

            // Subtle listening indicator
            html += ` <span class="listening-indicator" aria-label="Listening"><span class="listening-dot"></span></span>`;
            contentEl.innerHTML = html;
        }

        chatHistory.scrollTop = chatHistory.scrollHeight;
        return activeUserBubble;
    }

    function finalizeUserBubble(finalText) {
        if (!activeUserBubble) return null;

        activeUserBubble.classList.remove('interim-bubble');
        const contentEl = activeUserBubble.querySelector('.user-text-content');
        if (contentEl) {
            contentEl.innerHTML = escapeHtml(finalText);
        }
        const timeEl = activeUserBubble.querySelector('.user-bubble-time');
        if (timeEl) {
            timeEl.innerText = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        const finalizedBubble = activeUserBubble;
        activeUserBubble = null;
        return finalizedBubble;
    }

    function cancelUserBubble() {
        if (activeUserBubble) {
            const contentEl = activeUserBubble.querySelector('.user-text-content');
            const hasText = contentEl && contentEl.innerText.trim();
            if (!hasText) {
                activeUserBubble.remove();
                if (emptyState && chatHistory.children.length === 0) {
                    emptyState.style.display = 'flex';
                }
            } else {
                activeUserBubble.classList.remove('interim-bubble');
                const indicator = activeUserBubble.querySelector('.listening-indicator');
                if (indicator) indicator.remove();
                const interimSpan = activeUserBubble.querySelector('.interim-text');
                if (interimSpan) interimSpan.classList.remove('interim-text');
            }
            activeUserBubble = null;
        }
    }

    function appendAssistantMessage(text, audioUrl, metrics) {
        if (emptyState) emptyState.style.display = 'none';

        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble assistant';
        bubble.innerHTML = `<div>${escapeHtml(text)}</div>`;
        chatHistory.appendChild(bubble);
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    window.playSnippet = (url) => {
        playAudioResponse(url, ++sessionState.turnId);
    };

    function updateMessageCount() {
        const turns = Math.floor(conversationHistory.length / 2);
        if (messageCountEl) {
            messageCountEl.innerText = `${turns} turn${turns === 1 ? '' : 's'}`;
        }
    }

    function clearChat() {
        conversationHistory = [];
        activeUserBubble = null;
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
            unlockAudio();
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

    // ----------------------------------------------------
    // Collapsible Conversation Drop-Down Interactions
    // ----------------------------------------------------
    function isTranscriptCollapsed() {
        return transcriptPanel && transcriptPanel.classList.contains('collapsed');
    }

    function expandTranscript(scrollSmoothly = true) {
        if (!transcriptPanel || !isTranscriptCollapsed()) return;

        transcriptPanel.classList.remove('collapsed');
        if (mainContainer) mainContainer.classList.remove('conversation-collapsed');

        if (btnToggleTranscript) {
            btnToggleTranscript.setAttribute('aria-expanded', 'true');
            btnToggleTranscript.title = 'Collapse';
        }

        if (scrollSmoothly && chatHistory) {
            // Smoothly reveal and scroll the conversation messages into view
            requestAnimationFrame(() => {
                setTimeout(() => {
                    chatHistory.scrollTo({
                        top: chatHistory.scrollHeight,
                        behavior: 'smooth'
                    });
                }, 60);
            });
        }
    }

    function collapseTranscript() {
        if (!transcriptPanel || isTranscriptCollapsed()) return;

        transcriptPanel.classList.add('collapsed');
        if (mainContainer) mainContainer.classList.add('conversation-collapsed');

        if (btnToggleTranscript) {
            btnToggleTranscript.setAttribute('aria-expanded', 'false');
            btnToggleTranscript.title = 'Expand';
        }
    }

    function toggleTranscript() {
        if (isTranscriptCollapsed()) {
            expandTranscript(true);
        } else {
            collapseTranscript();
        }
    }

    if (btnToggleTranscript) {
        btnToggleTranscript.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleTranscript();
        });

        btnToggleTranscript.addEventListener('keydown', (e) => {
            if ((e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') && isTranscriptCollapsed()) {
                e.preventDefault();
                expandTranscript(true);
            }
        });
    }

    if (panelHeader) {
        panelHeader.addEventListener('click', (e) => {
            if (!e.target.closest('button') && !e.target.closest('a')) {
                toggleTranscript();
            }
        });
    }



    // Initialize UI and WebSocket on load
    updateUI();
    initVoiceWebSocket();

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

                // Seamless dynamic recovery: restore listening immediately without requiring page refresh
                if (sessionState.mode === MODE_LIVE_CALL) {
                    if (recorder.isRecording) {
                        recorder.unmuteAndResetTurn();
                        setSessionStatus(STATE_LIVE_LISTENING);
                        startVisualizer();
                        startInactivityTimer();
                        showToast(`Ready! Listening with ${selectedProvider.toUpperCase()}...`, 'success');
                    } else {
                        setSessionStatus(STATE_IDLE);
                    }
                } else {
                    setSessionStatus(STATE_IDLE);
                }
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
            groq_model: selectGroqModel ? selectGroqModel.value : undefined,
            openai_model: selectOpenAIModel ? selectOpenAIModel.value : undefined,
            gemini_model: selectGeminiModel ? selectGeminiModel.value : undefined,
            local_voice: selectLocalVoice ? selectLocalVoice.value : 'en-US-JennyNeural'
        };
    }

    function populateSelectOptions(selectEl, models, currentModel) {
        if (!selectEl || !models || models.length === 0) return;
        // Strictly filter out any deprecated llama models
        let filteredModels = models.filter(m => !m.toLowerCase().includes('llama'));
        if (filteredModels.length === 0) {
            filteredModels = models;
        }

        let previousVal = currentModel || selectEl.value;
        if (previousVal && previousVal.toLowerCase().includes('llama')) {
            previousVal = filteredModels[0];
        }

        const exists = filteredModels.includes(previousVal);
        let html = '';
        if (previousVal && !exists && !previousVal.toLowerCase().includes('llama')) {
            html += `<option value="${escapeHtml(previousVal)}" selected>${escapeHtml(previousVal)} (active)</option>`;
        }
        html += filteredModels.map(m => `<option value="${escapeHtml(m)}" ${m === previousVal ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('');
        selectEl.innerHTML = html;
        if (filteredModels.length > 0 && (!previousVal || previousVal.toLowerCase().includes('llama') || !exists)) {
            selectEl.value = filteredModels[0];
        }
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

            const groqInfo = data.groq || (data.providers && data.providers.groq);
            const openaiInfo = data.openai || (data.providers && data.providers.openai);
            const geminiInfo = data.gemini || (data.providers && data.providers.gemini);

            // Update badges
            if (groqInfo) updateBadge(groqStatusBadge, groqInfo);
            if (openaiInfo) updateBadge(openaiStatusBadge, openaiInfo);
            if (geminiInfo) updateBadge(geminiStatusBadge, geminiInfo);

            // Populate models
            if (groqInfo && groqInfo.available_models) {
                populateSelectOptions(selectGroqModel, groqInfo.available_models, groqInfo.model);
            }
            if (openaiInfo && openaiInfo.available_models) {
                populateSelectOptions(selectOpenAIModel, openaiInfo.available_models, openaiInfo.model);
            }
            if (geminiInfo && geminiInfo.available_models) {
                populateSelectOptions(selectGeminiModel, geminiInfo.available_models, geminiInfo.model);
            }

            // Update placeholders for configured keys (never exposing raw secrets)
            if (inputGroqKey && groqInfo && groqInfo.configured) {
                inputGroqKey.placeholder = '•••••••••••••••• (Configured on server)';
            }
            if (inputOpenAIKey && openaiInfo && openaiInfo.configured) {
                inputOpenAIKey.placeholder = '•••••••••••••••• (Configured on server)';
            }
            if (inputGeminiKey && geminiInfo && geminiInfo.configured) {
                inputGeminiKey.placeholder = '•••••••••••••••• (Configured on server)';
            }
            if (inputElevenKey && data.elevenlabs && data.elevenlabs.configured) {
                inputElevenKey.placeholder = '•••••••••••••••• (Configured on server)';
            }

            // Enumerate available external microphones and update UI
            await refreshAudioDevicesList(true);

            return data;
        } catch (e) {
            console.warn('Could not fetch status:', e);
            return null;
        }
    }

    // ----------------------------------------------------
    // External Microphone Device Selection & Isolation UI
    // ----------------------------------------------------
    function updateMicUIStatus(isConnected, deviceLabel) {
        const label = deviceLabel || recorder.selectedDeviceLabel || 'None';
        if (selectedDeviceNameText) {
            selectedDeviceNameText.textContent = label;
            selectedDeviceNameText.title = label;
        }

        if (isConnected) {
            if (micStatusBadge) {
                micStatusBadge.textContent = 'CONNECTED';
                micStatusBadge.className = 'provider-status-badge badge-connected';
            }
            if (bargeInStatusBadge) {
                bargeInStatusBadge.textContent = 'ENABLED';
                bargeInStatusBadge.className = 'provider-status-badge badge-connected';
            }
            if (headerMicDot) {
                headerMicDot.className = 'mic-dot mic-dot-connected';
            }
            if (headerMicLabel) {
                const shortLabel = label.length > 15 ? label.substring(0, 14) + '...' : label;
                headerMicLabel.textContent = `Mic: ${shortLabel}`;
                headerMicLabel.title = `Active External Mic: ${label} (Internal Mic Excluded)`;
            }
        } else {
            if (micStatusBadge) {
                micStatusBadge.textContent = 'DISCONNECTED';
                micStatusBadge.className = 'provider-status-badge badge-disconnected';
            }
            if (bargeInStatusBadge) {
                bargeInStatusBadge.textContent = 'DISABLED';
                bargeInStatusBadge.className = 'provider-status-badge badge-disabled';
            }
            if (headerMicDot) {
                headerMicDot.className = 'mic-dot mic-dot-disconnected';
            }
            if (headerMicLabel) {
                headerMicLabel.textContent = 'Mic: Disconnected';
                headerMicLabel.title = 'External microphone disconnected. Speech interruption is disabled.';
            }
        }
    }

    async function refreshAudioDevicesList(autoSelectDefault = true) {
        if (!selectMicDevice) return;
        selectMicDevice.innerHTML = '<option value="">Detecting available microphones...</option>';
        if (headerMicLabel) headerMicLabel.textContent = 'Mic: Detecting...';
        if (headerMicDot) headerMicDot.className = 'mic-dot mic-dot-checking';

        const devices = await recorder.getAudioInputDevices();
        selectMicDevice.innerHTML = '';

        if (!devices || devices.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'No microphones found';
            selectMicDevice.appendChild(opt);
            updateMicUIStatus(false, 'None');
            return;
        }

        let savedId = recorder.selectedDeviceId;
        let matchedOption = false;

        devices.forEach(dev => {
            const opt = document.createElement('option');
            opt.value = dev.deviceId;
            opt.textContent = dev.label;
            if (dev.deviceId === savedId) {
                opt.selected = true;
                matchedOption = true;
            }
            selectMicDevice.appendChild(opt);
        });

        if (matchedOption) {
            const activeLabel = selectMicDevice.selectedOptions[0]?.textContent || recorder.selectedDeviceLabel;
            recorder.setSelectedDevice(savedId, activeLabel);
            updateMicUIStatus(true, activeLabel);
        } else if (autoSelectDefault && devices.length > 0) {
            // Find preferred external/USB microphone if available
            const externalDev = devices.find(d => {
                const l = (d.label || '').toLowerCase();
                return l.includes('usb') || l.includes('external') || l.includes('headset') || (l.includes('mic') && !l.includes('internal') && !l.includes('array'));
            }) || devices[0];

            selectMicDevice.value = externalDev.deviceId;
            recorder.setSelectedDevice(externalDev.deviceId, externalDev.label);
            updateMicUIStatus(true, externalDev.label);
        } else {
            // Saved device is no longer connected!
            if (savedId) {
                updateMicUIStatus(false, recorder.selectedDeviceLabel || 'Disconnected');
                showToast(`Your selected external microphone (${recorder.selectedDeviceLabel}) is disconnected.`, 'warning');
            } else {
                updateMicUIStatus(false, 'None Selected');
            }
        }
    }

    if (selectMicDevice) {
        selectMicDevice.addEventListener('change', async () => {
            const selectedOpt = selectMicDevice.selectedOptions[0];
            const deviceId = selectMicDevice.value;
            const deviceLabel = selectedOpt ? selectedOpt.textContent : '';

            if (deviceId) {
                recorder.setSelectedDevice(deviceId, deviceLabel);
                updateMicUIStatus(true, deviceLabel);
                showToast(`External microphone selected: ${deviceLabel}`, 'info');

                // If currently live, switch stream to the newly selected device immediately
                if (sessionState.mode === MODE_LIVE_CALL && recorder.isRecording) {
                    try {
                        console.log(`[DEVICE] Switching active stream to device: "${deviceLabel}"`);
                        await recorder.stop();
                        await recorder.start(true);
                        showToast(`Microphone switched and active!`, 'success');
                    } catch (e) {
                        showToast(`Failed to initialize ${deviceLabel}: ${e.message}`, 'error');
                    }
                }
            } else {
                recorder.setSelectedDevice('', '');
                updateMicUIStatus(false, 'None');
            }
        });
    }

    if (btnRefreshMics) {
        btnRefreshMics.addEventListener('click', async () => {
            btnRefreshMics.disabled = true;
            btnRefreshMics.textContent = '↻ Checking...';
            try {
                await refreshAudioDevicesList(false);
                showToast(`Refreshed available microphones`, 'info');
            } finally {
                btnRefreshMics.disabled = false;
                btnRefreshMics.textContent = '↻ Refresh';
            }
        });
    }

    if (headerMicPill) {
        headerMicPill.addEventListener('click', () => {
            if (settingsModal) {
                settingsModal.classList.add('open');
                setTimeout(() => {
                    if (selectMicDevice) selectMicDevice.focus();
                }, 100);
            }
        });
    }

    // AudioRecorder device lifecycle event bindings
    recorder.onDeviceDisconnected = (deviceId, label, reason) => {
        updateMicUIStatus(false, label || 'Disconnected');
        showToast('Your selected external microphone has been disconnected. Speech interruption is temporarily disabled. Please reconnect or select another external microphone.', 'error');
        if (sessionState.mode === MODE_LIVE_CALL && sessionState.status === STATE_LISTENING) {
            setSessionStatus(STATE_EXTERNAL_MIC_DISCONNECTED);
        }
    };

    recorder.onDeviceConnected = (deviceId, label) => {
        updateMicUIStatus(true, label);
        showToast(`External microphone reconnected: ${label}`, 'success');
        if (sessionState.status === STATE_EXTERNAL_MIC_DISCONNECTED) {
            setSessionStatus(STATE_IDLE);
        }
    };

    recorder.onDevicesChanged = (devices) => {
        refreshAudioDevicesList(false);
    };

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
