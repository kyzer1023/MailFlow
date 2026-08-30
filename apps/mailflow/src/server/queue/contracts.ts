import type { CampaignRecord } from "../../domain/types";
import type { MailProvider } from "../../domain/mail-provider";
import type { CampaignRepository, RecipientJobRepository } from "../database/contracts";

export interface CampaignTickMessage {
  type: "campaign.tick";
  campaignId: string;
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
  queue: CampaignQueue;
  mailProvider: MailProvider | ((campaign: CampaignRecord) => Promise<MailProvider> | MailProvider);
  now?: () => Date;
  claimToken?: (campaignId: string, now: Date) => string;
}

export type TickResult =
  | { kind: "ignored"; reason: "missing_campaign" | "paused" | "terminal" | "not_runnable" | "claim_lost" | "send_claim_lost" }
  | { kind: "completed"; campaignId: string }
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

