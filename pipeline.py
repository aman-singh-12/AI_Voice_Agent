import io
import os
import time
import base64
import asyncio
import tempfile
import subprocess
import requests
import speech_recognition as sr
from openai import OpenAI
from typing import Dict, Any, List, Optional
from dotenv import load_dotenv

# Safe import for Edge TTS
try:
    import edge_tts
    HAS_EDGE_TTS = True
except ImportError:
    edge_tts = None
    HAS_EDGE_TTS = False

load_dotenv()

class VoicePipelineError(Exception):
    """Custom exception for Voice Pipeline errors with stage information."""
    def __init__(self, stage: str, message: str, original_error: Optional[Exception] = None):
        self.stage = stage
        self.message = message
        self.original_error = original_error
        super().__init__(f"[{stage.upper()} ERROR] {message}")


class SpeechToTextService:
    """STT Service supporting Groq Whisper Turbo (<250ms) and fast SpeechRecognition."""
    
    def __init__(self, groq_api_key: Optional[str] = None):
        self.groq_api_key = groq_api_key or os.getenv("GROQ_API_KEY", "")
        self.recognizer = sr.Recognizer()
        self.recognizer.energy_threshold = 200
        self.recognizer.dynamic_energy_threshold = False
        self.recognizer.pause_threshold = 0.4
        self.recognizer.non_speaking_duration = 0.2

    def transcribe(self, audio_bytes: bytes, language: str = "en-US", groq_api_key: Optional[str] = None) -> str:
        """
        Transcribes PCM WAV audio bytes into text in under 300ms using Groq Whisper Turbo or Google STT.
        """
        if not audio_bytes or len(audio_bytes) < 100:
            raise VoicePipelineError("STT", "Audio payload is empty or too short.")

        key = groq_api_key or self.groq_api_key or os.getenv("GROQ_API_KEY", "")

        # Priority 1: Groq Whisper Turbo (Incredible speed ~180-250ms)
        if key and key != "your_groq_api_key_here":
            try:
                client = OpenAI(api_key=key, base_url="https://api.groq.com/openai/v1")
                audio_file = io.BytesIO(audio_bytes)
                audio_file.name = "recording.wav"
                
                transcription = client.audio.transcriptions.create(
                    file=audio_file,
                    model="whisper-large-v3-turbo",
                    language="en",
                    response_format="text",
                    temperature=0.0
                )
                text = str(transcription).strip()
                if text:
                    return text
            except Exception as e:
                print(f"[STT] Groq Whisper fallback to native STT: {e}")

        # Priority 2: In-Memory Google Speech Recognition (<1s)
        temp_file = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
                temp_file = tf.name
                tf.write(audio_bytes)
                tf.flush()

            with sr.AudioFile(temp_file) as source:
                audio_data = self.recognizer.record(source)

            text = self.recognizer.recognize_google(audio_data, language=language)
            if not text or not text.strip():
                raise VoicePipelineError("STT", "No speech detected in the audio.")
            return text.strip()

        except sr.UnknownValueError:
            raise VoicePipelineError("STT", "Could not understand the audio. Please speak clearly into the microphone.")
        except sr.RequestError as e:
            raise VoicePipelineError("STT", f"Speech recognition service request failed: {str(e)}")
        except Exception as e:
            if isinstance(e, VoicePipelineError):
                raise e
            raise VoicePipelineError("STT", f"Failed to process audio: {str(e)}", e)
        finally:
            if temp_file and os.path.exists(temp_file):
                try:
                    os.remove(temp_file)
                except Exception:
                    pass


