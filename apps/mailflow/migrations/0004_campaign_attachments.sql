-- Persist campaign-wide attachment sets and their private storage metadata.
-- Attachment bytes live in each user's OneDrive App Folder; D1 stores ownership,
-- integrity, lifecycle, and audit metadata only.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS attachment_sets (
  id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  upload_idempotency_key TEXT NOT NULL,
  file_count INTEGER NOT NULL DEFAULT 0 CHECK (file_count >= 0 AND file_count <= 5),
  total_bytes INTEGER NOT NULL DEFAULT 0 CHECK (total_bytes >= 0 AND total_bytes <= 20971520),
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'locked', 'deleted')),
  expires_at TEXT NOT NULL,
  locked_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_user_id, upload_idempotency_key),
  UNIQUE (campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_attachment_sets_owner_updated
  ON attachment_sets(owner_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_attachment_sets_orphan_expiry
  ON attachment_sets(state, campaign_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_attachment_sets_campaign
  ON attachment_sets(campaign_id);

CREATE TABLE IF NOT EXISTS attachment_files (
  id TEXT PRIMARY KEY NOT NULL,
  attachment_set_id TEXT NOT NULL REFERENCES attachment_sets(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 20971520),
  sha256_hex TEXT NOT NULL CHECK (length(sha256_hex) = 64),
  position INTEGER NOT NULL CHECK (position > 0),
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (attachment_set_id, sha256_hex),
  UNIQUE (attachment_set_id, position)
);

CREATE INDEX IF NOT EXISTS idx_attachment_files_set_position
  ON attachment_files(attachment_set_id, position ASC);
CREATE INDEX IF NOT EXISTS idx_attachment_files_cleanup
  ON attachment_files(attachment_set_id, deleted_at);
