import type { AuditEventRecord } from "../../domain/types";
import type {
  AttachmentFileRecord,
  AttachmentRepository,
  AttachmentSetRecord,
} from "../attachments/contracts";
import type {
  AuditRepository,
  D1Database,
  Repositories,
} from "./contracts";
import { bind, changes, json, parseJson } from "./d1-helpers";

import { D1CampaignRepository } from "./d1-campaigns";
import { D1FlowRepository } from "./d1-flows";
import { D1RecipientJobRepository } from "./d1-recipient-jobs";
import { D1TemplateVersionRepository } from "./d1-template-versions";
import { D1UserRepository } from "./d1-users";

export { D1CampaignRepository } from "./d1-campaigns";
export { D1FlowRepository } from "./d1-flows";
export { D1TemplateVersionRepository } from "./d1-template-versions";
export { D1UserRepository } from "./d1-users";
export { D1RecipientJobRepository } from "./d1-recipient-jobs";

interface AuditRow {
  id: string;
  actor_user_id: string | null;
  campaign_id: string | null;
  recipient_job_id: string | null;
  event_type: AuditEventRecord["eventType"];
  metadata_json: string;
  created_at: string;
}

function toAudit(row: AuditRow): AuditEventRecord {
  return {
    id: row.id,
    actorUserId: row.actor_user_id ?? null,
    campaignId: row.campaign_id ?? null,
    recipientJobId: row.recipient_job_id ?? null,
    eventType: row.event_type,
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    createdAt: row.created_at,
  };
}

export class D1AuditRepository implements AuditRepository {
  constructor(private readonly db: D1Database) {}

