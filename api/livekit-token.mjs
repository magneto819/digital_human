import { randomUUID } from "node:crypto";

import { AccessToken, RoomAgentDispatch, RoomConfiguration } from "livekit-server-sdk";

const MAX_BODY_BYTES = 20_000;
const REQUIRED_ENV = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"];
const DEFAULT_AGENT_NAME = "ebot-agent";

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

function missingLiveKitEnv(env) {
  return REQUIRED_ENV.filter((name) => !env[name]);
}

function sanitizeIdentifier(value, fallbackPrefix) {
  const raw = String(value || "").trim();
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 80);
  return safe || `${fallbackPrefix}-${randomUUID()}`;
}

export async function createLiveKitRoomToken({
  agentName,
  apiKey,
  apiSecret,
  identity,
  room,
}) {
  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    name: "势宝访客",
    ttl: "15m",
  });
  token.addGrant({
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
    room,
    roomJoin: true,
  });
  token.roomConfig = new RoomConfiguration({
    agents: [
      new RoomAgentDispatch({
        agentName,
        metadata: JSON.stringify({ source: "ebot-web", room }),
      }),
    ],
  });
  return token.toJwt();
}

export async function handleLiveKitTokenPost(
  request,
  response,
  { createToken = createLiveKitRoomToken, env = process.env } = {},
) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Use POST with a JSON body." });
    return;
  }

  const missing = missingLiveKitEnv(env);
  if (missing.length) {
    sendJson(response, 500, {
      detail: "Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET in the environment.",
      error: "LiveKit is not configured.",
      missing,
    });
    return;
  }

  let payload;
  try {
    payload = JSON.parse((await readRequestBody(request)) || "{}");
  } catch {
    sendJson(response, 400, { error: "Expected a JSON request body." });
    return;
  }

  const agentName = sanitizeIdentifier(env.LIVEKIT_AGENT_NAME || DEFAULT_AGENT_NAME, "agent");
  const room = sanitizeIdentifier(payload.room, "ebot");
  const identity = sanitizeIdentifier(payload.identity, "visitor");
  const token = await createToken({
    agentName,
    apiKey: env.LIVEKIT_API_KEY,
    apiSecret: env.LIVEKIT_API_SECRET,
    identity,
    room,
  });

  sendJson(response, 200, {
    agentName,
    identity,
    room,
    token,
    url: env.LIVEKIT_URL,
  });
}

export default async function handler(request, response) {
  await handleLiveKitTokenPost(request, response);
}
