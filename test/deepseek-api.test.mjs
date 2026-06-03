import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { handleChatPost } from "../api/chat.mjs";

function createJsonRequest(payload, method = "POST") {
  const request = Readable.from([JSON.stringify(payload)]);
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

test("handleChatPost returns a clear error when DEEPSEEK_API_KEY is missing", async () => {
  const response = createResponse();

  await handleChatPost(createJsonRequest({ messages: [{ role: "user", content: "你好" }] }), response, {
    env: {},
  });

  assert.equal(response.statusCode, 500);
  assert.match(response.headers["content-type"], /application\/json/);
  assert.deepEqual(JSON.parse(response.body), {
    detail: "Start the server with DEEPSEEK_API_KEY in the environment.",
    error: "DEEPSEEK_API_KEY is not configured.",
  });
});

test("handleChatPost rejects empty messages before contacting DeepSeek", async () => {
  const response = createResponse();
  let called = false;

  await handleChatPost(createJsonRequest({ messages: [] }), response, {
    env: { DEEPSEEK_API_KEY: "test-key" },
    fetchImpl: async () => {
      called = true;
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(called, false);
  assert.equal(JSON.parse(response.body).error, "Expected at least one chat message.");
});

test("handleChatPost proxies chat messages to DeepSeek with the E-Bot persona", async () => {
  const response = createResponse();
  let capturedUrl = "";
  let capturedAuth = "";
  let capturedBody = {};

  await handleChatPost(
    createJsonRequest({
      messages: [
        { role: "user", content: "介绍一下你自己" },
        { role: "assistant", content: "我是势宝。" },
        { role: "user", content: "你能做什么？" },
      ],
    }),
    response,
    {
      env: {
        DEEPSEEK_API_KEY: "test-key",
        DEEPSEEK_MODEL: "deepseek-v4-pro",
      },
      fetchImpl: async (url, options) => {
        capturedUrl = url;
        capturedAuth = options.headers.Authorization;
        capturedBody = JSON.parse(options.body);
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "我可以用中文与你交流。" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(capturedUrl, "https://api.deepseek.com/chat/completions");
  assert.equal(capturedAuth, "Bearer test-key");
  assert.equal(capturedBody.model, "deepseek-v4-pro");
  assert.equal(capturedBody.stream, false);
  assert.match(capturedBody.messages[0].content, /势宝/);
  assert.deepEqual(capturedBody.messages.slice(1), [
    { role: "user", content: "介绍一下你自己" },
    { role: "assistant", content: "我是势宝。" },
    { role: "user", content: "你能做什么？" },
  ]);
  assert.deepEqual(JSON.parse(response.body), {
    content: "我可以用中文与你交流。",
    model: "deepseek-v4-pro",
  });
});
