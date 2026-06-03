import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("agent worker documents the external LiveKit voice pipeline", async () => {
  const worker = await readFile(new URL("../agent/worker.py", import.meta.url), "utf8");
  const requirements = await readFile(new URL("../agent/requirements.txt", import.meta.url), "utf8");
  const readme = await readFile(new URL("../agent/README.md", import.meta.url), "utf8");

  assert.match(worker, /AgentServer\(\)/);
  assert.match(worker, /@server\.rtc_session\(agent_name=agent_name\)/);
  assert.match(worker, /SENSEVOICE_TRANSCRIBE_URL/);
  assert.match(worker, /DEEPSEEK_API_KEY/);
  assert.match(worker, /COSYVOICE2_SPEECH_URL/);
  assert.match(worker, /publish_data/);
  assert.match(worker, /AudioSource/);
  assert.match(worker, /LocalAudioTrack\.create_audio_track/);
  assert.match(worker, /strip_sensevoice_markers/);
  assert.match(requirements, /livekit-agents/);
  assert.match(requirements, /aiohttp/);
  assert.match(readme, /python worker\.py dev/);
  assert.match(readme, /LIVEKIT_AGENT_NAME=ebot-agent/);
});
