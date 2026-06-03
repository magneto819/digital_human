import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { handleRealtimePost } from "../api/realtime.mjs";

function createRequest(body, method = "POST") {
  const request = Readable.from([body]);
  request.method = method;
  return request;
}

function createResponse() {
  return {
    body: "",
    headers: {},
    statusCode: 200,
    end(chunk = "") {
      this.body += String(chunk);
      this.finished = true;
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      for (const [name, value] of Object.entries(headers)) {
        this.setHeader(name, value);
      }
    },
  };
}

test("handleRealtimePost returns a clear error when OPENAI_API_KEY is missing", async () => {
  const response = createResponse();

  await handleRealtimePost(createRequest("v=0"), response, { env: {} });

  assert.equal(response.statusCode, 500);
  assert.match(response.headers["content-type"], /application\/json/);
  assert.deepEqual(JSON.parse(response.body), {
    detail: "Start the server with OPENAI_API_KEY in the environment.",
    error: "OPENAI_API_KEY is not configured.",
  });
});

test("handleRealtimePost rejects invalid SDP before contacting OpenAI", async () => {
  const response = createResponse();
  let called = false;

  await handleRealtimePost(createRequest("not an sdp"), response, {
    env: { OPENAI_API_KEY: "test-key" },
    fetchImpl: async () => {
      called = true;
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(called, false);
  assert.equal(JSON.parse(response.body).error, "Expected a WebRTC SDP offer.");
});

test("handleRealtimePost proxies a valid SDP offer to OpenAI Realtime", async () => {
  const response = createResponse();
  let capturedUrl = "";
  let capturedAuth = "";
  let capturedSession = "";
  let capturedSdp = "";

  await handleRealtimePost(createRequest("v=0\nfake-offer"), response, {
    env: {
      EBOT_INSTRUCTIONS: "custom E-Bot",
      OPENAI_API_KEY: "test-key",
      OPENAI_REALTIME_MODEL: "gpt-realtime-mini",
      OPENAI_REALTIME_VOICE: "cedar",
    },
    fetchImpl: async (url, options) => {
      capturedUrl = url;
      capturedAuth = options.headers.Authorization;
      capturedSdp = options.body.get("sdp");
      capturedSession = options.body.get("session");
      return new Response("v=0\nfake-answer", { status: 200 });
    },
  });

  const session = JSON.parse(capturedSession);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "application/sdp");
  assert.equal(response.body, "v=0\nfake-answer");
  assert.equal(capturedUrl, "https://api.openai.com/v1/realtime/calls");
  assert.equal(capturedAuth, "Bearer test-key");
  assert.equal(capturedSdp, "v=0\nfake-offer");
  assert.equal(session.model, "gpt-realtime-mini");
  assert.equal(session.audio.output.voice, "cedar");
  assert.equal(session.instructions, "custom E-Bot");
});