class LocalOllamaLLMService:
    """Local LLM Service using local Ollama instance (Qwen 2.5) optimized for CPU."""

    DEFAULT_SYSTEM_PROMPT = (
        "You are a friendly, helpful voice assistant for customer care. "
        "Answer clearly and conversationally in 1 or 2 natural spoken sentences. "
        "Ignore filler words like 'hmm', 'uh', 'like' and address the user's core intent. "
        "Do not use markdown, bullet points, asterisks, or robotic phrasing."
    )

    OLLAMA_API_URL = "http://127.0.0.1:11434/api/chat"

    def __init__(self, model: str = "qwen2.5:1.5b", base_url: str = "http://127.0.0.1:11434/api/chat"):
        self.model = model
        self.base_url = base_url

    def generate_response(self, prompt: str, conversation_history: Optional[List[Dict[str, str]]] = None, system_prompt: Optional[str] = None) -> str:
        """
        Generates fast conversational response using direct Ollama API with multi-threading.
        """
        try:
            sys_prompt = system_prompt or self.DEFAULT_SYSTEM_PROMPT
            messages = [{"role": "system", "content": sys_prompt}]
            
            if conversation_history:
                for msg in conversation_history[-2:]:
                    if msg.get("role") in ("user", "assistant") and msg.get("content"):
                        messages.append({"role": msg["role"], "content": msg["content"]})
            
            messages.append({"role": "user", "content": prompt})

            payload = {
                "model": self.model,
                "messages": messages,
                "stream": False,
                "options": {
                    "num_thread": 8,
                    "num_predict": 35,
                    "num_ctx": 256,
                    "temperature": 0.4,
                    "top_k": 20
                }
            }

            resp = requests.post("http://127.0.0.1:11434/api/chat", json=payload, timeout=8)
            if resp.status_code == 200:
                data = resp.json()
                answer = data.get("message", {}).get("content", "").strip()
                return answer if answer else "I'm listening, how can I help you today?"
            else:
                raise Exception(f"Ollama returned HTTP {resp.status_code}: {resp.text}")

        except Exception as e:
            raise VoicePipelineError("LLM", f"Local Ollama generation failed: {str(e)}. Ensure Ollama is running.", e)


class GroqLLMService:
    """Cloud LLM Service using Groq API for ultra-low latency (<200ms)."""

    DEFAULT_SYSTEM_PROMPT = (
        "You are a friendly, fast, and helpful voice AI customer care assistant. "
        "Answer clearly and warmly in 1 or 2 natural spoken sentences. "
        "Ignore conversational filler words like 'hmm', 'uh', 'like' and focus on the user's real question. "
        "Never use markdown, lists, or asterisks."
    )

    GROQ_BASE_URL = "https://api.groq.com/openai/v1"

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None):
        self.api_key = api_key or os.getenv("GROQ_API_KEY", "")
        self.model = model or os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")

    def _get_client(self) -> OpenAI:
        key = self.api_key or os.getenv("GROQ_API_KEY", "")
        if not key or key == "your_groq_api_key_here":
            raise VoicePipelineError(
                "LLM", 
                "Groq API Key is missing. Please configure GROQ_API_KEY in .env or Settings modal in the frontend."
            )
        return OpenAI(api_key=key, base_url=self.GROQ_BASE_URL)

    def generate_response(self, prompt: str, conversation_history: Optional[List[Dict[str, str]]] = None, system_prompt: Optional[str] = None) -> str:
        try:
            client = self._get_client()
            sys_prompt = system_prompt or self.DEFAULT_SYSTEM_PROMPT
            messages = [{"role": "system", "content": sys_prompt}]
            
            if conversation_history:
                for msg in conversation_history[-2:]:
                    if msg.get("role") in ("user", "assistant") and msg.get("content"):
                        messages.append({"role": msg["role"], "content": msg["content"]})
            
            messages.append({"role": "user", "content": prompt})

            response = client.chat.completions.create(
                model=self.model,
                messages=messages,
                max_tokens=60,
                temperature=0.5,
            )

            answer = response.choices[0].message.content
            return answer.strip() if answer else "I didn't have anything to say."

        except Exception as e:
            if isinstance(e, VoicePipelineError):
                raise e
            raise VoicePipelineError("LLM", f"Groq LLM generation failed: {str(e)}", e)


