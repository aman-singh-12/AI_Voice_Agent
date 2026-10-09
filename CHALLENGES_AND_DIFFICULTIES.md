# 🛠️ Engineering Challenges & Difficulties Faced (From-Scratch Voice Pipeline)

*Documentation of architectural decisions, real-world roadblocks, and solutions discovered while building a voice AI agent from scratch without high-level voice frameworks (e.g. VAPI).*

---

## 1. Browser Audio Formatting vs Python STT Compatibility (No Host FFmpeg)

### The Problem:
- Standard browser `MediaRecorder` APIs record in compressed containers like `audio/webm; codecs=opus` or `audio/ogg`.
- Python's `SpeechRecognition` library relies on Python's standard `wave` and `aifc` modules when reading `sr.AudioFile`. It expects **uncompressed Linear PCM WAV format (RIFF header, 16-bit signed integer samples)**.
- If compressed audio (WebM/Opus) is sent to Python, `SpeechRecognition` fails with an error or demands an external `ffmpeg` binary installed in system `PATH`. On many user environments (including standard Windows machines), `ffmpeg` is not pre-installed.

### The Solution:
- Rather than forcing the backend to rely on system-level `ffmpeg` installations, we built a **pure client-side PCM 16-bit WAV encoder** in JavaScript using the Web Audio API (`AudioContext`, `ScriptProcessorNode`, and `DataView`).
- The recorder captures raw 32-bit floating point audio buffers, downsamples them to **16,000 Hz mono PCM** (the optimal rate for Speech Recognition engines), formats the 44-byte RIFF/WAVE header in memory, and converts the samples into signed 16-bit PCM bytes.
- This creates 100% native compatibility with `speech_recognition.AudioFile` with zero external dependencies on the server.

---

## 2. Voice Pipeline Latency Breakdown & Turnaround Optimization

### The Problem:
- In a traditional sequential pipeline:
  $$\text{Total Latency} = \text{STT Time} + \text{LLM Time} + \text{TTS Time} + \text{Network Transfer}$$
- If each step takes 1-2 seconds, total response time can reach 3-5 seconds, which breaks natural human conversational flow.

### The Solution:
1. **Prompt Engineering for Voice**: LLMs tend to generate long markdown paragraphs, bullet points, and code blocks. We designed a strict voice system prompt instructing Qwen to respond in 1-3 conversational, natural sentences and avoid markdown, symbols, asterisks, and emojis that sound unnatural when spoken by TTS.
2. **Restricted Token Generation**: Set `max_tokens=250` and temperature `0.7` to prevent unnecessary token generation delays in Qwen.
3. **Optimized STT Recognizer Settings**: Configured dynamic energy thresholding and calibrated ambient noise levels in `SpeechRecognition` to reduce transcription latency.
4. **Latency Telemetry**: Added per-stage metric tracking (`stt_time_ms`, `llm_time_ms`, `tts_time_ms`, `total_time_ms`) displayed live in the frontend so bottlenecks can be monitored.

---

## 3. Audio Silence, Noise & STT Exception Handling

### The Problem:
- If a user clicks the microphone but doesn't speak, or background noise masks the voice, `SpeechRecognition` raises `sr.UnknownValueError` ("Could not understand audio").
- Uncaught exceptions in any single stage (STT, LLM, or TTS) would crash or freeze the web interface in a permanent loading state.

### The Solution:
- Created a unified `VoicePipelineError` class with stage attribution (`[STT]`, `[LLM]`, `[TTS]`).
- The backend catches stage-specific errors and returns clean JSON error objects with user-friendly messages (e.g. *"Could not understand audio. Please speak clearly into the microphone"*).
- The frontend state machine smoothly recovers from errors back to the `IDLE` state with toast notifications, ensuring the user can click again without page refreshes.

---

## 4. Multi-Turn Context Window vs Response Latency

### The Problem:
- Real-time voice agents must remember recent context, but passing a long conversation history to Qwen on every turn increases prompt processing latency and costs.

### The Solution:
- Implemented a sliding conversational window that retains the last 6 turns (3 exchanges) formatted in clean `role`/`content` structures.
- This maintains immediate conversational memory while keeping the input context compact for fastest time-to-first-token.

---

## 5. User Interaction Models: Click-to-Talk vs Push-to-Talk (Hold)

### The Problem:
- Some users prefer clicking once to speak and clicking again when finished, while others prefer holding the Spacebar/orb (walkie-talkie style) to prevent capturing unnecessary background noise.

### The Solution:
- Implemented both modes with a toggle:
  - **Click to Toggle**: Great for hands-free speaking.
  - **Hold to Talk**: Press and hold orb or **Spacebar** to speak; releasing automatically sends the audio immediately.
  - Added visualizer feedback: The center voice orb dynamically pulses and scales with the speaker's vocal volume in real-time.

---

## 6. Flexible API Configuration for Evaluation

### The Problem:
- Team members and managers evaluating the project need to easily supply their own ElevenLabs and Qwen API keys without manually messing with `.env` files or restarting background processes.

### The Solution:
- Built an in-app **Settings Modal** in the UI that can securely save keys to `.env` and runtime memory with instant status feedback.
- Supported multiple Qwen providers (Alibaba DashScope, OpenRouter, and any OpenAI-compatible API base URL).
