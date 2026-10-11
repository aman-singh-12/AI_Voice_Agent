"""
Unified Cloud LLM Architecture for Voice AI Agent
Supports: Groq, OpenAI, Google Gemini, and Local Ollama (fallback)
"""

import os
import time
from typing import Dict, Any, List, Optional, Iterator
from abc import ABC, abstractmethod
from dotenv import load_dotenv

load_dotenv()

DEFAULT_SYSTEM_PROMPT = (
    "You are a friendly, articulate voice AI assistant on a live phone call. "
    "Provide a direct, complete, and helpful spoken answer in 2 to 3 natural sentences (around 30-45 words total). "
    "Never use lists, numbers, asterisks, bullet points, or markdown formatting. "
    "Always finish every sentence and thought completely."
)

class LLMProviderError(Exception):
    """Exception raised by LLM providers with stage, provider, and error details."""
    def __init__(self, provider: str, message: str, stage: str = "LLM", original_error: Optional[Exception] = None, status_code: Optional[int] = None):
        self.stage = stage
        self.provider = provider
        self.message = message
        self.original_error = original_error
        self.status_code = status_code
        super().__init__(f"[{provider.upper()} LLM ERROR] {message}")


def format_messages(prompt: str, conversation_history: Optional[List[Dict[str, str]]] = None, system_prompt: Optional[str] = None) -> List[Dict[str, str]]:
    """Standardizes conversation history and current prompt into role/content list."""
    sys_prompt = system_prompt or DEFAULT_SYSTEM_PROMPT
    messages = [{"role": "system", "content": sys_prompt}]
    for msg in conversation_history or []:
        role = msg.get("role")
        content = msg.get("content")
        if role in {"user", "assistant"} and isinstance(content, str) and content.strip():
            messages.append({"role": role, "content": content.strip()})
    messages.append({"role": "user", "content": prompt.strip()})
    return messages


class BaseLLMProvider(ABC):
    """Abstract Base Class for all LLM providers."""
    
    def __init__(self, name: str, api_key: Optional[str] = None, model: Optional[str] = None, temperature: float = 0.7, max_tokens: int = 150):
        self.name = name
        self.api_key = api_key
        self.model = model
        self.temperature = float(os.getenv("LLM_TEMPERATURE", str(temperature)))
        self.max_tokens = int(os.getenv("LLM_MAX_TOKENS", str(max_tokens)))

    @abstractmethod
    def generate_response(self, prompt: str, conversation_history: Optional[List[Dict[str, str]]] = None, system_prompt: Optional[str] = None) -> str:
        """Generates a complete text response."""
        pass

    @abstractmethod
    def generate_stream(self, prompt: str, conversation_history: Optional[List[Dict[str, str]]] = None, system_prompt: Optional[str] = None) -> Iterator[str]:
        """Generates a streaming text response, yielding string chunks."""
        pass

    @abstractmethod
    def verify_connection(self) -> Dict[str, Any]:
        """Verifies API key and model availability."""
        pass

    @abstractmethod
    def list_available_models(self) -> List[str]:
        """Lists accessible models."""
        pass

    @abstractmethod
    def is_configured(self) -> bool:
        """Returns True if the required configuration is present."""
        pass


