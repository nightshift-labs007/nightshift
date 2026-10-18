import { NextResponse, type NextRequest } from "next/server";
import { groqEnabled, transcribe } from "@/lib/groq";
import { allow } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BYTES = 4 * 1024 * 1024; // about 30 s of compressed speech

/** Speech to text for Nyx: a short voice clip in, the words out (Groq Whisper). */
export async function POST(req: NextRequest) {
  if (!groqEnabled()) return NextResponse.json({ error: "Voice transcription isn't switched on." }, { status: 503 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (!(await allow(`nyx:stt:${ip}`, 60, 3600)).ok) return NextResponse.json({ error: "You've talked to me a lot this hour. Give me a few minutes." }, { status: 429 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("audio");
  if (!(file instanceof Blob) || file.size === 0) return NextResponse.json({ error: "No audio received." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "That clip is too long. Keep it under 30 seconds." }, { status: 413 });
  const name = file.type.includes("mp4") ? "clip.mp4" : file.type.includes("ogg") ? "clip.ogg" : file.type.includes("wav") ? "clip.wav" : "clip.webm";
  try {
    const text = await transcribe(file, name);
    return NextResponse.json({ text });
  } catch {
    return NextResponse.json({ error: "I couldn't make that out. Please try again." }, { status: 502 });
  }
}
