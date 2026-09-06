-- Read-only aggregate snapshot. Apply migrations through 0012 first.
-- No identities, coordination tokens, message data, or attachment locators.
WITH cleanup AS (
  SELECT a.expires_at FROM attachment_sets a
  LEFT JOIN campaigns c ON c.id = a.campaign_id
  WHERE a.state IN ('open', 'locked') AND (
    (a.campaign_id IS NULL AND julianday(a.expires_at) <= julianday('now'))
    OR c.state IN ('completed', 'failed') OR c.cancelled_at IS NOT NULL
  )
)
SELECT
  (SELECT COUNT(DISTINCT owner_user_id) FROM campaigns WHERE state IN ('queued', 'running') AND cancel_requested_at IS NULL) AS active_mailboxes,
  (SELECT COUNT(*) FROM campaigns WHERE state IN ('queued', 'running') AND cancel_requested_at IS NULL) AS runnable_campaigns,
  (SELECT COUNT(*) FROM campaigns WHERE state = 'paused' AND cancel_requested_at IS NULL AND mail_issue_code = 'mail_authorization_required') AS mail_reconnect_pauses,
  (SELECT COUNT(*) FROM campaigns WHERE state = 'paused' AND cancel_requested_at IS NULL AND attachment_issue_code = 'attachment_authorization_required') AS storage_reconnect_pauses,
  (SELECT COUNT(*) FROM campaigns WHERE state IN ('queued', 'running') AND wake_token IS NOT NULL AND julianday(wake_due_at) < julianday('now', '-5 minutes')) AS wakes_overdue_five_minutes,
  (SELECT COUNT(*) FROM delivery_attempts WHERE state = 'provider_bound' AND julianday(provider_bound_at) < julianday('now', '-10 minutes')) AS stale_provider_bound_attempts,
  (SELECT COUNT(*) FROM delivery_attempts WHERE state = 'unknown' AND julianday(completed_at) >= julianday('now', '-24 hours')) AS unknown_attempts_last_day,
  (SELECT COUNT(*) FROM cleanup) AS eligible_cleanup_sets,
  (SELECT COUNT(*) FROM cleanup WHERE julianday(expires_at) < julianday('now', '-24 hours')) AS cleanup_sets_expired_over_one_day;
