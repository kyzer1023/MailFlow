import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildMessagePreviews, createCampaignPayload, representativeRows } from "./campaign";
import { mapSpreadsheetRows, mappingToRecipientConfiguration, mappingsForCurrentTable, recipientConfigurationToClientMapping } from "./mapping";
import { resultsToCsv } from "./results-export";
import { parseAndSelectSpreadsheet, parseCsvText, parseSpreadsheet, parseXlsx, selectSpreadsheetTable } from "./spreadsheet";
import { buildPreviewSrcDoc, escapeMergeValue, renderTemplate, replaceTextSelection, sanitizeTemplateHtml } from "./template";
import type { MappedRecipientRow, NormalizedRecipientRow, SpreadsheetTable } from "./types";
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

describe("template editor selections", () => {
  it("replaces highlighted copy with a dynamic field and leaves the cursor after it", () => {
    expect(replaceTextSelection("Hello friend, welcome", "{{first_name}}", 6, 12)).toEqual({
      value: "Hello {{first_name}}, welcome",
      cursor: 20,
    });
  });

  it("inserts a dynamic field at an empty caret", () => {
    expect(replaceTextSelection("Hello ", "{{first_name}}", 6, 6)).toEqual({
      value: "Hello {{first_name}}",
      cursor: 20,
    });
  });
});

describe("spreadsheet parsing and selection", () => {
  it("uses only the latest worksheet headers as dynamic fields", () => {
    const current = mappingsForCurrentTable(makeTable([
      { sourceRow: 1, values: ["Name", "Email"] },
      { sourceRow: 2, values: ["Ada", "ada@example.test"] },
    ]));
    expect(current).toEqual({ name: "name", email: "email" });
    expect(current).not.toHaveProperty("past_sheet_field");
  });

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

  it("detects a format from a file name and supports one-call selection", async () => {
    const table = await parseAndSelectSpreadsheet(new TextEncoder().encode("Email\na@example.com\n").buffer, {
      fileName: "members.csv",
      headerRow: 1,
    });
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
      separator: "auto",
    });
    expect(recipientConfigurationToClientMapping(configuration)).toEqual({
      toField: "email",
      cc: { kind: "fixed", value: "chair@example.com; secretary@example.com" },
      bcc: { kind: "column", field: "bcc" },
      replyTo: { kind: "fixed", value: "replies@example.com" },
      placeholders: { first_name: "name", "order.id": "order_id" },
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

  it("exports result rows with quoting and formula-injection protection", () => {
    const csv = resultsToCsv([
      {
        sourceRow: 2,
        recipient: "a@example.com",
        status: "accepted",
        attemptCount: 1,
        createdAt: "2026-08-31T00:00:00.000Z",
        acceptedAt: "2026-08-31T00:00:01.000Z",
        lastErrorMessage: "line 1, \"line 2\"",
      },
      {
        sourceRow: 3,
        recipient: "=HYPERLINK(\"https://bad\")",
        status: "failed",
        attemptCount: 1,
      },
    ]);
    expect(csv.split("\r\n")[0]).toBe("row_number,recipient,status,attempt_count,created_at,claimed_at,sending_at,accepted_at,last_error_category,last_error_message");
    expect(csv).toContain('"line 1, ""line 2"""');
    expect(csv).toContain("'=HYPERLINK");
  });
});
