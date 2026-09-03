import { sha256Base64Url } from "../auth/crypto";
import type {
  OAuthStatePayload,
  OAuthStateStore,
} from "../auth/contracts";
import type { D1Database } from "./contracts";
import { prepareAndBind as bind } from "./d1-helpers";

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
