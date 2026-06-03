import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRealtimeSessionConfig,
  getContentType,
  isSafeStaticPath,
} from "../server.mjs";

test("buildRealtimeSessionConfig defaults to an E-Bot realtime voice persona", () => {
  const config = buildRealtimeSessionConfig({});

  assert.equal(config.type, "realtime");
  assert.equal(config.model, "gpt-realtime");
  assert.equal(config.audio.output.voice, "marin");
  assert.match(config.instructions, /势宝/);
  assert.match(config.instructions, /北京具身势能科技有限公司/);
});

test("buildRealtimeSessionConfig allows model, voice, and instructions overrides", () => {
  const config = buildRealtimeSessionConfig({
    OPENAI_REALTIME_MODEL: "gpt-realtime-mini",
    OPENAI_REALTIME_VOICE: "cedar",
    EBOT_INSTRUCTIONS: "custom persona",
  });

  assert.equal(config.model, "gpt-realtime-mini");
  assert.equal(config.audio.output.voice, "cedar");
  assert.equal(config.instructions, "custom persona");
});

test("getContentType returns stable types for served assets", () => {
  assert.equal(getContentType("index.html"), "text/html; charset=utf-8");
  assert.equal(getContentType("styles.css"), "text/css; charset=utf-8");
  assert.equal(getContentType("app.js"), "text/javascript; charset=utf-8");
  assert.equal(getContentType("asset.unknown"), "application/octet-stream");
});

test("isSafeStaticPath rejects traversal outside the public root", () => {
  assert.equal(isSafeStaticPath("/app.js"), true);
  assert.equal(isSafeStaticPath("/nested/asset.png"), true);
  assert.equal(isSafeStaticPath("/../server.mjs"), false);
  assert.equal(isSafeStaticPath("/%2e%2e/server.mjs"), false);
});
