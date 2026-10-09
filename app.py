import os
import json
import base64
import requests
from typing import Optional, List, Dict
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
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

class SaveKeysRequest(BaseModel):
    pipeline_mode: Optional[str] = "local"
    ollama_model: Optional[str] = "qwen2.5:1.5b"
    local_voice: Optional[str] = "en-US-JennyNeural"
    groq_api_key: Optional[str] = ""
    groq_model: Optional[str] = ""
    elevenlabs_api_key: Optional[str] = ""
    elevenlabs_voice_id: Optional[str] = ""

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
    """Checks presence of local Ollama, models, and cloud API keys."""
    groq_key = os.getenv("GROQ_API_KEY", "")
    eleven_key = os.getenv("ELEVENLABS_API_KEY", "")

    # Check local Ollama health
    ollama_running = False
    installed_models = []
    try:
        res = requests.get("http://127.0.0.1:11434/api/tags", timeout=1.5)
        if res.status_code == 200:
            ollama_running = True
            data = res.json()
            installed_models = [m["name"] for m in data.get("models", [])]
    except Exception:
        ollama_running = False

    return {
        "status": "ready",
        "mode": os.getenv("PIPELINE_MODE", "local"),
        "stt": {
            "engine": "SpeechRecognition (Python Native)",
            "configured": True
        },
        "local": {
            "ollama_running": ollama_running,
            "installed_models": installed_models,
            "default_model": os.getenv("OLLAMA_MODEL", "qwen2.5:1.5b"),
            "local_voice": os.getenv("LOCAL_VOICE", "en-US-JennyNeural")
        },
        "cloud": {
            "groq_configured": bool(groq_key and groq_key != "your_groq_api_key_here"),
            "groq_model": os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
            "elevenlabs_configured": bool(eleven_key and eleven_key != "your_elevenlabs_api_key_here"),
            "elevenlabs_voice": os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
        }
    }

@app.get("/api/local-models")
async def get_local_models():
    """Lists locally installed Ollama models."""
    try:
        res = requests.get("http://127.0.0.1:11434/api/tags", timeout=2)
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

    if req.pipeline_mode:
        os.environ["PIPELINE_MODE"] = req.pipeline_mode
        set_key(env_file, "PIPELINE_MODE", req.pipeline_mode)
    if req.ollama_model:
        os.environ["OLLAMA_MODEL"] = req.ollama_model
        set_key(env_file, "OLLAMA_MODEL", req.ollama_model)
    if req.local_voice:
        os.environ["LOCAL_VOICE"] = req.local_voice
        set_key(env_file, "LOCAL_VOICE", req.local_voice)
    if req.groq_api_key:
        os.environ["GROQ_API_KEY"] = req.groq_api_key
        set_key(env_file, "GROQ_API_KEY", req.groq_api_key)
    if req.groq_model:
        os.environ["GROQ_MODEL"] = req.groq_model
        set_key(env_file, "GROQ_MODEL", req.groq_model)
    if req.elevenlabs_api_key:
        os.environ["ELEVENLABS_API_KEY"] = req.elevenlabs_api_key
        set_key(env_file, "ELEVENLABS_API_KEY", req.elevenlabs_api_key)
    if req.elevenlabs_voice_id:
        os.environ["ELEVENLABS_VOICE_ID"] = req.elevenlabs_voice_id
        set_key(env_file, "ELEVENLABS_VOICE_ID", req.elevenlabs_voice_id)

    return {"message": "Configuration updated successfully."}

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
            status_code=400,
            content={
                "error": True,
                "stage": vpe.stage,
                "message": vpe.message
            }
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
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
            status_code=400,
            content={
                "error": True,
                "stage": vpe.stage,
                "message": vpe.message
            }
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "error": True,
                "stage": "UNKNOWN",
                "message": f"Server error: {str(e)}"
            }
        )

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
