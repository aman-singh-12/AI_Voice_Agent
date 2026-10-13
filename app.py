import os
import re
import json
import base64
import time
import asyncio
import threading
import requests
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Response, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv, set_key

from pipeline import VoicePipeline, VoicePipelineError

load_dotenv()

app = FastAPI(
    title="Voice AI Agent Pipeline (Local & Cloud)",
    description="Voice AI Agent: SpeechRecognition (STT) -> Local Ollama Qwen / Groq (LLM) -> Local Neural / ElevenLabs (TTS)",
    version="1.1.0"
)

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return Response(status_code=204)

SERVER_START_TIME = time.time()

@app.api_route("/health", methods=["GET", "HEAD"], tags=["Health"])
@app.api_route("/api/health", methods=["GET", "HEAD"], tags=["Health"])
async def health_check():
    """
    Dedicated lightweight health check endpoint for uptime monitors (e.g. UptimeRobot, Render, K8s).
    Responds immediately with 200 OK and uptime metadata.
    """
    return {
        "status": "healthy",
        "ok": True,
        "uptime_seconds": round(time.time() - SERVER_START_TIME, 2),
        "timestamp": int(time.time())
    }


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

pipeline = VoicePipeline()

class TextRequest(BaseModel):
    text: str
    conversation_history: Optional[List[Dict[str, str]]] = []
    custom_keys: Optional[Dict[str, str]] = {}

class TestLLMRequest(BaseModel):
    provider: str
    model: Optional[str] = None
    api_key: Optional[str] = None

class SaveKeysRequest(BaseModel):
    llm_provider: Optional[str] = None
    pipeline_mode: Optional[str] = None  # Legacy alias
    groq_api_key: Optional[str] = None
    groq_model: Optional[str] = None
    openai_api_key: Optional[str] = None
    openai_model: Optional[str] = None
    gemini_api_key: Optional[str] = None
    gemini_model: Optional[str] = None
    elevenlabs_api_key: Optional[str] = None
    elevenlabs_voice_id: Optional[str] = None
    ollama_model: Optional[str] = "qwen2.5:1.5b"
    local_voice: Optional[str] = "en-US-JennyNeural"

def _is_real_key(k: Optional[str]) -> bool:
    if not k:
        return False
    clean = k.strip()
    if not clean or clean.startswith("•") or clean.startswith("*") or "your_" in clean:
        return False
    return True

LOCAL_VOICES = [
    {"id": "en-US-JennyNeural", "name": "Jenny (Natural US Female)"},
    {"id": "en-US-GuyNeural", "name": "Guy (Natural US Male)"},
    {"id": "en-US-AriaNeural", "name": "Aria (Expressive US Female)"},
    {"id": "en-GB-SoniaNeural", "name": "Sonia (British Female)"},
    {"id": "en-IN-NeerjaNeural", "name": "Neerja (Indian English Female)"},
    {"id": "en-IN-PrabhatNeural", "name": "Prabhat (Indian English Male)"},
]

@app.get("/api/status")
async def get_status():
    """Returns safe operational status of the Voice AI Agent and LLM providers."""
    providers_info = pipeline.llm_manager.get_all_providers_status()
    active_provider = pipeline.llm_manager.resolve_active_provider_name()
    eleven_key = os.getenv("ELEVENLABS_API_KEY", "")

    return {
        "status": "ready",
        "mode": active_provider,
        "active_provider": active_provider,
        "llm_provider": active_provider,
        "providers": providers_info["providers"],
        "groq": providers_info["providers"].get("groq", {}),
        "openai": providers_info["providers"].get("openai", {}),
        "gemini": providers_info["providers"].get("gemini", {}),
        "elevenlabs": {
            "configured": bool(eleven_key and eleven_key != "your_elevenlabs_api_key_here"),
            "voice": os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
        },
        "stt": {
            "engine": "SpeechRecognition / Faster-Whisper",
            "configured": True
        },
        "tts": {
            "engine": "ElevenLabs" if bool(eleven_key and eleven_key != "your_elevenlabs_api_key_here") else "Local Neural Voice",
            "elevenlabs_configured": bool(eleven_key and eleven_key != "your_elevenlabs_api_key_here"),
            "elevenlabs_voice": os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM"),
            "local_voice": os.getenv("LOCAL_VOICE", "en-US-JennyNeural")
        },
        # Compatibility fields
        "cloud": {
            "groq_configured": providers_info["providers"].get("groq", {}).get("configured", False),
            "groq_model": providers_info["providers"].get("groq", {}).get("model", ""),
            "elevenlabs_configured": bool(eleven_key and eleven_key != "your_elevenlabs_api_key_here"),
            "elevenlabs_voice": os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
        }
    }

