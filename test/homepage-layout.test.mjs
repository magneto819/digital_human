import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const appJs = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");

test("homepage presents the E-Bot voice-call hero layout", () => {
  assert.match(html, /E-Bot 专属部署/);
  assert.match(html, /<span>和势宝<\/span>/);
  assert.match(html, /<span>实时语音聊天<\/span>/);
  assert.match(html, /势宝邀请你语音通话/);
  assert.match(html, /src="\/assets\/ebot-mascot-transparent\.png"/);
  assert.match(html, /alt="势宝 E-Bot 吉祥物"/);
  assert.match(html, /id="startButton"/);
  assert.match(html, /href="\/call\.html"/);
  assert.match(html, /接听/);
  assert.match(html, /拒绝/);
});

test("homepage removes the text fallback and transcript sections", () => {
  assert.doesNotMatch(html, /文字补充/);
  assert.doesNotMatch(html, /message-composer/);
  assert.doesNotMatch(html, /textInput/);
  assert.doesNotMatch(html, /sendTextButton/);
  assert.doesNotMatch(html, /Live Transcript/);
  assert.doesNotMatch(html, /transcript-panel/);
  assert.doesNotMatch(html, /clearButton/);
  assert.doesNotMatch(html, /transcriptLog/);
  assert.doesNotMatch(html, /ebot-avatar/);
});

test("homepage standby status stays as a voice-call invitation", () => {
  assert.match(appJs, /standby:\s*\["Standby", "语音通话邀请", "待连接"\]/);
  assert.doesNotMatch(appJs, /准备连接 DeepSeek/);
});

test("public website copy never names DeepSeek", async () => {
  const callHtml = await readFile(new URL("../public/call.html", import.meta.url), "utf8");
  const publicWebsiteText = [html, callHtml, appJs, css].join("\n");

  assert.doesNotMatch(publicWebsiteText, /DeepSeek|deepseek|DEEPSEEK/);
});

test("mascot asset has an alpha channel for transparent display", async () => {
  const png = await readFile(new URL("../public/assets/ebot-mascot-transparent.png", import.meta.url));

  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(png[25], 6);
});

test("voice-call page follows the split call and chat layout", async () => {
  const callHtml = await readFile(new URL("../public/call.html", import.meta.url), "utf8");

  assert.match(callHtml, /class="call-page-shell"/);
  assert.match(callHtml, /href="\/"/);
  assert.match(callHtml, />Back</);
  assert.match(callHtml, /src="\/assets\/ebot-mascot-transparent\.png"/);
  assert.match(callHtml, /Mic input/);
  assert.match(callHtml, /Chat/);
  assert.match(callHtml, /id="chatLog"/);
  assert.match(callHtml, /id="chatInput"/);
  assert.match(callHtml, /Type a message\.\.\./);
  assert.match(callHtml, /id="sendTextButton"/);
});

test("voice-call page exposes live call and chat controls", async () => {
  const callHtml = await readFile(new URL("../public/call.html", import.meta.url), "utf8");

  assert.match(callHtml, /class="call-status-card"/);
  assert.match(callHtml, /id="statusLabel"/);
  assert.match(callHtml, /id="connectionLabel"/);
  assert.match(callHtml, />接听</);
  assert.match(callHtml, />结束</);
  assert.match(callHtml, /id="chatForm"/);
  assert.match(appJs, /elements\.chatForm\?\.addEventListener\("submit", sendTextMessage\)/);
  assert.match(appJs, /recognition\.start\(\)/);
  assert.match(appJs, /new SpeechSynthesisUtterance\(text\)/);
});

test("voice-call page lets users choose and save a browser speech voice", async () => {
  const callHtml = await readFile(new URL("../public/call.html", import.meta.url), "utf8");

  assert.match(callHtml, /for="voiceSelect"/);
  assert.match(callHtml, />音色选择</);
  assert.match(callHtml, /id="voiceSelect"/);
  assert.match(appJs, /speechSynthesis\.getVoices\(\)/);
  assert.match(appJs, /speechSynthesis\.addEventListener\("voiceschanged", populateVoiceOptions\)/);
  assert.match(appJs, /window\.localStorage\.getItem\(voiceStorageKey/);
  assert.match(appJs, /window\.localStorage\.setItem\(voiceStorageKey/);
  assert.match(appJs, /"keyup"/);
  assert.match(appJs, /"blur"/);
  assert.match(appJs, /voiceSaveTimer/);
  assert.match(appJs, /window\.setInterval\(syncSelectedVoiceName/);
  assert.match(appJs, /utterance\.voice = selectedVoice/);
});

test("voice recognition permission errors stop restart loops", () => {
  assert.match(appJs, /recognitionBlocked/);
  assert.match(appJs, /not-allowed/);
  assert.match(appJs, /service-not-allowed/);
  assert.match(appJs, /!state\.recognitionBlocked/);
});

test("voice-call page hides SenseVoice prompt tokens from visible chat", () => {
  assert.match(appJs, /stripSenseVoiceMarkers/);
  assert.match(appJs, /SENSEVOICE_MARKER_PATTERN/);
  assert.match(appJs, /stripSenseVoiceMarkers\(text\)/);
});

test("voice-call page starts a real LiveKit audio session", async () => {
  const callHtml = await readFile(new URL("../public/call.html", import.meta.url), "utf8");

  assert.match(callHtml, /id="remoteAudio"/);
  assert.match(appJs, /import\("\/vendor\/livekit-client\.esm\.mjs"\)/);
  assert.match(appJs, /fetch\("\/api\/livekit-token"/);
  assert.match(appJs, /new Room\(/);
  assert.match(appJs, /RoomEvent\.TrackSubscribed/);
  assert.match(appJs, /setMicrophoneEnabled\(true/);
  assert.match(appJs, /track\.attach\(elements\.remoteAudio\)/);
  assert.doesNotMatch(appJs, /new RTCPeerConnection\(/);
  assert.doesNotMatch(appJs, /createDataChannel\("oai-events"\)/);
  assert.doesNotMatch(appJs, /fetch\("\/api\/realtime"/);
});

test("voice-call page keeps live controls visible in the first viewport", async () => {
  const callHtml = await readFile(new URL("../public/call.html", import.meta.url), "utf8");

  assert.match(callHtml, /id="statusStartButton"/);
  assert.match(callHtml, /id="fpsBadge"/);
  assert.doesNotMatch(callHtml, /All history loaded/);
  assert.doesNotMatch(callHtml, /Previous conversation/);
  assert.match(appJs, /elements\.statusStartButton\?\.addEventListener\("click", startCall\)/);
  assert.match(appJs, /requestAnimationFrame/);
  assert.match(css, /\.call-page-shell\s*{[^}]*height:\s*100dvh/s);
  assert.match(css, /\.call-chat-panel\s*{[^}]*height:\s*100dvh/s);
  assert.match(css, /\.call-mascot-image\s*{[^}]*animation:\s*floatMascot/s);
  assert.match(css, /\.chat-composer\s*{[^}]*position:\s*sticky/s);
});
