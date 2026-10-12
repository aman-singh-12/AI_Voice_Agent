# Product Requirements Document (PRD)

**Project Name:** Voice AI Agent Pipeline  
**Version:** 1.1.0  
**Status:** Implemented & Verified  
**Document Owner:** Engineering Architecture  
**Last Updated:** October 2026  

---

## 1. Project Overview

### 1.1 Problem Statement
Building conversational voice AI interfaces often forces developers into monolithic, third-party proprietary voice platforms (such as Vapi, Retell, or Bland AI). While convenient, these platforms obscure underlying audio pipelines, enforce restrictive vendor lock-in, add substantial platform markups, and prevent low-level optimizations between Speech-to-Text (STT), Large Language Model (LLM) reasoning, and Text-to-Speech (TTS) synthesis.

Conversely, attempting to build a custom voice pipeline from scratch often results in high perceived turnaround latency (4 to 8 seconds per conversational turn). Without streaming architectures and concurrent pipelining, waiting for full transcription, full LLM completion, and complete audio synthesis makes spoken interaction unnatural and frustrating.

### 1.2 Purpose of the Application
The **Voice AI Agent Pipeline** is an end-to-end, modular voice assistant built entirely from first principles without monolithic third-party agent frameworks. It runs directly inside a standard web browser, captures user voice input, performs real-time speech recognition, generates contextual responses using cloud or local LLMs, synthesizes neural human speech, and streams audio back into the browser in under 2 seconds.

### 1.3 Target Users
1. **End Users / Web Visitors:** Individuals seeking natural, hands-free conversational voice assistance through a web interface.
2. **Developers & Technical Evaluators:** Engineers assessing low-latency voice pipeline architectures, streaming WebSockets, audio buffer manipulation, and multi-provider AI integrations.
3. **Internal Product Teams:** Teams requiring a reference architecture for voice-enabled applications with transparent infrastructure costs and flexible provider swapping.

### 1.4 Core Value Proposition
- **Zero Third-Party Agent Lock-In:** Pure orchestration of raw foundation APIs (Groq, OpenAI, Google Gemini, ElevenLabs, Web Speech API).
- **Sub-2-Second Perceived Turnaround:** Concurrent sentence boundary extraction and FIFO audio segment queueing allow playback to begin while the LLM is still generating subsequent tokens.
- **Dual Processing Paths:** High-speed real-time WebSocket communication paired with an automated REST audio fallback.
- **Provider & Model Resilience:** Dynamic runtime switching across Groq, OpenAI, and Gemini with automated multi-tier TTS fallback to Microsoft `edge-tts` and offline Windows SAPI.

---

## 2. Objectives

The system fulfills the following core objectives:

| Objective | Target Requirement | Implementation Outcome |
| :--- | :--- | :--- |
| **Browser-Based Interaction** | Zero client installation or browser extensions required. | Operates in standard Chromium browsers via HTML5 Web Audio and Web Speech APIs. |
| **Low-Latency Speech Recognition** | Near-instant transcription upon user completion. | In-browser `webkitSpeechRecognition` processes audio concurrently during speech (<50ms perceived dispatch). |
| **Streaming LLM Generation** | Immediate token delivery to the client interface. | Async token streaming via `stream=True` over WebSockets with Groq TTFT <300ms. |
| **Pipelined Speech Synthesis** | Overlap speech generation with LLM token production. | Sentence-boundary buffer extracts clauses and triggers ElevenLabs Turbo synthesis concurrently. |
| **Turn-Taking Natural Conversation** | Fluid conversational cadence without self-triggering loops. | Dynamic RMS Voice Activity Detection (VAD) paired with half-duplex microphone muting. |
| **Multi-Provider Flexibility** | Independent, hot-swappable LLM credentials. | Unified LLM abstraction supporting Groq, OpenAI, Google Gemini, and local Ollama. |

---

## 3. Functional Requirements

