import type {
  OAuthTokenRecord,
  OAuthTokenResource,
  OAuthTokenStore,
} from "../auth/contracts";
import type { D1Database } from "./contracts";
import { prepareAndBind as bind } from "./d1-helpers";

interface OAuthTokenRow {
  user_id: string;
  resource: OAuthTokenResource;
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
    resource: row.resource,
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
      `INSERT INTO oauth_resource_tokens
       (user_id, resource, encrypted_refresh_token, access_token_expires_at, granted_scopes, encryption_version, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(user_id, resource) DO UPDATE SET
         encrypted_refresh_token = excluded.encrypted_refresh_token,
         access_token_expires_at = excluded.access_token_expires_at,
         granted_scopes = excluded.granted_scopes,
         encryption_version = excluded.encryption_version,
         updated_at = excluded.updated_at`,
      [record.userId, record.resource, record.encryptedRefreshToken, record.accessTokenExpiresAt, JSON.stringify(record.grantedScopes), record.encryptionVersion, record.updatedAt],
    ).run();
  }

  async findByUserId(userIdValue: string, resource: OAuthTokenResource): Promise<OAuthTokenRecord | null> {
    const row = await bind(this.db, "SELECT * FROM oauth_resource_tokens WHERE user_id = ?1 AND resource = ?2", [userIdValue, resource]).first<OAuthTokenRow>();
    return row ? authToken(row) : null;
  }

  async deleteByUserId(userIdValue: string, resource?: OAuthTokenResource): Promise<void> {
    if (resource) {
      await bind(this.db, "DELETE FROM oauth_resource_tokens WHERE user_id = ?1 AND resource = ?2", [userIdValue, resource]).run();
      return;
    }
    await bind(this.db, "DELETE FROM oauth_resource_tokens WHERE user_id = ?1", [userIdValue]).run();
  }
}
