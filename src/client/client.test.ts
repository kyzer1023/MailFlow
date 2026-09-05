import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildMessagePreviews, createCampaignPayload, formatAttachmentSize, representativeRows, validateAttachmentSelection } from "./campaign";
import { mapSpreadsheetRows, mappingToRecipientConfiguration, recipientConfigurationToClientMapping } from "./mapping";
import { parseCsvText, parseSpreadsheet, parseXlsx, selectSpreadsheetTable } from "./spreadsheet";
import { buildPreviewSrcDoc, escapeMergeValue, renderTemplate, sanitizeTemplateHtml } from "./template";
import type { MappedRecipientRow, NormalizedRecipientRow, SpreadsheetTable } from "./types";
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_FILES } from "./types";
import { extractPlaceholders, parseEmailList, validateClientCampaign, validateMappedRecipientRows } from "./validation";

function makeTable(rows: readonly { sourceRow: number; values: readonly string[] }[]): SpreadsheetTable {
  const workbook = {
    format: "csv" as const,
    fileName: "recipients.csv",
    worksheets: [{ index: 0, name: "Sheet1", visibility: "visible" as const, rows }],
  };
  return selectSpreadsheetTable(workbook, { headerRow: 1 });
}

function mappedRow(sourceRow: number, to: string, name: string): MappedRecipientRow {
  return { sourceRow, to, cc: "", bcc: "", replyTo: "", mergeData: { first_name: name } };
}

describe("spreadsheet parsing and selection", () => {
  it("parses quoted CSV fields, escaped quotes, and embedded newlines", () => {
    const rows = parseCsvText('Name,Email,Note\r\n"Ada, Lovelace",ada@example.com,"line 1\nline 2"\r\n"She said ""hello""",b@example.com,ok\r\n');
    expect(rows).toEqual([
      { sourceRow: 1, values: ["Name", "Email", "Note"] },
      { sourceRow: 2, values: ["Ada, Lovelace", "ada@example.com", "line 1\nline 2"] },
      { sourceRow: 3, values: ['She said "hello"', "b@example.com", "ok"] },
    ]);
  });

  it("normalizes headers, preserves labels, and suffixes collisions", () => {
    const table = makeTable([
      { sourceRow: 1, values: ["Full Name", "full-name", "Émail", ""] },
      { sourceRow: 2, values: ["Ada", "Alias", "ada@example.com", "x"] },
    ]);
    expect(table.columns.map((column) => [column.key, column.label])).toEqual([
      ["full_name", "Full Name"],
      ["full_name_2", "full-name"],
      ["email", "Émail"],
      ["column_4", ""],
    ]);
    expect(table.rows[0].values).toEqual({ full_name: "Ada", full_name_2: "Alias", email: "ada@example.com", column_4: "x" });

    const collision = makeTable([
      { sourceRow: 1, values: ["A", "A", "A_2"] },
      { sourceRow: 2, values: ["1", "2", "3"] },
    ]);
    expect(collision.columns.map((column) => column.key)).toEqual(["a", "a_2", "a_2_2"]);
  });

  it("selects a later header row after a title and retains source row numbers", () => {
    const workbook = {
      format: "csv" as const,
      fileName: "list.csv",
      worksheets: [{
        index: 0,
        name: "Sheet1",
        visibility: "visible" as const,
        rows: [
          { sourceRow: 1, values: ["Society members"] },
          { sourceRow: 3, values: ["Name", "Email"] },
          { sourceRow: 4, values: ["Ada", "ada@example.com"] },
        ],
      }],
    };
    const table = selectSpreadsheetTable(workbook);
    expect(table.headerRow).toBe(3);
    expect(table.rows[0].sourceRow).toBe(4);
    expect(table.rows[0].values).toEqual({ name: "Ada", email: "ada@example.com" });
  });

  it("round-trips a browser-style XLSX ArrayBuffer through ExcelJS", async () => {
    const workbook = new ExcelJS.Workbook();
    const first = workbook.addWorksheet("Members");
    first.addRow(["Name", "Email"]);
    first.addRow(["Ada", "ada@example.com"]);
    const hidden = workbook.addWorksheet("Hidden");
    hidden.state = "hidden";
    hidden.addRow(["Ignore", "ignore@example.com"]);
    const buffer = await workbook.xlsx.writeBuffer();
    const parsed = await parseXlsx(buffer as unknown as ArrayBuffer, "members.xlsx");
    expect(parsed.format).toBe("xlsx");
    expect(parsed.worksheets).toHaveLength(2);
    expect(parsed.worksheets[1].visibility).toBe("hidden");
    const table = selectSpreadsheetTable(parsed, { worksheet: "Members", headerRow: 1 });
    expect(table.rows[0].values).toEqual({ name: "Ada", email: "ada@example.com" });
  });

  it("detects a format from the filename before worksheet selection", async () => {
    const workbook = await parseSpreadsheet(new TextEncoder().encode("Email\na@example.com\n").buffer, {
      fileName: "members.csv",
    });
    expect(workbook.format).toBe("csv");
    const table = selectSpreadsheetTable(workbook, { headerRow: 1 });
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].values.email).toBe("a@example.com");
    await expect(parseSpreadsheet("not xlsx", { format: "xlsx" })).rejects.toMatchObject({ code: "unsupported_format" });
  });
});

