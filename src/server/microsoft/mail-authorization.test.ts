import { expect, it, vi } from "vitest";
import { AuthFlowError } from "../auth/service";
import { OAuthProviderError } from "./oauth";
import { delegatedGraphMailProvider } from "./adapter";
import { GraphMailProvider } from "./graph";

const message = { to: "member@example.test", cc: [], bcc: [], replyTo: [], subject: "Synthetic", htmlBody: "<p>Test</p>" };
it.each([new AuthFlowError("token", "private details"), new OAuthProviderError("invalid_grant", "private grant")])(
  "keeps missing or revoked Graph credentials before the submission boundary", async failure => {
    const fetchImpl = vi.fn();
    const provider = delegatedGraphMailProvider(new GraphMailProvider({ fetchImpl }), async () => { throw failure; });
    expect(await provider.prepare!()).toMatchObject({ kind: "reconnect_required", safeToRetry: true });
    expect(await provider.send(message, { sendKey: "synthetic" })).toMatchObject({ kind: "reconnect_required" });
    expect(fetchImpl).not.toHaveBeenCalled();
  },
);
it.each([401, 403])("preserves a proven Graph authorization rejection (%s) as reconnectable", async status => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "ErrorAccessDenied" } }), { status }));
  const provider = delegatedGraphMailProvider(new GraphMailProvider({ fetchImpl }), "synthetic-token");
  expect(await provider.send(message, { sendKey: "synthetic" })).toMatchObject({ kind: "reconnect_required", safeToRetry: true });
});
it("retries token network failures but keeps submission network failures unknown", async () => {
  const fetchImpl = vi.fn().mockRejectedValue(new TypeError("network"));
  const before = delegatedGraphMailProvider(new GraphMailProvider({ fetchImpl }), async () => { throw new TypeError("network"); });
  expect(await before.prepare!()).toMatchObject({ kind: "retryable", safeToRetry: true });
  expect(fetchImpl).not.toHaveBeenCalled();
  const after = delegatedGraphMailProvider(new GraphMailProvider({ fetchImpl }), "synthetic-token");
  expect(await after.send(message, { sendKey: "synthetic" })).toMatchObject({ kind: "unknown" });
});
