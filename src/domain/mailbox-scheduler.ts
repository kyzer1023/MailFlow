import { MAX_QUEUE_DELAY_SECONDS } from "./pacing";

export const MAILBOX_RECIPIENT_BUDGET = 8_000;
export const MAILBOX_BUDGET_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const MAILBOX_LEASE_MS = 5 * 60 * 1_000;
export const MAILBOX_RECOVERY_STALE_MS = 10 * 60 * 1_000;

/**
 * Count every provider envelope entry. Repeated addresses deliberately count
 * again so MailFlow never underestimates the mailbox-wide provider request.
 */
export function envelopeRecipientCount(input: {
  readonly to: string;
  readonly cc?: readonly string[];
  readonly bcc?: readonly string[];
}): number {
  return (input.to.trim() ? 1 : 0) + (input.cc?.length ?? 0) + (input.bcc?.length ?? 0);
}

export function laterIso(...values: readonly (string | null | undefined)[]): string | null {
  let latest: string | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const time = Date.parse(value);
    if (!Number.isFinite(time)) continue;
    if (time > latestTime) {
      latest = new Date(time).toISOString();
      latestTime = time;
    }
  }
  return latest;
}

export function queueDelayUntil(dueAt: string, now: Date): number {
  const due = Date.parse(dueAt);
  if (!Number.isFinite(due)) return 0;
  return Math.min(MAX_QUEUE_DELAY_SECONDS, Math.max(0, Math.ceil((due - now.getTime()) / 1_000)));
}

export function mailboxWaitMessage(reason: "lease" | "pace" | "provider_backoff" | "budget", nextAt: string): string {
  switch (reason) {
    case "budget":
      return `The daily mailbox allowance is temporarily full. Sending will continue after ${nextAt}.`;
    case "provider_backoff":
      return `Microsoft requested a temporary pause. Sending will continue after ${nextAt}.`;
    case "lease":
      return `Another message is using this mailbox. Sending will continue after ${nextAt}.`;
    case "pace":
    default:
      return `Mailbox pacing is active. Sending will continue after ${nextAt}.`;
  }
}