@app.get("/api/llm/providers")
async def get_llm_providers():
    """Lists available LLM cloud providers, current models, and accessible model options."""
    return pipeline.llm_manager.get_all_providers_status()

@app.post("/api/llm/test")
async def test_llm_provider(req: TestLLMRequest):
    """Tests connection and inference availability for a cloud provider without exposing secret keys."""
    real_key = req.api_key if _is_real_key(req.api_key) else None
    return pipeline.llm_manager.test_provider(name=req.provider, model=req.model, api_key=real_key)

@app.get("/api/local-models")
async def get_local_models():
    """Lists locally installed Ollama models."""
    try:
        res = requests.get("http://127.0.0.1:11434/api/tags", timeout=1.5)
        if res.status_code == 200:
            models = [m["name"] for m in res.json().get("models", [])]
            return {"models": models}
    except Exception:
        pass
    return {"models": ["qwen2.5:1.5b"]}

@app.get("/api/local-voices")
async def get_local_voices():
    return LOCAL_VOICES

@app.post("/api/save-keys")
async def save_keys(req: SaveKeysRequest):
    """Saves pipeline preferences to .env and active runtime environment."""
    env_file = os.path.join(os.path.dirname(__file__), ".env")
    if not os.path.exists(env_file):
        with open(env_file, "w") as f:
            f.write("# Voice AI Agent Environment\n")

    # Provider selection
    provider_to_set = req.llm_provider or req.pipeline_mode
    if provider_to_set:
        clean_p = "groq" if provider_to_set == "cloud" else provider_to_set.lower()
        os.environ["LLM_PROVIDER"] = clean_p
        os.environ["PIPELINE_MODE"] = clean_p
        pipeline.llm_manager.set_active_provider(clean_p)
        pipeline.mode = clean_p
        set_key(env_file, "LLM_PROVIDER", clean_p)
        set_key(env_file, "PIPELINE_MODE", clean_p)

    # Groq settings
    if _is_real_key(req.groq_api_key):
        k = req.groq_api_key.strip()
        os.environ["GROQ_API_KEY"] = k
        pipeline.llm_manager.configure_provider("groq", api_key=k)
        set_key(env_file, "GROQ_API_KEY", k)
    if req.groq_model and req.groq_model.strip():
        m = req.groq_model.strip()
        if "llama" in m.lower():
            m = "qwen/qwen3.8-27b"
        os.environ["GROQ_MODEL"] = m
        pipeline.llm_manager.configure_provider("groq", model=m)
        set_key(env_file, "GROQ_MODEL", m)

    # OpenAI settings
    if _is_real_key(req.openai_api_key):
        k = req.openai_api_key.strip()
        os.environ["OPENAI_API_KEY"] = k
        pipeline.llm_manager.configure_provider("openai", api_key=k)
        set_key(env_file, "OPENAI_API_KEY", k)
    if req.openai_model and req.openai_model.strip():
        m = req.openai_model.strip()
        os.environ["OPENAI_MODEL"] = m
        pipeline.llm_manager.configure_provider("openai", model=m)
        set_key(env_file, "OPENAI_MODEL", m)

    # Gemini settings
    if _is_real_key(req.gemini_api_key):
        k = req.gemini_api_key.strip()
        os.environ["GEMINI_API_KEY"] = k
        pipeline.llm_manager.configure_provider("gemini", api_key=k)
        set_key(env_file, "GEMINI_API_KEY", k)
    if req.gemini_model and req.gemini_model.strip():
        m = req.gemini_model.strip()
        os.environ["GEMINI_MODEL"] = m
        pipeline.llm_manager.configure_provider("gemini", model=m)
        set_key(env_file, "GEMINI_MODEL", m)

    # ElevenLabs settings
    if _is_real_key(req.elevenlabs_api_key):
        k = req.elevenlabs_api_key.strip()
        os.environ["ELEVENLABS_API_KEY"] = k
        pipeline.cloud_tts.api_key = k
        set_key(env_file, "ELEVENLABS_API_KEY", k)
    if req.elevenlabs_voice_id and req.elevenlabs_voice_id.strip():
        v = req.elevenlabs_voice_id.strip()
        os.environ["ELEVENLABS_VOICE_ID"] = v
        pipeline.cloud_tts.voice_id = v
        set_key(env_file, "ELEVENLABS_VOICE_ID", v)

    # Local settings
    if req.ollama_model:
        os.environ["OLLAMA_MODEL"] = req.ollama_model
        set_key(env_file, "OLLAMA_MODEL", req.ollama_model)
    if req.local_voice:
        os.environ["LOCAL_VOICE"] = req.local_voice
        pipeline.local_tts.voice = req.local_voice
        set_key(env_file, "LOCAL_VOICE", req.local_voice)

    return {"message": "Configuration updated successfully.", "active_provider": pipeline.llm_manager.resolve_active_provider_name()}

