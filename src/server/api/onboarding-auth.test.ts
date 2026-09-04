import { describe, expect, it, vi } from "vitest";
import type { AuthorizationStart } from "../auth/contracts";
import { beginOneDriveOnboarding, oneDriveOutcomeReturnTo } from "./onboarding-auth";

const started: AuthorizationStart = {
  authorizationUrl: "https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize?resource=onedrive",
  state: `onedrive.${"s".repeat(43)}`,
  codeVerifier: "v".repeat(43),
  nonce: "n".repeat(32),
  stateCookie: "mailflow_oauth_state=sealed",
};

describe("homepage OneDrive onboarding", () => {
  it("chains a fresh SMTP login into a separate SSO resource authorization", async () => {
    const beginSignIn = vi.fn(async () => started);
    const result = await beginOneDriveOnboarding({
      returnTo: "/dashboard?from=home",
      mailTransport: "smtp",
      attachmentsAvailable: true,
      storageAuth: { beginSignIn },
      alreadyAuthorized: async () => false,
    });

    expect(result).toBe(started);
    expect(beginSignIn).toHaveBeenCalledWith("/dashboard?from=home", "onedrive", { prompt: null });
  });

  it("skips the second leg for an existing grant, Graph mode, or missing storage configuration", async () => {
    const beginSignIn = vi.fn(async () => started);
    await expect(beginOneDriveOnboarding({
      returnTo: "/dashboard",
      mailTransport: "smtp",
      attachmentsAvailable: true,
      storageAuth: { beginSignIn },
      alreadyAuthorized: async () => true,
    })).resolves.toBeNull();
    await expect(beginOneDriveOnboarding({
      returnTo: "/dashboard",
      mailTransport: "graph",
      attachmentsAvailable: false,
      storageAuth: { beginSignIn },
      alreadyAuthorized: async () => false,
    })).resolves.toBeNull();
    await expect(beginOneDriveOnboarding({
      returnTo: "/dashboard",
      mailTransport: "smtp",
      attachmentsAvailable: true,
      storageAuth: null,
      alreadyAuthorized: async () => false,
    })).resolves.toBeNull();
    expect(beginSignIn).not.toHaveBeenCalled();
  });

  it("returns cancellation and failure status to local app routes without redirect loops", () => {
    expect(oneDriveOutcomeReturnTo("/campaigns?view=recent#latest", "cancelled")).toBe("/campaigns?view=recent&onedrive=cancelled#latest");
    expect(oneDriveOutcomeReturnTo("/auth/microsoft/callback", "failed")).toBe("/dashboard?onedrive=failed");
    expect(oneDriveOutcomeReturnTo("https://evil.example", "invalid")).toBe("/dashboard?onedrive=invalid");
  });
});
