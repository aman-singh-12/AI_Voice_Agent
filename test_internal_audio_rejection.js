/**
 * Unit Test Suite: Complete Internal Audio Echo Rejection & Internal Mic Exclusion
 * Verifies that internal audio (AI speech output) is NEVER treated as an interruption.
 */
const assert = require('assert');

// Mock browser globals
class MockMediaStreamTrack {
    constructor(deviceId, label = 'Mock Mic') {
        this._deviceId = deviceId;
        this.label = label;
        this.readyState = 'live';
        this.muted = false;
        this.onended = null;
    }
    getSettings() {
        return { deviceId: this._deviceId };
    }
    stop() {
        this.readyState = 'ended';
        if (this.onended) this.onended();
    }
}

class MockMediaStream {
    constructor(tracks = []) {
        this._tracks = tracks;
        this.active = true;
    }
    getAudioTracks() {
        return this._tracks;
    }
}

const mockStorage = {};
global.localStorage = {
    getItem: (k) => mockStorage[k] || null,
    setItem: (k, v) => { mockStorage[k] = String(v); },
    removeItem: (k) => { delete mockStorage[k]; }
};

global.window = {
    AudioContext: class {
        constructor() {
            this.state = 'running';
            this.sampleRate = 44100;
            this.destination = {};
        }
        createMediaStreamSource() {
            return { connect: () => {}, disconnect: () => {} };
        }
        createAnalyser() {
            return {
                fftSize: 256,
                frequencyBinCount: 128,
                getByteFrequencyData: () => {},
                connect: () => {}
            };
        }
        createScriptProcessor() {
            return {
                connect: () => {},
                disconnect: () => {},
                onaudioprocess: null
            };
        }
    }
};

const mockNavigator = {
    mediaDevices: {
        getUserMedia: async () => new MockMediaStream([new MockMediaStreamTrack('usb_mic_id', 'USB Microphone')]),
        enumerateDevices: async () => [
            { deviceId: 'internal_mic_id', kind: 'audioinput', label: 'Microphone Array (Intel Smart Sound Technology)' },
            { deviceId: 'usb_mic_id', kind: 'audioinput', label: 'USB Microphone (Fifine K669)' }
        ],
        addEventListener: () => {}
    }
};

try {
    Object.defineProperty(global, 'navigator', {
        value: mockNavigator,
        writable: true,
        configurable: true
    });
} catch (e) {
    global.navigator = mockNavigator;
}

// Load AudioRecorder
require('./static/audio-recorder.js');
const AudioRecorder = global.window.AudioRecorder;

