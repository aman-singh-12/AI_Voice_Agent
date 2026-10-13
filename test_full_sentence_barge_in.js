/**
 * Unit Test: Full Sentence Barge-In Capture Verification
 * 
 * Verifies that when the user interrupts the AI with a new question:
 * 1. The complete sentence is recorded (e.g. "Wait what is the capital of France"),
 *    NOT just the trailing last word ("France").
 * 2. Multi-chunk recognition results are combined without dropping initial words.
 * 3. Fallback PCM audio buffers retain speech onset frames from frame 1 across the barge-in transition.
 */

const assert = require('assert');

// Mock browser globals
class MockMediaStreamTrack {
    constructor(deviceId, label = 'Mock Mic') {
        this._deviceId = deviceId;
        this.label = label;
        this.readyState = 'live';
    }
    getSettings() { return { deviceId: this._deviceId }; }
    stop() { this.readyState = 'ended'; }
}

class MockMediaStream {
    constructor(tracks = []) {
        this._tracks = tracks;
        this.active = true;
    }
    getAudioTracks() { return this._tracks; }
    getTracks() { return this._tracks; }
}

const mockDevices = [
    { deviceId: 'usb_mic_id', kind: 'audioinput', label: 'USB Microphone (Fifine K669)' }
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
        createMediaStreamSource() { return { connect: () => {}, disconnect: () => {} }; }
        createAnalyser() { return { fftSize: 256, connect: () => {} }; }
        createScriptProcessor() { return { onaudioprocess: null, connect: () => {}, disconnect: () => {} }; }
        resume() { return Promise.resolve(); }
        close() { this.state = 'closed'; return Promise.resolve(); }
    }
};

