import { NextResponse } from "next/server";
import { CommandError } from "../commands/plan";
import type { Session } from "../auth/session";
import { currentSession } from "../auth/current";

const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    throw new CommandError(429, "rate_limited", "too many requests, slow down");
  }
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "local";
}

/**
 * Cookie based sessions are sent by browsers cross-site unless SameSite
 * blocks them. This rejects any mutating request whose Origin does not match
 * the host it was sent to.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const host = request.headers.get("host");
  try {
    if (new URL(origin).host !== host) {
      throw new CommandError(403, "bad_origin", "cross-origin request rejected");
    }
  } catch (error) {
    if (error instanceof CommandError) throw error;
    throw new CommandError(403, "bad_origin", "malformed origin");
  }
}

export async function requireSession(request: Request): Promise<Session> {
  assertSameOrigin(request);
  const session = await currentSession();
  if (!session) {
    throw new CommandError(401, "not_authenticated", "sign in first");
  }
  return session;
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof CommandError) {
    return NextResponse.json(
      { error: error.code, message: error.message },
      { status: error.status },
    );
  }
  console.error(error);
  return NextResponse.json(
    { error: "internal_error", message: "something went wrong" },
    { status: 500 },
  );
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CommandError(400, "invalid_body", `${field} is required`);
  }
  return value;
}
