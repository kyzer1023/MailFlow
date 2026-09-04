import { describe, expect, it } from "vitest";
import { attachmentObjectKey, attachmentObjectNamespace } from "./dependencies";

describe("deployment attachment namespace", () => {
  it("preserves the production object-key format when no namespace is configured", () => {
    expect(attachmentObjectKey(attachmentObjectNamespace(undefined), "set-1", "file-1"))
      .toBe("mailflow-set-1-file-1.bin");
  });

  it("embeds the staging namespace without changing the cleanup prefix", () => {
    const key = attachmentObjectKey(attachmentObjectNamespace("staging"), "set-1", "file-1");
    expect(key).toBe("mailflow-set-1-staging-file-1.bin");
    expect(key.startsWith("mailflow-set-1-")).toBe(true);
  });

  it("rejects unsafe namespace values", () => {
    expect(() => attachmentObjectNamespace("Staging/../production")).toThrow(
      "ATTACHMENT_OBJECT_NAMESPACE must be a lowercase alphanumeric label",
    );
  });
});
