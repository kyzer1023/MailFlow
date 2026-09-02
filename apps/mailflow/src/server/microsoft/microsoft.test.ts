import { describe, expect, it } from "vitest";
import { buildAuthorizationUrl, exchangeAuthorizationCode, refreshAccessToken } from "./oauth";
import { resolveEntraConfig, SMTP_ENTRA_SCOPES } from "./config";
import { classifyGraphError, GraphApiError } from "./errors";
import { GraphMailProvider } from "./graph";
import { sendTestToSelf } from "./test-send";
import { delegatedGraphMailProvider } from "./adapter";
import type { FetchLike } from "../auth/tenant";

function jsonResponse(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", ...headers } });
}

const config = {
  tenantId: "tenant-123",
  clientId: "client-123",
  clientSecret: "client secret fixture",
  redirectUri: "https://mailflow.example.test/auth/microsoft/callback",
};

describe("Microsoft OAuth", () => {
  it("builds a single-tenant authorization URL with PKCE and required scopes", () => {
    const url = new URL(buildAuthorizationUrl(config, {
      state: "s".repeat(43),
      codeChallenge: "c".repeat(43),
      nonce: "n".repeat(43),
    }));
    expect(url.hostname).toBe("login.microsoftonline.com");
    expect(url.pathname).toContain("tenant-123");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toContain("Mail.Send");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("prompt")).toBe("select_account");
  });

  it("exchanges a code using form encoding and parses token metadata", async () => {
    let requestBody = "";
    const fetchImpl: FetchLike = async (_url, init) => {
      requestBody = String(init?.body ?? "");
      return jsonResponse({ access_token: "access-fixture", refresh_token: "refresh-fixture", token_type: "Bearer", expires_in: 3600, scope: "openid User.Read Mail.Send", id_token: "id-fixture" });
    };
    const tokens = await exchangeAuthorizationCode(config, { code: "auth-code", codeVerifier: "v".repeat(43), fetchImpl, now: 1_000 });
    const body = new URLSearchParams(requestBody);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBe("v".repeat(43));
    expect(body.get("client_secret")).toBe(config.clientSecret);
    expect(tokens.accessTokenExpiresAt).toBe(3_601_000);
    expect(tokens.refreshToken).toBe("refresh-fixture");
  });

  it("refreshes tokens and classifies invalid grants without exposing response text", async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ error: "invalid_grant", error_description: "fixture details that must not be surfaced" }, 400);
    await expect(refreshAccessToken(config, { refreshToken: "refresh-fixture", fetchImpl })).rejects.toMatchObject({ category: "invalid_grant", status: 400 });
    await expect(refreshAccessToken(config, { refreshToken: "refresh-fixture", fetchImpl })).rejects.toThrow("Sign-in expired");
  });

  it("supports the Outlook SMTP resource but rejects mixed Graph and SMTP tokens", () => {
    expect(resolveEntraConfig({ ...config, scopes: SMTP_ENTRA_SCOPES }).scopes).toContain("https://outlook.office.com/SMTP.Send");
    expect(() => resolveEntraConfig({ ...config, scopes: [...SMTP_ENTRA_SCOPES, "User.Read", "Mail.Send"] })).toThrow("resource-specific");
  });
});

describe("delegated Graph provider", () => {
  it("reads /me and sends one HTML message through /me/sendMail", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      requests.push({ url: String(url), init });
      if (String(url).includes("/me/sendMail")) return new Response(null, { status: 202, headers: { "request-id": "request-fixture" } });
      return jsonResponse({ id: "object-123", displayName: "Fixture Member", mail: "member@example.test", userPrincipalName: "member@example.test" });
    };
    const provider = new GraphMailProvider({ fetchImpl });
    const user = await provider.getCurrentUser("access-fixture");
    expect(user).toMatchObject({ id: "object-123", mail: "member@example.test" });
    const result = await provider.sendMail("access-fixture", {
      subject: "Fixture subject",
      bodyHtml: "<p>Hello</p>",
      to: ["recipient@example.test"],
      cc: ["copy@example.test"],
      importance: "high",
      saveToSentItems: true,
    });
    expect(result).toMatchObject({ accepted: true, status: 202, requestId: "request-fixture" });
    const sendRequest = requests.find((request) => request.url.includes("/sendMail"));
    expect(sendRequest?.init?.method).toBe("POST");
    expect(sendRequest?.init?.headers).toMatchObject({ Authorization: "Bearer access-fixture", "Content-Type": "application/json" });
    const payload = JSON.parse(String(sendRequest?.init?.body));
    expect(payload.message.toRecipients).toEqual([{ emailAddress: { address: "recipient@example.test" } }]);
    expect(payload.message.ccRecipients).toEqual([{ emailAddress: { address: "copy@example.test" } }]);
    expect(payload.message.importance).toBe("high");
    expect(payload.message.body).toEqual({ contentType: "HTML", content: "<p>Hello</p>" });
  });

  it("maps Graph responses to safe human-readable categories", async () => {
    const provider = new GraphMailProvider({ fetchImpl: async () => jsonResponse({ error: { code: "ErrorTooManyRequests", message: "private provider text" } }, 429, { "Retry-After": "7" }) });
    await expect(provider.sendMail("access-fixture", { subject: "Fixture", bodyHtml: "<p>Fixture</p>", to: ["recipient@example.test"] })).rejects.toMatchObject({ category: "throttled", retryAfterSeconds: 7, retryable: true });
    await expect(provider.sendMail("access-fixture", { subject: "Fixture", bodyHtml: "<p>Fixture</p>", to: ["recipient@example.test"] })).rejects.toThrow("temporary pause");
  });

  it("marks a transport failure ambiguous instead of retrying blindly", async () => {
    const provider = new GraphMailProvider({ fetchImpl: async () => { throw new Error("network fixture"); } });
    await expect(provider.sendMail("access-fixture", { subject: "Fixture", bodyHtml: "<p>Fixture</p>", to: ["recipient@example.test"] })).rejects.toMatchObject({ category: "network", ambiguous: true, retryable: false });
  });

  it("rejects invalid recipient input before a network call", async () => {
    const provider = new GraphMailProvider({ fetchImpl: async () => jsonResponse({}) });
    await expect(provider.sendMail("access-fixture", { subject: "Fixture", bodyHtml: "<p>Fixture</p>", to: ["not-an-email"] })).rejects.toMatchObject({ category: "invalid_recipient" });
  });
});

