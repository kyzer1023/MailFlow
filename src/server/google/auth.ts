import type { AuthenticatedUser } from "../auth/contracts";
import { AuthFlowError, type AuthCallbackInput, type AuthServiceDependencies } from "../auth/service";
import { base64UrlEncode, sha256 } from "../auth/crypto";
import { createOAuthState, consumeOAuthState, clearOAuthStateCookie } from "../auth/oauth-state";
import { startSession } from "../auth/session";
import { parseJwt, verifyJwtSignature, type JsonWebKeySet } from "../auth/tenant";
import { decryptRefreshToken, encryptRefreshToken } from "../microsoft/token-crypto";
import { isValidEmail } from "../../domain/validation";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
export const GOOGLE_SCOPES = ["openid", "email", "profile", GMAIL_SCOPE, DRIVE_SCOPE];

export interface GoogleConfig { clientId: string; clientSecret: string; redirectUri: string }
interface TokenResponse { access_token?: string; refresh_token?: string; id_token?: string; scope?: string; expires_in?: number }

export async function verifyGoogleIdentity(token: string, clientId: string, nonce: string, fetchImpl: typeof fetch = fetch, now = Date.now()) {
  const parsed = parseJwt(token);
  const claims = parsed.payload;
  if (!["https://accounts.google.com", "accounts.google.com"].includes(String(claims.iss))
    || claims.aud !== clientId || (claims.azp !== undefined && claims.azp !== clientId)
    || claims.nonce !== nonce || typeof claims.exp !== "number" || claims.exp * 1000 <= now
    || typeof claims.iat !== "number" || claims.iat * 1000 > now + 30_000
    || (typeof claims.nbf === "number" && claims.nbf * 1000 > now + 30_000)
    || typeof claims.sub !== "string" || !/^[A-Za-z0-9_-]{1,255}$/u.test(claims.sub)
    || claims.email_verified !== true || typeof claims.email !== "string"
    || !isValidEmail(claims.email) || !/@(?:gmail|googlemail)\.com$/iu.test(claims.email)) {
    throw new AuthFlowError("identity", "A verified personal Gmail account is required");
  }
  const response = await fetchImpl("https://www.googleapis.com/oauth2/v3/certs", { signal: AbortSignal.timeout(15_000) });
  if (!response.ok || !await verifyJwtSignature(parsed, await response.json() as JsonWebKeySet)) {
    throw new AuthFlowError("identity", "Google identity could not be verified");
  }
  return { sub: claims.sub, email: claims.email.toLowerCase(), name: typeof claims.name === "string" ? claims.name : null };
}

