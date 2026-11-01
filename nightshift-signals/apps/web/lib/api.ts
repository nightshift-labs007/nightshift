// Typed client for the Nightshift Signals API. Server components call it directly; client components via TanStack Query.

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
const SERVER_API_URL = process.env.API_URL ?? API_URL;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { token?: string | null; revalidate?: number } = {}): Promise<T> {
  const base = typeof window === "undefined" ? SERVER_API_URL : API_URL;
  const { token, revalidate, ...rest } = init;
  const res = await fetch(`${base}/v1${path}`, {
    ...rest,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...rest.headers },
    ...(typeof window === "undefined" ? { next: { revalidate: revalidate ?? 0 } } : {}),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

/** Server-side fetch that turns 404 into null, for pages that render notFound(). */
export async function apiOrNull<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}