describe("mapping and validation", () => {
  const table = makeTable([
    { sourceRow: 1, values: ["Email", "Name", "CC"] },
    { sourceRow: 2, values: ["Ada@Example.com", "Ada", "one@example.com;two@example.com"] },
    { sourceRow: 3, values: ["ada@example.com", "", "bad"] },
  ]);

  it("maps row values and supports fixed and column address sources", () => {
    const result = mapSpreadsheetRows(table, {
      toField: "email",
      cc: { kind: "column", field: "cc" },
      bcc: { kind: "fixed", value: "audit@example.com" },
      replyTo: null,
      separator: "semicolon",
      placeholders: { name: "name" },
    });
    expect(result.issues).toEqual([]);
    expect(result.rows[0]).toMatchObject({ to: "Ada@Example.com", cc: "one@example.com;two@example.com", bcc: "audit@example.com" });
    expect(mappingToRecipientConfiguration({ toField: "email", cc: { kind: "column", field: "cc" }, bcc: { kind: "fixed", value: "audit@example.com" }, separator: "semicolon" })).toEqual({
      toField: "email",
      ccField: "cc",
      bccField: null,
      replyToField: null,
      ccFixed: null,
      bccFixed: "audit@example.com",
      replyToFixed: null,
      placeholderMappings: {},
      importance: "normal",
      separator: "semicolon",
    });
  });

  it("persists fixed and mapped address sources with placeholder mappings", () => {
    const configuration = mappingToRecipientConfiguration({
      toField: " email ",
      cc: { kind: "fixed", value: "  chair@example.com; secretary@example.com  " },
      bcc: { kind: "column", field: " bcc " },
      replyTo: { kind: "fixed", value: " replies@example.com " },
      placeholders: { first_name: " name ", " order.id ": " order_id " },
      importance: "high",
      separator: "auto",
    });
    expect(configuration).toEqual({
      toField: "email",
      ccField: null,
      bccField: "bcc",
      replyToField: null,
      ccFixed: "chair@example.com; secretary@example.com",
      bccFixed: null,
      replyToFixed: "replies@example.com",
      placeholderMappings: { first_name: "name", "order.id": "order_id" },
      importance: "high",
      separator: "auto",
    });
    expect(recipientConfigurationToClientMapping(configuration)).toEqual({
      toField: "email",
      cc: { kind: "fixed", value: "chair@example.com; secretary@example.com" },
      bcc: { kind: "column", field: "bcc" },
      replyTo: { kind: "fixed", value: "replies@example.com" },
      placeholders: { first_name: "name", "order.id": "order_id" },
      importance: "high",
      separator: "auto",
    });
  });

  it("hydrates legacy configurations without fixed values or placeholder mappings", () => {
    expect(recipientConfigurationToClientMapping({
      toField: "email",
      ccField: "cc",
      bccField: null,
      replyToField: "reply_to",
      separator: "semicolon",
    })).toEqual({
      toField: "email",
      cc: { kind: "column", field: "cc" },
      bcc: null,
      replyTo: { kind: "column", field: "reply_to" },
      placeholders: {},
      importance: "normal",
      separator: "semicolon",
    });
  });

  it("does not resurrect a legacy mapped field after an address source is cleared", () => {
    expect(mappingToRecipientConfiguration({
      toField: "email",
      cc: null,
      // This alias can be present when a mapping was hydrated by an older
      // client. An explicit null source is the user's current choice.
      ccField: "previous_cc_column",
      bcc: null,
      replyTo: null,
      separator: "auto",
    })).toMatchObject({
      ccField: null,
      ccFixed: null,
    });
  });

  it("keeps a cleared fixed value cleared after reopening a saved template", () => {
    const reopened = recipientConfigurationToClientMapping({
      toField: "email",
      ccField: null,
      bccField: null,
      replyToField: null,
      ccFixed: "previous@example.test",
      separator: "auto",
    });
    const cleared = mappingToRecipientConfiguration({ ...reopened, cc: { kind: "fixed", value: "" } });
    expect(cleared.ccField).toBeNull();
    expect(cleared.ccFixed).toBeNull();
  });

  it("flags missing mapped columns before row validation", () => {
    const result = mapSpreadsheetRows(table, { toField: "missing", placeholders: { name: "also_missing" } });
    expect(result.issues.map((issue) => issue.code)).toEqual(["missing_column", "missing_column"]);
    expect(result.rows[0].to).toBe("");
  });

  it("handles comma, semicolon, newline, and automatic address separators", () => {
    expect(parseEmailList("a@example.com; b@example.com", "semicolon").addresses).toEqual(["a@example.com", "b@example.com"]);
    expect(parseEmailList("a@example.com\nb@example.com", "newline").addresses).toEqual(["a@example.com", "b@example.com"]);
    expect(parseEmailList("a@example.com, b@example.com; c@example.com", "auto").addresses).toHaveLength(3);
    expect(parseEmailList("not-an-email", "auto").invalidParts).toEqual(["not-an-email"]);
  });

  it("detects malformed rows, later duplicate recipients, and invalid metadata", () => {
    const mapped = [
      mappedRow(2, "A@example.com", "Ada"),
      { ...mappedRow(3, "a@example.com", "Grace"), cc: "not-an-email" },
      mappedRow(4, "", ""),
    ];
    const result = validateMappedRecipientRows(mapped, "auto");
    expect(result.duplicateRecipients).toEqual(["a@example.com"]);
    expect(result.invalidRows).toEqual([3, 4]);
    expect(result.validRows).toHaveLength(1);
    expect(result.issues.map((issue) => issue.code)).toEqual(["malformed_address", "duplicate_recipient", "missing_recipient"]);
  });

  it("extracts placeholders, sanitizes HTML, and enforces mappings, values, and limits", () => {
    expect(extractPlaceholders("Hi {{ first_name }}", "<p>{{first_name}} {{order.id}}</p>")).toEqual(["first_name", "order.id"]);
    const mapped = [mappedRow(2, "a@example.com", "Ada")];
    const invalid = validateClientCampaign({
      senderAddress: "sender@example.com",
      subjectTemplate: "Hi {{first_name}}",
      bodyHtml: '<p onclick="alert(1)">{{first_name}}<script>alert(1)</script></p>',
      rows: mapped,
      mappedFields: { first_name: "first_name" },
      maxRecipients: 1,
      pacePerMinute: 12,
    });
    expect(invalid.ok).toBe(true);
    expect(invalid.issues).toEqual([]);
    expect(invalid.sanitizedBodyHtml).not.toContain("script");
    expect(invalid.sanitizedBodyHtml).not.toContain("onclick");

    const cleanRows = [1, 2, 3, 4, 5].map((row) => mappedRow(row + 1, `person${row}@example.com`, `Person ${row}`));
    const cleanMultiline = validateClientCampaign({
      senderAddress: "sender@example.com",
      subjectTemplate: "Hello",
      // Saved or hand-authored templates may still contain the equivalent
      // self-closing form; it must not become a false unsafe-html issue.
      bodyHtml: "<p>Hello</p><br /><p>Thank you.</p>",
      rows: cleanRows,
    });
    expect(cleanMultiline.ok).toBe(true);
    expect(cleanMultiline.issues).toEqual([]);
    expect(cleanMultiline.sanitizedBodyHtml).toBe("<p>Hello</p><br><p>Thank you.</p>");

    const missingValue = validateClientCampaign({
      senderAddress: "sender@example.com",
      subjectTemplate: "Hi {{first_name}}",
      bodyHtml: "<p>{{first_name}}</p>",
      rows: [mappedRow(2, "a@example.com", "")],
      mappedFields: { first_name: "first_name" },
    });
    expect(missingValue.invalidRows).toEqual([2]);
    expect(missingValue.issues.some((issue) => issue.code === "empty_required_value")).toBe(true);

    const overLimit = validateClientCampaign({
      senderAddress: "sender@example.com",
      subjectTemplate: "Hi",
      bodyHtml: "<p>Hello</p>",
      rows: [mappedRow(2, "a@example.com", "A"), mappedRow(3, "b@example.com", "B")],
      maxRecipients: 1,
    });
    expect(overLimit.issues.some((issue) => issue.code === "campaign_too_large")).toBe(true);
  });
});

