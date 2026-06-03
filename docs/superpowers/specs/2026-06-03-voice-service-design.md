# Voice Service Design

## Goal

Add a small deployable HTTP service that gives the LiveKit Agent Worker two stable endpoints: speech-to-text with SenseVoice and text-to-speech with CosyVoice2.

## Architecture

The website stays on Vercel and only creates LiveKit room tokens. The Python Agent Worker stays responsible for joining LiveKit rooms and calling external services. The new `voice-service` runs separately on a GPU machine and exposes:

- `GET /health`
- `POST /transcribe`
- `POST /speech`

Model dependencies are loaded lazily. This keeps local tests fast and lets the service return clear configuration errors when model paths or Python packages are missing.

## Interface

`POST /transcribe` accepts multipart form data with `file=@speech.wav` and optional `language=zh`. It returns JSON shaped as `{ "text": "..." }`.

`POST /speech` accepts JSON shaped as `{ "text": "...", "voice": "ebot", "format": "wav", "sample_rate": 24000 }`. It returns `audio/wav` bytes.

These contracts match the existing Agent Worker.

## Configuration

Required on the GPU service host:

- `SENSEVOICE_MODEL_DIR`
- `COSYVOICE2_MODEL_DIR`

Optional:

- `VOICE_SERVICE_API_KEY`
- `VOICE_SERVICE_HOST`
- `VOICE_SERVICE_PORT`
- `VOICE_SERVICE_DEVICE`
- `COSYVOICE2_PROMPT_TEXT`
- `COSYVOICE2_PROMPT_AUDIO`
- `COSYVOICE2_DEFAULT_VOICE`

If `VOICE_SERVICE_API_KEY` is set, requests must include `Authorization: Bearer <key>`.

## Error Handling

The service returns JSON errors for missing auth, missing model configuration, unsupported audio, and model runtime failures. It does not log or return secrets.

## Testing

Tests use fake STT/TTS adapters, so CI and local development do not require GPU packages. The tests verify endpoint shape, authentication, empty input validation, and WAV response handling.
