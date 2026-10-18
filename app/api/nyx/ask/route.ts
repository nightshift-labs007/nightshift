import { NextResponse, type NextRequest } from "next/server";
import { chat, groqEnabled, type ChatMsg } from "@/lib/groq";
import { forSpeech, systemPrompt } from "@/lib/nyx-brain";
import { getOracleSnapshot } from "@/lib/oracle";
import { allow } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Open questions for Nyx: answered by Groq's chat model, grounded in Nightshift's facts and tonight's live prices. */
export async function POST(req: NextRequest) {
  if (!groqEnabled()) return NextResponse.json({ error: "My AI isn't switched on." }, { status: 503 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (!(await allow(`nyx:ask:${ip}`, 60, 3600)).ok) return NextResponse.json({ error: "You've asked me a lot this hour. Give me a few minutes." }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as { question?: string; history?: { who: string; text: string }[]; me?: string };
  const question = String(body.question ?? "").trim().slice(0, 500);
  if (!question) return NextResponse.json({ error: "Ask me something." }, { status: 400 });
  const history: ChatMsg[] = (Array.isArray(body.history) ? body.history : [])
    .slice(-6)
    .map((m) => ({ role: m.who === "you" ? ("user" as const) : ("assistant" as const), content: String(m.text ?? "").slice(0, 600) }))
    .filter((m) => m.content);
  const me = typeof body.me === "string" ? body.me.slice(0, 600) : null;
  const snap = await getOracleSnapshot().catch(() => null);
  try {
    const answer = forSpeech(await chat([{ role: "system", content: systemPrompt(snap, me) }, ...history, { role: "user", content: question }]));
    return NextResponse.json({ answer: answer || "I'm not sure how to answer that one." });
  } catch {
    return NextResponse.json({ error: "My thoughts are a little slow right now. Please try again." }, { status: 502 });
  }
}
