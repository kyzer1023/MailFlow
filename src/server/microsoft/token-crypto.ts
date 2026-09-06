import { openSecret, sealSecret } from "../auth/crypto";

export const REFRESH_TOKEN_ENCRYPTION_VERSION = 1;
export const REFRESH_TOKEN_AAD = "mailflow:oauth-refresh-token:v1";

export class RefreshTokenCryptoError extends Error {
  readonly code = "refresh_token_crypto_failed";

  constructor(message = "Stored Microsoft sign-in could not be opened") {
    super(message);
    this.name = "RefreshTokenCryptoError";
  }
}

/**
 * Encrypt a refresh token before it enters D1. The Worker secret is never
 * persisted with the ciphertext. AES-GCM authenticates both the token and its
 * purpose-specific associated data.
 */
export async function encryptRefreshToken(refreshToken: string, encryptionSecret: string): Promise<string> {
  if (!refreshToken || typeof refreshToken !== "string") throw new RefreshTokenCryptoError("Microsoft did not return a refresh token");
  try {
    return await sealSecret(refreshToken, encryptionSecret, { aad: REFRESH_TOKEN_AAD });
  } catch {
    throw new RefreshTokenCryptoError();
  }
}

export async function decryptRefreshToken(ciphertext: string, encryptionSecret: string): Promise<string> {
  if (!ciphertext || typeof ciphertext !== "string") throw new RefreshTokenCryptoError();
  try {
    const plaintext = await openSecret(ciphertext, encryptionSecret, { aad: REFRESH_TOKEN_AAD });
    if (!plaintext) throw new Error("empty");
    return plaintext;
  } catch {
    throw new RefreshTokenCryptoError();
  }
}

/** Re-encrypt during a controlled key rotation without exposing plaintext. */
export async function rotateRefreshToken(
  ciphertext: string,
  previousSecret: string,
  nextSecret: string,
): Promise<string> {
  const plaintext = await decryptRefreshToken(ciphertext, previousSecret);
  return encryptRefreshToken(plaintext, nextSecret);
}

