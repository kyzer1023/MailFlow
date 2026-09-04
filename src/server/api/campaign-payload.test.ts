import { describe, expect, it } from "vitest";
import type { MailFlowContext } from "./context";
import { campaignCreateFingerprint, campaignReplayFingerprint } from "./campaign-create-control";
import { parseOrError, versionConfigFromInput } from "./helpers";
import { campaignCreateSchema } from "./schemas";

function campaignRequest() {
  const parsed = campaignCreateSchema.parse({
    flowId: "flow-1",
    templateVersionId: "template-1",
    attachmentSetId: null,
    sourceFilename: "recipients.csv",
    subjectTemplate: "Hello {{name}}",
    bodyHtml: "<p>Hello {{name}}</p>",
    placeholderManifest: ["name"],
    recipientConfiguration: {
      toField: "email",
      placeholderMappings: { name: "full_name", code: "member_code" },
      separator: "auto",
    },
    pacePerMinute: 12,
    totalRecipients: 2,
    validRecipients: 2,
    skippedRecipients: 0,
    rows: [
      {
        sourceRow: 3,
        to: "SECOND@example.test",
        cc: [],
        bcc: [],
        replyTo: [],
        mergeData: { code: "B", name: "Second" },
        renderedSubject: "Hello Second",
        renderedBodyHtml: "<p>Hello Second</p>",
      },
      {
        sourceRow: 2,
        to: " first@example.test ",
        cc: [],
        bcc: [],
        replyTo: [],
        mergeData: { name: "First", code: "A" },
        renderedSubject: "Hello First",
        renderedBodyHtml: "<p>Hello First</p>",
      },
    ],
    idempotencyKey: "campaign-request-1",
  });
  return parsed;
}

describe("campaign creation payload controls", () => {
  it("fingerprints the normalized effective snapshot independent of row and record order", async () => {
    const request = campaignRequest();
    const input = {
      request,
      subjectTemplate: request.subjectTemplate,
      bodyHtml: request.bodyHtml,
      recipientConfiguration: versionConfigFromInput(request.recipientConfiguration),
      sourceFilename: request.sourceFilename ?? null,
      pacePerMinute: request.pacePerMinute ?? 12,
    };
    const first = await campaignCreateFingerprint(input);
    const reordered = await campaignCreateFingerprint({
      ...input,
      request: {
        ...request,
        recipientConfiguration: {
          ...request.recipientConfiguration,
          placeholderMappings: { code: "member_code", name: "full_name" },
        },
        rows: [...request.rows].reverse().map((row) => ({ ...row, mergeData: Object.fromEntries(Object.entries(row.mergeData).reverse()) })),
      },
    });
    expect(first).toBe(reordered);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  it("changes the fingerprint when persisted message content changes", async () => {
    const request = campaignRequest();
    const input = {
      request,
      subjectTemplate: request.subjectTemplate,
      bodyHtml: request.bodyHtml,
      recipientConfiguration: versionConfigFromInput(request.recipientConfiguration),
      sourceFilename: request.sourceFilename ?? null,
      pacePerMinute: request.pacePerMinute ?? 12,
    };
    const first = await campaignCreateFingerprint(input);
    const changed = await campaignCreateFingerprint({
      ...input,
      request: {
        ...request,
        rows: request.rows.map((row, index) => index === 0 ? { ...row, renderedBodyHtml: "<p>Changed</p>" } : row),
      },
    });
    expect(changed).not.toBe(first);
    expect(campaignReplayFingerprint(first, first)).toBe("exact");
    expect(campaignReplayFingerprint(first, changed)).toBe("conflict");
    expect(campaignReplayFingerprint(null, changed)).toBe("legacy");
  });

  it("rejects a streamed JSON body before parsing past its configured byte limit", async () => {
    const request = new Request("https://mailflow.example.test/api/campaigns", {
      method: "POST",
      body: JSON.stringify({ value: "0123456789" }),
    });
    const context = {
      req: {
        raw: request,
        header: (name: string) => request.headers.get(name) ?? undefined,
      },
      json: (value: unknown, status: number) => Response.json(value, { status }),
    } as unknown as MailFlowContext;
    const response = await parseOrError(context, { safeParse: () => ({ success: true as const, data: {} }) }, {
      maxBytes: 8,
      tooLargeCode: "campaign_request_too_large",
      tooLargeMessage: "Campaign too large.",
    });
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(413);
    await expect((response as Response).json()).resolves.toEqual({
      error: { code: "campaign_request_too_large", message: "Campaign too large." },
    });
  });
});
