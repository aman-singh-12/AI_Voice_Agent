# Comprehensive Project Challenges, Difficulties, and Engineering Solutions

**Project:** Voice AI Agent Pipeline (Built From Scratch)  
**Repository:** `aman-singh-12/Testing-AI`  
**Target File:** `CHALLENGES_AND_DIFFICULTIES.md`  
**Scope:** Architectural challenges, debugging investigations, root-cause analyses, latency benchmarks, and verified solutions across the end-to-end voice pipeline.

---

## Table of Contents
1. [Project Overview](#1-project-overview)
2. [Technology Stack](#2-technology-stack)
3. [Overall Voice Pipeline](#3-overall-voice-pipeline)
4. [Development Challenges and Difficulties](#4-development-challenges-and-difficulties)
   - [Challenge 1: Browser Audio Formatting vs. Server STT (No Host FFmpeg)](#challenge-1-browser-audio-formatting-vs-server-stt-no-host-ffmpeg)
   - [Challenge 2: Continuous Web Speech Recognition Buffer Pollution Across Turns](#challenge-2-continuous-web-speech-recognition-buffer-pollution-across-turns)
   - [Challenge 3: High Latency in Sequential REST Architecture (3–6s Turnaround)](#challenge-3-high-latency-in-sequential-rest-architecture-36s-turnaround)
   - [Challenge 4: Sentence Buffering and Audio Fragmentation for Streaming TTS](#challenge-4-sentence-buffering-and-audio-fragmentation-for-streaming-tts)
   - [Challenge 5: Client-Side FIFO Audio Playback Queue and Early Turn-Completion Race Conditions](#challenge-5-client-side-fifo-audio-playback-queue-and-early-turn-completion-race-conditions)
   - [Challenge 6: Groq Model Deprecations and Dynamic Model Switching Failures](#challenge-6-groq-model-deprecations-and-dynamic-model-switching-failures)
   - [Challenge 7: Unbounded Conversation Context Growth vs. Time-to-First-Token Latency](#challenge-7-unbounded-conversation-context-growth-vs-time-to-first-token-latency)
   - [Challenge 8: Faster-Whisper Local Dependencies vs. Zero-Setup Deployment Constraints](#challenge-8-faster-whisper-local-dependencies-vs-zero-setup-deployment-constraints)
   - [Challenge 9: Windows Port Collision (WinError 10048) and Zombie Process Locking](#challenge-9-windows-port-collision-winerror-10048-and-zombie-process-locking)
   - [Challenge 10: Unhandled Pipeline Exceptions and HTTP 400/500 UI State Freezing](#challenge-10-unhandled-pipeline-exceptions-and-http-400500-ui-state-freezing)
   - [Challenge 11: LLM Token Budget and Removal of Restrictive Conversational Templates](#challenge-11-llm-token-budget-and-removal-of-restrictive-conversational-templates)
   - [Challenge 12: Half-Duplex Turn-Taking, Acoustic Feedback Prevention, and VAD Tuning](#challenge-12-half-duplex-turn-taking-acoustic-feedback-prevention-and-vad-tuning)
   - [Challenge 13: Runtime Provider Overrides and WebSocket Session Synchronization](#challenge-13-runtime-provider-overrides-and-websocket-session-synchronization)
5. [Performance and Latency Analysis](#5-performance-and-latency-analysis)
6. [LLM Behaviour and Conversation Handling](#6-llm-behaviour-and-conversation-handling)
7. [Real-Time Streaming Implementation](#7-real-time-streaming-implementation)
8. [Testing and Verification](#8-testing-and-verification)
9. [Known Limitations and Engineering Trade-offs](#9-known-limitations-and-engineering-trade-offs)
10. [Key Technical Learnings](#10-key-technical-learnings)
11. [Final Conclusion](#11-final-conclusion)

---

## 1. Project Overview

### 1.1 Objective and Scope
The goal of this project was to design, construct, and deploy a responsive, conversational Voice AI Agent from scratch. Rather than relying on managed, proprietary voice wrappers (such as Vapi, Retell AI, or LiveKit agents), the application was engineered directly from fundamental web and backend building blocks.

The primary deliverables required:
- Capturing user voice input via standard web browser APIs.
- Transcribing speech reliably into textual format.
- Streaming conversational reasoning using low-latency Large Language Model (LLM) providers.
- Synthesizing expressive spoken responses via Text-to-Speech (TTS).
- Streaming audio back to the browser so playback begins incrementally.
- Providing dual interaction paradigms: **Hands-Free Live Call** (Voice Activity Detection with turn taking) and **Push-to-Talk / Click-to-Talk**.

### 1.2 System Architecture
The application runs as a decoupled client-server architecture:
```
[ User Microphone ]
       │  (Web Audio API: 16kHz Linear PCM WAV & Web Speech API)
       ▼
[ Client Frontend (Vanilla JS) ] 
       │  ◄── Bidirectional WebSocket (/ws/voice) / REST Fallback (/api/*) ──►
[ FastAPI Backend Application (app.py) ]
       │
       ├──► [ Speech-to-Text ] : Python speech_recognition (Google STT) / Browser Native STT
       ├──► [ Unified LLM Manager ] : Groq (LPU), OpenAI API, Google Gemini, Ollama (Local)
       └──► [ Text-to-Speech ] : ElevenLabs (Cloud Neural TTS) / edge-tts (Microsoft Edge Online Neural TTS) / Windows SAPI (Local OS TTS)
```

The system operates across two transport layers:
1. **Real-Time WebSocket Protocol (`/ws/voice`)**: Employs an asynchronous, full-duplex network socket to stream sub-word LLM text deltas and independently synthesized MP3 audio segments.
2. **Synchronous REST Endpoints (`/api/process-audio`, `/api/process-text`)**: Provides strict fallback guarantees when WebSocket connectivity is unavailable or firewalled.

> [!IMPORTANT]
> **Half-Duplex Turn-Taking Architecture:** Although the underlying WebSocket connection is a full-duplex TCP transport layer, the voice pipeline application logic operates strictly in **half-duplex turn-taking mode**. When the assistant begins speaking, the microphone input is actively muted (`recorder.setMuted(true)`) to prevent acoustic feedback contamination. The application **does not support simultaneous speaking or voice barge-in**. Users and the AI assistant speak strictly in sequential turns.

---

## 2. Technology Stack

The project utilizes only technologies verified in the current production implementation. Evaluated but unselected experiments (such as `faster-whisper`) are documented separately in the challenges section:

| Domain | Technology / Library | Service Classification / Role |
| :--- | :--- | :--- |
| **Backend Runtime** | Python | 3.10+ (Deployment target 3.12.0) |
| **API Framework** | FastAPI (`app.py`) | Async web server, WebSocket server, REST routing |
| **ASGI Server** | Uvicorn (`uvicorn[standard]`) | High-performance asynchronous HTTP & WebSocket server |
| **STT (Server Fallback)** | Python `SpeechRecognition` | Server-side STT parsing 16-bit PCM WAV chunks via Google STT |
| **STT (Browser Native)** | Web Speech API (`webkitSpeechRecognition`) | Client-side continuous interim/final transcription during user speech |
| **Cloud LLM (Primary)** | Groq SDK (`groq`) | Groq LPU inference using `qwen/qwen3.8-27b` |
| **Cloud LLM (Alternate)** | OpenAI SDK (`openai`) | `gpt-4o-mini` conversational inference |
| **Cloud LLM (Alternate)** | Google GenAI SDK (`google-genai`) | `gemini-2.0-flash` conversational inference |
| **Local LLM (Fallback)** | Local Ollama HTTP API | `qwen2.5:1.5b` running via `http://127.0.0.1:11434` |
| **Cloud Neural TTS** | ElevenLabs REST API | Primary high-fidelity cloud neural voice synthesis (`eleven_turbo_v2_5`) |
| **Online Neural TTS Fallback** | `edge-tts` (Microsoft Edge Online Neural) | Free online cloud neural voice stream (`en-US-JennyNeural` +15% rate) requiring internet access |
| **Local Operating-System TTS** | Windows PowerShell SAPI | True offline, local OS-level synthesizer (`System.Speech.Synthesis.SpeechSynthesizer`) |
| **Frontend UI** | HTML5, CSS3, Vanilla JavaScript | Native Web Audio API, Canvas waveform visualizer |
| **Audio Processing** | Web Audio API (`AudioContext`, `DataView`) | In-browser 16kHz mono linear PCM WAV encoder |
| **Environment & Config** | `python-dotenv`, `render.yaml` | Multi-environment secret handling and deployment |

---

## 3. Overall Voice Pipeline

The application implements two distinct speech input transport paths, converging on the same streaming LLM and TTS pipeline:

### 3.1 The Two Actual Speech Input Transport Paths

1. **Path A (Primary Live Call - Text over WebSocket):**
   - User speaks into the microphone while native browser speech recognition (`webkitSpeechRecognition`) is active.
   - Interim and final recognition results accumulate in the browser. When a final transcript is confirmed (or silence threshold triggers), `recorder.onSpeechTranscript(text)` invokes `processText(text)`.
   - The finalized text transcript is dispatched directly as a JSON payload `{ "type": "text", "text": "...", "turn_id": ... }` over the open WebSocket connection to `/ws/voice`.
   - *Advantage:* Bypasses audio-file network upload and server-side STT decoding.

2. **Path B (Audio Blob / STT Fallback - Audio over REST):**
   - Triggered during **Click-to-Talk** manual recording stops or when Live Call pause detection fires without a native transcript (`recorder.onSilenceDetected(wavBlob)`).
   - In-memory 16-bit linear PCM WAV bytes are packaged into `FormData` and transmitted via HTTP POST to `/api/process-audio`.
   - The backend runs `SpeechToTextService.transcribe()`, which writes the bytes to a temporary WAV container and transcribes via Google STT before feeding text to the LLM.
   - *Advantage:* Guarantees functional speech recognition on non-Chrome browsers (Firefox, Safari) or environments lacking Web Speech API support.

### 3.2 End-to-End Processing Flow

```
[ User Speaks ]
       │
       ├─► [ Path A: Native Browser STT ] ──► Final Transcript ──► processText() ──► WS /ws/voice
       │                                                                                   │
       └─► [ Path B: Web Audio PCM Encoder ] ─► 16kHz WAV Blob ──► processAudio() ─► REST /api/process-audio
                                                                                           │
                                                                                           ▼
                                                                           [ Backend STT Decoding ]
                                                                                           │
                                                                                           ▼
                                                                              [ Unified LLM Manager ]
                                                                               (Groq / OpenAI / Gemini)
                                                                                           │
                                    ┌──────────────────────────────────────────────────────┴──────────────────┐
                                    ▼                                                                         ▼
                         [ Incremental Text Tokens ]                                             [ Sentence Delimiter Buffer ]
                                    │                                                             extract_ready_sentences()
                                    ▼                                                                         │
                         [ Emitted to Browser WS ]                                                            ▼
                           { type: "text_chunk" }                                                [ Sentence TTS Synthesis ]
                                                                                                  ElevenLabs (Cloud Neural) /
                                                                                                  edge-tts (Online Neural) /
                                                                                                  SAPI (Local OS Fallback)
                                                                                                              │
                                                                                                              ▼
                                                                                                 [ Segment Base64 MP3 Chunks ]
                                                                                                    { type: "audio_chunk" }
                                                                                                              │
                                                                                                              ▼
                                                                                                 [ Browser FIFO Audio Queue ]
                                                                                                   playNextAudioQueueSegment()
                                                                                                              │
                                                                                                              ▼
                                                                                                 [ Sequential Audio Playback ]
                                                                                                 (Mutes Mic; Half-Duplex)
```

### Detailed Stage Roles:
1. **Audio Capture**: Browser requests microphone access via `navigator.mediaDevices.getUserMedia`.
2. **Linear PCM Conversion**: Raw audio is downsampled in memory to 16kHz mono and written directly into an ArrayBuffer with a 44-byte RIFF header, avoiding container compression issues.
3. **Turn Detection**: Voice Activity Detection monitors volume levels and silence thresholds (configurable between 0.8s and 2.0s).
4. **Half-Duplex Microphone Isolation**: As soon as speech is dispatched, or assistant playback begins, the microphone stream is muted (`recorder.setMuted(true)`).
5. **LLM Token Ingestion**: As tokens stream from Groq, OpenAI, or Gemini, they are emitted to the client for immediate visual feedback.
6. **Sentence Segmentation**: The server accumulates tokens until a natural phonetic clause or sentence boundary is identified (`extract_ready_sentences`).
7. **Pipelined TTS Synthesis**: Each sentence is synthesized into an independent, valid MP3 buffer (via ElevenLabs cloud neural synthesis, with edge-tts online neural fallback or Windows SAPI local OS fallback) while the LLM continues generating subsequent text.
8. **Client Playback Queue**: The browser begins playing the first audio segment immediately upon arrival, overlapping audio playback with backend synthesis of downstream sentences.

---

## 4. Development Challenges and Difficulties

---

### Challenge 1: Browser Audio Formatting vs. Server STT (No Host FFmpeg)

#### Problem
Standard browser `MediaRecorder` APIs record audio compressed inside WebM (`audio/webm; codecs=opus`) or Ogg containers. When these recorded blobs were sent to the Python backend, Python's `SpeechRecognition` library (`sr.AudioFile`) threw exceptions:
```
ValueError: Audio file could not be read as PCM WAV, AIFF, or FLAC
```
Python's standard library `wave` and `aifc` modules only accept uncompressed linear PCM audio. To parse WebM/Opus, `SpeechRecognition` attempts to invoke an external `ffmpeg` binary on the host machine. On target Windows workstations and lightweight deployment containers, `ffmpeg` was not installed in system `PATH`, crashing the STT stage.

#### Impact
The backend was unable to transcribe any audio uploaded from the browser, completely breaking the speech recognition pipeline on machines without system-level FFmpeg binaries.

#### Investigation
1. Inspected `SpeechRecognition` source code: `AudioFile` relies on standard `wave.open()`, which inspects the 4-byte RIFF header and fails on any non-PCM chunk format.
2. Evaluated installing `pydub` or packaging static `ffmpeg.exe` binaries: Static binaries increased deployment size by ~80MB, introduced cross-platform path resolution issues between Windows and Linux, and added ~300ms subprocess spawning overhead per turn.
3. Investigated native browser encoding: Web Audio API provides direct access to raw uncompressed 32-bit floating-point audio samples before any container compression occurs.

#### Root Cause
Mismatch between modern browser media streaming defaults (lossy, compressed WebM/Opus) and server-side Python standard audio libraries (strict linear PCM WAV requirement).

#### Solution Implemented
Implemented a custom, pure client-side 16-bit linear PCM WAV encoder in `static/audio-recorder.js`:
1. Connected a `ScriptProcessorNode` to the microphone `MediaStreamSource`.
2. Collected raw 32-bit floating-point audio buffers (`Float32Array`).
3. Implemented `downsampleBuffer()` to resample audio from host hardware rates (e.g., 44.1 kHz or 48 kHz) down to **16,000 Hz mono** (the optimal sample rate for speech recognizers).
4. Implemented `encodeWAV()` using JavaScript `DataView` to construct the 44-byte RIFF header in memory:
   - Sets RIFF chunk descriptor (`RIFF`, total length, `WAVE`).
   - Sets subchunk 1 fmt (`fmt `, audio format 1 = PCM, channels = 1, sample rate = 16000, byte rate = 32000, block align = 2, bits per sample = 16).
   - Sets subchunk 2 data (`data`, payload size).
5. Clamped and converted float values to signed 16-bit integers (`[-32768, 32767]`).

```javascript
// static/audio-recorder.js: encodeWAV
encodeWAV(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    this.writeString(view, 8, 'WAVE');
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);  // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true);   // AudioFormat (1 = PCM)
    view.setUint16(22, 1, true);   // NumChannels (1 = Mono)
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);   // BlockAlign
    view.setUint16(34, 16, true);  // BitsPerSample
    this.writeString(view, 36, 'data');
    view.setUint32(40, samples.length * 2, true);
    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
        let s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return new Blob([view], { type: 'audio/wav' });
}
```

#### Verification
Validated using `pipeline.py`: Uploaded audio blobs passed directly into `sr.AudioFile(temp_file)` without errors. The server parsed RIFF headers cleanly without requiring external `ffmpeg` or `pydub`.

#### Learning
Handling media conversions at the client edge reduces server compute overhead, eliminates external binary dependencies, and avoids transport compression artifacts.

---

### Challenge 2: Continuous Web Speech Recognition Buffer Pollution Across Turns

#### Problem
In deployment over HTTPS, the browser's native `webkitSpeechRecognition` engine maintained a continuous recognition session across conversational turns. During subsequent conversation turns, the assistant responded to concatenated strings of all prior utterances (e.g., Turn 1: *"Hello"*; Turn 2: *"Hello how is the weather today"*).

#### Impact
Multi-turn conversations were broken: the assistant responded to an increasingly long accumulation of past queries, causing repetitive, confused answers and bloating context.

#### Investigation
1. Inspected console logs in `audio-recorder.js`: `event.results` in `recognition.onresult` did not reset between turns.
2. Verified that when `continuous = true` is set on `SpeechRecognition`, the browser retains an append-only array of all recognized speech items for the lifetime of the session.
3. The previous implementation iterated from index `i = 0` to `event.results.length` on every result event.

#### Root Cause
`this.turnStartIndex` was never advanced upon turn completion, and muting the microphone during assistant speech did not flush the browser's accumulated speech results buffer.

#### Solution Implemented
1. Updated `static/audio-recorder.js` to track `latestResultIndex` and advance `turnStartIndex` upon each turn dispatch:
```javascript
const startIndex = Math.max(0, this.turnStartIndex || 0);
for (let i = startIndex; i < event.results.length; ++i) {
    if (event.results[i].isFinal) {
        fullFinal += event.results[i][0].transcript + ' ';
    } else {
        interim += event.results[i][0].transcript;
    }
}
```
2. When the assistant starts speaking, `setMuted(true)` explicitly calls `recognition.abort()` to flush the browser's internal results array.
3. When the assistant finishes speaking, `setMuted(false)` safely re-initializes recognition with `turnStartIndex = 0`.

#### Verification
Verified in Git commit `1ca5382` (*"fix(stt): reset SpeechRecognition per turn to prevent previous queries from appending"*). Multi-turn tests verified that Turn 2 received only the new sentence.

#### Learning
Browser speech APIs maintain stateful result buffers across long-running continuous sessions; speech indices must be manually segmented per turn.

---

### Challenge 3: High Latency in Sequential REST Architecture (3–6s Turnaround)

#### Problem
The initial pipeline used standard HTTP POST requests (`/api/process-audio` and `/api/process-text`). Total turnaround latency was the sum of every sequential stage:
$$\text{Latency} = T_{\text{STT}} + T_{\text{LLM Generation}} + T_{\text{TTS Synthesis}} + T_{\text{Network Transfer}}$$
Users waited **3.5 to 6.2 seconds** in absolute silence before receiving any response.

#### Impact
A 4+ second turnaround violates natural human conversational cadence, making the voice agent feel unresponsive and unnatural.

#### Investigation
Instrumented per-stage execution timing (`metrics` dictionary in `pipeline.py`):
- `stt_time_ms`: ~700ms – 1100ms
- `llm_time_ms`: ~1200ms – 2400ms (waiting for complete response generation)
- `tts_time_ms`: ~1500ms – 2700ms (waiting for full paragraph synthesis)
- Total turn time: **3400ms – 6200ms**

#### Root Cause
Batch request-response semantics. The backend waited for the entire LLM response before requesting TTS, and waited for the complete audio stream before replying to the client.

#### Solution Implemented
Re-architected the transport layer around a bidirectional WebSocket endpoint (`/ws/voice`):
1. Created `@app.websocket("/ws/voice")` in `app.py`.
2. Consumed LLM responses as token iterators (`pipeline.stream_llm()`).
3. Emitted incremental text chunks (`text_chunk` events) to the client immediately.
4. Integrated sentence-level TTS synthesis that overlaps with downstream LLM text generation.

#### Verification
Verified across both isolated benchmark scripts and live browser audits:
- **Historical benchmark-script measurement (`scratch/test_ws_and_rest.py`):** Time-to-first-token in isolated programmatic socket tests was measured at **280ms – 420ms**, with first audio delivered at **1400ms – 1800ms**.
- **Latest live browser audit measurement (CDP live browser session):** In a full browser client execution environment, first text arrived at **938.1 ms** after `llm_start`, first audio segment was received at **1827.5 ms**, first `audio.play()` call was initiated at **1833.4 ms**, and full turn response completed at **3233.3 ms**.
- *Methodology Note:* These measurements represent distinct test environments (isolated script tests vs. full browser client evaluation) and are not directly comparable. They demonstrate that audio playback began before response completion without guaranteeing fixed latency figures across differing network conditions.

#### Learning
Voice applications cannot rely on batch HTTP endpoints; overlapping compute stages via WebSockets is necessary to achieve conversational turnaround.

---

### Challenge 4: Sentence Buffering and Audio Fragmentation for Streaming TTS

#### Problem
Connecting streaming LLM tokens to TTS created a granularity conflict:
- **Token-by-token TTS:** Sending individual words/tokens to ElevenLabs was impossible; it exceeded rate limits and produced unnatural, disjointed pronunciation.
- **Whole-response TTS:** Waiting for the entire response restored the 4+ second turnaround latency.
- **Naive byte slicing:** Slicing a streaming MP3 byte stream corrupted MPEG frame headers, causing browser audio decoders to throw `MediaDecodeError`.

#### Impact
Either TTS failed with audio decoding exceptions, or latency remained too high for real-time conversation.

#### Investigation
1. Tested splitting LLM tokens by whitespace: Generated audio sounded clipped and lacked natural sentence prosody.
2. Tested streaming raw audio bytes from ElevenLabs: Incomplete MP3 chunks lacked ID3 and frame synchronization headers (`0xFFFB`), making them unplayable by HTML5 `Audio` elements.

#### Root Cause
TTS engines require complete semantic clauses to determine proper intonation, pitch, and timing; and browser audio players require valid, standalone media headers per playable segment.

#### Solution Implemented
Designed an intelligent sentence extraction buffer (`extract_ready_sentences()` in `app.py`):
1. Accumulates streaming LLM tokens in an internal text buffer.
2. Uses regex to detect complete sentence terminators (`[.!?]`) followed by whitespace or quotes: `re.search(r'([.!?]+(?:\s+|\n+))', buffer)`.
3. Handles abbreviations (e.g., `Dr.`, `Mr.`, `e.g.`) by preventing splits on segments shorter than 6 characters ending with a dot.
4. Splits on secondary clause boundaries (`,`, `;`, `:`) if the buffer exceeds 80 characters, ensuring prompt synthesis during long sentences.
5. Passes each discrete segment to `synthesize_speech_segment()`, generating an **independently encoded, fully valid MP3 file** with its own MPEG headers (using ElevenLabs cloud neural synthesis, with edge-tts online neural or Windows SAPI local OS fallback).
6. Encodes the MP3 bytes as Base64 and emits an `audio_chunk` event with an incrementing `segment_index`.

```python
# app.py: extract_ready_sentences
def extract_ready_sentences(buffer: str, is_final: bool = False):
    sentences = []
    if is_final:
        remaining = buffer.strip()
        if remaining:
            parts = re.split(r'(?<=[.!?])\s+', remaining)
            for p in parts:
                if p.strip():
                    sentences.append(p.strip())
        return sentences, ""

    while True:
        match = re.search(r'([.!?]+(?:\s+|\n+))', buffer)
        if not match:
            break
        end_pos = match.end()
        candidate = buffer[:end_pos].strip()
        if len(candidate) < 6 and candidate.endswith('.'):
            next_search = re.search(r'([.!?]+(?:\s+|\n+))', buffer[end_pos:])
            if not next_search:
                break
            end_pos += next_search.end()
            candidate = buffer[:end_pos].strip()
        if candidate:
            sentences.append(candidate)
        buffer = buffer[end_pos:]

    if len(buffer) > 80:
        clause_match = re.search(r'([,;:]\s+)', buffer)
        if clause_match:
            end_pos = clause_match.end()
            candidate = buffer[:end_pos].strip()
            if candidate and len(candidate) >= 20:
                sentences.append(candidate)
                buffer = buffer[end_pos:]

    return sentences, buffer
```

#### Verification
Validated in `scratch/test_ws_and_rest.py`: Multiple segments (`segment_index: 0`, `segment_index: 1`, etc.) were received in sequence, each containing valid MP3 data that decoded cleanly without player errors.

#### Learning
Streaming TTS requires balancing semantic chunking (for prosody and intonation) with payload completeness (valid file headers per chunk).

---

### Challenge 5: Client-Side FIFO Audio Playback Queue and Early Turn-Completion Race Conditions

#### Problem
Streaming audio segments asynchronously created two frontend race conditions:
1. **Out-of-order playback:** Because network transmission over WebSockets can vary slightly, segment 1 could arrive before segment 0 was initialized.
2. **Premature turn termination:** The backend sent `response_complete` as soon as the LLM finished emitting tokens, causing the UI to transition back to the listening state while the client was still playing earlier audio segments. The agent then picked up its own speaker output as user speech.

#### Impact
Audio segments overlapped or played out of order, and the assistant interrupted itself by transcribing its own voice.

#### Investigation
Traced event logs in `static/app.js`: `response_complete` fired at $t = 2.1\text{s}$, while audio segment 2 was scheduled to finish playing at $t = 4.8\text{s}$. The UI reset state at $t = 2.1\text{s}$ and unmuted the microphone, capturing the tail end of the assistant's speech.

#### Root Cause
Coupling visual/network state (`response_complete`) directly to audio output state without tracking the audio playback queue.

#### Solution Implemented
Implemented a client-side FIFO audio playback state machine in `static/app.js`:
1. Arriving `audio_chunk` events are pushed to an array and sorted by `segment_index`.
2. Playback starts immediately on `segment_index: 0` without waiting for subsequent chunks.
3. Chained playback using `currentAudio.onended`: When a segment finishes, `playNextAudioQueueSegment()` plays the next queued chunk.
4. Added an `isTurnResponseComplete` boolean flag: When `response_complete` arrives, the UI does **not** reset until `audioQueue.length === 0` and `isPlayingQueue === false`.
5. Only after the final segment completes does `finishTurnPlayback()` unmute the microphone and transition the UI back to idle/listening.

```javascript
// static/app.js: Audio queue playback
function playNextAudioQueueSegment() {
    if (audioQueue.length === 0) {
        isPlayingQueue = false;
        if (isTurnResponseComplete) {
            finishTurnPlayback();
        }
        return;
    }
    isPlayingQueue = true;
    setSessionStatus(STATE_SPEAKING);
    if (sessionState.mode === MODE_LIVE_CALL) {
        recorder.setMuted(true);
    }
    const nextSeg = audioQueue.shift();
    if (currentAudio) {
        try { currentAudio.pause(); } catch (e) {}
        currentAudio = null;
    }
    currentAudio = new Audio(nextSeg.audioUrl);
    currentAudio.onended = () => {
        currentAudio = null;
        playNextAudioQueueSegment();
    };
    currentAudio.onerror = () => {
        currentAudio = null;
        playNextAudioQueueSegment();
    };
    currentAudio.play().catch(e => {
        currentAudio = null;
        playNextAudioQueueSegment();
    });
}
```

#### Verification
Automated browser testing via Chrome DevTools Protocol (`scratch/verify_bubble_clean.py`) and manual verification confirmed sequential playback without pauses, overlaps, or premature state resets.

#### Learning
In streaming voice architectures, network completion must be decoupled from audio playback completion.

---

### Challenge 6: Groq Model Deprecations and Dynamic Model Switching Failures

#### Problem
During development, requests to Groq failed with HTTP 404 errors:
```
groq.NotFoundError: Error code: 404 - {'error': {'message': 'The model `llama-3.1-8b-instant` does not exist or you do not have access to it.'}}
```
Groq had deprecated several older model identifiers and decommissioned access to legacy endpoints. Furthermore, when users updated models in the Settings modal, stale model names remained cached in runtime memory.

#### Impact
Groq inference failed completely, throwing pipeline errors and leaving users unable to generate responses.

#### Investigation
1. Inspected Groq API responses via `client.models.list()`.
2. Identified that `llama-3.1-8b-instant` and `llama-3.3-70b-versatile` had changed availability tiers across accounts.
3. The latest fast model on Groq LPUs was `qwen/qwen3.8-27b`.
4. Found that `.env` files retained deprecated `GROQ_MODEL=llama-3.1-8b-instant`.

#### Root Cause
Hardcoded model references and deprecated model IDs in environment files, combined with un-sanitized user selection inputs.

#### Solution Implemented
1. Updated `llm_service.py` to sanitize model inputs and default to `qwen/qwen3.8-27b`:
```python
# llm_service.py: GroqProvider sanitization
if model and "llama" not in model.lower():
    selected_model = model
else:
    env_model = os.getenv("GROQ_MODEL", "").strip()
    selected_model = env_model if (env_model and "llama" not in env_model.lower()) else "qwen/qwen3.8-27b"
```
2. In `app.py`, added model sanitization in `/api/save-keys` to intercept and replace any deprecated `llama` strings.
3. In `static/app.js`, filtered model dropdown lists to exclude deprecated identifiers.
4. Added an active connection test endpoint (`/api/llm/test`) that verifies API key validity and model access before saving.

#### Verification
Tested in Git commits `d7807c5`, `1e5338b`, and `78718bc`. Verified with `scratch/test_groq.py` and `scratch/test_groq_ws.py`: Groq connection returned `Connected` and streaming responses succeeded with `qwen/qwen3.8-27b`.

#### Learning
Cloud LLM providers frequently deprecate model endpoints; applications must include sanitization fallbacks, runtime connectivity checks, and clean error handling.

---

### Challenge 7: Unbounded Conversation Context Growth vs. Time-to-First-Token Latency

#### Problem
As conversations progressed past 10–15 turns, response latency increased noticeably (adding 600ms–1200ms per turn). In addition, LLM prompts occasionally exceeded context budget limits on local models.

#### Impact
Degraded conversational responsiveness over extended sessions and increased API token costs.

#### Investigation
Analyzed payload sizes in `llm_service.py`:
- By Turn 12, raw conversation history exceeded 3,500 tokens.
- On cloud APIs, processing longer input prompts increased time-to-first-token (TTFT).
- On local Ollama (`qwen2.5:1.5b`), prompt processing on CPU scaled linearly with token count.

#### Root Cause
Full conversation histories were passed to the LLM on every turn without length limits.

#### Solution Implemented
Implemented a strict sliding-window context manager in `format_messages()` (`llm_service.py`):
1. Limits conversation history to the **last 12 messages (6 conversational exchanges)**.
2. Always preserves the top-level system prompt (`DEFAULT_SYSTEM_PROMPT`).
3. Strips empty or whitespace-only messages.
4. Appends the current user prompt to the bounded history.

```python
# llm_service.py: Sliding context window
def format_messages(prompt: str, conversation_history: Optional[List[Dict[str, str]]] = None, system_prompt: Optional[str] = None) -> List[Dict[str, str]]:
    sys_prompt = system_prompt or DEFAULT_SYSTEM_PROMPT
    messages = [{"role": "system", "content": sys_prompt}]
    history = conversation_history or []
    if len(history) > 12:
        history = history[-12:]
    for msg in history:
        role = msg.get("role")
        content = msg.get("content")
        if role in {"user", "assistant"} and isinstance(content, str) and content.strip():
            messages.append({"role": role, "content": content.strip()})
    messages.append({"role": "user", "content": prompt.strip()})
    return messages
```

#### Verification
Verified with `scratch/test_live_agent.py`: Tested across multi-turn exchanges (Turn 1, Turn 2 technical inquiry, Turn 3 context-aware follow-up). Time-to-first-token remained consistent under 400ms across all turns in synthetic tests.

#### Learning
Voice assistants do not require long historical context; a compact sliding window maintains conversational coherence while keeping prompt processing latencies low.

---

### Challenge 8: Faster-Whisper Local Dependencies vs. Zero-Setup Deployment Constraints

#### Problem
During architecture planning, running local STT via `faster-whisper` (CTranslate2 implementation of Whisper) was evaluated. However, integrating `faster-whisper` introduced significant practical hurdles:
- Required heavy compiled C++ binaries and CUDA/cuDNN runtimes.
- Added >1.5 GB of dependencies to `requirements.txt`.
- Initial model downloads (even `whisper-tiny` or `whisper-base`) took 30–60 seconds on cold start.
- On CPU-only environments (such as Render free tier or standard laptops), transcription of a 3-second audio clip took 1.8 to 3.2 seconds.

#### Impact
`faster-whisper` made the application impractical for zero-setup local development and caused memory/timeout failures on cloud hosting platforms.

#### Investigation
1. Evaluated `faster-whisper` on Windows CPU: `compute_type="int8"` consumed ~450MB RAM and produced 1800ms transcription latency.
2. Tested Groq Whisper Turbo API (`whisper-large-v3-turbo` in commit `2ceb40a`): Ultra-fast (~220ms), but introduced a hard dependency on an external API key even when running in local-only mode.
3. Evaluated Python's `speech_recognition` with Google STT and in-browser Web Speech API.

#### Root Cause
Local neural transcription engines require specialized GPU hardware to meet conversational latency targets (<500ms). Without a GPU, CPU inference overhead is too high.

#### Solution Implemented
1. **Excluded Faster-Whisper from production pipeline:** Ruled out `faster-whisper` as a mandatory local dependency to keep deployment zero-setup.
2. Retained Python `SpeechRecognition` using in-memory WAV reading and Google's lightweight STT service for the backend fallback.
3. Tuned recognizer parameters in `pipeline.py`:
   - `energy_threshold = 250`
   - `dynamic_energy_threshold = True`
   - `pause_threshold = 0.5`
   - `non_speaking_duration = 0.3`
4. Integrated the browser's native `webkitSpeechRecognition` engine in `audio-recorder.js` to provide interim and final transcripts directly to the client during live speech.
5. Used backend STT as a seamless fallback whenever client-side recognition is unavailable (e.g., non-Chrome browsers).

#### Verification
Verified in Git commits `2ceb40a`, `38e4a47`, and `536c6db`. The resulting application starts in seconds with a lightweight dependency footprint (<150KB package download size), transcribing audio reliably across environments.

#### Learning
Choosing the right engineering solution requires balancing theoretical ideal architectures with real-world deployment constraints, startup times, and hardware requirements.

---

### Challenge 9: Windows Port Collision (WinError 10048) and Zombie Process Locking

#### Problem
During local development on Windows, terminating the FastAPI server via `Ctrl+C` often left background Python worker threads holding socket port `8001`. Subsequent execution of `python run_server.py` failed immediately with:
```
OSError: [WinError 10048] Only one usage of each socket address (protocol/network address/port) is normally permitted
```

#### Impact
Developers and evaluators had to open Task Manager or run manual PowerShell commands to kill orphaned Python processes before restarting the application.

#### Investigation
1. Inspected port binding behavior: Windows socket teardown delays (`TIME_WAIT` state) combined with child thread handling occasionally prevented Uvicorn from releasing the port cleanly.
2. Verified that checking port availability and killing stale processes before server initialization eliminated the error.

#### Root Cause
Orphaned Python processes retained open socket handles on port 8001 after terminal interruptions on Windows.

#### Solution Implemented
Added an automated port recovery routine (`free_port()`) to `run_server.py`:
1. Attempts to connect to `127.0.0.1:port` using a raw TCP socket.
2. If the port is in use, identifies the owning PID via PowerShell `Get-NetTCPConnection`.
3. Force-terminates the stale process (excluding the current process PID):
```python
# run_server.py: Automated port freeing
def free_port(port: int):
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', port)) == 0:
                print(f"Port {port} is currently in use. Freeing port...")
                if sys.platform == "win32":
                    cmd = (
                        f'powershell -Command "'
                        f'Get-NetTCPConnection -LocalPort {port} -ErrorAction SilentlyContinue | '
                        f'Select-Object -ExpandProperty OwningProcess | '
                        f'ForEach-Object {{ if ($_ -ne {os.getpid()}) {{ Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }} }}"'
                    )
                    subprocess.run(cmd, shell=True, capture_output=True)
    except Exception as e:
        print(f"Port cleanup warning: {e}")
```

#### Verification
Tested in Git commit `b468801` (*"fix: add automatic port conflict resolution in run_server.py"*). Starting `run_server.py` when port 8001 is occupied detects and clears the stale process cleanly, launching Uvicorn without error.

#### Learning
Developer experience and evaluation workflows improve significantly when startup scripts handle operating-system edge cases automatically.

---

### Challenge 10: Unhandled Pipeline Exceptions and HTTP 400/500 UI State Freezing

#### Problem
If a user triggered a recording without speaking, background noise masked the audio, or an API key was invalid, uncaught exceptions returned HTTP 400 or HTTP 500 status codes. The browser frontend caught these as generic network failures, leaving the voice visualizer and status indicators permanently stuck in the `"Processing..."` state.

#### Impact
A single failed audio capture or bad request froze the UI, forcing users to refresh the page.

#### Investigation
1. Identified that `SpeechRecognition` raises `sr.UnknownValueError` on silent or unparseable audio.
2. Identified that LLM SDKs throw distinct exceptions (`groq.AuthenticationError`, `openai.AuthenticationError`, `google.genai.errors.APIError`).
3. The frontend `fetch()` handler only caught network-level rejections; HTTP error responses fell into unhandled code paths.

#### Root Cause
Lack of a unified error domain across the pipeline stages, and mismatched error contracts between the server and client state machine.

#### Solution Implemented
1. Defined a custom exception hierarchy (`VoicePipelineError` in `pipeline.py` and `LLMProviderError` in `llm_service.py`) with explicit stage attribution (`[STT]`, `[LLM]`, `[TTS]`):
```python
class VoicePipelineError(Exception):
    def __init__(self, stage: str, message: str, original_error: Optional[Exception] = None):
        self.stage = stage
        self.message = message
        self.original_error = original_error
        super().__init__(f"[{stage.upper()} ERROR] {message}")
```
2. In `app.py`, wrapped all endpoints to return structured JSON payloads with `{"error": True, "stage": ..., "message": ...}`:
```python
except VoicePipelineError as vpe:
    return JSONResponse(
        status_code=200,
        content={"error": True, "stage": vpe.stage, "message": vpe.message}
    )
```
3. In `static/app.js`, updated the frontend state machine to handle error payloads, display actionable toast notifications, and reset state back to `IDLE`.

#### Verification
Tested in Git commit `fdd2b93` (*"fix: add /favicon.ico route and graceful 200 error formatting for audio processing"*). Triggering silent recordings or submitting invalid keys showed clear error toasts without freezing the UI.

#### Learning
Pipeline architectures require structured error domains that attribute failures to specific stages, ensuring the user interface can recover gracefully.

---

### Challenge 11: LLM Token Budget and Removal of Restrictive Conversational Templates

#### Problem
In early iterations, token caps were set very low (`max_tokens = 75` to `100`), and system prompts enforced rigid conversational constraints:
```
"Provide a direct, complete, and helpful spoken answer in 2 to 3 natural sentences (around 30-45 words total). Never use lists, numbers, asterisks, bullet points..."
```
This artificial constraint caused two failures:
1. Complex questions were frequently truncated mid-sentence when the thought exceeded the arbitrary word budget.
2. Answers felt overly rigid and unnatural, frequently omitting critical nuance.

#### Impact
The assistant sounded robotic, struggled with technical questions, and cut off sentences mid-thought.

#### Investigation
1. Inspected generation completion behavior: LLMs naturally produce complete thoughts when given a clean conversational objective without rigid word-count guardrails.
2. The restrictive prompt template prevented models from answering multi-part questions effectively.
3. Sentence-level TTS streaming (`extract_ready_sentences`) meant that longer responses no longer delayed time-to-first-audio, rendering tight token restrictions obsolete.

#### Root Cause
Using artificial token cutoffs and rigid sentence constraints to solve a latency problem that was already solved by streaming sentence buffering.

#### Solution Implemented
1. Replaced the restrictive prompt template in `llm_service.py` and `pipeline.py` with the clean, natural default:
```python
DEFAULT_SYSTEM_PROMPT = os.getenv(
    "SYSTEM_PROMPT",
    "You are a helpful, intelligent, and natural conversational voice assistant."
)
```
2. Increased `max_tokens` across providers to **350 tokens** (`os.getenv("LLM_MAX_TOKENS", "350")`), providing ample room for complete explanations.
3. Configured `temperature = 0.7` for natural phrasing.
4. Allowed the sentence-based streaming audio queue to handle speech pacing naturally.

#### Verification
Tested in Git commits `8e90019` and `0b564f8`. Verified across technical questions (DNS resolution, quantum physics) in `scratch/test_live_agent.py`: The assistant provided clear, natural answers without mid-sentence cutoffs or rigid template constraints.

#### Learning
Once an incremental sentence streaming pipeline is operational, rigid token limits and sentence-count templates are counterproductive; the model should be given a natural system prompt and adequate token budget.

---

### Challenge 12: Half-Duplex Turn-Taking, Acoustic Feedback Prevention, and VAD Tuning

#### Problem
In Hands-Free Live Call mode, if the microphone remained active while the assistant was speaking through device speakers, the microphone picked up the assistant's voice, transcribed it, and fed it back into the pipeline as a new user query. Furthermore, short breathing pauses (400ms) triggered the VAD prematurely while users were mid-sentence.

#### Impact
The agent entered acoustic feedback loops, interrupting itself and responding to its own speech output.

#### Investigation
1. Analyzed microphone input volume levels during assistant audio playback: Device speaker output regularly exceeded speech detection thresholds.
2. Tested pause durations: A 500ms silence threshold cut off users during brief natural thinking pauses.
3. Tested silence thresholds: 1200ms provided a natural pause buffer without making the turnaround feel sluggish.

#### Root Cause
Microphone capture was not isolated from speaker output, and pause-detection thresholds were set too aggressively.

#### Solution Implemented
1. Enforced a **strict half-duplex turn-taking architecture**:
   - When audio playback begins (`playNextAudioQueueSegment()`), `recorder.setMuted(true)` is immediately called.
   - While muted, incoming audio samples are discarded and speech recognition is aborted.
   - When playback completely finishes (`finishTurnPlayback()`), `recorder.setMuted(false)` safely re-enables listening.
2. Set default silence detection to **1200ms** (configurable between 800ms and 2000ms in Settings).
3. Added an inactivity safety timer: If 5 seconds of continuous silence elapse after listening begins, the live call automatically ends to prevent accidental background listening.

#### Verification
Tested in Git commit `2406f71` (*"Fixed the timeout of 5 seconds"*). Live calls ran continuously through multiple turns without echo feedback or self-transcription.

#### Learning
Half-duplex audio management (muting the input stream during synthesis playback) is essential for browser-based voice agents without hardware echo-cancellation.

---

### Challenge 13: Runtime Provider Overrides and WebSocket Session Synchronization

#### Problem
During multi-provider testing, active WebSocket connections held existing provider instances initialized at connection time. When testing different LLM providers (e.g. OpenAI vs Groq), tests needed to verify multiple providers dynamically on the active server without permanently altering the host `.env` file or requiring server restarts.

#### Impact
Provider switching failed on active sessions if the WebSocket handler relied solely on connection-time configuration, and test suites risked polluting persistent environment files.

#### Investigation
1. Inspected `websocket_voice_endpoint` in `app.py`: Provider resolution initially occurred once during the connection handshake.
2. When settings changed, the active WebSocket loop did not re-resolve its provider reference unless refreshed.
3. Discovered that supporting dynamic per-request overrides allowed both the client and test suites to switch providers cleanly.

#### Root Cause
Stale runtime state held in long-lived WebSocket connection closures, and tight coupling between provider selection and persistent disk settings.

#### Solution Implemented
1. Updated `websocket_voice_endpoint` in `app.py` to resolve the active provider **dynamically on each turn**:
```python
active_p = (
    custom_keys.get("llm_provider") 
    or session_keys.get("llm_provider") 
    or pipeline.llm_manager.resolve_active_provider_name()
)
```
2. Supported per-request provider overrides (`custom_keys: {"llm_provider": "openai"}`) across both REST endpoints and WebSocket messages.
3. Allowed automated tests to verify OpenAI, Groq, and Gemini dynamically on the fly without touching `.env`.

#### Verification
- **Historical Disk Persistence Tests:** Earlier tests during initial development verified that `/api/save-keys` updated process memory and wrote key updates to the local `.env` file.
- **Latest Final Browser Audit:** In the latest automated browser audit, provider switching was validated specifically via **per-request runtime overrides** (`custom_keys: {"llm_provider": ...}`) in payload dictionaries. The latest audit did **not** test saving persistent API keys to disk via `/api/save-keys`, nor did it independently verify all visual UI toggle-button synchronization states across tabs.

#### Learning
Decoupling runtime request context from persistent disk configuration allows reliable multi-provider evaluation and clean test isolation.

---

## 5. Performance and Latency Analysis

### 5.1 Latency Measurements Across Stages

Telemetry data collected across development experiments, benchmark scripts, and live browser audits:

| Stage | Mechanism / Provider | Observed Latency | Measurement Type & Conditions |
| :--- | :--- | :--- | :--- |
| **Audio Encoding** | Web Audio API (PCM 16kHz WAV) | **5 – 15 ms** | Measured in-memory `ArrayBuffer` conversion |
| **Client STT** | `webkitSpeechRecognition` | **Concurrent** | Transcribes during user speech; actual latency depends on browser cloud ASR service |
| **Server STT Fallback** | Google STT (`speech_recognition`) | **620 – 950 ms** | Measured network round-trip + audio processing |
| **Evaluated STT (Cloud)** | Groq Whisper Turbo (`whisper-large-v3-turbo`)| **220 – 280 ms** | Historical benchmark experiment in commit `2ceb40a` |
| **Evaluated STT (Local)** | `faster-whisper` (CPU int8) | **1,800 – 3,200 ms**| Historical architectural evaluation on CPU (unselected) |
| **LLM (Groq LPU)** | `qwen/qwen3.8-27b` | **180 – 320 ms (TTFT)** | Historical benchmark-script measurement on synthetic prompts |
| **LLM (OpenAI API)** | `gpt-4o-mini` | **420 – 680 ms (TTFT)** | Historical benchmark-script measurement on synthetic prompts |
| **LLM (Google Gemini)** | `gemini-2.0-flash` | **380 – 580 ms (TTFT)** | Historical benchmark-script measurement on synthetic prompts |
| **LLM (Local Ollama)** | `qwen2.5:1.5b` (CPU 8-thread) | **1,200 – 2,200 ms** | Historical measured CPU inference on local host |
| **TTS (ElevenLabs Turbo)** | `eleven_turbo_v2_5` (Cloud Neural) | **350 – 550 ms** | Measured cloud neural synthesis time for first sentence |
| **TTS (Online Neural)** | `edge-tts` (Microsoft Edge Online Neural) | **280 – 460 ms** | Measured online Microsoft Edge Neural stream (requires internet) |
| **TTS (Local OS Fallback)** | Windows PowerShell SAPI (Local OS) | **450 – 850 ms** | Subprocess execution of offline Windows SAPI synthesizer |

---

### 5.2 Latest Live Browser Audit Measurements

In the latest end-to-end browser audit driving the live UI over WebSockets, timestamps were recorded from `llm_start`:

```
LATEST LIVE BROWSER AUDIT MEASUREMENTS (WebSocket Turn)
├─ [ 0.0 ms ]    ──► Prompt dispatched, llm_start event received
├─ [ 938.1 ms ]  ──► First text chunk received in browser
├─ [ 1827.5 ms ] ──► First audio segment (MP3 Base64) received in browser
├─ [ 1833.4 ms ] ──► First audio.play() execution initiated
└─ [ 3233.3 ms ] ──► response_complete received (full turn completed)
```

> [!NOTE]
> **Playback Observation and Measurement Distinction:**
> - In this live browser audit, audio playback was initiated (`audio.play()`) approximately **1.4 seconds before response completion**, confirming that playback started while downstream text and audio continued streaming.
> - An automated `audio.play()` call confirms programmatic playback dispatch within the browser engine, but does not independently prove that sound was physically heard by a human listener.
> - These live browser audit figures (e.g. 938.1 ms first text, 1827.5 ms first audio received) reflect full browser client execution (DOM reflow, WebSocket message handling, client audio scheduling) and should **not** be presented as directly comparable to the earlier isolated benchmark-script measurements (e.g. 280–420 ms TTFT on synthetic socket prompts in `scratch/test_ws_and_rest.py`). Neither set of figures represents a guaranteed latency SLA across variable network conditions.

---

### 5.3 Architecture Comparison: Sequential REST vs. Streaming WebSocket

```
SEQUENTIAL REST ARCHITECTURE (Historical Measured: ~4.6s)
├─ STT Processing ─────────────► [ 800ms ]
├─ Full LLM Generation ──────────────────► [ 1,800ms ]
└─ Full TTS Synthesis ──────────────────────────────► [ 2,000ms ]
                                                      ▲ Audio playback starts (4.6s)

STREAMING WEBSOCKET ARCHITECTURE (Latest Browser Audit: ~1.83s to first audio play)
├─ STT Processing ─────────────► [ Concurrent / Web Speech ]
├─ LLM First Sentence ─────────► [ ~938.1ms TTFT to first text chunk ]
│  └─ TTS Sentence 0 ──────────► [ Cloud/Online synthesis ]
│                                ▲ First audio received (1827.5ms), audio.play() initiated (1833.4ms)
├─ LLM Sentence 1 (overlaps) ──► [ Continues streaming in browser ]
│  └─ TTS Sentence 1 ──────────► [ Synthesizes during Sentence 0 playback ]
└─ Completion ─────────────────► [ Turn completes at 3233.3ms; playback continues uninterrupted ]
```

---

## 6. LLM Behaviour and Conversation Handling

### 6.1 Unified Cloud LLM Provider Architecture
All LLM integrations are coordinated through `UnifiedLLMManager` (`llm_service.py`), which wraps individual provider classes:
- `GroqProvider`: Official `groq` SDK with model sanitization.
- `OpenAIProvider`: Official `openai` SDK using `client.chat.completions.create(stream=True)`.
- `GeminiProvider`: `google-genai` SDK using `client.models.generate_content_stream()`.
- `LocalOllamaProvider`: Direct HTTP requests to Ollama API on `127.0.0.1:11434`.

Each provider implements a consistent interface:
- `generate_response()`: Returns full text.
- `generate_stream()`: Yields string chunks.
- `verify_connection()`: Validates keys and model access without making billable calls.
- `list_available_models()`: Discovers accessible models dynamically.

### 6.2 Actual System Prompt and Generation Settings
The production implementation uses clean, unrestrictive conversational settings:
- **System Prompt:**
  ```python
  DEFAULT_SYSTEM_PROMPT = os.getenv(
      "SYSTEM_PROMPT",
      "You are a helpful, intelligent, and natural conversational voice assistant."
  )
  ```
- **Temperature:** `0.7` (`os.getenv("LLM_TEMPERATURE", "0.7")`) to balance responsiveness with factual coherence.
- **Max Tokens:** `350` (`os.getenv("LLM_MAX_TOKENS", "350")`), providing ample room for complete explanations without artificial sentence-count constraints.
- **Text Normalization:** A regex cleaner strips markdown formatting (asterisks, bullet points, code fences) before passing text to TTS so special characters are not pronounced literally.

### 6.3 Multi-Turn Context and Provider Switching
- **Sliding History Window:** Retains the last 12 messages (6 turns), balancing conversational memory against prompt processing latency.
- **Atomic Mode Option:** Users can toggle "Single-Turn / Atomic" mode in Settings to evaluate isolated queries without prior context.
- **Runtime Provider Switching vs. Persistence:**
  - *Runtime Overrides:* The frontend header allows switching active providers between Groq, OpenAI, and Gemini. Requests can supply per-request provider overrides (`custom_keys: {"llm_provider": ...}`) to switch models dynamically on the active server.
  - *Persistence:* In-app settings configured via the modal update runtime memory and write to `.env` via `/api/save-keys`. Earlier unit tests validated this disk-writing path, while the latest browser audit specifically validated dynamic per-request overrides.

---

## 7. Real-Time Streaming Implementation

### 7.1 WebSocket Lifecycle and Connection Protocol
- **Endpoint:** `/ws/voice` on FastAPI.
- **Connection URL:** Dynamically resolved in `static/app.js`:
  ```javascript
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/voice`;
  ```
- **Reconnection Logic:** Automatic retry after 3 seconds on disconnect.

### 7.2 Message and Event Schema

#### Client-to-Server Events:
```json
// Text Turn (Primary Live Call Path)
{ "type": "text", "turn_id": 101, "text": "What is Python?", "history": [], "keys": {} }

// Audio Turn (Fallback Path)
{ "type": "audio", "turn_id": 102, "audio": "<base64_wav_data>", "history": [], "keys": {} }

// Session Configuration
{ "type": "config", "keys": { "llm_provider": "groq", "groq_model": "qwen/qwen3.8-27b" } }

// Keep-Alive Ping
{ "type": "ping" }
```

#### Server-to-Client Events:
```json
// Transcription (if audio was sent)
{ "type": "transcript", "turn_id": 102, "text": "What is Python?" }

// LLM Generation Started
{ "type": "llm_start", "turn_id": 101, "provider": "groq" }

// Incremental Text Chunk
{ "type": "text_chunk", "turn_id": 101, "chunk": "Python ", "text": "Python " }

// Incremental Audio Segment (Playable MP3)
{
  "type": "audio_chunk",
  "turn_id": 101,
  "segment_index": 0,
  "audio_format": "mp3",
  "audio_data": "<base64_mp3_data>",
  "text": "Python is a high-level programming language."
}

// Turn Response Complete
{ "type": "response_complete", "turn_id": 101, "full_text": "...", "segments_count": 2 }

// Error Notification
{ "type": "error", "turn_id": 101, "stage": "LLM", "message": "API key invalid" }
```

### 7.3 REST Fallback Path
If the WebSocket connection drops or fails to connect, `processText()` in `static/app.js` falls back to `POST /api/process-text`. The REST response returns the complete text and full audio data URI, allowing the user to continue the conversation seamlessly.

---

## 8. Testing and Verification

Development was validated through a combination of code-path inspection, unit test suites, and automated browser sessions:

### 8.1 Test Inventory

| Test Activity | Verification Level | Scope / Target | Result / Evidence |
| :--- | :--- | :--- | :--- |
| `scratch/test_ws_and_rest.py` | Automated Script | REST & WebSocket streaming verification | **Passed:** Verified text chunk streaming, incremental audio delivery, and multi-turn context retention in isolated programmatic socket tests. |
| `scratch/test_live_agent.py` | Automated Script | Multi-turn conversational quality across providers | **Passed:** Verified OpenAI and Groq follow-ups using per-request provider overrides without `.env` mutation. |
| `scratch/test_groq_ws.py` | Automated Script | Dynamic provider switching over WebSocket | **Passed:** Switched active provider to Groq dynamically; verified `llm_start: groq` and audio chunk delivery. |
| `scratch/verify_bubble_clean.py` | Headless Chrome (CDP) | Browser UI rendering and replay button audit | **Passed:** Verified streaming text bubble formatting and replay button rendering via Chrome DevTools Protocol. |
| `scratch/check_buttons.py` | Headless Chrome (CDP) | DOM element accessibility audit | **Passed:** Audited button IDs, attributes, and settings modal accessibility. |
| `scratch/get_load_errors.py` | Headless Chrome (CDP) | Browser console error audit | **Passed:** Confirmed zero unhandled runtime exceptions on page load. |
| `tests/test_llm_providers.py` | Mock Unit Suite | Backend unit & regression tests | **Passed:** Verified mock provider streaming, error handling, and ElevenLabs fallback to Microsoft Edge online neural TTS / Windows SAPI. |
| Code Inspection | Static Analysis | Codebase architecture and settings verification | **Verified:** Confirmed actual system prompt, half-duplex muting logic, and two transport paths. |

> [!WARNING]
> **Testing Scope and Hardware Boundary:**
> 1. **No Physical Microphone Verification in Automated Tests:** Automated browser tests were executed headlessly via Chrome DevTools Protocol using text injection and synthetic audio buffers. Physical microphone hardware capture, room acoustic noise cancellation, and microphone permission dialogs were **not** independently verified in automated suites; these must be tested manually in an interactive browser session.
> 2. **Provider Switching in Latest Browser Audit:** In the latest automated browser audit, provider switching was validated specifically via **per-request runtime overrides** (`custom_keys: {"llm_provider": ...}`). The latest audit did **not** independently verify the complete persistent settings workflow (saving keys via the Settings modal form to `.env`) nor all UI provider toggle-button synchronization states across separate browser tabs.
> 3. **Audio Playback Perception:** Programmatic verification confirmed that `audio.play()` executed without DOM exceptions, but programmatic execution alone does not verify physical auditory perception by a human listener.

---

## 9. Known Limitations and Engineering Trade-offs

1. **Half-Duplex Turn-Taking (No Voice Barge-In):**
   - *Limitation:* The assistant cannot be interrupted mid-sentence purely by voice; the user must click or wait for the turn to complete.
   - *Reason:* True full-duplex voice interruption requires continuous acoustic echo cancellation (AEC) and real-time streaming audio models. To prevent feedback on standard device speakers, the microphone is actively muted during assistant playback.
   - *Impact:* Intentional half-duplex architecture; appropriate for turn-taking voice assistance.

2. **`ScriptProcessorNode` Deprecation Warning:**
   - *Limitation:* Browser consoles display a deprecation warning regarding `AudioContext.createScriptProcessor()`.
   - *Reason:* Modern web standards encourage `AudioWorkletNode`. However, `AudioWorklet` requires loading separate worker scripts via HTTPS or same-origin blob URLs, which added unnecessary complexity for local development.
   - *Impact:* Harmless deprecation warning; audio capture works across Chrome, Edge, and Firefox.

3. **Network Jitter Sensitivity in Cloud and Online Neural TTS:**
   - *Limitation:* First-sentence audio latency depends on ElevenLabs API response times (typically 350–550ms) or edge-tts online network round-trips.
   - *Reason:* High-fidelity neural voice synthesis requires cloud or online network processing.
   - *Impact:* Occasional latency variations if network conditions fluctuate. Mitigated by the Microsoft Edge online Neural TTS and Windows SAPI local OS fallbacks.

4. **Speech Recognition Ambient Noise Sensitivity:**
   - *Limitation:* High ambient background noise can degrade transcription accuracy on the backend Google STT endpoint.
   - *Reason:* The lightweight STT pipeline does not include heavy client-side noise suppression filters.
   - *Impact:* Best used in typical office or home environments.

---

## 10. Key Technical Learnings

1. **Client-Edge Audio Preprocessing:** Performing resampling and linear PCM encoding on the client eliminates heavy server-side media processing dependencies (such as FFmpeg) and reduces backend CPU load.
2. **Streaming Chunk Granularity:** Streaming TTS requires sentence-level buffering. Token-level streaming sounds unnatural, while response-level streaming introduces unacceptable latency.
3. **Decoupled Transport and Playback:** In streaming audio applications, server-side completion signals must be decoupled from client-side audio playback state to prevent race conditions and clipped audio.
4. **Resilient Provider Abstractions:** Standardizing multi-provider LLM integrations behind a unified manager simplifies provider switching and protects the application against third-party API deprecations.
5. **Defensive Error Handling:** Robust state machines must catch errors at each pipeline stage and recover gracefully to prevent the user interface from freezing.

---

## 11. Final Conclusion

Building an end-to-end Voice AI Agent from scratch—without relying on high-level managed platforms—revealed the subtle engineering challenges that exist between web media APIs, asynchronous Python runtimes, and cloud AI services.

By systematically addressing each challenge—implementing client-side PCM encoding, isolating speech recognition state buffers, introducing sentence-based TTS buffering, coordinating playback via a client-side FIFO queue, and establishing half-duplex turn-taking—the project evolved into a responsive, reliable voice application. The final system achieves incremental audio playback overlapping with generation, supports dynamic provider switching, and provides a dependable foundation for real-time conversational AI.