  async append(event: AuditEventRecord): Promise<void> {
    await bind(
      this.db.prepare(
        `INSERT INTO audit_events (id, actor_user_id, campaign_id, recipient_job_id, event_type, metadata_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      ),
      [event.id, event.actorUserId, event.campaignId, event.recipientJobId, event.eventType, json(event.metadata), event.createdAt],
    ).run();
  }

  async listByCampaign(campaignId: string, limit = 100): Promise<AuditEventRecord[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const result = await bind(
      this.db.prepare("SELECT * FROM audit_events WHERE campaign_id = ?1 ORDER BY created_at DESC LIMIT ?2"),
      [campaignId, safeLimit],
    ).all<AuditRow>();
    return result.results.map(toAudit);
  }
}

interface AttachmentSetRow {
  id: string;
  owner_user_id: string;
  campaign_id: string | null;
  upload_idempotency_key: string;
  file_count: number;
  total_bytes: number;
  state: AttachmentSetRecord["state"];
  expires_at: string;
  locked_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

function toAttachmentSet(row: AttachmentSetRow): AttachmentSetRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    campaignId: row.campaign_id ?? null,
    uploadIdempotencyKey: row.upload_idempotency_key,
    fileCount: Number(row.file_count),
    totalBytes: Number(row.total_bytes),
    state: row.state,
    expiresAt: row.expires_at,
    lockedAt: row.locked_at ?? null,
    deletedAt: row.deleted_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface AttachmentFileRow {
  id: string;
  attachment_set_id: string;
  object_key: string;
  original_filename: string;
  content_type: string;
  byte_size: number;
  sha256_hex: string;
  position: number;
  created_at: string;
  deleted_at: string | null;
}

function toAttachmentFile(row: AttachmentFileRow): AttachmentFileRecord {
  return {
    id: row.id,
    attachmentSetId: row.attachment_set_id,
    objectKey: row.object_key,
    originalFilename: row.original_filename,
    mediaType: row.content_type,
    byteSize: Number(row.byte_size),
    sha256: row.sha256_hex,
    position: Number(row.position),
    createdAt: row.created_at,
    deletedAt: row.deleted_at ?? null,
  };
}

/** D1 metadata adapter for campaign-wide private attachment sets. */
export class D1AttachmentRepository implements AttachmentRepository {
  constructor(private readonly db: D1Database) {}

  async getSetById(id: string): Promise<AttachmentSetRecord | null> {
    const row = await bind(this.db.prepare("SELECT * FROM attachment_sets WHERE id = ?1"), [id]).first<AttachmentSetRow>();
    return row ? toAttachmentSet(row) : null;
  }

  async getSetByIdForOwner(id: string, ownerUserId: string): Promise<AttachmentSetRecord | null> {
    const row = await bind(
      this.db.prepare("SELECT * FROM attachment_sets WHERE id = ?1 AND owner_user_id = ?2"),
      [id, ownerUserId],
    ).first<AttachmentSetRow>();
    return row ? toAttachmentSet(row) : null;
  }

  async getSetByUploadIdempotencyKey(ownerUserId: string, uploadIdempotencyKey: string): Promise<AttachmentSetRecord | null> {
    const row = await bind(
      this.db.prepare("SELECT * FROM attachment_sets WHERE owner_user_id = ?1 AND upload_idempotency_key = ?2"),
      [ownerUserId, uploadIdempotencyKey],
    ).first<AttachmentSetRow>();
    return row ? toAttachmentSet(row) : null;
  }

  async getSetByCampaignId(campaignId: string): Promise<AttachmentSetRecord | null> {
    const row = await bind(this.db.prepare("SELECT * FROM attachment_sets WHERE campaign_id = ?1"), [campaignId]).first<AttachmentSetRow>();
    return row ? toAttachmentSet(row) : null;
  }

  async createSet(set: AttachmentSetRecord): Promise<void> {
    await bind(
      this.db.prepare(
        `INSERT INTO attachment_sets
         (id, owner_user_id, campaign_id, upload_idempotency_key, file_count, total_bytes, state,
          expires_at, locked_at, deleted_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
      ),
      [
        set.id,
        set.ownerUserId,
        set.campaignId,
        set.uploadIdempotencyKey,
        set.fileCount,
        set.totalBytes,
        set.state,
        set.expiresAt,
        set.lockedAt,
        set.deletedAt,
        set.createdAt,
        set.updatedAt,
      ],
    ).run();
  }

  async createFile(file: AttachmentFileRecord, ownerUserId: string): Promise<boolean> {
    // D1 batch statements execute transactionally. INSERT OR IGNORE keeps a
    // duplicate digest or position a harmless no-op, while changes() makes
    // the totals update conditional on this exact insert having succeeded.
    const results = await this.db.batch([
      bind(
        this.db.prepare(
          `INSERT OR IGNORE INTO attachment_files
           (id, attachment_set_id, object_key, original_filename, content_type, byte_size,
            sha256_hex, position, created_at, deleted_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10
           WHERE EXISTS (
             SELECT 1 FROM attachment_sets
             WHERE id = ?2 AND owner_user_id = ?11 AND state = 'open'
               AND file_count < 5 AND total_bytes + ?6 <= 20971520
           )`,
        ),
        [
          file.id,
          file.attachmentSetId,
          file.objectKey,
          file.originalFilename,
          file.mediaType,
          file.byteSize,
          file.sha256,
          file.position,
          file.createdAt,
          file.deletedAt,
          ownerUserId,
        ],
      ),
      bind(
        this.db.prepare(
          `UPDATE attachment_sets
           SET file_count = file_count + 1, total_bytes = total_bytes + ?1, updated_at = ?2
           WHERE id = ?3 AND owner_user_id = ?4 AND state = 'open' AND changes() = 1`,
        ),
        [file.byteSize, file.createdAt, file.attachmentSetId, ownerUserId],
      ),
    ]);
    return changes(results[0] ?? {}) === 1 && changes(results[1] ?? {}) === 1;
  }

  async getFileById(id: string): Promise<AttachmentFileRecord | null> {
    const row = await bind(this.db.prepare("SELECT * FROM attachment_files WHERE id = ?1"), [id]).first<AttachmentFileRow>();
    return row ? toAttachmentFile(row) : null;
  }

  async getFileByIdForOwner(id: string, attachmentSetId: string, ownerUserId: string): Promise<AttachmentFileRecord | null> {
    const row = await bind(
      this.db.prepare(
        `SELECT files.* FROM attachment_files AS files
         INNER JOIN attachment_sets AS sets ON sets.id = files.attachment_set_id
         WHERE files.id = ?1 AND files.attachment_set_id = ?2 AND sets.owner_user_id = ?3
           AND files.deleted_at IS NULL`,
      ),
      [id, attachmentSetId, ownerUserId],
    ).first<AttachmentFileRow>();
    return row ? toAttachmentFile(row) : null;
  }

  async listFiles(attachmentSetId: string, includeDeleted = false): Promise<AttachmentFileRecord[]> {
    const query = includeDeleted
      ? "SELECT * FROM attachment_files WHERE attachment_set_id = ?1 ORDER BY position ASC"
      : "SELECT * FROM attachment_files WHERE attachment_set_id = ?1 AND deleted_at IS NULL ORDER BY position ASC";
    const result = await bind(this.db.prepare(query), [attachmentSetId]).all<AttachmentFileRow>();
    return result.results.map(toAttachmentFile);
  }

  async removeFile(id: string, attachmentSetId: string, ownerUserId: string, byteSize: number, now: string): Promise<boolean> {
    const results = await this.db.batch([
      bind(
        this.db.prepare(
          `DELETE FROM attachment_files
           WHERE id = ?1 AND attachment_set_id = ?2 AND deleted_at IS NULL
             AND EXISTS (
               SELECT 1 FROM attachment_sets
               WHERE id = ?2 AND owner_user_id = ?3 AND state = 'open'
             )`,
        ),
        [id, attachmentSetId, ownerUserId],
      ),
      bind(
        this.db.prepare(
          `UPDATE attachment_sets
           SET file_count = MAX(0, file_count - 1), total_bytes = MAX(0, total_bytes - ?1), updated_at = ?2
           WHERE id = ?3 AND owner_user_id = ?4 AND state = 'open' AND changes() = 1`,
        ),
        [byteSize, now, attachmentSetId, ownerUserId],
      ),
    ]);
    return changes(results[0] ?? {}) === 1 && changes(results[1] ?? {}) === 1;
  }

  async lockSet(id: string, ownerUserId: string, now: string): Promise<boolean> {
    return changes(
      await bind(
        this.db.prepare(
          `UPDATE attachment_sets
           SET state = 'locked', locked_at = COALESCE(locked_at, ?1), updated_at = ?1
           WHERE id = ?2 AND owner_user_id = ?3 AND state = 'open' AND campaign_id IS NULL`,
        ),
        [now, id, ownerUserId],
      ).run(),
    ) === 1;
  }

  async associateSet(id: string, ownerUserId: string, campaignId: string, now: string): Promise<boolean> {
    return changes(
      await bind(
        this.db.prepare(
          `UPDATE attachment_sets
           SET campaign_id = ?1, state = 'locked', locked_at = COALESCE(locked_at, ?2), updated_at = ?2
           WHERE id = ?3 AND owner_user_id = ?4 AND campaign_id IS NULL
             AND state IN ('open', 'locked')
             AND EXISTS (
               SELECT 1 FROM campaigns
               WHERE campaigns.id = ?1 AND campaigns.owner_user_id = ?4
             )`,
        ),
        [campaignId, now, id, ownerUserId],
      ).run(),
    ) === 1;
  }

  async markFileBytesDeleted(id: string, deletedAt: string): Promise<boolean> {
    return changes(
      await bind(
        this.db.prepare("UPDATE attachment_files SET deleted_at = ?1 WHERE id = ?2 AND deleted_at IS NULL"),
        [deletedAt, id],
      ).run(),
    ) === 1;
  }

  async markSetBytesDeleted(id: string, deletedAt: string): Promise<boolean> {
    return changes(
      await bind(
        this.db.prepare(
          `UPDATE attachment_sets
           SET state = 'deleted', deleted_at = COALESCE(deleted_at, ?1), updated_at = ?1
           WHERE id = ?2 AND state IN ('open', 'locked')
             AND NOT EXISTS (
               SELECT 1 FROM attachment_files
               WHERE attachment_set_id = ?2 AND deleted_at IS NULL
             )`,
        ),
        [deletedAt, id],
      ).run(),
    ) === 1;
  }

  async listOrphanSets(now: string, limit = 100): Promise<AttachmentSetRecord[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const result = await bind(
      this.db.prepare(
        `SELECT * FROM attachment_sets
         WHERE (
           state IN ('open', 'locked') AND campaign_id IS NULL AND expires_at <= ?1
         ) OR (
           campaign_id IS NOT NULL
           AND state IN ('open', 'locked')
           AND EXISTS (
             SELECT 1 FROM campaigns
             WHERE campaigns.id = attachment_sets.campaign_id
               AND campaigns.state IN ('completed', 'failed')
           )
         )
         ORDER BY expires_at ASC LIMIT ?2`,
      ),
      [now, safeLimit],
    ).all<AttachmentSetRow>();
    return result.results.map(toAttachmentSet);
  }
}

export function createD1Repositories(db: D1Database): Repositories {
  return {
    users: new D1UserRepository(db),
    flows: new D1FlowRepository(db),
    templateVersions: new D1TemplateVersionRepository(db),
    campaigns: new D1CampaignRepository(db),
    recipientJobs: new D1RecipientJobRepository(db),
    audit: new D1AuditRepository(db),
    attachments: new D1AttachmentRepository(db),
  };
}
