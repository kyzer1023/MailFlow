# Accepted use cases

This document converts the approved discussion into testable product behavior. Items marked "later" are deliberately excluded from the first working prototype.

## Actors

- Member: an authenticated USM student society member who creates flows and sends campaigns from their own student mailbox.
- Administrator: a member with additional society configuration visibility. The prototype may seed this role rather than expose full role management.
- Microsoft mail transport: accepts Graph or delegated OAuth SMTP submissions and returns success or error responses.
- Queue worker: advances campaigns independently of the browser.

## UC-01 Sign in with a USM Microsoft account

1. The member selects `Continue with Microsoft`.
2. The application runs a server-side authorization-code flow with PKCE.
3. The application verifies the tenant identifier, not only the visible email suffix.
4. The application stores an application session in a secure, HTTP-only cookie.
5. In an SMTP deployment with attachment support, the application immediately starts a separate OneDrive App Folder authorization when that same user does not already have the required grant.
6. Microsoft reuses the active browser session for the second authorization. First-time OneDrive consent may still be shown.
7. The dashboard identifies the signed-in mailbox and reports whether the optional OneDrive step connected, was declined, or failed.

Acceptance:

- Both provided student accounts can sign in.
- A non-USM tenant is rejected.
- The application never stores or requests the student's mailbox password.
- The sender address cannot be changed to an arbitrary address.
- SMTP and OneDrive refresh tokens remain separate resource records. OneDrive consent is accepted only when its verified tenant and object identity match the newly signed-in MailFlow user.
- Declining or failing OneDrive does not undo the primary MailFlow login. The original validated local destination is restored and the Recipients page keeps a manual Connect OneDrive recovery action.

## UC-02 View the dashboard

The dashboard shows reusable flows, recent campaigns, actionable failures, and the signed-in member's mailbox identity. Empty, loading, and failure states remain useful.

## UC-03 Create or reuse a flow

A flow contains:

- Flow name.
- Email subject template.
- Sanitized HTML body template.
- Optional fixed or mapped CC.
- Optional fixed or mapped BCC.
- Optional fixed or mapped Reply-To.
- Message importance: Low, Normal, or High. Normal is the default.
- A template version.

Reusing a flow with a new spreadsheet creates a new campaign. It does not overwrite campaign history.

## UC-04 Import recipient data

- Accept `.csv` and `.xlsx`.
- Parse the file in the browser.
- For `.xlsx`, allow worksheet and header-row selection.
- Normalize headers to safe placeholder keys while preserving original labels.
- Do not upload or parse a workbook in a Worker.

## UC-05 Map fields and recipients

The member chooses:

- The primary recipient column.
- Placeholder-to-column mappings.
- Fixed or column-based CC, BCC, and Reply-To.
- Message importance.
- The separator for multiple addresses in a cell.

Every source row creates one recipient job and one separate message. Unrelated recipients are never combined in one To list.

## UC-06 Validate before sending

Validate:

- Missing and malformed primary addresses.
- Invalid CC and BCC values.
- Duplicate recipients.
- Missing template fields or mappings.
- Empty required values.
- Unsafe HTML, event handlers, scripts, and dangerous URLs.
- Unsupported file content.
- Campaign size above the configured limit, initially 300 recipients.

Flagged rows are visible and excluded until corrected or explicitly skipped. No message can be sent before review.

## UC-07 Preview representative messages

- Render at least the first, middle, and last valid rows.
- Escape spreadsheet values by default.
- Sanitize template HTML.
- Render preview HTML in an isolated iframe.
- Show the resolved sender, To, CC, BCC, Reply-To, subject, and body.

## UC-08 Add campaign attachments

- The member may add up to five PDF, Word, Excel, PowerPoint, CSV, text, PNG, or JPEG files.
- The combined raw file size may not exceed 20 MiB.
- Every valid recipient receives the same immutable attachment set.
- Uploads require SMTP mode plus stored delegated `SMTP.Send` and `Files.ReadWrite.AppFolder` grants. New homepage sign-ins acquire these in a chained, resource-specific journey. The interface asks older sessions to reconnect for SMTP and retains Connect OneDrive only as recovery for declined, failed, or legacy sessions.
- The browser sends files only to the same-origin authenticated API. D1 stores ownership and integrity metadata; the signed-in student's OneDrive App Folder stores the bytes against that student's existing quota.
- Executable signatures, empty files, duplicate content, mismatched extensions and media types, and unsupported formats are rejected.
- Review displays filenames and sizes. Campaign creation sends only an opaque attachment-set identifier, never file bytes or private object keys.
- Abandoned uploads expire after 24 hours. Campaign attachment bytes are deleted after the campaign reaches a terminal state while audit metadata remains.

## UC-09 Send a test to self

