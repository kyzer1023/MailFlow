import { describe, expect, it } from "vitest";
import { parseAddressList, validateRecipientRows } from "./validation";

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

});
