import type {
  AuthCallbackResult,
  AuthenticatedUser,
  AuthorizationStart,
  OAuthTokenResource,
  OAuthStateStore,
  OAuthTokenStore,
  UserStore,
} from "./contracts";
import { base64UrlEncode, sha256 } from "./crypto";
import {
  clearOAuthStateCookie,
  consumeOAuthState,
  createOAuthState,
} from "./oauth-state";
import { startSession } from "./session";
import type { SessionCookieOptions, SessionStore } from "./session";
import { verifyIdToken } from "./tenant";
import { resolveEntraConfig } from "../microsoft/config";
import type { EntraConfig } from "../microsoft/config";
import { exchangeAuthorizationCode, refreshAccessToken, buildAuthorizationUrl } from "../microsoft/oauth";
import type { OAuthTokenSet } from "../microsoft/oauth";
import type { GraphMailProviderContract } from "../microsoft/graph";
import { decryptRefreshToken, encryptRefreshToken, REFRESH_TOKEN_ENCRYPTION_VERSION } from "../microsoft/token-crypto";

export interface AuthServiceDependencies {
  userStore: UserStore;
  sessionStore: SessionStore;
  tokenStore: OAuthTokenStore;
  stateStore?: OAuthStateStore;
  /** Secret used to seal the HttpOnly OAuth state cookie. */
  stateSecret: string;
  /** Separate Worker secret used for D1 refresh-token ciphertext. */
  tokenEncryptionSecret: string;
  secureCookies?: boolean;
  sessionCookie?: SessionCookieOptions;
  fetchImpl?: import("./tenant").FetchLike;
  now?: () => number;
  /** Only set false in deterministic local tests with unsigned fixture tokens. */
  verifyIdTokenSignature?: boolean;
  sessionTtlSeconds?: number;
}

export class AuthFlowError extends Error {
  readonly code = "authentication_failed";
  readonly category: "state" | "identity" | "configuration" | "token";

  constructor(category: AuthFlowError["category"], message: string) {
    super(message);
    this.name = "AuthFlowError";
    this.category = category;
  }
}

export interface AuthCallbackInput {
  code: string;
  state: string;
  cookieHeader?: string | null;
  stateCookieValue?: string | null;
}

function mailboxAddress(mail: string | null, principalName: string | null, fallback: string | undefined): string | null {
  const candidates = [mail, principalName, fallback];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate.trim())) return candidate.trim();
  }
  return null;
}

function requireRefreshToken(tokenSet: OAuthTokenSet): string {
  if (!tokenSet.refreshToken) throw new AuthFlowError("token", "Microsoft did not grant background sign-in access");
  return tokenSet.refreshToken;
}

/**
 * Orchestrates the server-side Microsoft flow. HTTP routes remain responsible
 * for response headers and redirect handling; this class owns the security
 * contracts that must be identical for local and Worker deployments.
 */
export class MicrosoftAuthService {
  private readonly config;
  private readonly tokenResource: OAuthTokenResource;

