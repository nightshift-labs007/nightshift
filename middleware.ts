import { NextResponse, type NextRequest } from "next/server";
import { canonicalUrl } from "./lib/site";

// https://www.nightshift.buzz is the canonical address (the bare domain is forwarded to it at the DNS provider, so this
// must never redirect www → bare). Every page says where its canonical copy lives, whichever host served it.
export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  res.headers.set("Link", `<${canonicalUrl(req.nextUrl.pathname)}>; rel="canonical"`);
  return res;
}

// pages only: not the API, Next's assets, or files with an extension
export const config = { matcher: ["/((?!api/|_next/|.*\\.[a-z0-9]+$).*)"] };
