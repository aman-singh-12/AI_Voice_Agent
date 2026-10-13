/**
 * Unit Test Suite: Barge-In Speech Interruption Sensitivity Calibration
 * Tests that speech interruption is calibrated to the exact same audio input level as initial speech
 */
const assert = require('assert');

// Mock browser globals for Node.js unit testing environment
class MockMediaStreamTrack {
    constructor(deviceId, label = 'Mock Mic', readyState = 'live') {
        this._deviceId = deviceId;
        this.label = label;
        this.readyState = readyState;
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
    getTracks() {
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

const mockTrack = new MockMediaStreamTrack('usb_mic_id', 'USB Microphone');
const mockStream = new MockMediaStream([mockTrack]);

const mockNavigator = {
    mediaDevices: {
        getUserMedia: async () => mockStream,
        enumerateDevices: async () => [
            { deviceId: 'usb_mic_id', kind: 'audioinput', label: 'USB Microphone' }
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
    console.log('TEST SUITE: BARGE-IN INTERRUPT SENSITIVITY CALIBRATION');
    console.log('============================================================');

    const recorder = new AudioRecorder();
    recorder.setSelectedDevice('usb_mic_id', 'USB Microphone');
    await recorder.start(true);

    // TEST 1: Default Sensitivity matches Initial Audio Input Level
    console.log('\n--- TEST 1: Default Sensitivity Matches Initial Level ---');
    assert.strictEqual(recorder.bargeInSensitivity, 'normal', 'Default sensitivity must be normal');
    assert.strictEqual(recorder.bargeInThreshold, recorder.baseThreshold, 'Barge-in threshold must equal baseThreshold (0.015)');
    assert.strictEqual(recorder.bargeInThreshold, 0.015, 'Barge-in threshold must be 0.015');
    assert.strictEqual(recorder.minBargeInFrames, 5, 'minBargeInFrames must be 5 (~230ms, matching 250ms initial speech)');
    console.log(`[PASS] Test 1: Barge-in threshold=${recorder.bargeInThreshold} equals baseThreshold=${recorder.baseThreshold}, minFrames=${recorder.minBargeInFrames}`);

    // Helper to simulate audio frames
    function sendAudioFrame(rmsValue) {
        const samples = new Float32Array(2048).fill(rmsValue);
        recorder.processor.onaudioprocess({
            inputBuffer: {
                getChannelData: () => samples
            }
        });
    }

    // TEST 2: Transient Noise Spikes (< 5 frames) Do NOT Trigger Interruption
    console.log('\n--- TEST 2: Transient Noise Spikes (< 200ms) Rejected ---');
    recorder.setAiSpeaking(true);
    recorder.aiSpeakingStartTime = Date.now() - 200; // Past anti-echo settle window
    let bargeInFired = false;
    recorder.onBargeIn = () => { bargeInFired = true; };

    // Simulate 3 loud transient frames (e.g. cough, breath, mouse click = ~138ms)
    // Dynamic threshold = Math.max(0.015, 0.008 * 2.2) = 0.0176
    for (let i = 0; i < 3; i++) {
        sendAudioFrame(0.04); // Above threshold
    }
    assert.strictEqual(bargeInFired, false, '3 frames (< 200ms) must NOT trigger barge-in');
    assert.strictEqual(recorder.consecutiveBargeInFrames, 3, 'Consecutive frames counted correctly');

    // Return to silence (< threshold) -> resets consecutive frames
    sendAudioFrame(0.005);
    assert.strictEqual(recorder.consecutiveBargeInFrames, 0, 'Silence must reset consecutive frames');
    assert.strictEqual(bargeInFired, false, 'Barge-in still not fired');
    console.log('[PASS] Test 2: Transient impulse (< 200ms) successfully rejected without interrupting AI.');

    // TEST 3: Sustained Speech (5 frames) Triggers Interruption
    console.log('\n--- TEST 3: Sustained Speech (5 frames / ~230ms) Confirms Interruption ---');
    recorder.setAiSpeaking(true);
    recorder.aiSpeakingStartTime = Date.now() - 200;
    bargeInFired = false;
    for (let i = 0; i < 5; i++) {
        sendAudioFrame(0.04);
    }
    assert.strictEqual(bargeInFired, true, '5 sustained frames must confirm barge-in');
    assert.strictEqual(recorder.isAiSpeaking, false, 'isAiSpeaking should be cleared');
    console.log('[PASS] Test 3: Sustained speech confirmed barge-in at exact initial audio level.');

    // TEST 4: AI Processing State Isolation
    console.log('\n--- TEST 4: AI Processing State Sustained Speech Protection ---');
    recorder.setAiSpeaking(false);
    recorder.setAiProcessing(true);
    bargeInFired = false;

    // Send 2 frames during processing
    for (let i = 0; i < 2; i++) {
        sendAudioFrame(0.04);
    }
    assert.strictEqual(bargeInFired, false, '2 frames during processing must not interrupt');

    // Send remaining 3 frames (total 5)
    for (let i = 0; i < 3; i++) {
        sendAudioFrame(0.04);
    }
    assert.strictEqual(bargeInFired, true, '5 frames during processing confirms interruption');
    assert.strictEqual(recorder.isAiProcessing, false, 'isAiProcessing cleared');
    console.log('[PASS] Test 4: AI processing state requires sustained speech before interruption.');

    // TEST 5: Sensitivity Calibration Controls (Firm & Sensitive)
    console.log('\n--- TEST 5: Sensitivity Modes (Firm & Sensitive) ---');
    recorder.setBargeInSensitivity('firm');
    assert.strictEqual(recorder.bargeInSensitivity, 'firm');
    assert.strictEqual(recorder.bargeInThreshold, 0.015 * 1.5, 'Firm threshold = 0.0225');
    assert.strictEqual(recorder.minBargeInFrames, 7, 'Firm requires 7 frames (~320ms)');
    assert.strictEqual(global.localStorage.getItem('voice_ai_bargein_sensitivity'), 'firm');

    recorder.setBargeInSensitivity('sensitive');
    assert.strictEqual(recorder.bargeInSensitivity, 'sensitive');
    assert.strictEqual(recorder.bargeInThreshold, 0.015 * 0.85, 'Sensitive threshold = 0.01275');
    assert.strictEqual(recorder.minBargeInFrames, 3, 'Sensitive requires 3 frames (~140ms)');
    assert.strictEqual(global.localStorage.getItem('voice_ai_bargein_sensitivity'), 'sensitive');

    recorder.setBargeInSensitivity('normal');
    assert.strictEqual(recorder.bargeInSensitivity, 'normal');
    assert.strictEqual(recorder.bargeInThreshold, 0.015);
    assert.strictEqual(recorder.minBargeInFrames, 5);
    console.log('[PASS] Test 5: Sensitivity settings and localStorage persistence verified.');

    console.log('\n============================================================');
    console.log('ALL BARGE-IN SENSITIVITY CALIBRATION TESTS PASSED (5/5)');
    console.log('============================================================');
}

runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
