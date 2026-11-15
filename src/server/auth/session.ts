import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";

export const SESSION_COOKIE = "npt_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export type Session = {
  accountId: string;
  publicKey: string;
  iat: number;
  exp: number;
};

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error("AUTH_SECRET must be set to at least 32 characters");
  }
  return value;
}

function mac(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function signSession(session: Session): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${mac(payload)}`;
}

export function parseSession(token: string | undefined | null): Session | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = mac(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
    if (!session.accountId || !session.publicKey) return null;
    if (session.exp * 1000 < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export function createSession(accountId: string, publicKey: string): Session {
  const now = Math.floor(Date.now() / 1000);
  return {
    accountId,
    publicKey,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };
}

export function attachSession(response: NextResponse, session: Session): void {
  response.cookies.set(SESSION_COOKIE, signSession(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}


