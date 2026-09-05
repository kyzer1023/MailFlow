import { laterIso, mailboxWaitMessage } from "../../domain/mailbox-scheduler";
import { emptyCampaignCounts, type AuditEventRecord, type CampaignCounts, type CampaignRecord, type RecipientJobRecord } from "../../domain/types";
import type {
  CampaignRepository,
  D1Database,
  D1PreparedStatement,
} from "./contracts";
import { bind, changes, parseJson } from "./d1-helpers";
import { buildAuditEventInsert } from "./d1-audit";
import { buildRecipientJobInserts } from "./d1-recipient-jobs";

interface CampaignRow {
  cancel_requested_at: string | null;
  cancelled_at: string | null;
  delivery_verified_count?: number;
  id: string;
  flow_id: string;
  template_version_id: string;
  owner_user_id: string;
  sender_address: string;
  source_filename: string | null;
  total_recipients: number;
  valid_recipients: number;
  skipped_recipients: number;
  pace_per_minute: number;
  state: CampaignRecord["state"];
  pause_reason: string | null;
  idempotency_key: string;
  request_fingerprint: string | null;
  created_at: string;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  scheduler_next_attempt_at: string | null;
  scheduler_message: string | null;
  attachment_issue_code: CampaignRecord["attachmentIssueCode"] | null;
  attachment_retry_count: number;
  wake_token: string | null;
  wake_due_at: string | null;
  updated_at: string;
}

function toCampaign(row: CampaignRow): CampaignRecord {
  return {
    ...(row.delivery_verified_count !== undefined ? { deliveryVerifiedCount: row.delivery_verified_count } : {}),
    id: row.id,
    flowId: row.flow_id,
    templateVersionId: row.template_version_id,
    ownerUserId: row.owner_user_id,
    senderAddress: row.sender_address,
    sourceFilename: row.source_filename ?? null,
    totalRecipients: row.total_recipients,
    validRecipients: row.valid_recipients,
    skippedRecipients: row.skipped_recipients,
    pacePerMinute: row.pace_per_minute,
    state: row.cancelled_at ? "cancelled" : row.cancel_requested_at ? "cancelling" : row.state,
    cancelRequestedAt: row.cancel_requested_at ?? null,
    cancelledAt: row.cancelled_at ?? null,
    pauseReason: row.pause_reason ?? null,
    idempotencyKey: row.idempotency_key,
    requestFingerprint: row.request_fingerprint ?? null,
    createdAt: row.created_at,
    queuedAt: row.queued_at ?? null,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    schedulerNextAttemptAt: row.scheduler_next_attempt_at ?? null,
    schedulerMessage: row.scheduler_message ?? null,
    attachmentIssueCode: row.attachment_issue_code ?? null,
    attachmentRetryCount: Number(row.attachment_retry_count ?? 0),
    wakeToken: row.wake_token ?? null,
    wakeDueAt: row.wake_due_at ?? null,
    updatedAt: row.updated_at,
  };
}

export class D1CampaignRepository implements CampaignRepository {
  // Every boolean mutation targets one campaign by primary key. D1 meta.changes
  // includes trigger writes (FIFO turns and audits), so success is any change,
  // not exactly one. A failed conditional update still reports zero.
  constructor(private readonly db: D1Database) {}

  async getById(id: string): Promise<CampaignRecord | null> {
    const row = await bind(this.db.prepare("SELECT * FROM campaigns WHERE id = ?1"), [id]).first<CampaignRow>();
    return row ? toCampaign(row) : null;
  }

  async getByIdForOwner(id: string, ownerUserId: string): Promise<CampaignRecord | null> {
    const row = await bind(this.db.prepare("SELECT * FROM campaigns WHERE id = ?1 AND owner_user_id = ?2"), [id, ownerUserId]).first<CampaignRow>();
    return row ? toCampaign(row) : null;
  }