  constructor(
    config: EntraConfig,
    private readonly provider: GraphMailProviderContract | null,
    private readonly deps: AuthServiceDependencies,
  ) {
    this.config = resolveEntraConfig(config);
    this.tokenResource = this.config.scopes.some((scope) => scope.toLowerCase().endsWith("/smtp.send"))
      ? "smtp"
      : this.config.scopes.includes("Files.ReadWrite.AppFolder")
        ? "onedrive"
        : "graph_mail";
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  async beginSignIn(returnTo = "/dashboard", statePrefix?: string): Promise<AuthorizationStart> {
    const state = await createOAuthState({
      secret: this.deps.stateSecret,
      stateStore: this.deps.stateStore,
      returnTo,
      statePrefix,
      now: this.now(),
      secure: this.deps.secureCookies ?? true,
    });
    // The sealed cookie and URL are built from the same state payload, so a
    // callback cannot swap the verifier or nonce independently.
    // Derive the challenge from the verifier stored in the sealed payload. The
    // URL and callback therefore share one PKCE pair.
    const challenge = base64UrlEncode(await sha256(state.payload.codeVerifier));
    return {
      authorizationUrl: buildAuthorizationUrl(this.config, {
        state: state.payload.state,
        codeChallenge: challenge,
        nonce: state.payload.nonce,
      }),
      state: state.payload.state,
      codeVerifier: state.payload.codeVerifier,
      nonce: state.payload.nonce,
      stateCookie: state.stateCookie,
    };
  }

  async completeSignIn(input: AuthCallbackInput): Promise<AuthCallbackResult & { returnTo: string }> {
    if (!input.code || !input.state) throw new AuthFlowError("state", "Microsoft sign-in response is incomplete");
    let state;
    try {
      state = await consumeOAuthState({
        secret: this.deps.stateSecret,
        expectedState: input.state,
        cookieHeader: input.cookieHeader,
        cookieValue: input.stateCookieValue,
        now: this.now(),
        stateStore: this.deps.stateStore,
      });
    } catch {
      throw new AuthFlowError("state", "Microsoft sign-in could not be verified in this browser");
    }

    const tokens = await exchangeAuthorizationCode(this.config, {
      code: input.code,
      codeVerifier: state.codeVerifier,
      fetchImpl: this.deps.fetchImpl,
      now: this.now(),
    });
    if (!tokens.idToken) throw new AuthFlowError("identity", "Microsoft did not return a verifiable identity");
    const claims = await verifyIdToken(tokens.idToken, {
      tenantId: this.config.tenantId,
      clientId: this.config.clientId,
      nonce: state.nonce,
      fetchImpl: this.deps.fetchImpl,
      verifySignature: this.deps.verifyIdTokenSignature ?? true,
      now: Math.floor(this.now() / 1000),
    });
    const graphUser = this.provider ? await this.provider.getCurrentUser(tokens.accessToken) : null;
    if (graphUser && claims.oid && graphUser.id !== claims.oid) throw new AuthFlowError("identity", "Microsoft identity did not match the signed-in mailbox");
    const principalCandidate = typeof claims.preferred_username === "string"
      ? claims.preferred_username
      : typeof claims.email === "string"
        ? claims.email
        : graphUser?.userPrincipalName ?? "";
    const mailbox = mailboxAddress(graphUser?.mail ?? null, graphUser?.userPrincipalName ?? null, principalCandidate);
    const principalName = principalCandidate.trim() || mailbox || "";
    if (!mailbox || !claims.oid) throw new AuthFlowError("identity", "The signed-in Microsoft mailbox could not be identified");
    const user: AuthenticatedUser = await this.deps.userStore.upsert({
      tenantId: claims.tid,
      objectId: claims.oid,
      displayName: graphUser?.displayName ?? (typeof claims.name === "string" ? claims.name : null),
      principalName,
      mailboxAddress: mailbox,
      lastLoginAt: this.now(),
    });
    const refreshToken = requireRefreshToken(tokens);
    await this.deps.tokenStore.save({
      userId: user.id,
      resource: this.tokenResource,
      encryptedRefreshToken: await encryptRefreshToken(refreshToken, this.deps.tokenEncryptionSecret),
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      grantedScopes: tokens.scope,
      encryptionVersion: REFRESH_TOKEN_ENCRYPTION_VERSION,
      updatedAt: this.now(),
    });
    const session = await startSession(this.deps.sessionStore, user.id, {
      now: this.now(),
      ttlSeconds: this.deps.sessionTtlSeconds,
      cookie: this.deps.sessionCookie,
    });
    return {
      user,
      sessionToken: session.token,
      sessionCookie: session.cookie,
      stateCookie: clearOAuthStateCookie(this.deps.secureCookies ?? true),
      returnTo: state.returnTo,
    };
  }

  /** Refresh and persist a user's token for queue work without exposing it. */
  async refreshUserAccessToken(userId: string): Promise<OAuthTokenSet> {
    const record = await this.deps.tokenStore.findByUserId(userId, this.tokenResource);
    if (!record) throw new AuthFlowError("token", "Sign-in expired. Sign in again, then resume from the first unsent row.");
    const refreshToken = await decryptRefreshToken(record.encryptedRefreshToken, this.deps.tokenEncryptionSecret);
    const tokens = await refreshAccessToken(this.config, {
      refreshToken,
      fetchImpl: this.deps.fetchImpl,
      now: this.now(),
    });
    await this.deps.tokenStore.save({
      ...record,
      encryptedRefreshToken: await encryptRefreshToken(tokens.refreshToken ?? refreshToken, this.deps.tokenEncryptionSecret),
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      grantedScopes: tokens.scope,
      encryptionVersion: REFRESH_TOKEN_ENCRYPTION_VERSION,
      updatedAt: this.now(),
    });
    return tokens;
  }

  /** Complete an additional resource grant for the already signed-in user. */
  async completeResourceConsent(input: AuthCallbackInput, expectedUser: AuthenticatedUser): Promise<{ returnTo: string; stateCookie: string }> {
    if (!input.code || !input.state) throw new AuthFlowError("state", "Microsoft authorization response is incomplete");
    let state;
    try {
      state = await consumeOAuthState({
        secret: this.deps.stateSecret,
        expectedState: input.state,
        cookieHeader: input.cookieHeader,
        cookieValue: input.stateCookieValue,
        now: this.now(),
        stateStore: this.deps.stateStore,
      });
    } catch {
      throw new AuthFlowError("state", "Microsoft authorization could not be verified in this browser");
    }
    const tokens = await exchangeAuthorizationCode(this.config, {
      code: input.code,
      codeVerifier: state.codeVerifier,
      fetchImpl: this.deps.fetchImpl,
      now: this.now(),
    });
    if (!tokens.idToken) throw new AuthFlowError("identity", "Microsoft did not return a verifiable identity");
    const claims = await verifyIdToken(tokens.idToken, {
      tenantId: this.config.tenantId,
      clientId: this.config.clientId,
      nonce: state.nonce,
      fetchImpl: this.deps.fetchImpl,
      verifySignature: this.deps.verifyIdTokenSignature ?? true,
      now: Math.floor(this.now() / 1000),
    });
    if (claims.tid !== expectedUser.tenantId || claims.oid !== expectedUser.objectId) {
      throw new AuthFlowError("identity", "Authorize OneDrive with the same Microsoft account currently signed in to MailFlow");
    }
    const refreshToken = requireRefreshToken(tokens);
    await this.deps.tokenStore.save({
      userId: expectedUser.id,
      resource: this.tokenResource,
      encryptedRefreshToken: await encryptRefreshToken(refreshToken, this.deps.tokenEncryptionSecret),
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      grantedScopes: tokens.scope,
      encryptionVersion: REFRESH_TOKEN_ENCRYPTION_VERSION,
      updatedAt: this.now(),
    });
    return {
      returnTo: state.returnTo,
      stateCookie: clearOAuthStateCookie(this.deps.secureCookies ?? true),
    };
  }
}
