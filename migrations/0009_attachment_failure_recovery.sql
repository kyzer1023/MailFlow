-- Durable classification and bounded retry state for pre-claim attachment loading.

ALTER TABLE campaigns ADD COLUMN attachment_issue_code TEXT
  CHECK (attachment_issue_code IS NULL OR attachment_issue_code IN (
    'attachment_retrying',
    'attachment_authorization_required',
    'attachment_missing',
    'attachment_integrity',
    'attachment_storage_failure'
  ));

ALTER TABLE campaigns ADD COLUMN attachment_retry_count INTEGER NOT NULL DEFAULT 0
  CHECK (attachment_retry_count >= 0);

CREATE INDEX IF NOT EXISTS idx_campaigns_attachment_issue
  ON campaigns(state, attachment_issue_code)
  WHERE attachment_issue_code IS NOT NULL;
