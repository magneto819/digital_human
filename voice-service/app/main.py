from typing import Any

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from .config import VoiceServiceSettings
from .services import ModelSpeechServices, VoiceServiceError


class SpeechRequest(BaseModel):
    text: str = ""
    voice: str = "ebot"
    format: str = "wav"
    sample_rate: int = 24000


def create_app(
    settings: VoiceServiceSettings | None = None,
    services: Any | None = None,
) -> FastAPI:
    resolved_settings = settings or VoiceServiceSettings.from_env()
    speech_services = services or ModelSpeechServices(resolved_settings)
    app = FastAPI(title="E-Bot Voice Service")

    async def require_auth(authorization: str = Header(default="")) -> None:
        if not resolved_settings.api_key:
            return
        if authorization != f"Bearer {resolved_settings.api_key}":
            raise HTTPException(status_code=401, detail="Unauthorized.")

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {
            "ok": True,
            "models": {
                "cosyvoice2": bool(resolved_settings.cosyvoice2_model_dir),
                "sensevoice": bool(resolved_settings.sensevoice_model_dir),
            },
        }

    @app.post("/transcribe", dependencies=[Depends(require_auth)])
    async def transcribe(file: UploadFile = File(...), language: str = Form("zh")) -> dict[str, str]:
        audio = await file.read()
        if not audio:
            raise HTTPException(status_code=400, detail="Audio file is required.")

        try:
            text = await speech_services.transcribe(audio, language=language)
        except VoiceServiceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

        return {"text": text}

    @app.post("/speech", dependencies=[Depends(require_auth)])
    async def speech(payload: SpeechRequest) -> Response:
        text = payload.text.strip()
        if not text:
            raise HTTPException(status_code=400, detail="Text is required.")
        if payload.format.lower() != "wav":
            raise HTTPException(status_code=400, detail="Only wav format is supported.")

        try:
            audio = await speech_services.synthesize(
                text,
                voice=payload.voice or resolved_settings.default_voice,
                sample_rate=payload.sample_rate,
            )
        except VoiceServiceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

        return Response(content=audio, media_type="audio/wav")

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    run_settings = VoiceServiceSettings.from_env()
    uvicorn.run(app, host=run_settings.host, port=run_settings.port)
