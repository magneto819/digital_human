import { EBOT_SYSTEM_PROMPT } from "../lib/realtime-session.mjs";

const DEEPSEEK_CHAT_URL = "https://api.deepseek.com/chat/completions";
const MAX_BODY_BYTES = 1_000_000;

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function readRequestBody(request, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;

    request.setEncoding?.("utf8");
    request.on("data", (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > limit) {
        reject(new Error("Request body is too large."));
        request.destroy?.();
        return;
      }
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter((message) => ["user", "assistant"].includes(message?.role))
    .map((message) => ({
      role: message.role,
      content: String(message.content || "").slice(0, 2000),
    }))
    .filter((message) => message.content.trim().length > 0)
    .slice(-10);
}

export async function handleChatPost(
  request,
  response,
  { env = process.env, fetchImpl = fetch } = {},
) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Use POST with chat messages." });
    return;
  }

  if (!env.DEEPSEEK_API_KEY) {
    sendJson(response, 500, {
      error: "DEEPSEEK_API_KEY is not configured.",
      detail: "Start the server with DEEPSEEK_API_KEY in the environment.",
    });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readRequestBody(request));
  } catch {
    sendJson(response, 400, { error: "Expected a JSON request body." });
    return;
  }

  const messages = normalizeMessages(payload.messages);
  if (messages.length === 0) {
    sendJson(response, 400, { error: "Expected at least one chat message." });
    return;
  }

  const model = env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const body = {
    model,
    messages: [{ role: "system", content: env.EBOT_INSTRUCTIONS || EBOT_SYSTEM_PROMPT }, ...messages],
    stream: false,
  };

  let upstream;
  try {
    upstream = await fetchImpl(DEEPSEEK_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    sendJson(response, 502, {
      error: "Could not reach DeepSeek.",
      detail: "Check network access and server environment configuration.",
    });
    return;
  }

  const text = await upstream.text();
  if (!upstream.ok) {
    sendJson(response, upstream.status, {
      error: "DeepSeek rejected the chat request.",
      detail: text.slice(0, 1200),
    });
    return;
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    sendJson(response, 502, { error: "DeepSeek returned an invalid JSON response." });
    return;
  }

  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    sendJson(response, 502, { error: "DeepSeek returned an empty response." });
    return;
  }

  sendJson(response, 200, { content, model });
}

export default async function handler(request, response) {
  await handleChatPost(request, response);
}
