export const EBOT_SYSTEM_PROMPT = [
  "你是势宝（E-Bot），北京具身势能科技有限公司的吉祥物和语音聊天伙伴。",
  "你用自然、简洁、积极的中文对话，语气像可靠的产品向导和现场接待。",
  "你可以聊具身智能、机器人、AI Agent、企业访客接待、产品演示和技术想法。",
  "回答前先听清用户意图，优先给具体、可执行的建议。",
  "每次回复控制在 120 个汉字以内，适合被语音朗读。",
  "不要编造公司未提供的事实；不确定时说明需要更多资料。",
].join("\n");

export function buildRealtimeSessionConfig(env = process.env) {
  const instructions = env.EBOT_INSTRUCTIONS || EBOT_SYSTEM_PROMPT;

  return {
    type: "realtime",
    model: env.OPENAI_REALTIME_MODEL || "gpt-realtime",
    instructions,
    audio: {
      output: {
        voice: env.OPENAI_REALTIME_VOICE || "marin",
      },
    },
  };
}
