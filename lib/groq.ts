import "server-only";

/**
 * Groq (free tier): Whisper speech-to-text and an open chat model for Nyx, the voice assistant. Off when
 * GROQ_API_KEY isn't set; Nyx then falls back to the browser's speech recognition and its built-in answers.
 */
const BASE = "https://api.groq.com/openai/v1";
export const STT_MODEL = "whisper-large-v3-turbo";
export const CHAT_MODEL = process.env.NYX_MODEL?.trim() || "openai/gpt-oss-120b";
const key = () => (process.env.GROQ_API_KEY ?? "").trim();

export const groqEnabled = () => key().length > 0;

export async function transcribe(audio: Blob, filename: string): Promise<string> {
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", STT_MODEL);
  form.append("language", "en");
  form.append("response_format", "json");
  // a hint with the names Whisper would otherwise mishear
  form.append("prompt", "Nyx, Nightshift, SPY, QQQ, GLD, IBIT, Guardian, Morpho, Algorand, Sentora, health factor.");
  const res = await fetch(`${BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}` },
    body: form,
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json().catch(() => null)) as { text?: string; error?: { message?: string } } | null;
  if (!res.ok || !j) throw new Error(`transcription failed: ${j?.error?.message ?? res.status}`);
  return (j.text ?? "").trim();
}

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

// The free tier allows 8,000 tokens a minute per model, so when one model is busy (429) the next one answers.
const FALLBACKS = ["openai/gpt-oss-20b", "qwen/qwen3.8-27b"];

export async function chat(messages: ChatMsg[], maxTokens = 400): Promise<string> {
  let lastError = "";
  for (const model of [CHAT_MODEL, ...FALLBACKS.filter((m) => m !== CHAT_MODEL)]) {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, max_completion_tokens: maxTokens, temperature: 0.3, ...(model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}) }),
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } } | null;
    if (res?.ok && j) {
      const text = (j.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      if (text) return text;
    }
    lastError = j?.error?.message ?? String(res?.status ?? "network");
    if (res && res.status !== 429 && res.status < 500) break; // a real error, not "busy": don't retry
  }
  throw new Error(`chat failed: ${lastError}`);
}
