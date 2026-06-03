import asyncio
import base64
import io
import json
import math
import os
import wave
from array import array
from dataclasses import dataclass

import aiohttp
from dotenv import load_dotenv
from livekit import agents, rtc
from livekit.agents import AgentServer, AutoSubscribe

from text_utils import strip_sensevoice_markers


load_dotenv()

DEFAULT_PROMPT = "\n".join(
    [
        "你是势宝（E-Bot），北京具身势能科技有限公司的吉祥物和语音聊天伙伴。",
        "你用自然、简洁、积极的中文对话，语气像可靠的产品向导和现场接待。",
        "你可以聊具身智能、机器人、AI Agent、企业访客接待、产品演示和技术想法。",
        "回答前先听清用户意图，优先给具体、可执行的建议。",
        "每次回复控制在 120 个汉字以内，适合被语音朗读。",
        "不要编造公司未提供的事实；不确定时说明需要更多资料。",
    ]
)

INPUT_SAMPLE_RATE = int(os.getenv("SENSEVOICE_SAMPLE_RATE", "16000"))
OUTPUT_SAMPLE_RATE = int(os.getenv("COSYVOICE2_SAMPLE_RATE", "24000"))
NUM_CHANNELS = 1
SPEECH_THRESHOLD = float(os.getenv("VOICE_SPEECH_THRESHOLD", "0.012"))
MIN_SPEECH_MS = int(os.getenv("VOICE_MIN_SPEECH_MS", "600"))
END_SILENCE_MS = int(os.getenv("VOICE_END_SILENCE_MS", "750"))

agent_name = os.getenv("LIVEKIT_AGENT_NAME", "ebot-agent")
server = AgentServer()


@dataclass(frozen=True)
class ExternalConfig:
    sensevoice_url: str
    cosyvoice2_url: str
    deepseek_api_key: str
    deepseek_url: str = "https://api.deepseek.com/chat/completions"
    deepseek_model: str = "deepseek-v4-flash"
    sensevoice_api_key: str | None = None
    cosyvoice2_api_key: str | None = None
    instructions: str = DEFAULT_PROMPT

    @classmethod
    def from_env(cls) -> "ExternalConfig":
        missing = [
            name
            for name in ["SENSEVOICE_TRANSCRIBE_URL", "COSYVOICE2_SPEECH_URL", "DEEPSEEK_API_KEY"]
            if not os.getenv(name)
        ]
        if missing:
            raise RuntimeError(f"Missing required agent env vars: {', '.join(missing)}")

        return cls(
            sensevoice_url=os.environ["SENSEVOICE_TRANSCRIBE_URL"],
            cosyvoice2_url=os.environ["COSYVOICE2_SPEECH_URL"],
            deepseek_api_key=os.environ["DEEPSEEK_API_KEY"],
            deepseek_url=os.getenv("DEEPSEEK_CHAT_URL", "https://api.deepseek.com/chat/completions"),
            deepseek_model=os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash"),
            sensevoice_api_key=os.getenv("SENSEVOICE_API_KEY"),
            cosyvoice2_api_key=os.getenv("COSYVOICE2_API_KEY"),
            instructions=os.getenv("EBOT_INSTRUCTIONS", DEFAULT_PROMPT),
        )


