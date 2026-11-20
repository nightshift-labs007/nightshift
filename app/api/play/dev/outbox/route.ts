import { NextResponse } from "next/server";
import { devOutbox } from "@/lib/play/mail";

export const dynamic = "force-dynamic";

/** Local servers only: the emails that would have been sent (sign-in codes, reminders). 404 in production. */
export async function GET() {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ messages: devOutbox() });
}