The member can send one rendered message, including the selected attachment set, to the authenticated mailbox before starting the campaign. The Worker replaces the resolved `To` address with the authenticated mailbox and suppresses CC, BCC, and Reply-To at the provider boundary. The original resolved headers remain visible in Review, together with an explanation of these test-only substitutions. Subject, sanitized HTML, importance, and attachments remain exactly as reviewed. The interface reports `Accepted by Microsoft`, not `Delivered`.

Each browser test action carries a stable idempotency key. Exact completed replays do not submit another provider request. Failures proven to occur before submission may retry with that key; an ambiguous provider outcome is terminal for the key and is never resent blindly. Test sends have their own bounded per-user rate limit, audit events, and persistence records, and never create campaign recipient jobs.

## UC-10 Confirm and start

The final review shows:

- Locked sender.
- Message and recipient counts.
- CC and BCC counts.
- Flow and template version.
- Configured pace.
- Estimated duration.
- Validation totals and skipped rows.
- Attachment filenames and sizes.

The member must acknowledge the review before starting.

Campaign creation carries a stable client-generated idempotency key. Replaying the same confirmed request returns the original campaign and never inserts another set of recipient jobs.

## UC-11 Send in the background

- A Queue consumer advances the campaign after the browser closes.
- Default pace is 12 messages per minute and can be reduced by configuration.
- All campaigns and self-only test sends from one authenticated mailbox share one durable D1 lease, mailbox pace, provider backoff, and rolling recipient budget.
- MailFlow reserves 8,000 envelope-recipient entries per mailbox in any rolling 24 hours. To, every CC entry, every BCC entry, and each test send count; repeated address occurrences count again.
- Each job records status, attempts, timestamps, provider response category, and a human-readable note.
- Campaigns can be paused and resumed.
- A resume starts from the first eligible unsent row.
- A durable wake token makes duplicate Queue messages harmless. The hourly watchdog recreates a missing wake after a publish failure.
- Attachment bytes are loaded and revalidated before a recipient job is claimed. Network failures, Microsoft throttling, and service failures leave every recipient state unchanged and schedule a bounded retry that honors a longer provider `Retry-After` value.
- An expired or revoked OneDrive grant pauses the campaign without deleting its attachment set. After the same member reconnects, resume revalidates that same immutable set and claims only pending rows. Accepted and unknown rows remain terminal.
- A missing, deleted, oversized, or checksum-mismatched attachment fails the campaign before another recipient is claimed.

## UC-12 Prevent blind duplicate sends

- Each recipient job has a deterministic unique send key.
- A conditional database transition claims only a pending job.
- A duplicate Queue delivery that finds a claimed or terminal job stops.
- A known throttle or pre-send temporary failure can retry after a delay.
- A timeout or lost response after the selected provider may have accepted a message becomes `unknown` and is never automatically resent.
- Recovery returns a stale pre-submission claim to pending, but a stale provider-bound attempt becomes `unknown` and keeps its rolling-budget charge.

## UC-13 Understand results

Supported states:

- `pending`
- `claimed`
- `sending`
- `accepted`
- `failed`
- `skipped`
- `unknown`
- campaign-level `paused`
- campaign-level `failed`

The user-facing label for `accepted` is `Accepted by Microsoft`. The UI explains that final delivery can still fail later.

Campaign history and detail views keep campaign-level failure separate from recipient-level outcomes. On a failed campaign, a pending row is labeled `Not sent`; accepted, recipient-failed, skipped, and unknown totals remain independently visible.

Members can export a result CSV containing row number, recipient, status, attempt count, timestamps, and diagnostic message.

## UC-14 Human-readable recovery

Examples include:

- Sign-in expired. Sign in again, then resume from the first unsent row.
- USM has not approved this application's mail permission. No messages were sent.
- Microsoft requested a temporary pause. Sending will continue at the displayed time.
- The daily mailbox allowance is temporarily full. Sending will continue automatically at the displayed rolling-window release time.
- The campaign is safe in storage and will continue when the background queue recovers.
- Campaign attachments are temporarily unavailable. MailFlow will retry without claiming another recipient.
- OneDrive needs to be reconnected. Reconnect the same Microsoft account, then resume from pending rows.
- A reviewed attachment is missing or changed. The campaign stopped before another recipient was claimed.
- This recipient address is invalid. The row was skipped.
- The template uses a field that is missing from the spreadsheet.

## Prototype release boundary

Included:

- Saved reusable flows and template versions.
- `.csv` and `.xlsx` import.
- Subject and HTML placeholders.
- Fixed or mapped recipient metadata.
- Test send, review, paced background queue, pause, resume, status, and result export.
- Up to five campaign-wide attachments totaling at most 20 MiB through delegated OAuth SMTP and temporary per-user OneDrive App Folder storage.

Later:

- Direct Google Sheets authorization and write-back.
- Shared mailbox and `Mail.Send.Shared` support.
- Arbitrary From addresses.
- Rich organization and role administration.
- Guaranteed delivery or NDR ingestion.
