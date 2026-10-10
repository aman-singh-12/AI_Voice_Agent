import unittest
from fastapi.testclient import TestClient
from app import app
from unittest.mock import patch

class WebSocketVoiceTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_ws_voice_get_endpoint(self):
        response = self.client.get("/ws/voice")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "online")
        self.assertEqual(data["protocol"], "websocket")

    @patch("app.pipeline.process_text_only")
    def test_websocket_text_interaction(self, mock_process_text):
        mock_process_text.return_value = {
            "user_text": "Hello there",
            "assistant_text": "Hello! How can I help you today?",
            "audio_url": "data:audio/mp3;base64,fakeaudio",
            "metrics": {"total_time_ms": 100},
            "mode": "local"
        }

        with self.client.websocket_connect("/ws/voice") as websocket:
            websocket.send_json({"type": "ping"})
            pong = websocket.receive_json()
            self.assertEqual(pong.get("type"), "pong")

            websocket.send_json({"type": "text", "text": "Hello there"})
            response = websocket.receive_json()
            self.assertEqual(response.get("type"), "response")
            self.assertEqual(response.get("assistant_text"), "Hello! How can I help you today?")
            self.assertTrue(response.get("audio_url").startswith("data:audio/mp3;base64,"))

if __name__ == "__main__":
    unittest.main()
