// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { CampaignRecord, RecipientJobRecord } from "../../domain/types";
import type { D1Database, D1PreparedStatement, D1RunResult, D1Value } from "./contracts";
import { D1CampaignRepository } from "./d1-campaigns";
import { D1RecipientJobRepository } from "./d1-recipient-jobs";
import { publicCampaign } from "../api/helpers";

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
  lastBatchSize = 0;

  prepare(query: string): D1PreparedStatement {
    return new SqliteStatement(this.database, query);
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1RunResult[]> {
    this.lastBatchSize = statements.length;
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

  migrate(from = 1): void {
    const files = readdirSync(resolve(process.cwd(), "migrations"))
      .filter((filename) => /^\d{4}_.+\.sql$/u.test(filename))
      .sort();
    for (const filename of files.slice(from - 1)) {
      this.database.exec(readFileSync(resolve(process.cwd(), "migrations", filename), "utf8"));
    }
  }

  close(): void {
    this.database.close();
  }
}

const NOW = "2026-09-05T00:00:00.000Z";
const FINGERPRINT = "a".repeat(43);

function run(db: SqliteD1, query: string, ...values: SqliteValue[]): void {
  db.database.prepare(query).run(...values);
}

function seedOwnerFlowTemplate(db: SqliteD1, suffix = "1"): { userId: string; flowId: string; templateId: string } {
  const userId = `user-${suffix}`;
  const flowId = `flow-${suffix}`;
  const templateId = `template-${suffix}`;
  run(db, `INSERT INTO users(id, tenant_id, object_id, principal_name, mailbox_address, display_name, role, created_at)
    VALUES (?, 'tenant', ?, ?, ?, 'Member', 'member', ?)`, userId, `object-${suffix}`, `member-${suffix}@example.test`, `member-${suffix}@example.test`, NOW);
  run(db, `INSERT INTO flows(id, owner_user_id, name, state, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?)`, flowId, userId, `Flow ${suffix}`, NOW, NOW);
  run(db, `INSERT INTO template_versions(id, flow_id, version, subject_template, body_html, recipient_configuration_json, placeholder_manifest_json, created_at)
    VALUES (?, ?, 1, 'Subject', '<p>Body</p>', '{}', '[]', ?)`, templateId, flowId, NOW);
  return { userId, flowId, templateId };
}

function campaign(owner: { userId: string; flowId: string; templateId: string }, count: number, suffix = "1"): CampaignRecord {
  return {
    id: `campaign-${suffix}`,
    flowId: owner.flowId,
    templateVersionId: owner.templateId,
    ownerUserId: owner.userId,
    senderAddress: `member-${owner.userId.slice(5)}@example.test`,
    sourceFilename: "recipients.csv",
    totalRecipients: count,
    validRecipients: count,
    skippedRecipients: 0,
    pacePerMinute: 12,
    state: "validated",
    pauseReason: null,
    idempotencyKey: `request-${suffix}`,
    requestFingerprint: FINGERPRINT,
    createdAt: NOW,
    queuedAt: null,
    startedAt: null,
    completedAt: null,
    updatedAt: NOW,
  };
}

function jobs(campaignId: string, count: number): RecipientJobRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `job-${index + 1}`,
    campaignId,
    sourceRow: index + 1,
    recipient: `recipient-${index + 1}@example.test`,
    cc: [],
    bcc: [],
    replyTo: [],
    importance: "normal",
    mergeData: { name: `Recipient ${index + 1}` },
    renderedSubject: `Subject ${index + 1}`,
    renderedBodyHtml: `<p>Body ${index + 1}</p>`,
    sendKey: `send-${index + 1}`,
    status: "pending",
    attemptCount: 0,
    claimToken: null,
    claimedAt: null,
    sendingAt: null,
    acceptedAt: null,
    nextAttemptAt: null,
    lastErrorCategory: null,
    lastErrorMessage: null,
    providerMessageId: null,
    providerRequestId: null,
    createdAt: NOW,
    updatedAt: NOW,
  }));
}

