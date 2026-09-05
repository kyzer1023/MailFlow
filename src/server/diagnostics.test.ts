import { describe, expect, it } from "vitest";
import {
  apiDiagnosticRoute,
  diagnosticMetadata,
  safeErrorKind,
} from "./diagnostics";

describe("diagnostic allowlists", () => {
  it("does not reflect paths, arbitrary error names, codes, or coordination tokens", () => {
    expect(
      apiDiagnosticRoute(
        "/api/campaigns/private@example.test/jobs/private/delivery-verification",
      ),
    ).toBe("delivery_verification");
    expect(apiDiagnosticRoute("/private-secret")).toBe("other");
    expect(
      safeErrorKind(
        Object.assign(new Error("private"), {
          name: "private",
          code: "private",
        }),
      ),
    ).toBe("error");
    expect(
      safeErrorKind(
        new Error(
          "D1_ERROR: UNIQUE constraint failed: private_table.private_value",
        ),
      ),
    ).toBe("database_constraint");
    expect(
      safeErrorKind(new Error("D1_ERROR: database overloaded private-query")),
    ).toBe("database_unavailable");
    for (const id of [
      "attempt_private",
      "wake_private",
      "private@example.test",
      { token: "private" },
      null,
    ])
      expect(diagnosticMetadata(id)).toEqual({});
    expect(diagnosticMetadata("12345678-1234-4123-8123-123456789abc")).toEqual({
      diagnosticId: "12345678-1234-4123-8123-123456789abc",
    });
  });
});