describe("safe template rendering and representative previews", () => {
  it("escapes merge values and strips active content and dangerous URLs", () => {
    const rendered = renderTemplate(
      "Hello {{name}}",
      '<p>{{name}}</p><a href="javascript:alert(1)">bad</a><img src="https://example.com/a" onerror="alert(1)">',
      { name: '<img src=x onerror="alert(1)">' },
    );
    expect(rendered.subject).toContain('<img src=x onerror="alert(1)">');
    expect(rendered.bodyHtml).toContain("&lt;img");
    expect(rendered.bodyHtml).not.toContain("javascript:");
    expect(rendered.bodyHtml).not.toContain("<img src=x onerror");
    expect(escapeMergeValue("<&\"' >")).toBe("&lt;&amp;&quot;&#39; &gt;");
    expect(sanitizeTemplateHtml("<svg><script>alert(1)</script></svg>")).toBe("");
  });

  it("preserves email-safe table formatting and cleans preview-only CSS hazards", () => {
    const safe = sanitizeTemplateHtml('<table width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse"><tr><td style="border:1px solid #d9d9d9;background-color:#f5f6f7;padding:12px"><mark>Judge</mark></td></tr></table>');
    expect(safe).toContain("<table");
    expect(safe).toContain("border:1px solid #d9d9d9");
    expect(safe).toContain("padding:12px");
    expect(safe).toContain("<mark>Judge</mark>");
    expect(safe).toContain("background-color:#f5f6f7");
    expect(buildPreviewSrcDoc(safe)).toContain("border:1px solid #d9d9d9");

    const legacyTable = sanitizeTemplateHtml('<table border="1" cellspacing="0" cellpadding="12" style="border-collapse:collapse;width:80%"><tr><td style="padding-top:14px">Label</td><td>Value</td></tr></table>');
    expect(legacyTable).toContain("border: 1px solid");
    expect(legacyTable).toContain("border-spacing: 0px");
    const legacyContainer = document.createElement("div");
    legacyContainer.innerHTML = legacyTable;
    const firstLegacyCell = legacyContainer.querySelector<HTMLTableCellElement>("td");
    expect(firstLegacyCell?.style.paddingTop).toBe("14px");
    expect(firstLegacyCell?.style.paddingRight).toBe("12px");
    expect(firstLegacyCell?.style.paddingBottom).toBe("12px");
    expect(firstLegacyCell?.style.paddingLeft).toBe("12px");
    expect(buildPreviewSrcDoc(legacyTable)).toContain("border: 1px solid");

    const unsafeCss = sanitizeTemplateHtml('<td style="background:url(https://private.example/image.png);padding:12px">Cell</td>');
    expect(unsafeCss).not.toContain("style=");
    expect(unsafeCss).not.toContain("private.example");
  });

  it("returns first, middle, and last previews and an isolated srcDoc", () => {
    const rows: NormalizedRecipientRow[] = [1, 2, 3, 4, 5].map((number) => ({
      sourceRow: number + 1,
      to: `person${number}@example.com`,
      cc: [],
      bcc: [],
      replyTo: [],
      mergeData: { first_name: `Person ${number}` },
    }));
    expect(representativeRows(rows).map((item) => item.position)).toEqual(["first", "middle", "last"]);
    const previews = buildMessagePreviews({ senderAddress: "sender@example.com", subjectTemplate: "Hi {{first_name}}", bodyHtml: "<p>{{first_name}}</p>", rows, fieldMappings: { first_name: "first_name" } });
    expect(previews.map((preview) => preview.sourceRow)).toEqual([2, 4, 6]);
    expect(previews[1].subject).toBe("Hi Person 3");
    expect(buildPreviewSrcDoc("<p>Hi</p>")).toContain("Content-Security-Policy");
  });
});