### 3.1 Audio Capture & Voice Activity Detection (VAD)
- **FR-01 (Microphone Acquisition):** The system must request microphone access via `navigator.mediaDevices.getUserMedia` with hardware echo cancellation, noise suppression, and auto-gain control.
- **FR-02 (Energy Monitoring):** The system must compute real-time Root Mean Square (RMS) volume from raw audio buffers to drive visualizer feedback and dynamic orb pulsing.
- **FR-03 (Adaptive Noise Floor):** The system must continuously calibrate ambient noise levels using an exponential moving average (`noiseFloor = noiseFloor * 0.96 + rms * 0.04`) to prevent false triggers in noisy environments.
- **FR-04 (Silence Boundary Detection):** The system must detect speech termination after a configurable pause threshold (default: 1.2 seconds, selectable from 0.8s to 2.0s).
- **FR-05 (Inactivity Timeout):** In Live Call mode, if no speech is detected for 5 consecutive seconds during an idle listening state, the call must automatically terminate to preserve resources.

### 3.2 Speech-to-Text (STT) Processing
- **FR-06 (Primary In-Browser STT):** In Live Call mode, the system must utilize `webkitSpeechRecognition` for continuous interim and final speech transcription directly in the client.
- **FR-07 (Transcript Turn Isolation):** The system must advance an internal pointer (`turnStartIndex`) upon each turn dispatch to prevent prior conversational speech from leaking into subsequent turns.
- **FR-08 (Fallback Audio Encoding):** If browser STT fails or when operating in Click-to-Talk mode, the client must downsample raw PCM audio to 16,000 Hz mono and encode a valid 44-byte RIFF WAV file via an in-memory `DataView`.
- **FR-09 (Backend Audio Transcription):** The backend must accept multipart WAV uploads at `/api/process-audio` and transcribe speech via Python's `speech_recognition` library using Google's Web Speech API.

### 3.3 Large Language Model (LLM) Reasoning
- **FR-10 (Provider Abstraction):** The backend must expose a unified interface (`UnifiedLLMManager`) supporting Groq, OpenAI, Google Gemini, and local Ollama.
- **FR-11 (Token Streaming):** The backend must stream incremental token chunks across the WebSocket to the browser DOM in real time.
- **FR-12 (Context Management):** The system must maintain a sliding window of the last 12 messages (6 conversational turns) to preserve recent context while bounding token overhead.
- **FR-13 (System Prompt Enforcement):** Responses must adhere to a standardized voice persona instruction (`DEFAULT_SYSTEM_PROMPT`) encouraging natural, conversational, and direct spoken dialogue.

### 3.4 Text-to-Speech (TTS) Synthesis & Playback
- **FR-14 (Sentence Boundary Buffering):** The backend must inspect streaming tokens and split text at terminal punctuation (`.`, `!`, `?`) or clause boundaries (>80 characters) using regex lookahead.
- **FR-15 (Concurrent Segment Synthesis):** Completed sentence segments must immediately trigger TTS synthesis via ElevenLabs Turbo v2.5 (`eleven_turbo_v2_5`) in background threads without blocking LLM stream iteration.
- **FR-16 (FIFO Playback Queue):** The frontend must receive indexed audio chunks (`audio_chunk`), queue them in FIFO order, and begin playing Segment 0 immediately while subsequent segments are still being synthesized.
- **FR-17 (Automated TTS Fallback):** If ElevenLabs credentials fail or character quotas are exceeded, the backend must automatically fall back to Microsoft `edge-tts` (`en-US-JennyNeural`), and subsequently to local Windows SAPI (`System.Speech.Synthesis`).
- **FR-18 (Half-Duplex Microphone Muting):** The frontend must mute microphone input (`recorder.setMuted(true)`) and abort browser speech recognition whenever assistant audio is playing to eliminate acoustic feedback.

