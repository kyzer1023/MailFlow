-- Bound and bind each new campaign snapshot to its authenticated owner.
-- Existing campaign rows predate request fingerprints and remain readable.

PRAGMA foreign_keys = ON;

ALTER TABLE campaigns ADD COLUMN request_fingerprint TEXT
  CHECK (request_fingerprint IS NULL OR length(request_fingerprint) = 43);

CREATE TRIGGER campaigns_create_invariants
BEFORE INSERT ON campaigns
BEGIN
  SELECT (CASE WHEN NEW.request_fingerprint IS NULL OR length(NEW.request_fingerprint) != 43
    OR NEW.request_fingerprint GLOB '*[^A-Za-z0-9_-]*'
    THEN RAISE(ABORT, 'campaign request fingerprint required') END);
  SELECT (CASE WHEN length(NEW.id) < 1 OR length(NEW.id) > 128
    OR length(NEW.idempotency_key) < 1 OR length(NEW.idempotency_key) > 160
    OR length(NEW.sender_address) < 1 OR length(NEW.sender_address) > 320
    OR (NEW.source_filename IS NOT NULL AND length(NEW.source_filename) > 255)
    THEN RAISE(ABORT, 'campaign text bounds violated') END);
  SELECT (CASE WHEN NEW.total_recipients < 1 OR NEW.total_recipients > 300
    OR NEW.valid_recipients < 1 OR NEW.valid_recipients > 300
    OR NEW.skipped_recipients < 0 OR NEW.skipped_recipients > 300
    OR NEW.total_recipients != NEW.valid_recipients + NEW.skipped_recipients
    THEN RAISE(ABORT, 'campaign recipient totals invalid') END);
  SELECT (CASE WHEN NEW.state != 'draft'
    THEN RAISE(ABORT, 'campaign must begin as draft') END);
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM flows
    WHERE flows.id = NEW.flow_id
      AND flows.owner_user_id = NEW.owner_user_id
      AND flows.state = 'active'
  ) THEN RAISE(ABORT, 'campaign flow ownership invalid') END);
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM template_versions
    WHERE template_versions.id = NEW.template_version_id
      AND template_versions.flow_id = NEW.flow_id
  ) THEN RAISE(ABORT, 'campaign template invalid') END);
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM users
    WHERE users.id = NEW.owner_user_id
      AND lower(users.mailbox_address) = lower(NEW.sender_address)
  ) THEN RAISE(ABORT, 'campaign sender ownership invalid') END);
END;

CREATE TRIGGER campaigns_validate_invariants
BEFORE UPDATE OF state ON campaigns
WHEN OLD.state = 'draft' AND NEW.state = 'validated'
BEGIN
  SELECT (CASE WHEN (
    SELECT COUNT(*) FROM recipient_jobs WHERE campaign_id = NEW.id
  ) != NEW.valid_recipients
    THEN RAISE(ABORT, 'campaign recipient snapshot incomplete') END);
END;

CREATE TRIGGER campaigns_snapshot_immutable
BEFORE UPDATE OF flow_id, template_version_id, owner_user_id, sender_address,
  source_filename, total_recipients, valid_recipients, skipped_recipients,
  pace_per_minute, idempotency_key, request_fingerprint ON campaigns
BEGIN
  SELECT RAISE(ABORT, 'campaign snapshot is immutable');
END;

