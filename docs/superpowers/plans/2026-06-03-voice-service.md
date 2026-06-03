# Voice Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deployable FastAPI service exposing SenseVoice STT and CosyVoice2 TTS endpoints for the E-Bot LiveKit Agent Worker.

**Architecture:** Add an isolated `voice-service/` Python app with HTTP routes, configuration, lazy model adapters, tests, and Docker deployment files. The existing Vercel website and LiveKit Worker will consume this service through `SENSEVOICE_TRANSCRIBE_URL` and `COSYVOICE2_SPEECH_URL`.

**Tech Stack:** Python, FastAPI, pytest, optional FunAudioLLM SenseVoice/CosyVoice2 runtime packages, Docker.

---

### Task 1: Service Contract Tests

**Files:**
- Create: `voice-service/tests/test_app.py`

- [ ] Write tests for `/health`, `/transcribe`, `/speech`, and bearer-token auth using fake adapters.
- [ ] Run `python3 -m pytest voice-service/tests/test_app.py -q` and verify tests fail before implementation.

### Task 2: FastAPI App

**Files:**
- Create: `voice-service/app/config.py`
- Create: `voice-service/app/services.py`
- Create: `voice-service/app/main.py`
- Create: `voice-service/app/__init__.py`

- [ ] Implement environment parsing and request auth.
- [ ] Implement lazy STT/TTS service adapters.
- [ ] Implement `/health`, `/transcribe`, and `/speech`.
- [ ] Run `python3 -m pytest voice-service/tests/test_app.py -q` and verify tests pass.

### Task 3: Deployment Files

**Files:**
- Create: `voice-service/requirements.txt`
- Create: `voice-service/requirements.gpu.txt`
- Create: `voice-service/Dockerfile`
- Create: `voice-service/README.md`
- Modify: `.gitignore`
- Modify: `agent/README.md`

- [ ] Add lightweight runtime requirements and separate optional GPU/model requirements.
- [ ] Add Dockerfile and copy-pastable run instructions.
- [ ] Document how to point Agent Worker env vars at the service.
- [ ] Ignore local `.venv/`.

### Task 4: Verification And Release

- [ ] Run `python3 -m py_compile voice-service/app/*.py`.
- [ ] Run `python3 -m pytest voice-service/tests/test_app.py -q`.
- [ ] Run `npm test`.
- [ ] Commit, push, and deploy the unchanged Vercel web app if deployment metadata needs refreshing.
