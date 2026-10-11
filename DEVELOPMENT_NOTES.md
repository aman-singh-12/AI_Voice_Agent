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