class GroqProvider(BaseLLMProvider):
    """Groq Cloud LPU Provider using official groq SDK."""

    RECOMMENDED_MODELS = [
        "qwen/qwen3.8-27b"
    ]

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None, temperature: float = 0.7, max_tokens: int = 150):
        key = api_key if api_key is not None else os.getenv("GROQ_API_KEY", "")
        # Strictly sanitize model to eliminate deprecated llama models
        if model and "llama" not in model.lower():
            selected_model = model
        else:
            env_model = os.getenv("GROQ_MODEL", "").strip()
            selected_model = env_model if (env_model and "llama" not in env_model.lower()) else "qwen/qwen3.8-27b"
        super().__init__(name="groq", api_key=key, model=selected_model, temperature=temperature, max_tokens=max_tokens)

    def _get_client(self):
        key = (self.api_key or os.getenv("GROQ_API_KEY", "")).strip()
        if not key or key == "your_groq_api_key_here":
            raise LLMProviderError(
                provider="groq",
                message="Groq API key is missing. Configure GROQ_API_KEY in the backend environment or Settings.",
                status_code=401
            )
        try:
            from groq import Groq
            return Groq(api_key=key)
        except ImportError:
            raise LLMProviderError(provider="groq", message="The 'groq' package is not installed.")

    def is_configured(self) -> bool:
        key = (self.api_key or os.getenv("GROQ_API_KEY", "")).strip()
        return bool(key and key != "your_groq_api_key_here")

    def list_available_models(self) -> List[str]:
        return self.RECOMMENDED_MODELS

    def verify_connection(self) -> Dict[str, Any]:
        if not self.is_configured():
            return {
                "status": "Not Configured",
                "connected": False,
                "provider": "groq",
                "model": self.model,
                "message": "Groq API key is not configured.",
                "available_models": self.RECOMMENDED_MODELS
            }
        try:
            from groq import NotFoundError, AuthenticationError
            client = self._get_client()
            all_models = [m.id for m in client.models.list().data]
            chat_models = [m for m in all_models if not m.startswith("whisper") and "guard" not in m]

            if self.model not in all_models:
                # If specific model is not listed
                return {
                    "status": "Model Unavailable",
                    "connected": False,
                    "provider": "groq",
                    "model": self.model,
                    "message": f"Model '{self.model}' is not available on your Groq account.",
                    "available_models": self.RECOMMENDED_MODELS
                }

            # Run a lightweight test completion to ensure full inference availability
            test_resp = client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": "Hi"}],
                max_tokens=5,
                temperature=0.1
            )
            return {
                "status": "Connected",
                "connected": True,
                "success": True,
                "provider": "groq",
                "model": self.model,
                "message": f"Successfully connected to Groq ({self.model}).",
                "available_models": self.RECOMMENDED_MODELS
            }
        except Exception as e:
            from groq import NotFoundError, AuthenticationError
            if isinstance(e, AuthenticationError) or "401" in str(e):
                return {
                    "status": "Authentication Failed",
                    "connected": False,
                    "provider": "groq",
                    "model": self.model,
                    "message": "Invalid Groq API key.",
                    "available_models": self.RECOMMENDED_MODELS
                }
            if isinstance(e, NotFoundError) or "404" in str(e) or "does not exist" in str(e):
                return {
                    "status": "Model Unavailable",
                    "connected": False,
                    "provider": "groq",
                    "model": self.model,
                    "message": f"Model '{self.model}' does not exist or you do not have access to it.",
                    "available_models": self.RECOMMENDED_MODELS
                }
            return {
                "status": "Provider Unavailable",
                "connected": False,
                "provider": "groq",
                "model": self.model,
                "message": f"Groq connection test failed: {str(e)}",
                "available_models": self.RECOMMENDED_MODELS
            }

    def generate_response(self, prompt: str, conversation_history: Optional[List[Dict[str, str]]] = None, system_prompt: Optional[str] = None) -> str:
        chunks = list(self.generate_stream(prompt, conversation_history, system_prompt))
        full_text = "".join(chunks).strip()
        if not full_text:
            raise LLMProviderError(provider="groq", message="Groq returned an empty response.")
        return full_text

    def generate_stream(self, prompt: str, conversation_history: Optional[List[Dict[str, str]]] = None, system_prompt: Optional[str] = None) -> Iterator[str]:
        client = self._get_client()
        messages = format_messages(prompt, conversation_history, system_prompt)
        try:
            stream = client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=self.temperature,
                max_tokens=self.max_tokens,
                stream=True
            )
            for chunk in stream:
                if chunk.choices and chunk.choices[0].delta:
                    content = chunk.choices[0].delta.content or ""
                    if content:
                        yield content
        except Exception as e:
            status = getattr(e, "status_code", None)
            err_msg = str(e)
            if "timeout" in err_msg.lower() or "timed out" in err_msg.lower() or type(e).__name__.endswith("TimeoutError"):
                raise LLMProviderError(provider="groq", message="Groq request timed out. Please check your connection.", original_error=e, status_code=504)
            if status == 404 or "404" in err_msg or "does not exist" in err_msg.lower() or "not accessible" in err_msg.lower() or "model_not_found" in err_msg.lower():
                raise LLMProviderError(
                    provider="groq",
                    message=f"Model '{self.model}' is not available or not accessible on Groq. Please select an available model in Settings.",
                    original_error=e,
                    status_code=404
                )
            if status == 401 or "401" in err_msg or "invalid api key" in err_msg.lower():
                raise LLMProviderError(provider="groq", message="Groq authentication failed. Please check your API key.", original_error=e, status_code=401)
            if status == 429 or "429" in err_msg or "rate limit" in err_msg.lower():
                raise LLMProviderError(provider="groq", message="Groq rate limit exceeded. Please wait a moment.", original_error=e, status_code=429)
            raise LLMProviderError(provider="groq", message=f"Groq generation failed: {err_msg}", original_error=e, status_code=status)


