import type {
  AuditEventRecord,
  CampaignCounts,
  CampaignRecord,
  FlowRecord,
  RecipientJobRecord,
  TemplateVersionRecord,
  UserRecord,
} from "../../domain/types";

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
  create(version: TemplateVersionRecord): Promise<void>;
}

export interface CampaignRepository {
  getById(id: string): Promise<CampaignRecord | null>;
  getByIdForOwner(id: string, ownerUserId: string): Promise<CampaignRecord | null>;
  getByIdempotencyKey(ownerUserId: string, idempotencyKey: string): Promise<CampaignRecord | null>;
  listByOwner(ownerUserId: string, limit?: number): Promise<CampaignRecord[]>;
  create(campaign: CampaignRecord, jobs: readonly RecipientJobRecord[]): Promise<void>;
  /** Conditional lifecycle transitions return false when a concurrent update won. */
  markValidated(id: string, ownerUserId: string, now: string): Promise<boolean>;
  queue(id: string, ownerUserId: string, now: string): Promise<boolean>;
  markRunningIfQueued(id: string, now: string): Promise<boolean>;
  pause(id: string, ownerUserId: string, now: string, reason: string): Promise<boolean>;
  resume(id: string, ownerUserId: string, now: string): Promise<boolean>;
  fail(id: string, now: string, reason: string): Promise<boolean>;
  completeIfExhausted(id: string, now: string): Promise<boolean>;
}

export interface RecipientJobRepository {
  getById(id: string): Promise<RecipientJobRecord | null>;
  listByCampaign(campaignId: string, limit?: number, offset?: number): Promise<RecipientJobRecord[]>;
  /** Claims one pending row and increments its attempt count atomically. */
  claimNextPending(campaignId: string, now: string, claimToken: string): Promise<RecipientJobRecord | null>;
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
}
