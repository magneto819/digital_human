import assert from "node:assert/strict";
import test from "node:test";

import {
  getContentType,
  isSafeStaticPath,
} from "../server.mjs";

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