  async getByIdempotencyKey(ownerUserId: string, idempotencyKey: string): Promise<CampaignRecord | null> {
    const row = await bind(
      this.db.prepare("SELECT * FROM campaigns WHERE owner_user_id = ?1 AND idempotency_key = ?2"),
      [ownerUserId, idempotencyKey],
    ).first<CampaignRow>();
    return row ? toCampaign(row) : null;
  }

  async listByOwner(ownerUserId: string, limit = 50): Promise<(CampaignRecord & { counts: CampaignCounts })[]> {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const result = await bind(
      this.db.prepare(`SELECT campaigns.*, (
        SELECT json_group_object(status, total) FROM (
          SELECT status, COUNT(*) AS total FROM recipient_jobs
          WHERE campaign_id = campaigns.id GROUP BY status
        )
      ) AS counts_json,
      (SELECT COUNT(*) FROM recipient_jobs WHERE campaign_id = campaigns.id AND delivery_verified_at IS NOT NULL) AS delivery_verified_count
      FROM campaigns WHERE owner_user_id = ?1 ORDER BY created_at DESC LIMIT ?2`),
      [ownerUserId, safeLimit],
    ).all<CampaignRow & { counts_json: string }>();
    return result.results.map((row) => ({
      ...toCampaign(row),
      counts: { ...emptyCampaignCounts(), ...parseJson<Partial<CampaignCounts>>(row.counts_json, {}) },
    }));
  }

  async create(
    campaign: CampaignRecord,
    jobs: readonly RecipientJobRecord[],
    attachmentSetId?: string | null,
    auditEvents: readonly AuditEventRecord[] = [],
  ): Promise<void> {
    if (campaign.state !== "validated"
      || !campaign.requestFingerprint
      || campaign.totalRecipients !== campaign.validRecipients + campaign.skippedRecipients
      || campaign.validRecipients !== jobs.length
      || campaign.validRecipients < 1
      || jobs.some((job) => job.campaignId !== campaign.id || job.status !== "pending" || job.attemptCount !== 0)) {
      throw new Error("Campaign create invariants are not satisfied");
    }
    const statements: D1PreparedStatement[] = [
      bind(
        this.db.prepare(
          `INSERT INTO campaigns
           (id, flow_id, template_version_id, owner_user_id, sender_address, source_filename,
            total_recipients, valid_recipients, skipped_recipients, pace_per_minute, state,
            pause_reason, idempotency_key, request_fingerprint, created_at, queued_at, started_at, completed_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)`,
        ),
        [
          campaign.id,
          campaign.flowId,
          campaign.templateVersionId,
          campaign.ownerUserId,
          campaign.senderAddress,
          campaign.sourceFilename,
          campaign.totalRecipients,
          campaign.validRecipients,
          campaign.skippedRecipients,
          campaign.pacePerMinute,
          "draft",
          campaign.pauseReason,
          campaign.idempotencyKey,
          campaign.requestFingerprint,
          campaign.createdAt,
          campaign.queuedAt,
          campaign.startedAt,
          campaign.completedAt,
          campaign.updatedAt,
        ],
      ),
    ];
    if (attachmentSetId) {
      statements.push(
        bind(
          this.db.prepare(
            `UPDATE attachment_sets
             SET campaign_id = ?1, state = 'locked', locked_at = COALESCE(locked_at, ?2), updated_at = ?2
             WHERE id = ?3 AND owner_user_id = ?4 AND campaign_id IS NULL
               AND state = 'open' AND file_count > 0
               AND EXISTS (
                 SELECT 1 FROM campaigns
                 WHERE campaigns.id = ?1 AND campaigns.owner_user_id = ?4
               )`,
          ),
          [campaign.id, campaign.createdAt, attachmentSetId, campaign.ownerUserId],
        ),
      );
      // D1 batches are atomic only when a statement fails. Force a unique
      // constraint failure if the conditional association changed no row so
      // the preceding campaign insert and all jobs roll back together.
      statements.push(
        bind(
          this.db.prepare(
            `INSERT INTO mailbox_coordination_guard(singleton)
             SELECT 1 WHERE changes() != 1`,
          ),
          [],
        ),
      );
    }
    statements.push(...buildRecipientJobInserts(this.db, jobs));
    statements.push(
      bind(
        this.db.prepare(
          `UPDATE campaigns SET state = 'validated', updated_at = ?1
           WHERE id = ?2 AND state = 'draft'
             AND valid_recipients = (
               SELECT COUNT(*) FROM recipient_jobs WHERE campaign_id = ?2
             )`,
        ),
        [campaign.updatedAt, campaign.id],
      ),
      bind(
        this.db.prepare(
          `INSERT INTO mailbox_coordination_guard(singleton)
           SELECT 1 WHERE changes() != 1`,
        ),
        [],
      ),
    );
    statements.push(...auditEvents.map((event) => buildAuditEventInsert(this.db, event)));
    const results = await this.db.batch(statements);
    if (results.some((result) => result.success === false)) throw new Error("D1 campaign batch did not complete successfully");
  }

