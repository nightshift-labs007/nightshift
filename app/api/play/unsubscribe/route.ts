import { NextResponse, type NextRequest } from "next/server";
import { unsubscribe } from "@/lib/play/account";

export const dynamic = "force-dynamic";

const page = (msg: string) =>
  new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nightshift</title><body style="font-family:system-ui,sans-serif;background:#070909;color:#e8f0ec;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px"><p style="max-width:420px">${msg}</p></body>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );

/** One-click unsubscribe from every reminder email (GET from the link, POST from mail clients' one-click button). */
async function handle(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const ok = await unsubscribe(q.get("h") ?? "", q.get("t") ?? "");
  return page(ok ? "You won't get any more Nightshift reminder emails. You can turn them back on in the game at any time." : "That link isn't valid any more.");
}
export const GET = handle;
export const POST = handle;
