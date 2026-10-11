# 🎙️ Voice AI Agent Pipeline (Built From Scratch)

A high-performance, end-to-end Voice AI Agent pipeline built from scratch without third-party voice orchestration platforms (no VAPI, no Retell). The system captures user voice input from the browser, transcribes it using **Python's SpeechRecognition**, generates ultra-fast conversational intelligence using **Groq (LPUs)**, synthesizes natural human voice via **ElevenLabs TTS**, and streams the audio back into the browser in real-time.

---

## 🏛️ Pipeline Architecture

```
[ Web Browser ]
      │  🎤 User speaks (Recorded as 16-bit PCM WAV)
      ▼
[ 1. STT Engine ] ──► Python SpeechRecognition (Audio ➔ Text)
      │
      ▼
[ 2. LLM Engine ] ──► Groq API (Ultra-low latency LPU inference: Qwen 2.5 / GPT-OSS)
      │
      ▼
[ 3. TTS Engine ] ──► ElevenLabs REST API (Text ➔ MP3 Voice Stream)
      │
      ▼
[ Web Browser ] ──► 🔊 Assistant Speaks (Auto-played with Visualizer)
```

---

## 📦 Tech Stack & Modules

| Component | Technology | Role |
| :--- | :--- | :--- |
| **Backend** | FastAPI + Uvicorn | Lightweight asynchronous server & API routing |
| **Speech-to-Text (STT)** | Python `SpeechRecognition` | Native Python STT processing 16-bit PCM WAV audio |
| **LLM Reasoning** | Groq API (`qwen/qwen3.8-27b`) | Ultra-fast LPU conversational reasoning (~150-300ms latency) |
| **Text-to-Speech (TTS)**| ElevenLabs API | High-fidelity voice synthesis (`eleven_multilingual_v2`) |
| **Frontend** | Vanilla JS + HTML5 Web Audio API | Custom PCM WAV encoder, dynamic waveform visualizer, responsive dark UI |

---

## 🚀 Quickstart Guide

### 1. Prerequisites
- Python 3.10+ installed
- Microphone and Modern Web Browser (Chrome / Edge / Firefox)

### 2. Setup Environment

```bash
# 1. Activate the virtual environment
.\venv\Scripts\activate   # (Windows)
# or: source venv/bin/activate (Linux/Mac)

# 2. Configure API Keys in .env (or configure inside the web UI)
cp .env.example .env
```

Edit `.env` and fill in your keys:
```env
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM

GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=qwen/qwen3.8-27b
```

### 3. Run the Server

```bash
.\venv\Scripts\python.exe run_server.py
```

Open your browser at:
👉 **[http://localhost:8001](http://localhost:8001)**

---

## ⚙️ Key Features

- **📞 Hands-Free Live Call Mode (VAD)**: Real-time Voice Activity Detection. When you speak and pause for **1.0 second**, the audio is automatically processed and spoken back. As soon as the assistant finishes speaking, it automatically returns to listening mode for a seamless phone-call experience.
- **💻 100% Local Execution (0 API Keys Required)**: Runs locally with Python `SpeechRecognition` + Ollama `qwen2.5:1.5b` + Free Neural TTS.
- **☁️ Cloud Acceleration Mode**: Toggle to Groq (LPU) + ElevenLabs anytime with 1 click.
- **In-Browser 16-bit PCM WAV Encoder**: Zero external `ffmpeg` dependencies.
- **Live Latency Telemetry**: Real-time breakdown for STT, LLM, TTS, and Total Roundtrip.
- **Dual Interaction Modes**:
  - *Click-to-Toggle*: Click to start recording, click again when done.
  - *Hold-to-Talk*: Press and hold the orb or **Spacebar** to speak.
- **Settings Panel**: Input or swap ElevenLabs & Groq API keys and voice models directly in the UI without restarting the server.
- **Fallback Text Mode**: Test LLM + Voice responses directly with text prompts.
