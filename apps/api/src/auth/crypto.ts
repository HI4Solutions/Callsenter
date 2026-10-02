import { createHash, randomBytes } from "node:crypto";

// 32 random bytes, URL-safe. Used for state, nonce, PKCE verifier, session ids and invitations.
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
