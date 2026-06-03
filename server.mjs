import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { handleChatPost } from "./api/chat.mjs";
import { handleLiveKitTokenPost } from "./api/livekit-token.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "public");

const CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
]);

export function getContentType(filePath) {
  return CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream";
}

function decodePathname(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

export function isSafeStaticPath(pathname, publicDir = PUBLIC_DIR) {
  const decoded = decodePathname(pathname);
  if (!decoded || decoded.includes("\0")) {
    return false;
  }

  const relativePath = decoded.replace(/^\/+/, "") || "index.html";
  const resolvedPath = path.resolve(publicDir, relativePath);
  return resolvedPath === publicDir || resolvedPath.startsWith(`${publicDir}${path.sep}`);
}

function resolveStaticPath(pathname) {
  const decoded = decodePathname(pathname) ?? "/";
  const relativePath = decoded.replace(/^\/+/, "") || "index.html";
  return path.resolve(PUBLIC_DIR, relativePath);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

async function serveStaticAsset(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;

  if (!isSafeStaticPath(pathname)) {
    sendJson(response, 403, { error: "Forbidden path." });
    return;
  }

  const filePath = resolveStaticPath(pathname);
  try {
    const asset = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": getContentType(filePath),
      "Cache-Control": "no-store",
    });
    response.end(asset);
  } catch {
    sendJson(response, 404, { error: "Not found." });
  }
}

export function createAppServer() {
  return createServer(async (request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    if (requestUrl.pathname === "/api/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (requestUrl.pathname === "/api/livekit-token") {
      await handleLiveKitTokenPost(request, response);
      return;
    }

    if (requestUrl.pathname === "/api/chat") {
      await handleChatPost(request, response);
      return;
    }

    await serveStaticAsset(request, response);
  });
}

if (process.argv[1] === __filename) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "127.0.0.1";
  createAppServer().listen(port, host, () => {
    console.log(`E-Bot LiveKit voice app is listening on http://${host}:${port}`);
  });
}
