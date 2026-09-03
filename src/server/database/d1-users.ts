import type { UserRecord } from "../../domain/types";
import type { D1Database, UserRepository } from "./contracts";
import { bind, changes } from "./d1-helpers";

interface UserRow {
  id: string;
  tenant_id: string;
  object_id: string;
  principal_name: string;
  mailbox_address: string;
  display_name: string;
  role: UserRecord["role"];
  created_at: string;
  last_login_at: string | null;
}

function toUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    objectId: row.object_id,
    principalName: row.principal_name,
    mailboxAddress: row.mailbox_address,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at ?? null,
  };
}

export class D1UserRepository implements UserRepository {
  constructor(private readonly db: D1Database) {}

  async getById(id: string): Promise<UserRecord | null> {
    const row = await bind(this.db.prepare("SELECT * FROM users WHERE id = ?1"), [id]).first<UserRow>();
    return row ? toUser(row) : null;
  }

  async getByPrincipal(tenantId: string, principalName: string): Promise<UserRecord | null> {
    const row = await bind(
      this.db.prepare("SELECT * FROM users WHERE tenant_id = ?1 AND principal_name = ?2"),
      [tenantId, principalName.toLowerCase()],
    ).first<UserRow>();
    return row ? toUser(row) : null;
  }

  async upsert(user: UserRecord): Promise<void> {
    await bind(
      this.db.prepare(
        `INSERT INTO users (id, tenant_id, object_id, principal_name, mailbox_address, display_name, role, created_at, last_login_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
           tenant_id = excluded.tenant_id,
           object_id = excluded.object_id,
           principal_name = excluded.principal_name,
           mailbox_address = excluded.mailbox_address,
           display_name = excluded.display_name,
           role = excluded.role,
           last_login_at = excluded.last_login_at`,
      ),
      [user.id, user.tenantId, user.objectId, user.principalName.toLowerCase(), user.mailboxAddress, user.displayName, user.role, user.createdAt, user.lastLoginAt],
    ).run();
  }

  async touchLastLogin(id: string, lastLoginAt: string): Promise<boolean> {
    return changes(await bind(this.db.prepare("UPDATE users SET last_login_at = ?1 WHERE id = ?2"), [lastLoginAt, id]).run()) === 1;
  }
}
