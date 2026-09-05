import { DomainError } from "./errors";
import type {
  CampaignRecord,
  CampaignState,
  RecipientJobRecord,
  RecipientStatus,
} from "./types";

/**
 * A campaign can only move through an explicit lifecycle. Keeping this map in
 * the domain makes it usable by both the HTTP API and the D1 adapter tests.
 */
export const CAMPAIGN_TRANSITIONS: Readonly<Record<CampaignState, readonly CampaignState[]>> = {
  draft: ["validated"],
  validated: ["queued"],
  queued: ["running", "paused", "failed", "cancelling", "cancelled"],
  running: ["paused", "completed", "failed", "cancelling", "cancelled"],
  paused: ["queued", "failed", "cancelling", "cancelled"],
  completed: [],
  failed: [],
  cancelling: ["cancelled"],
  cancelled: [],
};

export const RECIPIENT_TRANSITIONS: Readonly<Record<RecipientStatus, readonly RecipientStatus[]>> = {
  pending: ["claimed", "skipped"],
  claimed: ["sending"],
  sending: ["accepted", "failed", "unknown"],
  accepted: [],
  // Failed rows are terminal in the automatic lifecycle. A pre-send retry is
  // performed atomically from `sending` through `retryRecipientSafely`, and
  // there is intentionally no generic failed -> pending edge that could
  // trigger a blind resend.
  failed: [],
  skipped: [],
  unknown: [],
};

export function isCampaignTransitionAllowed(from: CampaignState, to: CampaignState): boolean {
  return CAMPAIGN_TRANSITIONS[from].includes(to);
}

export function isRecipientTransitionAllowed(from: RecipientStatus, to: RecipientStatus): boolean {
  return RECIPIENT_TRANSITIONS[from].includes(to);
}

export function assertCampaignTransition(from: CampaignState, to: CampaignState): void {
  if (!isCampaignTransitionAllowed(from, to)) {
    throw new DomainError("invalid_transition", `Campaign cannot transition from ${from} to ${to}.`);
  }
}

export function assertRecipientTransition(from: RecipientStatus, to: RecipientStatus): void {
  if (!isRecipientTransitionAllowed(from, to)) {
    throw new DomainError("invalid_transition", `Recipient job cannot transition from ${from} to ${to}.`);
  }
}

export interface CampaignTransitionOptions {
  now: string;
  pauseReason?: string | null;
}

export function transitionCampaign(
  campaign: CampaignRecord,
  to: CampaignState,
  options: CampaignTransitionOptions,
): CampaignRecord {
  assertCampaignTransition(campaign.state, to);
  const now = options.now;
  const next: CampaignRecord = {
    ...campaign,
    state: to,
    pauseReason: to === "paused" ? options.pauseReason?.trim() || "Paused by member" : null,
    queuedAt: to === "queued" ? campaign.queuedAt ?? now : campaign.queuedAt,
    startedAt: to === "running" ? campaign.startedAt ?? now : campaign.startedAt,
    completedAt: to === "completed" || to === "cancelled" ? campaign.completedAt ?? now : campaign.completedAt,
    cancelRequestedAt: to === "cancelling" || to === "cancelled" ? campaign.cancelRequestedAt ?? now : campaign.cancelRequestedAt,
    cancelledAt: to === "cancelled" ? campaign.cancelledAt ?? now : campaign.cancelledAt,
    updatedAt: now,
  };

  if (to === "completed" && next.completedAt === null) {
    throw new DomainError("invariant_violation", "A completed campaign must have a completion timestamp.");
  }
  return next;
}

export function transitionRecipientJob(
  job: RecipientJobRecord,
  to: RecipientStatus,
  now: string,
): RecipientJobRecord {
  assertRecipientTransition(job.status, to);
  return {
    ...job,
    status: to,
    updatedAt: now,
    nextAttemptAt: to === "pending" ? job.nextAttemptAt : null,
    claimedAt: to === "claimed" ? job.claimedAt : null,
    sendingAt: to === "sending" ? job.sendingAt : null,
    acceptedAt: to === "accepted" ? job.acceptedAt ?? now : job.acceptedAt,
  };
}

export function claimRecipientJob(job: RecipientJobRecord, claimToken: string, now: string): RecipientJobRecord {
  if (job.status !== "pending") {
    throw new DomainError("invalid_transition", "Only a pending recipient job can be claimed.");
  }
  if (!claimToken.trim()) {
    throw new DomainError("invalid_input", "A claim token is required.");
  }
  return {
    ...job,
    status: "claimed",
    attemptCount: job.attemptCount + 1,
    claimToken,
    claimedAt: now,
    sendingAt: null,
    nextAttemptAt: null,
    updatedAt: now,
  };
}

