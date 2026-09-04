import { describe, expect, it } from "vitest";
import { OAuthProviderError } from "../microsoft/oauth";
import { RefreshTokenCryptoError } from "../microsoft/token-crypto";
import { AttachmentError } from "./contracts";
import { attachmentRetryDelaySeconds, classifyAttachmentLoadFailure } from "./failures";

describe("attachment load failure classification", () => {
  it.each([
    new AttachmentError("network_error", "private network text"),
    new AttachmentError("throttled", "private throttle text", { retryAfterSeconds: 75 }),
    new AttachmentError("service_unavailable", "private service text"),
    new OAuthProviderError("network", "private OAuth text", { retryable: true }),
  ])("keeps transient failures retryable", (error) => {
    expect(classifyAttachmentLoadFailure(error).disposition).toBe("retry");
  });

  it("requires a fresh OneDrive grant when stored authorization cannot be opened", () => {
    expect(classifyAttachmentLoadFailure(new RefreshTokenCryptoError("private cipher text"))).toEqual({
      disposition: "pause",
      category: "authorization",
      retryAfterSeconds: null,
      userMessage: "Reconnect OneDrive, then resume from the pending rows.",
    });
  });

  it.each([
    ["missing_object", "missing_object"],
    ["integrity_error", "integrity"],
    ["storage_error", "storage"],
  ] as const)("makes %s terminal with a sanitized category", (code, category) => {
    expect(classifyAttachmentLoadFailure(new AttachmentError(code, "private locator or checksum"))).toMatchObject({
      disposition: "fail",
      category,
    });
  });

  it("bounds exponential and provider-directed retry delays", () => {
    expect(attachmentRetryDelaySeconds(1, null)).toBe(30);
    expect(attachmentRetryDelaySeconds(2, null)).toBe(60);
    expect(attachmentRetryDelaySeconds(20, null)).toBe(900);
    expect(attachmentRetryDelaySeconds(1, 1_800)).toBe(1_800);
    expect(attachmentRetryDelaySeconds(1, 200_000)).toBe(86_400);
  });
});
