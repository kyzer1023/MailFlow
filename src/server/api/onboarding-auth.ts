import type { AuthorizationStart } from "../auth/contracts";
import { safeReturnTo } from "../auth/oauth-state";
import type { MicrosoftAuthService } from "../auth/service";
import type { MailTransport } from "../microsoft";

export type OneDriveOnboardingStatus = "connected" | "cancelled" | "failed" | "identity_mismatch" | "invalid" | "unavailable";

export interface OneDriveOnboardingInput {
  readonly returnTo: string;
  readonly mailTransport: MailTransport;
  readonly attachmentsAvailable: boolean;
  readonly storageAuth: Pick<MicrosoftAuthService, "beginSignIn"> | null;
  readonly alreadyAuthorized: () => Promise<boolean>;
}

/** Begin the resource-specific second OAuth leg only when attachments need it. */
export async function beginOneDriveOnboarding(input: OneDriveOnboardingInput): Promise<AuthorizationStart | null> {
  if (input.mailTransport !== "smtp" || !input.attachmentsAvailable || !input.storageAuth) return null;
  if (await input.alreadyAuthorized()) return null;
  return input.storageAuth.beginSignIn(safeReturnTo(input.returnTo), "onedrive", { prompt: null });
}

/** Attach a non-looping status to a validated local app destination. */
export function oneDriveOutcomeReturnTo(returnTo: string | undefined, status: OneDriveOnboardingStatus): string {
  const safe = safeReturnTo(returnTo);
  const target = new URL(safe, "https://mailflow.invalid");
  target.searchParams.set("onedrive", status);
  return `${target.pathname}${target.search}${target.hash}`;
}
