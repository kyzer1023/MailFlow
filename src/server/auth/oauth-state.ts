import { openSecret, sealSecret } from "./crypto";
import { generateOAuthNonce, generateOAuthStateValue, generatePkcePair } from "./pkce";
import type { OAuthStatePayload, OAuthStateStore } from "./contracts";
import { clearCookie, OAUTH_STATE_COOKIE_NAME, parseCookie, serializeCookie } from "./session";

export const DEFAULT_OAUTH_STATE_TTL_SECONDS = 10 * 60;
const OAUTH_STATE_AAD = "mailflow:oauth-state:v1";

export interface OAuthStateStartOptions {
  secret: string;
  returnTo?: string;
  /** Opaque route-purpose prefix used only to dispatch a shared callback. */
  statePrefix?: string;
  now?: number;
  ttlSeconds?: number;
  secure?: boolean;
  stateStore?: OAuthStateStore;
}

export interface OAuthStateStartResult {
  payload: OAuthStatePayload;
  stateCookieValue: string;
  stateCookie: string;
}

export interface OAuthStateConsumeOptions {
  secret: string;
  expectedState: string;
  cookieValue?: string | null;
  cookieHeader?: string | null;
  now?: number;
  stateStore?: OAuthStateStore;
}

export function safeReturnTo(value: string | undefined | null): string {
  const candidate = (value ?? "/dashboard").trim();
  // OAuth callback redirects must remain same-origin. Reject protocol-relative
  // URLs, backslashes, control characters, and absolute URLs.
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\") || /[\u0000-\u001f\u007f]/.test(candidate)) {
    return "/dashboard";
  }
  const pathname = candidate.split(/[?#]/u, 1)[0].toLowerCase();
  if (pathname === "/auth" || pathname.startsWith("/auth/")) return "/dashboard";
  return candidate;
}

function validPayload(value: unknown): value is OAuthStatePayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<OAuthStatePayload>;
  return Boolean(
    typeof payload.state === "string" && payload.state.length >= 32 &&
      typeof payload.codeVerifier === "string" && payload.codeVerifier.length >= 43 &&
      typeof payload.nonce === "string" && payload.nonce.length >= 32 &&
      typeof payload.returnTo === "string" &&
      Number.isFinite(payload.issuedAt) && Number.isFinite(payload.expiresAt),
  );
}

export async function createOAuthState(options: OAuthStateStartOptions): Promise<OAuthStateStartResult> {
  const now = options.now ?? Date.now();
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_OAUTH_STATE_TTL_SECONDS;
  if (!Number.isFinite(now) || !Number.isFinite(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > 60 * 60) {
    throw new RangeError("Invalid OAuth state lifetime");
  }
  const pkce = await generatePkcePair();
  const generatedState = generateOAuthStateValue();
  const statePrefix = options.statePrefix?.trim();
  const payload: OAuthStatePayload = {
    state: statePrefix ? `${statePrefix}.${generatedState}` : generatedState,
    codeVerifier: pkce.verifier,
    nonce: generateOAuthNonce(),
    returnTo: safeReturnTo(options.returnTo),
    issuedAt: now,
    expiresAt: now + Math.floor(ttlSeconds * 1000),
  };
  if (options.stateStore) await options.stateStore.put(payload);
  const stateCookieValue = await sealSecret(JSON.stringify(payload), options.secret, { aad: OAUTH_STATE_AAD });
  return {
    payload,
    stateCookieValue,
    stateCookie: serializeCookie(OAUTH_STATE_COOKIE_NAME, stateCookieValue, {
      secure: options.secure ?? true,
      sameSite: "Lax",
      path: "/",
      maxAgeSeconds: ttlSeconds,
    }),
  };
}

/**
 * Validate the query state and consume the short-lived server-side record.
 * If a state store is supplied, the atomic consume result is authoritative;
 * the sealed cookie is still checked so the request remains browser-bound.
 */
export async function consumeOAuthState(options: OAuthStateConsumeOptions): Promise<OAuthStatePayload> {
  if (!options.expectedState || options.expectedState.length < 32) throw new Error("Invalid OAuth state");
  const cookieValue = options.cookieValue ?? parseCookie(options.cookieHeader, OAUTH_STATE_COOKIE_NAME);
  if (!cookieValue) throw new Error("Missing OAuth state cookie");

  let cookiePayload: OAuthStatePayload;
  try {
    const decoded = JSON.parse(await openSecret(cookieValue, options.secret, { aad: OAUTH_STATE_AAD })) as unknown;
    if (!validPayload(decoded)) throw new Error("Malformed OAuth state");
    cookiePayload = decoded;
  } catch {
    throw new Error("Invalid OAuth state");
  }
  const now = options.now ?? Date.now();
  if (cookiePayload.state !== options.expectedState || cookiePayload.expiresAt <= now || cookiePayload.issuedAt > now + 30_000) {
    throw new Error("Invalid or expired OAuth state");
  }
  if (options.stateStore) {
    const stored = await options.stateStore.consume(options.expectedState);
    if (!stored || !validPayload(stored) || stored.state !== cookiePayload.state || stored.codeVerifier !== cookiePayload.codeVerifier || stored.nonce !== cookiePayload.nonce) {
      throw new Error("Invalid or replayed OAuth state");
    }
    return stored;
  }
  return cookiePayload;
}

export function clearOAuthStateCookie(secure = true): string {
  return clearCookie(OAUTH_STATE_COOKIE_NAME, { secure, sameSite: "Lax", path: "/" });
}

/** Alias for route code that prefers a verb naming the one-time operation. */
export const validateAndConsumeOAuthState = consumeOAuthState;