  async getMailboxHead(ownerUserId: string): Promise<CampaignRecord | null> {
    const row = await bind(this.db.prepare(`SELECT h.*,
      (SELECT MIN(COALESCE(j.next_attempt_at, '1970-01-01T00:00:00.000Z')) FROM recipient_jobs j
        WHERE j.campaign_id = h.id AND j.status = 'pending') AS next_pending_at,
      m.next_send_at, m.provider_backoff_until
      FROM campaign_turn_heads h LEFT JOIN mailbox_send_state m ON m.owner_user_id = h.owner_user_id
      WHERE h.owner_user_id = ?1 AND NOT EXISTS (SELECT 1 FROM delivery_attempts a
        WHERE a.owner_user_id = ?1 AND a.state IN ('reserved', 'provider_bound'))
        AND NOT EXISTS (SELECT 1 FROM recipient_jobs j JOIN campaigns c ON c.id = j.campaign_id
          WHERE c.owner_user_id = ?1 AND j.status IN ('claimed', 'sending'))`), [ownerUserId])
      .first<CampaignRow & { next_pending_at: string | null; next_send_at: string | null; provider_backoff_until: string | null }>();
    if (!row) return null;
    const nextAt = laterIso(row.scheduler_next_attempt_at, row.next_pending_at, row.next_send_at, row.provider_backoff_until);
    let message = row.scheduler_message;
    if (nextAt && (nextAt !== row.scheduler_next_attempt_at || !message || message === "Waiting for the current mailbox submission to finish.")) {
      message = nextAt === row.provider_backoff_until ? mailboxWaitMessage("provider_backoff", nextAt)
        : nextAt === row.next_send_at ? mailboxWaitMessage("pace", nextAt)
        : `A safe retry is waiting. Sending will continue after ${nextAt}.`;
    }
    return { ...toCampaign(row), schedulerNextAttemptAt: nextAt, schedulerMessage: message };
  }

  async cancel(id: string, ownerUserId: string, now: string): Promise<boolean> {
    const changed = changes(await bind(this.db.prepare(`UPDATE campaigns
      SET state = 'paused', cancel_requested_at = ?1, pause_reason = 'Cancelled by member',
        wake_token = NULL, wake_due_at = NULL, scheduler_next_attempt_at = NULL, scheduler_message = NULL, updated_at = ?1
      WHERE id = ?2 AND owner_user_id = ?3 AND cancel_requested_at IS NULL
        AND state IN ('queued', 'running', 'paused')`), [now, id, ownerUserId]).run()) > 0;
    await this.settleCancellations(now, ownerUserId);
    if (changed) return true;
    const existing = await this.getByIdForOwner(id, ownerUserId);
    return Boolean(existing?.cancelRequestedAt);
  }

