import type { FlowRecord } from "../../domain/types";
import type { D1Database, FlowRepository } from "./contracts";
import { bind, changes } from "./d1-helpers";

interface FlowRow {
  id: string;
  owner_user_id: string;
  society_name: string | null;
  name: string;
  current_template_version_id: string | null;
  state: FlowRecord["state"];
  created_at: string;
  updated_at: string;
}

function toFlow(row: FlowRow): FlowRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    societyName: row.society_name ?? null,
    name: row.name,
    currentTemplateVersionId: row.current_template_version_id ?? null,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class D1FlowRepository implements FlowRepository {
  constructor(private readonly db: D1Database) {}

  async getById(id: string): Promise<FlowRecord | null> {
    const row = await bind(this.db.prepare("SELECT * FROM flows WHERE id = ?1"), [id]).first<FlowRow>();
    return row ? toFlow(row) : null;
  }

  async getByIdForOwner(id: string, ownerUserId: string): Promise<FlowRecord | null> {
    const row = await bind(this.db.prepare("SELECT * FROM flows WHERE id = ?1 AND owner_user_id = ?2"), [id, ownerUserId]).first<FlowRow>();
    return row ? toFlow(row) : null;
  }

  async getByNameForOwner(ownerUserId: string, name: string): Promise<FlowRecord | null> {
    const row = await bind(
      this.db.prepare("SELECT * FROM flows WHERE owner_user_id = ?1 AND state = 'active' AND name = ?2 COLLATE NOCASE"),
      [ownerUserId, name.trim()],
    ).first<FlowRow>();
    return row ? toFlow(row) : null;
  }

  async listByOwner(ownerUserId: string): Promise<FlowRecord[]> {
    const result = await bind(
      this.db.prepare("SELECT * FROM flows WHERE owner_user_id = ?1 AND state = 'active' ORDER BY updated_at DESC"),
      [ownerUserId],
    ).all<FlowRow>();
    return result.results.map(toFlow);
  }

  async create(flow: FlowRecord): Promise<void> {
    await bind(
      this.db.prepare(
        `INSERT INTO flows (id, owner_user_id, society_name, name, current_template_version_id, state, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      ),
      [flow.id, flow.ownerUserId, flow.societyName, flow.name, flow.currentTemplateVersionId, flow.state, flow.createdAt, flow.updatedAt],
    ).run();
  }

  async update(flow: FlowRecord): Promise<boolean> {
    return changes(
      await bind(
        this.db.prepare(
          `UPDATE flows SET society_name = ?1, name = ?2,
             state = ?4, updated_at = ?5 WHERE id = ?6 AND owner_user_id = ?7 AND current_template_version_id IS ?3`,
        ),
        [flow.societyName, flow.name, flow.currentTemplateVersionId, flow.state, flow.updatedAt, flow.id, flow.ownerUserId],
      ).run(),
    ) === 1;
  }
}
