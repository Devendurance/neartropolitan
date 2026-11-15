import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { authChallenges } from "@/server/db/schema";
import {
  decodeNonce,
  verifyNep413Signature,
} from "@/server/auth/nep413";
import { attachSession, createSession } from "@/server/auth/session";
import {
  assertSameOrigin,
  clientIp,
  errorResponse,
  rateLimit,
  requireString,
} from "@/server/http/guard";
import { CommandError } from "@/server/commands/plan";
import { provider } from "@/server/near/client";


type AccessKeyView = {
  permission?: unknown;
};

function hasFullAccess(permission: unknown): boolean {
  if (permission === "FullAccess") return true;
  return Boolean(
    permission &&
      typeof permission === "object" &&
      "FullAccess" in (permission as Record<string, unknown>),
  );
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    rateLimit(`verify:${clientIp(request)}`, 20, 60_000);

    const body = (await request.json()) as Record<string, unknown>;
    const accountId = requireString(body.accountId, "accountId");
    const publicKey = requireString(body.publicKey, "publicKey");
    const nonce = requireString(body.nonce, "nonce");
    const signature = Buffer.from(requireString(body.signature, "signature"), "base64");

    if (!publicKey.startsWith("ed25519:")) {
      throw new CommandError(400, "unsupported_key", "only ed25519 keys are supported");
    }
    if (signature.length !== 64) {
      throw new CommandError(400, "invalid_signature", "signature must be 64 bytes");
    }

    const db = getDb();
    const rows = await db
      .select()
      .from(authChallenges)
      .where(and(eq(authChallenges.nonce, nonce), isNull(authChallenges.usedAt)))
      .limit(1);
    const challenge = rows[0];
    if (!challenge) {
      throw new CommandError(400, "unknown_challenge", "that sign-in request is not valid");
    }
    if (challenge.accountId !== accountId) {
      throw new CommandError(400, "account_mismatch", "this challenge belongs to another account");
    }
    if (challenge.expiresAt.getTime() < Date.now()) {
      throw new CommandError(400, "challenge_expired", "the sign-in request expired, try again");
    }

    let nonceBytes: Uint8Array;
    try {
      nonceBytes = decodeNonce(nonce);
    } catch {
      throw new CommandError(400, "invalid_nonce", "nonce must be 32 bytes");
    }

    const verified = verifyNep413Signature({
      publicKey,
      signature: new Uint8Array(signature),
      payload: {
        message: challenge.message,
        nonce: nonceBytes,
        recipient: challenge.recipient,
      },
    });
    if (!verified) {
      throw new CommandError(401, "bad_signature", "signature does not match this key");
    }

    // The signature proves key possession. The chain lookup proves the key
    // still controls the account and has full access.
    const accessKey = (await provider().sendJsonRpc("query", {
      request_type: "view_access_key",
      finality: "final",
      account_id: accountId,
      public_key: publicKey,
    })) as AccessKeyView;

    if (!hasFullAccess(accessKey.permission)) {
      throw new CommandError(
        403,
        "key_not_full_access",
        "this key cannot sign for the account",
      );
    }

    await db
      .update(authChallenges)
      .set({ usedAt: new Date() })
      .where(eq(authChallenges.nonce, nonce));

    const session = createSession(accountId, publicKey);
    const response = NextResponse.json({
      accountId: session.accountId,
      publicKey: session.publicKey,
      expiresAt: session.exp * 1000,
    });
    attachSession(response, session);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
