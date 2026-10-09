import os
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from pipeline import OpenAILLMService, VoicePipeline, VoicePipelineError


class OpenAILLMServiceTests(unittest.TestCase):
    def test_missing_key_is_reported_without_creating_a_client(self):
        with patch.dict(os.environ, {}, clear=True):
            service = OpenAILLMService(api_key="", model="configured-model")
            with self.assertRaisesRegex(VoicePipelineError, "OpenAI API key is missing"):
                service.generate_response("Hello")

    @patch("pipeline.OpenAI")
    def test_model_is_verified_and_history_is_sent_to_streaming_responses_api(self, openai_class):
        model_resource = Mock()
        client = openai_class.return_value
        client.models.retrieve.return_value = model_resource
        client.responses.create.return_value = [
            SimpleNamespace(type="response.output_text.delta", delta="Follow-up "),
            SimpleNamespace(type="response.output_text.delta", delta="answer."),
        ]

        service = OpenAILLMService(api_key="test-key", model="available-model")
        result = service.generate_response(
            "What about tomorrow?",
            conversation_history=[
                {"role": "user", "content": "What is the plan?"},
                {"role": "assistant", "content": "We will meet today."},
            ],
        )

        self.assertEqual(result, "Follow-up answer.")
        client.models.retrieve.assert_called_once_with("available-model")
        request = client.responses.create.call_args.kwargs
        self.assertTrue(request["stream"])
        self.assertEqual(
            request["input"],
            [
                {"role": "user", "content": "What is the plan?"},
                {"role": "assistant", "content": "We will meet today."},
                {"role": "user", "content": "What about tomorrow?"},
            ],
        )

    @patch("pipeline.OpenAI")
    def test_inaccessible_model_is_reported(self, openai_class):
        client = openai_class.return_value
        client.models.retrieve.side_effect = RuntimeError("model not found")
        service = OpenAILLMService(api_key="test-key", model="unavailable-model")

        with self.assertRaisesRegex(VoicePipelineError, "unavailable to this API key"):
            service.verify_model_access()

    def test_openai_response_is_sent_to_existing_local_tts(self):
        pipeline = VoicePipeline.__new__(VoicePipeline)
        pipeline.mode = "openai"
        pipeline.openai_llm = Mock()
        pipeline.openai_llm.generate_response.return_value = "A spoken answer."
        pipeline.local_tts = Mock()
        pipeline.local_tts.synthesize.return_value = b"playable-audio"
        pipeline.cloud_tts = Mock()

        with patch.dict(os.environ, {"ELEVENLABS_API_KEY": ""}):
            result = pipeline.process_text_only(
                "Say hello",
                conversation_history=[{"role": "user", "content": "Earlier question"}],
                custom_keys={"pipeline_mode": "openai"},
            )

        self.assertEqual(result["assistant_text"], "A spoken answer.")
        self.assertTrue(result["audio_url"].startswith("data:audio/mp3;base64,"))
        pipeline.openai_llm.generate_response.assert_called_once()
        pipeline.local_tts.synthesize.assert_called_once_with("A spoken answer.")
        pipeline.cloud_tts.synthesize.assert_not_called()


if __name__ == "__main__":
    unittest.main()
