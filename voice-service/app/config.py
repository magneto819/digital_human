import os
from dataclasses import dataclass


@dataclass(frozen=True)
class VoiceServiceSettings:
    sensevoice_model_dir: str = ""
    cosyvoice2_model_dir: str = ""
    api_key: str = ""
    host: str = "0.0.0.0"
    port: int = 8080
    device: str = "cuda"
    default_voice: str = "ebot"
    prompt_text: str = ""
    prompt_audio: str = ""

    @classmethod
    def from_env(cls) -> "VoiceServiceSettings":
        return cls(
            sensevoice_model_dir=os.getenv("SENSEVOICE_MODEL_DIR", "").strip(),
            cosyvoice2_model_dir=os.getenv("COSYVOICE2_MODEL_DIR", "").strip(),
            api_key=os.getenv("VOICE_SERVICE_API_KEY", "").strip(),
            host=os.getenv("VOICE_SERVICE_HOST", "0.0.0.0").strip() or "0.0.0.0",
            port=int(os.getenv("VOICE_SERVICE_PORT", "8080")),
            device=os.getenv("VOICE_SERVICE_DEVICE", "cuda").strip() or "cuda",
            default_voice=os.getenv("COSYVOICE2_DEFAULT_VOICE", "ebot").strip() or "ebot",
            prompt_text=os.getenv("COSYVOICE2_PROMPT_TEXT", "").strip(),
            prompt_audio=os.getenv("COSYVOICE2_PROMPT_AUDIO", "").strip(),
        )
