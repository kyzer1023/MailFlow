-- Mailbox-wide delivery coordination, rolling recipient budget, and durable wakes.

ALTER TABLE campaigns ADD COLUMN scheduler_next_attempt_at TEXT;
ALTER TABLE campaigns ADD COLUMN scheduler_message TEXT;
ALTER TABLE campaigns ADD COLUMN wake_token TEXT;
ALTER TABLE campaigns ADD COLUMN wake_due_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_wake_token
  ON campaigns(wake_token) WHERE wake_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaigns_watchdog
  ON campaigns(state, wake_due_at, scheduler_next_attempt_at, updated_at);

CREATE TABLE mailbox_send_state (
  owner_user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lease_token TEXT UNIQUE,
  lease_attempt_id TEXT,
  lease_expires_at TEXT,
  next_send_at TEXT,
  provider_backoff_until TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_mailbox_send_state_expired_lease
  ON mailbox_send_state(lease_expires_at)
  WHERE lease_token IS NOT NULL;

CREATE TABLE delivery_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id TEXT REFERENCES campaigns(id) ON DELETE CASCADE,
  recipient_job_id TEXT REFERENCES recipient_jobs(id) ON DELETE CASCADE,
  -- Test-send rows are short-lived idempotency records. Keep delivery attempts
  -- independent so cleanup cannot release a still-active 24-hour budget charge.
  test_send_id TEXT,
  attempt_token TEXT NOT NULL UNIQUE,
  envelope_recipient_count INTEGER NOT NULL CHECK (envelope_recipient_count > 0),
  state TEXT NOT NULL CHECK (state IN ('reserved', 'provider_bound', 'accepted', 'unknown', 'not_submitted')),
  reserved_at TEXT NOT NULL,
  provider_bound_at TEXT,
  completed_at TEXT,
  budget_expires_at TEXT NOT NULL,
  release_reason TEXT,
  provider_request_id TEXT,
  CHECK (
    (recipient_job_id IS NOT NULL AND test_send_id IS NULL)
    OR (recipient_job_id IS NULL AND test_send_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX idx_delivery_attempts_active_job
  ON delivery_attempts(recipient_job_id)
  WHERE recipient_job_id IS NOT NULL AND state IN ('reserved', 'provider_bound');
CREATE UNIQUE INDEX idx_delivery_attempts_active_test
  ON delivery_attempts(test_send_id)
  WHERE test_send_id IS NOT NULL AND state IN ('reserved', 'provider_bound');
CREATE INDEX idx_delivery_attempts_budget
  ON delivery_attempts(owner_user_id, state, budget_expires_at);
CREATE INDEX idx_delivery_attempts_recovery
  ON delivery_attempts(state, reserved_at, provider_bound_at);

-- D1 batches are transactions. Repository batches use this permanent row to
-- deliberately raise a uniqueness error when a guarded statement changed no
-- row, which rolls the full lease or transition batch back.
CREATE TABLE mailbox_coordination_guard (
  singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1)
);
INSERT INTO mailbox_coordination_guard(singleton) VALUES (1);
