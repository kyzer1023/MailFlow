/**
 * Small Web Crypto helpers shared by the authentication adapters.
 *
 * The implementation intentionally uses only APIs available in a browser and
 * in a Cloudflare Worker.  Do not replace these helpers with Node's `crypto`
 * module: the same code is used by the Worker bundle and by local tests.
 */

export type BytesLike = string | Uint8Array;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function cryptoApi(): Crypto {
  const value = globalThis.crypto;
  if (!value?.subtle || !value.getRandomValues) {
    throw new Error("Web Crypto is unavailable in this runtime");
  }
  return value;
}

export function bytes(value: BytesLike): Uint8Array {
  return typeof value === "string" ? textEncoder.encode(value) : new Uint8Array(value);
}

export function utf8(value: Uint8Array): string {
  return textDecoder.decode(value);
}

/** Base64url without padding, suitable for cookies and URL parameters. */
export function base64UrlEncode(value: BytesLike): string {
  const input = bytes(value);
  let binary = "";
  // The values handled here are short tokens, cookies, and hashes.  Keeping
  // this implementation dependency-free avoids Buffer in Worker bundles.
  for (const byte of input) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error("Invalid base64url value");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error("Invalid base64url value");
  }
  const result = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) result[index] = binary.charCodeAt(index);
  return result;
}

export function randomBytes(length = 32): Uint8Array {
  if (!Number.isInteger(length) || length < 1 || length > 1024) {
    throw new RangeError("Random byte length must be between 1 and 1024 bytes");
  }
  const result = new Uint8Array(length);
  cryptoApi().getRandomValues(result);
  return result;
}

export function randomToken(length = 32): string {
  if (!Number.isInteger(length) || length < 16 || length > 1024) {
    throw new RangeError("Random token length must be between 16 and 1024 bytes");
  }
  return base64UrlEncode(randomBytes(length));
}

export async function sha256(value: BytesLike): Promise<Uint8Array> {
  const digest = await cryptoApi().subtle.digest("SHA-256", bytes(value) as BufferSource);
  return new Uint8Array(digest);
}

export async function sha256Base64Url(value: BytesLike): Promise<string> {
  return base64UrlEncode(await sha256(value));
}

export async function sha256Hex(value: BytesLike): Promise<string> {
  const digest = await sha256(value);
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256(secret: BytesLike, value: BytesLike): Promise<Uint8Array> {
  const key = await cryptoApi().subtle.importKey(
    "raw",
    bytes(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await cryptoApi().subtle.sign("HMAC", key, bytes(value) as BufferSource);
  return new Uint8Array(signature);
}

export async function hmacSha256Base64Url(secret: BytesLike, value: BytesLike): Promise<string> {
  return base64UrlEncode(await hmacSha256(secret, value));
}

/**
 * Constant-time comparison for token hashes and MACs.
 *
 * The length is compared without early-returning on equal-length inputs.  A
 * differing length is still rejected immediately because comparing bytes that
 * do not exist cannot provide additional timing protection.
 */
export function timingSafeEqual(left: BytesLike, right: BytesLike): boolean {
  const a = bytes(left);
  const b = bytes(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function secretKeyMaterial(secret: string): Promise<Uint8Array> {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("A non-empty secret is required");
  }
  // Hashing gives AES a fixed 256-bit key while preserving the Worker secret
  // as an opaque string.  Production configuration should use a random value
  // of at least 32 bytes.
  return sha256(secret);
}

export interface SecretEnvelopeOptions {
  /** Additional authenticated data to bind a ciphertext to its purpose. */
  aad?: string;
}

const SECRET_VERSION = "v1";

/**
 * Encrypt a short secret into `v1.<iv>.<ciphertext>` using AES-256-GCM.
 * The authentication tag is included in Web Crypto's ciphertext output.
 */
export async function sealSecret(
  plaintext: string,
  secret: string,
  options: SecretEnvelopeOptions = {},
): Promise<string> {
  const keyMaterial = await secretKeyMaterial(secret);
  const key = await cryptoApi().subtle.importKey(
    "raw",
    keyMaterial as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = randomBytes(12);
  const aad = bytes(options.aad ?? "mailflow:secret:v1");
  const ciphertext = await cryptoApi().subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: aad as BufferSource, tagLength: 128 },
    key,
    bytes(plaintext) as BufferSource,
  );
  return `${SECRET_VERSION}.${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(ciphertext))}`;
}

export async function openSecret(
  envelope: string,
  secret: string,
  options: SecretEnvelopeOptions = {},
): Promise<string> {
  const parts = envelope.split(".");
  if (parts.length !== 3 || parts[0] !== SECRET_VERSION) throw new Error("Invalid secret envelope");
  const iv = base64UrlDecode(parts[1]);
  const ciphertext = base64UrlDecode(parts[2]);
  if (iv.length !== 12 || ciphertext.length < 17) throw new Error("Invalid secret envelope");

  const keyMaterial = await secretKeyMaterial(secret);
  const key = await cryptoApi().subtle.importKey(
    "raw",
    keyMaterial as BufferSource,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const aad = bytes(options.aad ?? "mailflow:secret:v1");
  try {
    const plaintext = await cryptoApi().subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource, additionalData: aad as BufferSource, tagLength: 128 },
      key,
      ciphertext as BufferSource,
    );
    return utf8(new Uint8Array(plaintext));
  } catch {
    // Never leak whether parsing, authentication, or key derivation failed.
    throw new Error("Unable to decrypt secret");
  }
}
