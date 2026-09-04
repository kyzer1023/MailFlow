import {
  MAILBOX_BUDGET_WINDOW_MS,
  MAILBOX_LEASE_MS,
  envelopeRecipientCount,
  laterIso,
  mailboxWaitMessage,
  queueDelayUntil,
} from "../../domain/mailbox-scheduler";
import { parseRetryAfterSeconds, paceDelaySeconds, MAX_QUEUE_DELAY_SECONDS } from "../../domain/pacing";
import type { MailAttachment, MailProvider, MailSendResult } from "../../domain/mail-provider";
import { makeSendKey } from "../../domain/state";
import type { AuditEventType, CampaignRecord } from "../../domain/types";
import type { CampaignRepository } from "../database/contracts";
import type { CampaignQueue, CampaignTickDependencies, CampaignTickMessage, TickResult } from "./contracts";

function iso(now: Date): string {
  return now.toISOString();
}

function randomToken(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function providerFor(value: CampaignTickDependencies["mailProvider"], campaign: CampaignRecord): Promise<MailProvider> {
  return typeof value === "function" ? Promise.resolve(value(campaign)) : Promise.resolve(value);
}

function safeMessage(message: string | undefined, fallback: string): string {
  const trimmed = message?.trim();
  return trimmed ? trimmed.slice(0, 500) : fallback;
}

function delayForRetry(result: Extract<MailSendResult, { kind: "retryable" }>, now: Date, paceDelay: number): number {
  const retryAfter = parseRetryAfterSeconds(result.retryAfter, now);
  return Math.min(MAX_QUEUE_DELAY_SECONDS, Math.max(paceDelay, retryAfter ?? paceDelay));
}

async function safeAudit(
  dependencies: CampaignTickDependencies,
  eventType: AuditEventType,
  campaign: CampaignRecord,
  recipientJobId: string | null,
  metadata: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  try {
    await dependencies.audit.append({
      id: randomToken("audit"),
      actorUserId: campaign.ownerUserId,
      campaignId: campaign.id,
      recipientJobId,
      eventType,
      metadata,
      createdAt: new Date().toISOString(),
    });
  } catch {
    // Delivery state remains authoritative when non-secret audit persistence is unavailable.
  }
}

export async function reserveCampaignWake(options: {
  readonly campaigns: CampaignRepository;
  readonly queue: CampaignQueue;
  readonly campaignId: string;
  readonly dueAt: string;
  readonly message: string | null;
  readonly now: Date;
  readonly token?: string;
  readonly replaceDueBefore?: string | null;
}): Promise<{ reserved: boolean; published: boolean; wakeToken: string | null; delaySeconds: number }> {
  const wakeToken = options.token ?? randomToken("wake");
  const reserved = await options.campaigns.reserveWake(
    options.campaignId,
    wakeToken,
    options.dueAt,
    options.message,
    options.now.toISOString(),
    options.replaceDueBefore ?? null,
  );
  const delaySeconds = queueDelayUntil(options.dueAt, options.now);
  if (!reserved) return { reserved: false, published: false, wakeToken: null, delaySeconds };
  try {
    await options.queue.enqueue(
      { type: "campaign.tick", campaignId: options.campaignId, wakeToken },
      { delaySeconds },
    );
    return { reserved: true, published: true, wakeToken, delaySeconds };
  } catch {
    // The durable wake remains reserved. The hourly watchdog republishes it.
    return { reserved: true, published: false, wakeToken, delaySeconds: 0 };
  }
}

/**
 * Advance one due wake. D1 owns both the one-effective-wake rule and the
 * mailbox-wide provider lease, so duplicate Queue deliveries cannot submit in
 * parallel even when they run in different Worker isolates.
 */
export async function processCampaignTick(
  message: CampaignTickMessage | string,
  dependencies: CampaignTickDependencies,
): Promise<TickResult> {
  if (typeof message === "string") return { kind: "ignored", reason: "stale_wake" };
  const campaignId = message.campaignId;
  const nowDate = dependencies.now?.() ?? new Date();
  const now = iso(nowDate);
  let campaign = await dependencies.campaigns.getById(campaignId);
  if (!campaign) return { kind: "ignored", reason: "missing_campaign" };
  if (campaign.state === "paused") return { kind: "ignored", reason: "paused" };
  if (campaign.state === "completed" || campaign.state === "failed") return { kind: "ignored", reason: "terminal" };
  if (campaign.state === "draft" || campaign.state === "validated") return { kind: "ignored", reason: "not_runnable" };
  if (campaign.wakeToken !== message.wakeToken || !campaign.wakeDueAt) return { kind: "ignored", reason: "stale_wake" };

  if (Date.parse(campaign.wakeDueAt) > nowDate.getTime()) {
    const delaySeconds = queueDelayUntil(campaign.wakeDueAt, nowDate);
    try {
      await dependencies.queue.enqueue(message, { delaySeconds });
    } catch {
      // The same D1 wake token remains recoverable by the watchdog.
    }
    return { kind: "waiting", campaignId, jobId: null, reason: "not_due", nextAttemptAt: campaign.wakeDueAt, delaySeconds };
  }

  const consumed = await dependencies.campaigns.consumeWake(campaign.id, message.wakeToken, now);
  if (!consumed) return { kind: "ignored", reason: "stale_wake" };
  campaign = consumed;
  if (campaign.state === "queued") {
    const becameRunning = await dependencies.campaigns.markRunningIfQueued(campaign.id, now);
    campaign = (await dependencies.campaigns.getById(campaign.id)) ?? campaign;
    if (!becameRunning && campaign.state !== "running") {
      return campaign.state === "paused" ? { kind: "ignored", reason: "paused" } : { kind: "ignored", reason: "not_runnable" };
    }
  }
  if (campaign.state !== "running") return { kind: "ignored", reason: "not_runnable" };

  let attachments: readonly MailAttachment[];
  try {
    attachments = await dependencies.attachmentLoader(campaign);
  } catch {
    const failed = await dependencies.campaigns.fail(
      campaign.id,
      now,
      "The campaign attachments could not be verified. No additional message was sent.",
    );
    const latestAfterFailure = failed ? null : await dependencies.campaigns.getById(campaign.id);
    if (failed || latestAfterFailure?.state === "completed" || latestAfterFailure?.state === "failed") {
      try {
        await dependencies.attachmentCleanup(campaign.id);
      } catch {
        // Scheduled cleanup retries an unavailable object store.
      }
    }
    return { kind: "failed", campaignId: campaign.id, reason: "attachments_unavailable" };
  }

  const claimToken = dependencies.claimToken?.(campaign.id, nowDate) ?? randomToken("claim");
  const job = await dependencies.recipientJobs.claimNextPending(campaign.id, now, claimToken);
  if (!job) {
    const completed = await dependencies.campaigns.completeIfExhausted(campaign.id, now);
    if (completed) {
      try {
        await dependencies.attachmentCleanup(campaign.id);
      } catch {
        // Scheduled cleanup retries an unavailable object store.
      }
      await safeAudit(dependencies, "campaign.completed", campaign, null);
      return { kind: "completed", campaignId: campaign.id };
    }
    return { kind: "ignored", reason: "claim_lost" };
  }

  const attemptToken = dependencies.attemptToken?.(campaign.id, nowDate) ?? randomToken("attempt");
  const leaseExpiresAt = new Date(nowDate.getTime() + MAILBOX_LEASE_MS).toISOString();
  const budgetExpiresAt = new Date(nowDate.getTime() + MAILBOX_BUDGET_WINDOW_MS).toISOString();
  const count = envelopeRecipientCount({ to: job.recipient, cc: job.cc, bcc: job.bcc });
  const acquired = await dependencies.mailboxDelivery.acquire({
    attemptId: randomToken("delivery"),
    attemptToken,
    ownerUserId: campaign.ownerUserId,
    campaignId: campaign.id,
    recipientJobId: job.id,
    testSendId: null,
    envelopeRecipientCount: count,
    now,
    leaseExpiresAt,
    budgetExpiresAt,
    campaignNotBefore: campaign.schedulerNextAttemptAt ?? null,
  });

  if (acquired.kind === "unavailable") {
    const waitMessage = mailboxWaitMessage(acquired.reason, acquired.nextAvailableAt);
    await dependencies.recipientJobs.releaseClaimForWait(
      job.id,
      claimToken,
      now,
      acquired.nextAvailableAt,
      acquired.reason === "budget" ? "mailbox_daily_budget" : "mailbox_waiting",
      waitMessage,
    );
    await dependencies.campaigns.markSchedulerWaiting(campaign.id, acquired.nextAvailableAt, waitMessage, now);
    await safeAudit(dependencies, "campaign.mailbox_waiting", campaign, job.id, {
      reason: acquired.reason,
      nextAttemptAt: acquired.nextAvailableAt,
      envelopeRecipientCount: count,
    });
    const wake = await reserveCampaignWake({
      campaigns: dependencies.campaigns,
      queue: dependencies.queue,
      campaignId: campaign.id,
      dueAt: acquired.nextAvailableAt,
      message: waitMessage,
      now: nowDate,
      token: dependencies.wakeToken?.(campaign.id, nowDate),
    });
    return { kind: "waiting", campaignId: campaign.id, jobId: job.id, reason: acquired.reason, nextAttemptAt: acquired.nextAvailableAt, delaySeconds: wake.delaySeconds };
  }

  const boundaryNowDate = dependencies.now?.() ?? new Date();
  const boundaryNow = boundaryNowDate.toISOString();
  const boundaryLeaseExpiresAt = new Date(boundaryNowDate.getTime() + MAILBOX_LEASE_MS).toISOString();
  const markedSending = await dependencies.mailboxDelivery.markCampaignProviderBound(
    attemptToken,
    job.id,
    claimToken,
    boundaryNow,
    boundaryLeaseExpiresAt,
  );
  if (!markedSending) return { kind: "ignored", reason: "send_claim_lost" };

  let result: MailSendResult;
  try {
    const provider = await providerFor(dependencies.mailProvider, campaign);
    result = await provider.send({
      to: job.recipient,
      cc: job.cc,
      bcc: job.bcc,
      replyTo: job.replyTo,
      importance: job.importance ?? "normal",
      subject: job.renderedSubject,
      htmlBody: job.renderedBodyHtml,
      attachments,
    }, { sendKey: job.sendKey || makeSendKey(campaign.id, job.sourceRow) });
  } catch {
    result = { kind: "unknown", category: "ambiguous", message: "The mail provider response was lost after the send was attempted." };
  }

  const resultNowDate = dependencies.now?.() ?? new Date();
  const resultNow = iso(resultNowDate);
  const paceDelay = paceDelaySeconds(campaign.pacePerMinute);
  const paceAt = new Date(resultNowDate.getTime() + paceDelay * 1_000).toISOString();
  let outcome: "accepted" | "failed" | "retry_scheduled" | "unknown";
  let completionOutcome: "accepted" | "unknown" | "failed" | "retry";
  let nextAttemptAt = paceAt;
  let providerBackoffUntil: string | null = null;
  let category: string | null = null;
  let messageText: string | null = null;
  let providerMessageId: string | null = null;
  let providerRequestId: string | null = null;

  switch (result.kind) {
    case "accepted":
      outcome = "accepted";
      completionOutcome = "accepted";
      providerMessageId = result.providerMessageId ?? null;
      providerRequestId = result.providerRequestId ?? null;
      break;
    case "retryable": {
      if (result.safeToRetry !== true) {
        outcome = "unknown";
        completionOutcome = "unknown";
        category = "ambiguous";
        messageText = "The provider could not prove that this message was not submitted; it was not retried.";
        providerRequestId = result.providerRequestId ?? null;
        break;
      }
      const delaySeconds = delayForRetry(result, resultNowDate, paceDelay);
      nextAttemptAt = new Date(resultNowDate.getTime() + delaySeconds * 1_000).toISOString();
      if (result.category === "throttle") providerBackoffUntil = nextAttemptAt;
      outcome = "retry_scheduled";
      completionOutcome = "retry";
      category = result.category;
      messageText = safeMessage(result.message, "Microsoft requested a temporary pause.");
      providerRequestId = result.providerRequestId ?? null;
      break;
    }
    case "failed":
      outcome = "failed";
      completionOutcome = "failed";
      category = result.category;
      messageText = safeMessage(result.message, "Microsoft rejected this message.");
      providerRequestId = result.providerRequestId ?? null;
      break;
    case "unknown":
      outcome = "unknown";
      completionOutcome = "unknown";
      category = result.category;
      messageText = safeMessage(result.message, "The send outcome is unknown and was not retried.");
      providerRequestId = result.providerRequestId ?? null;
      break;
  }

  const persisted = await dependencies.mailboxDelivery.completeCampaignAttempt({
    attemptToken,
    ownerUserId: campaign.ownerUserId,
    campaignId: campaign.id,
    recipientJobId: job.id,
    claimToken,
    now: resultNow,
    nextSendAt: nextAttemptAt,
    providerBackoffUntil,
    outcome: completionOutcome,
    retryAt: completionOutcome === "retry" ? nextAttemptAt : null,
    category,
    message: messageText,
    providerMessageId,
    providerRequestId,
  });
  if (!persisted) return { kind: "persistence_error", campaignId: campaign.id, jobId: job.id, outcome };

  const eventType: AuditEventType = outcome === "accepted"
    ? "recipient.accepted"
    : outcome === "failed"
      ? "recipient.failed"
      : outcome === "unknown"
        ? "recipient.unknown"
        : "recipient.retry_scheduled";
  await safeAudit(dependencies, eventType, campaign, job.id, {
    category,
    nextAttemptAt: outcome === "retry_scheduled" ? nextAttemptAt : undefined,
    envelopeRecipientCount: acquired.attempt.envelopeRecipientCount,
  });

  const completed = await dependencies.campaigns.completeIfExhausted(campaign.id, resultNow);
  if (completed) {
    try {
      await dependencies.attachmentCleanup(campaign.id);
    } catch {
      // Scheduled cleanup retries an unavailable object store.
    }
    await safeAudit(dependencies, "campaign.completed", campaign, null);
    return { kind: "completed", campaignId: campaign.id };
  }

  const latest = await dependencies.campaigns.getById(campaign.id);
  if (!latest || latest.state !== "running") return { kind: "scheduled", campaignId: campaign.id, jobId: job.id, delaySeconds: 0, outcome };
  const dueAt = laterIso(nextAttemptAt, latest.schedulerNextAttemptAt) ?? nextAttemptAt;
  const wake = await reserveCampaignWake({
    campaigns: dependencies.campaigns,
    queue: dependencies.queue,
    campaignId: campaign.id,
    dueAt,
    message: outcome === "retry_scheduled" ? messageText : null,
    now: resultNowDate,
    token: dependencies.wakeToken?.(campaign.id, resultNowDate),
  });
  return { kind: "scheduled", campaignId: campaign.id, jobId: job.id, delaySeconds: wake.delaySeconds, outcome };
}

export async function handleCampaignQueueMessage(message: unknown, dependencies: CampaignTickDependencies): Promise<TickResult> {
  if (!isCampaignTickMessage(message)) return { kind: "ignored", reason: "not_runnable" };
  return processCampaignTick(message, dependencies);
}

/** Validate queue payloads at the runtime boundary before reading fields. */
export function isCampaignTickMessage(value: unknown): value is CampaignTickMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CampaignTickMessage>;
  return candidate.type === "campaign.tick"
    && typeof candidate.campaignId === "string"
    && candidate.campaignId.trim().length > 0
    && typeof candidate.wakeToken === "string"
    && candidate.wakeToken.trim().length > 0;
}
