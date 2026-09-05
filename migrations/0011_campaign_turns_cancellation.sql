-- Forward-only FIFO turns. Existing provider attempts retain their evidence.
ALTER TABLE campaigns ADD COLUMN cancel_requested_at TEXT;
ALTER TABLE campaigns ADD COLUMN cancelled_at TEXT;

CREATE TABLE campaign_turns (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL UNIQUE REFERENCES campaigns(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES users(id)
);
CREATE INDEX idx_campaign_turns_owner ON campaign_turns(owner_user_id, sequence);

INSERT INTO campaign_turns(campaign_id, owner_user_id)
SELECT id, owner_user_id FROM campaigns WHERE state IN ('queued', 'running')
ORDER BY CASE WHEN EXISTS (SELECT 1 FROM delivery_attempts a WHERE a.campaign_id = campaigns.id
  AND a.state = 'provider_bound') THEN 0
  WHEN EXISTS (SELECT 1 FROM delivery_attempts a WHERE a.campaign_id = campaigns.id
  AND a.state = 'reserved') THEN 1 ELSE 2 END,
  COALESCE(queued_at, started_at, created_at), id;

-- Invalidate only follower wakes. Preserve each head's published wake through
-- deployment; the watchdog can repair a previously missing publication.
UPDATE campaigns SET wake_token = NULL, wake_due_at = NULL,
  scheduler_next_attempt_at = CASE WHEN attachment_issue_code = 'attachment_retrying' THEN scheduler_next_attempt_at ELSE NULL END,
  scheduler_message = NULL WHERE state IN ('queued', 'running') AND id NOT IN (
    SELECT t.campaign_id FROM campaign_turns t WHERE t.sequence =
      (SELECT MIN(h.sequence) FROM campaign_turns h WHERE h.owner_user_id = t.owner_user_id)
  );
UPDATE campaigns SET state = 'queued' WHERE state = 'running' AND id NOT IN (
  SELECT t.campaign_id FROM campaign_turns t WHERE t.sequence =
    (SELECT MIN(h.sequence) FROM campaign_turns h WHERE h.owner_user_id = t.owner_user_id)
);

-- Old lease waits are no longer deadlines; mailbox pace/backoff remain authoritative.
UPDATE recipient_jobs SET next_attempt_at = NULL
WHERE status = 'pending' AND last_error_category = 'mailbox_waiting';

CREATE VIEW campaign_turn_heads AS
SELECT c.* FROM campaigns c JOIN campaign_turns t ON t.campaign_id = c.id
WHERE c.state IN ('queued', 'running') AND c.cancel_requested_at IS NULL
  AND t.sequence = (SELECT MIN(h.sequence) FROM campaign_turns h WHERE h.owner_user_id = t.owner_user_id);

-- Also protect the brief migration/deployment overlap with the previous Worker.
CREATE TRIGGER campaign_provider_turn_guard BEFORE UPDATE OF state ON delivery_attempts
WHEN NEW.state = 'provider_bound' AND OLD.state = 'reserved' AND (
  EXISTS (SELECT 1 FROM campaigns c WHERE c.id = NEW.campaign_id AND c.cancel_requested_at IS NOT NULL)
  OR (NEW.recipient_job_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM campaign_turn_heads h WHERE h.id = NEW.campaign_id AND h.state = 'running'
  ))
)
BEGIN SELECT RAISE(ABORT, 'Campaign cannot begin provider submission'); END;

CREATE TRIGGER campaign_cancel_reservation_guard BEFORE INSERT ON delivery_attempts
WHEN EXISTS (SELECT 1 FROM campaigns c WHERE c.id = NEW.campaign_id AND c.cancel_requested_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'Campaign cannot reserve provider submission'); END;

-- An older competing tick may have claimed a follower before migration.
-- It cannot cross the new provider guard; return only proven pre-boundary
-- recipient work to pending so it does not block the mailbox until recovery.
UPDATE recipient_jobs SET status = 'pending', claim_token = NULL, claimed_at = NULL, sending_at = NULL
WHERE status = 'claimed' AND campaign_id IN (SELECT campaign_id FROM campaign_turns)
  AND campaign_id NOT IN (SELECT id FROM campaign_turn_heads)
  AND NOT EXISTS (SELECT 1 FROM delivery_attempts a
    WHERE a.recipient_job_id = recipient_jobs.id AND a.state = 'provider_bound');
UPDATE delivery_attempts SET state = 'not_submitted',
  completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), release_reason = 'fifo_migration_pre_submission'
