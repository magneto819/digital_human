import asyncio
import io
import os
import tempfile
import wave
from typing import Any

from .config import VoiceServiceSettings


class VoiceServiceError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class ModelSpeechServices:
    def __init__(self, settings: VoiceServiceSettings) -> None:
        self.settings = settings
        self._sensevoice_model: Any | None = None
        self._cosyvoice2_model: Any | None = None

    async def transcribe(self, audio: bytes, language: str = "zh") -> str:
        return await asyncio.to_thread(self._transcribe_sync, audio, language)

    async def synthesize(self, text: str, voice: str, sample_rate: int) -> bytes:
        return await asyncio.to_thread(self._synthesize_sync, text, voice, sample_rate)

    def _transcribe_sync(self, audio: bytes, language: str) -> str:
        model = self._load_sensevoice()
        path = self._write_temp_wav(audio)
        try:
            result = model.generate(
                input=path,
                language=language or "zh",
                use_itn=True,
                batch_size_s=60,
            )
        finally:
            os.unlink(path)

        text = extract_text(result)
        if not text:
            raise VoiceServiceError(502, "SenseVoice did not return text.")
        return text

    def _synthesize_sync(self, text: str, voice: str, sample_rate: int) -> bytes:
        model = self._load_cosyvoice2()
        voice_name = voice or self.settings.default_voice

        if self.settings.prompt_audio and self.settings.prompt_text:
            prompt_speech = load_prompt_audio(self.settings.prompt_audio)
            stream = model.inference_zero_shot(
                text,
                self.settings.prompt_text,
                prompt_speech,
                stream=False,
            )
        else:
            stream = model.inference_sft(text, voice_name, stream=False)

        pcm_chunks = [speech_tensor_to_pcm_bytes(item.get("tts_speech")) for item in stream]
        pcm = b"".join(chunk for chunk in pcm_chunks if chunk)
        if not pcm:
            raise VoiceServiceError(502, "CosyVoice2 did not return audio.")
        return pcm_to_wav(pcm, sample_rate, 1)

    def _load_sensevoice(self) -> Any:
        if not self.settings.sensevoice_model_dir:
            raise VoiceServiceError(503, "Set SENSEVOICE_MODEL_DIR before using /transcribe.")
        if self._sensevoice_model is not None:
            return self._sensevoice_model

        try:
            from funasr import AutoModel
        except ImportError as exc:
            raise VoiceServiceError(503, "Install SenseVoice dependencies before using /transcribe.") from exc

        self._sensevoice_model = AutoModel(
            model=self.settings.sensevoice_model_dir,
            trust_remote_code=True,
            device=self.settings.device,
        )
        return self._sensevoice_model

    def _load_cosyvoice2(self) -> Any:
        if not self.settings.cosyvoice2_model_dir:
            raise VoiceServiceError(503, "Set COSYVOICE2_MODEL_DIR before using /speech.")
        if self._cosyvoice2_model is not None:
            return self._cosyvoice2_model

        try:
            from cosyvoice.cli.cosyvoice import CosyVoice2
        except ImportError as exc:
            raise VoiceServiceError(503, "Install CosyVoice2 dependencies before using /speech.") from exc

        self._cosyvoice2_model = CosyVoice2(
            self.settings.cosyvoice2_model_dir,
            fp16=False,
            load_jit=False,
            load_trt=False,
        )
        return self._cosyvoice2_model

    @staticmethod
    def _write_temp_wav(audio: bytes) -> str:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as handle:
            handle.write(audio)
            return handle.name


def extract_text(result: Any) -> str:
    if isinstance(result, str):
        return result.strip()
    if isinstance(result, dict):
        for key in ("text", "transcript", "raw_text"):
            if result.get(key):
                return str(result[key]).strip()
        if result.get("result"):
            return extract_text(result["result"])
        if result.get("data"):
            return extract_text(result["data"])
        return ""
    if isinstance(result, list):
        return " ".join(filter(None, (extract_text(item) for item in result))).strip()
    return ""


def load_prompt_audio(path: str) -> Any:
    try:
        from cosyvoice.utils.file_utils import load_wav
    except ImportError as exc:
        raise VoiceServiceError(503, "Install CosyVoice2 utilities before using prompt audio.") from exc
    return load_wav(path, 16000)


def speech_tensor_to_pcm_bytes(value: Any) -> bytes:
    if value is None:
        return b""

    try:
        import numpy as np
    except ImportError as exc:
        raise VoiceServiceError(503, "Install numpy before using /speech.") from exc

    if hasattr(value, "detach"):
        value = value.detach().cpu().numpy()
    elif hasattr(value, "cpu") and hasattr(value.cpu(), "numpy"):
        value = value.cpu().numpy()

    samples = np.asarray(value, dtype=np.float32).reshape(-1)
    samples = np.clip(samples, -1.0, 1.0)
    return (samples * 32767.0).astype("<i2").tobytes()


def pcm_to_wav(pcm: bytes, sample_rate: int, channels: int) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm)
    return buffer.getvalue()
