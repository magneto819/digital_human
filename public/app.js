const elements = {
  answerButton: document.querySelector("#answerButton"),
  body: document.body,
  chatForm: document.querySelector("#chatForm"),
  chatInput: document.querySelector("#chatInput"),
  chatLog: document.querySelector("#chatLog"),
  clearButton: document.querySelector("#clearButton"),
  connectionLabel: document.querySelector("#connectionLabel"),
  elapsedLabel: document.querySelector("#elapsedLabel"),
  fpsBadge: document.querySelector("#fpsBadge"),
  localMeter: document.querySelector("#localMeter"),
  muteButton: document.querySelector("#muteButton"),
  remoteAudio: document.querySelector("#remoteAudio"),
  sendTextButton: document.querySelector("#sendTextButton"),
  startButton: document.querySelector("#startButton"),
  statusLabel: document.querySelector("#statusLabel"),
  statusStartButton: document.querySelector("#statusStartButton"),
  stopButton: document.querySelector("#stopButton"),
  voiceSelect: document.querySelector("#voiceSelect"),
};

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const isCallPage = elements.body.dataset.page === "call";
const voiceStorageKey = "ebotVoiceName";
const SENSEVOICE_MARKER_PATTERN = /^[\s\uFEFF\u200B]*(?:<\|[^|<>]+\|>[\s\uFEFF\u200B]*)+/;

const state = {
  active: false,
  audioContext: null,
  callStartedAt: null,
  elapsedTimer: null,
  fpsFrame: null,
  fpsLastTime: 0,
  fpsSampleCount: 0,
  liveKitClient: null,
  liveKitConnected: false,
  liveKitConnecting: false,
  liveKitRoom: null,
  localStream: null,
  micAnalyser: null,
  micSource: null,
  meterTimer: null,
  messages: [],
  muted: false,
  recognition: null,
  recognitionActive: false,
  recognitionBlocked: false,
  sending: false,
  speechSupported: Boolean(SpeechRecognition),
  speechVoices: [],
  systemNotices: new Set(),
  savedVoiceName: "",
  voiceSaveTimer: null,
};

const statusText = {
  standby: ["Standby", "语音通话邀请", "待连接"],
  connecting: ["Voice", "正在启动语音能力", "连接中"],
  listening: ["Listening", "势宝正在听", "聆听中"],
  connected: ["Connected", "可以开始说话", "已连接"],
  speaking: ["Speaking", "势宝正在回应", "回应中"],
  error: ["Attention", "连接遇到问题", "需检查"],
};

function setStatus(status, detail) {
  const [, label, connection] = statusText[status] ?? statusText.standby;
  elements.body.dataset.callState = status;

  if (elements.statusLabel) {
    elements.statusLabel.textContent = detail || label;
  }

  if (elements.connectionLabel) {
    elements.connectionLabel.textContent = connection;
  }
}

function setStartButtonState(button, active) {
  if (!button || button.tagName !== "BUTTON") {
    return;
  }

  button.disabled = active;
  button.classList.toggle("is-active", active);
  const label = button.querySelector("span");
  if (label) {
    label.textContent = state.liveKitConnecting ? "连接中" : active ? "通话中" : "接听";
  }
}

function setControls(active) {
  setStartButtonState(elements.startButton, active);
  setStartButtonState(elements.statusStartButton, active);

  if (elements.answerButton) {
    elements.answerButton.disabled = active;
  }

  if (elements.stopButton) {
    elements.stopButton.disabled = !active;
  }

  if (elements.muteButton) {
    const canMute = Boolean(state.localStream) || (state.speechSupported && !state.recognitionBlocked);
    elements.muteButton.disabled = !active || !canMute;
    elements.muteButton.setAttribute("aria-label", state.muted ? "取消静音" : "静音麦克风");
  }

  if (elements.sendTextButton) {
    elements.sendTextButton.disabled = state.sending;
    elements.sendTextButton.textContent = state.sending ? "Sending" : "Send";
  }
}