class ExternalVoiceServices:
    def __init__(self, config: ExternalConfig) -> None:
        self.config = config
        self.timeout = aiohttp.ClientTimeout(total=45)

    async def transcribe(self, wav_bytes: bytes) -> str:
        headers = self._auth_headers(self.config.sensevoice_api_key)
        form = aiohttp.FormData()
        form.add_field("file", wav_bytes, filename="speech.wav", content_type="audio/wav")
        form.add_field("language", "zh")

        async with aiohttp.ClientSession(timeout=self.timeout) as session:
            async with session.post(self.config.sensevoice_url, data=form, headers=headers) as response:
                body = await response.read()
                if response.status >= 400:
                    raise RuntimeError(f"SenseVoice rejected audio: {body[:300].decode(errors='ignore')}")
                payload = json.loads(body.decode("utf-8"))

        text = (
            payload.get("text")
            or payload.get("transcript")
            or payload.get("result", {}).get("text")
            or payload.get("data", {}).get("text")
            or ""
        )
        return strip_sensevoice_markers(str(text))

    async def chat(self, messages: list[dict[str, str]]) -> str:
        headers = {
            "Authorization": f"Bearer {self.config.deepseek_api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.config.deepseek_model,
            "messages": [{"role": "system", "content": self.config.instructions}, *messages[-10:]],
            "stream": False,
        }

        async with aiohttp.ClientSession(timeout=self.timeout) as session:
            async with session.post(self.config.deepseek_url, json=payload, headers=headers) as response:
                body = await response.text()
                if response.status >= 400:
                    raise RuntimeError(f"Chat service rejected request: {body[:300]}")
                data = json.loads(body)

        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        return str(content).strip()

    async def synthesize(self, text: str) -> bytes:
        headers = self._auth_headers(self.config.cosyvoice2_api_key)
        headers["Content-Type"] = "application/json"
        payload = {
            "text": text,
            "voice": os.getenv("COSYVOICE2_VOICE", "ebot"),
            "format": os.getenv("COSYVOICE2_FORMAT", "wav"),
            "sample_rate": OUTPUT_SAMPLE_RATE,
        }

        async with aiohttp.ClientSession(timeout=self.timeout) as session:
            async with session.post(self.config.cosyvoice2_url, json=payload, headers=headers) as response:
                body = await response.read()
                if response.status >= 400:
                    raise RuntimeError(f"CosyVoice2 rejected text: {body[:300].decode(errors='ignore')}")

                content_type = response.headers.get("content-type", "")
                if "application/json" not in content_type:
                    return body

        data = json.loads(body.decode("utf-8"))
        audio = (
            data.get("audio_base64")
            or data.get("audio")
            or data.get("data", {}).get("audio_base64")
            or data.get("data", {}).get("audio")
        )
        if not audio:
            raise RuntimeError("CosyVoice2 response did not include audio bytes.")
        return base64.b64decode(audio)

    @staticmethod
    def _auth_headers(api_key: str | None) -> dict[str, str]:
        return {"Authorization": f"Bearer {api_key}"} if api_key else {}


def audio_frame_to_pcm(frame: rtc.AudioFrame) -> bytes:
    return frame.data.tobytes()


def pcm_rms(pcm: bytes) -> float:
    samples = array("h")
    samples.frombytes(pcm)
    if not samples:
        return 0.0
    energy = sum(sample * sample for sample in samples) / len(samples)
    return math.sqrt(energy) / 32768.0


def pcm_chunks_to_wav(chunks: list[bytes], sample_rate: int, channels: int) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(b"".join(chunks))
    return buffer.getvalue()


def decode_audio_bytes(audio: bytes) -> tuple[bytes, int, int]:
    if not audio.startswith(b"RIFF"):
        return audio, OUTPUT_SAMPLE_RATE, NUM_CHANNELS

    with wave.open(io.BytesIO(audio), "rb") as wav:
        channels = wav.getnchannels()
        sample_width = wav.getsampwidth()
        sample_rate = wav.getframerate()
        pcm = wav.readframes(wav.getnframes())

    if channels != NUM_CHANNELS:
        raise RuntimeError("CosyVoice2 audio must be mono PCM or mono WAV.")
    if sample_width != 2:
        raise RuntimeError("CosyVoice2 audio must be 16-bit PCM.")
    return pcm, sample_rate, channels


async def publish_json(room: rtc.Room, role: str, text: str) -> None:
    payload = json.dumps({"role": role, "text": text}, ensure_ascii=False).encode("utf-8")
    await room.local_participant.publish_data(payload, reliable=True, topic="ebot.chat")