### 3.5 System Configuration & Monitoring
- **FR-19 (Runtime Provider Overrides):** The frontend must permit testing alternative LLM providers and temporary API keys on a per-request basis without restarting the server.
- **FR-20 (Persistent Configuration):** The system must allow persisting updated API keys and model configurations to the server `.env` file via `/api/save-keys`.
- **FR-21 (Isolated Connection Testing):** The system must provide a diagnostic endpoint (`/api/llm/test`) that verifies provider credentials and model availability with a lightweight 5-token test completion.
- **FR-22 (Secret Masking):** Server status queries (`/api/status`) must return boolean configuration flags and masked placeholders (`••••••••••••••••`), never exposing raw API keys.

---

## 4. Non-Functional Requirements

### 4.1 Performance & Responsiveness
- **NFR-01 (Turnaround Latency):** In primary WebSocket Live Call mode, the time between user speech cessation and assistant audio playback must remain under 2.0 seconds on standard broadband connections.
- **NFR-02 (LLM Time-to-First-Token):** Cloud LLM providers (Groq) must deliver initial token deltas in <400ms.
- **NFR-03 (Zero Client-Side Build Latency):** The frontend must load instantly without compilation, bundlers, or transpilation steps.

### 4.2 Reliability & Fault Tolerance
- **NFR-04 (Transport Fallback):** If WebSocket connectivity drops, the frontend must maintain functionality via REST endpoints (`/api/process-text`, `/api/process-audio`) while attempting automatic socket reconnection every 3 seconds.
- **NFR-05 (TTS Redundancy):** Audio synthesis must never hard-fail on ElevenLabs API errors; the system must gracefully degrade through Microsoft `edge-tts` down to offline Windows SAPI.
- **NFR-06 (Port Contention Resolution):** On startup, the server runner (`run_server.py`) must automatically detect and terminate orphaned processes holding port 8001 on Windows.

### 4.3 Security & Secret Isolation
- **NFR-07 (Credential Protection):** All third-party API keys (Groq, OpenAI, Gemini, ElevenLabs) must reside server-side in `.env`.
- **NFR-08 (Version Control Hygiene):** `.env` and local virtual environment directories must be strictly excluded from Git tracking via `.gitignore`.
- **NFR-09 (Input Sanitization):** User and assistant text rendered to the DOM must pass through HTML character escaping (`escapeHtml`) to prevent Cross-Site Scripting (XSS).

### 4.4 Usability & Accessibility
- **NFR-10 (Visual State Feedback):** The interface must clearly convey system states (`idle`, `live_listening`, `recording`, `processing`, `speaking`, `error`) through distinct orb glow states, status typography, and audio frequency bar visualizers.
- **NFR-11 (Keyboard Accessibility):** The primary recording action must be triggerable via the Spacebar key or keyboard focus on the central orb.

---

## 5. Scope Definition

### 5.1 In-Scope (Implemented Functionality)
- [x] In-browser microphone streaming and Web Audio API audio graph.
- [x] Client-side adaptive Voice Activity Detection (RMS energy).
- [x] Browser Web Speech API transcription with interim and final results.
- [x] In-browser 16kHz linear PCM WAV encoding using `DataView`.
- [x] Backend Google Speech Recognition fallback via temporary WAV processing.
- [x] Unified LLM manager abstracting Groq, OpenAI, Gemini, and Ollama.
- [x] Server-sent incremental token streaming via WebSockets.
- [x] Regex sentence boundary extractor with abbreviation protection.
- [x] Pipelined concurrent TTS synthesis via ElevenLabs Turbo v2.5.
- [x] Multi-tier TTS fallback to Microsoft `edge-tts` and local Windows SAPI.
- [x] Client-side FIFO audio playback queue with early start optimization.
- [x] Strict half-duplex turn-taking and microphone muting.
- [x] Client-side 12-message sliding window conversation history.
- [x] Settings modal with runtime credential testing and `.env` persistence.
- [x] Automatic Windows port cleanup utility.

