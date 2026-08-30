import {
  hmacSha256Base64Url,
  randomToken,
  sha256Base64Url,
  timingSafeEqual,
} from "./crypto";

export const SESSION_COOKIE_NAME = "mailflow_session";
export const CSRF_COOKIE_NAME = "mailflow_csrf";
export const OAUTH_STATE_COOKIE_NAME = "mailflow_oauth_state";
export const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 8;

export interface SessionRecord {
  /** Database identifier, when the backing store has one. */
  id?: string;
  userId: string;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  revokedAt?: number | null;
}

export interface SessionStore {
  create(record: SessionRecord): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  revokeByTokenHash(tokenHash: string, revokedAt: number): Promise<void>;
}

export interface SessionCookieOptions {
  secure?: boolean;
  path?: string;
  sameSite?: "Strict" | "Lax" | "None";
  maxAgeSeconds?: number;
}

export interface StartedSession {
  token: string;
  tokenHash: string;
  record: SessionRecord;
  cookie: string;
}

export interface CookieClearOptions {
  secure?: boolean;
  path?: string;
  sameSite?: "Strict" | "Lax" | "None";
}

function cookieValue(value: string): string {
  return encodeURIComponent(value);
}

/** Build a Set-Cookie value. Values are URL encoded and therefore safe to log only as a header shape, not as secret content. */
export function serializeCookie(
  name: string,
  value: string,
  options: SessionCookieOptions = {},
): string {
  const path = options.path ?? "/";
  const sameSite = options.sameSite ?? "Lax";
  const parts = [`${name}=${cookieValue(value)}`, `Path=${path}`, `SameSite=${sameSite}`, "HttpOnly"];
  if (options.maxAgeSeconds !== undefined) {
    const maxAge = Math.max(0, Math.floor(options.maxAgeSeconds));
    parts.push(`Max-Age=${maxAge}`);
  }
  // OAuth/session cookies are always intended for HTTPS in production. Local
  // HTTP development can explicitly set secure:false.
  if (options.secure ?? true) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookie(name: string, options: CookieClearOptions = {}): string {
  return serializeCookie(name, "", { ...options, maxAgeSeconds: 0 });
}

/** Parse one named cookie without throwing on malformed unrelated cookies. */
export function parseCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

export async function hashSessionToken(token: string): Promise<string> {
  if (!token || token.length < 32) throw new Error("Invalid session token");
  return sha256Base64Url(token);
}

/** Alias used by repository adapters that call opaque values token hashes. */
export const hashToken = hashSessionToken;

export async function startSession(
  store: SessionStore,
  userId: string,
  options: {
    now?: number;
    ttlSeconds?: number;
    cookie?: SessionCookieOptions;
  } = {},
): Promise<StartedSession> {
  if (!userId || userId.trim().length === 0) throw new Error("A user id is required");
  const now = options.now ?? Date.now();
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
  if (!Number.isFinite(now) || !Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new RangeError("Invalid session lifetime");
  }
  const token = randomToken(32);
  const tokenHash = await hashSessionToken(token);
  const record: SessionRecord = {
    userId,
    tokenHash,
    createdAt: now,
    expiresAt: now + Math.floor(ttlSeconds * 1000),
    revokedAt: null,
  };
  await store.create(record);
  return {
    token,
    tokenHash,
    record,
    cookie: serializeCookie(SESSION_COOKIE_NAME, token, {
      secure: options.cookie?.secure ?? true,
      path: options.cookie?.path ?? "/",
      sameSite: options.cookie?.sameSite ?? "Lax",
      maxAgeSeconds: ttlSeconds,
    }),
  };
}

export async function readSession(
  store: SessionStore,
  token: string | null | undefined,
  now = Date.now(),
): Promise<SessionRecord | null> {
  if (!token || token.length < 32) return null;
  const tokenHash = await hashSessionToken(token).catch(() => null);
  if (!tokenHash) return null;
  const record = await store.findByTokenHash(tokenHash);
  if (!record || record.revokedAt !== null && record.revokedAt !== undefined) return null;
  if (!Number.isFinite(record.expiresAt) || record.expiresAt <= now) return null;
  // Do not return the raw token. The caller only receives the database record
  // and can use its user id for ownership checks.
  return record;
}

export async function revokeSession(
  store: SessionStore,
  token: string | null | undefined,
  now = Date.now(),
): Promise<void> {
  if (!token || token.length < 32) return;
  const tokenHash = await hashSessionToken(token).catch(() => null);
  if (tokenHash) await store.revokeByTokenHash(tokenHash, now);
}

/** A CSRF token bound to the opaque session and a Worker secret. */
export async function createCsrfToken(sessionToken: string, integritySecret: string): Promise<string> {
  if (!sessionToken || sessionToken.length < 32) throw new Error("Invalid session token");
  return hmacSha256Base64Url(integritySecret, `mailflow:csrf:${sessionToken}`);
}

export async function verifyCsrfToken(
  sessionToken: string,
  providedToken: string | null | undefined,
  integritySecret: string,
): Promise<boolean> {
  if (!providedToken) return false;
  const expected = await createCsrfToken(sessionToken, integritySecret);
  return timingSafeEqual(expected, providedToken);
}
