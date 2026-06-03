# E-Bot Voice Service

This service provides the two HTTP endpoints required by the LiveKit Agent Worker:

- `POST /transcribe` for SenseVoice speech-to-text
- `POST /speech` for CosyVoice2 text-to-speech

Run it on a GPU host. Do not deploy this service to Vercel.

## API

### `GET /health`

Returns:

```json
{
  "ok": true,
  "models": {
    "cosyvoice2": true,
    "sensevoice": true
  }
}
```

### `POST /transcribe`

Multipart form:

```bash
curl -X POST "$VOICE_SERVICE_URL/transcribe" \
  -H "Authorization: Bearer $VOICE_SERVICE_API_KEY" \
  -F "language=zh" \
  -F "file=@speech.wav"
```

Response:

```json
{ "text": "你好，我是势宝" }
```

### `POST /speech`

JSON body:

```bash
curl -X POST "$VOICE_SERVICE_URL/speech" \
  -H "Authorization: Bearer $VOICE_SERVICE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"你好，我是势宝","voice":"ebot","format":"wav","sample_rate":24000}' \
  --output reply.wav
```

Response: `audio/wav` bytes.

## Environment

Required on the GPU host:

```bash
export SENSEVOICE_MODEL_DIR="/models/SenseVoiceSmall"
export COSYVOICE2_MODEL_DIR="/models/CosyVoice2-0.5B"
```

Optional:

```bash
export VOICE_SERVICE_API_KEY="long-random-secret"
export VOICE_SERVICE_HOST="0.0.0.0"
export VOICE_SERVICE_PORT="8080"
export VOICE_SERVICE_DEVICE="cuda"
export COSYVOICE2_DEFAULT_VOICE="ebot"
export COSYVOICE2_PROMPT_TEXT="你好，我是势宝。"
export COSYVOICE2_PROMPT_AUDIO="/models/prompts/ebot.wav"
```

If `VOICE_SERVICE_API_KEY` is set, both endpoints require:

```text
Authorization: Bearer <VOICE_SERVICE_API_KEY>
```

## Local HTTP Service

Install only the lightweight HTTP dependencies:

```bash
cd voice-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

Without model dependencies, `/health` works and model endpoints return clear setup errors.

## GPU Setup

Install SenseVoice dependencies:

```bash
cd voice-service
pip install -r requirements.gpu.txt
```

Install CosyVoice2 from the official repository on the same GPU host:

```bash
git clone https://github.com/FunAudioLLM/CosyVoice.git /opt/CosyVoice
pip install -r /opt/CosyVoice/requirements.txt
export PYTHONPATH=/opt/CosyVoice/third_party/Matcha-TTS:/opt/CosyVoice:$PYTHONPATH
```

Download or mount the model directories, then set:

```bash
export SENSEVOICE_MODEL_DIR="/models/SenseVoiceSmall"
export COSYVOICE2_MODEL_DIR="/models/CosyVoice2-0.5B"
```

Start:

```bash
cd voice-service
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

## Docker

Build the lightweight HTTP image:

```bash
docker build -t ebot-voice-service voice-service
```

Run it with mounted models:

```bash
docker run --gpus all --rm -p 8080:8080 \
  -e SENSEVOICE_MODEL_DIR=/models/SenseVoiceSmall \
  -e COSYVOICE2_MODEL_DIR=/models/CosyVoice2-0.5B \
  -e VOICE_SERVICE_API_KEY="$VOICE_SERVICE_API_KEY" \
  -v /path/to/models:/models \
  ebot-voice-service
```

For production, use a CUDA/PyTorch base image and install the official CosyVoice repository in the image or on the host.

## Connect Agent Worker

After the service is reachable on HTTPS:

```bash
export SENSEVOICE_TRANSCRIBE_URL="https://voice.example.com/transcribe"
export COSYVOICE2_SPEECH_URL="https://voice.example.com/speech"
export SENSEVOICE_API_KEY="$VOICE_SERVICE_API_KEY"
export COSYVOICE2_API_KEY="$VOICE_SERVICE_API_KEY"
```

Then restart `agent/worker.py`.
