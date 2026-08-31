import { sha256Base64Url } from "../auth/crypto";
import type {
  AuthenticatedUser,
  OAuthStatePayload,
  OAuthStateStore,
  OAuthTokenRecord,
  OAuthTokenStore,
  UserStore,
  UserUpsert,
} from "../auth/contracts";
import type { SessionRecord, SessionStore } from "../auth/session";
import type { D1Database, D1Value } from "./contracts";

interface AuthUserRow {
  id: string;
  tenant_id: string;
  object_id: string;
  principal_name: string;
  mailbox_address: string;
  display_name: string | null;
}

function bind(db: D1Database, sql: string, values: readonly unknown[]) {
  return db.prepare(sql).bind(...(values as D1Value[]));
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

interface OAuthTokenRow {
  user_id: string;
  encrypted_refresh_token: string;
  access_token_expires_at: number;
  granted_scopes: string;
  encryption_version: number;
  updated_at: number;
}

function parseScopes(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function authToken(row: OAuthTokenRow): OAuthTokenRecord {
  return {
    userId: row.user_id,
    encryptedRefreshToken: row.encrypted_refresh_token,
    accessTokenExpiresAt: Number(row.access_token_expires_at),
    grantedScopes: parseScopes(row.granted_scopes),
    encryptionVersion: Number(row.encryption_version),
    updatedAt: Number(row.updated_at),
  };
}

export class D1AuthTokenStore implements OAuthTokenStore {
  constructor(private readonly db: D1Database) {}

  async save(record: OAuthTokenRecord): Promise<void> {
    await bind(
      this.db,
      `INSERT INTO oauth_tokens
       (user_id, encrypted_refresh_token, access_token_expires_at, granted_scopes, encryption_version, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(user_id) DO UPDATE SET
         encrypted_refresh_token = excluded.encrypted_refresh_token,
         access_token_expires_at = excluded.access_token_expires_at,
         granted_scopes = excluded.granted_scopes,
         encryption_version = excluded.encryption_version,
         updated_at = excluded.updated_at`,
      [record.userId, record.encryptedRefreshToken, record.accessTokenExpiresAt, JSON.stringify(record.grantedScopes), record.encryptionVersion, record.updatedAt],
    ).run();
  }

  async findByUserId(userIdValue: string): Promise<OAuthTokenRecord | null> {
    const row = await bind(this.db, "SELECT * FROM oauth_tokens WHERE user_id = ?1", [userIdValue]).first<OAuthTokenRow>();
    return row ? authToken(row) : null;
  }

  async deleteByUserId(userIdValue: string): Promise<void> {
    await bind(this.db, "DELETE FROM oauth_tokens WHERE user_id = ?1", [userIdValue]).run();
  }
}

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

interface OAuthStateRow {
  code_verifier: string;
  nonce: string;
  return_to: string;
  issued_at: number;
  expires_at: number;
}

/** One-time, TTL-bound D1 state store for deployments with multiple Worker instances. */
export class D1OAuthStateStore implements OAuthStateStore {
  constructor(private readonly db: D1Database, private readonly now: () => number = Date.now) {}

  async put(payload: OAuthStatePayload): Promise<void> {
    await bind(
      this.db,
      `INSERT INTO oauth_states (state_hash, code_verifier, nonce, return_to, issued_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(state_hash) DO UPDATE SET
         code_verifier = excluded.code_verifier,
         nonce = excluded.nonce,
         return_to = excluded.return_to,
         issued_at = excluded.issued_at,
         expires_at = excluded.expires_at`,
      [await sha256Base64Url(payload.state), payload.codeVerifier, payload.nonce, payload.returnTo, payload.issuedAt, payload.expiresAt],
    ).run();
  }

  async consume(state: string): Promise<OAuthStatePayload | null> {
    const now = this.now();
    const row = await bind(
      this.db,
      `DELETE FROM oauth_states
       WHERE state_hash = ?1 AND expires_at > ?2
       RETURNING code_verifier, nonce, return_to, issued_at, expires_at`,
      [await sha256Base64Url(state), now],
    ).first<OAuthStateRow>();
    if (!row) return null;
    return {
      state,
      codeVerifier: row.code_verifier,
      nonce: row.nonce,
      returnTo: row.return_to,
      issuedAt: Number(row.issued_at),
      expiresAt: Number(row.expires_at),
    };
  }
}

export interface D1AuthStores {
  userStore: D1AuthUserStore;
  tokenStore: D1AuthTokenStore;
  sessionStore: D1AuthSessionStore;
  stateStore: D1OAuthStateStore;
}

export function createD1AuthStores(db: D1Database, now: () => number = Date.now): D1AuthStores {
  return {
    userStore: new D1AuthUserStore(db),
    tokenStore: new D1AuthTokenStore(db),
    sessionStore: new D1AuthSessionStore(db),
    stateStore: new D1OAuthStateStore(db, now),
  };
}