function startFpsTicker() {
  if (!elements.fpsBadge || state.fpsFrame) {
    return;
  }

  const tick = (timestamp) => {
    if (!state.fpsLastTime) {
      state.fpsLastTime = timestamp;
    }

    state.fpsSampleCount += 1;
    const elapsed = timestamp - state.fpsLastTime;
    if (elapsed >= 600) {
      const fps = Math.round((state.fpsSampleCount * 1000) / elapsed);
      elements.fpsBadge.textContent = `${fps} FPS`;
      state.fpsLastTime = timestamp;
      state.fpsSampleCount = 0;
    }

    state.fpsFrame = window.requestAnimationFrame(tick);
  };

  state.fpsFrame = window.requestAnimationFrame(tick);
}

function updateMeter(level = 0.18) {
  if (!elements.localMeter) {
    return;
  }

  const bars = Array.from(elements.localMeter.querySelectorAll("span"));
  bars.forEach((bar, index) => {
    const phase = Math.sin(Date.now() / 130 + index * 0.9);
    const height = Math.max(8, Math.round(12 + (level + Math.max(0, phase) * level) * 38));
    bar.style.height = `${height}px`;
  });
}

function startMeter(levelGetter) {
  stopMeter();
  state.meterTimer = window.setInterval(() => updateMeter(levelGetter()), 110);
}

function stopMeter() {
  if (state.meterTimer) {
    window.clearInterval(state.meterTimer);
    state.meterTimer = null;
  }
  updateMeter(0.08);
}

function startMicMeter(stream) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) {
    startMeter(() => 0.32);
    return;
  }

  if (state.audioContext) {
    state.audioContext.close().catch(() => {});
  }

  state.audioContext = new AudioContext();
  state.micAnalyser = state.audioContext.createAnalyser();
  state.micAnalyser.fftSize = 256;
  state.micSource = state.audioContext.createMediaStreamSource(stream);
  state.micSource.connect(state.micAnalyser);

  const samples = new Uint8Array(state.micAnalyser.fftSize);
  startMeter(() => {
    if (!state.micAnalyser || state.muted) {
      return 0.08;
    }

    state.micAnalyser.getByteTimeDomainData(samples);
    const energy = samples.reduce((total, sample) => {
      const centered = (sample - 128) / 128;
      return total + centered * centered;
    }, 0);
    const rms = Math.sqrt(energy / samples.length);
    return Math.min(0.9, Math.max(0.1, rms * 5));
  });
}

function stopMicMeter() {
  if (state.audioContext) {
    state.audioContext.close().catch(() => {});
  }
  state.audioContext = null;
  state.micAnalyser = null;
  state.micSource = null;
  stopMeter();
}

function getMicrophoneErrorMessage(error) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return "麦克风权限未开启，请允许浏览器使用麦克风。";
  }

  if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") {
    return "没有找到可用麦克风。";
  }

  return error?.message || "实时语音连接失败。";
}

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function updateElapsed() {
  if (!elements.elapsedLabel || !state.callStartedAt) {
    return;
  }
  elements.elapsedLabel.textContent = formatElapsed(Date.now() - state.callStartedAt);
}

function startElapsedTimer() {
  state.callStartedAt = Date.now();
  updateElapsed();
  if (state.elapsedTimer) {
    window.clearInterval(state.elapsedTimer);
  }
  state.elapsedTimer = window.setInterval(updateElapsed, 1000);
}

function stopElapsedTimer() {
  if (state.elapsedTimer) {
    window.clearInterval(state.elapsedTimer);
    state.elapsedTimer = null;
  }
  state.callStartedAt = null;
  if (elements.elapsedLabel) {
    elements.elapsedLabel.textContent = "00:00";
  }
}

function remember(role, content) {
  state.messages.push({ role, content });
  state.messages = state.messages.slice(-10);
}