function auditEvents(campaignId: string) {
  return [
    { id: "audit-created", actorUserId: "user-1", campaignId, recipientJobId: null, eventType: "campaign.created" as const, metadata: {}, createdAt: NOW },
    { id: "audit-validated", actorUserId: "user-1", campaignId, recipientJobId: null, eventType: "campaign.validated" as const, metadata: {}, createdAt: NOW },
  ];
}

describe("D1 campaign creation safeguards", () => {
  it("migrates legacy campaigns without inventing request fingerprints", () => {
    const db = new SqliteD1();
    try {
      const migrationFiles = readdirSync(resolve(process.cwd(), "migrations")).filter((name) => /^\d{4}_.+\.sql$/u.test(name)).sort();
      for (const filename of migrationFiles.slice(0, 7)) db.database.exec(readFileSync(resolve(process.cwd(), "migrations", filename), "utf8"));
      const owner = seedOwnerFlowTemplate(db);
      run(db, `INSERT INTO campaigns(id, flow_id, template_version_id, owner_user_id, sender_address,
        total_recipients, valid_recipients, skipped_recipients, pace_per_minute, state, idempotency_key, created_at, updated_at)
        VALUES ('legacy', ?, ?, ?, 'member-1@example.test', 1, 1, 0, 12, 'completed', 'legacy-key', ?, ?)`,
      owner.flowId, owner.templateId, owner.userId, NOW, NOW);
      db.database.exec(readFileSync(resolve(process.cwd(), "migrations", migrationFiles[7]), "utf8"));
      expect(db.database.prepare("SELECT request_fingerprint FROM campaigns WHERE id = 'legacy'").get()).toEqual({ request_fingerprint: null });
    } finally {
      db.close();
    }
  });

  it("lists owner-scoped campaigns with current counts, newest first, including empty legacy jobs", async () => {
    const db = new SqliteD1();
    try {
      db.migrate();
      const owner = seedOwnerFlowTemplate(db);
      const otherOwner = seedOwnerFlowTemplate(db, "2");
      const repository = new D1CampaignRepository(db);
      const value = campaign(owner, 7);
      await repository.create(value, jobs(value.id, 7));
      const statuses = ["pending", "claimed", "sending", "accepted", "failed", "skipped", "unknown"] as const;
      statuses.forEach((status, index) => run(db, "UPDATE recipient_jobs SET status = ? WHERE id = ?", status, `job-${index + 1}`));

      const other = campaign(otherOwner, 1, "other");
      await repository.create(other, jobs(other.id, 1).map((job) => ({ ...job, id: "other-job", sendKey: "other-send" })));
      const empty = { ...campaign(owner, 1, "empty"), createdAt: "2026-09-05T01:00:00.000Z" };
      await repository.create(empty, jobs(empty.id, 1).map((job) => ({ ...job, id: "empty-job", sendKey: "empty-send" })));
      run(db, "DELETE FROM recipient_jobs WHERE campaign_id = ?", empty.id);

      const listed = await repository.listByOwner(owner.userId);
      expect(listed.map((entry) => entry.id)).toEqual([empty.id, value.id]);
      expect(listed[0].counts).toEqual({ pending: 0, claimed: 0, sending: 0, accepted: 0, failed: 0, skipped: 0, unknown: 0 });
      expect(listed[1].counts).toEqual({ pending: 1, claimed: 1, sending: 1, accepted: 1, failed: 1, skipped: 1, unknown: 1 });
      expect(listed[1].counts).toEqual(await new D1RecipientJobRepository(db).counts(value.id));
      expect((await repository.listByOwner(owner.userId, 1)).map((entry) => entry.id)).toEqual([empty.id]);
      expect(await repository.listByOwner("unknown-owner")).toEqual([]);

      const serialized = publicCampaign({ ...listed[1], wakeToken: "private-wake", wakeDueAt: NOW });
      expect(serialized.counts).toEqual(listed[1].counts);
      for (const key of ["idempotencyKey", "requestFingerprint", "wakeToken", "wakeDueAt", "counts_json"]) {
        expect(serialized).not.toHaveProperty(key);
      }
      run(db, "UPDATE recipient_jobs SET status = 'accepted' WHERE id = 'job-1'");
      expect((await repository.listByOwner(owner.userId))[1].counts).toMatchObject({ pending: 0, accepted: 2 });
    } finally {
      db.close();
    }
  });

  it("atomically persists the 300-row product limit with a small D1 batch", async () => {
    const db = new SqliteD1();
    try {
      db.migrate();
      const owner = seedOwnerFlowTemplate(db);
      const value = campaign(owner, 300);
      await new D1CampaignRepository(db).create(value, jobs(value.id, 300), null, auditEvents(value.id));
      expect(db.lastBatchSize).toBeLessThan(10);
      expect(db.database.prepare("SELECT COUNT(*) AS count FROM recipient_jobs WHERE campaign_id = ?").get(value.id)).toEqual({ count: 300 });
      expect(db.database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE campaign_id = ?").get(value.id)).toEqual({ count: 2 });
      expect(await new D1CampaignRepository(db).getById(value.id)).toMatchObject({ state: "validated", requestFingerprint: FINGERPRINT });
    } finally {
      db.close();
    }
  });

  it("splits large recipient snapshots below the D1 bound without losing atomicity", async () => {
    const db = new SqliteD1();
    try {
      db.migrate();
      const owner = seedOwnerFlowTemplate(db);
      const value = campaign(owner, 9);
      const largeJobs = jobs(value.id, 9).map((job) => ({ ...job, renderedBodyHtml: `<p>${"x".repeat(180_000)}</p>` }));
      await new D1CampaignRepository(db).create(value, largeJobs);
      expect(db.lastBatchSize).toBe(5);
      expect(db.database.prepare("SELECT COUNT(*) AS count FROM recipient_jobs WHERE campaign_id = ?").get(value.id)).toEqual({ count: 9 });
      expect(db.database.prepare("SELECT state FROM campaigns WHERE id = ?").get(value.id)).toEqual({ state: "validated" });
    } finally {
      db.close();
    }
  });

  it("rolls back the campaign and every job when a bulk row violates a unique constraint", async () => {
    const db = new SqliteD1();
    try {
      db.migrate();
      const owner = seedOwnerFlowTemplate(db);
      const value = campaign(owner, 2);
      const duplicates = jobs(value.id, 2).map((job) => ({ ...job, sourceRow: 1 }));
      await expect(new D1CampaignRepository(db).create(value, duplicates, null, auditEvents(value.id))).rejects.toThrow(/unique/iu);
      expect(db.database.prepare("SELECT COUNT(*) AS count FROM campaigns").get()).toEqual({ count: 0 });
      expect(db.database.prepare("SELECT COUNT(*) AS count FROM recipient_jobs").get()).toEqual({ count: 0 });
      expect(db.database.prepare("SELECT COUNT(*) AS count FROM audit_events").get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("rolls back every row when the attachment association loses its guard", async () => {
    const db = new SqliteD1();
    try {
      db.migrate();
      const owner = seedOwnerFlowTemplate(db);
      run(db, `INSERT INTO attachment_sets(id, owner_user_id, upload_idempotency_key, file_count,
        total_bytes, state, expires_at, created_at, updated_at)
        VALUES ('set-1', ?, 'upload-1', 1, 10, 'locked', ?, ?, ?)`, owner.userId, NOW, NOW, NOW);
      const value = campaign(owner, 1);
      await expect(new D1CampaignRepository(db).create(value, jobs(value.id, 1), "set-1")).rejects.toThrow(/mailbox_coordination_guard/iu);
      expect(db.database.prepare("SELECT COUNT(*) AS count FROM campaigns").get()).toEqual({ count: 0 });
      expect(db.database.prepare("SELECT COUNT(*) AS count FROM recipient_jobs").get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("rejects owner, sender, total, and fingerprint bypasses at the database boundary", () => {
    const db = new SqliteD1();
    try {
      db.migrate();
      const first = seedOwnerFlowTemplate(db, "1");
      const second = seedOwnerFlowTemplate(db, "2");
      const insert = `INSERT INTO campaigns(id, flow_id, template_version_id, owner_user_id, sender_address,
        total_recipients, valid_recipients, skipped_recipients, pace_per_minute, state, idempotency_key,
        request_fingerprint, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 12, 'draft', ?, ?, ?, ?)`;
      expect(() => run(db, insert, "wrong-owner", first.flowId, first.templateId, second.userId, "member-2@example.test", 1, 1, 0, "key-1", FINGERPRINT, NOW, NOW)).toThrow(/ownership/iu);
      expect(() => run(db, insert, "wrong-sender", first.flowId, first.templateId, first.userId, "member-2@example.test", 1, 1, 0, "key-2", FINGERPRINT, NOW, NOW)).toThrow(/sender/iu);
      expect(() => run(db, insert, "wrong-total", first.flowId, first.templateId, first.userId, "member-1@example.test", 2, 1, 0, "key-3", FINGERPRINT, NOW, NOW)).toThrow(/totals/iu);
      expect(() => run(db, insert, "no-fingerprint", first.flowId, first.templateId, first.userId, "member-1@example.test", 1, 1, 0, "key-4", null, NOW, NOW)).toThrow(/fingerprint/iu);
      expect(() => run(db, insert, "bad-fingerprint", first.flowId, first.templateId, first.userId, "member-1@example.test", 1, 1, 0, "key-4b", "*".repeat(43), NOW, NOW)).toThrow(/fingerprint/iu);
      run(db, insert, "incomplete", first.flowId, first.templateId, first.userId, "member-1@example.test", 1, 1, 0, "key-5", FINGERPRINT, NOW, NOW);
      expect(() => run(db, `INSERT INTO recipient_jobs(id, campaign_id, source_row, recipient, cc_json, bcc_json,
        rendered_subject, rendered_body_html, send_key, status, attempt_count, created_at, updated_at)
        VALUES ('bad-job', 'incomplete', 1, 'to@example.test', '[1]', '[]', 'Subject', '<p>Body</p>',
        'bad-send', 'pending', 0, ?, ?)`, NOW, NOW)).toThrow(/address JSON/iu);
      expect(() => run(db, "UPDATE campaigns SET state = 'validated' WHERE id = 'incomplete'")).toThrow(/incomplete/iu);
      expect(db.database.prepare("SELECT state FROM campaigns WHERE id = 'incomplete'").get()).toEqual({ state: "draft" });
    } finally {
      db.close();
    }
  });

  it("keeps persisted campaign and recipient snapshots immutable", async () => {
    const db = new SqliteD1();
    try {
      db.migrate();
      const owner = seedOwnerFlowTemplate(db);
      const value = campaign(owner, 1);
      const recipient = jobs(value.id, 1);
      await new D1CampaignRepository(db).create(value, recipient);
      expect(() => run(db, "UPDATE campaigns SET sender_address = 'other@example.test' WHERE id = ?", value.id)).toThrow(/immutable/iu);
      expect(() => run(db, "UPDATE recipient_jobs SET rendered_body_html = '<p>Changed</p>' WHERE id = ?", recipient[0].id)).toThrow(/immutable/iu);
      expect(db.database.prepare("SELECT sender_address FROM campaigns WHERE id = ?").get(value.id)).toEqual({ sender_address: "member-1@example.test" });
      expect(db.database.prepare("SELECT rendered_body_html FROM recipient_jobs WHERE id = ?").get(recipient[0].id)).toEqual({ rendered_body_html: "<p>Body 1</p>" });
    } finally {
      db.close();
    }
  });
});