class OpenAIProvider(BaseLLMProvider):
    """OpenAI API Provider using official openai SDK."""

    RECOMMENDED_MODELS = [
        "gpt-4o-mini"
    ]

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None, temperature: float = 0.7, max_tokens: int = 150):
        key = api_key if api_key is not None else os.getenv("OPENAI_API_KEY", "")
        selected_model = model or os.getenv("OPENAI_MODEL", "gpt-4o-mini")
        super().__init__(name="openai", api_key=key, model=selected_model, temperature=temperature, max_tokens=max_tokens)
        self._verified_model: Optional[str] = None

    def _get_client(self):
        key = (self.api_key or os.getenv("OPENAI_API_KEY", "")).strip()
        if not key or key == "your_openai_api_key_here":
            raise LLMProviderError(
                provider="openai",
                message="OpenAI API key is missing. Configure OPENAI_API_KEY in the backend environment or Settings.",
                status_code=401
            )
        try:
            from openai import OpenAI
            return OpenAI(api_key=key)
        except ImportError:
            raise LLMProviderError(provider="openai", message="The 'openai' package is not installed.")

    def is_configured(self) -> bool:
        key = (self.api_key or os.getenv("OPENAI_API_KEY", "")).strip()
        return bool(key and key != "your_openai_api_key_here")

    def list_available_models(self) -> List[str]:
        return self.RECOMMENDED_MODELS

    def verify_connection(self) -> Dict[str, Any]:
        if not self.is_configured():
            return {
                "status": "Not Configured",
                "connected": False,
                "provider": "openai",
                "model": self.model,
                "message": "OpenAI API key is not configured.",
                "available_models": self.RECOMMENDED_MODELS
            }
        try:
            client = self._get_client()
            client.models.retrieve(self.model)
            return {
                "status": "Connected",
                "connected": True,
                "success": True,
                "provider": "openai",
                "model": self.model,
                "message": f"Successfully connected to OpenAI ({self.model}).",
                "available_models": self.RECOMMENDED_MODELS
            }
        except Exception as e:
            err_msg = str(e)
            if "401" in err_msg or "invalid_api_key" in err_msg.lower():
                return {
                    "status": "Authentication Failed",
                    "connected": False,
                    "provider": "openai",
                    "model": self.model,
                    "message": "Invalid OpenAI API key.",
                    "available_models": self.RECOMMENDED_MODELS
                }
            if "404" in err_msg or "model_not_found" in err_msg.lower():
                return {
                    "status": "Model Unavailable",
                    "connected": False,
                    "provider": "openai",
                    "model": self.model,
                    "message": f"OpenAI model '{self.model}' is not accessible with this API key.",
                    "available_models": self.RECOMMENDED_MODELS
                }
            return {
                "status": "Provider Unavailable",
                "connected": False,
                "provider": "openai",
                "model": self.model,
                "message": f"OpenAI verification failed: {err_msg}",
                "available_models": self.RECOMMENDED_MODELS
            }

    def generate_response(self, prompt: str, conversation_history: Optional[List[Dict[str, str]]] = None, system_prompt: Optional[str] = None) -> str:
        chunks = list(self.generate_stream(prompt, conversation_history, system_prompt))
        full_text = "".join(chunks).strip()
        if not full_text:
            raise LLMProviderError(provider="openai", message="OpenAI returned an empty response.")
        return full_text

    def generate_stream(self, prompt: str, conversation_history: Optional[List[Dict[str, str]]] = None, system_prompt: Optional[str] = None) -> Iterator[str]:
        client = self._get_client()
        messages = format_messages(prompt, conversation_history, system_prompt)
        try:
            # Standard chat completions streaming
            stream = client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=self.temperature,
                max_tokens=self.max_tokens,
                stream=True
            )
            for chunk in stream:
                if chunk.choices and chunk.choices[0].delta:
                    content = chunk.choices[0].delta.content or ""
                    if content:
                        yield content
        except Exception as e:
            status = getattr(e, "status_code", None)
            err_msg = str(e)
            if status == 404 or "404" in err_msg or "model_not_found" in err_msg.lower() or "does not exist" in err_msg.lower():
                raise LLMProviderError(provider="openai", message=f"OpenAI model '{self.model}' does not exist or is not available.", original_error=e, status_code=404)
            if status == 401 or "401" in err_msg or "invalid_api_key" in err_msg.lower() or "incorrect api key" in err_msg.lower():
                raise LLMProviderError(provider="openai", message="OpenAI authentication failed. Invalid API key.", original_error=e, status_code=401)
            if status == 429 or "429" in err_msg or "rate limit" in err_msg.lower():
                raise LLMProviderError(provider="openai", message="OpenAI rate limit or quota exceeded.", original_error=e, status_code=429)
            raise LLMProviderError(provider="openai", message=f"OpenAI generation failed: {err_msg}", original_error=e, status_code=status)


