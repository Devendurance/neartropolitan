import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { authChallenges } from "@/server/db/schema";
import {
  ACCOUNT_ID_PATTERN,
  createNonce,
  encodeNonce,
  signInMessage,
} from "@/server/auth/nep413";
import {
  clientIp,
  errorResponse,
  rateLimit,
  requireString,
} from "@/server/http/guard";
import { CommandError } from "@/server/commands/plan";


const CHALLENGE_TTL_MS = 5 * 60_000;

export async function POST(request: Request) {
  try {
    rateLimit(`challenge:${clientIp(request)}`, 10, 60_000);
    const body = (await request.json()) as Record<string, unknown>;
    const accountId = requireString(body.accountId, "accountId");

    if (
      !ACCOUNT_ID_PATTERN.test(accountId) ||
      accountId.length < 2 ||
      accountId.length > 64
    ) {
      throw new CommandError(400, "invalid_account", "that account id is not valid");
    }

    const nonce = createNonce();
    const nonceEncoded = encodeNonce(nonce);
    const recipient =
      process.env.NEAR_AUTH_RECIPIENT ?? new URL(request.url).host;
    const message = signInMessage(nonce);

    await getDb().insert(authChallenges).values({
      nonce: nonceEncoded,
      accountId,
      recipient,
      message,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    });

    return NextResponse.json({
      accountId,
      nonce: nonceEncoded,
      message,
      recipient,
      expiresIn: CHALLENGE_TTL_MS / 1000,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
