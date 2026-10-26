// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Buffer } from "node:buffer";
import { GoogleAuthService, GOOGLE_SCOPES, GMAIL_SCOPE, DRIVE_SCOPE, verifyGoogleIdentity } from "./auth";
import { gmailMailProvider, gmailMime } from "./gmail";
import { GoogleAppDataAttachmentStore } from "./drive";
import { SqliteD1 } from "../../../tests/helpers/sqlite-d1";
import { createD1AuthStores } from "../database/d1-auth";
import { decryptRefreshToken } from "../microsoft/token-crypto";
import { buildMimeMessage } from "../microsoft/smtp-mime";
import { sendProviderTestToSelf } from "../microsoft/test-send";
import { accountPace } from "../api/dependencies";
import type { MailFlowBindings } from "../api/contracts";
import { D1UserRepository } from "../database/d1-users";
import { Hono } from "hono";
import { registerGoogleAuthRoutes } from "../api/routes/google-auth";
import type { MailFlowAppEnv } from "../api/context";

let keys: CryptoKeyPair;
let jwk: JsonWebKey;
const now = Date.parse("2026-10-26T01:00:00Z");
beforeAll(async () => {
  keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
});
async function signed(claims: Record<string, unknown> = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: "https://accounts.google.com", aud: "synthetic-client", sub: "stable-subject", nonce: "nonce", email: "synthetic.mailflow@gmail.com", email_verified: true, iat: now / 1000, exp: now / 1000 + 3600, ...claims })).toString("base64url");
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${Buffer.from(signature).toString("base64url")}`;
}
const keyResponse = () => Response.json({ keys: [{ ...jwk, kid: "test-key", alg: "RS256" }] });
const message = { to: "to@example.test", cc: ["cc@example.test"], bcc: ["hidden@example.test"], replyTo: ["reply@example.test"], subject: "Synthetic test", htmlBody: "<p>Hello synthetic reader</p>", importance: "high" as const };

describe("Google identity and offline grants", () => {
  it("persists the provider through the general user repository", async () => {
    const db = new SqliteD1(); db.migrate();
    const repository = new D1UserRepository(db);
    await repository.upsert({ id: "google:synthetic", provider: "google", tenantId: "google", objectId: "synthetic", principalName: "synthetic@gmail.com", mailboxAddress: "synthetic@gmail.com", displayName: "Synthetic", role: "member", createdAt: new Date(now).toISOString(), lastLoginAt: null });
    expect(await repository.getById("google:synthetic")).toMatchObject({ provider: "google" });
    db.close();
  });
  it("preserves sign-in after partial consent and rechecks refreshed scopes", async () => {
    const db = new SqliteD1(); db.migrate();
    const stores = createD1AuthStores(db, () => now);
    let nonce = "";
    let refreshScopes = DRIVE_SCOPE;
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith("/certs")) return keyResponse();
      const refreshing = new URLSearchParams(String(init?.body)).get("grant_type") === "refresh_token";
      return Response.json({ access_token: "synthetic-access", refresh_token: refreshing ? undefined : "synthetic-refresh", id_token: refreshing ? undefined : await signed({ nonce }), expires_in: 3600, scope: refreshing ? refreshScopes : `openid email ${DRIVE_SCOPE}` });
    });
    const auth = new GoogleAuthService({ clientId: "synthetic-client", clientSecret: "synthetic", redirectUri: "https://mailflow.test/auth/google/callback" }, {
      ...stores, stateSecret: "synthetic", tokenEncryptionSecret: Buffer.alloc(32, 7).toString("base64"), now: () => now, fetchImpl: fetcher,
    });
    const started = await auth.beginSignIn();
    const url = new URL(started.authorizationUrl); nonce = url.searchParams.get("nonce")!;
    const result = await auth.completeSignIn({ code: "synthetic", state: url.searchParams.get("state")!, cookieHeader: started.stateCookie });
    expect(result.sessionCookie).toContain("HttpOnly");
    const callsBefore = fetcher.mock.calls.length;
    await expect(auth.refreshUserAccessToken(result.user.id)).rejects.toThrow("permission");
    expect(fetcher).toHaveBeenCalledTimes(callsBefore);
    expect(await auth.refreshUserAccessToken(result.user.id, DRIVE_SCOPE)).toEqual({ accessToken: "synthetic-access" });
    refreshScopes = "openid email";
    await expect(auth.refreshUserAccessToken(result.user.id, DRIVE_SCOPE)).rejects.toThrow("permission");
    expect((await stores.tokenStore.findByUserId(result.user.id, "google"))?.grantedScopes).not.toContain(DRIVE_SCOPE);
    db.close();
  });
  it("uses requested scopes when an equivalent grant omits scope, including same-account reconnect", async () => {
    const db = new SqliteD1(); db.migrate();
    const stores = createD1AuthStores(db, () => now);
    let nonce = "";
    let exchanges = 0;
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith("/certs")) return keyResponse();
      const refreshing = new URLSearchParams(String(init?.body)).get("grant_type") === "refresh_token";
      if (refreshing) return Response.json({ access_token: "synthetic-access", expires_in: 3600 });
      exchanges += 1;
      return Response.json({ access_token: "synthetic-access", refresh_token: exchanges === 1 ? "synthetic-refresh" : undefined, id_token: await signed({ nonce }), expires_in: 3600 });
    });
    const auth = new GoogleAuthService({ clientId: "synthetic-client", clientSecret: "synthetic", redirectUri: "https://mailflow.test/auth/google/callback" }, {
      ...stores, stateSecret: "synthetic", tokenEncryptionSecret: Buffer.alloc(32, 7).toString("base64"), now: () => now, fetchImpl: fetcher,
    });
    let user;
    for (const attempt of ["login", "reconnect"]) {
      const started = await auth.beginSignIn("/dashboard", user);
      const url = new URL(started.authorizationUrl); nonce = url.searchParams.get("nonce")!;
      const result = await auth.completeSignIn({ code: attempt, state: url.searchParams.get("state")!, cookieHeader: started.stateCookie }, user);
      user = result.user;
      expect((await stores.tokenStore.findByUserId(user.id, "google"))?.grantedScopes).toEqual(GOOGLE_SCOPES);
      expect(await auth.refreshUserAccessToken(user.id)).toEqual({ accessToken: "synthetic-access" });
    }
    expect(db.database.prepare("SELECT COUNT(*) AS count FROM users").get()).toMatchObject({ count: 1 });
    db.close();
  });
  it("consumes denied consent without creating a session and rejects its replay", async () => {
    const db = new SqliteD1(); db.migrate();
    const bindings = { DB: db, GOOGLE_CLIENT_ID: "synthetic", GOOGLE_CLIENT_SECRET: "synthetic", SESSION_SECRET: "synthetic-state", TOKEN_ENCRYPTION_KEY_B64: Buffer.alloc(32, 7).toString("base64"), PUBLIC_ORIGIN: "https://mailflow.test" } as unknown as MailFlowBindings;
    const app = new Hono<MailFlowAppEnv>(); registerGoogleAuthRoutes(app);
    const started = await app.request("https://mailflow.test/auth/google/start", {}, bindings);
    const state = new URL(started.headers.get("Location")!).searchParams.get("state");
    const request = `https://mailflow.test/auth/google/callback?error=access_denied&state=${encodeURIComponent(state!)}`;
    const headers = { Cookie: started.headers.get("Set-Cookie")! };
    const cancelled = await app.request(request, { headers }, bindings);
    expect(cancelled.headers.get("Location")).toBe("/?auth=cancelled");
    expect(db.database.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toMatchObject({ count: 0 });
    expect((await app.request(request, { headers }, bindings)).headers.get("Location")).toBe("/?auth=failed");
    db.close();
  });
  it("validates signed Google identity using stable sub", async () => {
    expect(await verifyGoogleIdentity(await signed(), "synthetic-client", "nonce", vi.fn(async () => keyResponse()), now)).toMatchObject({ sub: "stable-subject" });
  });
  it.each([{ iss: "https://attacker.test" }, { aud: "other-client" }, { azp: "other-client" }, { nonce: "wrong" }, { email_verified: false }, { email: "member@example.test" }, { sub: "" }, { exp: now / 1000 - 1 }, { iat: now / 1000 + 300 }])("rejects invalid identity claims %j", async claims => {
    const fetcher = vi.fn(async () => keyResponse());
    await expect(verifyGoogleIdentity(await signed(claims), "synthetic-client", "nonce", fetcher, now)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects a signature with an untrusted key", async () => {
    await expect(verifyGoogleIdentity(await signed(), "synthetic-client", "nonce", vi.fn(async () => Response.json({ keys: [] })), now)).rejects.toThrow();
  });
  it("binds state/PKCE, encrypts refresh grants, keeps providers separate and rejects replays", async () => {
    const db = new SqliteD1(); db.migrate();
    const stores = createD1AuthStores(db, () => now);
    const microsoft = await stores.userStore.upsert({ tenantId: "tenant", objectId: "object", principalName: "synthetic.mailflow@gmail.com", mailboxAddress: "synthetic.mailflow@gmail.com", lastLoginAt: now });
    let nonce = "";
    let verifier = "";
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith("/certs")) return keyResponse();
      verifier = String(new URLSearchParams(String(init?.body)).get("code_verifier"));
      return Response.json({ access_token: "synthetic-access", refresh_token: "synthetic-refresh", id_token: await signed({ nonce }), expires_in: 3600, scope: `openid email profile ${GMAIL_SCOPE} ${DRIVE_SCOPE}` });
    });
    const secret = Buffer.alloc(32, 7).toString("base64");
    const auth = new GoogleAuthService({ clientId: "synthetic-client", clientSecret: "synthetic-secret", redirectUri: "https://mailflow.test/auth/google/callback" }, {
      ...stores, stateSecret: "synthetic-state-secret", tokenEncryptionSecret: secret, now: () => now, fetchImpl: fetcher,
    });
    const started = await auth.beginSignIn("/dashboard");
    const url = new URL(started.authorizationUrl); nonce = url.searchParams.get("nonce")!;
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("access_type")).toBe("offline");
    const input = { code: "synthetic-code", state: url.searchParams.get("state")!, cookieHeader: started.stateCookie };
    const result = await auth.completeSignIn(input);
    expect(result.user.id).toBe("google:stable-subject"); expect(result.user.id).not.toBe(microsoft.id);
    expect(verifier.length).toBeGreaterThan(40);
    expect(result.sessionCookie).toContain("HttpOnly"); expect(result.sessionCookie).toContain("Secure");
    const record = await stores.tokenStore.findByUserId(result.user.id, "google");
    expect(record?.encryptedRefreshToken).not.toContain("synthetic-refresh");
    expect(await decryptRefreshToken(record!.encryptedRefreshToken, secret)).toBe("synthetic-refresh");
    await expect(auth.completeSignIn(input)).rejects.toThrow();
    const reconnect = await auth.beginSignIn("/dashboard", { ...result.user, id: "google:other-subject" });
    const reconnectUrl = new URL(reconnect.authorizationUrl); nonce = reconnectUrl.searchParams.get("nonce")!;
    await expect(auth.completeSignIn({ code: "code", state: reconnectUrl.searchParams.get("state")!, cookieHeader: reconnect.stateCookie }, { ...result.user, id: "google:other-subject" })).rejects.toThrow("same signed-in Gmail");
  });
});

