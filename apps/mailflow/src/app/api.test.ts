import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, archiveFlow, createCampaign, pauseCampaign, sendCampaignTest, startCampaign, updateFlow } from "./api";
import type { CampaignCreatePayload } from "../client/types";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("same-origin API client", () => {
  it("sends JSON mutations with same-origin credentials and the CSRF token", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ campaign: { id: "campaign_1" }, counts: {} }));
    vi.stubGlobal("fetch", fetchMock);
    const payload = {
      idempotencyKey: "request-1",
      flowId: "flow_1",
      templateVersionId: "version_1",
      sourceFilename: "recipients.csv",
      subjectTemplate: "Hello",
      bodyHtml: "<p>Hello</p>",
      placeholderManifest: [],
      recipientConfiguration: { toField: "email", ccField: null, bccField: null, replyToField: null, separator: "auto" },
      pacePerMinute: 12,
      totalRecipients: 1,
      validRecipients: 1,
      skippedRecipients: 0,
      rows: [{ sourceRow: 2, to: "member@example.test", cc: [], bcc: [], replyTo: [], mergeData: {}, renderedSubject: "Hello", renderedBodyHtml: "<p>Hello</p>" }],
    } satisfies CampaignCreatePayload;

    await createCampaign(payload, "csrf-1");

    const [path, options] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/campaigns");
    expect(options).toMatchObject({ method: "POST", credentials: "same-origin" });
    const headers = options?.headers as Headers;
    expect(headers.get("X-CSRF-Token")).toBe("csrf-1");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(options?.body))).toMatchObject({ idempotencyKey: "request-1", flowId: "flow_1" });
  });

  it("bypasses browser caches for live campaign reads", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ campaigns: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/api/campaigns");

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });

  it("aligns acknowledgement and pause bodies with the Worker routes", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ campaign: { id: "campaign_1" } }));
    vi.stubGlobal("fetch", fetchMock);

    await startCampaign("campaign_1", "csrf-2");
    await pauseCampaign("campaign_1", "csrf-2");

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ acknowledged: true });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ reason: "Paused by member" });
  });

  it("archives a flow without deleting its campaign history", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ flow: { id: "flow_1", state: "archived" } }));
    vi.stubGlobal("fetch", fetchMock);

    await archiveFlow("flow_1", "csrf-archive");

    expect(fetchMock.mock.calls[0][0]).toBe("/api/flows/flow_1");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "PATCH" });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ state: "archived" });
  });

  it("sends flow name changes to the owner-scoped flow route", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ flow: { id: "flow_1", name: "Renamed flow" } }));
    vi.stubGlobal("fetch", fetchMock);

    await updateFlow("flow_1", { name: "Renamed flow" }, "csrf-rename");

    expect(fetchMock.mock.calls[0][0]).toBe("/api/flows/flow_1");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "PATCH" });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ name: "Renamed flow" });
  });

  it("sends the reviewed recipient metadata with a test message", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ result: { status: "accepted" } }));
    vi.stubGlobal("fetch", fetchMock);

    await sendCampaignTest("campaign_1", {
      subject: "Hello",
      bodyHtml: "<p>Hello</p>",
      cc: ["copy@example.test"],
      bcc: ["audit@example.test"],
      replyTo: ["replies@example.test"],
      importance: "high",
    }, "csrf-3");

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      subject: "Hello",
      bodyHtml: "<p>Hello</p>",
      cc: ["copy@example.test"],
      bcc: ["audit@example.test"],
      replyTo: ["replies@example.test"],
      importance: "high",
    });
  });

  it("surfaces only the API's redacted error contract", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: { code: "invalid_input", message: "Review the form.", issues: [{ field: "name", message: "Required" }] } }, 422)));

    await expect(apiRequest("/api/example")).rejects.toMatchObject({
      status: 422,
      code: "invalid_input",
      message: "Review the form.",
      issues: [{ field: "name", message: "Required" }],
    });
  });
});