class GeminiProvider(BaseLLMProvider):
    """Google Gemini Provider using official google-genai SDK."""

    RECOMMENDED_MODELS = [
        "gemini-2.0-flash",
        "gemini-2.5-flash",
        "gemini-1.5-flash",
        "gemini-1.5-pro"
    ]

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None, temperature: float = 0.7, max_tokens: int = 150):
        key = (api_key if api_key is not None else os.getenv("GEMINI_API_KEY", "")).strip()
        selected_model = (model or os.getenv("GEMINI_MODEL", "gemini-2.0-flash")).strip()
        super().__init__(name="gemini", api_key=key, model=selected_model, temperature=temperature, max_tokens=max_tokens)

    def _get_client(self):
        key = (self.api_key if self.api_key is not None else os.getenv("GEMINI_API_KEY", "")).strip()
        if not key or key == "your_gemini_api_key_here":
            raise LLMProviderError(
                provider="gemini",
                message="Gemini API key is missing. Configure GEMINI_API_KEY in the backend environment or Settings.",
                status_code=401
            )
        try:
            from google import genai
            return genai.Client(api_key=key)
        except ImportError:
            raise LLMProviderError(provider="gemini", message="The 'google-genai' package is not installed.")

    def is_configured(self) -> bool:
        key = (self.api_key if self.api_key is not None else os.getenv("GEMINI_API_KEY", "")).strip()
        return bool(key and key != "your_gemini_api_key_here")

    def list_available_models(self) -> List[str]:
        if not self.is_configured():
            return self.RECOMMENDED_MODELS
        try:
            client = self._get_client()
            models = [m.name.replace("models/", "") for m in client.models.list() if "generateContent" in getattr(m, "supported_actions", [])]
            return models if models else self.RECOMMENDED_MODELS
        except Exception:
            return self.RECOMMENDED_MODELS

    def verify_connection(self) -> Dict[str, Any]:
        if not self.is_configured():
            return {
                "status": "Not Configured",
                "connected": False,
                "provider": "gemini",
                "model": self.model,
                "message": "Gemini API key is not configured.",
                "available_models": self.RECOMMENDED_MODELS
            }
        try:
            client = self._get_client()
            client.models.get(model=self.model)
            return {
                "status": "Connected",
                "connected": True,
                "success": True,
                "provider": "gemini",
                "model": self.model,
                "message": f"Successfully connected to Google Gemini ({self.model}).",
                "available_models": self.RECOMMENDED_MODELS
            }
        except Exception as e:
            err_msg = str(e)
            if any(term in err_msg for term in ["API_KEY_INVALID", "API key not valid", "PERMISSION_DENIED", "UNAUTHENTICATED", "401", "403"]):
                return {
                    "status": "Authentication Failed",
                    "connected": False,
                    "provider": "gemini",
                    "model": self.model,
                    "message": "Invalid Google Gemini API key.",
                    "available_models": self.RECOMMENDED_MODELS
                }
            if "404" in err_msg or "NOT_FOUND" in err_msg:
                return {
                    "status": "Model Unavailable",
                    "connected": False,
                    "provider": "gemini",
                    "model": self.model,
                    "message": f"Gemini model '{self.model}' was not found.",
                    "available_models": self.RECOMMENDED_MODELS
                }
            return {
                "status": "Provider Unavailable",
                "connected": False,
                "provider": "gemini",
                "model": self.model,
                "message": f"Gemini verification failed: {err_msg}",
                "available_models": self.RECOMMENDED_MODELS
            }

    def generate_response(self, prompt: str, conversation_history: Optional[List[Dict[str, str]]] = None, system_prompt: Optional[str] = None) -> str:
        chunks = list(self.generate_stream(prompt, conversation_history, system_prompt))
        full_text = "".join(chunks).strip()
        if not full_text:
            raise LLMProviderError(provider="gemini", message="Gemini returned an empty response.")
        return full_text

    def generate_stream(self, prompt: str, conversation_history: Optional[List[Dict[str, str]]] = None, system_prompt: Optional[str] = None) -> Iterator[str]:
        client = self._get_client()
        from google.genai import types

        sys_prompt = system_prompt or DEFAULT_SYSTEM_PROMPT
        config = types.GenerateContentConfig(
            system_instruction=sys_prompt,
            temperature=self.temperature,
            max_output_tokens=self.max_tokens
        )

        contents = []
        for msg in conversation_history or []:
            role = msg.get("role")
            content = msg.get("content", "").strip()
            if not content:
                continue
            # Map roles: user -> user, assistant -> model
            gemini_role = "user" if role == "user" else "model"
            contents.append(types.Content(role=gemini_role, parts=[types.Part.from_text(text=content)]))
        contents.append(types.Content(role="user", parts=[types.Part.from_text(text=prompt.strip())]))

        try:
            response_stream = client.models.generate_content_stream(
                model=self.model,
                contents=contents,
                config=config
            )
            for chunk in response_stream:
                if chunk.text:
                    yield chunk.text
        except Exception as e:
            code = getattr(e, "code", None) or getattr(e, "status_code", None)
            err_msg = str(e)
            if "timeout" in err_msg.lower() or "timed out" in err_msg.lower() or type(e).__name__.endswith("TimeoutError"):
                raise LLMProviderError(provider="gemini", message="Gemini request timed out.", original_error=e, status_code=504)
            if code in (401, 403) or any(term in err_msg for term in ["API_KEY_INVALID", "API key not valid", "PERMISSION_DENIED", "UNAUTHENTICATED", "401", "403"]):
                raise LLMProviderError(provider="gemini", message="Gemini authentication failed. Please verify your API key.", original_error=e, status_code=401)
            if code == 404 or "404" in err_msg or "NOT_FOUND" in err_msg:
                raise LLMProviderError(provider="gemini", message=f"Gemini model '{self.model}' is not available.", original_error=e, status_code=404)
            if code == 429 or "429" in err_msg or "RESOURCE_EXHAUSTED" in err_msg:
                raise LLMProviderError(provider="gemini", message="Gemini rate limit exceeded.", original_error=e, status_code=429)
            raise LLMProviderError(provider="gemini", message=f"Gemini generation failed: {err_msg}", original_error=e, status_code=code)


