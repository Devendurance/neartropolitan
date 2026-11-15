import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/server/auth/session";
import { currentSession } from "@/server/auth/current";


export async function GET() {
  const session = await currentSession();
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({
    authenticated: true,
    accountId: session.accountId,
    publicKey: session.publicKey,
    expiresAt: session.exp * 1000,
  });
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
