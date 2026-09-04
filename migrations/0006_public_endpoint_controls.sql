-- Durable test-send idempotency and bounded public endpoint controls.

CREATE TABLE IF NOT EXISTS test_sends (
  id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'failed')),
  result_json TEXT,
  error_status INTEGER,
  error_code TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (owner_user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_test_sends_campaign_created
  ON test_sends(campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_sends_pending_updated
  ON test_sends(status, updated_at);

CREATE TABLE IF NOT EXISTS rate_limit_counters (
  scope TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (scope, subject_key, window_started_at)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_counters_expiry
  ON rate_limit_counters(expires_at);
