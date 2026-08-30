import type { D1Database } from "../database/contracts";
import type { CampaignTickMessage, CloudflareQueueProducer } from "../queue/contracts";

/**
 * Bindings used by the Mail Flow Worker.  These are deliberately structural
 * so the API layer remains easy to exercise with the small fakes used in unit
 * tests while still matching Cloudflare's runtime bindings in production.
 */
export interface MailFlowBindings {
  DB: D1Database;
  CAMPAIGN_QUEUE: CloudflareQueueProducer;
  ASSETS: {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  };
  ENTRA_TENANT_ID?: string;
  ENTRA_CLIENT_ID?: string;
  ENTRA_CLIENT_SECRET?: string;
  TOKEN_ENCRYPTION_KEY_B64?: string;
  SESSION_SECRET?: string;
  PUBLIC_ORIGIN?: string;
  DEFAULT_CAMPAIGN_PACE?: string;
  MAX_CAMPAIGN_RECIPIENTS?: string;
}

export interface MailFlowVariables {
  user: import("../auth/contracts").AuthenticatedUser;
  sessionToken: string;
  csrfToken: string;
}

export interface MailFlowExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
}

export interface QueueMessage<T> {
  body: T;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

export interface QueueBatch<T> {
  queue: string;
  messages: readonly QueueMessage<T>[];
}

export function isCampaignTickMessage(value: unknown): value is CampaignTickMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<CampaignTickMessage>;
  return candidate.type === "campaign.tick" && typeof candidate.campaignId === "string" && candidate.campaignId.trim().length > 0 && candidate.campaignId.length <= 128;
}
