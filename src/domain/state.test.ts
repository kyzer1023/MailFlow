import { describe, expect, it } from "vitest";
import { DomainError } from "./errors";
import { makeSendKey } from "./state";

describe("recipient send keys", () => {
  it("keeps retries stable and separates campaigns and source rows", () => {
    expect(makeSendKey(" campaign-1 ", 2)).toBe("campaign-1:2");
    expect(makeSendKey("campaign-1", 2)).toBe(makeSendKey(" campaign-1 ", 2));
    expect(new Set([
      makeSendKey("campaign-1", 2),
      makeSendKey("campaign-1", 3),
      makeSendKey("campaign-2", 2),
    ]).size).toBe(3);
  });

  it("rejects missing campaign identities and invalid source rows", () => {
    expect(() => makeSendKey("  ", 1)).toThrow(DomainError);
    for (const row of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => makeSendKey("campaign-1", row)).toThrow(DomainError);
    }
  });
});