@app.post("/api/process-audio")
async def process_audio(
    audio: UploadFile = File(...),
    history: Optional[str] = Form("[]"),
    keys: Optional[str] = Form("{}")
):
    try:
        audio_bytes = await audio.read()
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="Empty audio file uploaded.")

        conv_history = []
        if history:
            try:
                conv_history = json.loads(history)
            except Exception:
                conv_history = []

        custom_keys = {}
        if keys:
            try:
                custom_keys = json.loads(keys)
            except Exception:
                custom_keys = {}

        result = pipeline.process_voice(
            audio_bytes=audio_bytes,
            conversation_history=conv_history,
            custom_keys=custom_keys
        )
        return result

    except VoicePipelineError as vpe:
        return JSONResponse(
            status_code=200,
            content={
                "error": True,
                "stage": vpe.stage,
                "message": vpe.message
            }
        )
    except Exception as e:
        return JSONResponse(
            status_code=200,
            content={
                "error": True,
                "stage": "UNKNOWN",
                "message": f"Server error: {str(e)}"
            }
        )

@app.post("/api/process-text")
async def process_text(req: TextRequest):
    try:
        result = pipeline.process_text_only(
            user_text=req.text,
            conversation_history=req.conversation_history,
            custom_keys=req.custom_keys
        )
        return result
    except VoicePipelineError as vpe:
        return JSONResponse(
            status_code=200,
            content={
                "error": True,
                "stage": vpe.stage,
                "message": vpe.message
            }
        )
    except Exception as e:
        return JSONResponse(
            status_code=200,
            content={
                "error": True,
                "stage": "UNKNOWN",
                "message": f"Server error: {str(e)}"
            }
        )