  async settleCancellations(now: string, ownerUserId?: string, limit = 100): Promise<string[]> {
    const rows = await bind(this.db.prepare(`UPDATE campaigns SET cancelled_at = ?1,
      completed_at = ?1, updated_at = ?1 WHERE id IN (
        SELECT c.id FROM campaigns c WHERE c.cancel_requested_at IS NOT NULL AND c.cancelled_at IS NULL
          AND (?2 IS NULL OR c.owner_user_id = ?2)
          AND NOT EXISTS (SELECT 1 FROM delivery_attempts a WHERE a.campaign_id = c.id AND a.state IN ('reserved', 'provider_bound'))
          AND NOT EXISTS (SELECT 1 FROM recipient_jobs j WHERE j.campaign_id = c.id AND j.status IN ('claimed', 'sending'))
        LIMIT ?3) RETURNING id`), [now, ownerUserId ?? null, Math.max(1, Math.min(250, limit))]).all<{ id: string }>();
    return rows.results.map(row => row.id);
  }

  async markValidated(id: string, ownerUserId: string, now: string): Promise<boolean> {
    return this.updateState(id, ownerUserId, "draft", "validated", now, null);
  }

  async queue(id: string, ownerUserId: string, now: string): Promise<boolean> {
    return this.updateState(id, ownerUserId, "validated", "queued", now, null, "queued_at");
  }

  async markRunningIfQueued(id: string, now: string): Promise<boolean> {
    return changes(
      await bind(
        this.db.prepare(
          `UPDATE campaigns SET state = 'running', started_at = COALESCE(started_at, ?1), updated_at = ?1
           WHERE id = ?2 AND state = 'queued' AND id IN (SELECT id FROM campaign_turn_heads)`,
        ),
        [now, id],
      ).run(),
    ) > 0;
  }

  async pause(id: string, ownerUserId: string, now: string, reason: string): Promise<boolean> {
    return changes(
      await bind(
        this.db.prepare(
          `UPDATE campaigns SET state = 'paused', pause_reason = ?1, attachment_issue_code = NULL,
             attachment_retry_count = 0, wake_token = NULL,
             wake_due_at = NULL, scheduler_next_attempt_at = NULL, scheduler_message = NULL, updated_at = ?2
           WHERE id = ?3 AND owner_user_id = ?4 AND state IN ('queued', 'running')`,
        ),
        [reason.trim() || "Paused by member", now, id, ownerUserId],
      ).run(),
    ) > 0;
  }

  async resume(id: string, ownerUserId: string, now: string): Promise<boolean> {
    return changes(
      await bind(
        this.db.prepare(
          `UPDATE campaigns SET state = 'queued', pause_reason = NULL,
             queued_at = ?1, wake_token = NULL, wake_due_at = NULL, scheduler_message = NULL, scheduler_next_attempt_at = NULL,
             attachment_issue_code = NULL, attachment_retry_count = 0,
             updated_at = ?1
           WHERE id = ?2 AND owner_user_id = ?3 AND state = 'paused' AND cancel_requested_at IS NULL`,
        ),
        [now, id, ownerUserId],
      ).run(),
    ) > 0;
  }

  async fail(id: string, now: string, reason: string, attachmentIssueCode: CampaignRecord["attachmentIssueCode"] | null = null): Promise<boolean> {
    return changes(
      await bind(
        this.db.prepare(
          `UPDATE campaigns SET state = 'failed', pause_reason = ?1, attachment_issue_code = ?2, wake_token = NULL,
             wake_due_at = NULL, scheduler_next_attempt_at = NULL, scheduler_message = NULL, updated_at = ?3
           WHERE id = ?4 AND state IN ('validated', 'queued', 'running', 'paused') AND cancel_requested_at IS NULL`,
        ),
        [reason.trim() || "Campaign failed", attachmentIssueCode, now, id],
      ).run(),
    ) > 0;
  }

