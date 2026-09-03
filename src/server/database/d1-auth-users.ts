import type {
  AuthenticatedUser,
  UserStore,
  UserUpsert,
} from "../auth/contracts";
import type { D1Database } from "./contracts";
import { prepareAndBind as bind } from "./d1-helpers";

interface AuthUserRow {
  id: string;
  tenant_id: string;
  object_id: string;
  principal_name: string;
  mailbox_address: string;
  display_name: string | null;
}

function authUser(row: AuthUserRow): AuthenticatedUser {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    objectId: row.object_id,
    displayName: row.display_name ?? null,
    principalName: row.principal_name,
    mailboxAddress: row.mailbox_address,
  };
}

function userId(tenantId: string, objectId: string): string {
  return `${tenantId}:${objectId}`;
}

/** D1-backed implementation of the authentication UserStore contract. */
export class D1AuthUserStore implements UserStore {
  constructor(private readonly db: D1Database) {}

  async upsert(input: UserUpsert): Promise<AuthenticatedUser> {
    const id = userId(input.tenantId, input.objectId);
    const displayName = input.displayName?.trim() || input.principalName.trim();
    const principalName = input.principalName.trim().toLowerCase();
    const mailboxAddress = input.mailboxAddress.trim().toLowerCase();
    await bind(
      this.db,
      `INSERT INTO users
       (id, tenant_id, object_id, principal_name, mailbox_address, display_name, role, created_at, last_login_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'member', ?7, ?7)
       ON CONFLICT(tenant_id, object_id) DO UPDATE SET
         principal_name = excluded.principal_name,
         mailbox_address = excluded.mailbox_address,
         display_name = excluded.display_name,
         last_login_at = excluded.last_login_at`,
      [id, input.tenantId, input.objectId, principalName, mailboxAddress, displayName, input.lastLoginAt],
    ).run();
    const row = await bind(
      this.db,
      "SELECT id, tenant_id, object_id, principal_name, mailbox_address, display_name FROM users WHERE tenant_id = ?1 AND object_id = ?2",
      [input.tenantId, input.objectId],
    ).first<AuthUserRow>();
    if (!row) throw new Error("Unable to persist the signed-in Microsoft user");
    return authUser(row);
  }
}
