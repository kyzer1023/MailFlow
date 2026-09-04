import type { D1Database } from "./contracts";
import { changes, json, parseJson, prepareAndBind as bind } from "./d1-helpers";

export type StoredTestSendStatus = "pending" | "accepted" | "failed";

export interface StoredTestSendResult {
  readonly status: "accepted";
  readonly userMessage: "Accepted by Microsoft";
  readonly senderAddress: string;
  readonly recipientAddress: string;
  readonly graphStatus?: number;
  readonly smtpStatus?: number;
  readonly requestId?: string;
}

export interface StoredTestSendFailure {
  readonly status: 401 | 403 | 404 | 409 | 413 | 422 | 429 | 502 | 503;
  readonly code: string;
  readonly message: string;
}

export interface StoredTestSendRecord {
  readonly id: string;
  readonly ownerUserId: string;
  readonly campaignId: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly status: StoredTestSendStatus;
  readonly result: StoredTestSendResult | null;
  readonly failure: StoredTestSendFailure | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface TestSendClaimInput {
  readonly id: string;
  readonly ownerUserId: string;
  readonly campaignId: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly now: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

export interface PublicControlStore {
  findTestSend(ownerUserId: string, idempotencyKey: string): Promise<StoredTestSendRecord | null>;
  createPendingTestSend(input: TestSendClaimInput): Promise<boolean>;
  removePendingTestSend(id: string): Promise<void>;
  completeTestSendAccepted(id: string, result: StoredTestSendResult, now: number): Promise<boolean>;
  completeTestSendFailed(id: string, failure: StoredTestSendFailure, now: number): Promise<boolean>;
  consumeRateLimit(scope: string, subjectKey: string, now: number, windowMs: number, limit: number): Promise<RateLimitDecision>;
  cleanupExpired(now: number, limit?: number): Promise<{ counters: number; staleTestSends: number }>;
}

interface TestSendRow {
  id: string;
  owner_user_id: string;
  campaign_id: string;
  idempotency_key: string;
  request_fingerprint: string;
  status: StoredTestSendStatus;
  result_json: string | null;
  error_status: number | null;
  error_code: string | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
}

function storedTestSend(row: TestSendRow): StoredTestSendRecord {
  const failure = row.error_status && row.error_code && row.error_message
    ? {
        status: row.error_status as StoredTestSendFailure["status"],
        code: row.error_code,
        message: row.error_message,
      }
    : null;
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    campaignId: row.campaign_id,
    idempotencyKey: row.idempotency_key,
    requestFingerprint: row.request_fingerprint,
    status: row.status,
    result: row.result_json ? parseJson<StoredTestSendResult | null>(row.result_json, null) : null,
    failure,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

/** D1-backed controls shared by authenticated test-send and public OAuth routes. */
export class D1PublicControlStore implements PublicControlStore {
  constructor(private readonly db: D1Database) {}

  async findTestSend(ownerUserId: string, idempotencyKey: string): Promise<StoredTestSendRecord | null> {
    const row = await bind(
      this.db,
      "SELECT * FROM test_sends WHERE owner_user_id = ?1 AND idempotency_key = ?2",
      [ownerUserId, idempotencyKey],
    ).first<TestSendRow>();
    return row ? storedTestSend(row) : null;
  }

  async createPendingTestSend(input: TestSendClaimInput): Promise<boolean> {
    const result = await bind(
      this.db,
      `INSERT INTO test_sends
         (id, owner_user_id, campaign_id, idempotency_key, request_fingerprint, status, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?6)
       ON CONFLICT(owner_user_id, idempotency_key) DO NOTHING`,
      [input.id, input.ownerUserId, input.campaignId, input.idempotencyKey, input.requestFingerprint, input.now],
    ).run();
    return changes(result) === 1;
  }

  async removePendingTestSend(id: string): Promise<void> {
    await bind(this.db, "DELETE FROM test_sends WHERE id = ?1 AND status = 'pending'", [id]).run();
  }

  async completeTestSendAccepted(id: string, result: StoredTestSendResult, now: number): Promise<boolean> {
    const updated = await bind(
      this.db,
      `UPDATE test_sends
       SET status = 'accepted', result_json = ?1, error_status = NULL, error_code = NULL, error_message = NULL, updated_at = ?2
       WHERE id = ?3 AND status = 'pending'`,
      [json(result), now, id],
    ).run();
    return changes(updated) === 1;
  }

  async completeTestSendFailed(id: string, failure: StoredTestSendFailure, now: number): Promise<boolean> {
    const updated = await bind(
      this.db,
      `UPDATE test_sends
       SET status = 'failed', result_json = NULL, error_status = ?1, error_code = ?2, error_message = ?3, updated_at = ?4
       WHERE id = ?5 AND status = 'pending'`,
      [failure.status, failure.code, failure.message, now, id],
    ).run();
    return changes(updated) === 1;
  }

  async consumeRateLimit(scope: string, subjectKey: string, now: number, windowMs: number, limit: number): Promise<RateLimitDecision> {
    const windowStartedAt = Math.floor(now / windowMs) * windowMs;
    const expiresAt = windowStartedAt + windowMs;
    const row = await bind(
      this.db,
      `INSERT INTO rate_limit_counters (scope, subject_key, window_started_at, request_count, expires_at)
       VALUES (?1, ?2, ?3, 1, ?4)
       ON CONFLICT(scope, subject_key, window_started_at) DO UPDATE SET
         request_count = rate_limit_counters.request_count + 1,
         expires_at = excluded.expires_at
       WHERE rate_limit_counters.request_count < ?5
       RETURNING request_count`,
      [scope, subjectKey, windowStartedAt, expiresAt, limit],
    ).first<{ request_count: number }>();
    const retryAfterSeconds = Math.max(1, Math.ceil((expiresAt - now) / 1000));
    if (!row) return { allowed: false, remaining: 0, retryAfterSeconds };
    return { allowed: true, remaining: Math.max(0, limit - Number(row.request_count)), retryAfterSeconds };
  }

  async cleanupExpired(now: number, limit = 500): Promise<{ counters: number; staleTestSends: number }> {
    const safeLimit = Math.max(1, Math.min(2_000, Math.floor(limit)));
    const counters = await bind(
      this.db,
      `DELETE FROM rate_limit_counters
       WHERE rowid IN (SELECT rowid FROM rate_limit_counters WHERE expires_at <= ?1 LIMIT ?2)`,
      [now, safeLimit],
    ).run();
    const staleBefore = now - 60 * 60 * 1000;
    const staleTestSends = await bind(
      this.db,
      `UPDATE test_sends
       SET status = 'failed', error_status = 503, error_code = 'test_send_interrupted',
           error_message = 'The earlier test request did not finish. Start a new test from Review.', updated_at = ?1
       WHERE id IN (
         SELECT test_sends.id FROM test_sends
         WHERE status = 'pending' AND updated_at <= ?2
           AND NOT EXISTS (
             SELECT 1 FROM delivery_attempts
             WHERE delivery_attempts.test_send_id = test_sends.id
               AND delivery_attempts.state IN ('reserved', 'provider_bound')
           )
         LIMIT ?3
       )`,
      [now, staleBefore, safeLimit],
    ).run();
    return { counters: changes(counters), staleTestSends: changes(staleTestSends) };
  }
}

export function createD1PublicControlStore(db: D1Database): D1PublicControlStore {
  return new D1PublicControlStore(db);
}
