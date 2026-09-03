import type { SessionRecord, SessionStore } from "../auth/session";
import type { D1Database } from "./contracts";
import { prepareAndBind as bind } from "./d1-helpers";

interface SessionRow {
  id_hash: string;
  user_id: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
}

function session(row: SessionRow): SessionRecord {
  return {
    userId: row.user_id,
    tokenHash: row.id_hash,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
  };
}

export class D1AuthSessionStore implements SessionStore {
  constructor(private readonly db: D1Database) {}

  async create(record: SessionRecord): Promise<void> {
    await bind(
      this.db,
      `INSERT INTO sessions (id_hash, user_id, expires_at, created_at, revoked_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
      [record.tokenHash, record.userId, record.expiresAt, record.createdAt, record.revokedAt ?? null],
    ).run();
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const row = await bind(this.db, "SELECT * FROM sessions WHERE id_hash = ?1", [tokenHash]).first<SessionRow>();
    return row ? session(row) : null;
  }

  async renewByTokenHash(tokenHash: string, expiresAt: number): Promise<void> {
    await bind(
      this.db,
      "UPDATE sessions SET expires_at = ?1 WHERE id_hash = ?2 AND revoked_at IS NULL",
      [expiresAt, tokenHash],
    ).run();
  }

  async revokeByTokenHash(tokenHash: string, revokedAt: number): Promise<void> {
    await bind(this.db, "UPDATE sessions SET revoked_at = ?1 WHERE id_hash = ?2", [revokedAt, tokenHash]).run();
  }
}
