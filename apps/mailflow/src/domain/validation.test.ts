import { describe, expect, it } from "vitest";
import { parseAddressList, validateCampaign, validateRecipientRows } from "./validation";

describe("campaign validation contracts", () => {
  it("normalizes comma, semicolon, and newline address lists", () => {
    expect(parseAddressList(" A@example.com; b@example.com\nc@example.com ", "auto")).toEqual([
      "a@example.com",
      "b@example.com",
      "c@example.com",
    ]);
  });

  it("flags duplicate recipients and malformed metadata", () => {
    const result = validateRecipientRows([
      { sourceRow: 1, to: "one@example.com", cc: "copy@example.com" },
      { sourceRow: 2, to: "ONE@example.com", bcc: "not-an-address" },
    ]);
    expect(result.invalidRows).toEqual([2]);
    expect(result.duplicateRecipients).toEqual(["one@example.com"]);
    expect(result.issues.some((issue) => issue.code === "malformed_address")).toBe(true);
  });

  it("does not allow an invalid primary recipient to pass row validation", () => {
    const result = validateRecipientRows([{ sourceRow: 1, to: "not-an-email" }]);
    expect(result.validRows).toHaveLength(0);
    expect(result.invalidRows).toEqual([1]);
  });

  it("requires mappings and non-empty values before a campaign is valid", () => {
    const result = validateCampaign({
      senderAddress: "sender@example.com",
      subjectTemplate: "Welcome {{name}}",
      bodyHtml: "<p>{{name}}</p>",
      mappedFields: { name: "Full Name" },
      rows: [{ sourceRow: 1, to: "recipient@example.com", mergeData: { "Full Name": "" } }],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === "empty_required_value")).toBe(true);
  });
});