describe("Gmail submission boundary", () => {
  it("includes BCC for Gmail without changing SMTP MIME and preserves headers", async () => {
    const mime = await gmailMime(message, "sender@gmail.com", "synthetic-send-key");
    const text = await new Response(mime.body).text();
    expect(text).toContain("Bcc: hidden@example.test"); expect(text).toContain("Reply-To: reply@example.test"); expect(text).toContain("Importance: high");
    expect(Buffer.byteLength(text)).toBe(mime.byteLength);
    expect(buildMimeMessage(message, { senderAddress: "sender@example.test" })).not.toContain("Bcc:");
  });
  it("streams maximum raw attachments with bounded chunks and MIME size", async () => {
    const content = new Uint8Array(20 * 1024 * 1024);
    const mime = await gmailMime({ ...message, attachments: [{ filename: "sample.txt", contentType: "text/plain", content }] }, "sender@gmail.com", "maximum");
    const reader = mime.body.getReader(); let total = 0; let maximum = 0;
    for (;;) { const next = await reader.read(); if (next.done) break; total += next.value.byteLength; maximum = Math.max(maximum, next.value.byteLength); }
    expect(total).toBe(mime.byteLength); expect(total).toBeLessThan(35_000_000); expect(maximum).toBeLessThanOrEqual(80 * 1024);
  });
  it("sends self-tests only to the authenticated mailbox", async () => {
    let raw = "";
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => { raw = await new Response(init?.body).text(); return Response.json({ id: "synthetic-message" }); });
    const provider = gmailMailProvider(async () => "synthetic-access", "sender@gmail.com", fetcher);
    const result = await sendProviderTestToSelf(provider, "sender@gmail.com", { ...message, bodyHtml: message.htmlBody }, "self-key", "google");
    expect(result.userMessage).toBe("Accepted by Gmail"); expect(result.smtpStatus).toBeUndefined();
    expect(raw).toContain("To: sender@gmail.com"); expect(raw).not.toMatch(/hidden@|cc@|reply@|to@example/u);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([429, 403, 401, 500])("classifies explicit Gmail status %i conservatively", async status => {
    const provider = gmailMailProvider(async () => "synthetic", "sender@gmail.com", vi.fn(async () => Response.json({ error: { errors: [{ reason: status === 403 ? "userRateLimitExceeded" : "other" }] } }, { status })));
    expect((await provider.send(message, { sendKey: "key" })).kind).toBe(status === 500 ? "unknown" : status === 401 ? "reconnect_required" : "retryable");
  });
  it("never retries an interrupted provider submission", async () => {
    const fetcher = vi.fn(async () => { throw new Error("synthetic network loss"); });
    expect(await gmailMailProvider(async () => "token", "sender@gmail.com", fetcher).send(message)).toMatchObject({ kind: "unknown" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("enforces Gmail pacing independently of Microsoft configuration", () => {
    const bindings = { GMAIL_PACE_PER_MINUTE: "9999", DEFAULT_CAMPAIGN_PACE: "12" } as MailFlowBindings;
    expect(accountPace(bindings, "google")).toBe(12);
    expect(accountPace(bindings, "google", 600)).toBe(12);
    expect(accountPace(bindings, "microsoft")).toBe(12);
    expect(accountPace({} as MailFlowBindings, "google")).toBe(12);
    expect(accountPace({ GMAIL_PACE_PER_MINUTE: "invalid" } as MailFlowBindings, "google")).toBe(12);
    expect(accountPace({ GMAIL_PACE_PER_MINUTE: "3" } as MailFlowBindings, "google")).toBe(3);
  });
});

describe("Google Drive app-data isolation", () => {
  it("queries only appDataFolder and rejects oversized downloads before buffering", async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => String(url).includes("alt=media") ? new Response("too large") : Response.json({ files: [{ id: "private-id", name: "mailflow-set-file.bin", size: "9" }] }));
    const store = new GoogleAppDataAttachmentStore(async () => "synthetic", fetcher);
    const file = await store.get("google:owner", "mailflow-set-file.bin");
    await expect(file!.arrayBuffer(3)).rejects.toThrow("size");
    expect(String(fetcher.mock.calls[0][0])).toContain("spaces=appDataFolder");
    await expect(store.get("google:owner", "bad'key")).rejects.toThrow();
  });
  it("uploads only into appDataFolder and deletes only matching private files", async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") { expect(JSON.parse(String(init.body)).parents).toEqual(["appDataFolder"]); return new Response(null, { headers: { Location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=synthetic" } }); }
      if (init?.method === "PUT") return Response.json({ id: "synthetic-file" });
      return Response.json({ files: [] });
    });
    const store = new GoogleAppDataAttachmentStore(async () => "synthetic", fetcher);
    await store.put("google:owner", "mailflow-set-file.bin", new Uint8Array([1, 2, 3]).buffer);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
