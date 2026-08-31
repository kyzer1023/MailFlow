import { describe, expect, it } from "vitest";
import { base64UrlEncode, openSecret, sealSecret, sha256 } from "./crypto";
import { consumeOAuthState, createOAuthState } from "./oauth-state";
import { generatePkcePair, verifyPkceChallenge } from "./pkce";
import { DEFAULT_SESSION_TTL_SECONDS, parseCookie, readSession, renewSession, OAUTH_STATE_COOKIE_NAME, SESSION_COOKIE_NAME, startSession } from "./session";
import { assertIdTokenClaims, parseJwt, TenantVerificationError, verifyIdToken } from "./tenant";
import { MicrosoftAuthService } from "./service";
import type { AuthenticatedUser, OAuthStatePayload, OAuthTokenRecord, OAuthTokenStore, UserStore, UserUpsert } from "./contracts";
import type { SessionRecord, SessionStore } from "./session";
import { GraphMailProvider } from "../microsoft/graph";
import { decryptRefreshToken } from "../microsoft/token-crypto";
import type { FetchLike } from "./tenant";

class MemorySessionStore implements SessionStore {
  readonly records = new Map<string, SessionRecord>();

  async create(record: SessionRecord): Promise<void> {
    this.records.set(record.tokenHash, record);
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    return this.records.get(tokenHash) ?? null;
  }

  async renewByTokenHash(tokenHash: string, expiresAt: number): Promise<void> {
    const record = this.records.get(tokenHash);
    if (record) record.expiresAt = expiresAt;
  }

  async revokeByTokenHash(tokenHash: string, revokedAt: number): Promise<void> {
    const record = this.records.get(tokenHash);
    if (record) record.revokedAt = revokedAt;
  }
}

class OneTimeStateStore {
  readonly records = new Map<string, OAuthStatePayload>();

  async put(payload: OAuthStatePayload): Promise<void> {
    this.records.set(payload.state, payload);
  }

  async consume(state: string): Promise<OAuthStatePayload | null> {
    const value = this.records.get(state) ?? null;
    this.records.delete(state);
    return value;
  }
}

class MemoryTokenStore implements OAuthTokenStore {
  record: OAuthTokenRecord | null = null;

  async save(record: OAuthTokenRecord): Promise<void> {
    this.record = record;
  }

  async findByUserId(): Promise<OAuthTokenRecord | null> {
    return this.record;
  }
}

class MemoryUserStore implements UserStore {
  readonly users: AuthenticatedUser[] = [];

  async upsert(input: UserUpsert): Promise<AuthenticatedUser> {
    const user: AuthenticatedUser = {
      id: "user-1",
      tenantId: input.tenantId,
      objectId: input.objectId,
      displayName: input.displayName ?? null,
      principalName: input.principalName,
      mailboxAddress: input.mailboxAddress,
    };
    this.users.push(user);
    return user;
  }
}

function unsignedJwt(payload: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid: "fixture" }): string {
  const encode = (value: Record<string, unknown>) => base64UrlEncode(JSON.stringify(value));
  return `${encode(header)}.${encode(payload)}.c2lnbmF0dXJl`;
}

describe("authentication crypto primitives", () => {
  it("seals and opens refresh/state material with AES-GCM", async () => {
    const envelope = await sealSecret("opaque-refresh-token", "fixture secret for unit tests", { aad: "purpose" });
    expect(envelope.startsWith("v1.")).toBe(true);
    expect(await openSecret(envelope, "fixture secret for unit tests", { aad: "purpose" })).toBe("opaque-refresh-token");
    await expect(openSecret(envelope, "wrong secret", { aad: "purpose" })).rejects.toThrow();
    await expect(openSecret(envelope, "fixture secret for unit tests", { aad: "other-purpose" })).rejects.toThrow();
  });

  it("generates an RFC 7636 S256 pair", async () => {
    const pair = await generatePkcePair();
    expect(pair.verifier).toHaveLength(43);
    expect(pair.challenge).toBe(base64UrlEncode(await sha256(pair.verifier)));
    expect(await verifyPkceChallenge(pair.verifier, pair.challenge)).toBe(true);
    expect(await verifyPkceChallenge(`${pair.verifier}x`, pair.challenge)).toBe(false);
  });
});

describe("OAuth state", () => {
  it("binds the callback to a sealed cookie and consumes it once", async () => {
    const store = new OneTimeStateStore();
    const started = await createOAuthState({ secret: "state secret", stateStore: store, secure: false, now: 10_000 });
    expect(started.stateCookie).toContain("HttpOnly");
    expect(started.stateCookie).not.toContain(started.payload.codeVerifier);
    const payload = await consumeOAuthState({
      secret: "state secret",
      expectedState: started.payload.state,
      cookieValue: started.stateCookieValue,
      stateStore: store,
      now: 10_001,
    });
    expect(payload.nonce).toBe(started.payload.nonce);
    await expect(consumeOAuthState({
      secret: "state secret",
      expectedState: started.payload.state,
      cookieValue: started.stateCookieValue,
      stateStore: store,
      now: 10_001,
    })).rejects.toThrow("replayed");
  });

  it("rejects a state mismatch and unsafe return target", async () => {
    const started = await createOAuthState({ secret: "state secret", returnTo: "https://evil.example", secure: false });
    expect(started.payload.returnTo).toBe("/dashboard");
    await expect(consumeOAuthState({
      secret: "state secret",
      expectedState: "x".repeat(32),
      cookieValue: started.stateCookieValue,
    })).rejects.toThrow();
  });
});

