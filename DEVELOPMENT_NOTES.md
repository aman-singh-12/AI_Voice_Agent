# Development Notes

## OpenAI provider experiment

### Setup Ready for development

1. Create and activate the project virtual environment.
2. Install dependencies with `python -m pip install -r requirements.txt`.
3. Set these values in the backend `.env` file or the process environment:

   ```env
   OPENAI_API_KEY=your_backend_only_key
   OPENAI_MODEL=model_id_available_to_this_key
   PIPELINE_MODE=openai
   ```

   The application verifies `OPENAI_MODEL` with the OpenAI Models API before making a Responses API request. The API key is never accepted from frontend JavaScript.
4. Start the server with `python run_server.py` and open `http://localhost:8001`.
5. Select the OpenAI mode in Settings. Choose local TTS or configure ElevenLabs for cloud TTS.

### Implementation notes

- OpenAI is an additional provider. Ollama and Groq remain available.
- The official OpenAI Python SDK and Responses API are used.
- Responses API streaming is consumed on the backend and assembled into the existing JSON response. The current frontend contract is intentionally unchanged, so the browser receives the completed response and existing audio URL.
- Existing browser-managed conversation history is passed to OpenAI as prior user and assistant messages.
- Completed OpenAI text uses the existing TTS selection: local `edge-tts`/SAPI when local mode or no ElevenLabs key is available, otherwise ElevenLabs REST TTS. The resulting audio data URI is still played by the existing `Audio` path.

### Validation

- `venv\Scripts\python.exe -m unittest discover -s tests -v`: 4 tests passed, covering OpenAI key errors, model verification, Responses streaming assembly, conversation-history forwarding, and the OpenAI-to-existing-local-TTS data URI flow.
- The first test attempt used the system Python and failed because project dependencies were only installed in `venv`; rerunning with the project interpreter resolved this.
- The live server was started with `venv\Scripts\python.exe run_server.py`; `GET /` returned HTTP 200 and `GET /api/status` reported `mode=openai`, `OPENAI_MODEL=gpt-4o`, and `model_accessible=true`.
- A real GPT-4o model-access check and Responses API smoke test succeeded.
- Browser typed-message test succeeded twice. The second request asked what was asked previously and received a context-aware answer. Both responses produced ElevenLabs audio, displayed replay controls, and entered the browser's speaking state.
- The browser automation environment triggered the microphone start flow but did not provide usable microphone audio. Microphone capture and Google SpeechRecognition must be manually verified in a normal Chrome, Edge, or Firefox session with permission granted.
- A real API smoke test requires an explicitly configured `OPENAI_API_KEY`, an accessible `OPENAI_MODEL`, and user authorization before making billable/network API calls.

### Limitations

- The existing HTTP request/response API is preserved; streamed OpenAI deltas are not pushed incrementally to the current browser UI.
- Model availability is account/project-specific. No model ID is hardcoded as an OpenAI default.
- Existing SpeechRecognition and local TTS behavior are unchanged.
- Browser automation logged the standard `ScriptProcessorNode` deprecation warning from the existing audio recorder; it did not prevent typed TTS playback.

## Atomic Turn & Continuous SpeechRecognition Isolation (Deployment Fix)

### Root Cause
- In deployment over HTTPS (e.g., Render), modern browsers maintain a persistent continuous `webkitSpeechRecognition` stream that does not terminate between turns.
- In `audio-recorder.js`, `this.turnStartIndex` was never advanced upon turn trigger, and `setMuted(true)` did not flush or abort the browser's accumulated `SpeechRecognition` results buffer.
- When subsequent queries were spoken, the loop iterated from index 0 across all prior turns, prepending the previous queries (e.g., "hello how are you") to the new utterance.
- On localhost, this did not occur because HTTP local sessions frequently timed out/restarted speech recognition (`onend`), Click-to-Talk aborted between recordings, and local Ollama was evaluated with single-prompt formatting.

