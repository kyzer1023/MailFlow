-- Mail Flow initial schema
-- Apply with Wrangler D1 migrations. All times are UTC ISO-8601 strings.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  principal_name TEXT NOT NULL,
  mailbox_address TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'administrator')),
  created_at TEXT NOT NULL,
  last_login_at TEXT,
  UNIQUE (tenant_id, object_id),
  UNIQUE (tenant_id, principal_name)
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY NOT NULL,
  code_verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  return_to TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expiry ON oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encrypted_refresh_token TEXT NOT NULL,
  access_token_expires_at INTEGER NOT NULL,
  granted_scopes TEXT NOT NULL,
  encryption_version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS flows (
  id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  society_name TEXT,
  name TEXT NOT NULL,
  current_template_version_id TEXT,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_flows_owner_updated ON flows(owner_user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS template_versions (
  id TEXT PRIMARY KEY NOT NULL,
  flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  subject_template TEXT NOT NULL,
  body_html TEXT NOT NULL,
  recipient_configuration_json TEXT NOT NULL,
  placeholder_manifest_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (flow_id, version)
);

CREATE INDEX IF NOT EXISTS idx_template_versions_flow ON template_versions(flow_id, version DESC);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY NOT NULL,
  flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE RESTRICT,
  template_version_id TEXT NOT NULL REFERENCES template_versions(id) ON DELETE RESTRICT,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  sender_address TEXT NOT NULL,
  source_filename TEXT,
  total_recipients INTEGER NOT NULL CHECK (total_recipients >= 0),
  valid_recipients INTEGER NOT NULL CHECK (valid_recipients >= 0),
  skipped_recipients INTEGER NOT NULL CHECK (skipped_recipients >= 0),
  pace_per_minute INTEGER NOT NULL CHECK (pace_per_minute >= 1 AND pace_per_minute <= 600),
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'validated', 'queued', 'running', 'paused', 'completed', 'failed')),
  pause_reason TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  queued_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_campaigns_owner_created ON campaigns(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaigns_state ON campaigns(state, updated_at);

CREATE TABLE IF NOT EXISTS recipient_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  source_row INTEGER NOT NULL CHECK (source_row > 0),
  recipient TEXT NOT NULL,
  cc_json TEXT NOT NULL DEFAULT '[]',
  bcc_json TEXT NOT NULL DEFAULT '[]',
  reply_to_json TEXT NOT NULL DEFAULT '[]',
  merge_data_json TEXT NOT NULL DEFAULT '{}',
  rendered_subject TEXT NOT NULL,
  rendered_body_html TEXT NOT NULL,
  send_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'sending', 'accepted', 'failed', 'skipped', 'unknown')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  claim_token TEXT,
  claimed_at TEXT,
  sending_at TEXT,
  accepted_at TEXT,
  next_attempt_at TEXT,
  last_error_category TEXT,
  last_error_message TEXT,
  provider_message_id TEXT,
  provider_request_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (campaign_id, source_row)
);

CREATE INDEX IF NOT EXISTS idx_recipient_jobs_campaign_row ON recipient_jobs(campaign_id, source_row);
CREATE INDEX IF NOT EXISTS idx_recipient_jobs_pending ON recipient_jobs(campaign_id, status, next_attempt_at, source_row);
CREATE INDEX IF NOT EXISTS idx_recipient_jobs_claim ON recipient_jobs(claim_token);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  campaign_id TEXT REFERENCES campaigns(id) ON DELETE CASCADE,
  recipient_job_id TEXT REFERENCES recipient_jobs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_campaign_created ON audit_events(campaign_id, created_at DESC);
