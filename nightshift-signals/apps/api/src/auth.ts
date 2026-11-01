import type { MiddlewareHandler } from "hono";
import { jwtVerify, SignJWT } from "jose";
import type { ApiContext, Env } from "./context";

/** Short-lived token for /me routes and the user:{id} WebSocket channel. */
export async function signUserToken(ctx: ApiContext, userId: string): Promise<string> {
  return new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime("1h").sign(ctx.jwtSecret);
}

export async function verifyUserToken(ctx: ApiContext, token: string | null | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, ctx.jwtSecret, { algorithms: ["HS256"] });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

export function requireUser(ctx: ApiContext): MiddlewareHandler<Env> {
  return async (c, next) => {
    const userId = await verifyUserToken(ctx, c.req.header("authorization")?.replace(/^Bearer /i, ""));
    if (!userId) return c.json({ error: "sign in required" }, 401);
    c.set("userId", userId);
    await next();
  };
}
