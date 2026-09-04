import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, apiRequestFormData, archiveFlow, createAttachmentSet, createCampaign, deleteAttachmentFile, pauseCampaign, sendCampaignTest, startCampaign, updateFlow, uploadAttachmentFile } from "./api";
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
      attachmentSetId: null,
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

  it("sends attachment metadata with the campaign and keeps the multipart boundary browser-owned", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes("/files")) return jsonResponse({ file: { id: "file_1", originalFilename: "agenda.pdf", mediaType: "application/pdf", byteSize: 12 } });
      return jsonResponse({ attachmentSet: { id: "set_1" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await createAttachmentSet("attachment-request-1", "csrf-attachment");
    const file = new File(["hello"], "agenda.pdf", { type: "application/pdf" });
    await uploadAttachmentFile("set_1", file, "csrf-attachment");
    await deleteAttachmentFile("set_1", "file_1", "csrf-attachment");

    const createOptions = fetchMock.mock.calls[0][1];
    expect(JSON.parse(String(createOptions?.body))).toEqual({ idempotencyKey: "attachment-request-1" });
    expect((createOptions?.headers as Headers).get("X-CSRF-Token")).toBe("csrf-attachment");
    const uploadOptions = fetchMock.mock.calls[1][1];
    expect(uploadOptions?.body).toBeInstanceOf(FormData);
    expect((uploadOptions?.headers as Headers).get("X-CSRF-Token")).toBe("csrf-attachment");
    expect((uploadOptions?.headers as Headers).get("Content-Type")).toBeNull();
    expect((uploadOptions?.body as FormData).get("file")).toBeInstanceOf(File);
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: "DELETE" });
  });

  it("supports the standalone multipart helper without a JSON content type", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const form = new FormData();
    form.append("file", new File(["data"], "note.txt", { type: "text/plain" }));
    await apiRequestFormData("/api/example", form, "csrf-form");
    expect((fetchMock.mock.calls[0][1]?.headers as Headers).get("Content-Type")).toBeNull();
    expect((fetchMock.mock.calls[0][1]?.headers as Headers).get("X-CSRF-Token")).toBe("csrf-form");
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
      idempotencyKey: "test-request-1",
      sourceRow: 2,
      subject: "Hello",
      bodyHtml: "<p>Hello</p>",
      cc: ["copy@example.test"],
      bcc: ["audit@example.test"],
      replyTo: ["replies@example.test"],
      importance: "high",
    }, "csrf-3");

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      idempotencyKey: "test-request-1",
      sourceRow: 2,
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
