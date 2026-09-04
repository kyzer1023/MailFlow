import type { CampaignCounts, RecipientJobRecord } from "../../domain/types";
import { emptyCampaignCounts } from "../../domain/types";
import type {
  D1Database,
  D1PreparedStatement,
  RecipientJobRepository,
} from "./contracts";
import { MAX_RECIPIENT_SNAPSHOT_BYTES } from "../../domain/campaign-limits";
import { bind, changes, json, parseJson } from "./d1-helpers";

interface RecipientJobRow {
  id: string;
  campaign_id: string;
  source_row: number;
  recipient: string;
  cc_json: string;
  bcc_json: string;
  reply_to_json: string;
  importance: "low" | "normal" | "high";
  merge_data_json: string;
  rendered_subject: string;
  rendered_body_html: string;
  send_key: string;
  status: RecipientJobRecord["status"];
  attempt_count: number;
  claim_token: string | null;
  claimed_at: string | null;
  sending_at: string | null;
  accepted_at: string | null;
  next_attempt_at: string | null;
  last_error_category: string | null;
  last_error_message: string | null;
  provider_message_id: string | null;
  provider_request_id: string | null;
  created_at: string;
  updated_at: string;
}

function toRecipientJob(row: RecipientJobRow): RecipientJobRecord {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    sourceRow: row.source_row,
    recipient: row.recipient,
    cc: parseJson<string[]>(row.cc_json, []),
    bcc: parseJson<string[]>(row.bcc_json, []),
    replyTo: parseJson<string[]>(row.reply_to_json, []),
    importance: row.importance ?? "normal",
    mergeData: parseJson<Record<string, string>>(row.merge_data_json, {}),
    renderedSubject: row.rendered_subject,
    renderedBodyHtml: row.rendered_body_html,
    sendKey: row.send_key,
    status: row.status,
    attemptCount: row.attempt_count,
    claimToken: row.claim_token ?? null,
    claimedAt: row.claimed_at ?? null,
    sendingAt: row.sending_at ?? null,
    acceptedAt: row.accepted_at ?? null,
    nextAttemptAt: row.next_attempt_at ?? null,
    lastErrorCategory: row.last_error_category ?? null,
    lastErrorMessage: row.last_error_message ?? null,
    providerMessageId: row.provider_message_id ?? null,
    providerRequestId: row.provider_request_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function recipientInsertTuple(job: RecipientJobRecord): readonly unknown[] {
  return [
    job.id,
    job.campaignId,
    job.sourceRow,
    job.recipient,
    json(job.cc),
    json(job.bcc),
    json(job.replyTo),
    job.importance ?? "normal",
    json(job.mergeData),
    job.renderedSubject,
    job.renderedBodyHtml,
    job.sendKey,
    job.status,
    job.attemptCount,
    job.claimToken,
    job.claimedAt,
    job.sendingAt,
    job.acceptedAt,
    job.nextAttemptAt,
    job.lastErrorCategory,
    job.lastErrorMessage,
    job.providerMessageId,
    job.providerRequestId,
    job.createdAt,
    job.updatedAt,
  ];
}

/**
 * Build a small number of bounded inserts for campaign creation. Each JSON
 * string is one D1 parameter below the 2 MB binding limit, while db.batch()
 * keeps all chunks in the same transaction as the campaign row.
 */
export function buildRecipientJobInserts(db: D1Database, jobs: readonly RecipientJobRecord[]): D1PreparedStatement[] {
  const encodedRows = jobs.map((job) => JSON.stringify(recipientInsertTuple(job)));
  const chunks: string[] = [];
  let chunkRows: string[] = [];
  let chunkBytes = 2;
  for (const encoded of encodedRows) {
    const encodedBytes = new TextEncoder().encode(encoded).byteLength;
    if (encodedBytes + 2 > MAX_RECIPIENT_SNAPSHOT_BYTES) {
      throw new Error("Recipient snapshot exceeds the D1-safe persistence bound");
    }
    const nextBytes = chunkBytes + encodedBytes + (chunkRows.length > 0 ? 1 : 0);
    if (chunkRows.length > 0 && nextBytes > MAX_RECIPIENT_SNAPSHOT_BYTES) {
      chunks.push(`[${chunkRows.join(",")}]`);
      chunkRows = [];
      chunkBytes = 2;
    }
    chunkRows.push(encoded);
    chunkBytes += encodedBytes + (chunkRows.length > 1 ? 1 : 0);
  }
  if (chunkRows.length > 0) chunks.push(`[${chunkRows.join(",")}]`);

  const sql = `INSERT INTO recipient_jobs
    (id, campaign_id, source_row, recipient, cc_json, bcc_json, reply_to_json, importance,
     merge_data_json, rendered_subject, rendered_body_html, send_key, status, attempt_count,
     claim_token, claimed_at, sending_at, accepted_at, next_attempt_at,
     last_error_category, last_error_message, provider_message_id, provider_request_id,
     created_at, updated_at)
    SELECT
      json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'),
      json_extract(value, '$[3]'), json_extract(value, '$[4]'), json_extract(value, '$[5]'),
      json_extract(value, '$[6]'), json_extract(value, '$[7]'), json_extract(value, '$[8]'),
      json_extract(value, '$[9]'), json_extract(value, '$[10]'), json_extract(value, '$[11]'),
      json_extract(value, '$[12]'), json_extract(value, '$[13]'), json_extract(value, '$[14]'),
      json_extract(value, '$[15]'), json_extract(value, '$[16]'), json_extract(value, '$[17]'),
      json_extract(value, '$[18]'), json_extract(value, '$[19]'), json_extract(value, '$[20]'),
      json_extract(value, '$[21]'), json_extract(value, '$[22]'), json_extract(value, '$[23]'),
      json_extract(value, '$[24]')
    FROM json_each(?1)`;
  return chunks.map((chunk) => bind(db.prepare(sql), [chunk]));
}

export class D1RecipientJobRepository implements RecipientJobRepository {
  constructor(private readonly db: D1Database) {}

  async getById(id: string): Promise<RecipientJobRecord | null> {
    const row = await bind(this.db.prepare("SELECT * FROM recipient_jobs WHERE id = ?1"), [id]).first<RecipientJobRow>();
    return row ? toRecipientJob(row) : null;
  }

  async getByCampaignAndSourceRow(campaignId: string, sourceRow: number): Promise<RecipientJobRecord | null> {
    const row = await bind(
      this.db.prepare("SELECT * FROM recipient_jobs WHERE campaign_id = ?1 AND source_row = ?2"),
      [campaignId, sourceRow],
    ).first<RecipientJobRow>();
    return row ? toRecipientJob(row) : null;
  }

  async listByCampaign(campaignId: string, limit = 100, offset = 0): Promise<RecipientJobRecord[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const safeOffset = Math.max(0, Math.floor(offset));
    const result = await bind(
      this.db.prepare("SELECT * FROM recipient_jobs WHERE campaign_id = ?1 ORDER BY source_row ASC LIMIT ?2 OFFSET ?3"),
      [campaignId, safeLimit, safeOffset],
    ).all<RecipientJobRow>();
    return result.results.map(toRecipientJob);
  }

  async claimNextPending(campaignId: string, now: string, claimToken: string): Promise<RecipientJobRecord | null> {
    // The campaign-state predicate means a pause racing with a tick cannot
    // claim another row. The pending predicate and unique claim token make a
    // duplicate queue delivery a harmless no-op.
    const row = await bind(
      this.db.prepare(
        `UPDATE recipient_jobs
         SET status = 'claimed', attempt_count = attempt_count + 1, claim_token = ?1,
             claimed_at = ?2, next_attempt_at = NULL, updated_at = ?2
         WHERE id = (
           SELECT jobs.id FROM recipient_jobs AS jobs
           INNER JOIN campaigns AS campaigns ON campaigns.id = jobs.campaign_id
           WHERE jobs.campaign_id = ?3 AND campaigns.state = 'running'
             AND jobs.status = 'pending'
             AND (jobs.next_attempt_at IS NULL OR jobs.next_attempt_at <= ?2)
           ORDER BY jobs.source_row ASC LIMIT 1
         )
           AND status = 'pending'
         RETURNING *`,
      ),
      [claimToken, now, campaignId],
    ).first<RecipientJobRow>();
    return row ? toRecipientJob(row) : null;
  }

  async releaseClaimForWait(
    id: string,
    claimToken: string,
    now: string,
    retryAt: string,
    category: string,
    message: string,
  ): Promise<boolean> {
    return changes(
      await bind(
        this.db.prepare(
          `UPDATE recipient_jobs
           SET status = 'pending', claim_token = NULL, claimed_at = NULL,
               next_attempt_at = ?1, last_error_category = ?2,
               last_error_message = ?3, updated_at = ?4
           WHERE id = ?5 AND status = 'claimed' AND claim_token = ?6`,
        ),
        [retryAt, category, message, now, id, claimToken],
      ).run(),
    ) === 1;
  }

  async markSending(id: string, claimToken: string, now: string): Promise<boolean> {
    return changes(
      await bind(
        this.db.prepare(
          `UPDATE recipient_jobs SET status = 'sending', sending_at = ?1, updated_at = ?1
           WHERE id = ?2 AND status = 'claimed' AND claim_token = ?3`,
        ),
        [now, id, claimToken],
      ).run(),
    ) === 1;
  }

  async markAccepted(id: string, claimToken: string, now: string, providerMessageId: string | null, providerRequestId: string | null): Promise<boolean> {
    return changes(
      await bind(
        this.db.prepare(
          `UPDATE recipient_jobs SET status = 'accepted', accepted_at = ?1, claim_token = NULL,
             last_error_category = NULL, last_error_message = NULL,
             provider_message_id = ?2, provider_request_id = ?3, updated_at = ?1
           WHERE id = ?4 AND status = 'sending' AND claim_token = ?5`,
        ),
        [now, providerMessageId, providerRequestId, id, claimToken],
      ).run(),
    ) === 1;
  }

  async markFailed(id: string, claimToken: string, now: string, category: string, message: string, providerRequestId: string | null): Promise<boolean> {
    return changes(
      await bind(
        this.db.prepare(
          `UPDATE recipient_jobs SET status = 'failed', claim_token = NULL,
             last_error_category = ?1, last_error_message = ?2, provider_request_id = ?3, updated_at = ?4
           WHERE id = ?5 AND status = 'sending' AND claim_token = ?6`,
        ),
        [category, message, providerRequestId, now, id, claimToken],
      ).run(),
    ) === 1;
  }

  async scheduleSafeRetry(id: string, claimToken: string, now: string, retryAt: string, category: string, message: string, providerRequestId: string | null): Promise<boolean> {
    return changes(
      await bind(
        this.db.prepare(
          `UPDATE recipient_jobs SET status = 'pending', claim_token = NULL, claimed_at = NULL,
             sending_at = NULL, next_attempt_at = ?1, last_error_category = ?2,
             last_error_message = ?3, provider_request_id = ?4, updated_at = ?5
           WHERE id = ?6 AND status = 'sending' AND claim_token = ?7`,
        ),
        [retryAt, category, message, providerRequestId, now, id, claimToken],
      ).run(),
    ) === 1;
  }

  async markUnknown(id: string, claimToken: string, now: string, category: string, message: string, providerRequestId: string | null): Promise<boolean> {
    return changes(
      await bind(
        this.db.prepare(
          `UPDATE recipient_jobs SET status = 'unknown', claim_token = NULL,
             last_error_category = ?1, last_error_message = ?2, provider_request_id = ?3, updated_at = ?4
           WHERE id = ?5 AND status = 'sending' AND claim_token = ?6`,
        ),
        [category, message, providerRequestId, now, id, claimToken],
      ).run(),
    ) === 1;
  }

  async markSkipped(id: string, now: string, message: string): Promise<boolean> {
    return changes(
      await bind(
        this.db.prepare(
          `UPDATE recipient_jobs SET status = 'skipped', last_error_category = 'skipped',
             last_error_message = ?1, updated_at = ?2 WHERE id = ?3 AND status = 'pending'`,
        ),
        [message, now, id],
      ).run(),
    ) === 1;
  }

  async counts(campaignId: string): Promise<CampaignCounts> {
    const result = await bind(
      this.db.prepare("SELECT status, COUNT(*) AS count FROM recipient_jobs WHERE campaign_id = ?1 GROUP BY status"),
      [campaignId],
    ).all<{ status: RecipientJobRecord["status"]; count: number }>();
    const counts = emptyCampaignCounts();
    for (const row of result.results) {
      if (row.status in counts) counts[row.status] = Number(row.count) || 0;
    }
    return counts;
  }
}
