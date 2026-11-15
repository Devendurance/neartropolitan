import { createHash, randomBytes } from "node:crypto";
import { serialize } from "borsh";
import { PublicKey } from "near-api-js";

/**
 * NEP-413 sign-in message handling. The wire format matches the reference
 * implementation so wallets and near-api-js clients interoperate.
 */

const NEP413_PREFIX = 2_147_484_061;

const MESSAGE_SCHEMA = {
  struct: {
    message: "string",
    nonce: { array: { type: "u8", len: 32 } },
    recipient: "string",
    callbackUrl: { option: "string" },
  },
} as const;

export type Nep413Payload = {
  message: string;
  nonce: Uint8Array;
  recipient: string;
  callbackUrl?: string | null;
};

export function createNonce(): Uint8Array {
  return randomBytes(32);
}

export function encodeNonce(nonce: Uint8Array): string {
  return Buffer.from(nonce).toString("base64");
}

export function decodeNonce(encoded: string): Uint8Array {
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length !== 32) {
    throw new Error("nonce must be 32 bytes");
  }
  return new Uint8Array(bytes);
}

export function signInMessage(nonce: Uint8Array): string {
  return `Sign in to Neartropolitan\n\nNonce: ${encodeNonce(nonce)}`;
}

export function serializeNep413(payload: Nep413Payload): Uint8Array {
  const prefix = serialize("u32", NEP413_PREFIX);
  const body = serialize(MESSAGE_SCHEMA, {
    message: payload.message,
    nonce: payload.nonce,
    recipient: payload.recipient,
    callbackUrl: payload.callbackUrl ?? null,
  });
  const joined = new Uint8Array(prefix.length + body.length);
  joined.set(prefix);
  joined.set(body, prefix.length);
  return new Uint8Array(createHash("sha256").update(joined).digest());
}

export function verifyNep413Signature(options: {
  publicKey: string;
  payload: Nep413Payload;
  signature: Uint8Array;
}): boolean {
  if (options.signature.length !== 64) return false;
  try {
    const key = PublicKey.from(options.publicKey);
    return key.verify(serializeNep413(options.payload), options.signature);
  } catch {
    return false;
  }
}

export const ACCOUNT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
