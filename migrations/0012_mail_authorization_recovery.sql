-- Forward-only: keeps mail authorization recovery separate from attachment issues.
ALTER TABLE campaigns ADD COLUMN mail_issue_code TEXT
  CHECK (mail_issue_code IS NULL OR mail_issue_code = 'mail_authorization_required');

CREATE INDEX idx_campaigns_owner_history ON campaigns(owner_user_id, created_at DESC, id DESC);