def extract_ready_sentences(buffer: str, is_final: bool = False):
    """
    Splits text buffer into completed sentences or clause segments for incremental TTS synthesis.
    """
    sentences = []
    if is_final:
        remaining = buffer.strip()
        if remaining:
            parts = re.split(r'(?<=[.!?])\s+', remaining)
            for p in parts:
                p_c = p.strip()
                if p_c:
                    sentences.append(p_c)
        return sentences, ""

    while True:
        match = re.search(r'([.!?]+(?:\s+|\n+))', buffer)
        if not match:
            break
        end_pos = match.end()
        candidate = buffer[:end_pos].strip()
        # Avoid splitting prematurely on abbreviations like 'Dr.', 'Mr.', 'e.g.'
        if len(candidate) < 6 and candidate.endswith('.'):
            next_search = re.search(r'([.!?]+(?:\s+|\n+))', buffer[end_pos:])
            if not next_search:
                break
            end_pos += next_search.end()
            candidate = buffer[:end_pos].strip()

        if candidate:
            sentences.append(candidate)
        buffer = buffer[end_pos:]

    # Long clause boundary split (comma, semicolon, colon) if buffer exceeds 80 characters
    if len(buffer) > 80:
        clause_match = re.search(r'([,;:]\s+)', buffer)
        if clause_match:
            end_pos = clause_match.end()
            candidate = buffer[:end_pos].strip()
            if candidate and len(candidate) >= 20:
                sentences.append(candidate)
                buffer = buffer[end_pos:]

    return sentences, buffer


def synthesize_speech_segment(text_segment: str, active_p: str, custom_keys: dict) -> bytes:
    """Synthesizes a single text segment into an independently playable MP3 audio chunk."""
    audio_bytes = None
    if active_p != "local" and (custom_keys.get("elevenlabs_api_key") or os.getenv("ELEVENLABS_API_KEY")):
        try:
            audio_bytes = pipeline.cloud_tts.synthesize(text_segment)
        except Exception as e:
            print(f"[TTS Fallback] ElevenLabs segment error: {e}")
            audio_bytes = pipeline.local_tts.synthesize(text_segment)
    if audio_bytes is None:
        audio_bytes = pipeline.local_tts.synthesize(text_segment)
    return audio_bytes


