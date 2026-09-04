import { hmacSha256Base64Url } from "../auth/crypto";
import type { PublicControlStore, RateLimitDecision } from "../database/d1-public-controls";

export const OAUTH_START_RATE_LIMIT = 20;
export const OAUTH_START_GLOBAL_RATE_LIMIT = 200;
export const OAUTH_START_RATE_WINDOW_MS = 10 * 60 * 1000;

/** Build a privacy-preserving stable key without persisting the raw client IP. */
export function anonymousOAuthClientKey(secret: string, clientAddress: string): Promise<string> {
  const normalized = clientAddress.trim().slice(0, 128) || "unknown";
  return hmacSha256Base64Url(secret, `mailflow:oauth-start:${normalized}`);
}

export async function consumeOAuthStartLimit(
  store: PublicControlStore,
  secret: string,
  clientAddress: string,
  now = Date.now(),
): Promise<RateLimitDecision> {
  const key = await anonymousOAuthClientKey(secret, clientAddress);
  const clientDecision = await store.consumeRateLimit(
    "oauth_start_client",
    key,
    now,
    OAUTH_START_RATE_WINDOW_MS,
    OAUTH_START_RATE_LIMIT,
  );
  if (!clientDecision.allowed) return clientDecision;
  return store.consumeRateLimit(
    "oauth_start_global",
    "all_clients",
    now,
    OAUTH_START_RATE_WINDOW_MS,
    OAUTH_START_GLOBAL_RATE_LIMIT,
  );
}
