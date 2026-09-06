import type {
  AuditEventRecord,
  CampaignAttachmentIssueCode,
  CampaignCounts,
  CampaignRecord,
  DeliveryAttemptRecord,
  FlowRecord,
  RecipientJobRecord,
  TemplateVersionRecord,
  UserRecord,
} from "../../domain/types";
import type { AttachmentRepository } from "../attachments/contracts";

/**
 * Structural D1 types. Keeping these local avoids making the domain depend on
 * Cloudflare's runtime type package, while still allowing a real D1 binding to
 * be passed to the adapter.
 */
export type D1Value = string | number | null | ArrayBuffer | Uint8Array;

export interface D1RunResult {
  success?: boolean;
  meta?: {
    changes?: number;
    last_row_id?: number;
    rows_read?: number;
    rows_written?: number;
    duration?: number;
    [key: string]: unknown;
  };
}

export interface D1AllResult<T> {
  results: T[];
  success?: boolean;
  meta?: Record<string, unknown>;
}

export interface D1PreparedStatement {
  bind(...values: D1Value[]): D1PreparedStatement;
  first<T = unknown>(columnName?: string): Promise<T | null>;
  all<T = unknown>(): Promise<D1AllResult<T>>;
  run(): Promise<D1RunResult>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1RunResult[]>;
}

export interface UserRepository {
  getById(id: string): Promise<UserRecord | null>;
  getByPrincipal(tenantId: string, principalName: string): Promise<UserRecord | null>;
  upsert(user: UserRecord): Promise<void>;
  touchLastLogin(id: string, lastLoginAt: string): Promise<boolean>;
}

export interface FlowRepository {
  getById(id: string): Promise<FlowRecord | null>;
  getByIdForOwner(id: string, ownerUserId: string): Promise<FlowRecord | null>;
  getByNameForOwner(ownerUserId: string, name: string): Promise<FlowRecord | null>;
  listByOwner(ownerUserId: string): Promise<FlowRecord[]>;
  create(flow: FlowRecord): Promise<void>;
  update(flow: FlowRecord): Promise<boolean>;
}

export interface TemplateVersionRepository {
  getById(id: string): Promise<TemplateVersionRecord | null>;
  listByFlow(flowId: string): Promise<TemplateVersionRecord[]>;
  create(version: Omit<TemplateVersionRecord, "version">, publication?: {
    ownerUserId: string; expectedVersionId: string | null; name?: string;
  }): Promise<TemplateVersionRecord>;
}

export interface CampaignRepository {
  getById(id: string): Promise<CampaignRecord | null>;
  getByIdForOwner(id: string, ownerUserId: string): Promise<CampaignRecord | null>;
  getByIdempotencyKey(ownerUserId: string, idempotencyKey: string): Promise<CampaignRecord | null>;
  listByOwner(ownerUserId: string, limit?: number, before?: { createdAt: string; id: string } | null): Promise<(CampaignRecord & { counts: CampaignCounts })[]>;
  /**
   * Creates and validates the campaign snapshot, recipient jobs, creation
   * audits, and optional owner-matching attachment association in one batch.
   */
  create(
    campaign: CampaignRecord,
    jobs: readonly RecipientJobRecord[],
    attachmentSetId?: string | null,
    auditEvents?: readonly AuditEventRecord[],
  ): Promise<void>;
  /** Conditional lifecycle transitions return false when a concurrent update won. */
  getMailboxHead(ownerUserId: string): Promise<CampaignRecord | null>;
  cancel(id: string, ownerUserId: string, now: string): Promise<boolean>;
  settleCancellations(now: string, ownerUserId?: string, limit?: number): Promise<string[]>;
  markValidated(id: string, ownerUserId: string, now: string): Promise<boolean>;
  queue(id: string, ownerUserId: string, now: string): Promise<boolean>;
  markRunningIfQueued(id: string, now: string): Promise<boolean>;
  pause(id: string, ownerUserId: string, now: string, reason: string): Promise<boolean>;
  resume(id: string, ownerUserId: string, now: string): Promise<boolean>;
  fail(id: string, now: string, reason: string, attachmentIssueCode?: CampaignAttachmentIssueCode | null): Promise<boolean>;
  pauseForAttachmentAuthorization(id: string, ownerUserId: string, now: string, reason: string): Promise<boolean>;
  pauseForMailAuthorization(id: string, ownerUserId: string, now: string, reason: string): Promise<boolean>;
  markAttachmentRetry(id: string, nextAttemptAt: string, message: string, now: string): Promise<boolean>;
  clearAttachmentIssue(id: string, now: string): Promise<boolean>;
  completeIfExhausted(id: string, now: string): Promise<boolean>;
  /** Reserve at most one effective Queue wake for a runnable campaign. */
  reserveWake(id: string, wakeToken: string, dueAt: string, message: string | null, now: string, replaceDueBefore?: string | null): Promise<boolean>;
  /** Consume only the matching due wake. Duplicate Queue messages return null. */
  consumeWake(id: string, wakeToken: string, now: string): Promise<CampaignRecord | null>;
  markSchedulerWaiting(id: string, nextAttemptAt: string, message: string, now: string): Promise<boolean>;
  listWatchdogWakeCandidates(now: string, staleBefore: string, limit?: number): Promise<CampaignRecord[]>;
  completeExhaustedBatch(now: string, limit?: number): Promise<string[]>;
}