CREATE TRIGGER recipient_jobs_create_invariants
BEFORE INSERT ON recipient_jobs
BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = NEW.campaign_id
      AND campaigns.state = 'draft'
  ) THEN RAISE(ABORT, 'recipient campaign invalid') END);
  SELECT (CASE WHEN (
    SELECT COUNT(*) FROM recipient_jobs WHERE campaign_id = NEW.campaign_id
  ) >= (
    SELECT valid_recipients FROM campaigns WHERE id = NEW.campaign_id
  ) THEN RAISE(ABORT, 'recipient count exceeds campaign total') END);
  SELECT (CASE WHEN length(NEW.id) < 1 OR length(NEW.id) > 128
    OR NEW.source_row < 1 OR NEW.source_row > 1000000
    OR length(NEW.recipient) < 1 OR length(NEW.recipient) > 320
    OR length(NEW.rendered_subject) < 1 OR length(NEW.rendered_subject) > 998
    OR instr(NEW.rendered_subject, char(10)) > 0 OR instr(NEW.rendered_subject, char(13)) > 0
    OR length(NEW.rendered_body_html) < 1 OR length(NEW.rendered_body_html) > 200000
    OR length(NEW.send_key) < 1 OR length(NEW.send_key) > 255
    THEN RAISE(ABORT, 'recipient text bounds violated') END);
  SELECT (CASE WHEN NEW.status != 'pending' OR NEW.attempt_count != 0
    OR NEW.claim_token IS NOT NULL OR NEW.claimed_at IS NOT NULL
    OR NEW.sending_at IS NOT NULL OR NEW.accepted_at IS NOT NULL
    OR NEW.next_attempt_at IS NOT NULL
    THEN RAISE(ABORT, 'recipient initial state invalid') END);
  SELECT (CASE WHEN NOT json_valid(NEW.cc_json)
    OR NOT json_valid(NEW.bcc_json)
    OR NOT json_valid(NEW.reply_to_json)
    OR NOT json_valid(NEW.merge_data_json)
    THEN RAISE(ABORT, 'recipient JSON invalid') END);
  SELECT (CASE WHEN json_type(NEW.cc_json) != 'array'
    OR json_type(NEW.bcc_json) != 'array'
    OR json_type(NEW.reply_to_json) != 'array'
    OR json_type(NEW.merge_data_json) != 'object'
    THEN RAISE(ABORT, 'recipient JSON shape invalid') END);
  SELECT (CASE WHEN json_array_length(NEW.cc_json) > 50
    OR json_array_length(NEW.bcc_json) > 50
    OR json_array_length(NEW.reply_to_json) > 50
    OR (SELECT COUNT(*) FROM json_each(NEW.merge_data_json)) > 100
    THEN RAISE(ABORT, 'recipient JSON count invalid') END);
  SELECT (CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.cc_json)
    WHERE type != 'text' OR length(value) < 1 OR length(value) > 320
  ) OR EXISTS (
    SELECT 1 FROM json_each(NEW.bcc_json)
    WHERE type != 'text' OR length(value) < 1 OR length(value) > 320
  ) OR EXISTS (
    SELECT 1 FROM json_each(NEW.reply_to_json)
    WHERE type != 'text' OR length(value) < 1 OR length(value) > 320
  ) THEN RAISE(ABORT, 'recipient address JSON invalid') END);
  SELECT (CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.merge_data_json)
    WHERE type != 'text' OR length(key) < 1 OR length(key) > 160 OR length(value) > 20000
  ) THEN RAISE(ABORT, 'recipient merge JSON invalid') END);
  SELECT (CASE WHEN length(CAST(NEW.recipient AS BLOB))
    + length(CAST(NEW.cc_json AS BLOB))
    + length(CAST(NEW.bcc_json AS BLOB))
    + length(CAST(NEW.reply_to_json AS BLOB))
    + length(CAST(NEW.merge_data_json AS BLOB))
    + length(CAST(NEW.rendered_subject AS BLOB))
    + length(CAST(NEW.rendered_body_html AS BLOB)) > 1500000
    THEN RAISE(ABORT, 'recipient snapshot too large') END);
END;

CREATE TRIGGER recipient_jobs_snapshot_immutable
BEFORE UPDATE OF campaign_id, source_row, recipient, cc_json, bcc_json,
  reply_to_json, importance, merge_data_json, rendered_subject,
  rendered_body_html, send_key, created_at ON recipient_jobs
BEGIN
  SELECT RAISE(ABORT, 'recipient snapshot is immutable');
END;
