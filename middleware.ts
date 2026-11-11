import { NextResponse, type NextRequest } from "next/server";

// Split hosting: the pages run on Vercel (frontend) and every /api route runs on Railway (backend), from this same app.
// The frontend forwards /api/* to the backend under its own origin, so the browser's relative fetches and the
// session cookies on nightshift.buzz keep working with no CORS. Docs: docs/DEPLOY_SPLIT.md.
//
//   BACKEND_URL            frontend only: the backend's origin, e.g. https://<service>.up.railway.app
//   BACKEND_PROXY_SECRET   both sides, same value: the backend only answers /api calls that came through the frontend
const BACKEND_URL = (process.env.BACKEND_URL ?? "").trim().replace(/\/+$/, "");
const PROXY_SECRET = (process.env.BACKEND_PROXY_SECRET ?? "").trim();
const PROXY_HEADER = "x-nightshift-proxy";
// The visitor's address, set by the frontend (where the platform knows it) for the backend's per-IP rate limits.
const CLIENT_IP_HEADER = "x-nightshift-client-ip";
// Answered without the secret: the platform's liveness probe.
const OPEN_PATHS = new Set(["/api/ping"]);

const clientIp = (req: NextRequest) =>
  req.headers.get("x-real-ip") ?? (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();

export function middleware(req: NextRequest) {
  // One canonical address: www.nightshift.buzz → nightshift.buzz
  const host = req.headers.get("host") ?? "";
  if (host.startsWith("www.")) {
    const url = req.nextUrl.clone();
    url.host = host.slice(4);
    url.port = "";
    url.protocol = "https";
    return NextResponse.redirect(url, 308);
  }

  const { pathname, search } = req.nextUrl;
  if (pathname !== "/api" && !pathname.startsWith("/api/")) return NextResponse.next();

  // Frontend: hand the call to the backend.
  if (BACKEND_URL) {
    const headers = new Headers(req.headers);
    if (PROXY_SECRET) headers.set(PROXY_HEADER, PROXY_SECRET);
    const ip = clientIp(req);
    if (ip) headers.set(CLIENT_IP_HEADER, ip);
    else headers.delete(CLIENT_IP_HEADER);
    return NextResponse.rewrite(new URL(pathname + search, BACKEND_URL), { request: { headers } });
  }

  // Backend: refuse calls that skipped the frontend, then restore the visitor's address for the routes.
  if (PROXY_SECRET && !OPEN_PATHS.has(pathname)) {
    if (req.headers.get(PROXY_HEADER) !== PROXY_SECRET) return NextResponse.json({ error: "not found" }, { status: 404 });
    const ip = req.headers.get(CLIENT_IP_HEADER);
    if (ip) {
      const headers = new Headers(req.headers);
      headers.set("x-forwarded-for", ip);
      return NextResponse.next({ request: { headers } });
    }
  }
  return NextResponse.next();
}

export const config = { matcher: "/:path*" };
