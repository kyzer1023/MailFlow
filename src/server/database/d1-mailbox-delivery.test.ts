// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MAILBOX_BUDGET_WINDOW_MS, envelopeRecipientCount } from "../../domain/mailbox-scheduler";
import { SqliteD1, type SqliteValue } from "../../../tests/helpers/sqlite-d1";
import { D1MailboxDeliveryRepository } from "./d1-mailbox-delivery";
import { D1CampaignRepository } from "./d1-campaigns";
import { D1RecipientJobRepository } from "./d1-recipient-jobs";
import { AttachmentError } from "../attachments";
import { processCampaignTick, wakeMailboxHead } from "../queue/campaign-tick";
import type { CampaignTickDependencies, CampaignTickMessage } from "../queue/contracts";
import type { MailSendResult } from "../../domain/mail-provider";
import { processSchedulerWatchdog } from "../api/worker-runtime";

function migratedDatabase(lastMigration = 9999): SqliteD1 {
  const db = new SqliteD1();
  db.migrate(1, lastMigration);
  return db;
}

function run(db: SqliteD1, query: string, ...values: SqliteValue[]): void {
  db.database.prepare(query).run(...values);
}

function seedCampaign(
  db: SqliteD1,
  suffix = "1",
  existingOwner?: { userId: string; mailboxAddress: string },
  recipientCount = 1,
): { userId: string; campaignId: string; jobId: string } {
  const userId = existingOwner?.userId ?? `user-${suffix}`;
  const mailboxAddress = existingOwner?.mailboxAddress ?? `member-${suffix}@example.test`;
  const flowId = `flow-${suffix}`;
  const templateId = `template-${suffix}`;
  const campaignId = `campaign-${suffix}`;
  const jobId = `job-${suffix}`;
  const now = "2026-09-05T00:00:00.000Z";
  if (!existingOwner) {
    run(db, `INSERT INTO users(id, tenant_id, object_id, principal_name, mailbox_address, display_name, role, created_at)
      VALUES (?, 'tenant', ?, ?, ?, 'Member', 'member', ?)`, userId, `object-${suffix}`, mailboxAddress, mailboxAddress, now);
  }
  run(db, `INSERT INTO flows(id, owner_user_id, name, state, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?)`, flowId, userId, `Flow ${suffix}`, now, now);
  run(db, `INSERT INTO template_versions(id, flow_id, version, subject_template, body_html, recipient_configuration_json, placeholder_manifest_json, created_at)
    VALUES (?, ?, 1, 'Subject', '<p>Body</p>', '{}', '[]', ?)`, templateId, flowId, now);
  run(db, `INSERT INTO campaigns(id, flow_id, template_version_id, owner_user_id, sender_address,
    total_recipients, valid_recipients, skipped_recipients, pace_per_minute, state, idempotency_key,
    request_fingerprint, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 12, 'draft', ?, ?, ?, ?)`,
    campaignId, flowId, templateId, userId, mailboxAddress, recipientCount, recipientCount, `key-${suffix}`, suffix.padEnd(43, "a").slice(0, 43), now, now);
  for (let row = 1; row <= recipientCount; row += 1) {
    const rowJobId = row === 1 ? jobId : `${jobId}-${row}`;
    run(db, `INSERT INTO recipient_jobs(id, campaign_id, source_row, recipient, cc_json, bcc_json,
      rendered_subject, rendered_body_html, send_key, status, attempt_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, '[]', '[]', 'Subject', '<p>Body</p>', ?, 'pending', 0, ?, ?)`,
      rowJobId, campaignId, row, `to-${row}@example.test`, `send-${suffix}-${row}`, now, now);
  }
  run(db, "UPDATE campaigns SET state = 'validated' WHERE id = ?", campaignId);
  run(db, "UPDATE campaigns SET state = 'running', queued_at = ?, started_at = ? WHERE id = ?", now, now, campaignId);
  run(db, "UPDATE recipient_jobs SET status = 'claimed', attempt_count = 1, claim_token = ?, claimed_at = ? WHERE id = ?", `claim-${suffix}`, now, jobId);
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
      const second = seedCampaign(db, "2", { userId: first.userId, mailboxAddress: "member-1@example.test" });
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

  it("persists bounded attachment retry state and clears it after recovery", async () => {
    const db = migratedDatabase();
    try {
      const ids = seedCampaign(db, "attachment-retry");
      const campaigns = new D1CampaignRepository(db);
      expect(await campaigns.markAttachmentRetry(
        ids.campaignId,
        "2026-09-05T00:00:30.000Z",
        "Campaign attachments are temporarily unavailable.",
        "2026-09-05T00:00:00.000Z",
      )).toBe(true);
      expect(await campaigns.markAttachmentRetry(
        ids.campaignId,
        "2026-09-05T00:01:30.000Z",
        "Campaign attachments are temporarily unavailable.",
        "2026-09-05T00:00:30.000Z",
      )).toBe(true);
      expect(await campaigns.getById(ids.campaignId)).toMatchObject({
        attachmentIssueCode: "attachment_retrying",
        attachmentRetryCount: 2,
        schedulerNextAttemptAt: "2026-09-05T00:01:30.000Z",
      });
      expect(await campaigns.clearAttachmentIssue(ids.campaignId, "2026-09-05T00:01:30.000Z")).toBe(true);
      expect(await campaigns.getById(ids.campaignId)).toMatchObject({
        attachmentIssueCode: null,
        attachmentRetryCount: 0,
        schedulerNextAttemptAt: null,
        schedulerMessage: null,
      });
    } finally {
      db.close();
    }
  });

  it("resumes an authorization pause by claiming only a pending row", async () => {
    const db = migratedDatabase();
    try {
      const ids = seedCampaign(db, "attachment-resume", undefined, 3);
      const campaigns = new D1CampaignRepository(db);
      const jobs = new D1RecipientJobRepository(db);
      run(db, "UPDATE recipient_jobs SET status = 'accepted', claim_token = NULL, claimed_at = NULL WHERE id = ?", ids.jobId);
      run(db, "UPDATE recipient_jobs SET status = 'unknown', attempt_count = 1 WHERE id = ?", `${ids.jobId}-2`);

      expect(await campaigns.pauseForAttachmentAuthorization(
        ids.campaignId,
        ids.userId,
        "2026-09-05T00:00:01.000Z",
        "Reconnect OneDrive, then resume from the pending rows.",
      )).toBe(true);
      expect(await campaigns.resume(ids.campaignId, ids.userId, "2026-09-05T00:00:02.000Z")).toBe(true);
      await campaigns.markRunningIfQueued(ids.campaignId, "2026-09-05T00:01:00.000Z");
      const claimed = await jobs.claimNextPending(ids.campaignId, "2026-09-05T00:00:03.000Z", "claim-resumed");

      expect(claimed?.id).toBe(`${ids.jobId}-3`);
      expect((await jobs.getById(ids.jobId))?.status).toBe("accepted");
      expect((await jobs.getById(`${ids.jobId}-2`))?.status).toBe("unknown");
      expect(await campaigns.getById(ids.campaignId)).toMatchObject({
        state: "running",
        attachmentIssueCode: null,
        attachmentRetryCount: 0,
      });
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
      const second = seedCampaign(db, "waiting", { userId: first.userId, mailboxAddress: "member-bound@example.test" });
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


function fifoHarness(db: SqliteD1) {
  const campaigns = new D1CampaignRepository(db);
  const messages: { message: CampaignTickMessage; dueAt: number }[] = [];
  let clock = Date.parse("2026-09-05T00:00:00.000Z");
  const send = vi.fn(async (): Promise<MailSendResult> => ({ kind: "accepted" }));
  const dependencies: CampaignTickDependencies = {
    campaigns, recipientJobs: new D1RecipientJobRepository(db), mailboxDelivery: new D1MailboxDeliveryRepository(db),
    audit: { append: async () => {}, listByCampaign: async () => [] },
    queue: { enqueue: async (message, options) => { messages.push({ message, dueAt: clock + (options?.delaySeconds ?? 0) * 1000 }); } },
    attachmentLoader: async () => [], attachmentCleanup: async () => {}, mailProvider: { send }, now: () => new Date(clock),
  };
  return {
    campaigns, dependencies, messages, send,
    now: () => new Date(clock).toISOString(),
    wake: (ownerUserId: string) => wakeMailboxHead({ campaigns, queue: dependencies.queue, ownerUserId, now: new Date(clock) }),
    next: async () => {
      const next = messages.shift();
      if (!next) throw new Error("No effective wake was published");
      clock = Math.max(clock, next.dueAt);
      return processCampaignTick(next.message, dependencies);
    },
  };
}

function queueFixture(db: SqliteD1, suffix: string, owner?: { userId: string; mailboxAddress: string }, rows = 1) {
  const ids = seedCampaign(db, suffix, owner, rows);
  run(db, "UPDATE recipient_jobs SET status = 'pending', claim_token = NULL, claimed_at = NULL, attempt_count = 0 WHERE campaign_id = ?", ids.campaignId);
  run(db, "UPDATE campaigns SET state = 'queued', started_at = NULL WHERE id = ?", ids.campaignId);
  return ids;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("FIFO campaign turns and cancellation", () => {
  it("recognizes a trigger-backed start and resume, while rejected transitions remain false", async () => {
    const db = migratedDatabase();
    try {
      const a = queueFixture(db, "start-result");
      run(db, "UPDATE campaigns SET state = 'validated' WHERE id = ?", a.campaignId);
      const h = fifoHarness(db);
      expect(await h.campaigns.queue(a.campaignId, "other-owner", h.now())).toBe(false);
      expect(await h.campaigns.queue(a.campaignId, a.userId, h.now())).toBe(true);
      expect(await h.campaigns.queue(a.campaignId, a.userId, h.now())).toBe(false);
      await h.wake(a.userId);
      expect(h.messages).toHaveLength(1);
      expect(await h.campaigns.pause(a.campaignId, a.userId, h.now(), "Member pause")).toBe(true);
      expect(await h.campaigns.pause(a.campaignId, a.userId, h.now(), "Member pause")).toBe(false);
      expect(await h.campaigns.resume(a.campaignId, a.userId, h.now())).toBe(true);
      expect(await h.campaigns.resume(a.campaignId, a.userId, h.now())).toBe(false);
      h.messages.length = 0;
      await h.wake(a.userId);
      expect(await h.next()).toMatchObject({ kind: "completed", campaignId: a.campaignId });
      expect(h.send).toHaveBeenCalledTimes(1);
    } finally { db.close(); }
  });

  it("a duplicate tick and watchdog do not wake an invocation still loading attachments", async () => {
    const db = migratedDatabase();
    try {
      const a = queueFixture(db, "duplicate-loading");
      const h = fifoHarness(db);
      const entered = deferred<void>(); const loaded = deferred<[]>();
      h.dependencies.attachmentLoader = async () => { entered.resolve(); return loaded.promise; };
      await h.wake(a.userId);
      const original = h.messages[0].message;
      const tick = h.next(); await entered.promise;
      expect(await processCampaignTick(original, h.dependencies)).toMatchObject({ kind: "ignored", reason: "stale_wake" });
      const send = vi.fn(async () => {});
      await processSchedulerWatchdog({ DB: db, CAMPAIGN_QUEUE: { send }, ASSETS: { fetch: async () => new Response() } }, new Date(h.now()));
      expect(send).not.toHaveBeenCalled();
      expect(h.messages).toHaveLength(0);
      loaded.resolve([]); await tick;
      expect(h.send).toHaveBeenCalledTimes(1);
      expect(h.messages).toHaveLength(0);
    } finally { db.close(); }
  });

  it("migrates legacy competing campaigns while preserving the in-flight head, effective wake, and budget evidence", async () => {
    const db = migratedDatabase(10);
    try {
      const a = seedCampaign(db, "legacy-a");
      const b = seedCampaign(db, "legacy-b", { userId: a.userId, mailboxAddress: "member-legacy-a@example.test" });
      const now = "2026-09-05T00:00:00.000Z";
      run(db, "UPDATE campaigns SET wake_token = ?, wake_due_at = ?, scheduler_next_attempt_at = ? WHERE id = ?", "old-a", "2026-09-05T00:05:00.000Z", "2026-09-05T00:05:00.000Z", a.campaignId);
      run(db, "UPDATE campaigns SET wake_token = ?, wake_due_at = ? WHERE id = ?", "old-b", "2026-09-05T00:00:05.000Z", b.campaignId);
      run(db, "UPDATE recipient_jobs SET status = 'sending', sending_at = ? WHERE id = ?", now, b.jobId);
      run(db, `INSERT INTO delivery_attempts(id, owner_user_id, campaign_id, recipient_job_id, attempt_token,
        envelope_recipient_count, state, reserved_at, provider_bound_at, budget_expires_at)
        VALUES ('legacy-attempt', ?, ?, ?, 'legacy-token', 1, 'provider_bound', ?, ?, '2026-09-06T00:00:00.000Z')`,
        a.userId, b.campaignId, b.jobId, now, now);
      const before = db.database.prepare("SELECT * FROM delivery_attempts").all();
      db.database.exec(readFileSync(resolve(process.cwd(), "migrations/0011_campaign_turns_cancellation.sql"), "utf8"));
      const campaigns = new D1CampaignRepository(db);
      expect((await campaigns.getById(a.campaignId))).toMatchObject({ state: "queued", wakeToken: null, schedulerNextAttemptAt: null });
      expect((await campaigns.getById(b.campaignId))).toMatchObject({ state: "running", wakeToken: "old-b", wakeDueAt: "2026-09-05T00:00:05.000Z" });
      expect(db.database.prepare("SELECT campaign_id FROM campaign_turns ORDER BY sequence").all().map(row => row.campaign_id)).toEqual([b.campaignId, a.campaignId]);
      expect(db.database.prepare("SELECT * FROM delivery_attempts").all()).toEqual(before);
      expect((await new D1RecipientJobRepository(db).getById(b.jobId))?.status).toBe("sending");
      expect((await new D1RecipientJobRepository(db).getById(a.jobId))).toMatchObject({ status: "pending", claimToken: null, attemptCount: 1 });
    } finally { db.close(); }
  });

  it("a cancelled campaign cannot acquire a new test-send reservation", async () => {
    const db = migratedDatabase();
    try {
      const a = queueFixture(db, "cancelled-test");
      const h = fifoHarness(db);
      await h.campaigns.cancel(a.campaignId, a.userId, h.now());
      const result = await h.dependencies.mailboxDelivery.acquire({ ...leaseRequest(a, "late-test"), recipientJobId: null, testSendId: "late-test" });
      expect(result.kind).toBe("unavailable");
      expect(db.database.prepare("SELECT COUNT(*) AS n FROM delivery_attempts").get()?.n).toBe(0);
    } finally { db.close(); }
  });

  it("preserves existing accepted, unknown, manual verification, and budget evidence when cancelling remaining work", async () => {
    const db = migratedDatabase();
    try {
      const a = queueFixture(db, "preserve", undefined, 3);
      const h = fifoHarness(db);
      h.send.mockResolvedValueOnce({ kind: "accepted", providerRequestId: "provider-accepted" });
      h.send.mockResolvedValueOnce({ kind: "unknown", category: "ambiguous", message: "Acknowledgement lost" });
      await h.wake(a.userId); await h.next(); await h.next();
      await h.dependencies.recipientJobs.verifyDelivery(`${a.jobId}-2`, a.campaignId, a.userId, h.now(), "Receipt checked");
      const evidence = db.database.prepare("SELECT * FROM recipient_jobs WHERE status IN ('accepted', 'unknown') ORDER BY id").all();
      const ledger = db.database.prepare("SELECT * FROM delivery_attempts ORDER BY id").all();
      await h.campaigns.cancel(a.campaignId, a.userId, h.now());
      expect(db.database.prepare("SELECT * FROM recipient_jobs WHERE status IN ('accepted', 'unknown') ORDER BY id").all()).toEqual(evidence);
      expect(db.database.prepare("SELECT * FROM delivery_attempts ORDER BY id").all()).toEqual(ledger);
      expect((await h.dependencies.recipientJobs.getById(`${a.jobId}-3`))?.attemptCount).toBe(0);
      await h.next(); // An already-published wake is now stale.
      expect(h.send).toHaveBeenCalledTimes(2);
      expect(await h.campaigns.resume(a.campaignId, a.userId, h.now())).toBe(false);
    } finally { db.close(); }
  });

  it("watchdog settles cancellation after a crashed provider-bound attempt as Unknown without resending it", async () => {
    const db = migratedDatabase();
    try {
      const a = seedCampaign(db, "crashed-cancel");
      const b = queueFixture(db, "after-crash", { userId: a.userId, mailboxAddress: "member-crashed-cancel@example.test" });
      const h = fifoHarness(db);
      await h.dependencies.mailboxDelivery.acquire(leaseRequest(a, "crash"));
      await h.dependencies.mailboxDelivery.markCampaignProviderBound("attempt-crash", a.jobId, "claim-crashed-cancel", h.now(), "2026-09-05T00:05:00.000Z");
      await h.campaigns.cancel(a.campaignId, a.userId, h.now());
      const send = vi.fn(async () => {});
      const result = await processSchedulerWatchdog({ DB: db, CAMPAIGN_QUEUE: { send }, ASSETS: { fetch: async () => new Response() } }, new Date("2026-09-05T00:15:00.000Z"));
      expect(result.completedCampaignIds).toContain(a.campaignId);
      expect((await h.campaigns.getById(a.campaignId))?.state).toBe("cancelled");
      expect((await h.dependencies.recipientJobs.getById(a.jobId))?.status).toBe("unknown");
      expect(db.database.prepare("SELECT state, envelope_recipient_count FROM delivery_attempts").get()).toMatchObject({ state: "unknown", envelope_recipient_count: 1 });
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ campaignId: b.campaignId }), { delaySeconds: 0 });
    } finally { db.close(); }
  });

  it("hands off after terminal attachment failure without claiming or submitting a recipient", async () => {
    const db = migratedDatabase();
    try {
      const a = queueFixture(db, "attachment-stop");
      const b = queueFixture(db, "after-attachment", { userId: a.userId, mailboxAddress: "member-attachment-stop@example.test" });
      const h = fifoHarness(db);
      h.dependencies.attachmentLoader = async () => { throw new AttachmentError("missing_object", "Missing reviewed attachment"); };
      await h.wake(a.userId); await h.next();
      expect((await h.campaigns.getById(a.campaignId))?.state).toBe("failed");
      expect((await h.dependencies.recipientJobs.getById(a.jobId))?.attemptCount).toBe(0);
      expect(h.messages.map(m => m.message.campaignId)).toEqual([b.campaignId]);
      expect(h.send).not.toHaveBeenCalled();
    } finally { db.close(); }
  });

  it("keeps followers dormant and hands off in order at mailbox pace", async () => {
    const db = migratedDatabase();
    try {
      const a = queueFixture(db, "fifo-a", undefined, 2);
      const owner = { userId: a.userId, mailboxAddress: "member-fifo-a@example.test" };
      const b = queueFixture(db, "fifo-b", owner);
      const c = queueFixture(db, "fifo-c", owner);
      const h = fifoHarness(db);
      expect(await h.campaigns.reserveWake(b.campaignId, "forged-follower-wake", h.now(), null, h.now())).toBe(false);
      expect(await h.campaigns.markRunningIfQueued(b.campaignId, h.now())).toBe(false);
      expect(await h.dependencies.recipientJobs.claimNextPending(b.campaignId, h.now(), "follower-claim")).toBeNull();
      await h.wake(a.userId);
      expect(h.messages.map(m => m.message.campaignId)).toEqual([a.campaignId]);
      await h.next();
      expect(h.messages.map(m => m.message.campaignId)).toEqual([a.campaignId]);
      expect((await h.campaigns.getById(b.campaignId))?.state).toBe("queued");
      expect((await h.campaigns.getById(c.campaignId))?.wakeToken).toBeNull();
      expect(await h.next()).toMatchObject({ kind: "completed", campaignId: a.campaignId });
      expect(h.messages.map(m => m.message.campaignId)).toEqual([b.campaignId]);
      expect(h.messages[0].dueAt - Date.parse(h.now())).toBe(5000);
      await h.next();
      expect(h.messages.map(m => m.message.campaignId)).toEqual([c.campaignId]);
      await h.next();
      expect(h.send).toHaveBeenCalledTimes(4);
      expect(h.messages).toHaveLength(0);
      expect(db.database.prepare("SELECT COUNT(*) AS n FROM campaign_turns").get()?.n).toBe(0);
    } finally { db.close(); }
  });

  it("lets a separate mailbox progress without waiting for another owner's turn", async () => {
    const db = migratedDatabase();
    try {
      const a = queueFixture(db, "owner-a");
      const b = queueFixture(db, "owner-b");
      const h = fifoHarness(db);
      await h.wake(a.userId); await h.wake(b.userId);
      expect(h.messages.map(m => m.message.campaignId)).toEqual([a.campaignId, b.campaignId]);
      await h.next(); await h.next();
      expect(h.send).toHaveBeenCalledTimes(2);
    } finally { db.close(); }
  });

  it.each(["pause", "cancel"] as const)("%s releases a pre-submission reservation and blocks the old provider boundary", async action => {
    const db = migratedDatabase();
    try {
      const a = seedCampaign(db, `pre-${action}`);
      const b = queueFixture(db, `next-${action}`, { userId: a.userId, mailboxAddress: `member-pre-${action}@example.test` });
      const h = fifoHarness(db);
      expect((await h.dependencies.mailboxDelivery.acquire(leaseRequest(a, action))).kind).toBe("acquired");
      const command = action === "pause"
        ? h.campaigns.pause(a.campaignId, a.userId, h.now(), "Paused by member")
        : h.campaigns.cancel(a.campaignId, a.userId, h.now());
      expect(await command).toBe(true);
      expect(await h.dependencies.mailboxDelivery.markCampaignProviderBound(`attempt-${action}`, a.jobId, `claim-pre-${action}`, h.now(), "2026-09-05T00:05:00.000Z")).toBe(false);
      expect((await h.dependencies.recipientJobs.getById(a.jobId))?.status).toBe("pending");
      expect(db.database.prepare("SELECT state FROM delivery_attempts").get()?.state).toBe("not_submitted");
      await h.wake(a.userId);
      expect(h.messages.map(m => m.message.campaignId)).toEqual([b.campaignId]);
      if (action === "cancel") {
        expect((await h.campaigns.getById(a.campaignId))?.state).toBe("cancelled");
        expect(await h.campaigns.resume(a.campaignId, a.userId, h.now())).toBe(false);
      }
    } finally { db.close(); }
  });

  it.each(["accepted", "unknown", "retry"] as const)("cancellation during submission preserves a %s result and settles before handoff", async outcome => {
    const db = migratedDatabase();
    try {
      const a = queueFixture(db, `bound-${outcome}`, undefined, 2);
      const b = queueFixture(db, `follower-${outcome}`, { userId: a.userId, mailboxAddress: `member-bound-${outcome}@example.test` });
      const h = fifoHarness(db);
      const entered = deferred<void>(); const result = deferred<MailSendResult>();
      h.send.mockImplementationOnce(async () => { entered.resolve(); return result.promise; });
      await h.wake(a.userId);
      const tick = h.next(); await entered.promise;
      expect(await h.campaigns.cancel(a.campaignId, a.userId, h.now())).toBe(true);
      expect((await h.campaigns.getById(a.campaignId))?.state).toBe("cancelling");
      await h.wake(a.userId);
      expect(h.messages).toHaveLength(0);
      result.resolve(outcome === "accepted" ? { kind: "accepted" } : outcome === "unknown"
        ? { kind: "unknown", category: "ambiguous", message: "Acknowledgement lost" }
        : { kind: "retryable", category: "throttle", safeToRetry: true, retryAfter: 120, message: "Throttled before submission" });
      await tick;
      expect((await h.campaigns.getById(a.campaignId))?.state).toBe("cancelled");
      expect((await h.dependencies.recipientJobs.getById(a.jobId))?.status).toBe(outcome === "retry" ? "pending" : outcome);
      expect((await h.dependencies.recipientJobs.getById(`${a.jobId}-2`))?.attemptCount).toBe(0);
      const attempt = db.database.prepare("SELECT state, envelope_recipient_count FROM delivery_attempts").get();
      expect(attempt).toMatchObject({ state: outcome === "retry" ? "not_submitted" : outcome, envelope_recipient_count: 1 });
      expect(h.messages.map(m => m.message.campaignId)).toEqual([b.campaignId]);
      expect(h.messages[0].dueAt - Date.parse(h.now())).toBe(outcome === "retry" ? 120000 : 5000);
      expect(h.send).toHaveBeenCalledTimes(1);
    } finally { db.close(); }
  });

  it("resume joins the back even while a paused campaign's provider call is settling", async () => {
    const db = migratedDatabase();
    try {
      const a = queueFixture(db, "resume-a", undefined, 2);
      const owner = { userId: a.userId, mailboxAddress: "member-resume-a@example.test" };
      const b = queueFixture(db, "resume-b", owner);
      const c = queueFixture(db, "resume-c", owner);
      const h = fifoHarness(db);
      const entered = deferred<void>(); const result = deferred<MailSendResult>();
      h.send.mockImplementationOnce(async () => { entered.resolve(); return result.promise; });
      await h.wake(a.userId); const tick = h.next(); await entered.promise;
      await h.campaigns.pause(a.campaignId, a.userId, h.now(), "Paused by member");
      await h.campaigns.resume(a.campaignId, a.userId, h.now());
      expect((await h.campaigns.getById(a.campaignId))?.state).toBe("queued");
      expect(db.database.prepare("SELECT campaign_id FROM campaign_turns ORDER BY sequence").all().map(row => row.campaign_id)).toEqual([b.campaignId, c.campaignId, a.campaignId]);
      await h.wake(a.userId); expect(h.messages).toHaveLength(0);
      result.resolve({ kind: "accepted" }); await tick;
      expect(h.messages[0].message.campaignId).toBe(b.campaignId);
      await h.next(); await h.next(); await h.next();
      expect(h.send).toHaveBeenCalledTimes(4);
      expect((await h.dependencies.recipientJobs.getById(a.jobId))?.attemptCount).toBe(1);
    } finally { db.close(); }
  });

  it("audits first cancellation once, rejects other owners, and rolls back if its audit cannot persist", async () => {
    const db = migratedDatabase();
    try {
      const a = queueFixture(db, "audit-cancel");
      const h = fifoHarness(db);
      expect(await h.campaigns.cancel(a.campaignId, "other-owner", h.now())).toBe(false);
      db.database.exec(`CREATE TRIGGER reject_cancel_audit BEFORE INSERT ON audit_events
        WHEN NEW.event_type = 'campaign.cancel_requested' BEGIN SELECT RAISE(ABORT, 'unavailable'); END`);
      await expect(h.campaigns.cancel(a.campaignId, a.userId, h.now())).rejects.toThrow();
      expect((await h.campaigns.getById(a.campaignId))?.state).toBe("queued");
      expect(db.database.prepare("SELECT COUNT(*) AS n FROM campaign_turns").get()?.n).toBe(1);
      db.database.exec("DROP TRIGGER reject_cancel_audit");
      expect(await Promise.all([
        h.campaigns.cancel(a.campaignId, a.userId, h.now()),
        h.campaigns.cancel(a.campaignId, a.userId, "2026-09-05T00:01:00.000Z"),
      ])).toEqual([true, true]);
      const original = await h.campaigns.getById(a.campaignId);
      expect(original?.cancelRequestedAt).toBe(h.now());
      expect(db.database.prepare("SELECT event_type FROM audit_events ORDER BY event_type").all().map(row => row.event_type)).toEqual(["campaign.cancel_requested", "campaign.cancelled"]);
      expect(() => run(db, "UPDATE campaigns SET state = 'queued' WHERE id = ?", a.campaignId)).toThrow("irreversible");
      expect(await h.campaigns.cancel(a.campaignId, a.userId, "2026-09-06T00:00:00.000Z")).toBe(true);
      expect(await h.campaigns.getById(a.campaignId)).toEqual(original);
    } finally { db.close(); }
  });

  it("recovers a missed handoff without publishing follower polling wakes", async () => {
    const db = migratedDatabase();
    try {
      const a = queueFixture(db, "recover-a");
      const owner = { userId: a.userId, mailboxAddress: "member-recover-a@example.test" };
      const b = queueFixture(db, "recover-b", owner);
      const c = queueFixture(db, "recover-c", owner);
      const h = fifoHarness(db);
      await h.campaigns.cancel(a.campaignId, a.userId, h.now());
      // Simulate an invocation lost after committing the stop but before publishing.
      const send = vi.fn(async () => {});
      await processSchedulerWatchdog({ DB: db, CAMPAIGN_QUEUE: { send }, ASSETS: { fetch: async () => new Response() } }, new Date("2026-09-05T00:15:00.000Z"));
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ campaignId: b.campaignId }), { delaySeconds: 0 });
      expect((await h.campaigns.getById(c.campaignId))?.wakeToken).toBeNull();
      await processSchedulerWatchdog({ DB: db, CAMPAIGN_QUEUE: { send }, ASSETS: { fetch: async () => new Response() } }, new Date("2026-09-05T00:15:01.000Z"));
      expect(send).toHaveBeenCalledTimes(1);
    } finally { db.close(); }
  });
});

