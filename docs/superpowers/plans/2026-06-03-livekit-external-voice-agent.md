# LiveKit External Voice Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the browser-to-OpenAI Realtime path with a LiveKit room token flow and a separate Python LiveKit Agent Worker that calls external SenseVoice, DeepSeek, and CosyVoice2 services.

**Architecture:** Vercel and the local Node server only serve the website, `/api/chat`, and `/api/livekit-token`. The call page joins a LiveKit room with microphone audio; a Python worker named by `LIVEKIT_AGENT_NAME` joins the same room and owns STT, LLM, and TTS.

**Tech Stack:** Node 18 ESM, Vercel Functions, `livekit-server-sdk`, browser `livekit-client`, Python LiveKit Agents, external HTTP STT/TTS services.

---

## File Map

- Modify: `package.json` and `package-lock.json` for LiveKit SDK dependencies.
- Create: `api/livekit-token.mjs` for browser room tokens and agent dispatch metadata.
- Modify: `server.mjs` to route `/api/livekit-token` locally and remove `/api/realtime`.
- Modify: `public/app.js` and `public/call.html` to connect through LiveKit and keep text-chat fallback.
- Modify: `test/homepage-layout.test.mjs`, `test/server.test.mjs`, and replace `test/vercel-api.test.mjs` coverage with LiveKit token tests.
- Create: `agent/worker.py`, `agent/requirements.txt`, and `agent/README.md` for the Python worker.
- Remove: `api/realtime.mjs` after tests no longer import it.

## Tasks

### Task 1: LiveKit Token API Tests

- [ ] Write failing tests for missing LiveKit env, successful token response, and local server routing.
- [ ] Run `npm test` and confirm failures mention missing `api/livekit-token.mjs` or old realtime behavior.
- [ ] Implement `api/livekit-token.mjs` with `AccessToken`, `RoomConfiguration`, and `RoomAgentDispatch`.
- [ ] Update `server.mjs` to import and route `handleLiveKitTokenPost`.
- [ ] Run `npm test`.

### Task 2: Frontend LiveKit Connection

- [ ] Update layout tests to require `/api/livekit-token`, `RoomEvent.TrackSubscribed`, and `setMicrophoneEnabled(true)`.
- [ ] Update tests to reject `RTCPeerConnection`, `createDataChannel("oai-events")`, `/api/realtime`, `OpenAI`, and public `DeepSeek` mentions.
- [ ] Vendor or import the browser LiveKit ESM client from the installed package without adding a CDN dependency.
- [ ] Replace `connectRealtimeCall` / `disconnectRealtimeCall` with LiveKit room connect/disconnect helpers.
- [ ] Keep `/api/chat`, browser speech recognition, and browser voice selection as fallback behavior.
- [ ] Run `npm test` and `node --check public/app.js`.

### Task 3: Python Agent Worker

- [ ] Add `agent/requirements.txt` with LiveKit Agents and HTTP dependencies.
- [ ] Add `agent/worker.py` using `AgentServer`, `AgentSession`, custom nodes, and environment-driven external STT/TTS URLs.
- [ ] Add `agent/README.md` with required env vars and launch command.
- [ ] Run `python3 -m py_compile agent/worker.py` if dependencies are not required for syntax validation.

### Task 4: Clean Up and Verify

- [ ] Remove `api/realtime.mjs` and OpenAI Realtime session config if no tests or code depend on them.
- [ ] Run `rg -n "OpenAI|OPENAI|api/realtime|RTCPeerConnection|oai-events" public api lib server.mjs test agent`.
- [ ] Run `npm test`.
- [ ] If local browser verification is practical, start the local server and open `http://127.0.0.1:3000/call.html`.
- [ ] Commit the resulting diff after verification.
