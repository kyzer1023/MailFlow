-- Store independent delegated refresh grants for Microsoft resources.
-- Outlook SMTP and Microsoft Graph access tokens are not interchangeable.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS oauth_resource_tokens (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource TEXT NOT NULL CHECK (resource IN ('graph_mail', 'smtp', 'onedrive')),
  encrypted_refresh_token TEXT NOT NULL,
  access_token_expires_at INTEGER NOT NULL,
  granted_scopes TEXT NOT NULL,
  encryption_version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, resource)
);

INSERT OR IGNORE INTO oauth_resource_tokens
  (user_id, resource, encrypted_refresh_token, access_token_expires_at, granted_scopes, encryption_version, updated_at)
SELECT
  user_id,
  CASE
    WHEN lower(granted_scopes) LIKE '%smtp.send%' THEN 'smtp'
    ELSE 'graph_mail'
  END,
  encrypted_refresh_token,
  access_token_expires_at,
  granted_scopes,
  encryption_version,
  updated_at
FROM oauth_tokens;

CREATE INDEX IF NOT EXISTS idx_oauth_resource_tokens_updated
  ON oauth_resource_tokens(resource, updated_at);