describe("mail authorization recovery", () => {
  it("starts mailbox reservations after slow preparation finishes", async () => {
    const db = migratedDatabase();
    try {
      const ids = queueFixture(db, "slow-preparation");
      const h = fifoHarness(db);
      let clock = new Date(h.now());
      h.dependencies.now = () => clock;
      h.dependencies.attachmentLoader = async () => { clock = new Date(clock.getTime() + 6 * 60_000); return []; };
      await h.wake(ids.userId);
      expect(await h.next()).toMatchObject({ kind: "completed" });
      expect(h.send).toHaveBeenCalledOnce();
      const attempt = db.database.prepare("SELECT reserved_at, budget_expires_at, state FROM delivery_attempts WHERE campaign_id = ?").get(ids.campaignId)!;
      expect(attempt.reserved_at).toBe(clock.toISOString());
      expect(attempt.budget_expires_at).toBe(new Date(clock.getTime() + MAILBOX_BUDGET_WINDOW_MS).toISOString());
      expect(attempt.state).toBe("accepted");
    } finally { db.close(); }
  });
  it("reports aggregate recovery health without exporting recipient or coordination data", async () => {
    const db = migratedDatabase();
    try {
      const ids = queueFixture(db, "health");
      const campaigns = new D1CampaignRepository(db);
      await campaigns.pauseForMailAuthorization(ids.campaignId, ids.userId, "2026-09-06T00:00:00.000Z", "Reconnect Microsoft");
      const health = db.database.prepare(readFileSync(resolve("scripts/operations-health.sql"), "utf8")).get()!;
      expect(health).toMatchObject({ active_mailboxes: 0, runnable_campaigns: 0, mail_reconnect_pauses: 1, eligible_cleanup_sets: 0 });
      expect(Object.values(health).every(value => typeof value === "number")).toBe(true);
    } finally { db.close(); }
  });
  it.each(["missing", "revoked"])("pauses a %s grant before any claim and hands off the mailbox", async kind => {
    const { delegatedSmtpMailProvider } = await import("../microsoft/smtp-adapter");
    const { ExchangeOnlineSmtpClient } = await import("../microsoft/smtp");
    const { AuthFlowError } = await import("../auth/service");
    const { OAuthProviderError } = await import("../microsoft/oauth");
    const db = migratedDatabase();
    try {
      const first = queueFixture(db, "auth-first", undefined, 3);
      const second = queueFixture(db, "auth-second", { userId: first.userId, mailboxAddress: "member-auth-first@example.test" });
      run(db, "UPDATE recipient_jobs SET status = 'accepted' WHERE id = ?", `${first.jobId}-2`);
      run(db, "UPDATE recipient_jobs SET status = 'unknown' WHERE id = ?", `${first.jobId}-3`);
      const h = fifoHarness(db);
      const smtp = new ExchangeOnlineSmtpClient();
      const submit = vi.spyOn(smtp, "send");
      h.dependencies.mailProvider = delegatedSmtpMailProvider(smtp, async () => {
        throw kind === "missing" ? new AuthFlowError("token", "Missing grant") : new OAuthProviderError("invalid_grant", "Revoked grant");
      }, "member-auth-first@example.test");
      await h.wake(first.userId);
      expect(await h.next()).toMatchObject({ kind: "paused", reason: "mail_authorization" });
      expect(submit).not.toHaveBeenCalled();
      expect((await h.campaigns.getById(first.campaignId))).toMatchObject({ state: "paused", mailIssueCode: "mail_authorization_required" });
      expect(await h.dependencies.recipientJobs.getById(first.jobId)).toMatchObject({ status: "pending", attemptCount: 0 });
      expect(db.database.prepare("SELECT COUNT(*) AS n FROM delivery_attempts").get()?.n).toBe(0);
      expect(h.messages.map(entry => entry.message.campaignId)).toEqual([second.campaignId]);
      h.dependencies.mailProvider = { send: h.send };
      await h.next();
      expect(await h.campaigns.resume(first.campaignId, first.userId, h.now())).toBe(true);
      await h.wake(first.userId); await h.next();
      expect(h.send).toHaveBeenCalledTimes(2);
      expect(await h.dependencies.recipientJobs.getById(`${first.jobId}-2`)).toMatchObject({ status: "accepted" });
      expect(await h.dependencies.recipientJobs.getById(`${first.jobId}-3`)).toMatchObject({ status: "unknown" });
      expect((await h.campaigns.getById(first.campaignId))?.mailIssueCode).toBeNull();
    } finally { vi.restoreAllMocks(); db.close(); }
  });

  it("retries a temporary token failure without claiming, budget charges or unknown evidence", async () => {
    const db = migratedDatabase();
    try {
      const ids = queueFixture(db, "token-outage");
      const h = fifoHarness(db);
      h.dependencies.mailProvider = { prepare: async () => { throw new Error("private token store failure"); }, send: h.send };
      await h.wake(ids.userId);
      expect(await h.next()).toMatchObject({ kind: "waiting", reason: "authorization_retry", delaySeconds: 30 });
      expect(h.send).not.toHaveBeenCalled();
      expect(await h.dependencies.recipientJobs.getById(ids.jobId)).toMatchObject({ status: "pending", attemptCount: 0 });
      expect(db.database.prepare("SELECT COUNT(*) AS n FROM delivery_attempts").get()?.n).toBe(0);
      expect(h.messages).toHaveLength(1);
    } finally { db.close(); }
  });

  it.each([false, true])("settles provider authorization rejection atomically, cancellation=%s", async cancel => {
    const db = migratedDatabase();
    try {
      const ids = queueFixture(db, "smtp-denied", undefined, 2);
      const h = fifoHarness(db);
      h.send.mockImplementationOnce(async () => {
        if (cancel) await h.campaigns.cancel(ids.campaignId, ids.userId, h.now());
        return { kind: "reconnect_required", safeToRetry: true, category: "authentication", message: "Reconnect Microsoft" };
      });
      await h.wake(ids.userId); await h.next();
      expect((await h.campaigns.getById(ids.campaignId))?.state).toBe(cancel ? "cancelled" : "paused");
      expect(await h.dependencies.recipientJobs.getById(ids.jobId)).toMatchObject({ status: "pending", attemptCount: 1 });
      expect(db.database.prepare("SELECT state FROM delivery_attempts").get()).toMatchObject({ state: "not_submitted" });
      expect(db.database.prepare("SELECT lease_token FROM mailbox_send_state").get()).toMatchObject({ lease_token: null });
      expect(h.messages).toHaveLength(0);
    } finally { db.close(); }
  });

  it("rolls back a rejected-authorization settlement if persisting the pause fails", async () => {
    const db = migratedDatabase();
    try {
      const ids = seedCampaign(db, "pause-rollback");
      const repo = new D1MailboxDeliveryRepository(db);
      await repo.acquire(leaseRequest(ids, "pause-rollback"));
      await repo.markCampaignProviderBound("attempt-pause-rollback", ids.jobId, "claim-pause-rollback", "2026-09-05T00:00:00.000Z", "2026-09-05T00:05:00.000Z");
      db.database.exec("CREATE TRIGGER fail_mail_pause BEFORE UPDATE OF mail_issue_code ON campaigns BEGIN SELECT RAISE(ABORT, 'pause unavailable'); END");
      expect(await repo.completeCampaignAttempt({ attemptToken: "attempt-pause-rollback", ownerUserId: ids.userId, campaignId: ids.campaignId,
        recipientJobId: ids.jobId, claimToken: "claim-pause-rollback", now: "2026-09-05T00:00:01.000Z", nextSendAt: "2026-09-05T00:00:06.000Z", outcome: "pause" })).toBe(false);
      expect(db.database.prepare("SELECT status FROM recipient_jobs WHERE id = ?").get(ids.jobId)?.status).toBe("sending");
      expect(db.database.prepare("SELECT state FROM delivery_attempts").get()?.state).toBe("provider_bound");
    } finally { db.close(); }
  });
});
