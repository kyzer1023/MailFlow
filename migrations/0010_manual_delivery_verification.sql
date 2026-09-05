-- Forward-only: member evidence never rewrites transport or accounting state.
ALTER TABLE recipient_jobs ADD COLUMN delivery_verified_by TEXT REFERENCES users(id);
ALTER TABLE recipient_jobs ADD COLUMN delivery_verified_at TEXT;
ALTER TABLE recipient_jobs ADD COLUMN delivery_verification_note TEXT;

CREATE TRIGGER recipient_verification_insert_guard
BEFORE INSERT ON recipient_jobs
WHEN NEW.delivery_verified_at IS NOT NULL OR NEW.delivery_verified_by IS NOT NULL OR NEW.delivery_verification_note IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Delivery verification requires an existing unknown outcome');
END;

CREATE TRIGGER recipient_verified_outcome_guard
BEFORE UPDATE OF status ON recipient_jobs
WHEN OLD.delivery_verified_at IS NOT NULL AND NEW.status <> OLD.status
BEGIN
  SELECT RAISE(ABORT, 'Verified provider outcome is immutable');
END;

CREATE TRIGGER recipient_verification_guard
BEFORE UPDATE OF delivery_verified_by, delivery_verified_at, delivery_verification_note ON recipient_jobs
WHEN OLD.delivery_verified_at IS NOT NULL
  OR NEW.status <> 'unknown'
  OR NEW.delivery_verified_by IS NULL
  OR NEW.delivery_verified_at IS NULL
  OR NEW.delivery_verified_by <> (SELECT owner_user_id FROM campaigns WHERE id = NEW.campaign_id)
  OR length(COALESCE(NEW.delivery_verification_note, '')) > 500
BEGIN
  SELECT RAISE(ABORT, 'Invalid delivery verification');
END;

CREATE TRIGGER recipient_verification_audit
AFTER UPDATE OF delivery_verified_at ON recipient_jobs
WHEN OLD.delivery_verified_at IS NULL AND NEW.delivery_verified_at IS NOT NULL
BEGIN
  INSERT INTO audit_events(id, actor_user_id, campaign_id, recipient_job_id, event_type, metadata_json, created_at)
  VALUES ('verification_' || NEW.id, NEW.delivery_verified_by, NEW.campaign_id, NEW.id,
    'recipient.delivery_verified', '{"source":"owner_reported_receipt","providerOutcome":"unknown"}', NEW.delivery_verified_at);
END;