function appendChatMessage(role, text) {
  if (!elements.chatLog) {
    return;
  }

  const line = document.createElement("article");
  line.className = `chat-message ${role}`;

  const content = document.createElement("p");
  content.textContent = text;
  line.append(content);

  elements.chatLog.append(line);
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
}

function appendSystemNotice(key, text) {
  if (state.systemNotices.has(key)) {
    return;
  }

  state.systemNotices.add(key);
  appendChatMessage("system", text);
}

async function readVoiceSessionError(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const payload = await response.json().catch(() => ({}));
    return payload.detail || payload.error || "实时语音服务暂时不可用。";
  }

  const text = await response.text().catch(() => "");
  return text || "实时语音服务暂时不可用。";
}

async function loadLiveKitClient() {
  if (!state.liveKitClient) {
    state.liveKitClient = await import("/vendor/livekit-client.esm.mjs");
  }
  return state.liveKitClient;
}

function createSessionId(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}-${suffix}`;
}

function getLiveKitMicrophoneStream(room, Track) {
  const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
  const mediaTrack = publication?.track?.mediaStreamTrack;
  return mediaTrack ? new MediaStream([mediaTrack]) : null;
}

function stripSenseVoiceMarkers(text) {
  return String(text || "").replace(SENSEVOICE_MARKER_PATTERN, "").trim();
}

function appendLiveKitText(role, text) {
  const cleanText = stripSenseVoiceMarkers(text);
  if (!cleanText) {
    return;
  }

  appendChatMessage(role, cleanText);
  remember(role === "user" ? "user" : "assistant", cleanText);
}

function handleLiveKitData(payload, participant) {
  const rawText = new TextDecoder().decode(payload);
  let message = { text: rawText };
  try {
    message = JSON.parse(rawText);
  } catch {
    // Plain text payloads are valid for lightweight workers.
  }

  const role = participant?.isLocal || message.role === "user" ? "user" : "assistant";
  appendLiveKitText(role, message.text || message.content || rawText);
}

function handleLiveKitTranscription(segments, participant) {
  const role = participant?.isLocal ? "user" : "assistant";
  segments.forEach((segment) => {
    if (segment?.final || segment?.isFinal) {
      appendLiveKitText(role, segment.text);
    }
  });
}

function disconnectLiveKitCall() {
  if (state.liveKitRoom) {
    state.liveKitRoom.disconnect();
  }
  if (state.localStream) {
    state.localStream.getTracks().forEach((track) => track.stop());
  }
  if (elements.remoteAudio) {
    elements.remoteAudio.srcObject = null;
  }

  state.liveKitConnected = false;
  state.liveKitConnecting = false;
  state.liveKitRoom = null;
  state.localStream = null;
  stopMicMeter();
}

async function connectLiveKitCall() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("当前浏览器不支持实时语音通话。");
  }

  const response = await fetch("/api/livekit-token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      identity: createSessionId("visitor"),
      room: createSessionId("ebot"),
    }),
  });

  if (!response.ok) {
    throw new Error(await readVoiceSessionError(response));
  }

  const tokenPayload = await response.json();
  const { Room, RoomEvent, Track } = await loadLiveKitClient();
  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
  });
  state.liveKitRoom = room;

  room.on(RoomEvent.TrackSubscribed, (track) => {
    if (track.kind === Track.Kind.Audio && elements.remoteAudio) {
      track.attach(elements.remoteAudio);
      elements.remoteAudio.play().catch(() => {});
    }
  });
  room.on(RoomEvent.TrackUnsubscribed, (track) => {
    track.detach?.();
  });
  room.on(RoomEvent.DataReceived, handleLiveKitData);
  room.on(RoomEvent.TranscriptionReceived, handleLiveKitTranscription);
  room.on(RoomEvent.Connected, () => {
    state.liveKitConnected = true;
    state.liveKitConnecting = false;
    setControls(true);
    setStatus("listening", "实时语音已连接，直接说话");
  });
  room.on(RoomEvent.Disconnected, () => {
    state.liveKitConnected = false;
    state.liveKitConnecting = false;
    if (state.active) {
      appendSystemNotice("livekit-disconnected", "实时语音连接中断，可以继续使用右侧文字聊天。");
      setStatus("error", "实时语音连接中断");
    }
  });

  await room.connect(tokenPayload.url, tokenPayload.token, { autoSubscribe: true });
  await room.localParticipant.setMicrophoneEnabled(true, {
    autoGainControl: true,
    echoCancellation: true,
    noiseSuppression: true,
  });

  state.localStream = getLiveKitMicrophoneStream(room, Track);
  if (state.localStream) {
    startMicMeter(state.localStream);
  } else {
    startMeter(() => 0.42);
  }

  appendChatMessage("assistant", "实时语音已接通。你可以直接说话，也可以在右侧打字。");
}

function clearChat() {
  state.messages = [];
  state.systemNotices.clear();
  if (!elements.chatLog) {
    return;
  }

  elements.chatLog.innerHTML = "";
  const divider = document.createElement("p");
  divider.className = "history-divider";
  divider.textContent = "Current conversation";
  elements.chatLog.append(divider);
  appendChatMessage("assistant current", "你好，我在。今天想聊点什么？");
}

function createRecognition() {
  if (!SpeechRecognition) {
    return null;
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "zh-CN";

  recognition.onstart = () => {
    state.recognitionActive = true;
    if (!state.muted) {
      setStatus("listening", "我在听，请直接说");
    }
  };

  recognition.onend = () => {
    state.recognitionActive = false;
    if (state.active && !state.muted && !state.recognitionBlocked && elements.body.dataset.callState !== "speaking") {
      window.setTimeout(startRecognition, 250);
    }
  };

  recognition.onerror = (event) => {
    if (event.error === "no-speech") {
      return;
    }

    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      state.recognitionActive = false;
      state.recognitionBlocked = true;
      stopMeter();
      appendSystemNotice("speech-permission", "语音识别未授权，可以继续使用右侧文字聊天。");
      setControls(state.active);
      setStatus("connected", "语音识别未授权，文字聊天可用");
      return;
    }

    appendSystemNotice(`speech-${event.error}`, `语音识别暂时不可用：${event.error}`);
    setStatus("connected", `语音识别暂时不可用：${event.error}`);
  };

  recognition.onresult = (event) => {
    let finalText = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (result.isFinal) {
        finalText += result[0].transcript;
      }
    }

    const text = finalText.trim();
    if (text) {
      stopRecognition();
      sendMessage(text, { speak: true });
    }
  };

  return recognition;
}

function startRecognition() {
  if (!state.active || state.muted || state.recognitionBlocked || !state.recognition || state.recognitionActive) {
    return;
  }

  try {
    state.recognition.start();
  } catch {
    state.recognitionActive = false;
  }
}

function stopRecognition() {
  if (!state.recognition || !state.recognitionActive) {
    return;
  }

  try {
    state.recognition.stop();
  } catch {
    state.recognitionActive = false;
  }
}

function readSavedVoiceName() {
  try {
    return window.localStorage.getItem(voiceStorageKey) || "";
  } catch {
    return "";
  }
}

function saveVoiceName(voiceName) {
  try {
    window.localStorage.setItem(voiceStorageKey, voiceName);
  } catch {
    // Private browsing modes can block storage; voice selection still works for the current page.
  }
}

function isChineseVoice(voice) {
  return voice.lang?.toLowerCase().startsWith("zh") || /Chinese|Mandarin|Putonghua|中文|普通话|國語|粤语|粵語/.test(voice.name);
}

function populateVoiceOptions() {
  if (!elements.voiceSelect || !window.speechSynthesis) {
    return;
  }

  const voices = window.speechSynthesis.getVoices();
  const chineseVoices = voices.filter(isChineseVoice);
  state.speechVoices = chineseVoices;
  elements.voiceSelect.replaceChildren();

  if (!voices.length) {
    elements.voiceSelect.disabled = true;
    elements.voiceSelect.append(new Option("正在加载浏览器音色", ""));
    return;
  }

  if (!chineseVoices.length) {
    elements.voiceSelect.disabled = true;
    elements.voiceSelect.append(new Option("未找到中文音色", ""));
    return;
  }

  const savedVoiceName = readSavedVoiceName();
  chineseVoices.forEach((voice) => {
    elements.voiceSelect.append(new Option(`${voice.name} (${voice.lang})`, voice.name));
  });

  if (savedVoiceName && chineseVoices.some((voice) => voice.name === savedVoiceName)) {
    elements.voiceSelect.value = savedVoiceName;
  }

  state.savedVoiceName = elements.voiceSelect.value;
  elements.voiceSelect.disabled = false;
}

function getSelectedVoice() {
  if (!elements.voiceSelect?.value) {
    return null;
  }

  return state.speechVoices.find((voice) => voice.name === elements.voiceSelect.value) || null;
}

function handleVoiceSelectionChange() {
  syncSelectedVoiceName();
}

function syncSelectedVoiceName() {
  if (!elements.voiceSelect) {
    return;
  }

  const voiceName = elements.voiceSelect.value;
  if (!voiceName || voiceName === state.savedVoiceName) {
    return;
  }

  state.savedVoiceName = voiceName;
  saveVoiceName(voiceName);
}

function startVoiceSelectionSync() {
  if (state.voiceSaveTimer) {
    return;
  }

  state.voiceSaveTimer = window.setInterval(syncSelectedVoiceName, 700);
}

function initializeVoicePicker() {
  if (!elements.voiceSelect) {
    return;
  }

  if (!window.speechSynthesis) {
    elements.voiceSelect.replaceChildren(new Option("当前浏览器不支持音色选择", ""));
    elements.voiceSelect.disabled = true;
    return;
  }

  populateVoiceOptions();
  window.speechSynthesis.addEventListener("voiceschanged", populateVoiceOptions);
  ["input", "change", "keyup", "blur"].forEach((eventName) => {
    elements.voiceSelect.addEventListener(eventName, handleVoiceSelectionChange);
  });
  startVoiceSelectionSync();
}

async function askChatService() {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messages: state.messages }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status >= 500) {
      throw new Error("势宝连接暂时不可用，请稍后再试。");
    }
    throw new Error(payload.detail || payload.error || "请求失败。");
  }

  return payload.content;
}

function speakText(text) {
  if (!window.speechSynthesis) {
    setStatus("connected", "可以继续说话");
    startRecognition();
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const selectedVoice = getSelectedVoice();
  if (selectedVoice) {
    utterance.voice = selectedVoice;
  }
  utterance.lang = "zh-CN";
  utterance.rate = 1;
  utterance.pitch = 1.03;
  utterance.onend = () => {
    setStatus("connected", "可以继续说话");
    startMeter(() => (state.recognitionActive ? 0.55 : 0.16));
    startRecognition();
  };
  utterance.onerror = () => {
    setStatus("connected", "朗读失败，可以继续说话");
    startRecognition();
  };
  window.speechSynthesis.speak(utterance);
}

async function sendMessage(text, options = {}) {
  const cleanText = text.trim();
  if (!cleanText || state.sending) {
    return;
  }

  const shouldSpeak = options.speak ?? state.active;
  state.sending = true;
  setControls(state.active);
  appendChatMessage("user", cleanText);
  remember("user", cleanText);
  setStatus("speaking", "势宝正在思考");
  if (!state.localStream) {
    startMeter(() => 0.76);
  }

  try {
    const answer = await askChatService();
    appendChatMessage("assistant", answer);
    remember("assistant", answer);

    if (shouldSpeak && state.active) {
      setStatus("speaking", "势宝正在朗读");
      state.sending = false;
      setControls(true);
      speakText(answer);
      return;
    }

    if (!state.localStream) {
      stopMeter();
    }
    setStatus(state.active ? "connected" : "standby", state.active ? "可以继续说话" : "语音通话邀请");
  } catch (error) {
    appendChatMessage("system", error.message);
    setStatus("error", error.message);
    if (!state.localStream) {
      startMeter(() => 0.14);
    }
    if (state.active && !state.liveKitConnected) {
      startRecognition();
    } else if (!state.localStream) {
      window.setTimeout(stopMeter, 700);
    }
  } finally {
    state.sending = false;
    setControls(state.active);
  }
}

function startBrowserVoiceFallback() {
  state.recognition = createRecognition();

  if (!state.speechSupported) {
    appendSystemNotice("speech-unsupported", "当前浏览器不支持内置语音识别。你仍然可以在右侧发送文字消息。");
    setStatus("connected", "文字聊天可用");
    setControls(true);
    return;
  }

  appendChatMessage("assistant", "已切换到浏览器语音识别 + 聊天框回复。请直接说话，或在右侧打字。");
  setStatus("connected", "可以开始说话");
  startRecognition();
}

async function startCall() {
  if (state.active || state.liveKitConnecting) {
    return;
  }

  state.active = true;
  state.muted = false;
  state.recognitionBlocked = false;
  state.liveKitConnecting = true;
  state.systemNotices.clear();
  setControls(true);
  setStatus("connecting", "正在连接实时语音");
  startElapsedTimer();

  try {
    await connectLiveKitCall();
    state.liveKitConnected = true;
    state.liveKitConnecting = false;
    setControls(true);
    setStatus("listening", "实时语音已连接，直接说话");
  } catch (error) {
    disconnectLiveKitCall();
    appendSystemNotice("livekit-fallback", `${getMicrophoneErrorMessage(error)} 已切换到聊天框回复。`);
    state.liveKitConnecting = false;
    setControls(true);
    startBrowserVoiceFallback();
  }
}

function stopCall() {
  state.active = false;
  state.muted = false;
  state.recognitionBlocked = false;
  state.sending = false;
  state.systemNotices.clear();
  disconnectLiveKitCall();
  stopRecognition();
  stopMeter();
  stopElapsedTimer();
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  setControls(false);
  setStatus("standby");
}

function toggleMute() {
  if (!state.active || (!state.localStream && state.recognitionBlocked)) {
    return;
  }

  state.muted = !state.muted;
  setControls(true);

  if (state.localStream) {
    state.localStream.getAudioTracks().forEach((track) => {
      track.enabled = !state.muted;
    });
    setStatus("connected", state.muted ? "麦克风已静音" : "麦克风已恢复");
    return;
  }

  if (state.muted) {
    stopRecognition();
    setStatus("connected", "麦克风已静音");
    startMeter(() => 0.12);
    return;
  }

  setStatus("listening", "麦克风已恢复");
  startRecognition();
}

function sendTextMessage(event) {
  event.preventDefault();
  const text = elements.chatInput?.value.trim() || "";
  if (!text) {
    return;
  }

  elements.chatInput.value = "";
  stopRecognition();
  sendMessage(text, { speak: state.active && !state.liveKitConnected });
}

function initializeHomePage() {
  setStatus("standby");
  updateMeter(0.08);

  elements.answerButton?.addEventListener("click", () => {
    window.location.href = "/call.html";
  });
}

function initializeCallPage() {
  setControls(false);
  setStatus("standby");
  updateMeter(0.08);
  startFpsTicker();
  initializeVoicePicker();

  elements.startButton?.addEventListener("click", startCall);
  elements.statusStartButton?.addEventListener("click", startCall);
  elements.stopButton?.addEventListener("click", stopCall);
  elements.muteButton?.addEventListener("click", toggleMute);
  elements.clearButton?.addEventListener("click", clearChat);
  elements.chatForm?.addEventListener("submit", sendTextMessage);
}

if (isCallPage) {
  initializeCallPage();
} else {
  initializeHomePage();
}