  async pauseForAttachmentAuthorization(id: string, ownerUserId: string, now: string, reason: string): Promise<boolean> {
    return changes(
      await bind(
        this.db.prepare(
          `UPDATE campaigns SET state = 'paused', pause_reason = ?1,
             attachment_issue_code = 'attachment_authorization_required', wake_token = NULL,
             wake_due_at = NULL, scheduler_next_attempt_at = NULL, scheduler_message = NULL, updated_at = ?2
           WHERE id = ?3 AND owner_user_id = ?4 AND state IN ('queued', 'running')`,
        ),
        [reason.trim() || "Reconnect OneDrive, then resume from the pending rows.", now, id, ownerUserId],
      ).run(),
    ) > 0;
  }

  async markAttachmentRetry(id: string, nextAttemptAt: string, message: string, now: string): Promise<boolean> {
    return changes(
      await bind(
        this.db.prepare(
          `UPDATE campaigns SET attachment_issue_code = 'attachment_retrying',
             attachment_retry_count = MIN(attachment_retry_count + 1, 2147483647),
             scheduler_next_attempt_at = ?1, scheduler_message = ?2, updated_at = ?3
           WHERE id = ?4 AND state = 'running'`,
        ),
        [nextAttemptAt, message, now, id],
      ).run(),
    ) > 0;
  }

  async clearAttachmentIssue(id: string, now: string): Promise<boolean> {
    return changes(
      await bind(
        this.db.prepare(
          `UPDATE campaigns SET attachment_issue_code = NULL, attachment_retry_count = 0,
             scheduler_next_attempt_at = NULL, scheduler_message = NULL, updated_at = ?1
           WHERE id = ?2 AND state = 'running'
             AND (attachment_issue_code IS NOT NULL OR attachment_retry_count != 0)`,
        ),
        [now, id],
      ).run(),
    ) > 0;
  }

  async completeIfExhausted(id: string, now: string): Promise<boolean> {
    return changes(
      await bind(
        this.db.prepare(
          `UPDATE campaigns SET state = 'completed', completed_at = COALESCE(completed_at, ?1),
             wake_token = NULL, wake_due_at = NULL, scheduler_next_attempt_at = NULL,
             scheduler_message = NULL, updated_at = ?1
           WHERE id = ?2 AND state = 'running'
             AND NOT EXISTS (
               SELECT 1 FROM recipient_jobs
               WHERE campaign_id = ?2 AND status IN ('pending', 'claimed', 'sending')
             )`,
        ),
        [now, id],
      ).run(),
    ) > 0;
  }

  async reserveWake(
    id: string,
    wakeToken: string,
    dueAt: string,
    message: string | null,
    now: string,
    replaceDueBefore: string | null = null,
  ): Promise<boolean> {
    return changes(
      await bind(
        this.db.prepare(
          `UPDATE campaigns
           SET wake_token = ?1, wake_due_at = ?2, scheduler_next_attempt_at = ?2,
               scheduler_message = ?3, updated_at = ?4
           WHERE id = ?5 AND state IN ('queued', 'running') AND id IN (SELECT id FROM campaign_turn_heads)
             AND NOT EXISTS (SELECT 1 FROM delivery_attempts a WHERE a.owner_user_id = campaigns.owner_user_id AND a.state IN ('reserved', 'provider_bound'))
             AND (wake_token IS NULL OR (?6 IS NOT NULL AND wake_due_at <= ?6))`,
        ),
        [wakeToken, dueAt, message, now, id, replaceDueBefore],
      ).run(),
    ) > 0;
  }

  async consumeWake(id: string, wakeToken: string, now: string): Promise<CampaignRecord | null> {
    const row = await bind(
      this.db.prepare(
        `UPDATE campaigns
         SET wake_token = NULL, wake_due_at = NULL, scheduler_message = NULL, updated_at = ?1
         WHERE id = ?2 AND wake_token = ?3 AND wake_due_at <= ?1
           AND state IN ('queued', 'running') AND id IN (SELECT id FROM campaign_turn_heads)
         RETURNING *`,
      ),
      [now, id, wakeToken],
    ).first<CampaignRow>();
    return row ? toCampaign(row) : null;
  }