class LocalNeuralTTSService:
    """Local Free Neural TTS Service using edge-tts with Windows SAPI fallback."""

    def __init__(self, voice: str = "en-US-JennyNeural"):
        self.voice = voice

    def synthesize(self, text: str, voice: Optional[str] = None) -> bytes:
        v = voice or self.voice
        
        # Method 1: Edge TTS Neural Voice
        if HAS_EDGE_TTS and edge_tts is not None:
            try:
                async def _stream_edge():
                    communicate = edge_tts.Communicate(text, v, rate="+15%") # 15% faster speech for lower turnaround
                    out_bytes = b""
                    async for chunk in communicate.stream():
                        if chunk.get("type") == "audio":
                            out_bytes += chunk.get("data", b"")
                    return out_bytes

                try:
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        import concurrent.futures
                        with concurrent.futures.ThreadPoolExecutor() as pool:
                            return pool.submit(lambda: asyncio.run(_stream_edge())).result()
                    else:
                        return loop.run_until_complete(_stream_edge())
                except RuntimeError:
                    return asyncio.run(_stream_edge())

            except Exception:
                pass

        # Method 2: Native Windows SAPI Speech Synthesizer fallback
        try:
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
                temp_wav = tf.name

            safe_text = text.replace('"', '`"').replace("'", "''").replace("\n", " ")
            ps_script = (
                f"Add-Type -AssemblyName System.Speech; "
                f"$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
                f"$synth.Rate = 2; "
                f"$synth.SetOutputToWaveFile('{temp_wav}'); "
                f"$synth.Speak('{safe_text}'); "
                f"$synth.Dispose()"
            )
            subprocess.run(["powershell", "-NoProfile", "-Command", ps_script], capture_output=True, check=True)

            with open(temp_wav, "rb") as f:
                data = f.read()

            try:
                os.remove(temp_wav)
            except Exception:
                pass

            return data

        except Exception as e:
            raise VoicePipelineError("TTS", f"Local TTS synthesis failed: {str(e)}", e)


class ElevenLabsTTSService:
    """TTS Service using ElevenLabs Turbo REST API (<400ms)."""

    def __init__(self, api_key: Optional[str] = None, voice_id: Optional[str] = None):
        self.api_key = api_key or os.getenv("ELEVENLABS_API_KEY", "")
        self.voice_id = voice_id or os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")

    def synthesize(self, text: str, voice_id: Optional[str] = None, api_key: Optional[str] = None) -> bytes:
        key = api_key or self.api_key or os.getenv("ELEVENLABS_API_KEY", "")
        if not key or key == "your_elevenlabs_api_key_here":
            raise VoicePipelineError(
                "TTS",
                "ElevenLabs API Key is missing. Please configure ELEVENLABS_API_KEY in .env or Settings modal."
            )

        v_id = voice_id or self.voice_id or os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{v_id}"

        headers = {
            "Accept": "audio/mpeg",
            "Content-Type": "application/json",
            "xi-api-key": key
        }

        # eleven_turbo_v2_5 is ElevenLabs' lowest-latency model
        payload = {
            "text": text,
            "model_id": "eleven_turbo_v2_5",
            "voice_settings": {
                "stability": 0.45,
                "similarity_boost": 0.7,
                "use_speaker_boost": False
            }
        }

        try:
            response = requests.post(url, json=payload, headers=headers, timeout=10)
            if response.status_code != 200:
                try:
                    err_json = response.json()
                    detail = err_json.get("detail", {}).get("message", response.text)
                except Exception:
                    detail = response.text
                raise VoicePipelineError("TTS", f"ElevenLabs API error (HTTP {response.status_code}): {detail}")

            return response.content

        except requests.RequestException as e:
            raise VoicePipelineError("TTS", f"ElevenLabs network request failed: {str(e)}", e)


