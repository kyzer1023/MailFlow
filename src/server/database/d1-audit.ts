import type { AuditEventRecord } from "../../domain/types";
import type { AuditRepository, D1Database, D1PreparedStatement } from "./contracts";
import { bind, json, parseJson } from "./d1-helpers";

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

/** Build an audit insert for cross-table D1 transactions such as campaign creation. */
export function buildAuditEventInsert(db: D1Database, event: AuditEventRecord): D1PreparedStatement {
  return bind(
    db.prepare(
      `INSERT INTO audit_events (id, actor_user_id, campaign_id, recipient_job_id, event_type, metadata_json, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    ),
    [event.id, event.actorUserId, event.campaignId, event.recipientJobId, event.eventType, json(event.metadata), event.createdAt],
  );
}

export class D1AuditRepository implements AuditRepository {
  constructor(private readonly db: D1Database) {}

  async append(event: AuditEventRecord): Promise<void> {
    await buildAuditEventInsert(this.db, event).run();
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
