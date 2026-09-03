import { parseRetryAfterSeconds, paceDelaySeconds, MAX_QUEUE_DELAY_SECONDS } from "../../domain/pacing";
import type { MailAttachment, MailProvider, MailSendResult } from "../../domain/mail-provider";
import { makeSendKey } from "../../domain/state";
import type { CampaignRecord } from "../../domain/types";
import type { CampaignTickDependencies, CampaignTickMessage, TickResult } from "./contracts";

function iso(now: Date): string {
  return now.toISOString();
}

function defaultClaimToken(campaignId: string, now: Date): string {
  // A duplicate delivery in the same millisecond is harmless because only one
  // pending row can satisfy the conditional claim update.
  return `${campaignId}:${now.getTime()}`;
}

function providerFor(
  value: CampaignTickDependencies["mailProvider"],
  campaign: CampaignRecord,
): Promise<MailProvider> {
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

async function scheduleIfRunnable(
  dependencies: CampaignTickDependencies,
  campaignId: string,
  delaySeconds: number,
): Promise<boolean> {
  const current = await dependencies.campaigns.getById(campaignId);
  if (!current || current.state !== "running") return false;
  await dependencies.queue.enqueue(
    { type: "campaign.tick", campaignId },
    { delaySeconds: Math.min(MAX_QUEUE_DELAY_SECONDS, Math.max(0, Math.floor(delaySeconds))) },
  );
  return true;
}

/**
 * Advance exactly one recipient job. Queue delivery is at least once, so this
 * function relies on the conditional repository claim and claim-token checks
 * for every state mutation. A provider exception is always treated as
 * ambiguous and becomes `unknown`; it is never retried automatically.
 */
export async function processCampaignTick(
  message: CampaignTickMessage | string,
  dependencies: CampaignTickDependencies,
): Promise<TickResult> {
  const campaignId = typeof message === "string" ? message : message.campaignId;
  const nowDate = dependencies.now?.() ?? new Date();
  const now = iso(nowDate);
  let campaign = await dependencies.campaigns.getById(campaignId);
  if (!campaign) return { kind: "ignored", reason: "missing_campaign" };

  if (campaign.state === "paused") return { kind: "ignored", reason: "paused" };
  if (campaign.state === "completed" || campaign.state === "failed") return { kind: "ignored", reason: "terminal" };
  if (campaign.state === "draft" || campaign.state === "validated") return { kind: "ignored", reason: "not_runnable" };

  if (campaign.state === "queued") {
    const becameRunning = await dependencies.campaigns.markRunningIfQueued(campaign.id, now);
    campaign = (await dependencies.campaigns.getById(campaign.id)) ?? campaign;
    if (!becameRunning && campaign.state !== "running") {
      return campaign.state === "paused"
        ? { kind: "ignored", reason: "paused" }
        : { kind: "ignored", reason: "not_runnable" };
    }
  }
  if (campaign.state !== "running") return { kind: "ignored", reason: "not_runnable" };

  // Attachment bytes are deliberately loaded and checksum-verified before a
  // recipient claim. This keeps a missing or corrupt OneDrive object from being
  // mistaken for an ambiguous provider outcome and prevents any row from being
  // marked sending when the campaign snapshot is no longer deliverable.
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
        // Scheduled cleanup will retry an unavailable object store.
      }
    }
    return { kind: "failed", campaignId: campaign.id, reason: "attachments_unavailable" };
  }

  const claimToken = (dependencies.claimToken ?? defaultClaimToken)(campaign.id, nowDate);
  const job = await dependencies.recipientJobs.claimNextPending(campaign.id, now, claimToken);
  if (!job) {
    const completed = await dependencies.campaigns.completeIfExhausted(campaign.id, now);
    if (completed) {
      try {
        await dependencies.attachmentCleanup(campaign.id);
      } catch {
        // Scheduled cleanup will retry an unavailable object store.
      }
      return { kind: "completed", campaignId: campaign.id };
    }
    return { kind: "ignored", reason: "claim_lost" };
  }

  const markedSending = await dependencies.recipientJobs.markSending(job.id, claimToken, now);
  if (!markedSending) return { kind: "ignored", reason: "send_claim_lost" };

  let result: MailSendResult;
  try {
    const provider = await providerFor(dependencies.mailProvider, campaign);
    result = await provider.send(
      {
        to: job.recipient,
        cc: job.cc,
        bcc: job.bcc,
        replyTo: job.replyTo,
        importance: job.importance ?? "normal",
        subject: job.renderedSubject,
        htmlBody: job.renderedBodyHtml,
        attachments,
      },
      { sendKey: job.sendKey || makeSendKey(campaign.id, job.sourceRow) },
    );
  } catch {
    result = {
      kind: "unknown",
      category: "ambiguous",
      message: "The mail provider response was lost after the send was attempted.",
    };
  }

  const resultNowDate = dependencies.now?.() ?? new Date();
  const resultNow = iso(resultNowDate);
  const paceDelay = paceDelaySeconds(campaign.pacePerMinute);
  let outcome: "accepted" | "failed" | "retry_scheduled" | "unknown";
  let delaySeconds = paceDelay;
  let persisted = false;

  switch (result.kind) {
    case "accepted":
      persisted = await dependencies.recipientJobs.markAccepted(
        job.id,
        claimToken,
        resultNow,
        result.providerMessageId ?? null,
        result.providerRequestId ?? null,
      );
      outcome = "accepted";
      break;
    case "retryable": {
      // The discriminant is deliberately narrower than a generic retryable
      // error. Only adapters that prove no request was submitted may retry.
      if (result.safeToRetry !== true) {
        persisted = await dependencies.recipientJobs.markUnknown(
          job.id,
          claimToken,
          resultNow,
          "ambiguous",
          "The provider could not prove that this message was not submitted; it was not retried.",
          result.providerRequestId ?? null,
        );
        outcome = "unknown";
        break;
      }
      delaySeconds = delayForRetry(result, resultNowDate, paceDelay);
      const retryAt = new Date(resultNowDate.getTime() + delaySeconds * 1_000).toISOString();
      persisted = await dependencies.recipientJobs.scheduleSafeRetry(
        job.id,
        claimToken,
        resultNow,
        retryAt,
        result.category,
        safeMessage(result.message, "Microsoft requested a temporary pause."),
        result.providerRequestId ?? null,
      );
      outcome = "retry_scheduled";
      break;
    }
    case "failed":
      persisted = await dependencies.recipientJobs.markFailed(
        job.id,
        claimToken,
        resultNow,
        result.category,
        safeMessage(result.message, "Microsoft rejected this message."),
        result.providerRequestId ?? null,
      );
      outcome = "failed";
      break;
    case "unknown":
      persisted = await dependencies.recipientJobs.markUnknown(
        job.id,
        claimToken,
        resultNow,
        result.category,
        safeMessage(result.message, "The send outcome is unknown and was not retried."),
        result.providerRequestId ?? null,
      );
      outcome = "unknown";
      break;
  }

  if (!persisted) return { kind: "persistence_error", campaignId: campaign.id, jobId: job.id, outcome };

  const latest = await dependencies.campaigns.getById(campaign.id);
  if (!latest || latest.state !== "running") {
    return { kind: "scheduled", campaignId: campaign.id, jobId: job.id, delaySeconds, outcome };
  }
  const scheduled = await scheduleIfRunnable(dependencies, campaign.id, delaySeconds);
  return { kind: "scheduled", campaignId: campaign.id, jobId: job.id, delaySeconds: scheduled ? delaySeconds : 0, outcome };
}

export async function handleCampaignQueueMessage(
  message: unknown,
  dependencies: CampaignTickDependencies,
): Promise<TickResult> {
  if (!isCampaignTickMessage(message)) {
    return { kind: "ignored", reason: "not_runnable" };
  }
  return processCampaignTick(message, dependencies);
}

/** Validate queue payloads at the runtime boundary before reading fields. */
export function isCampaignTickMessage(value: unknown): value is CampaignTickMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CampaignTickMessage>;
  return candidate.type === "campaign.tick" && typeof candidate.campaignId === "string" && candidate.campaignId.trim().length > 0;
}
