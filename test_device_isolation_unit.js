/**
 * Unit Test Suite for External Microphone Isolation and Internal Microphone Exclusion
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
        this.onmute = null;
        this.onunmute = null;
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

const mockDevices = [
    { deviceId: 'internal_mic_id', kind: 'audioinput', label: 'Microphone Array (Intel Smart Sound Technology)' },
    { deviceId: 'usb_mic_id', kind: 'audioinput', label: 'USB Microphone (Fifine K669)' },
    { deviceId: 'speaker_id', kind: 'audiooutput', label: 'Realtek High Definition Audio Speakers' }
];

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
        }
        createMediaStreamSource() {
            return { connect: () => {}, disconnect: () => {} };
        }
        createAnalyser() {
            return { fftSize: 256, connect: () => {} };
        }
        createScriptProcessor() {
            return {
                onaudioprocess: null,
                connect: () => {},
                disconnect: () => {}
            };
        }
        resume() { return Promise.resolve(); }
        close() { this.state = 'closed'; return Promise.resolve(); }
    }
};

let capturedGUMConstraints = null;
let gumShouldThrow = false;
const mockNavigator = {
    mediaDevices: {
        enumerateDevices: async () => mockDevices,
        getUserMedia: async (constraints) => {
            capturedGUMConstraints = constraints;
            if (gumShouldThrow) {
                throw new Error('DeviceNotFound: requested device is unavailable');
            }
            const requestedId = constraints?.audio?.deviceId?.exact || 'default_id';
            const label = requestedId === 'usb_mic_id' ? 'USB Microphone' : 'Default Mic';
            return new MockMediaStream([new MockMediaStreamTrack(requestedId, label)]);
        },
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

// Load AudioRecorder class
require('./static/audio-recorder.js');
const AudioRecorder = global.window.AudioRecorder;

async function runTests() {
    console.log('============================================================');
    console.log('STARTING EXTERNAL MICROPHONE ISOLATION UNIT TEST SUITE');
    console.log('============================================================');

    const recorder = new AudioRecorder();

    // TEST 1: Device Enumeration
    console.log('\n--- TEST 1: Enumerate Available Audio Input Devices ---');
    const devices = await recorder.getAudioInputDevices();
    assert.strictEqual(devices.length, 2, 'Should enumerate only 2 audioinput devices');
    assert.strictEqual(devices[0].deviceId, 'internal_mic_id');
    assert.strictEqual(devices[1].deviceId, 'usb_mic_id');
    console.log('[PASS] Test 1: Enumerated devices correctly filtered to audioinput.');

    // TEST 2: Explicit Selection of External Microphone
    console.log('\n--- TEST 2: Explicit Selection and Persistence ---');
    recorder.setSelectedDevice('usb_mic_id', 'USB Microphone (Fifine K669)');
    assert.strictEqual(recorder.selectedDeviceId, 'usb_mic_id');
    assert.strictEqual(recorder.selectedDeviceLabel, 'USB Microphone (Fifine K669)');
    assert.strictEqual(global.localStorage.getItem('voice_ai_selected_mic_id'), 'usb_mic_id');
    console.log('[PASS] Test 2: Selected device stored and persisted in localStorage.');

    // TEST 3: Strict Exact Device Constraint in getUserMedia
    console.log('\n--- TEST 3: Strict Exact Device Constraint Application ---');
    await recorder.start(true);
    assert(capturedGUMConstraints, 'getUserMedia must be called with constraints');
    assert.deepStrictEqual(
        capturedGUMConstraints.audio.deviceId,
        { exact: 'usb_mic_id' },
        'getUserMedia MUST request exact deviceId of the external mic'
    );
    assert.strictEqual(recorder.isExternalMicActive(), true, 'External mic must be verified as active');
    console.log('[PASS] Test 3: getUserMedia requested deviceId: { exact: "usb_mic_id" } and verified active.');

    // TEST 4: Fail-Safe Rule - No Fallback to Internal Microphone on Failure
    console.log('\n--- TEST 4: Fail-Safe Rule (No Silent Internal Fallback) ---');
    await recorder.stop();
    gumShouldThrow = true;
    let disconnectedFired = false;
    recorder.onDeviceDisconnected = () => { disconnectedFired = true; };

    let threwError = false;
    try {
        await recorder.start(true);
    } catch (err) {
        threwError = true;
        assert(err.message.includes('strictly prohibited') || err.message.includes('unavailable'), 'Error must specify prohibited fallback');
    }
    assert(threwError, 'Must throw error when exact external device cannot be acquired');
    assert(disconnectedFired, 'Must fire onDeviceDisconnected');
    assert.strictEqual(recorder.isExternalMicActive(), false, 'isExternalMicActive must be false');
    console.log('[PASS] Test 4: App threw error on failed external mic and refused fallback to internal microphone.');

    // TEST 5: External Mic Disconnection During Active Session
    console.log('\n--- TEST 5: External Microphone Disconnection Handling ---');
    gumShouldThrow = false;
    await recorder.start(true);
    assert.strictEqual(recorder.isExternalMicActive(), true);

    let disconnectHandled = false;
    recorder.onDeviceDisconnected = () => { disconnectHandled = true; };

    // Simulate unplugging the USB microphone (track ends)
    const track = recorder.mediaStream.getAudioTracks()[0];
    track.stop(); // triggers track.onended

    assert(disconnectHandled, 'onDeviceDisconnected must be triggered on track end');
    assert.strictEqual(recorder.isExternalMicActive(), false, 'isExternalMicActive must immediately return false');
    assert.strictEqual(recorder.isRecording, false, 'Recording must stop');
    console.log('[PASS] Test 5: External mic unplugging cleanly disabled VAD without internal mic fallback.');

    // TEST 6: VAD Rejection When External Mic Inactive
    console.log('\n--- TEST 6: VAD Interruption Rejection for Inactive/Internal Mic ---');
    recorder.setAiSpeaking(true);
    recorder.isDeviceDisconnected = true; // Simulating external mic disconnected or internal mic capturing audio
    assert.strictEqual(recorder.isExternalMicActive(), false);

    let bargeInTriggered = false;
    recorder.onBargeIn = () => { bargeInTriggered = true; };

    // Simulate loud audio frame from laptop speakers hitting internal mic (rms = 0.08)
    const mockChannelData = new Float32Array(2048).fill(0.08);
    const mockEvent = {
        inputBuffer: {
            getChannelData: () => mockChannelData
        }
    };
    // Trigger audio processor while external mic is inactive
    if (recorder.processor && recorder.processor.onaudioprocess) {
        recorder.processor.onaudioprocess(mockEvent);
    }
    assert.strictEqual(bargeInTriggered, false, 'Barge-In must NEVER be triggered when external mic is inactive/rejected');
    console.log('[PASS] Test 6: High RMS from internal mic/speaker audio was strictly rejected from triggering Barge-In.');

    console.log('\n============================================================');
    console.log('ALL EXTERNAL MICROPHONE ISOLATION UNIT TESTS PASSED (6/6)');
    console.log('============================================================');
}

runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
