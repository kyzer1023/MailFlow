/** Framework-neutral contracts shared by HTTP routes and persistence adapters. */

export interface AuthenticatedUser {
  id: string;
  tenantId: string;
  objectId: string;
  displayName: string | null;
  principalName: string;
  mailboxAddress: string;
}

export interface UserUpsert {
  tenantId: string;
  objectId: string;
  displayName?: string | null;
  principalName: string;
  mailboxAddress: string;
  lastLoginAt: number;
}

export interface UserStore {
  upsert(input: UserUpsert): Promise<AuthenticatedUser>;
}

export interface OAuthTokenRecord {
  userId: string;
  encryptedRefreshToken: string;
  accessTokenExpiresAt: number;
  grantedScopes: string[];
  encryptionVersion: number;
  updatedAt: number;
}

export interface OAuthTokenStore {
  save(record: OAuthTokenRecord): Promise<void>;
  findByUserId(userId: string): Promise<OAuthTokenRecord | null>;
  deleteByUserId?(userId: string): Promise<void>;
}

export interface OAuthStatePayload {
  state: string;
  codeVerifier: string;
  nonce: string;
  returnTo: string;
  issuedAt: number;
  expiresAt: number;
}

export interface OAuthStateStore {
  /** Persist a short-lived state record, preferably with an atomic TTL. */
  put(payload: OAuthStatePayload): Promise<void>;
  /** Read and consume once. A replay must return null. */
  consume(state: string): Promise<OAuthStatePayload | null>;
}

export interface AuthSession {
  userId: string;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  revokedAt?: number | null;
}

export interface AuthSessionStore {
  create(record: AuthSession): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<AuthSession | null>;
  revokeByTokenHash(tokenHash: string, revokedAt: number): Promise<void>;
}

export interface AuthorizationStart {
  authorizationUrl: string;
  state: string;
  codeVerifier: string;
  nonce: string;
  stateCookie: string;
}

export interface AuthCallbackResult {
  user: AuthenticatedUser;
  sessionToken: string;
  sessionCookie: string;
  stateCookie: string;
}