export interface RecipientJobRepository {
  verifyDelivery(id: string, campaignId: string, ownerUserId: string, now: string, note: string | null): Promise<RecipientJobRecord | null>;
  getById(id: string): Promise<RecipientJobRecord | null>;
  getByCampaignAndSourceRow(campaignId: string, sourceRow: number): Promise<RecipientJobRecord | null>;
  listByCampaign(campaignId: string, limit?: number, offset?: number): Promise<RecipientJobRecord[]>;
  /** Claims one pending row and increments its attempt count atomically. */
  claimNextPending(campaignId: string, now: string, claimToken: string): Promise<RecipientJobRecord | null>;
  releaseClaimForWait(id: string, claimToken: string, now: string, retryAt: string, category: string, message: string): Promise<boolean>;
  markSending(id: string, claimToken: string, now: string): Promise<boolean>;
  markAccepted(
    id: string,
    claimToken: string,
    now: string,
    providerMessageId: string | null,
    providerRequestId: string | null,
  ): Promise<boolean>;
  markFailed(
    id: string,
    claimToken: string,
    now: string,
    category: string,
    message: string,
    providerRequestId: string | null,
  ): Promise<boolean>;
  /** Safe only for an adapter-confirmed no-send outcome. */
  scheduleSafeRetry(
    id: string,
    claimToken: string,
    now: string,
    retryAt: string,
    category: string,
    message: string,
    providerRequestId: string | null,
  ): Promise<boolean>;
  /** There is deliberately no method that changes unknown back to pending. */
  markUnknown(
    id: string,
    claimToken: string,
    now: string,
    category: string,
    message: string,
    providerRequestId: string | null,
  ): Promise<boolean>;
  markSkipped(id: string, now: string, message: string): Promise<boolean>;
  counts(campaignId: string): Promise<CampaignCounts>;
}

export type MailboxUnavailableReason = "lease" | "pace" | "provider_backoff" | "budget";

export type MailboxLeaseDecision =
  | { readonly kind: "acquired"; readonly attempt: DeliveryAttemptRecord }
  | { readonly kind: "unavailable"; readonly reason: MailboxUnavailableReason; readonly nextAvailableAt: string };

export interface MailboxLeaseRequest {
  readonly attemptId: string;
  readonly attemptToken: string;
  readonly ownerUserId: string;
  readonly campaignId: string;
  readonly recipientJobId: string | null;
  readonly testSendId: string | null;
  readonly envelopeRecipientCount: number;
  readonly now: string;
  readonly leaseExpiresAt: string;
  readonly budgetExpiresAt: string;
  readonly campaignNotBefore?: string | null;
}

export interface CampaignAttemptCompletion {
  readonly attemptToken: string;
  readonly ownerUserId: string;
  readonly campaignId: string;
  readonly recipientJobId: string;
  readonly claimToken: string;
  readonly now: string;
  readonly nextSendAt: string;
  readonly providerBackoffUntil?: string | null;
  readonly outcome: "accepted" | "unknown" | "failed" | "retry" | "pause";
  readonly retryAt?: string | null;
  readonly category?: string | null;
  readonly message?: string | null;
  readonly providerMessageId?: string | null;
  readonly providerRequestId?: string | null;
}

export interface TestAttemptCompletion {
  readonly attemptToken: string;
  readonly ownerUserId: string;
  readonly testSendId: string;
  readonly now: string;
  readonly nextSendAt: string;
  readonly providerBackoffUntil?: string | null;
  readonly acceptedResult?: unknown;
  readonly failure?: { readonly status: number; readonly code: string; readonly message: string };
  readonly safeToRetry?: boolean;
}

export interface RecoveryEvent {
  readonly kind: "claimed_recovered" | "provider_unknown" | "test_released" | "test_unknown" | "lease_released";
  readonly campaignId: string | null;
  readonly recipientJobId: string | null;
  readonly testSendId: string | null;
}

export interface MailboxDeliveryRepository {
  acquire(request: MailboxLeaseRequest): Promise<MailboxLeaseDecision>;
  markCampaignProviderBound(attemptToken: string, recipientJobId: string, claimToken: string, now: string, leaseExpiresAt: string): Promise<boolean>;
  markTestProviderBound(attemptToken: string, testSendId: string, now: string, leaseExpiresAt: string): Promise<boolean>;
  completeCampaignAttempt(input: CampaignAttemptCompletion): Promise<boolean>;
  completeTestAttempt(input: TestAttemptCompletion): Promise<boolean>;
  recoverStale(now: string, staleBefore: string, limit?: number): Promise<RecoveryEvent[]>;
}

export interface AuditRepository {
  append(event: AuditEventRecord): Promise<void>;
  listByCampaign(campaignId: string, limit?: number): Promise<AuditEventRecord[]>;
}

export interface Repositories {
  users: UserRepository;
  flows: FlowRepository;
  templateVersions: TemplateVersionRepository;
  campaigns: CampaignRepository;
  recipientJobs: RecipientJobRepository;
  audit: AuditRepository;
  attachments: AttachmentRepository;
  mailboxDelivery: MailboxDeliveryRepository;
}
