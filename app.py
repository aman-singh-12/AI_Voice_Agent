import os
import json
import base64
import time
import requests
from typing import Optional, List, Dict
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
            "groq_configured": providers_info["providers"]["groq"]["configured"],
            "groq_model": providers_info["providers"]["groq"]["model"],
            "elevenlabs_configured": bool(eleven_key and eleven_key != "your_elevenlabs_api_key_here"),
            "elevenlabs_voice": os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
        },
        "openai": {
            "configured": providers_info["providers"]["openai"]["configured"],
            "model": providers_info["providers"]["openai"]["model"]
        },
        "gemini": {
            "configured": providers_info["providers"]["gemini"]["configured"],
            "model": providers_info["providers"]["gemini"]["model"]
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

@app.websocket("/ws/voice")
async def websocket_voice_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time Voice AI interaction.
    Accepts text JSON, base64 audio, or binary audio frames, and yields synthesized voice speech.
    """
    await websocket.accept()
    session_history: List[Dict[str, str]] = []
    session_keys: Dict[str, str] = {}

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
                    await websocket.send_json({"type": "pong", "time": time.time()})
                    continue

                if msg_type == "config":
                    if "keys" in data and isinstance(data["keys"], dict):
                        session_keys.update(data["keys"])
                    if "pipeline_mode" in data:
                        session_keys["pipeline_mode"] = data["pipeline_mode"]
                    await websocket.send_json({"type": "config_ack", "status": "ok"})
                    continue

                if msg_type == "audio" or "audio" in data:
                    audio_b64 = data.get("audio", "")
                    if "," in audio_b64:
                        audio_b64 = audio_b64.split(",", 1)[1]
                    try:
                        audio_bytes = base64.b64decode(audio_b64)
                        history = data.get("history", session_history)
                        custom_keys = data.get("keys", session_keys)

                        active_p = custom_keys.get("llm_provider") or session_keys.get("llm_provider") or pipeline.llm_manager.resolve_active_provider_name()
                        await websocket.send_json({"type": "llm_start", "provider": active_p})

                        result = pipeline.process_voice(
                            audio_bytes=audio_bytes,
                            conversation_history=history,
                            custom_keys=custom_keys
                        )
                        if result.get("user_text"):
                            session_history.append({"role": "user", "content": result["user_text"]})
                        if result.get("assistant_text"):
                            session_history.append({"role": "assistant", "content": result["assistant_text"]})

                        await websocket.send_json({"type": "llm_done", "text": result.get("assistant_text", "")})
                        await websocket.send_json({
                            "type": "response",
                            **result
                        })
                    except VoicePipelineError as vpe:
                        await websocket.send_json({"type": "llm_error", "stage": vpe.stage, "message": vpe.message})
                        await websocket.send_json({
                            "type": "error",
                            "error": True,
                            "stage": vpe.stage,
                            "message": vpe.message
                        })
                    except Exception as e:
                        await websocket.send_json({"type": "llm_error", "stage": "UNKNOWN", "message": str(e)})
                        await websocket.send_json({
                            "type": "error",
                            "error": True,
                            "stage": "UNKNOWN",
                            "message": f"Server error: {str(e)}"
                        })
                    continue

                # Text handling
                prompt_text = data.get("text") or data.get("message") or data.get("prompt") or raw_text
                history = data.get("history", session_history)
                custom_keys = data.get("keys", session_keys)

                try:
                    active_p = custom_keys.get("llm_provider") or session_keys.get("llm_provider") or pipeline.llm_manager.resolve_active_provider_name()
                    await websocket.send_json({"type": "llm_start", "provider": active_p})

                    full_chunks = []
                    for chunk in pipeline.stream_llm(
                        prompt=prompt_text,
                        conversation_history=history,
                        provider_name=active_p
                    ):
                        if chunk:
                            full_chunks.append(chunk)
                            await websocket.send_json({"type": "llm_chunk", "chunk": chunk, "text": chunk})

                    assistant_text = "".join(full_chunks).strip()
                    session_history.append({"role": "user", "content": prompt_text})
                    if assistant_text:
                        session_history.append({"role": "assistant", "content": assistant_text})

                    await websocket.send_json({"type": "llm_done", "full_text": assistant_text, "text": assistant_text})

                    # Synthesize speech
                    audio_mp3_bytes = None
                    if active_p != "local" and (custom_keys.get("elevenlabs_api_key") or os.getenv("ELEVENLABS_API_KEY")):
                        try:
                            audio_mp3_bytes = pipeline.cloud_tts.synthesize(assistant_text)
                        except Exception:
                            audio_mp3_bytes = pipeline.local_tts.synthesize(assistant_text)
                    if audio_mp3_bytes is None:
                        audio_mp3_bytes = pipeline.local_tts.synthesize(assistant_text)

                    audio_base64 = base64.b64encode(audio_mp3_bytes).decode("utf-8")
                    audio_data_uri = f"data:audio/mp3;base64,{audio_base64}"

                    result = {
                        "user_text": prompt_text,
                        "assistant_text": assistant_text,
                        "llm_text": assistant_text,
                        "audio_url": audio_data_uri,
                        "metrics": {"total_time_ms": 0},
                        "mode": active_p,
                        "provider": active_p
                    }

                    await websocket.send_json({
                        "type": "response",
                        **result
                    })
                except VoicePipelineError as vpe:
                    await websocket.send_json({"type": "llm_error", "stage": vpe.stage, "message": vpe.message})
                    await websocket.send_json({
                        "type": "error",
                        "error": True,
                        "stage": vpe.stage,
                        "message": vpe.message
                    })
                except Exception as e:
                    await websocket.send_json({"type": "llm_error", "stage": "UNKNOWN", "message": str(e)})
                    await websocket.send_json({
                        "type": "error",
                        "error": True,
                        "stage": "UNKNOWN",
                        "message": f"Server error: {str(e)}"
                    })

            elif "bytes" in message and message["bytes"]:
                audio_bytes = message["bytes"]
                try:
                    active_p = session_keys.get("llm_provider") or pipeline.llm_manager.resolve_active_provider_name()
                    await websocket.send_json({"type": "llm_start", "provider": active_p})

                    result = pipeline.process_voice(
                        audio_bytes=audio_bytes,
                        conversation_history=session_history,
                        custom_keys=session_keys
                    )
                    if result.get("user_text"):
                        session_history.append({"role": "user", "content": result["user_text"]})
                    if result.get("assistant_text"):
                        session_history.append({"role": "assistant", "content": result["assistant_text"]})

                    await websocket.send_json({"type": "llm_done", "text": result.get("assistant_text", "")})
                    await websocket.send_json({
                        "type": "response",
                        **result
                    })
                except VoicePipelineError as vpe:
                    await websocket.send_json({"type": "llm_error", "stage": vpe.stage, "message": vpe.message})
                    await websocket.send_json({
                        "type": "error",
                        "error": True,
                        "stage": vpe.stage,
                        "message": vpe.message
                    })
                except Exception as e:
                    await websocket.send_json({"type": "llm_error", "stage": "UNKNOWN", "message": str(e)})
                    await websocket.send_json({
                        "type": "error",
                        "error": True,
                        "stage": "UNKNOWN",
                        "message": f"Server error: {str(e)}"
                    })

    except (WebSocketDisconnect, RuntimeError):
        pass
    except Exception as e:
        print(f"WebSocket /ws/voice error: {e}")

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
