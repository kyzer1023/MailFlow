import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MAILBOX_BUDGET_WINDOW_MS, envelopeRecipientCount } from "../../domain/mailbox-scheduler";
import type { D1Database, D1PreparedStatement, D1RunResult, D1Value } from "./contracts";
import { D1MailboxDeliveryRepository } from "./d1-mailbox-delivery";
import { D1CampaignRepository } from "./d1-campaigns";
import { processSchedulerWatchdog } from "../api/worker-runtime";

type SqliteValue = string | number | bigint | null | Uint8Array;

function sqliteValues(values: readonly D1Value[]): SqliteValue[] {
  return values.map((value) => value instanceof ArrayBuffer ? new Uint8Array(value) : value as SqliteValue);
}

class SqliteStatement implements D1PreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    readonly query: string,
    private readonly values: readonly D1Value[] = [],
  ) {}

  bind(...values: D1Value[]): D1PreparedStatement {
    return new SqliteStatement(this.database, this.query, values);
  }

  async first<T = unknown>(columnName?: string): Promise<T | null> {
    const row = this.database.prepare(this.query).get(...sqliteValues(this.values)) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (columnName ? row[columnName] : row) as T;
  }

  async all<T = unknown>(): Promise<{ results: T[] }> {
    return { results: this.database.prepare(this.query).all(...sqliteValues(this.values)) as T[] };
  }

  async run(): Promise<D1RunResult> {
    const result = this.database.prepare(this.query).run(...sqliteValues(this.values));
    return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
}

class SqliteD1 implements D1Database {
  readonly database = new DatabaseSync(":memory:");

