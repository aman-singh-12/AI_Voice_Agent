/**
 * Unit Test: Vocal Frequency Band & Normal Speech Calibration
 * Verifies that:
 * 1. Sub-normal ambient sounds / small voices (RMS < 0.035) are neglected.
 * 2. Non-vocal frequencies (< 200Hz low hum, > 3400Hz clicks) are neglected.
 * 3. Normal conversational speech (200Hz-3400Hz, RMS >= 0.035) interrupts cleanly.
 */

const assert = require('assert');

// Mock localStorage
const store = {};
global.localStorage = {
  getItem: (k) => store[k] || null,
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};

// Mock AudioContext, AnalyserNode, MediaStreamTrack
class MockAnalyser {
  constructor() {
    this.frequencyBinCount = 1024;
    this.fftSize = 2048;
    this.sampleRate = 48000;
    this._freqData = new Uint8Array(1024);
  }
  setFrequencies(bins) {
    this._freqData.fill(0);
    for (const [idx, val] of Object.entries(bins)) {
      this._freqData[Number(idx)] = val;
    }
  }
  getByteFrequencyData(arr) {
    arr.set(this._freqData);
  }
}

global.AudioContext = class {
  constructor() {
    this.sampleRate = 48000;
  }
  createAnalyser() { return new MockAnalyser(); }
  createMediaStreamSource() { return { connect: () => {} }; }
};
global.window = global;
global.navigator = { mediaDevices: { enumerateDevices: async () => [] } };

require('./static/audio-recorder.js');
const AudioRecorder = global.window.AudioRecorder || (typeof module !== 'undefined' ? module.exports : null);

async function runTests() {
  console.log('============================================================');
  console.log('TEST SUITE: VOCAL FREQUENCY BAND & NORMAL SPEECH CALIBRATION');
  console.log('============================================================');

  const recorder = new AudioRecorder();
  recorder.analyser = new MockAnalyser();
  recorder.audioContext = { sampleRate: 48000 };
  recorder.setBargeInSensitivity('normal');

  // Verify normal voice threshold calibration
  assert.strictEqual(recorder.minNormalVoiceRms, 0.035, 'Normal sensitivity min voice RMS must be 0.035');
  assert.strictEqual(recorder.voiceBandMinHz, 200, 'Voice band min Hz must be 200');
  assert.strictEqual(recorder.voiceBandMaxHz, 3400, 'Voice band max Hz must be 3400');
  console.log('[PASS] Test 1: Configuration calibrated (200Hz-3400Hz vocal band, 0.035 RMS normal voice threshold).');

  // Test 2: Low-frequency rumble (< 200 Hz, e.g. bin 2 = ~47 Hz)
  // At 48000 Hz, bin width = 48000 / 2048 = 23.43 Hz per bin.
  // Bin 2 is ~46.8 Hz (< 200 Hz).
  // Total energy is in bin 2, 0 energy in voice band.
  recorder.analyser.setFrequencies({ 2: 180, 3: 160 });
  let isVocal = recorder.isVocalFrequencyPresent();
  assert.strictEqual(isVocal, false, 'Sub-200Hz low rumble must not be recognized as human speech');
  console.log('[PASS] Test 2: Low-frequency ambient rumble (< 200 Hz) successfully rejected.');

  // Test 3: High-frequency click (> 3400 Hz, e.g. bin 200 = 4687 Hz)
  recorder.analyser.setFrequencies({ 200: 200, 201: 220 });
  isVocal = recorder.isVocalFrequencyPresent();
  assert.strictEqual(isVocal, false, 'High-frequency clicks (> 3400Hz) must not be recognized as human speech');
  console.log('[PASS] Test 3: High-frequency clicks/clatter (> 3400 Hz) successfully rejected.');

  // Test 4: Small surrounding whisper/ambient voice (RMS = 0.022 < 0.035)
  // Even if voice frequencies are present, RMS is below normal speaking volume
  recorder.analyser.setFrequencies({ 20: 80, 30: 100, 40: 90 }); // Bins in ~400-1000 Hz band
  recorder.consecutiveBargeInFrames = 0;
  let interruptTriggered = false;
  recorder.onBargeInDetected = () => { interruptTriggered = true; };

  // Feed 10 frames of faint audio (RMS 0.022)
  for (let i = 0; i < 10; i++) {
    recorder.checkBargeIn(0.022, true);
  }
  assert.strictEqual(interruptTriggered, false, 'Faint audio (RMS 0.022 < 0.035) must be neglected');
  assert.strictEqual(recorder.consecutiveBargeInFrames, 0, 'Consecutive frames must reset for sub-normal audio');
  console.log('[PASS] Test 4: Below-normal ambient voice (RMS 0.022) neglected and does not interrupt.');

  // Test 5: Normal conversational voice (RMS = 0.055 >= 0.035 in 200-3400Hz band)
  interruptTriggered = false;
  for (let i = 0; i < 5; i++) {
    recorder.checkBargeIn(0.055, true);
  }
  assert.strictEqual(interruptTriggered, true, 'Normal speech (RMS 0.055 >= 0.035) must trigger interruption');
  console.log('[PASS] Test 5: Normal conversational speech (RMS 0.055) triggers interruption cleanly.');

  console.log('============================================================');
  console.log('ALL VOCAL BAND & NORMAL SPEECH CALIBRATION TESTS PASSED (5/5)');
  console.log('============================================================');
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