  async markSchedulerWaiting(id: string, nextAttemptAt: string, message: string, now: string): Promise<boolean> {
    return changes(
      await bind(
        this.db.prepare(
          `UPDATE campaigns SET scheduler_next_attempt_at = ?1, scheduler_message = ?2, updated_at = ?3
           WHERE id = ?4 AND state IN ('queued', 'running') AND id IN (SELECT id FROM campaign_turn_heads)`,
        ),
        [nextAttemptAt, message, now, id],
      ).run(),
    ) > 0;
  }

  async listWatchdogWakeCandidates(now: string, staleBefore: string, limit = 100): Promise<CampaignRecord[]> {
    const safeLimit = Math.max(1, Math.min(250, Math.floor(limit)));
    const rows = await bind(
      this.db.prepare(
        `SELECT campaigns.* FROM campaigns
         WHERE campaigns.id IN (SELECT id FROM campaign_turn_heads)
           AND NOT EXISTS (SELECT 1 FROM delivery_attempts a WHERE a.owner_user_id = campaigns.owner_user_id AND a.state IN ('reserved', 'provider_bound'))
           AND EXISTS (
             SELECT 1 FROM recipient_jobs
             WHERE recipient_jobs.campaign_id = campaigns.id
               AND recipient_jobs.status = 'pending'
           )
           AND ((campaigns.wake_token IS NULL AND (campaigns.state = 'queued' OR campaigns.updated_at <= ?2))
             OR campaigns.wake_due_at <= ?2)
         ORDER BY COALESCE(campaigns.wake_due_at, campaigns.updated_at) ASC
         LIMIT ?3`,
      ),
      [now, staleBefore, safeLimit],
    ).all<CampaignRow>();
    return rows.results.map(toCampaign);
  }

  async completeExhaustedBatch(now: string, limit = 100): Promise<string[]> {
    const safeLimit = Math.max(1, Math.min(250, Math.floor(limit)));
    const rows = await bind(
      this.db.prepare(
        `UPDATE campaigns
         SET state = 'completed', completed_at = COALESCE(completed_at, ?1),
             wake_token = NULL, wake_due_at = NULL, scheduler_next_attempt_at = NULL,
             scheduler_message = NULL, updated_at = ?1
         WHERE id IN (
           SELECT campaigns.id FROM campaigns
           WHERE campaigns.state IN ('queued', 'running')
             AND NOT EXISTS (
               SELECT 1 FROM recipient_jobs
               WHERE recipient_jobs.campaign_id = campaigns.id
                 AND recipient_jobs.status IN ('pending', 'claimed', 'sending')
             )
           LIMIT ?2
         )
         RETURNING id`,
      ),
      [now, safeLimit],
    ).all<{ id: string }>();
    return rows.results.map((row) => row.id);
  }

  private async updateState(
    id: string,
    ownerUserId: string,
    from: CampaignRecord["state"],
    to: CampaignRecord["state"],
    now: string,
    pauseReason: string | null,
    timestampColumn?: "queued_at",
  ): Promise<boolean> {
    if (timestampColumn) {
      const statement = this.db.prepare(
        `UPDATE campaigns SET state = ?1, pause_reason = ?2, updated_at = ?3,
           ${timestampColumn} = COALESCE(${timestampColumn}, ?7)
         WHERE id = ?4 AND owner_user_id = ?5 AND state = ?6`,
      );
      return changes(await bind(statement, [to, pauseReason, now, id, ownerUserId, from, now]).run()) > 0;
    }
    const statement = this.db.prepare(
      `UPDATE campaigns SET state = ?1, pause_reason = ?2, updated_at = ?3
       WHERE id = ?4 AND owner_user_id = ?5 AND state = ?6`,
    );
    return changes(await bind(statement, [to, pauseReason, now, id, ownerUserId, from]).run()) > 0;
  }
}