WHERE state = 'reserved' AND recipient_job_id IS NOT NULL
  AND campaign_id IN (SELECT campaign_id FROM campaign_turns)
  AND campaign_id NOT IN (SELECT id FROM campaign_turn_heads);
UPDATE mailbox_send_state SET lease_token = NULL, lease_attempt_id = NULL, lease_expires_at = NULL
WHERE lease_attempt_id IN (SELECT id FROM delivery_attempts WHERE release_reason = 'fifo_migration_pre_submission');

CREATE TRIGGER campaign_turn_join AFTER UPDATE OF state ON campaigns
WHEN NEW.state IN ('queued', 'running') AND OLD.state NOT IN ('queued', 'running')
BEGIN
  INSERT INTO campaign_turns(campaign_id, owner_user_id) VALUES (NEW.id, NEW.owner_user_id);
END;

CREATE TRIGGER campaign_turn_leave AFTER UPDATE OF state ON campaigns
WHEN (NEW.state NOT IN ('queued', 'running') AND OLD.state IN ('queued', 'running'))
  OR (NEW.cancel_requested_at IS NOT NULL AND OLD.cancel_requested_at IS NULL)
BEGIN
  DELETE FROM campaign_turns WHERE campaign_id = NEW.id;
  UPDATE recipient_jobs SET status = 'pending', claim_token = NULL, claimed_at = NULL,
    sending_at = NULL, updated_at = NEW.updated_at
  WHERE campaign_id = NEW.id AND status = 'claimed' AND NOT EXISTS (
    SELECT 1 FROM delivery_attempts a WHERE a.recipient_job_id = recipient_jobs.id AND a.state = 'provider_bound'
  );
  UPDATE test_sends SET status = 'failed', error_status = 409, error_code = 'campaign_stopped',
    error_message = 'The test was not submitted because this campaign was stopped.',
    updated_at = CAST(strftime('%s', NEW.updated_at) AS INTEGER) * 1000
  WHERE status = 'pending' AND id IN (SELECT test_send_id FROM delivery_attempts
    WHERE campaign_id = NEW.id AND state = 'reserved' AND test_send_id IS NOT NULL);
  UPDATE delivery_attempts SET state = 'not_submitted', completed_at = NEW.updated_at,
    release_reason = 'campaign_stopped_before_submission'
  WHERE campaign_id = NEW.id AND state = 'reserved';
  UPDATE mailbox_send_state SET lease_token = NULL, lease_attempt_id = NULL, lease_expires_at = NULL,
    updated_at = NEW.updated_at WHERE lease_attempt_id IN (
      SELECT id FROM delivery_attempts WHERE campaign_id = NEW.id AND state = 'not_submitted'
    );
END;

CREATE TRIGGER campaign_cancel_guard BEFORE UPDATE ON campaigns
WHEN (NEW.cancel_requested_at IS NOT NULL AND NEW.state != 'paused')
  OR (OLD.cancel_requested_at IS NULL AND NEW.cancel_requested_at IS NOT NULL AND OLD.state NOT IN ('queued', 'running', 'paused'))
  OR (NEW.cancelled_at IS NOT NULL AND EXISTS (SELECT 1 FROM delivery_attempts a WHERE a.campaign_id = NEW.id AND a.state IN ('reserved', 'provider_bound')))
  OR (OLD.cancel_requested_at IS NOT NULL AND (
    NEW.cancel_requested_at IS NOT OLD.cancel_requested_at OR NEW.state != 'paused'))
  OR (OLD.cancelled_at IS NOT NULL AND NEW.cancelled_at IS NOT OLD.cancelled_at)
  OR (NEW.cancelled_at IS NOT NULL AND NEW.cancel_requested_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'Cancellation is irreversible'); END;

CREATE TRIGGER campaign_cancel_audit AFTER UPDATE OF cancel_requested_at ON campaigns
WHEN OLD.cancel_requested_at IS NULL AND NEW.cancel_requested_at IS NOT NULL
BEGIN
  INSERT INTO audit_events(id, actor_user_id, campaign_id, event_type, metadata_json, created_at)
  VALUES ('cancel_' || NEW.id, NEW.owner_user_id, NEW.id, 'campaign.cancel_requested', '{}', NEW.cancel_requested_at);
END;

CREATE TRIGGER campaign_cancelled_audit AFTER UPDATE OF cancelled_at ON campaigns
WHEN OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL
BEGIN
  INSERT INTO audit_events(id, actor_user_id, campaign_id, event_type, metadata_json, created_at)
  VALUES ('cancelled_' || NEW.id, NEW.owner_user_id, NEW.id, 'campaign.cancelled', '{}', NEW.cancelled_at);
END;
