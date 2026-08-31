import { describe, expect, it } from "vitest";
import { isCampaignTickMessage } from "./contracts";
import { safeSourceFilename, validateTemplateHtml, validateTemplateSubject } from "./security";
import { campaignCreateSchema, recipientConfigurationSchema, testSendSchema } from "./schemas";

describe("Worker API security boundaries", () => {
  it("rejects active HTML and accepts a simple email template", () => {
    expect(validateTemplateHtml("<p>Hello {{name}}</p>")).toEqual({ ok: true, html: "<p>Hello {{name}}</p>" });
    expect(validateTemplateHtml('<p onclick="alert(1)">Hello</p>')).toMatchObject({ ok: false });
    expect(validateTemplateHtml('<a href="javascript:alert(1)">Open</a>')).toMatchObject({ ok: false });
    expect(validateTemplateHtml('<a href="java&#x73;cript:alert(1)">Open</a>')).toMatchObject({ ok: false });
    expect(validateTemplateHtml('<a href="java&#x000000000073;cript&#x00000000003a;alert(1)">Open</a>')).toMatchObject({ ok: false });
    expect(validateTemplateHtml('<a href="java&amp;#x73;cript:alert(1)">Open</a>')).toMatchObject({ ok: false });
    expect(validateTemplateHtml('<a href="java&Tab;script&colon;alert(1)">Open</a>')).toMatchObject({ ok: false });
    expect(validateTemplateHtml('<a href="&sol;&sol;evil.example/path">Open</a>')).toMatchObject({ ok: false });
    expect(validateTemplateHtml('<div style="background:url(java&#x73;cript:alert(1))">Open</div>')).toMatchObject({ ok: false });
    expect(validateTemplateHtml('<div style="background:url(java&#x000000000073;cript&#x00000000003a;alert(1))">Open</div>')).toMatchObject({ ok: false });
    expect(validateTemplateHtml('<div style="background:url&lpar;javascript&colon;alert(1)&rpar;">Open</div>')).toMatchObject({ ok: false });
    expect(validateTemplateHtml('<div style="background:url&lpar;&sol;&sol;evil.example/path&rpar;">Open</div>')).toMatchObject({ ok: false });
    expect(validateTemplateHtml('<div style="background:u\\72l(//evil.example/path)">Open</div>')).toMatchObject({ ok: false });
    expect(validateTemplateHtml("<script>alert(1)</script>")).toMatchObject({ ok: false });
  });

  it("keeps subjects header-safe and strips upload paths", () => {
    expect(validateTemplateSubject("  Welcome {{name}}  ")).toEqual({ ok: true, subject: "Welcome {{name}}" });
    expect(validateTemplateSubject("forged\r\nBcc: attacker@example.test")).toMatchObject({ ok: false });
    expect(safeSourceFilename("C:\\Users\\member\\invitees.xlsx")).toBe("invitees.xlsx");
    expect(safeSourceFilename("../../invitees.xlsx")).toBe("invitees.xlsx");
  });

  it("validates queue messages at runtime before campaignId is used", () => {
    expect(isCampaignTickMessage({ type: "campaign.tick", campaignId: "campaign_123" })).toBe(true);
    expect(isCampaignTickMessage({ type: "campaign.tick", campaignId: "" })).toBe(false);
    expect(isCampaignTickMessage({ type: "campaign.tick", campaignId: 123 })).toBe(false);
    expect(isCampaignTickMessage(null)).toBe(false);
  });

  it("rejects extra campaign fields and unsafe recipient totals", () => {
    const result = campaignCreateSchema.safeParse({
      flowId: "flow_1",
      subjectTemplate: "Subject",
      bodyHtml: "<p>Hello</p>",
      placeholderManifest: [],
      recipientConfiguration: { toField: "email", ccField: null, bccField: null, replyToField: null, separator: "auto" },
      pacePerMinute: 12,
      totalRecipients: 1,
      validRecipients: 1,
      skippedRecipients: 0,
      rows: [{ sourceRow: 2, to: "member@example.test", cc: [], bcc: [], replyTo: [], mergeData: {}, renderedSubject: "Subject", renderedBodyHtml: "<p>Hello</p>" }],
      idempotencyKey: "campaign-request-1",
      unexpected: true,
    });
    expect(result.success).toBe(false);
  });

  it("defaults optional recipient settings while preserving fixed and mapped values", () => {
    const legacy = recipientConfigurationSchema.safeParse({ toField: "email" });
    expect(legacy.success).toBe(true);
    if (legacy.success) {
      expect(legacy.data).toMatchObject({
        toField: "email",
        ccField: null,
        bccField: null,
        replyToField: null,
        ccFixed: null,
        bccFixed: null,
        replyToFixed: null,
        placeholderMappings: {},
        separator: "auto",
      });
    }

    const current = recipientConfigurationSchema.safeParse({
      toField: " email ",
      ccFixed: " audit@example.test ",
      bccField: " bcc ",
      replyToFixed: " replies@example.test ",
      placeholderMappings: { first_name: " full_name " },
      separator: "semicolon",
    });
    expect(current.success).toBe(true);
    if (current.success) {
      expect(current.data).toMatchObject({
        toField: "email",
        ccFixed: "audit@example.test",
        bccField: "bcc",
        replyToFixed: "replies@example.test",
        placeholderMappings: { first_name: "full_name" },
        separator: "semicolon",
      });
      expect(current.data).not.toHaveProperty("unexpected");
    }

    expect(recipientConfigurationSchema.safeParse({ toField: "email", unknownSetting: true }).success).toBe(false);
  });

  it("requires a stable idempotency key for campaign creation", () => {
    const result = campaignCreateSchema.safeParse({
      flowId: "flow_1",
      subjectTemplate: "Subject",
      bodyHtml: "<p>Hello</p>",
      placeholderManifest: [],
      recipientConfiguration: { toField: "email", ccField: null, bccField: null, replyToField: null, separator: "auto" },
      totalRecipients: 1,
      validRecipients: 1,
      skippedRecipients: 0,
      rows: [{ sourceRow: 2, to: "member@example.test", cc: [], bcc: [], replyTo: [], mergeData: {}, renderedSubject: "Subject", renderedBodyHtml: "<p>Hello</p>" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts bounded recipient metadata for test sends", () => {
    const result = testSendSchema.safeParse({
      subject: "Subject",
      bodyHtml: "<p>Hello</p>",
      cc: ["copy@example.test"],
      bcc: ["audit@example.test"],
      replyTo: ["replies@example.test"],
      importance: "high",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cc).toEqual(["copy@example.test"]);
      expect(result.data.bcc).toEqual(["audit@example.test"]);
      expect(result.data.replyTo).toEqual(["replies@example.test"]);
    }
  });
});
