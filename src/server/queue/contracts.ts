import type { CampaignRecord } from "../../domain/types";
import type { MailAttachment, MailProvider } from "../../domain/mail-provider";
import type { AuditRepository, CampaignRepository, MailboxDeliveryRepository, MailboxUnavailableReason, RecipientJobRepository } from "../database/contracts";

export interface CampaignTickMessage {
  type: "campaign.tick";
  campaignId: string;
  wakeToken: string;
}

export interface QueueEnqueueOptions {
  /** Cloudflare Queues accepts a delay in seconds from 0 through 86,400. */
  delaySeconds?: number;
}

export interface CampaignQueue {
  enqueue(message: CampaignTickMessage, options?: QueueEnqueueOptions): Promise<void>;
}

/** A structural shape for the Cloudflare Queue producer binding. */
export interface CloudflareQueueProducer {
  send(message: CampaignTickMessage, options?: QueueEnqueueOptions): Promise<void>;
}

export interface CampaignTickDependencies {
  campaigns: CampaignRepository;
  recipientJobs: RecipientJobRepository;
  mailboxDelivery: MailboxDeliveryRepository;
  audit: AuditRepository;
  queue: CampaignQueue;
  mailProvider: MailProvider | ((campaign: CampaignRecord) => Promise<MailProvider> | MailProvider);
  /**
   * Resolves the immutable campaign-wide attachment set before a recipient is
   * claimed.  A missing or corrupt set must reject the campaign before Graph
   * receives any request.
   */
  attachmentLoader: (campaign: CampaignRecord) => Promise<readonly MailAttachment[]>;
  /** Best-effort terminal cleanup. Scheduled cleanup retries failed deletes. */
  attachmentCleanup: (campaignId: string) => Promise<void>;
  now?: () => Date;
  claimToken?: (campaignId: string, now: Date) => string;
  attemptToken?: (campaignId: string, now: Date) => string;
  wakeToken?: (campaignId: string, now: Date) => string;
}

export type TickResult =
  | { kind: "ignored"; reason: "missing_campaign" | "paused" | "terminal" | "not_runnable" | "claim_lost" | "send_claim_lost" | "stale_wake" }
  | { kind: "waiting"; campaignId: string; jobId: string | null; reason: MailboxUnavailableReason | "not_due" | "authorization_retry" | "attachment_retry" | "attachments_temporarily_unavailable"; nextAttemptAt: string; delaySeconds: number }
  | { kind: "paused"; campaignId: string; reason: "attachment_authorization" | "mail_authorization" }
  | { kind: "completed"; campaignId: string }
  | { kind: "failed"; campaignId: string; reason: "attachments_unavailable" }
  | { kind: "scheduled"; campaignId: string; jobId: string; delaySeconds: number; outcome: "accepted" | "failed" | "retry_scheduled" | "unknown" }
  | { kind: "persistence_error"; campaignId: string; jobId: string; outcome: "accepted" | "failed" | "retry_scheduled" | "unknown" };

export function cloudflareQueueAdapter(producer: CloudflareQueueProducer): CampaignQueue {
  return {
    enqueue(message, options) {
      const delaySeconds = options?.delaySeconds;
      if (delaySeconds !== undefined && (!Number.isInteger(delaySeconds) || delaySeconds < 0 || delaySeconds > 86_400)) {
        throw new RangeError("Cloudflare Queue delaySeconds must be an integer from 0 through 86400.");
      }
      return producer.send(message, options);
    },
  };
}
