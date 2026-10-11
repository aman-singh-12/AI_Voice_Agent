"""
Comprehensive Automated Test Suite for Unified Cloud LLM Architecture
Tests:
- Groq Provider (Auth, streaming, 404 model not found handling, rate limits, timeouts, dynamic model listing)
- OpenAI Provider (Auth, streaming, model validation, error mapping)
- Google Gemini Provider (Official SDK, streaming, error mapping)
- UnifiedLLMManager (Dynamic provider selection, switching, history preservation, single active key requirement)
- VoicePipeline Integration (Voice & text pipelines, LLM error propagation, ElevenLabs TTS with fallback)
- WebSocket Streaming Regression (Streaming tokens: llm_start, llm_chunk, llm_done, response)
"""

import os
import json
import pytest
from unittest.mock import MagicMock, patch

from llm_service import (
    GroqProvider,
    OpenAIProvider,
    GeminiProvider,
    LocalOllamaProvider,
    UnifiedLLMManager,
    LLMProviderError
)
from pipeline import VoicePipeline, VoicePipelineError


# ============================================================================
# 1. Groq Provider Tests
# ============================================================================

class TestGroqProvider:
    def test_missing_api_key(self):
        provider = GroqProvider(api_key="", model="qwen/qwen3.8-27b")
        assert not provider.is_configured()
        
        # verify_connection should report Not Configured
        result = provider.verify_connection()
        assert result["connected"] is False
        assert result["status"] == "Not Configured"

        # Calling generate_response without key should raise LLMProviderError
        with pytest.raises(LLMProviderError) as exc_info:
            provider.generate_response("Hello")
        assert "missing" in str(exc_info.value).lower()

    def test_configured_with_api_key(self):
        provider = GroqProvider(api_key="gsk_test123", model="qwen/qwen3.8-27b")
        assert provider.is_configured()
        assert provider.model == "qwen/qwen3.8-27b"

    @patch("groq.Groq")
    def test_streaming_success(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client

        # Mock streaming chunks from Groq API
        chunk1 = MagicMock()
        chunk1.choices = [MagicMock(delta=MagicMock(content="Hello "))]
        chunk2 = MagicMock()
        chunk2.choices = [MagicMock(delta=MagicMock(content="from Groq!"))]
        mock_client.chat.completions.create.return_value = iter([chunk1, chunk2])

        provider = GroqProvider(api_key="gsk_test123", model="qwen/qwen3.8-27b")
        chunks = list(provider.generate_stream("Hi"))
        
        assert len(chunks) == 2
        assert "".join(chunks) == "Hello from Groq!"

    @patch("groq.Groq")
    def test_model_404_error_handling(self, mock_client_cls):
        """Tests that the exact 404 'model does not exist' is intercepted and mapped to Model Unavailable."""
        import groq
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client
        
        response_mock = MagicMock()
        response_mock.status_code = 404
        mock_client.chat.completions.create.side_effect = groq.NotFoundError(
            message="The model 'llama-3.3-70b-versatile' does not exist or you do not have access to it.",
            response=response_mock,
            body={"error": {"code": "model_not_found"}}
        )

        provider = GroqProvider(api_key="gsk_test123", model="llama-3.3-70b-versatile")
        with pytest.raises(LLMProviderError) as exc_info:
            list(provider.generate_stream("Hi"))
        assert exc_info.value.status_code == 404
        assert "not accessible" in exc_info.value.message or "llama-3.3-70b-versatile" in exc_info.value.message

    @patch("groq.Groq")
    def test_rate_limit_error(self, mock_client_cls):
        import groq
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client
        response_mock = MagicMock()
        response_mock.status_code = 429
        mock_client.chat.completions.create.side_effect = groq.RateLimitError(
            message="Rate limit reached",
            response=response_mock,
            body={"error": {"code": "rate_limit_exceeded"}}
        )

        provider = GroqProvider(api_key="gsk_test123", model="qwen/qwen3.8-27b")
        with pytest.raises(LLMProviderError) as exc_info:
            list(provider.generate_stream("Hi"))
        assert exc_info.value.status_code == 429
        assert "rate limit" in exc_info.value.message.lower()

    @patch("groq.Groq")
    def test_timeout_error(self, mock_client_cls):
        import groq
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client
        mock_client.chat.completions.create.side_effect = groq.APITimeoutError(request=MagicMock())

        provider = GroqProvider(api_key="gsk_test123", model="qwen/qwen3.8-27b")
        with pytest.raises(LLMProviderError) as exc_info:
            list(provider.generate_stream("Hi"))
        assert "timed out" in exc_info.value.message.lower()

    @patch("groq.Groq")
    def test_dynamic_model_listing(self, mock_client_cls):
        provider = GroqProvider(api_key="gsk_test123", model="qwen/qwen3.8-27b")
        models = provider.list_available_models()
        assert models == ["qwen/qwen3.8-27b"]


# ============================================================================
# 2. OpenAI Provider Tests
# ============================================================================

class TestOpenAIProvider:
    def test_missing_api_key(self):
        provider = OpenAIProvider(api_key="", model="gpt-4o-mini")
        assert not provider.is_configured()
        res = provider.verify_connection()
        assert res["connected"] is False
        assert res["status"] == "Not Configured"

    @patch("openai.OpenAI")
    def test_streaming_success(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client

        c1 = MagicMock()
        c1.choices = [MagicMock(delta=MagicMock(content="OpenAI "))]
        c2 = MagicMock()
        c2.choices = [MagicMock(delta=MagicMock(content="response."))]
        mock_client.chat.completions.create.return_value = iter([c1, c2])

        provider = OpenAIProvider(api_key="sk-test", model="gpt-4o-mini")
        chunks = list(provider.generate_stream("Hello"))
        assert "".join(chunks) == "OpenAI response."

    @patch("openai.OpenAI")
    def test_auth_error(self, mock_client_cls):
        import openai
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client
        response_mock = MagicMock()
        response_mock.status_code = 401
        mock_client.chat.completions.create.side_effect = openai.AuthenticationError(
            message="Incorrect API key provided",
            response=response_mock,
            body={"error": {"code": "invalid_api_key"}}
        )

        provider = OpenAIProvider(api_key="sk-bad", model="gpt-4o-mini")
        with pytest.raises(LLMProviderError) as exc_info:
            list(provider.generate_stream("Hello"))
        assert exc_info.value.status_code == 401
        assert "authentication failed" in exc_info.value.message.lower()

    @patch("openai.OpenAI")
    def test_model_not_found(self, mock_client_cls):
        import openai
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client
        response_mock = MagicMock()
        response_mock.status_code = 404
        mock_client.chat.completions.create.side_effect = openai.NotFoundError(
            message="The model does not exist",
            response=response_mock,
            body={"error": {"code": "model_not_found"}}
        )

        provider = OpenAIProvider(api_key="sk-test", model="nonexistent-model")
        with pytest.raises(LLMProviderError) as exc_info:
            list(provider.generate_stream("Hello"))
        assert exc_info.value.status_code == 404


# ============================================================================
# 3. Google Gemini Provider Tests
# ============================================================================

class TestGeminiProvider:
    def test_missing_api_key(self):
        provider = GeminiProvider(api_key="", model="gemini-2.5-flash")
        assert not provider.is_configured()
        res = provider.verify_connection()
        assert res["connected"] is False
        assert res["status"] == "Not Configured"

    @patch("google.genai.Client")
    def test_streaming_success(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client

        c1 = MagicMock(text="Gemini ")
        c2 = MagicMock(text="is online.")
        mock_client.models.generate_content_stream.return_value = iter([c1, c2])

        provider = GeminiProvider(api_key="AIzaSyTest", model="gemini-2.5-flash")
        chunks = list(provider.generate_stream("Hello"))
        assert "".join(chunks) == "Gemini is online."

    @patch("google.genai.Client")
    def test_generate_response_non_streaming(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client

        resp_mock = MagicMock(text="Single response")
        mock_client.models.generate_content_stream.return_value = iter([resp_mock])

        provider = GeminiProvider(api_key="AIzaSyTest", model="gemini-2.5-flash")
        resp = provider.generate_response("Hello")
        assert resp == "Single response"


# ============================================================================
# 4. Unified LLM Manager & Dynamic Switching Tests
# ============================================================================

class TestUnifiedLLMManager:
    def test_init_and_provider_resolution(self):
        with patch.dict(os.environ, {"LLM_PROVIDER": "groq", "GROQ_API_KEY": "gsk_123"}, clear=False):
            manager = UnifiedLLMManager()
            assert manager.resolve_active_provider_name() == "groq"

    def test_dynamic_switching(self):
        manager = UnifiedLLMManager()
        
        manager.set_active_provider("openai")
        assert os.environ.get("LLM_PROVIDER") == "openai"
        assert manager.resolve_active_provider_name() == "openai"

        manager.set_active_provider("gemini")
        assert os.environ.get("LLM_PROVIDER") == "gemini"
        assert manager.resolve_active_provider_name() == "gemini"

    def test_only_selected_provider_requires_active_key(self):
        manager = UnifiedLLMManager()
        # Configure only OpenAI
        manager.providers["groq"].api_key = ""
        manager.providers["gemini"].api_key = ""
        
        mock_openai = MagicMock()
        mock_openai.is_configured.return_value = True
        mock_openai.generate_stream.return_value = iter(["Hello ", "world!"])
        manager.providers["openai"] = mock_openai
        manager.set_active_provider("openai")

        chunks = list(manager.generate_stream("Hi"))
        assert "".join(chunks) == "Hello world!"

    def test_conversation_history_preservation(self):
        manager = UnifiedLLMManager()
        mock_groq = MagicMock()
        mock_groq.generate_stream.return_value = iter(["Answer."])
        manager.providers["groq"] = mock_groq
        manager.set_active_provider("groq")

        history = [{"role": "user", "content": "My name is Alice."}]
        list(manager.generate_stream("What is my name?", conversation_history=history))

        mock_groq.generate_stream.assert_called_once_with(
            "What is my name?",
            history,
            None
        )

    def test_safe_status_reporting_no_raw_keys(self):
        with patch.dict(os.environ, {"GROQ_API_KEY": "gsk_secret123", "OPENAI_API_KEY": "sk_secret456"}, clear=False):
            manager = UnifiedLLMManager()
            status = manager.get_all_providers_status()
            
            # Verify status dictionary does NOT contain raw keys
            status_json = json.dumps(status)
            assert "gsk_secret123" not in status_json
            assert "sk_secret456" not in status_json
            assert "groq" in status["providers"]
            assert "openai" in status["providers"]
            assert "gemini" in status["providers"]


# ============================================================================
# 5. Voice Pipeline Integration & TTS Fallback Tests
# ============================================================================

class TestPipelineIntegration:
    def test_process_text_with_unified_llm_and_tts(self):
        pipeline = VoicePipeline()
        
        # Mock LLM manager
        mock_llm = MagicMock()
        mock_llm.resolve_active_provider_name.return_value = "groq"
        mock_llm.generate_response.return_value = "Spoken answer from cloud LLM."
        pipeline.llm_manager = mock_llm

        # Mock ElevenLabs synthesize
        pipeline.cloud_tts.synthesize = MagicMock(return_value=b"AUDIO_DATA_MP3")

        result = pipeline.process_text_only(
            user_text="Hello pipeline",
            custom_keys={"llm_provider": "groq", "elevenlabs_api_key": "xi_test"}
        )

        assert result["assistant_text"] == "Spoken answer from cloud LLM."
        assert result["provider"] == "groq"
        assert result["audio_url"].startswith("data:audio/mp3;base64,")

    def test_elevenlabs_fallback_to_neural_tts(self):
        pipeline = VoicePipeline()

        # Mock LLM
        mock_llm = MagicMock()
        mock_llm.resolve_active_provider_name.return_value = "groq"
        mock_llm.generate_response.return_value = "Fallback text."
        pipeline.llm_manager = mock_llm

        # ElevenLabs fails with quota exceeded -> local_tts succeeds
        pipeline.cloud_tts.synthesize = MagicMock(side_effect=Exception("ElevenLabs quota exceeded"))
        pipeline.local_tts.synthesize = MagicMock(return_value=b"LOCAL_NEURAL_BYTES")

        result = pipeline.process_text_only(
            user_text="Test fallback",
            custom_keys={"llm_provider": "groq", "elevenlabs_api_key": "xi_test"}
        )

        assert result["assistant_text"] == "Fallback text."
        assert pipeline.local_tts.synthesize.called
        assert result["audio_url"].startswith("data:audio/mp3;base64,")


# ============================================================================
# 6. WebSocket Streaming Regression Tests
# ============================================================================

class TestWebSocketStreaming:
    def test_websocket_streaming_flow(self):
        from starlette.testclient import TestClient
        from app import app, pipeline

        # Mock voice pipeline's stream_llm to yield chunks
        def mock_stream_llm(*args, **kwargs):
            yield "Streaming "
            yield "voice response."

        client = TestClient(app)
        
        with patch.object(pipeline, "stream_llm", side_effect=mock_stream_llm), \
             patch.object(pipeline.local_tts, "synthesize", return_value=b"AUDIO"), \
             client.websocket_connect("/ws/voice") as websocket:
            
            websocket.send_json({"text": "Hello WebSocket", "history": []})

            # Expect llm_start
            msg1 = websocket.receive_json()
            assert msg1["type"] == "llm_start"
            assert "provider" in msg1

            # Expect first chunk
            msg2 = websocket.receive_json()
            assert msg2["type"] == "llm_chunk"
            assert msg2["chunk"] == "Streaming "

            # Expect second chunk
            msg3 = websocket.receive_json()
            assert msg3["type"] == "llm_chunk"
            assert msg3["chunk"] == "voice response."

            # Expect llm_done
            msg4 = websocket.receive_json()
            assert msg4["type"] == "llm_done"
            assert msg4["full_text"] == "Streaming voice response."

            # Expect final response packet
            msg5 = websocket.receive_json()
            assert msg5["type"] == "response"
            assert msg5["llm_text"] == "Streaming voice response."
