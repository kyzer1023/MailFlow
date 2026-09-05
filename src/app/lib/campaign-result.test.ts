import { describe, expect, it } from "vitest";
import { completedResult } from "./campaign-result";

describe("completed campaign presentation", () => {
  it("shows unresolved receipt for historical completed campaigns", () => {
    expect(completedResult(1, 0, 0)).toEqual({ label: "Finished, receipt unverified", tone: "unknown" });
  });
  it("retains failures after every unknown receipt is verified", () => {
    expect(completedResult(1, 1, 0, 1).label).toBe("Finished with recipient failures");
  });
  it("distinguishes owner verification, skipped rows and processing completion", () => {
    expect(completedResult(1, 0, 0, 1).label).toBe("Finished, receipt verified");
    expect(completedResult(0, 0, 1).label).toBe("Finished with skipped rows");
    expect(completedResult(0, 0, 0).label).toBe("Processing finished");
  });
});
