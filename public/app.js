const elements = {
  answerButton: document.querySelector("#answerButton"),
  body: document.body,
  chatForm: document.querySelector("#chatForm"),
  chatInput: document.querySelector("#chatInput"),
  chatLog: document.querySelector("#chatLog"),
  clearButton: document.querySelector("#clearButton"),
  connectionLabel: document.querySelector("#connectionLabel"),
  elapsedLabel: document.querySelector("#elapsedLabel"),
  localMeter: document.querySelector("#localMeter"),
  muteButton: document.querySelector("#muteButton"),
  remoteAudio: document.querySelector("#remoteAudio"),
  sendTextButton: document.querySelector("#sendTextButton"),
  startButton: document.querySelector("#startButton"),
  statusLabel: document.querySelector("#statusLabel"),
  stopButton: document.querySelector("#stopButton"),
};

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const isCallPage = elements.body.dataset.page === "call";

const state = {
  active: false,
  audioContext: null,
  callStartedAt: null,
  dataChannel: null,
  elapsedTimer: null,
  localStream: null,
  micAnalyser: null,
  micSource: null,
  meterTimer: null,
  messages: [],
  muted: false,
  peerConnection: null,
  recognition: null,
  recognitionActive: false,
  recognitionBlocked: false,
  realtimeConnected: false,
  realtimeConnecting: false,
  sending: false,
  speechSupported: Boolean(SpeechRecognition),
  systemNotices: new Set(),
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

function setControls(active) {
  if (elements.startButton && elements.startButton.tagName === "BUTTON") {
    elements.startButton.disabled = active;
    elements.startButton.classList.toggle("is-active", active);
    const startLabel = elements.startButton.querySelector("span");
    if (startLabel) {
      startLabel.textContent = state.realtimeConnecting ? "连接中" : active ? "通话中" : "接听";
    }
  }

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

async function readRealtimeError(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const payload = await response.json().catch(() => ({}));
    return payload.detail || payload.error || "实时语音服务暂时不可用。";
  }

  const text = await response.text().catch(() => "");
  return text || "实时语音服务暂时不可用。";
}

function handleRealtimeEvent(event) {
  let payload;
  try {
    payload = JSON.parse(event.data);
  } catch {
    return;
  }

  if (payload.type === "error") {
    appendSystemNotice(`realtime-${payload.error?.code || "error"}`, payload.error?.message || "实时语音服务返回错误。");
    return;
  }

  const transcript = payload.transcript || payload.delta || payload.text;
  if (!transcript) {
    return;
  }

  if (payload.type.includes("input_audio_transcription")) {
    appendChatMessage("user", transcript);
    remember("user", transcript);
    return;
  }

  if (payload.type.includes("audio_transcript")) {
    appendChatMessage("assistant", transcript);
    remember("assistant", transcript);
  }
}

function disconnectRealtimeCall() {
  if (state.dataChannel) {
    state.dataChannel.close();
  }
  if (state.peerConnection) {
    state.peerConnection.close();
  }
  if (state.localStream) {
    state.localStream.getTracks().forEach((track) => track.stop());
  }
  if (elements.remoteAudio) {
    elements.remoteAudio.srcObject = null;
  }

  state.dataChannel = null;
  state.localStream = null;
  state.peerConnection = null;
  state.realtimeConnected = false;
  state.realtimeConnecting = false;
  stopMicMeter();
}

async function connectRealtimeCall() {
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
    throw new Error("当前浏览器不支持实时语音通话。");
  }

  const localStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      autoGainControl: true,
      echoCancellation: true,
      noiseSuppression: true,
    },
    video: false,
  });
  state.localStream = localStream;
  startMicMeter(localStream);

  const peerConnection = new RTCPeerConnection();
  const remoteStream = new MediaStream();
  state.peerConnection = peerConnection;

  localStream.getAudioTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.ontrack = (event) => {
    event.streams[0]?.getAudioTracks().forEach((track) => remoteStream.addTrack(track));
    if (elements.remoteAudio) {
      elements.remoteAudio.srcObject = remoteStream;
      elements.remoteAudio.play().catch(() => {});
    }
  };

  peerConnection.onconnectionstatechange = () => {
    if (peerConnection.connectionState === "connected") {
      state.realtimeConnected = true;
      state.realtimeConnecting = false;
      setControls(true);
      setStatus("listening", "实时语音已连接，直接说话");
    }

    if (peerConnection.connectionState === "failed" || peerConnection.connectionState === "disconnected") {
      appendSystemNotice("realtime-connection", "实时语音连接中断，可以继续使用右侧文字聊天。");
      setStatus("error", "实时语音连接中断");
    }
  };

  const dataChannel = peerConnection.createDataChannel("oai-events");
  state.dataChannel = dataChannel;
  dataChannel.onopen = () => {
    appendChatMessage("assistant", "实时语音已接通。你可以直接说话，也可以在右侧打字。");
    setStatus("listening", "实时语音已连接，直接说话");
  };
  dataChannel.onmessage = handleRealtimeEvent;
  dataChannel.onerror = () => {
    appendSystemNotice("realtime-data", "实时语音事件通道异常，可以继续使用右侧文字聊天。");
  };

  const offer = await peerConnection.createOffer({ offerToReceiveAudio: true });
  await peerConnection.setLocalDescription(offer);

  const response = await fetch("/api/realtime", {
    method: "POST",
    headers: {
      "Content-Type": "application/sdp",
    },
    body: offer.sdp,
  });

  if (!response.ok) {
    throw new Error(await readRealtimeError(response));
  }

  const answer = await response.text();
  await peerConnection.setRemoteDescription({ type: "answer", sdp: answer });
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

async function askDeepSeek() {
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
    const answer = await askDeepSeek();
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
    if (state.active && !state.realtimeConnected) {
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

  appendChatMessage("assistant", "已切换到浏览器语音识别 + DeepSeek 回复。请直接说话，或在右侧打字。");
  setStatus("connected", "可以开始说话");
  startRecognition();
}

async function startCall() {
  if (state.active || state.realtimeConnecting) {
    return;
  }

  state.active = true;
  state.muted = false;
  state.recognitionBlocked = false;
  state.realtimeConnecting = true;
  state.systemNotices.clear();
  setControls(true);
  setStatus("connecting", "正在连接实时语音");
  startElapsedTimer();

  try {
    await connectRealtimeCall();
    state.realtimeConnected = true;
    state.realtimeConnecting = false;
    setControls(true);
    setStatus("listening", "实时语音已连接，直接说话");
  } catch (error) {
    disconnectRealtimeCall();
    appendSystemNotice("realtime-fallback", `${getMicrophoneErrorMessage(error)} 已切换到 DeepSeek 文字聊天。`);
    state.realtimeConnecting = false;
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
  disconnectRealtimeCall();
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
  sendMessage(text, { speak: state.active && !state.realtimeConnected });
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

  elements.startButton?.addEventListener("click", startCall);
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