@app.websocket("/ws/voice")
async def websocket_voice_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time Voice AI interaction.
    Accepts text or audio frames and streams incremental LLM tokens and playable audio chunks.
    Supports instant barge-in speech interruption via cancellable asyncio turn tasks.
    """
    from starlette.websockets import WebSocketState

    await websocket.accept()
    session_history: List[Dict[str, str]] = []
    session_keys: Dict[str, str] = {}
    active_turn_task: Optional[asyncio.Task] = None
    active_turn_id: Optional[Any] = None

    async def safe_send(payload: dict) -> bool:
        """Safely sends JSON payload, preventing RuntimeError if socket is closed or disconnecting."""
        try:
            if websocket.client_state == WebSocketState.CONNECTED:
                await websocket.send_json(payload)
                return True
        except (WebSocketDisconnect, RuntimeError):
            pass
        except Exception as ex:
            print(f"[WebSocket safe_send warning] {ex}")
        return False

    async def cancel_active_turn():
        nonlocal active_turn_task
        if active_turn_task and not active_turn_task.done():
            active_turn_task.cancel()
            try:
                await active_turn_task
            except (asyncio.CancelledError, Exception):
                pass
            active_turn_task = None

    async def process_turn_task(turn_id: Any, prompt_text: str, custom_keys: dict, history: list):
        nonlocal active_turn_id
        active_turn_id = turn_id
        req_id = str(turn_id)
        stop_event = threading.Event()
        print(f"[SESSION] Processing turn started request_id={req_id}")
        try:
            active_p = custom_keys.get("llm_provider") or session_keys.get("llm_provider") or pipeline.llm_manager.resolve_active_provider_name()
            print(f"[LLM] New response generation started request_id={req_id} provider={active_p}")
            await safe_send({
                "type": "llm_start",
                "request_id": req_id,
                "turn_id": turn_id,
                "provider": active_p
            })

            # Run synchronous LLM stream in worker thread and pipe into asyncio.Queue
            # Keeps the event loop completely unblocked for immediate interrupt dispatching
            loop = asyncio.get_running_loop()
            q = asyncio.Queue()
            sentinel = object()

            def stream_worker():
                try:
                    for chunk in pipeline.stream_llm(
                        prompt=prompt_text,
                        conversation_history=history,
                        provider_name=active_p
                    ):
                        if stop_event.is_set():
                            break
                        loop.call_soon_threadsafe(q.put_nowait, chunk)
                except Exception as ex:
                    if not stop_event.is_set():
                        loop.call_soon_threadsafe(q.put_nowait, ex)
                finally:
                    loop.call_soon_threadsafe(q.put_nowait, sentinel)

            threading.Thread(target=stream_worker, daemon=True).start()

            full_chunks = []
            sentence_buffer = ""
            segment_index = 0

            while True:
                chunk = await q.get()
                if chunk is sentinel:
                    break
                if isinstance(chunk, Exception):
                    raise chunk
                if not chunk:
                    continue

                full_chunks.append(chunk)
                sentence_buffer += chunk

                # Forward incremental LLM text to browser
                await safe_send({
                    "type": "text_chunk",
                    "request_id": req_id,
                    "turn_id": turn_id,
                    "chunk": chunk,
                    "text": chunk
                })
                await safe_send({
                    "type": "llm_token",
                    "request_id": req_id,
                    "turn_id": turn_id,
                    "chunk": chunk,
                    "text": chunk
                })
                await safe_send({
                    "type": "llm_chunk",
                    "request_id": req_id,
                    "turn_id": turn_id,
                    "chunk": chunk,
                    "text": chunk
                })

                # Check for completed sentences to synthesize audio chunk immediately
                ready_sentences, sentence_buffer = extract_ready_sentences(sentence_buffer, is_final=False)
                for sent in ready_sentences:
                    if not sent.strip():
                        continue
                    try:
                        audio_bytes = await asyncio.to_thread(synthesize_speech_segment, sent.strip(), active_p, custom_keys)
                        if audio_bytes:
                            audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
                            await safe_send({
                                "type": "audio_chunk",
                                "request_id": req_id,
                                "turn_id": turn_id,
                                "segment_index": segment_index,
                                "audio_format": "mp3",
                                "audio_data": audio_b64,
                                "text": sent.strip()
                            })
                            await safe_send({
                                "type": "tts_audio_chunk",
                                "request_id": req_id,
                                "turn_id": turn_id,
                                "segment_index": segment_index,
                                "audio_format": "mp3",
                                "audio_data": audio_b64,
                                "text": sent.strip()
                            })
                            segment_index += 1
                    except asyncio.CancelledError:
                        stop_event.set()
                        raise
                    except Exception as e:
                        print(f"[TTS segment error] {e}")

            # Flush final sentence buffer
            if sentence_buffer.strip():
                final_sentences, _ = extract_ready_sentences(sentence_buffer, is_final=True)
                for sent in final_sentences:
                    if not sent.strip():
                        continue
                    try:
                        audio_bytes = await asyncio.to_thread(synthesize_speech_segment, sent.strip(), active_p, custom_keys)
                        if audio_bytes:
                            audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
                            await safe_send({
                                "type": "audio_chunk",
                                "request_id": req_id,
                                "turn_id": turn_id,
                                "segment_index": segment_index,
                                "audio_format": "mp3",
                                "audio_data": audio_b64,
                                "text": sent.strip()
                            })
                            await safe_send({
                                "type": "tts_audio_chunk",
                                "request_id": req_id,
                                "turn_id": turn_id,
                                "segment_index": segment_index,
                                "audio_format": "mp3",
                                "audio_data": audio_b64,
                                "text": sent.strip()
                            })
                            segment_index += 1
                    except asyncio.CancelledError:
                        stop_event.set()
                        raise
                    except Exception as e:
                        print(f"[TTS final segment error] {e}")

            assistant_text = "".join(full_chunks).strip()
            # Only save to session history if turn completed without interruption
            session_history.append({"role": "user", "content": prompt_text})
            if assistant_text:
                session_history.append({"role": "assistant", "content": assistant_text})

            print(f"[VOICE] Response completed request_id={req_id} segments={segment_index}")
            # Final completion events
            await safe_send({
                "type": "response_complete",
                "request_id": req_id,
                "turn_id": turn_id,
                "full_text": assistant_text,
                "text": assistant_text,
                "segments_count": segment_index
            })
            await safe_send({
                "type": "llm_done",
                "request_id": req_id,
                "turn_id": turn_id,
                "full_text": assistant_text,
                "text": assistant_text
            })
            await safe_send({
                "type": "response",
                "request_id": req_id,
                "turn_id": turn_id,
                "user_text": prompt_text,
                "assistant_text": assistant_text,
                "llm_text": assistant_text,
                "segments_count": segment_index,
                "mode": active_p,
                "provider": active_p
            })

        except asyncio.CancelledError:
            stop_event.set()
            print(f"[BACKEND] Turn {req_id} cancelled via interruption. Releasing resources.")
            print(f"[LLM] Previous generation cancelled request_id={req_id}")
            print(f"[TTS] Previous TTS task cancelled request_id={req_id}")
            print(f"[SESSION] Previous response invalidated request_id={req_id}")
            return
        except VoicePipelineError as vpe:
            stop_event.set()
            await safe_send({"type": "llm_error", "request_id": req_id, "turn_id": turn_id, "stage": vpe.stage, "message": vpe.message})
            await safe_send({"type": "error", "request_id": req_id, "turn_id": turn_id, "error": True, "stage": vpe.stage, "message": vpe.message})
        except Exception as e:
            stop_event.set()
            await safe_send({"type": "llm_error", "request_id": req_id, "turn_id": turn_id, "stage": "UNKNOWN", "message": str(e)})
            await safe_send({"type": "error", "request_id": req_id, "turn_id": turn_id, "error": True, "stage": "UNKNOWN", "message": f"Server error: {str(e)}"})
        finally:
            stop_event.set()

    try:
        while True:
            message = await websocket.receive()

            if "text" in message and message["text"]:
                raw_text = message["text"]
                try:
                    data = json.loads(raw_text)
                except Exception:
                    data = {"text": raw_text}

                msg_type = data.get("type", "text")

                if msg_type == "ping":
                    await safe_send({"type": "pong", "time": time.time()})
                    continue

                if msg_type == "config":
                    if "keys" in data and isinstance(data["keys"], dict):
                        session_keys.update(data["keys"])
                    if "pipeline_mode" in data:
                        session_keys["pipeline_mode"] = data["pipeline_mode"]
                    await safe_send({"type": "config_ack", "status": "ok"})
                    continue

                # Speech Interruption / Barge-in signal from client
                if msg_type == "interrupt":
                    target_turn = data.get("request_id") or data.get("turn_id") or active_turn_id
                    target_req = str(target_turn) if target_turn is not None else ""
                    print(f"[BACKEND] Interrupt event received request_id={target_req}")
                    await cancel_active_turn()
                    print(f"[LLM] Previous generation cancelled request_id={target_req}")
                    print(f"[TTS] Previous TTS task cancelled request_id={target_req}")
                    print(f"[SESSION] Previous response invalidated request_id={target_req}")
                    await safe_send({
                        "type": "interrupt_ack",
                        "request_id": target_req,
                        "turn_id": target_turn,
                        "status": "cancelled"
                    })
                    await safe_send({
                        "type": "interrupted",
                        "request_id": target_req,
                        "turn_id": target_turn
                    })
                    continue

                # Cancel any existing turn before starting a new one
                await cancel_active_turn()

                turn_id = data.get("request_id") or data.get("turn_id") or f"req_{int(time.time() * 1000)}"
                req_id = str(turn_id)
                custom_keys = data.get("keys", session_keys)
                raw_hist = data.get("history")
                history = raw_hist if (isinstance(raw_hist, list) and len(raw_hist) > 0) else session_history
                prompt_text = ""

                if msg_type == "audio" or "audio" in data:
                    audio_b64 = data.get("audio", "")
                    if "," in audio_b64:
                        audio_b64 = audio_b64.split(",", 1)[1]
                    try:
                        audio_bytes = base64.b64decode(audio_b64)
                        prompt_text = pipeline.stt.transcribe(audio_bytes)
                        print(f"[STT] New user transcript received request_id={req_id}: '{prompt_text}'")
                        await safe_send({
                            "type": "transcript",
                            "request_id": req_id,
                            "turn_id": turn_id,
                            "text": prompt_text
                        })
                    except VoicePipelineError as vpe:
                        if "no speech" in vpe.message.lower() or "could not understand" in vpe.message.lower():
                            await safe_send({"type": "no_speech", "request_id": req_id, "turn_id": turn_id, "message": vpe.message})
                        else:
                            await safe_send({"type": "error", "request_id": req_id, "turn_id": turn_id, "stage": vpe.stage, "message": vpe.message})
                        continue
                    except Exception as e:
                        await safe_send({"type": "error", "request_id": req_id, "turn_id": turn_id, "stage": "STT", "message": str(e)})
                        continue
                else:
                    prompt_text = data.get("text") or data.get("message") or data.get("prompt") or raw_text

                if not prompt_text or not prompt_text.strip():
                    continue

                active_turn_task = asyncio.create_task(
                    process_turn_task(turn_id, prompt_text.strip(), custom_keys, history)
                )

            elif "bytes" in message and message["bytes"]:
                turn_id = f"req_{int(time.time() * 1000)}"
                req_id = turn_id
                audio_bytes = message["bytes"]
                try:
                    await cancel_active_turn()
                    prompt_text = pipeline.stt.transcribe(audio_bytes)
                    print(f"[STT] New user transcript received request_id={req_id}: '{prompt_text}'")
                    await safe_send({
                        "type": "transcript",
                        "request_id": req_id,
                        "turn_id": turn_id,
                        "text": prompt_text
                    })
                    if prompt_text and prompt_text.strip():
                        active_turn_task = asyncio.create_task(
                            process_turn_task(turn_id, prompt_text.strip(), session_keys, session_history)
                        )
                except VoicePipelineError as vpe:
                    if "no speech" in vpe.message.lower() or "could not understand" in vpe.message.lower():
                        await safe_send({"type": "no_speech", "request_id": req_id, "turn_id": turn_id, "message": vpe.message})
                    else:
                        await safe_send({"type": "error", "request_id": req_id, "turn_id": turn_id, "stage": vpe.stage, "message": vpe.message})
                except Exception as e:
                    await safe_send({"type": "error", "request_id": req_id, "turn_id": turn_id, "stage": "UNKNOWN", "message": f"Server error: {str(e)}"})

    except (WebSocketDisconnect, RuntimeError):
        pass
    except Exception as e:
        print(f"WebSocket /ws/voice error: {e}")
    finally:
        await cancel_active_turn()

@app.get("/ws/voice")
async def ws_voice_info():
    """Information endpoint for clients querying /ws/voice over HTTP."""
    return {
        "status": "online",
        "protocol": "websocket",
        "endpoint": "/ws/voice",
        "message": "Voice AI WebSocket is active. Connect using ws:// or wss:// protocol."
    }

# Static files
os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def root():
    return FileResponse("static/index.html")

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8001))
    host = os.getenv("HOST", "0.0.0.0")
    print(f"Voice AI Agent Server running at http://localhost:{port}")
    uvicorn.run("app:app", host=host, port=port, reload=True)