describe("campaign payload and result export", () => {
  it("builds a server-owned-sender campaign payload only after validation", () => {
    const rows = [mappedRow(2, "a@example.com", "Ada")];
    const validation = validateClientCampaign({
      senderAddress: "sender@example.com",
      subjectTemplate: "Hi {{first_name}}",
      bodyHtml: "<p>{{first_name}}</p>",
      rows,
      mappedFields: { first_name: "first_name" },
    });
    const payload = createCampaignPayload({
      idempotencyKey: "campaign-request-1",
      flowId: "flow-1",
      templateVersionId: "version-1",
      sourceFilename: "members.csv",
      subjectTemplate: "Hi {{first_name}}",
      bodyHtml: "<p>{{first_name}}</p>",
      mapping: { toField: "email", placeholders: { first_name: "first_name" } },
      pacePerMinute: 12,
      rows,
      validation,
    });
    expect(payload).not.toHaveProperty("senderAddress");
    expect(payload.attachmentSetId).toBeNull();
    expect(payload.idempotencyKey).toBe("campaign-request-1");
    expect(payload.rows[0]).toMatchObject({ to: "a@example.com", renderedSubject: "Hi Ada", renderedBodyHtml: "<p>Ada</p>" });
    expect(payload.validRecipients).toBe(1);
    expect(() => createCampaignPayload({
      idempotencyKey: "campaign-request-2",
      flowId: "flow-1",
      subjectTemplate: "Hi {{first_name}}",
      bodyHtml: "<p>{{first_name}}</p>",
      mapping: { toField: "email", placeholders: { first_name: "first_name" } },
      pacePerMinute: 12,
      rows,
      validation: { ...validation, ok: false, issues: [{ code: "blocked", message: "blocked" }] },
    })).toThrow();
  });

  it("validates supported campaign attachment types, empty files, and duplicates", () => {
    const pdf = new File(["pdf"], "agenda.pdf", { type: "application/pdf" });
    const empty = new File([], "empty.txt", { type: "text/plain" });
    const unsupported = new File(["binary"], "run.exe", { type: "application/octet-stream" });
    const result = validateAttachmentSelection([pdf, empty, unsupported, new File(["same"], "agenda.pdf", { type: "application/pdf" })]);
    expect(result.accepted).toEqual([pdf]);
    expect(result.rejected.map((item) => item.code)).toEqual(["empty", "unsupported", "duplicate"]);
  });

  it("enforces five files and a two MiB combined raw limit", () => {
    const existing = Array.from({ length: ATTACHMENT_MAX_FILES - 1 }, (_, index) => ({
      id: `file-${index}`,
      name: `file-${index}.txt`,
      mediaType: "text/plain",
      byteSize: 1,
      status: "ready" as const,
    }));
    const last = new File(["last"], "last.txt", { type: "text/plain" });
    const tooMany = new File(["extra"], "extra.txt", { type: "text/plain" });
    const countResult = validateAttachmentSelection([last, tooMany], existing);
    expect(countResult.accepted).toEqual([last]);
    expect(countResult.rejected[0].code).toBe("too_many");

    const almostFull = [{ ...existing[0], byteSize: ATTACHMENT_MAX_BYTES - 2 }];
    const tooLarge = new File(["123"], "too-large.txt", { type: "text/plain" });
    expect(validateAttachmentSelection([tooLarge], almostFull).rejected[0].code).toBe("too_large");
    expect(formatAttachmentSize(ATTACHMENT_MAX_BYTES)).toBe("20 MB");
  });

  it("serializes only an opaque attachment set ID and never a browser File", () => {
    const row = mappedRow(2, "a@example.com", "Ada");
    const validation = validateClientCampaign({ senderAddress: "sender@example.com", subjectTemplate: "Hello", bodyHtml: "<p>Hello</p>", rows: [row] });
    const payload = createCampaignPayload({
      idempotencyKey: "campaign-with-attachments",
      attachmentSetId: "set-1",
      flowId: "flow-1",
      subjectTemplate: "Hello",
      bodyHtml: "<p>Hello</p>",
      mapping: { toField: "email" },
      pacePerMinute: 12,
      rows: [row],
      validation,
    });
    expect(payload.attachmentSetId).toBe("set-1");
    expect(Object.values(payload).some((value) => value instanceof File)).toBe(false);
    expect(payload).not.toHaveProperty("attachments");
  });

});
