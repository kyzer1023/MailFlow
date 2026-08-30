import { base64UrlEncode, randomToken, sha256 } from "./crypto";

export const PKCE_CODE_CHALLENGE_METHOD = "S256" as const;

export interface PkcePair {
  verifier: string;
  challenge: string;
  method: typeof PKCE_CODE_CHALLENGE_METHOD;
}

/**
 * Generate an RFC 7636 verifier and S256 challenge. The verifier is kept on
 * the server-side OAuth state cookie and is never sent to browser JavaScript.
 */
export async function generatePkcePair(): Promise<PkcePair> {
  // 32 random bytes produce a 43-character base64url verifier, within the
  // RFC 7636 43 to 128 character range.
  const verifier = randomToken(32);
  const challenge = base64UrlEncode(await sha256(verifier));
  return { verifier, challenge, method: PKCE_CODE_CHALLENGE_METHOD };
}

/** Useful for nonce and state values while keeping this module's API small. */
export function generateOAuthNonce(): string {
  return randomToken(32);
}

export function generateOAuthStateValue(): string {
  return randomToken(32);
}

/** Verify a supplied verifier against a challenge without network access. */
export async function verifyPkceChallenge(verifier: string, challenge: string): Promise<boolean> {
  if (!verifier || !challenge) return false;
  return base64UrlEncode(await sha256(verifier)) === challenge;
}
