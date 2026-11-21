import { NextResponse, type NextRequest } from "next/server";
import { reportError } from "@/lib/ops";
import { allow } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/**
 * Browser error reports from components/ErrorReporter.tsx. Body: { msg, where }. Limited per IP and in size, scrubbed
 * before storing (no emails, keys or ids), and never echoed back.
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!(await allow(`ops:clienterr:${ip}`, 20, 600)).ok) return new NextResponse(null, { status: 204 });
  const raw = await req.text().catch(() => "");
  if (raw.length > 4000) return new NextResponse(null, { status: 413 });
  let b: { msg?: unknown; where?: unknown } = {};
  try {
    b = JSON.parse(raw);
  } catch {}
  const msg = typeof b.msg === "string" ? b.msg.slice(0, 500) : "";
  const where = typeof b.where === "string" ? b.where.replace(/[?#].*$/, "").slice(0, 80) : "page";
  if (msg) await reportError(`browser ${where}`, msg);
  return new NextResponse(null, { status: 204 });
}