async def publish_audio(audio_source: rtc.AudioSource, audio_bytes: bytes) -> None:
    pcm, sample_rate, channels = decode_audio_bytes(audio_bytes)
    samples_per_frame = max(1, sample_rate // 50)
    bytes_per_frame = samples_per_frame * channels * 2

    for offset in range(0, len(pcm), bytes_per_frame):
        chunk = pcm[offset : offset + bytes_per_frame]
        if len(chunk) < bytes_per_frame:
            chunk = chunk + (b"\x00" * (bytes_per_frame - len(chunk)))
        frame = rtc.AudioFrame(chunk, sample_rate, channels, samples_per_frame)
        await audio_source.capture_frame(frame)


async def handle_user_turn(
    room: rtc.Room,
    audio_source: rtc.AudioSource,
    services: ExternalVoiceServices,
    messages: list[dict[str, str]],
    wav_bytes: bytes,
    lock: asyncio.Lock,
) -> None:
    if lock.locked():
        return

    async with lock:
        user_text = await services.transcribe(wav_bytes)
        if not user_text:
            return

        messages.append({"role": "user", "content": user_text})
        await publish_json(room, "user", user_text)

        answer = await services.chat(messages)
        if not answer:
            answer = "我在，但刚才没有组织好回复。你可以再说一遍吗？"

        messages.append({"role": "assistant", "content": answer})
        await publish_json(room, "assistant", answer)
        await publish_audio(audio_source, await services.synthesize(answer))


async def process_audio_track(
    ctx: agents.JobContext,
    audio_source: rtc.AudioSource,
    services: ExternalVoiceServices,
    messages: list[dict[str, str]],
    lock: asyncio.Lock,
    track: rtc.RemoteTrack,
) -> None:
    stream = rtc.AudioStream(track, sample_rate=INPUT_SAMPLE_RATE, num_channels=NUM_CHANNELS)
    speech_chunks: list[bytes] = []
    speech_ms = 0
    silence_ms = 0

    async for audio_event in stream:
        frame = audio_event.frame
        pcm = audio_frame_to_pcm(frame)
        frame_ms = int((frame.samples_per_channel / frame.sample_rate) * 1000)
        is_speech = pcm_rms(pcm) >= SPEECH_THRESHOLD

        if is_speech:
            speech_chunks.append(pcm)
            speech_ms += frame_ms
            silence_ms = 0
            continue

        if speech_chunks:
            speech_chunks.append(pcm)
            silence_ms += frame_ms

        if speech_chunks and speech_ms >= MIN_SPEECH_MS and silence_ms >= END_SILENCE_MS:
            wav_bytes = pcm_chunks_to_wav(speech_chunks, INPUT_SAMPLE_RATE, NUM_CHANNELS)
            speech_chunks = []
            speech_ms = 0
            silence_ms = 0
            asyncio.create_task(handle_user_turn(ctx.room, audio_source, services, messages, wav_bytes, lock))


def is_audio_track(track: rtc.RemoteTrack) -> bool:
    kind = getattr(track, "kind", "")
    return str(kind).lower().endswith("audio") or str(kind).lower() == "audio"


@server.rtc_session(agent_name=agent_name)
async def ebot_agent(ctx: agents.JobContext) -> None:
    config = ExternalConfig.from_env()
    services = ExternalVoiceServices(config)
    messages: list[dict[str, str]] = []
    response_lock = asyncio.Lock()

    audio_source = rtc.AudioSource(OUTPUT_SAMPLE_RATE, NUM_CHANNELS)
    audio_track = rtc.LocalAudioTrack.create_audio_track("ebot-voice", audio_source)
    publish_options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)

    @ctx.room.on("track_subscribed")
    def on_track_subscribed(track: rtc.RemoteTrack, *_args) -> None:
        if is_audio_track(track):
            asyncio.create_task(
                process_audio_track(ctx, audio_source, services, messages, response_lock, track)
            )

    await ctx.connect(auto_subscribe=AutoSubscribe.SUBSCRIBE_ALL)
    await ctx.agent.publish_track(audio_track, publish_options)
    await publish_json(ctx.room, "assistant", "你好，我是势宝。我们可以开始语音聊天了。")

    await asyncio.Event().wait()


if __name__ == "__main__":
    agents.cli.run_app(server)