class LocalOllamaProvider(BaseLLMProvider):
    """Local Ollama Provider retained for local offline development."""

    def __init__(self, model: Optional[str] = None, base_url: str = "http://127.0.0.1:11434/api/chat"):
        selected_model = model or os.getenv("OLLAMA_MODEL", "qwen2.5:1.5b")
        super().__init__(name="local", api_key="", model=selected_model)
        self.base_url = base_url

    def is_configured(self) -> bool:
        return True

    def list_available_models(self) -> List[str]:
        import requests
        try:
            res = requests.get("http://127.0.0.1:11434/api/tags", timeout=1.5)
            if res.status_code == 200:
                return [m["name"] for m in res.json().get("models", [])]
        except Exception:
            pass
        return [self.model or "qwen2.5:1.5b"]

    def verify_connection(self) -> Dict[str, Any]:
        import requests
        try:
            res = requests.get("http://127.0.0.1:11434/api/tags", timeout=1.5)
            if res.status_code == 200:
                models = [m["name"] for m in res.json().get("models", [])]
                return {
                    "status": "Connected" if self.model in models else "Model Unavailable",
                    "connected": self.model in models,
                    "provider": "local",
                    "model": self.model,
                    "message": "Local Ollama is running.",
                    "available_models": models
                }
        except Exception:
            pass
        return {
            "status": "Provider Unavailable",
            "connected": False,
            "provider": "local",
            "model": self.model,
            "message": "Local Ollama is not running on http://127.0.0.1:11434.",
            "available_models": [self.model]
        }

    def generate_response(self, prompt: str, conversation_history: Optional[List[Dict[str, str]]] = None, system_prompt: Optional[str] = None) -> str:
        import requests
        messages = format_messages(prompt, conversation_history, system_prompt)
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "options": {"num_thread": 8, "num_predict": 75, "temperature": self.temperature}
        }
        try:
            resp = requests.post(self.base_url, json=payload, timeout=12)
            if resp.status_code == 200:
                return resp.json().get("message", {}).get("content", "").strip() or "I am listening."
            raise Exception(f"Ollama returned HTTP {resp.status_code}")
        except Exception as e:
            raise LLMProviderError(provider="local", message=f"Local Ollama generation failed: {str(e)}", original_error=e)

    def generate_stream(self, prompt: str, conversation_history: Optional[List[Dict[str, str]]] = None, system_prompt: Optional[str] = None) -> Iterator[str]:
        yield self.generate_response(prompt, conversation_history, system_prompt)


