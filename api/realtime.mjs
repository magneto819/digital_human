import { buildRealtimeSessionConfig } from "../lib/realtime-session.mjs";

const MAX_SDP_BYTES = 1_000_000;
const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function readRequestBody(request, limit = MAX_SDP_BYTES) {
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

export async function handleRealtimePost(
  request,
  response,
  { env = process.env, fetchImpl = fetch } = {},
) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Use POST with an SDP offer." });
    return;
  }

  if (!env.OPENAI_API_KEY) {
    sendJson(response, 500, {
      error: "OPENAI_API_KEY is not configured.",
      detail: "Start the server with OPENAI_API_KEY in the environment.",
    });
    return;
  }

  let sdpOffer;
  try {
    sdpOffer = await readRequestBody(request);
  } catch (error) {
    sendJson(response, 413, { error: error.message });
    return;
  }

  if (!sdpOffer.trim().startsWith("v=0")) {
    sendJson(response, 400, { error: "Expected a WebRTC SDP offer." });
    return;
  }

  const formData = new FormData();
  formData.set("sdp", sdpOffer);
  formData.set("session", JSON.stringify(buildRealtimeSessionConfig(env)));

  let upstream;
  try {
    upstream = await fetchImpl(REALTIME_CALLS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: formData,
    });
  } catch {
    sendJson(response, 502, {
      error: "Could not reach OpenAI Realtime.",
      detail: "Check network access and server environment configuration.",
    });
    return;
  }

  const answer = await upstream.text();
  if (!upstream.ok) {
    sendJson(response, upstream.status, {
      error: "OpenAI Realtime rejected the session.",
      detail: answer.slice(0, 1200),
    });
    return;
  }

  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": "application/sdp",
  });
  response.end(answer);
}

export default async function handler(request, response) {
  await handleRealtimePost(request, response);
}