export class GoogleAuthService {
  constructor(private readonly config: GoogleConfig, private readonly deps: AuthServiceDependencies) {}
  private now() { return this.deps.now?.() ?? Date.now(); }
  private async token(parameters: Record<string, string>): Promise<TokenResponse> {
    const response = await (this.deps.fetchImpl ?? fetch)("https://oauth2.googleapis.com/token", {
      method: "POST", signal: AbortSignal.timeout(15_000),
      body: new URLSearchParams({ ...parameters, client_id: this.config.clientId, client_secret: this.config.clientSecret }),
    });
    if (!response.ok) {
      if (response.status === 400 || response.status === 401 || response.status === 403) throw new AuthFlowError("token", "Reconnect Google with the same account");
      throw new Error("Google authorization is temporarily unavailable");
    }
    const tokens = await response.json() as TokenResponse;
    if (!tokens.access_token || !Number.isFinite(tokens.expires_in) || Number(tokens.expires_in) <= 0) throw new AuthFlowError("token", "Google authorization is incomplete");
    return tokens;
  }
  async beginSignIn(returnTo = "/dashboard", expectedUser?: AuthenticatedUser) {
    const started = await createOAuthState({ secret: this.deps.stateSecret, stateStore: this.deps.stateStore,
      returnTo, statePrefix: expectedUser ? `google-reconnect:${expectedUser.id}` : "google", now: this.now(), secure: this.deps.secureCookies });
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({ client_id: this.config.clientId, redirect_uri: this.config.redirectUri,
      response_type: "code", scope: GOOGLE_SCOPES.join(" "), access_type: "offline", prompt: "consent select_account",
      state: started.payload.state, nonce: started.payload.nonce,
      code_challenge: base64UrlEncode(await sha256(started.payload.codeVerifier)), code_challenge_method: "S256" }).toString();
    return { authorizationUrl: url.toString(), stateCookie: started.stateCookie };
  }
  async consume(input: Omit<AuthCallbackInput, "code">) {
    if (!input.state.startsWith("google.") && !input.state.startsWith("google-reconnect:")) throw new AuthFlowError("state", "Invalid Google authorization state");
    return consumeOAuthState({ expectedState: input.state, cookieHeader: input.cookieHeader, cookieValue: input.stateCookieValue,
      secret: this.deps.stateSecret, stateStore: this.deps.stateStore, now: this.now() });
  }
  async completeSignIn(input: AuthCallbackInput, expectedUser?: AuthenticatedUser) {
    const state = await this.consume(input);
    const reconnectId = state.state.startsWith("google-reconnect:") ? state.state.slice(17).split(".")[0] : null;
    if (reconnectId && (!expectedUser || expectedUser.id !== reconnectId)) throw new AuthFlowError("identity", "Reconnect the same signed-in account");
    const tokens = await this.token({ grant_type: "authorization_code", code: input.code, code_verifier: state.codeVerifier, redirect_uri: this.config.redirectUri });
    if (!tokens.id_token) throw new AuthFlowError("identity", "Google did not return a verified identity");
    const identity = await verifyGoogleIdentity(tokens.id_token, this.config.clientId, state.nonce, this.deps.fetchImpl, this.now());
    const userId = `google:${identity.sub}`;
    if (expectedUser && (expectedUser.id !== userId || expectedUser.mailboxAddress !== identity.email)) throw new AuthFlowError("identity", "Reconnect the same signed-in Gmail account");
    const previous = await this.deps.tokenStore.findByUserId(userId, "google");
    const user = await this.deps.userStore.upsert({ provider: "google", tenantId: "google", objectId: identity.sub,
      displayName: identity.name, principalName: identity.email, mailboxAddress: identity.email, lastLoginAt: this.now() });
    const encryptedRefreshToken = tokens.refresh_token ? await encryptRefreshToken(tokens.refresh_token, this.deps.tokenEncryptionSecret) : previous?.encryptedRefreshToken;
    if (encryptedRefreshToken) await this.deps.tokenStore.save({ userId, resource: "google", encryptedRefreshToken,
      accessTokenExpiresAt: this.now() + Number(tokens.expires_in) * 1000, grantedScopes: tokens.scope === undefined ? [...GOOGLE_SCOPES] : tokens.scope.split(/\s+/u).filter(Boolean),
      encryptionVersion: 1, updatedAt: this.now() });
    const session = await startSession(this.deps.sessionStore, userId, { now: this.now(), ttlSeconds: this.deps.sessionTtlSeconds, cookie: this.deps.sessionCookie });
    return { user, sessionToken: session.token, sessionCookie: session.cookie,
      stateCookie: clearOAuthStateCookie(this.deps.secureCookies), returnTo: state.returnTo };
  }
  async refreshUserAccessToken(userId: string, scope = GMAIL_SCOPE) {
    const record = await this.deps.tokenStore.findByUserId(userId, "google");
    if (!record || !record.grantedScopes.includes(scope)) throw new AuthFlowError("token", "Reconnect Google and allow the requested permission");
    const refreshToken = await decryptRefreshToken(record.encryptedRefreshToken, this.deps.tokenEncryptionSecret);
    const tokens = await this.token({ grant_type: "refresh_token", refresh_token: refreshToken });
    const scopes = tokens.scope === undefined ? record.grantedScopes : tokens.scope.split(/\s+/u);
    await this.deps.tokenStore.save({ ...record, grantedScopes: scopes,
      encryptedRefreshToken: tokens.refresh_token ? await encryptRefreshToken(tokens.refresh_token, this.deps.tokenEncryptionSecret) : record.encryptedRefreshToken,
      accessTokenExpiresAt: this.now() + Number(tokens.expires_in) * 1000, updatedAt: this.now() });
    if (!scopes.includes(scope)) throw new AuthFlowError("token", "Reconnect Google and allow the requested permission");
    return { accessToken: tokens.access_token! };
  }
}