describe("session primitives", () => {
  it("stores only a hash and rejects expiry/revocation", async () => {
    const store = new MemorySessionStore();
    const started = await startSession(store, "user-1", { now: 1_000, ttlSeconds: 60, cookie: { secure: false } });
    expect(started.cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    const rawCookie = parseCookie(started.cookie, SESSION_COOKIE_NAME);
    // Set-Cookie is not a Cookie request header, but parsing the first pair is
    // equivalent to the browser returning it in a subsequent request.
    expect(rawCookie).toBe(started.token);
    expect([...store.records.values()][0].tokenHash).not.toBe(started.token);
    expect(await readSession(store, started.token, 1_001)).not.toBeNull();
    expect(await readSession(store, started.token, 61_001)).toBeNull();
  });

  it("renews an active session for one year", async () => {
    const store = new MemorySessionStore();
    const started = await startSession(store, "user-1", { now: 1_000, cookie: { secure: false } });
    const expiresAt = await renewSession(store, started.record, 5_000);
    expect(expiresAt).toBe(5_000 + DEFAULT_SESSION_TTL_SECONDS * 1_000);
    expect(store.records.get(started.tokenHash)?.expiresAt).toBe(expiresAt);
  });
});

describe("single-tenant identity checks", () => {
  const claims = {
    tid: "tenant-123",
    aud: "client-123",
    iss: "https://login.microsoftonline.com/tenant-123/v2.0",
    oid: "object-123",
    nonce: "nonce-123",
    exp: 2_000_000_000,
  };

  it("accepts exact tenant, audience, issuer, expiry, and nonce", async () => {
    assertIdTokenClaims(claims, { tenantId: "tenant-123", clientId: "client-123", nonce: "nonce-123", now: 1_900_000_000 });
    const token = unsignedJwt(claims);
    await expect(verifyIdToken(token, {
      tenantId: "tenant-123",
      clientId: "client-123",
      nonce: "nonce-123",
      now: 1_900_000_000,
      verifySignature: false,
    })).resolves.toMatchObject({ tid: "tenant-123", oid: "object-123" });
  });

  it("rejects another tenant even when the email could look familiar", () => {
    expect(() => assertIdTokenClaims({ ...claims, tid: "attacker-tenant" }, { tenantId: "tenant-123", clientId: "client-123", now: 1_900_000_000 })).toThrow(TenantVerificationError);
    expect(() => parseJwt("not-a-jwt")).toThrow(TenantVerificationError);
  });
});

describe("MicrosoftAuthService", () => {
  it("completes code exchange, tenant validation, token encryption, and session creation", async () => {
    let now = 1_000;
    const tokenStore = new MemoryTokenStore();
    const userStore = new MemoryUserStore();
    const sessionStore = new MemorySessionStore();
    const stateStore = new OneTimeStateStore();
    const claims = {
      tid: "tenant-123",
      aud: "client-123",
      iss: "https://login.microsoftonline.com/tenant-123/v2.0",
      oid: "object-123",
      nonce: "placeholder",
      preferred_username: "member@example.test",
      exp: 2_000_000_000,
    };
    const fetchImpl: FetchLike = async (url) => {
      if (String(url).includes("oauth2/v2.0/token")) {
        return new Response(JSON.stringify({ access_token: "access-fixture", refresh_token: "refresh-fixture", token_type: "Bearer", expires_in: 3600, scope: "openid offline_access User.Read Mail.Send", id_token: unsignedJwt(claims) }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ id: "object-123", displayName: "Fixture Member", mail: "member@example.test", userPrincipalName: "member@example.test" }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const provider = new GraphMailProvider({ fetchImpl });
    const service = new MicrosoftAuthService({
      tenantId: "tenant-123",
      clientId: "client-123",
      clientSecret: "client secret fixture",
      redirectUri: "https://mailflow.example.test/auth/microsoft/callback",
    }, provider, {
      userStore,
      sessionStore,
      tokenStore,
      stateStore,
      stateSecret: "state secret",
      tokenEncryptionSecret: "token secret",
      secureCookies: false,
      fetchImpl,
      now: () => now,
      verifyIdTokenSignature: false,
    });
    const started = await service.beginSignIn("/campaigns/new");
    const authorization = new URL(started.authorizationUrl);
    expect(authorization.searchParams.get("code_challenge")).toBe(base64UrlEncode(await sha256(started.codeVerifier)));
    claims.nonce = started.nonce;
    now = 1_001;
    const completed = await service.completeSignIn({ code: "auth-code", state: started.state, stateCookieValue: parseCookie(started.stateCookie, OAUTH_STATE_COOKIE_NAME) });
    expect(completed.user).toMatchObject({ id: "user-1", objectId: "object-123", mailboxAddress: "member@example.test" });
    expect(completed.returnTo).toBe("/campaigns/new");
    expect(completed.sessionCookie).toContain("HttpOnly");
    expect(tokenStore.record?.encryptedRefreshToken).not.toContain("refresh-fixture");
    expect(await decryptRefreshToken(tokenStore.record?.encryptedRefreshToken ?? "", "token secret")).toBe("refresh-fixture");
    expect(await service.refreshUserAccessToken("user-1")).toMatchObject({ accessToken: "access-fixture", refreshToken: "refresh-fixture" });
  });
});