### 5.2 Out-of-Scope (Deliberately Excluded)
- [ ] **Barge-In Interruption:** User interruption while the assistant speaks is not supported due to the absence of hardware acoustic echo cancellation.
- [ ] **Full-Duplex Audio Channels:** Simultaneous listening and speaking over WebRTC is not implemented.
- [ ] **Long-Term Database Memory:** No persistent conversation storage (SQL, SQLite, Redis); history resets on browser reload.
- [ ] **Retrieval-Augmented Generation (RAG):** No vector databases, document chunking, embeddings, or external knowledge retrieval.
- [ ] **Agentic Tool / Function Calling:** The LLM does not invoke external APIs or execute code; it functions strictly as a conversational engine.
- [ ] **Multi-User Authentication:** Single-user application without login, user profiles, or role-based access control.

---

## 6. End-to-End User Journey

```
[1. Application Launch]
     │ User opens http://localhost:8001
     │ WebSocket connection established (/ws/voice)
     │ UI displays "Ready to talk" with glowing idle orb
     ▼
[2. Permissions & Start]
     │ User clicks "Start Live Call" or presses Spacebar
     │ Browser prompts for microphone permission (granted)
     │ AudioContext initializes; VAD enters listening state ("I'm listening...")
     ▼
[3. User Spoken Input]
     │ User speaks into microphone
     │ Web Speech API captures interim words in real-time
     │ Visualizer canvas reflects audio frequency spectrum
     ▼
[4. Turn-Taking Detection]
     │ User stops speaking
     │ VAD detects 1.2s silence drop below adaptive noise floor
     │ Microphone is immediately muted (recorder.setMuted(true))
     ▼
[5. Streaming & Synthesis]
     │ Transcript dispatched over WebSocket to /ws/voice
     │ Backend streams tokens from Groq (LLM starts in <300ms)
     │ Text chunks render into chat bubble immediately
     │ extract_ready_sentences() splits sentence 1 -> ElevenLabs Turbo synthesizes MP3
     ▼
[6. Concurrent Early Playback]
     │ Browser receives Segment 0 MP3 via WebSocket
     │ Audio begins playing while LLM continues generating sentence 2
     │ UI transitions to "Speaking..." state
     ▼
[7. Turn Re-Arming]
     │ Final audio segment finishes playing
     │ Turn text appended to conversation history (12-message window)
     │ Microphone un-mutes (recorder.setMuted(false))
     │ VAD re-arms for next user utterance
```

---

## 7. Acceptance Criteria

| ID | Criterion | Verification Method | Status |
| :--- | :--- | :--- | :--- |
| **AC-01** | The application must initialize and serve all static assets on port 8001 without compilation. | Headless Chrome navigation to `/`. | **PASS** |
| **AC-02** | The browser must capture audio and compute RMS energy volume without crashing the audio thread. | Chrome CDP evaluation of `ScriptProcessorNode`. | **PASS** |
| **AC-03** | In Live Call mode, user speech must be transcribed and delivered to the backend via WebSocket. | Automated WebSocket event inspection. | **PASS** |
| **AC-04** | If Web Speech API is unavailable, recorded audio must be converted to a valid 16kHz WAV blob and transcribed via backend Google STT. | Integration test of `/api/process-audio`. | **PASS** |
| **AC-05** | The backend must support streaming text from Groq (`qwen/qwen3.8-27b`), OpenAI (`gpt-4o-mini`), and Gemini (`gemini-2.0-flash`). | Isolated API testing via `/api/llm/test`. | **PASS** |
| **AC-06** | Audio Segment 0 must begin playing in the browser before the LLM finishes full response generation. | Timing analysis in `test_ws_and_rest.py`. | **PASS** |
| **AC-07** | The microphone must be muted while assistant audio is playing to prevent acoustic loops. | State inspection of `recorder.isMuted`. | **PASS** |
| **AC-08** | Multi-turn conversation context must be maintained across turns within a 12-message limit. | Context recall assertion in integration tests. | **PASS** |
| **AC-09** | If ElevenLabs fails, speech synthesis must transparently fall back to Microsoft `edge-tts`. | Simulated credential failure test. | **PASS** |
| **AC-10** | Stale processes locking port 8001 must be cleaned up on Windows before server startup. | Socket test via `run_server.py:free_port`. | **PASS** |