const mockNavigator = {
    mediaDevices: {
        enumerateDevices: async () => mockDevices,
        getUserMedia: async () => new MockMediaStream([new MockMediaStreamTrack('usb_mic_id', 'USB Microphone')]),
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
    console.log('TEST SUITE: FULL SENTENCE BARGE-IN CAPTURE VERIFICATION');
    console.log('============================================================\n');

    let recorder = new AudioRecorder();
    recorder.setSelectedDevice('usb_mic_id', 'USB Microphone (Fifine K669)');

    // -------------------------------------------------------------
    // TEST 1: Web Speech API Partial Transcript Mid-Utterance Interruption
    // -------------------------------------------------------------
    console.log('--- TEST 1: Full Sentence Capture Across Web Speech API Barge-In ---');
    
    // Simulate AI speaking
    recorder.setAiSpeaking(true);
    assert.strictEqual(recorder.isAiSpeaking, true, 'AI should be marked as speaking');

    let deliveredTranscript = '';
    recorder.onSpeechTranscript = (t) => {
        deliveredTranscript = t;
    };

    // User starts speaking: "Wait"
    let mockResults = [
        [{ transcript: 'Wait' }]
    ];
    mockResults[0].isFinal = false;

    // Simulate recorder.recognition.onresult firing with "Wait"
    let partialCalled = false;
    let partialText = '';
    recorder.onPartialTranscript = (text, meta) => {
        partialCalled = true;
        partialText = text;
    };

    let event1 = { results: mockResults };
    recorder.latestResultIndex = event1.results.length;
    let startIndex = Math.max(0, recorder.turnStartIndex || 0);
    let interim = '';
    for (let i = startIndex; i < event1.results.length; ++i) {
        interim += event1.results[i][0].transcript;
    }
    let currentText = interim.trim();
    if (recorder.isAiSpeaking) {
        recorder.onPartialTranscript(currentText, { isAiSpeaking: true });
    }

    assert.strictEqual(partialCalled, true, 'Partial transcript should be emitted');
    assert.strictEqual(partialText, 'Wait', 'Initial word should be Wait');

    // app.js handles barge-in: handleBargeInActive preserves buffers and does NOT advance turnStartIndex!
    recorder.handleBargeInActive('partial_transcript', partialText);
    assert.strictEqual(recorder.isAiSpeaking, false, 'AI speaking must be false after barge-in');
    assert.strictEqual(recorder.hasSpokenInTurn, true, 'User must be marked as actively speaking');

    // User continues speaking the rest of the question: "Wait what is the capital of France"
    mockResults[0][0].transcript = 'Wait what is the capital of France';
    mockResults[0].isFinal = true;

    // Subsequent onresult event
    let event2 = { results: mockResults };
    recorder.latestResultIndex = event2.results.length;
    startIndex = Math.max(0, recorder.turnStartIndex || 0);
    let fullFinal = '';
    interim = '';
    for (let i = startIndex; i < event2.results.length; ++i) {
        if (event2.results[i].isFinal) fullFinal += event2.results[i][0].transcript;
        else interim += event2.results[i][0].transcript;
    }
    currentText = (fullFinal.trim() + ' ' + interim.trim()).trim();
    if (recorder.bargeInPrefix && currentText && !currentText.toLowerCase().includes(recorder.bargeInPrefix.toLowerCase())) {
        currentText = `${recorder.bargeInPrefix} ${currentText}`.trim();
    }
    recorder.currentLiveTranscript = currentText;

    // User pauses, triggerTurn is executed
    recorder.triggerTurn();

    console.log(`Delivered transcript: "${deliveredTranscript}"`);
    assert.strictEqual(
        deliveredTranscript,
        'Wait what is the capital of France',
        'Delivered transcript must be the complete sentence, NOT just the last word!'
    );
    console.log('[PASS] Test 1: Complete sentence captured across mid-speech barge-in.\n');


    // -------------------------------------------------------------
    // TEST 2: Multi-Chunk Web Speech Results (First Word Finalized, Rest Interim)
    // -------------------------------------------------------------
    console.log('--- TEST 2: Multi-Chunk Split Sentence Capture ---');
    recorder = new AudioRecorder();
    recorder.setSelectedDevice('usb_mic_id', 'USB Microphone (Fifine K669)');
    recorder.setAiSpeaking(true);

    deliveredTranscript = '';
    recorder.onSpeechTranscript = (t) => { deliveredTranscript = t; };

    // Chunk 0: "Excuse me" (triggers barge-in)
    recorder.handleBargeInActive('partial_transcript', 'Excuse me');

    // Web Speech API creates a new item for chunk 1: "can you repeat the last point"
    let multiChunkResults = [
        [{ transcript: 'Excuse me' }],
        [{ transcript: 'can you repeat the last point' }]
    ];
    multiChunkResults[0].isFinal = true;
    multiChunkResults[1].isFinal = true;

    let eventMulti = { results: multiChunkResults };
    recorder.latestResultIndex = eventMulti.results.length;
    startIndex = Math.max(0, recorder.turnStartIndex || 0);
    fullFinal = '';
    for (let i = startIndex; i < eventMulti.results.length; ++i) {
        if (fullFinal && !fullFinal.endsWith(' ')) fullFinal += ' ';
        fullFinal += eventMulti.results[i][0].transcript;
    }
    currentText = fullFinal.trim();
    if (recorder.bargeInPrefix && currentText && !currentText.toLowerCase().includes(recorder.bargeInPrefix.toLowerCase())) {
        currentText = `${recorder.bargeInPrefix} ${currentText}`.trim();
    }
    recorder.currentLiveTranscript = currentText;

    recorder.triggerTurn();
    console.log(`Delivered transcript: "${deliveredTranscript}"`);
    assert.strictEqual(
        deliveredTranscript,
        'Excuse me can you repeat the last point',
        'All chunks across the barge-in boundary must be preserved in sequence'
    );
    console.log('[PASS] Test 2: Multi-chunk split sentence captured fully.\n');


    // -------------------------------------------------------------
    // TEST 3: Fallback PCM Audio Buffer (Onset Frames 1 to 5 Preserved)
    // -------------------------------------------------------------
    console.log('--- TEST 3: Fallback Audio Buffer Preserves Onset Frames ---');
    recorder = new AudioRecorder();
    recorder.setSelectedDevice('usb_mic_id', 'USB Microphone (Fifine K669)');
    recorder.setAiSpeaking(true);

    // Simulate onset frames 1 to 5 collected during barge-in detection
    const frame1 = new Float32Array([0.1, 0.2]);
    const frame2 = new Float32Array([0.2, 0.3]);
    const frame3 = new Float32Array([0.3, 0.4]);
    const frame4 = new Float32Array([0.4, 0.5]);
    const frame5 = new Float32Array([0.5, 0.6]);

    recorder.bargeInAudioBuffer = [frame1, frame2, frame3, frame4, frame5];
    // Barge in confirmed at frame 5
    recorder.audioData = [...recorder.bargeInAudioBuffer];
    recorder.handleBargeInActive('vad');

    // Speech continues: frames 6 to 8
    const frame6 = new Float32Array([0.6, 0.7]);
    const frame7 = new Float32Array([0.7, 0.8]);
    const frame8 = new Float32Array([0.8, 0.9]);
    recorder.audioData.push(frame6, frame7, frame8);

    assert.strictEqual(recorder.audioData.length, 8, 'Audio data must contain all 8 frames');
    assert.strictEqual(recorder.audioData[0], frame1, 'First frame must be preserved');
    assert.strictEqual(recorder.audioData[7], frame8, 'Last frame must be preserved');
    console.log('[PASS] Test 3: Audio buffers preserved from initial onset frame through end of turn.\n');

    console.log('============================================================');
    console.log('ALL FULL SENTENCE BARGE-IN CAPTURE TESTS PASSED (3/3)');
    console.log('============================================================');
}

runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
