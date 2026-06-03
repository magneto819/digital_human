# LiveKit External Voice Agent Design

## Goal

Replace the current OpenAI Realtime WebRTC path with a LiveKit-based voice room and a separate Python LiveKit Agent Worker. The website remains deployable on Vercel and only handles room token generation, UI state, chat input, microphone publishing, and audio playback.

## Architecture

The browser joins a LiveKit room using a short-lived token from `/api/livekit-token`. The browser publishes microphone audio to LiveKit and subscribes to the Agent participant audio. A separate Python Agent Worker joins the same room and runs the voice pipeline:

1. SenseVoice external service URL for speech-to-text.
2. DeepSeek for concise E-Bot replies.
3. CosyVoice2 external service URL for text-to-speech.
4. LiveKit audio publication back to the room.

Vercel does not run the model pipeline. It only signs room tokens using LiveKit credentials and serves the existing site.

## Components

### Web App

- `public/app.js` connects to LiveKit instead of calling `/api/realtime`.
- `public/call.html` keeps the existing call UI, chat panel, and local browser speech voice selector as a fallback-only feature.
- `/api/livekit-token` returns `{ url, token, room, identity }` for one user session.
- `/api/chat` remains available for text fallback through the existing chat box.

### Agent Worker

- `agent/worker.py` runs as a long-lived Python process outside Vercel.
- The worker connects to LiveKit with `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and `LIVEKIT_AGENT_NAME`.
- The worker calls external inference URLs rather than loading SenseVoice or CosyVoice2 models inside this repo.
- The worker publishes synthesized audio to the room and sends transcript/reply data messages for the right-side chat history.

## Environment Variables

### Vercel

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `LIVEKIT_AGENT_NAME`
- `DEEPSEEK_API_KEY` for existing text fallback

### Agent Worker

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `LIVEKIT_AGENT_NAME`
- `DEEPSEEK_API_KEY`
- `SENSEVOICE_TRANSCRIBE_URL`
- `COSYVOICE2_SPEECH_URL`

Optional worker variables:

- `EBOT_INSTRUCTIONS`
- `SENSEVOICE_API_KEY`
- `COSYVOICE2_API_KEY`

## Data Flow

1. User clicks `接听`.
2. Browser requests `/api/livekit-token`.
3. Browser connects to LiveKit and enables microphone.
4. Agent Worker receives user audio from the LiveKit room.
5. Agent Worker sends audio to SenseVoice.
6. Agent Worker sends transcript and conversation context to DeepSeek.
7. Agent Worker sends reply text to CosyVoice2.
8. Agent Worker publishes generated audio to LiveKit.
9. Browser plays Agent audio and appends transcript/reply messages in the chat panel.
10. If LiveKit setup fails, the existing browser speech recognition plus chat box fallback remains available.

## Error Handling

- Missing LiveKit credentials returns a JSON error from `/api/livekit-token`.
- LiveKit connection failures show a system notice and fall back to browser speech recognition plus chat box replies.
- Agent-side STT/TTS failures should send a short data message to the room and continue listening when possible.
- Text fallback must not mention backend provider names on public pages.

## Testing

- Add server tests for `/api/livekit-token` token generation and missing configuration.
- Update frontend regression tests so the public app uses LiveKit connection primitives and no longer depends on `/api/realtime` or `RTCPeerConnection`.
- Keep existing DeepSeek backend tests for text fallback.
- Keep public-copy tests that prevent provider names from appearing in the website.

## Deployment

The Vercel deployment remains the public website. The Agent Worker is deployed separately on a machine or service that can reach LiveKit, DeepSeek, SenseVoice, and CosyVoice2. GPU access is only required by the external SenseVoice/CosyVoice2 services if those services self-host the models.
