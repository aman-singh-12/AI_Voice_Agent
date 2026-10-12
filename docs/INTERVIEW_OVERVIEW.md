# Voice AI Pipeline — Interviewer Project Overview

> **Executive Technical Briefing & Architecture Summary for Technical Interviewers**

---

## 🎯 15-Second Project Summary

The **Voice AI Pipeline** is a real-time conversational voice assistant that connects browser speech recognition, streaming LLM intelligence, and low-latency speech synthesis into an interactive web pipeline without relying on closed-source agent wrappers (like Vapi or Retell).

- **Primary Pipeline (Live Call):** In-browser Web Speech API (`webkitSpeechRecognition`) $\to$ persistent WebSocket (`/ws/voice`) $\to$ FastAPI $\to$ Streaming LLM (Groq Qwen 27B LPU) $\to$ Sentence-level buffering $\to$ Background multi-threaded TTS synthesis (ElevenLabs Turbo v2.5 / edge-tts) $\to$ Base64 MP3 chunks $\to$ Client-side FIFO audio queue $\to$ Seamless audio playback.
- **Alternative Pipeline (Audio Process Fallback):** Browser Float32 PCM capture $\to$ Custom in-memory 16 kHz Mono WAV RIFF encoder $\to$ REST POST (`/api/process-audio`) $\to$ Python `SpeechRecognition` (Google Web Speech API) $\to$ LLM completion $\to$ TTS synthesis $\to$ Single Base64 audio return.

---

## 🏗️ Core Architectural Decisions

| Decision | Approach Taken | Engineering Justification | Alternative Rejected |
| :--- | :--- | :--- | :--- |
| **STT Engine (Live)** | Browser Web Speech API | **Zero network transmission** of raw client audio; instant streaming interim transcripts with near-instant client-side turn detection. | Server-side Faster-Whisper (high VRAM requirement, 600ms+ audio upload latency). |
| **Transport Protocol** | WebSocket (`/ws/voice`) | Persistent, bi-directional, full-duplex TCP framing; allows concurrent downstream text and audio streaming while handling pings. | HTTP REST polling (high handshake overhead, cannot stream discrete audio chunks). |
| **LLM Provider** | Groq LPU (`qwen/qwen3.8-27b`) | Sub-250ms Time-to-First-Token (TTFT) via specialized Language Processing Unit silicon; speeds up sentence extraction. | Standard cloud OpenAI (good quality, but 600-900ms TTFT delays initial sentence dispatch). |
| **TTS Pipelining** | Sentence Buffering + Background Workers | Chunks streaming tokens by punctuation (`.?!:;\n`) and synthesizes sentence 1 while LLM generates sentence 2. | Monolithic generation (waiting for full LLM completion introduces 2.5s+ user perceived wait). |
| **Audio Playback** | Client-side FIFO Queue | Sequential playback prevents overlapping audio and crackling while receiving out-of-band network packets. | Parallel HTML5 Audio nodes (causes chaotic overlapping voices). |

---

## 🔄 Dual Pipeline Comparison

```mermaid
flowchart TD
    subgraph PathA["PRIMARY LIVE PIPELINE (WebSocket)"]
        A1["Mic (User Speaks)"] --> A2["Web Speech API (STT)"]
        A2 -->|"JSON {type: 'text'}"| A3["WebSocket (/ws/voice)"]
        A3 --> A4["FastAPI Async Handler"]
        A4 --> A5["Groq LPU (Streaming LLM)"]
        A5 -->|"Token Stream"| A6["Sentence Buffer"]
        A6 -->|"Ready Sentence"| A7["ElevenLabs Turbo v2.5"]
        A7 -->|"Base64 MP3 Chunks"| A8["Browser FIFO Queue"]
        A8 --> A9["Speaker (Assistant Plays)"]
    end

    subgraph PathB["ALTERNATIVE FALLBACK PIPELINE (REST)"]
        B1["Mic (User Speaks)"] --> B2["Web Audio API (Float32 PCM)"]
        B2 --> B3["In-Browser 16kHz WAV Encoder"]
        B3 -->|"POST multipart/form-data"| B4["REST API (/api/process-audio)"]
        B4 --> B5["Python SpeechRecognition"]
        B5 --> B6["Google Speech API"]
        B6 --> B7["LLM Complete"]
        B7 --> B8["TTS Complete"]
        B8 -->|"JSON {audio: base64}"| B9["Speaker (Playback)"]
    end

    classDef primary fill:#e8f4fd,stroke:#1976d2,stroke-width:2px;
    classDef fallback fill:#fff3e0,stroke:#f57c00,stroke-width:2px;
    class PathA primary;
    class PathB fallback;
```

---

## ⚠️ Important Limitations & Honest Engineering Trade-Offs

1. **Half-Duplex Turn Taking (No Barge-In):** The microphone is explicitly muted via `recorder.setMuted(true)` while assistant audio plays to prevent acoustic feedback. Barge-in (interruption) requires WebRTC Acoustic Echo Cancellation (AEC), which is marked for future roadmap.
2. **Chromium Dependency for Path A:** The primary live path relies on `webkitSpeechRecognition`, natively supported in Chrome, Edge, and Brave. Firefox and Safari degrade to Path B (REST audio upload).
3. **Session Memory:** Conversation context is managed in-memory on the client and within backend session state; no long-term persistent database (Redis/PostgreSQL) is attached.
4. **No RAG:** The assistant responds strictly using LLM weights and conversational history; no vector store or external knowledge retrieval is attached.

---

## 📂 Deep-Dive Documentation Index

- [PRD (Product Requirements Document)](PRD.md) — Product vision, user stories, performance targets.
- [HLD (High-Level Design)](HLD.md) — System boundaries, network topology, provider architectures.
- [LLD (Low-Level Design)](LLD.md) — Module schemas, WebSocket protocol, threading models, method contracts.
- [Challenges & Difficulties](../CHALLENGES_AND_DIFFICULTIES.md) — Exhaustive analysis of 10 real engineering hurdles solved.
- [Technical Project Audit](../PROJECT_COMPLETE_TECHNICAL_AUDIT.md) — 18-part comprehensive code audit with line-by-line verification.