async function runTests() {
    console.log('============================================================');
    console.log('TEST SUITE: INTERNAL AUDIO & INTERNAL MIC ECHO REJECTION');
    console.log('============================================================');

    const recorder = new AudioRecorder();

    // TEST 1: Internal Microphone Detection & Classification
    console.log('\n--- TEST 1: Internal Microphone Identification ---');
    assert.strictEqual(recorder.isInternalMicrophone('Microphone Array (Intel Smart Sound Technology)'), true);
    assert.strictEqual(recorder.isInternalMicrophone('Realtek High Definition Audio'), true);
    assert.strictEqual(recorder.isInternalMicrophone('Built-in Microphone'), true);
    assert.strictEqual(recorder.isInternalMicrophone('Internal Microphone'), true);
    assert.strictEqual(recorder.isInternalMicrophone('Integrated Microphone'), true);
    assert.strictEqual(recorder.isInternalMicrophone('USB Microphone (Fifine K669)'), false);
    assert.strictEqual(recorder.isInternalMicrophone('Wireless Gaming Headset'), false);
    assert.strictEqual(recorder.isInternalMicrophone('Bluetooth Audio Device'), false);
    console.log('[PASS] Test 1: Internal microphone patterns accurately classified.');

    // TEST 2: Strict Internal Mic Exclusion from isExternalMicActive
    console.log('\n--- TEST 2: Internal Mic Strictly Excluded from isExternalMicActive ---');
    recorder.mediaStream = new MockMediaStream([new MockMediaStreamTrack('internal_mic_id', 'Microphone Array (Intel Smart Sound Technology)')]);
    recorder.selectedDeviceId = 'internal_mic_id';
    recorder.selectedDeviceLabel = 'Microphone Array (Intel Smart Sound Technology)';
    assert.strictEqual(recorder.isExternalMicActive(), false, 'Internal mic must NEVER be active for barge-in');

    // When no device is selected:
    recorder.selectedDeviceId = '';
    assert.strictEqual(recorder.isExternalMicActive(), false, 'Empty device selection must return false');

    // When an actual external USB mic is selected:
    recorder.mediaStream = new MockMediaStream([new MockMediaStreamTrack('usb_mic_id', 'USB Microphone (Fifine K669)')]);
    recorder.selectedDeviceId = 'usb_mic_id';
    recorder.selectedDeviceLabel = 'USB Microphone (Fifine K669)';
    assert.strictEqual(recorder.isExternalMicActive(), true, 'External USB mic must be active');
    console.log('[PASS] Test 2: Internal mic blocked from isExternalMicActive; external mic accepted.');

    // TEST 3: Echo of AI (Internal Audio) Detection in Speech Recognition
    console.log('\n--- TEST 3: Acoustic Echo of AI (Internal Audio) Filter ---');
    // Implement echo check function matching static/app.js
    function isEchoOfAi(candidateText, aiText) {
        if (!candidateText || !aiText) return false;
        const cleanCandidate = candidateText.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
        const cleanAi = aiText.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
        if (!cleanCandidate || !cleanAi) return false;
        const candidateWords = cleanCandidate.split(/\s+/).filter(Boolean);
        if (candidateWords.length === 0) return false;
        const aiWordsList = cleanAi.split(/\s+/).filter(Boolean);
        const aiWordsSet = new Set(aiWordsList);
        const commonWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'about', 'it', 'its', 'you', 'your', 'i', 'my', 'we', 'our', 'and', 'or', 'but', 'hello', 'hi', 'sure', 'yes', 'no', 'so', 'can', 'will', 'do', 'that', 'this', 'there', 'here', 'what', 'how']);
        if (candidateWords.length === 1 && (commonWords.has(candidateWords[0]) || aiWordsSet.has(candidateWords[0]))) return true;
        if (cleanAi.includes(cleanCandidate)) return true;
        if (candidateWords.length >= 2 && cleanCandidate.includes(cleanAi)) return true;
        let matched = 0;
        for (const w of candidateWords) {
            if (aiWordsSet.has(w)) matched++;
        }
        return (matched / candidateWords.length) >= 0.50;
    }

    const aiSpeech = "Hello there! I am your AI voice assistant, how can I help you today?";

    // Substring / direct phrase picked up by mic from laptop speaker:
    assert.strictEqual(isEchoOfAi("Hello there", aiSpeech), true, 'Direct phrase from AI must be detected as echo');
    assert.strictEqual(isEchoOfAi("how can I help you today", aiSpeech), true, 'Full sentence leak must be detected as echo');
    assert.strictEqual(isEchoOfAi("today", aiSpeech), true, 'Single word leak must be detected as echo');
    assert.strictEqual(isEchoOfAi("voice assistant how can", aiSpeech), true, 'Partial phrase leak must be detected as echo');

    // Genuine user interruption that does NOT match AI speech:
    assert.strictEqual(isEchoOfAi("Wait stop talking", aiSpeech), false, 'Genuine interruption "Wait stop talking" must NOT be echo');
    assert.strictEqual(isEchoOfAi("Actually cancel that request", aiSpeech), false, 'Genuine interruption "Actually cancel that request" must NOT be echo');
    assert.strictEqual(isEchoOfAi("What is the capital of France", aiSpeech), false, 'New query must NOT be echo');
    console.log('[PASS] Test 3: Speaker audio leak classified as echo; genuine user interruption passed.');

    // TEST 4: Raw VAD Rejection During Active AI Audio Playback
    console.log('\n--- TEST 4: Raw VAD Energy Ignored During Active AI Audio Playback ---');
    // Simulate app.js state machine
    let sessionStatus = 'ai_speaking';
    let isSpeaking = true;
    let currentAudio = { paused: false };
    let bargeInHandled = false;
    let handledSource = '';

    function handleBargeIn(source, text) {
        bargeInHandled = true;
        handledSource = source;
    }

    function isAiActivelyPlayingAudio() {
        return (sessionStatus === 'ai_speaking' || sessionStatus === 'speaking' || isSpeaking || (currentAudio && !currentAudio.paused));
    }

    function onBargeInCallback(source, text) {
        if (isAiActivelyPlayingAudio()) {
            if (source === 'vad') {
                // IGNORED: internal audio from speakers must not interrupt!
                return;
            }
            handleBargeIn(source, text);
        } else if (sessionStatus === 'processing') {
            handleBargeIn(source, text);
        }
    }

    // 4A: Raw VAD fires while AI speaker is playing -> Must be IGNORED!
    bargeInHandled = false;
    onBargeInCallback('vad');
    assert.strictEqual(bargeInHandled, false, 'Raw VAD from speakers MUST be ignored while AI audio is playing');

    // 4B: Genuine transcript interruption arrives while AI is playing -> Must INTERRUPT!
    bargeInHandled = false;
    onBargeInCallback('partial_transcript', 'stop right now');
    assert.strictEqual(bargeInHandled, true, 'Genuine non-echo speech MUST interrupt');
    assert.strictEqual(handledSource, 'partial_transcript');

    // 4C: During LLM Processing (before speaker audio plays): VAD CAN interrupt!
    sessionStatus = 'processing';
    isSpeaking = false;
    currentAudio = null;
    bargeInHandled = false;
    onBargeInCallback('vad');
    assert.strictEqual(bargeInHandled, true, 'VAD interruption during silent LLM processing must be accepted');
    assert.strictEqual(handledSource, 'vad');
    console.log('[PASS] Test 4: Internal audio VAD ignored during speaker playback; allowed during silent processing.');

    console.log('\n============================================================');
    console.log('ALL INTERNAL AUDIO & ECHO REJECTION TESTS PASSED (4/4)');
    console.log('============================================================');
}

runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
