import { resolveEntraConfig } from "./config";
import type { EntraConfig, ResolvedEntraConfig } from "./config";
import type { FetchLike } from "../auth/tenant";

export interface AuthorizationUrlInput {
  state: string;
  codeChallenge: string;
  nonce?: string;
  /** Null omits prompt so an active Microsoft session can continue with SSO. */
  prompt?: "select_account" | "consent" | "none" | null;
}

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  scope: string[];
  expiresInSeconds: number;
  accessTokenExpiresAt: number;
  idToken: string | null;
}

export type OAuthErrorCategory =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "access_denied"
  | "temporarily_unavailable"
  | "configuration"
  | "network"
  | "unknown";

export class OAuthProviderError extends Error {
  readonly code = "microsoft_oauth_failed";
  readonly category: OAuthErrorCategory;
  readonly status?: number;
  readonly providerCode?: string;
  readonly retryable: boolean;

  constructor(
    category: OAuthErrorCategory,
    message: string,
    details: { status?: number; providerCode?: string; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "OAuthProviderError";
    this.category = category;
    this.status = details.status;
    this.providerCode = details.providerCode;
    this.retryable = details.retryable ?? (category === "temporarily_unavailable" || category === "network");
  }
}

function fetcher(fetchImpl?: FetchLike): FetchLike {
  if (fetchImpl) return fetchImpl;
  if (!globalThis.fetch) throw new OAuthProviderError("configuration", "Microsoft sign-in is not available on this server");
  return globalThis.fetch.bind(globalThis);
}

function tokenEndpoint(config: EntraConfig | ResolvedEntraConfig): ResolvedEntraConfig {
  // Calling resolve for each request keeps route code from accidentally using
  // the common/organizations authority, while accepting an already resolved
  // config from a long-lived Worker module.
  return resolveEntraConfig(config);
}

export function buildAuthorizationUrl(
  config: EntraConfig | ResolvedEntraConfig,
  input: AuthorizationUrlInput,
): string {
  const resolved = tokenEndpoint(config);
  if (!input.state || input.state.length < 32 || !input.codeChallenge || input.codeChallenge.length < 43) {
    throw new OAuthProviderError("configuration", "Microsoft sign-in state is invalid");
  }
  const url = new URL(resolved.authorizationEndpoint);
  const query = new URLSearchParams({
    client_id: resolved.clientId,
    response_type: "code",
    redirect_uri: resolved.redirectUri,
    response_mode: "query",
    scope: resolved.scopes.join(" "),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    ...(input.nonce ? { nonce: input.nonce } : {}),
  });
  if (input.prompt !== null) query.set("prompt", input.prompt ?? "select_account");
  url.search = query.toString();
  return url.toString();
}

async function parseResponse(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const value = await response.json() as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function classifyOAuthError(status: number, payload: Record<string, unknown> | null): OAuthProviderError {
  const providerCode = typeof payload?.error === "string" ? payload.error : undefined;
  switch (providerCode) {
    case "invalid_client":
      return new OAuthProviderError("invalid_client", "Microsoft sign-in is not configured correctly", { status, providerCode });
    case "invalid_grant":
      return new OAuthProviderError("invalid_grant", "Sign-in expired. Start Microsoft sign-in again", { status, providerCode });
    case "access_denied":
      return new OAuthProviderError("access_denied", "Microsoft sign-in was cancelled", { status, providerCode });
    case "temporarily_unavailable":
    case "server_error":
      return new OAuthProviderError("temporarily_unavailable", "Microsoft sign-in is temporarily unavailable", { status, providerCode, retryable: true });
    case "invalid_request":
      return new OAuthProviderError("invalid_request", "Microsoft sign-in request was invalid", { status, providerCode });
    default:
      if (status >= 500) return new OAuthProviderError("temporarily_unavailable", "Microsoft sign-in is temporarily unavailable", { status, providerCode, retryable: true });
      return new OAuthProviderError("unknown", "Microsoft sign-in could not be completed", { status, providerCode });
  }
}

function parseScope(scope: unknown, fallback: readonly string[]): string[] {
  if (typeof scope === "string") return scope.split(/\s+/).map((item) => item.trim()).filter(Boolean);
  return [...fallback];
}

function parseTokenSet(payload: Record<string, unknown>, now: number, fallbackScopes: readonly string[]): OAuthTokenSet {
  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new OAuthProviderError("unknown", "Microsoft did not return an access token");
  }
  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : Number(payload.expires_in);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) throw new OAuthProviderError("unknown", "Microsoft returned an invalid access-token lifetime");
  if (payload.refresh_token !== undefined && typeof payload.refresh_token !== "string") throw new OAuthProviderError("unknown", "Microsoft returned an invalid refresh token");
  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : null,
    tokenType: typeof payload.token_type === "string" ? payload.token_type : "Bearer",
    scope: parseScope(payload.scope, fallbackScopes),
    expiresInSeconds: Math.floor(expiresIn),
    // Keep a small skew so queue work does not start with a token that is about
    // to expire. The exact token lifetime remains available for diagnostics.
    accessTokenExpiresAt: now + Math.floor(expiresIn * 1000),
    idToken: typeof payload.id_token === "string" ? payload.id_token : null,
  };
}

async function postTokenForm(
  config: EntraConfig | ResolvedEntraConfig,
  form: Record<string, string>,
  options: { fetchImpl?: FetchLike; now?: number } = {},
): Promise<OAuthTokenSet> {
  const resolved = tokenEndpoint(config);
  const request = new URLSearchParams({
    client_id: resolved.clientId,
    client_secret: resolved.clientSecret,
    redirect_uri: resolved.redirectUri,
    scope: resolved.scopes.join(" "),
    ...form,
  });
  let response: Response;
  try {
    response = await fetcher(options.fetchImpl)(resolved.tokenEndpoint, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: request.toString(),
    });
  } catch {
    throw new OAuthProviderError("network", "Microsoft sign-in could not reach the authorization service", { retryable: true });
  }
  const payload = await parseResponse(response);
  if (!response.ok) throw classifyOAuthError(response.status, payload);
  if (!payload) throw new OAuthProviderError("unknown", "Microsoft returned an invalid sign-in response");
  return parseTokenSet(payload, options.now ?? Date.now(), resolved.scopes);
}

export async function exchangeAuthorizationCode(
  config: EntraConfig | ResolvedEntraConfig,
  input: { code: string; codeVerifier: string; fetchImpl?: FetchLike; now?: number },
): Promise<OAuthTokenSet> {
  if (!input.code || !input.codeVerifier) throw new OAuthProviderError("invalid_request", "Microsoft sign-in response is incomplete");
  return postTokenForm(config, { grant_type: "authorization_code", code: input.code, code_verifier: input.codeVerifier }, input);
}

export async function refreshAccessToken(
  config: EntraConfig | ResolvedEntraConfig,
  input: { refreshToken: string; fetchImpl?: FetchLike; now?: number },
): Promise<OAuthTokenSet> {
  if (!input.refreshToken) throw new OAuthProviderError("invalid_grant", "Sign-in expired. Start Microsoft sign-in again");
  return postTokenForm(config, { grant_type: "refresh_token", refresh_token: input.refreshToken }, input);
}

export function tokenNeedsRefresh(expiresAt: number, now = Date.now(), skewMs = 60_000): boolean {
  return !Number.isFinite(expiresAt) || expiresAt <= now + Math.max(0, skewMs);
}

/** Alias for route/queue code that names this operation ensureFreshToken. */
export const refreshToken = refreshAccessToken;
