# E-Bot LiveKit Agent Worker

This worker is the server-side voice participant for the E-Bot call page. The website only creates LiveKit room tokens; this process joins rooms as `LIVEKIT_AGENT_NAME=ebot-agent`, receives user audio, and calls external STT, chat, and TTS services.

## Required Environment

Set these on the machine that runs the worker:

```bash
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
LIVEKIT_AGENT_NAME=ebot-agent
SENSEVOICE_TRANSCRIBE_URL=https://your-sensevoice-service/transcribe
COSYVOICE2_SPEECH_URL=https://your-cosyvoice2-service/speech
DEEPSEEK_API_KEY=...
```

Optional:

```bash
DEEPSEEK_MODEL=deepseek-v4-flash
SENSEVOICE_API_KEY=...
COSYVOICE2_API_KEY=...
COSYVOICE2_VOICE=ebot
COSYVOICE2_SAMPLE_RATE=24000
SENSEVOICE_SAMPLE_RATE=16000
EBOT_INSTRUCTIONS="custom E-Bot persona"
```

## External Service Contracts

SenseVoice endpoint:

- Method: `POST`
- Body: multipart form with `file=@speech.wav` and `language=zh`
- Response JSON: `{ "text": "..." }`, `{ "transcript": "..." }`, `{ "result": { "text": "..." } }`, or `{ "data": { "text": "..." } }`

CosyVoice2 endpoint:

- Method: `POST`
- Body JSON: `{ "text": "...", "voice": "ebot", "format": "wav", "sample_rate": 24000 }`
- Response: raw mono 16-bit WAV/PCM bytes, or JSON with `audio_base64`

## Run Locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r agent/requirements.txt
cd agent
python worker.py dev
```

When the browser calls `/api/livekit-token`, the token includes an agent dispatch for `ebot-agent`. Keep this worker running before testing the voice call page.
