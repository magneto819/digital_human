import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { handleLiveKitTokenPost } from "../api/livekit-token.mjs";

function createRequest(body = "{}", method = "POST") {
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

test("handleLiveKitTokenPost returns a clear error when LiveKit env is missing", async () => {
  const response = createResponse();

  await handleLiveKitTokenPost(createRequest(), response, { env: {} });

  assert.equal(response.statusCode, 500);
  assert.match(response.headers["content-type"], /application\/json/);
  assert.deepEqual(JSON.parse(response.body), {
    detail: "Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET in the environment.",
    error: "LiveKit is not configured.",
    missing: ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"],
  });
});

test("handleLiveKitTokenPost rejects non-JSON request bodies", async () => {
  const response = createResponse();

  await handleLiveKitTokenPost(createRequest("not json"), response, {
    env: {
      LIVEKIT_API_KEY: "api-key",
      LIVEKIT_API_SECRET: "api-secret",
      LIVEKIT_URL: "wss://example.livekit.cloud",
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error, "Expected a JSON request body.");
});

test("handleLiveKitTokenPost returns a room token with agent dispatch metadata", async () => {
  const response = createResponse();

  await handleLiveKitTokenPost(
    createRequest(JSON.stringify({ room: "ebot-test-room", identity: "visitor-1" })),
    response,
    {
      createToken: async ({ agentName, identity, room }) => {
        assert.equal(agentName, "ebot-agent");
        assert.equal(identity, "visitor-1");
        assert.equal(room, "ebot-test-room");
        return "header.payload.signature";
      },
      env: {
        LIVEKIT_AGENT_NAME: "ebot-agent",
        LIVEKIT_API_KEY: "api-key",
        LIVEKIT_API_SECRET: "api-secret",
        LIVEKIT_URL: "wss://example.livekit.cloud",
      },
    },
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    agentName: "ebot-agent",
    identity: "visitor-1",
    room: "ebot-test-room",
    token: "header.payload.signature",
    url: "wss://example.livekit.cloud",
  });
});

test("handleLiveKitTokenPost creates safe defaults when room and identity are omitted", async () => {
  const response = createResponse();
  let capturedRoom = "";
  let capturedIdentity = "";

  await handleLiveKitTokenPost(createRequest("{}"), response, {
    createToken: async ({ identity, room }) => {
      capturedRoom = room;
      capturedIdentity = identity;
      return "token";
    },
    env: {
      LIVEKIT_API_KEY: "api-key",
      LIVEKIT_API_SECRET: "api-secret",
      LIVEKIT_URL: "wss://example.livekit.cloud",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.match(capturedRoom, /^ebot-/);
  assert.match(capturedIdentity, /^visitor-/);
});