  prepare(query: string): D1PreparedStatement {
    return new SqliteStatement(this.database, query);
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1RunResult[]> {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results: D1RunResult[] = [];
      for (const statement of statements as SqliteStatement[]) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.database.close();
  }
}

function migratedDatabase(): SqliteD1 {
  const db = new SqliteD1();
  for (let migration = 1; migration <= 7; migration += 1) {
    const prefix = String(migration).padStart(4, "0");
    const filename = migration === 1 ? `${prefix}_initial.sql`
      : migration === 2 ? `${prefix}_message_importance.sql`
        : migration === 3 ? `${prefix}_unique_flow_names.sql`
          : migration === 4 ? `${prefix}_campaign_attachments.sql`
            : migration === 5 ? `${prefix}_oauth_resource_tokens.sql`
              : migration === 6 ? `${prefix}_public_endpoint_controls.sql`
                : `${prefix}_mailbox_scheduler_recovery.sql`;
    db.database.exec(readFileSync(resolve(process.cwd(), "migrations", filename), "utf8"));
  }
  return db;
}

function run(db: SqliteD1, query: string, ...values: SqliteValue[]): void {
  db.database.prepare(query).run(...values);
}

function seedCampaign(db: SqliteD1, suffix = "1"): { userId: string; campaignId: string; jobId: string } {
  const userId = `user-${suffix}`;
  const flowId = `flow-${suffix}`;
  const templateId = `template-${suffix}`;
  const campaignId = `campaign-${suffix}`;
  const jobId = `job-${suffix}`;
  const now = "2026-09-05T00:00:00.000Z";
  run(db, `INSERT INTO users(id, tenant_id, object_id, principal_name, mailbox_address, display_name, role, created_at)
    VALUES (?, 'tenant', ?, ?, ?, 'Member', 'member', ?)`, userId, `object-${suffix}`, `member-${suffix}@example.test`, `member-${suffix}@example.test`, now);
  run(db, `INSERT INTO flows(id, owner_user_id, name, state, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?)`, flowId, userId, `Flow ${suffix}`, now, now);
  run(db, `INSERT INTO template_versions(id, flow_id, version, subject_template, body_html, recipient_configuration_json, placeholder_manifest_json, created_at)
    VALUES (?, ?, 1, 'Subject', '<p>Body</p>', '{}', '[]', ?)`, templateId, flowId, now);
  run(db, `INSERT INTO campaigns(id, flow_id, template_version_id, owner_user_id, sender_address,
    total_recipients, valid_recipients, skipped_recipients, pace_per_minute, state, idempotency_key, created_at, queued_at, started_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, 1, 0, 12, 'running', ?, ?, ?, ?, ?)`,
    campaignId, flowId, templateId, userId, `member-${suffix}@example.test`, `key-${suffix}`, now, now, now, now);
  run(db, `INSERT INTO recipient_jobs(id, campaign_id, source_row, recipient, cc_json, bcc_json,
    rendered_subject, rendered_body_html, send_key, status, attempt_count, claim_token, claimed_at, created_at, updated_at)
    VALUES (?, ?, 1, 'to@example.test', '[]', '[]', 'Subject', '<p>Body</p>', ?, 'claimed', 1, ?, ?, ?, ?)`,
    jobId, campaignId, `send-${suffix}`, `claim-${suffix}`, now, now, now);
  return { userId, campaignId, jobId };
}

function leaseRequest(ids: { userId: string; campaignId: string; jobId: string }, suffix: string, count = 1) {
  const now = "2026-09-05T00:00:00.000Z";
  return {
    attemptId: `delivery-${suffix}`,
    attemptToken: `attempt-${suffix}`,
    ownerUserId: ids.userId,
    campaignId: ids.campaignId,
    recipientJobId: ids.jobId,
    testSendId: null,
    envelopeRecipientCount: count,
    now,
    leaseExpiresAt: "2026-09-05T00:05:00.000Z",
    budgetExpiresAt: new Date(Date.parse(now) + MAILBOX_BUDGET_WINDOW_MS).toISOString(),
  };
}

describe("D1 mailbox delivery coordination", () => {
  it("counts duplicate envelope occurrences conservatively", () => {
    expect(envelopeRecipientCount({
      to: "same@example.test",
      cc: ["same@example.test", "same@example.test"],
      bcc: ["same@example.test"],
    })).toBe(4);
  });

  it("atomically grants only one mailbox lease to concurrent campaigns", async () => {
    const db = migratedDatabase();
    try {
      const first = seedCampaign(db, "1");
      const second = seedCampaign(db, "2");
      run(db, "UPDATE campaigns SET owner_user_id = ?, sender_address = ? WHERE id = ?", first.userId, "member-1@example.test", second.campaignId);
      const repo = new D1MailboxDeliveryRepository(db);
      const results = await Promise.all([
        repo.acquire(leaseRequest(first, "one")),
        repo.acquire({ ...leaseRequest({ ...second, userId: first.userId }, "two"), recipientJobId: second.jobId }),
      ]);
      expect(results.filter((result) => result.kind === "acquired")).toHaveLength(1);
      expect(results.filter((result) => result.kind === "unavailable")).toHaveLength(1);
      expect(Number(db.database.prepare("SELECT COUNT(*) AS count FROM delivery_attempts").get()?.count)).toBe(1);
    } finally {
      db.close();
    }
  });

  it("stores one effective wake and consumes a duplicate token once", async () => {
    const db = migratedDatabase();
    try {
      const ids = seedCampaign(db);
      const campaigns = new D1CampaignRepository(db);
      const reserved = await Promise.all([
        campaigns.reserveWake(ids.campaignId, "wake-one", "2026-09-05T00:01:00.000Z", "Ready", "2026-09-05T00:00:00.000Z"),
        campaigns.reserveWake(ids.campaignId, "wake-two", "2026-09-05T00:01:00.000Z", "Ready", "2026-09-05T00:00:00.000Z"),
      ]);
      expect(reserved.sort()).toEqual([false, true]);
      const stored = await campaigns.getById(ids.campaignId);
      const token = stored?.wakeToken ?? "";
      expect(await campaigns.consumeWake(ids.campaignId, token, "2026-09-05T00:01:00.000Z")).not.toBeNull();
      expect(await campaigns.consumeWake(ids.campaignId, token, "2026-09-05T00:01:00.000Z")).toBeNull();
    } finally {
      db.close();
    }
  });

  it("returns the earliest rolling-window release that frees enough budget", async () => {
    const db = migratedDatabase();
    try {
      const ids = seedCampaign(db);
      run(db, "INSERT INTO delivery_attempts(id, owner_user_id, campaign_id, recipient_job_id, attempt_token, envelope_recipient_count, state, reserved_at, completed_at, budget_expires_at) VALUES ('old-1', ?, ?, ?, 'old-token-1', 1, 'accepted', ?, ?, ?)", ids.userId, ids.campaignId, ids.jobId, "2026-09-04T02:00:00.000Z", "2026-09-04T02:00:01.000Z", "2026-09-05T02:00:00.000Z");
      run(db, "INSERT INTO delivery_attempts(id, owner_user_id, campaign_id, recipient_job_id, attempt_token, envelope_recipient_count, state, reserved_at, completed_at, budget_expires_at) VALUES ('old-2', ?, ?, ?, 'old-token-2', 7997, 'unknown', ?, ?, ?)", ids.userId, ids.campaignId, ids.jobId, "2026-09-04T03:00:00.000Z", "2026-09-04T03:00:01.000Z", "2026-09-05T03:00:00.000Z");
      const decision = await new D1MailboxDeliveryRepository(db).acquire(leaseRequest(ids, "new", 4));
      expect(decision).toEqual({ kind: "unavailable", reason: "budget", nextAvailableAt: "2026-09-05T03:00:00.000Z" });
    } finally {
      db.close();
    }
  });

  it("does not replace an expired provider-bound lease before recovery classifies it", async () => {
    const db = migratedDatabase();
    try {
      const first = seedCampaign(db, "bound");
      const second = seedCampaign(db, "waiting");
      run(db, "UPDATE campaigns SET owner_user_id = ?, sender_address = ? WHERE id = ?", first.userId, "member-bound@example.test", second.campaignId);
      const repo = new D1MailboxDeliveryRepository(db);
      expect((await repo.acquire({
        ...leaseRequest(first, "bound"),
        leaseExpiresAt: "2026-09-05T00:01:00.000Z",
      })).kind).toBe("acquired");
      expect(await repo.markCampaignProviderBound(
        "attempt-bound",
        first.jobId,
        "claim-bound",
        "2026-09-05T00:00:01.000Z",
        "2026-09-05T00:01:00.000Z",
      )).toBe(true);

      const decision = await repo.acquire({
        ...leaseRequest({ ...second, userId: first.userId }, "waiting"),
        recipientJobId: second.jobId,
        now: "2026-09-05T00:02:00.000Z",
        leaseExpiresAt: "2026-09-05T00:07:00.000Z",
        budgetExpiresAt: "2026-09-06T00:02:00.000Z",
      });
      expect(decision).toEqual({ kind: "unavailable", reason: "lease", nextAvailableAt: "2026-09-05T00:07:00.000Z" });
      expect(Number(db.database.prepare("SELECT COUNT(*) AS count FROM delivery_attempts").get()?.count)).toBe(1);
    } finally {
      db.close();
    }
  });

  it("charges accepted work but releases a provider-proven safe retry", async () => {
    const db = migratedDatabase();
    try {
      const ids = seedCampaign(db);
      const repo = new D1MailboxDeliveryRepository(db);
      expect((await repo.acquire(leaseRequest(ids, "accepted", 3))).kind).toBe("acquired");
      expect(await repo.markCampaignProviderBound("attempt-accepted", ids.jobId, "claim-1", "2026-09-05T00:00:01.000Z", "2026-09-05T00:05:01.000Z")).toBe(true);
      expect(await repo.completeCampaignAttempt({
        attemptToken: "attempt-accepted", ownerUserId: ids.userId, campaignId: ids.campaignId,
        recipientJobId: ids.jobId, claimToken: "claim-1", now: "2026-09-05T00:00:02.000Z",
        nextSendAt: "2026-09-05T00:00:07.000Z", outcome: "accepted",
      })).toBe(true);
      expect(db.database.prepare("SELECT state FROM delivery_attempts WHERE attempt_token = 'attempt-accepted'").get()?.state).toBe("accepted");

      const paced = await repo.acquire({
        ...leaseRequest(ids, "paced"),
        now: "2026-09-05T00:00:03.000Z",
        leaseExpiresAt: "2026-09-05T00:05:03.000Z",
      });
      expect(paced).toEqual({ kind: "unavailable", reason: "pace", nextAvailableAt: "2026-09-05T00:00:07.000Z" });

      run(db, "UPDATE recipient_jobs SET status = 'claimed', claim_token = 'claim-2', claimed_at = '2026-09-05T00:00:08.000Z' WHERE id = ?", ids.jobId);
      const retryRequest = { ...leaseRequest(ids, "retry", 2), now: "2026-09-05T00:00:08.000Z", leaseExpiresAt: "2026-09-05T00:05:08.000Z" };
      expect((await repo.acquire(retryRequest)).kind).toBe("acquired");
      expect(await repo.markCampaignProviderBound("attempt-retry", ids.jobId, "claim-2", "2026-09-05T00:00:09.000Z", "2026-09-05T00:05:09.000Z")).toBe(true);
      expect(await repo.completeCampaignAttempt({
        attemptToken: "attempt-retry", ownerUserId: ids.userId, campaignId: ids.campaignId,
        recipientJobId: ids.jobId, claimToken: "claim-2", now: "2026-09-05T00:00:10.000Z",
        nextSendAt: "2026-09-05T00:02:10.000Z", providerBackoffUntil: "2026-09-05T00:02:10.000Z",
        outcome: "retry", retryAt: "2026-09-05T00:02:10.000Z", category: "throttle", message: "Microsoft requested a pause.",
      })).toBe(true);
      expect(db.database.prepare("SELECT state FROM delivery_attempts WHERE attempt_token = 'attempt-retry'").get()?.state).toBe("not_submitted");
      const charged = db.database.prepare("SELECT SUM(envelope_recipient_count) AS count FROM delivery_attempts WHERE state IN ('reserved', 'provider_bound', 'accepted', 'unknown')").get()?.count;
      expect(Number(charged)).toBe(3);
      expect(db.database.prepare("SELECT provider_backoff_until FROM mailbox_send_state WHERE owner_user_id = ?").get(ids.userId)?.provider_backoff_until).toBe("2026-09-05T00:02:10.000Z");
      const blocked = await repo.acquire({
        ...leaseRequest(ids, "backoff"),
        now: "2026-09-05T00:01:00.000Z",
        leaseExpiresAt: "2026-09-05T00:06:00.000Z",
      });
      expect(blocked).toEqual({ kind: "unavailable", reason: "provider_backoff", nextAvailableAt: "2026-09-05T00:02:10.000Z" });
    } finally {
      db.close();
    }
  });

  it("recovers pre-submission work to pending and provider-bound work to unknown idempotently", async () => {
    const db = migratedDatabase();
    try {
      const safeIds = seedCampaign(db, "safe");
      const unknownIds = seedCampaign(db, "unknown");
      const repo = new D1MailboxDeliveryRepository(db);
      await repo.acquire({ ...leaseRequest(safeIds, "safe"), leaseExpiresAt: "2026-09-05T00:01:00.000Z" });
      await repo.acquire({ ...leaseRequest(unknownIds, "unknown"), leaseExpiresAt: "2026-09-05T00:01:00.000Z" });
      await repo.markCampaignProviderBound("attempt-unknown", unknownIds.jobId, "claim-unknown", "2026-09-05T00:00:01.000Z", "2026-09-05T00:01:00.000Z");
      const events = await repo.recoverStale("2026-09-05T00:20:00.000Z", "2026-09-05T00:10:00.000Z", 10);
      expect(events.map((event) => event.kind).sort()).toEqual(["claimed_recovered", "provider_unknown"]);
      expect(db.database.prepare("SELECT status FROM recipient_jobs WHERE id = ?").get(safeIds.jobId)?.status).toBe("pending");
      expect(db.database.prepare("SELECT status FROM recipient_jobs WHERE id = ?").get(unknownIds.jobId)?.status).toBe("unknown");
      expect(await repo.recoverStale("2026-09-05T00:21:00.000Z", "2026-09-05T00:11:00.000Z", 10)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("hourly watchdog recovers a lost tick once and republishes one bounded wake", async () => {
    const db = migratedDatabase();
    try {
      const ids = seedCampaign(db, "watchdog");
      run(db, "UPDATE recipient_jobs SET status = 'pending', claim_token = NULL, claimed_at = NULL WHERE id = ?", ids.jobId);
      const messages: Array<{ body: unknown; delaySeconds: number | undefined }> = [];
      const bindings = {
        DB: db,
        CAMPAIGN_QUEUE: {
          send: async (body: unknown, options?: { delaySeconds?: number }) => {
            messages.push({ body, delaySeconds: options?.delaySeconds });
          },
        },
        ASSETS: { fetch: async () => new Response() },
      };
      const now = new Date("2026-09-05T01:00:00.000Z");
      await processSchedulerWatchdog(bindings, now);
      await processSchedulerWatchdog(bindings, now);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        body: { type: "campaign.tick", campaignId: ids.campaignId },
        delaySeconds: 0,
      });
      expect(typeof (messages[0]?.body as { wakeToken?: unknown }).wakeToken).toBe("string");
      expect(Number(db.database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'campaign.wake_recovered'").get()?.count)).toBe(1);
    } finally {
      db.close();
    }
  });

  it("marks a stale provider-bound test send unknown without releasing its budget charge", async () => {
    const db = migratedDatabase();
    try {
      const ids = seedCampaign(db, "test-recovery");
      const testSendId = "test-send-recovery";
      run(db, `INSERT INTO test_sends(id, owner_user_id, campaign_id, idempotency_key, request_fingerprint, status, created_at, updated_at)
        VALUES (?, ?, ?, 'test-key', 'fingerprint', 'pending', ?, ?)`, testSendId, ids.userId, ids.campaignId, Date.parse("2026-09-05T00:00:00.000Z"), Date.parse("2026-09-05T00:00:00.000Z"));
      const repo = new D1MailboxDeliveryRepository(db);
      const request = {
        ...leaseRequest(ids, "test-recovery"),
        recipientJobId: null,
        testSendId,
      };
      expect((await repo.acquire(request)).kind).toBe("acquired");
      expect(await repo.markTestProviderBound("attempt-test-recovery", testSendId, "2026-09-05T00:00:01.000Z", "2026-09-05T00:01:00.000Z")).toBe(true);
      const events = await repo.recoverStale("2026-09-05T00:20:00.000Z", "2026-09-05T00:10:00.000Z", 10);
      expect(events).toContainEqual({ kind: "test_unknown", campaignId: ids.campaignId, recipientJobId: null, testSendId });
      expect(db.database.prepare("SELECT status, error_code FROM test_sends WHERE id = ?").get(testSendId)).toMatchObject({ status: "failed", error_code: "test_send_recovery_unknown" });
      expect(db.database.prepare("SELECT state FROM delivery_attempts WHERE attempt_token = 'attempt-test-recovery'").get()?.state).toBe("unknown");
    } finally {
      db.close();
    }
  });

  it("charges an accepted test send as one recipient and releases only a proven no-send", async () => {
    const db = migratedDatabase();
    try {
      const ids = seedCampaign(db, "test-budget");
      const repo = new D1MailboxDeliveryRepository(db);
      const createTest = (id: string, key: string) => run(db, `INSERT INTO test_sends(
        id, owner_user_id, campaign_id, idempotency_key, request_fingerprint, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'fingerprint', 'pending', ?, ?)`, id, ids.userId, ids.campaignId, key,
      Date.parse("2026-09-05T00:00:00.000Z"), Date.parse("2026-09-05T00:00:00.000Z"));

      createTest("accepted-test", "accepted-key");
      expect((await repo.acquire({
        ...leaseRequest(ids, "accepted-test"),
        recipientJobId: null,
        testSendId: "accepted-test",
      })).kind).toBe("acquired");
      expect(await repo.markTestProviderBound("attempt-accepted-test", "accepted-test", "2026-09-05T00:00:01.000Z", "2026-09-05T00:05:01.000Z")).toBe(true);
      expect(await repo.completeTestAttempt({
        attemptToken: "attempt-accepted-test",
        ownerUserId: ids.userId,
        testSendId: "accepted-test",
        now: "2026-09-05T00:00:02.000Z",
        nextSendAt: "2026-09-05T00:00:07.000Z",
        acceptedResult: { status: "accepted", userMessage: "Accepted", senderAddress: "member@example.test", recipientAddress: "member@example.test" },
      })).toBe(true);

      createTest("safe-test", "safe-key");
      expect((await repo.acquire({
        ...leaseRequest(ids, "safe-test"),
        recipientJobId: null,
        testSendId: "safe-test",
        now: "2026-09-05T00:00:08.000Z",
        leaseExpiresAt: "2026-09-05T00:05:08.000Z",
      })).kind).toBe("acquired");
      expect(await repo.markTestProviderBound("attempt-safe-test", "safe-test", "2026-09-05T00:00:09.000Z", "2026-09-05T00:05:09.000Z")).toBe(true);
      expect(await repo.completeTestAttempt({
        attemptToken: "attempt-safe-test",
        ownerUserId: ids.userId,
        testSendId: "safe-test",
        now: "2026-09-05T00:00:10.000Z",
        nextSendAt: "2026-09-05T00:00:15.000Z",
        failure: { status: 503, code: "pre_send", message: "Not submitted" },
        safeToRetry: true,
      })).toBe(true);

      expect(db.database.prepare("SELECT state, envelope_recipient_count FROM delivery_attempts WHERE attempt_token = 'attempt-accepted-test'").get()).toMatchObject({ state: "accepted", envelope_recipient_count: 1 });
      expect(db.database.prepare("SELECT state FROM delivery_attempts WHERE attempt_token = 'attempt-safe-test'").get()).toMatchObject({ state: "not_submitted" });
      expect(db.database.prepare("SELECT id FROM test_sends WHERE id = 'safe-test'").get()).toBeUndefined();
      expect(Number(db.database.prepare("SELECT SUM(envelope_recipient_count) AS count FROM delivery_attempts WHERE state IN ('reserved', 'provider_bound', 'accepted', 'unknown')").get()?.count)).toBe(1);
    } finally {
      db.close();
    }
  });
});