describe("test-send service", () => {
  it("uses the authenticated mailbox as both sender identity and self recipient", async () => {
    const calls: unknown[] = [];
    const provider = {
      async getCurrentUser() {
        return { id: "object-123", displayName: "Fixture Member", mail: "member@example.test", userPrincipalName: "member@example.test" };
      },
      async sendMail(_accessToken: string, input: unknown) {
        calls.push(input);
        return { accepted: true as const, status: 202, requestId: "request-fixture" };
      },
    };
    const result = await sendTestToSelf(provider, "access-fixture", {
      subject: "Fixture test",
      bodyHtml: "<p>Fixture</p>",
      cc: ["copy@example.test"],
      bcc: ["audit@example.test"],
      replyTo: ["replies@example.test"],
      importance: "low",
    });
    expect(result).toMatchObject({ status: "accepted", userMessage: "Accepted by Microsoft", senderAddress: "member@example.test", recipientAddress: "member@example.test" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      to: ["member@example.test"],
      cc: ["copy@example.test"],
      bcc: ["audit@example.test"],
      replyTo: ["replies@example.test"],
      importance: "low",
      saveToSentItems: true,
    });
  });
});

describe("provider-neutral Graph adapter", () => {
  it("maps accepted, throttled, and ambiguous outcomes for queue state handling", async () => {
    const accepted = new GraphMailProvider({ fetchImpl: async () => new Response(null, { status: 202, headers: { "request-id": "request-fixture" } }) });
    const acceptedResult = await delegatedGraphMailProvider(accepted, "access-fixture").send({ to: "recipient@example.test", cc: [], bcc: [], replyTo: [], subject: "Fixture", htmlBody: "<p>Fixture</p>" }, { sendKey: "send-key-fixture" });
    expect(acceptedResult).toMatchObject({ kind: "accepted", providerRequestId: "request-fixture" });

    const throttled = new GraphMailProvider({ fetchImpl: async () => jsonResponse({ error: { code: "ErrorTooManyRequests" } }, 429, { "Retry-After": "11" }) });
    const retryResult = await delegatedGraphMailProvider(throttled, "access-fixture").send({ to: "recipient@example.test", cc: [], bcc: [], replyTo: [], subject: "Fixture", htmlBody: "<p>Fixture</p>" }, { sendKey: "send-key-fixture" });
    expect(retryResult).toMatchObject({ kind: "retryable", safeToRetry: true, category: "throttle", retryAfter: 11 });

    const ambiguous = new GraphMailProvider({ fetchImpl: async () => { throw new Error("network fixture"); } });
    const unknownResult = await delegatedGraphMailProvider(ambiguous, "access-fixture").send({ to: "recipient@example.test", cc: [], bcc: [], replyTo: [], subject: "Fixture", htmlBody: "<p>Fixture</p>" }, { sendKey: "send-key-fixture" });
    expect(unknownResult).toMatchObject({ kind: "unknown", category: "ambiguous" });

    const attachmentResult = await delegatedGraphMailProvider(accepted, "access-fixture").send({ to: "recipient@example.test", cc: [], bcc: [], replyTo: [], subject: "Fixture", htmlBody: "<p>Fixture</p>", attachments: [{ filename: "proof.txt", contentType: "text/plain", content: new Uint8Array([1]) }] });
    expect(attachmentResult).toMatchObject({ kind: "failed", category: "invalid_message" });
  });
});

describe("Graph error classification", () => {
  it("keeps user guidance stable and excludes provider payload text", () => {
    const classification = classifyGraphError({ status: 403, providerCode: "ErrorAccessDenied" });
    expect(classification.category).toBe("forbidden");
    expect(classification.userMessage).toContain("mail permission");
    expect(classification.userMessage).not.toContain("ErrorAccessDenied");
    expect(new GraphApiError(classification).message).not.toContain("provider");
  });
});