class UnifiedLLMManager:
    """Centralized LLM Integration Manager routing across Groq, OpenAI, Gemini, and Local."""

    def __init__(self):
        self.providers: Dict[str, BaseLLMProvider] = {
            "groq": GroqProvider(),
            "openai": OpenAIProvider(),
            "gemini": GeminiProvider(),
            "local": LocalOllamaProvider()
        }

    def resolve_active_provider_name(self) -> str:
        """Determines the active provider based on environment variables."""
        explicit = os.getenv("LLM_PROVIDER", "").strip().lower()
        if explicit in self.providers:
            return explicit
        
        legacy_mode = os.getenv("PIPELINE_MODE", "").strip().lower()
        if legacy_mode == "openai":
            return "openai"
        if legacy_mode == "cloud":
            return "groq"
        if legacy_mode == "gemini":
            return "gemini"
        
        # Priority order based on configured keys
        if self.providers["openai"].is_configured():
            return "openai"
        if self.providers["groq"].is_configured():
            return "groq"
        if self.providers["gemini"].is_configured():
            return "gemini"
        
        return "groq"

    def get_provider(self, name: Optional[str] = None) -> BaseLLMProvider:
        p_name = (name or self.resolve_active_provider_name()).lower()
        if p_name not in self.providers:
            p_name = "groq"
        return self.providers[p_name]

    def set_active_provider(self, name: str) -> None:
        p_name = name.lower()
        if p_name in self.providers:
            os.environ["LLM_PROVIDER"] = p_name

    def configure_provider(self, name: str, api_key: Optional[str] = None, model: Optional[str] = None) -> BaseLLMProvider:
        p_name = name.lower()
        if p_name not in self.providers:
            raise LLMProviderError(provider=p_name, message=f"Unknown provider: {p_name}")
        provider = self.providers[p_name]
        if api_key is not None and api_key.strip():
            clean_k = api_key.strip()
            provider.api_key = clean_k
            env_var = f"{p_name.upper()}_API_KEY"
            os.environ[env_var] = clean_k
        if model is not None and model.strip():
            clean_m = model.strip()
            provider.model = clean_m
            env_var = f"{p_name.upper()}_MODEL"
            os.environ[env_var] = clean_m
        return provider

    def generate_response(self, prompt: str, conversation_history: Optional[List[Dict[str, str]]] = None, system_prompt: Optional[str] = None, provider_name: Optional[str] = None) -> str:
        provider = self.get_provider(provider_name)
        return provider.generate_response(prompt, conversation_history, system_prompt)

    def generate_stream(self, prompt: str, conversation_history: Optional[List[Dict[str, str]]] = None, system_prompt: Optional[str] = None, provider_name: Optional[str] = None) -> Iterator[str]:
        provider = self.get_provider(provider_name)
        return provider.generate_stream(prompt, conversation_history, system_prompt)

    def get_all_providers_status(self) -> Dict[str, Any]:
        """Returns safe provider statuses without exposing API keys."""
        active = self.resolve_active_provider_name()
        res = {
            "active_provider": active,
            "providers": {}
        }
        for name, provider in self.providers.items():
            if name == "local":
                continue # Exclude local from production cloud status
            is_conf = provider.is_configured()
            res["providers"][name] = {
                "name": name,
                "configured": is_conf,
                "model": provider.model,
                "recommended_models": getattr(provider, "RECOMMENDED_MODELS", []),
                "available_models": provider.list_available_models() if is_conf else getattr(provider, "RECOMMENDED_MODELS", [])
            }
        return res

    def test_provider(self, name: str, model: Optional[str] = None, api_key: Optional[str] = None) -> Dict[str, Any]:
        """Tests connection for a provider using configured or temporary credentials."""
        p_name = name.lower()
        if p_name == "groq":
            p = GroqProvider(api_key=api_key or self.providers["groq"].api_key, model=model or self.providers["groq"].model)
        elif p_name == "openai":
            p = OpenAIProvider(api_key=api_key or self.providers["openai"].api_key, model=model or self.providers["openai"].model)
        elif p_name == "gemini":
            p = GeminiProvider(api_key=api_key or self.providers["gemini"].api_key, model=model or self.providers["gemini"].model)
        elif p_name == "local":
            p = LocalOllamaProvider(model=model or self.providers["local"].model)
        else:
            return {"status": "Error", "connected": False, "provider": name, "message": f"Unsupported provider '{name}'"}

        return p.verify_connection()