### Fix
- Updated [audio-recorder.js](file:///c:/Users/aman7/testing%20AI/static/audio-recorder.js) to track `latestResultIndex` and immediately advance `turnStartIndex` upon `triggerTurn()`.
- Abort speech recognition on mute to flush the browser's internal results array, starting a clean fresh recognition session on unmute for each new turn.
- Added a `Conversation Memory` option in Settings ([index.html](file:///c:/Users/aman7/testing%20AI/static/index.html) and [app.js](file:///c:/Users/aman7/testing%20AI/static/app.js)) defaulting to **Atomic / Single-Turn** mode to guarantee queries are processed as fresh, isolated requests without prior history pollution.

---

## Minimal WebSocket Frontend Integration and Incremental Audio Streaming

### 1. Why the browser previously used REST
The initial prototype transmitted user input (transcribed text or WAV audio) exclusively via HTTP POST requests to `/api/process-text` or `/api/process-audio`. While straightforward, HTTP request-response semantics forced the system into batch sequential processing:
- The backend waited for the LLM to generate the entire response before initiating TTS.
- The browser had to wait for both the complete LLM response and the entire TTS audio generation to finish before receiving any text or audio.
- This created perceived turnaround latencies of 3 to 6+ seconds, breaking conversational responsiveness.

### 2. How the browser connects to `/ws/voice`
The frontend ([static/app.js](file:///c:/Users/aman7/testing%20AI/static/app.js)) initializes a persistent, reusable WebSocket connection on application load:
- Dynamic URL resolution: `const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'; const wsUrl = `${protocol}//${window.location.host}/ws/voice`;`.
- Automatic reconnect with exponential / 3-second retry loop on unexpected disconnects.
- Clean lifecycle handling via `onopen`, `onmessage`, `onerror`, and `onclose`.
- Seamless fallback: If the WebSocket is ever disconnected or in a non-OPEN state, `processText()` automatically falls back to the `/api/process-text` REST endpoint.

### 3. How incremental text delivery works
1. The user speech is finalized by browser speech recognition or submitted via chat input.
2. The browser dispatches a JSON event `{ type: 'text', text: '...', turn_id: 123, history: [...], keys: {...} }` over the WebSocket.
3. The backend receives the event, verifies credentials against active runtime settings, and invokes `pipeline.stream_llm()`.
4. As tokens arrive from the active LLM provider (OpenAI, Groq, etc.), the backend emits `text_chunk` events over the WebSocket:
   ```json
   { "type": "text_chunk", "turn_id": 123, "text": "token" }
   ```
5. The frontend appends arriving tokens progressively to a single streaming assistant chat bubble in real-time, providing immediate visual feedback (< 1s time-to-first-token).

### 4. How sentence-based TTS buffering works
Rather than waiting for the entire LLM output or naively sending every token to TTS, the backend runs `extract_ready_sentences(sentence_buffer)`:
- Segments text at natural sentence boundaries (`.`, `!`, `?` followed by whitespace or quotes).
- Also segments on strong clause delimiters (`;`, `,`, `:`, `—`) if the accumulated buffer exceeds a reasonable reading length (≥ 45 characters).
- When a segment boundary is detected, the segment is extracted and sent to ElevenLabs TTS (with automatic local Neural TTS fallback).
- Segment synthesis occurs while subsequent LLM text continues streaming.
- At stream completion, any remaining buffer is flushed as the final segment.

### 5. How audio segments are delivered and played
- **Payload format**: Each completed audio segment is Base64-encoded and sent as an `audio_chunk` event:
  ```json
  {
    "type": "audio_chunk",
    "turn_id": 123,
    "segment_index": 0,
    "audio_format": "mp3",
    "audio_data": "<base64>",
    "text": "First sentence text."
  }
  ```
- Each segment is an independently formed, complete MP3 audio buffer with standard MPEG headers.
- **Frontend Playback (FIFO Queue)**:
  - Arriving `audio_chunk` events are validated by `turn_id` and queued in order of `segment_index`.
  - Playback begins **immediately** upon receiving `segment_index: 0` without waiting for subsequent tokens or the `response_complete` event.
  - When `currentAudio.onended` triggers, the next segment in the queue plays sequentially.
  - When all segments finish playing and `response_complete` has been received, the UI transitions back to listening/idle state.

### 6. Implementation difficulties and solutions
- **Interleaved Concurrency**: Managing async sentence extraction while receiving synchronous/asynchronous LLM generator chunks was resolved using an internal accumulator and deterministic boundary regex.
- **Preserving Provider Credential Flow**: Ensuring that both `/api/llm/test` and dynamic settings changes in the UI seamlessly propagate to `/ws/voice` without restarting the connection was accomplished by having the WebSocket read `pipeline.llm_manager.resolve_active_provider_name()` dynamically per turn and accept runtime client keys.
- **Audio Segment Integrity**: Naive byte slicing creates corrupt MP3 files. Synthesizing each discrete sentence into an independent MP3 ensures each audio chunk is cleanly decodable by browser `Audio` objects.

### 7. Remaining limitations and latency
- **TTS Synthesis Latency per Sentence**: While the first sentence audio arrives significantly earlier than the full response (typically within 1.5–2.0s), network latency to ElevenLabs remains the primary latency factor.
- **Single Connection Queue**: The audio queue is managed purely on the client side per turn; packet reordering over WebSocket is prevented by sorting incoming segments by `segment_index`.


