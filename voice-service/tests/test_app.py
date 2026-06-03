import io
import sys
import wave
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import VoiceServiceSettings
from app.main import create_app


def wav_bytes() -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b"\x00\x00" * 160)
    return buffer.getvalue()


class FakeSpeechServices:
    def __init__(self) -> None:
        self.last_language = ""
        self.last_text = ""

    async def transcribe(self, audio: bytes, language: str = "zh") -> str:
        self.last_language = language
        assert audio.startswith(b"RIFF")
        return "你好，我是势宝"

    async def synthesize(self, text: str, voice: str, sample_rate: int) -> bytes:
        self.last_text = text
        assert voice == "ebot"
        assert sample_rate == 24000
        return wav_bytes()


def build_client(api_key: str = "") -> tuple[TestClient, FakeSpeechServices]:
    services = FakeSpeechServices()
    settings = VoiceServiceSettings(
        api_key=api_key,
        cosyvoice2_model_dir="/models/cosyvoice2",
        sensevoice_model_dir="/models/sensevoice",
    )
    return TestClient(create_app(settings=settings, services=services)), services


def test_health_reports_configured_models() -> None:
    client, _services = build_client()

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "models": {"cosyvoice2": True, "sensevoice": True},
    }


def test_transcribe_returns_text_from_uploaded_wav() -> None:
    client, services = build_client()

    response = client.post(
        "/transcribe",
        data={"language": "zh"},
        files={"file": ("speech.wav", wav_bytes(), "audio/wav")},
    )

    assert response.status_code == 200
    assert response.json() == {"text": "你好，我是势宝"}
    assert services.last_language == "zh"


def test_speech_returns_wav_audio() -> None:
    client, services = build_client()

    response = client.post(
        "/speech",
        json={"text": "你好，我是势宝", "voice": "ebot", "sample_rate": 24000},
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("audio/wav")
    assert response.content.startswith(b"RIFF")
    assert services.last_text == "你好，我是势宝"


def test_api_key_protects_voice_endpoints() -> None:
    client, _services = build_client(api_key="secret")

    denied = client.post(
        "/speech",
        json={"text": "你好"},
    )
    allowed = client.post(
        "/speech",
        headers={"Authorization": "Bearer secret"},
        json={"text": "你好"},
    )

    assert denied.status_code == 401
    assert allowed.status_code == 200


def test_speech_rejects_empty_text() -> None:
    client, _services = build_client()

    response = client.post("/speech", json={"text": "   "})

    assert response.status_code == 400
    assert response.json()["detail"] == "Text is required."