class VoicePipeline:
    """
    Unified Voice AI Pipeline supporting:
    1. 100% Local Mode: SpeechRecognition -> Local Ollama (Qwen 2.5) -> Local Neural TTS (0 API Keys)
    2. Cloud Mode: SpeechRecognition -> Groq -> ElevenLabs
    """

    def __init__(self):
        self.stt = SpeechToTextService()
        self.local_llm = LocalOllamaLLMService()
        self.cloud_llm = GroqLLMService()
        self.local_tts = LocalNeuralTTSService()
        self.cloud_tts = ElevenLabsTTSService()
        self.mode = os.getenv("PIPELINE_MODE", "local")

    def process_voice(
        self,
        audio_bytes: bytes,
        conversation_history: Optional[List[Dict[str, str]]] = None,
        custom_keys: Optional[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        metrics = {}
        total_start = time.time()
        
        keys = custom_keys or {}
        active_mode = keys.get("pipeline_mode", self.mode)

        # Dynamic parameter overrides
        if keys.get("ollama_model"):
            self.local_llm.model = keys["ollama_model"]
        if keys.get("local_voice"):
            self.local_tts.voice = keys["local_voice"]
        if keys.get("groq_api_key"):
            self.cloud_llm.api_key = keys["groq_api_key"]
        if keys.get("groq_model"):
            self.cloud_llm.model = keys["groq_model"]
        if keys.get("elevenlabs_api_key"):
            self.cloud_tts.api_key = keys["elevenlabs_api_key"]
        if keys.get("elevenlabs_voice_id"):
            self.cloud_tts.voice_id = keys["elevenlabs_voice_id"]

        # Step 1: STT
        stt_start = time.time()
        groq_k = keys.get("groq_api_key") or os.getenv("GROQ_API_KEY")
        user_text = self.stt.transcribe(audio_bytes, groq_api_key=groq_k)
        metrics["stt_time_ms"] = round((time.time() - stt_start) * 1000, 2)

        # Step 2: LLM
        llm_start = time.time()
        if active_mode == "local":
            assistant_text = self.local_llm.generate_response(
                prompt=user_text,
                conversation_history=conversation_history
            )
        else:
            assistant_text = self.cloud_llm.generate_response(
                prompt=user_text,
                conversation_history=conversation_history
            )
        metrics["llm_time_ms"] = round((time.time() - llm_start) * 1000, 2)

        # Step 3: TTS
        tts_start = time.time()
        if active_mode == "local" or (not keys.get("elevenlabs_api_key") and not os.getenv("ELEVENLABS_API_KEY")):
            audio_mp3_bytes = self.local_tts.synthesize(assistant_text)
        else:
            audio_mp3_bytes = self.cloud_tts.synthesize(assistant_text)
        metrics["tts_time_ms"] = round((time.time() - tts_start) * 1000, 2)

        metrics["total_time_ms"] = round((time.time() - total_start) * 1000, 2)

        audio_base64 = base64.b64encode(audio_mp3_bytes).decode("utf-8")
        audio_data_uri = f"data:audio/mp3;base64,{audio_base64}"

        return {
            "user_text": user_text,
            "assistant_text": assistant_text,
            "audio_url": audio_data_uri,
            "metrics": metrics,
            "mode": active_mode
        }

    def process_text_only(
        self,
        user_text: str,
        conversation_history: Optional[List[Dict[str, str]]] = None,
        custom_keys: Optional[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        metrics = {}
        total_start = time.time()

        keys = custom_keys or {}
        active_mode = keys.get("pipeline_mode", self.mode)

        if keys.get("ollama_model"):
            self.local_llm.model = keys["ollama_model"]
        if keys.get("local_voice"):
            self.local_tts.voice = keys["local_voice"]
        if keys.get("groq_api_key"):
            self.cloud_llm.api_key = keys["groq_api_key"]
        if keys.get("groq_model"):
            self.cloud_llm.model = keys["groq_model"]
        if keys.get("elevenlabs_api_key"):
            self.cloud_tts.api_key = keys["elevenlabs_api_key"]
        if keys.get("elevenlabs_voice_id"):
            self.cloud_tts.voice_id = keys["elevenlabs_voice_id"]

        metrics["stt_time_ms"] = 0

        # LLM
        llm_start = time.time()
        if active_mode == "local":
            assistant_text = self.local_llm.generate_response(
                prompt=user_text,
                conversation_history=conversation_history
            )
        else:
            assistant_text = self.cloud_llm.generate_response(
                prompt=user_text,
                conversation_history=conversation_history
            )
        metrics["llm_time_ms"] = round((time.time() - llm_start) * 1000, 2)

        # TTS
        tts_start = time.time()
        if active_mode == "local" or (not keys.get("elevenlabs_api_key") and not os.getenv("ELEVENLABS_API_KEY")):
            audio_mp3_bytes = self.local_tts.synthesize(assistant_text)
        else:
            audio_mp3_bytes = self.cloud_tts.synthesize(assistant_text)
        metrics["tts_time_ms"] = round((time.time() - tts_start) * 1000, 2)

        metrics["total_time_ms"] = round((time.time() - total_start) * 1000, 2)

        audio_base64 = base64.b64encode(audio_mp3_bytes).decode("utf-8")
        audio_data_uri = f"data:audio/mp3;base64,{audio_base64}"

        return {
            "user_text": user_text,
            "assistant_text": assistant_text,
            "audio_url": audio_data_uri,
            "metrics": metrics,
            "mode": active_mode
        }
