ALTER TABLE users ADD COLUMN provider TEXT NOT NULL DEFAULT 'microsoft' CHECK (provider IN ('microsoft', 'google'));
ALTER TABLE campaigns ADD COLUMN provider TEXT NOT NULL DEFAULT 'microsoft' CHECK (provider IN ('microsoft', 'google'));
CREATE TABLE oauth_resource_tokens_next (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource TEXT NOT NULL CHECK (resource IN ('graph_mail', 'smtp', 'onedrive', 'google')),
  encrypted_refresh_token TEXT NOT NULL,
  access_token_expires_at INTEGER NOT NULL,
  granted_scopes TEXT NOT NULL,
  encryption_version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, resource)
);
INSERT INTO oauth_resource_tokens_next SELECT * FROM oauth_resource_tokens;
DROP TABLE oauth_resource_tokens;
ALTER TABLE oauth_resource_tokens_next RENAME TO oauth_resource_tokens;
CREATE INDEX idx_oauth_resource_tokens_updated ON oauth_resource_tokens(resource, updated_at);
CREATE TRIGGER users_provider_immutable BEFORE UPDATE OF provider, tenant_id, object_id ON users
WHEN NEW.provider != OLD.provider OR NEW.tenant_id != OLD.tenant_id OR NEW.object_id != OLD.object_id
BEGIN SELECT RAISE(ABORT, 'Account identity is immutable'); END;
CREATE TRIGGER campaigns_provider_owner BEFORE INSERT ON campaigns
WHEN NEW.provider != (SELECT provider FROM users WHERE id = NEW.owner_user_id)
BEGIN SELECT RAISE(ABORT, 'Campaign provider must match owner'); END;
CREATE TRIGGER campaigns_provider_immutable BEFORE UPDATE OF provider ON campaigns
WHEN NEW.provider != OLD.provider
BEGIN SELECT RAISE(ABORT, 'Campaign provider is immutable'); END;
CREATE TRIGGER campaigns_google_pace BEFORE INSERT ON campaigns
WHEN NEW.provider = 'google' AND NEW.pace_per_minute > 6
BEGIN SELECT RAISE(ABORT, 'Gmail pace exceeds safety ceiling'); END;