export function markRecipientSending(
  job: RecipientJobRecord,
  claimToken: string,
  now: string,
): RecipientJobRecord {
  if (job.status !== "claimed" || job.claimToken !== claimToken) {
    throw new DomainError("invalid_transition", "Only the active claim can enter sending state.");
  }
  return {
    ...job,
    status: "sending",
    sendingAt: now,
    updatedAt: now,
  };
}

export function markRecipientAccepted(
  job: RecipientJobRecord,
  claimToken: string,
  now: string,
  providerMessageId: string | null = null,
  providerRequestId: string | null = null,
): RecipientJobRecord {
  if (job.status !== "sending" || job.claimToken !== claimToken) {
    throw new DomainError("invalid_transition", "Only the active sending claim can be accepted.");
  }
  return {
    ...job,
    status: "accepted",
    acceptedAt: now,
    claimToken: null,
    providerMessageId,
    providerRequestId,
    lastErrorCategory: null,
    lastErrorMessage: null,
    updatedAt: now,
  };
}

export function markRecipientFailed(
  job: RecipientJobRecord,
  claimToken: string,
  now: string,
  category: string,
  message: string,
  providerRequestId: string | null = null,
): RecipientJobRecord {
  if (job.status !== "sending" || job.claimToken !== claimToken) {
    throw new DomainError("invalid_transition", "Only the active sending claim can fail.");
  }
  return {
    ...job,
    status: "failed",
    claimToken: null,
    lastErrorCategory: category,
    lastErrorMessage: message,
    providerRequestId,
    updatedAt: now,
  };
}

export function markRecipientUnknown(
  job: RecipientJobRecord,
  claimToken: string,
  now: string,
  category: string,
  message: string,
  providerRequestId: string | null = null,
): RecipientJobRecord {
  if (job.status !== "sending" || job.claimToken !== claimToken) {
    throw new DomainError("invalid_transition", "Only the active sending claim can become unknown.");
  }
  return {
    ...job,
    status: "unknown",
    claimToken: null,
    lastErrorCategory: category,
    lastErrorMessage: message,
    providerRequestId,
    updatedAt: now,
  };
}

export interface SafeRetryOptions {
  now: string;
  retryAt: string;
  category: string;
  message: string;
  claimToken: string;
  providerRequestId?: string | null;
}

/**
 * Retry is intentionally a separate operation. A job may be made pending
 * again only when the provider has proved that the request was not submitted
 * (for example, a pre-send throttle response). An unknown outcome has no path
 * back to pending.
 */
export function retryRecipientSafely(
  job: RecipientJobRecord,
  options: SafeRetryOptions,
): RecipientJobRecord {
  if (job.status !== "sending" || job.claimToken !== options.claimToken) {
    throw new DomainError("invalid_transition", "Only the active sending claim can be retried.");
  }
  if (!options.retryAt.trim()) {
    throw new DomainError("invalid_input", "A retry timestamp is required.");
  }
  return {
    ...job,
    status: "pending",
    claimToken: null,
    claimedAt: null,
    sendingAt: null,
    nextAttemptAt: options.retryAt,
    lastErrorCategory: options.category,
    lastErrorMessage: options.message,
    providerRequestId: options.providerRequestId ?? null,
    updatedAt: options.now,
  };
}

export function skipRecipientJob(job: RecipientJobRecord, now: string, message?: string): RecipientJobRecord {
  if (job.status !== "pending") {
    throw new DomainError("invalid_transition", "Only a pending recipient job can be skipped.");
  }
  return {
    ...job,
    status: "skipped",
    lastErrorCategory: "skipped",
    lastErrorMessage: message ?? "Skipped during review.",
    updatedAt: now,
  };
}

export function makeSendKey(campaignId: string, sourceRow: number): string {
  const normalizedCampaignId = campaignId.trim();
  if (!normalizedCampaignId || !Number.isSafeInteger(sourceRow) || sourceRow < 1) {
    throw new DomainError("invalid_input", "A campaign id and positive source row are required for a send key.");
  }
  // Campaign ids are opaque and source rows are 1-based. The unique database
  // constraint is the final guard against accidental duplicate insertion.
  return `${normalizedCampaignId}:${sourceRow}`;
}
