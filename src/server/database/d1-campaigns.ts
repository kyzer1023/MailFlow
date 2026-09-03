import type { CampaignRecord, RecipientJobRecord } from "../../domain/types";
import type {
  CampaignRepository,
  D1Database,
  D1PreparedStatement,
} from "./contracts";
import { bind, changes } from "./d1-helpers";
import { buildRecipientJobInsert } from "./d1-recipient-jobs";

interface CampaignRow {
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
  created_at: string;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

function toCampaign(row: CampaignRow): CampaignRecord {
  return {
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
    state: row.state,
    pauseReason: row.pause_reason ?? null,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    queuedAt: row.queued_at ?? null,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    updatedAt: row.updated_at,
  };
}

export class D1CampaignRepository implements CampaignRepository {
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

  async listByOwner(ownerUserId: string, limit = 50): Promise<CampaignRecord[]> {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const result = await bind(
      this.db.prepare("SELECT * FROM campaigns WHERE owner_user_id = ?1 ORDER BY created_at DESC LIMIT ?2"),
      [ownerUserId, safeLimit],
    ).all<CampaignRow>();
    return result.results.map(toCampaign);
  }

  async create(campaign: CampaignRecord, jobs: readonly RecipientJobRecord[], attachmentSetId?: string | null): Promise<void> {
    const statements: D1PreparedStatement[] = [
      bind(
        this.db.prepare(
          `INSERT INTO campaigns
           (id, flow_id, template_version_id, owner_user_id, sender_address, source_filename,
            total_recipients, valid_recipients, skipped_recipients, pace_per_minute, state,
            pause_reason, idempotency_key, created_at, queued_at, started_at, completed_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)`,
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
          campaign.state,
          campaign.pauseReason,
          campaign.idempotencyKey,
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
            `INSERT INTO campaigns
             (id, flow_id, template_version_id, owner_user_id, sender_address, source_filename,
              total_recipients, valid_recipients, skipped_recipients, pace_per_minute, state,
              pause_reason, idempotency_key, created_at, queued_at, started_at, completed_at, updated_at)
             SELECT id, flow_id, template_version_id, owner_user_id, sender_address, source_filename,
                    total_recipients, valid_recipients, skipped_recipients, pace_per_minute, state,
                    pause_reason, idempotency_key, created_at, queued_at, started_at, completed_at, updated_at
             FROM campaigns
             WHERE id = ?1 AND changes() != 1`,
          ),
          [campaign.id],
        ),
      );
    }
    for (const job of jobs) statements.push(buildRecipientJobInsert(this.db, job));
    await this.db.batch(statements);
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
           WHERE id = ?2 AND state = 'queued'`,
        ),
        [now, id],
      ).run(),
    ) === 1;
  }

  async pause(id: string, ownerUserId: string, now: string, reason: string): Promise<boolean> {
    return changes(
      await bind(
        this.db.prepare(
          `UPDATE campaigns SET state = 'paused', pause_reason = ?1, updated_at = ?2
           WHERE id = ?3 AND owner_user_id = ?4 AND state IN ('queued', 'running')`,
        ),
        [reason.trim() || "Paused by member", now, id, ownerUserId],
      ).run(),
    ) === 1;
  }

  async resume(id: string, ownerUserId: string, now: string): Promise<boolean> {
    return changes(
      await bind(
        this.db.prepare(
          `UPDATE campaigns SET state = 'running', pause_reason = NULL,
             started_at = COALESCE(started_at, ?1), updated_at = ?1
           WHERE id = ?2 AND owner_user_id = ?3 AND state = 'paused'`,
        ),
        [now, id, ownerUserId],
      ).run(),
    ) === 1;
  }

  async fail(id: string, now: string, reason: string): Promise<boolean> {
    return changes(
      await bind(
        this.db.prepare(
          `UPDATE campaigns SET state = 'failed', pause_reason = ?1, updated_at = ?2
           WHERE id = ?3 AND state IN ('validated', 'queued', 'running', 'paused')`,
        ),
        [reason.trim() || "Campaign failed", now, id],
      ).run(),
    ) === 1;
  }

  async completeIfExhausted(id: string, now: string): Promise<boolean> {
    return changes(
      await bind(
        this.db.prepare(
          `UPDATE campaigns SET state = 'completed', completed_at = COALESCE(completed_at, ?1), updated_at = ?1
           WHERE id = ?2 AND state = 'running'
             AND NOT EXISTS (
               SELECT 1 FROM recipient_jobs
               WHERE campaign_id = ?2 AND status IN ('pending', 'claimed', 'sending')
             )`,
        ),
        [now, id],
      ).run(),
    ) === 1;
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
      return changes(await bind(statement, [to, pauseReason, now, id, ownerUserId, from, now]).run()) === 1;
    }
    const statement = this.db.prepare(
      `UPDATE campaigns SET state = ?1, pause_reason = ?2, updated_at = ?3
       WHERE id = ?4 AND owner_user_id = ?5 AND state = ?6`,
    );
    return changes(await bind(statement, [to, pauseReason, now, id, ownerUserId, from]).run()) === 1;
  }
}
