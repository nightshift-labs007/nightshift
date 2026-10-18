import { NextResponse } from "next/server";
import { CHAT_MODEL, groqEnabled } from "@/lib/groq";

export const dynamic = "force-dynamic";

/** Tells Nyx whether its AI (Groq) is switched on. */
export async function GET() {
  return NextResponse.json({ ai: groqEnabled(), model: groqEnabled() ? CHAT_MODEL : null });
}
