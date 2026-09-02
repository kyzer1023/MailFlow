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
5. The dashboard identifies the signed-in mailbox.

Acceptance:

- Both provided student accounts can sign in.
- A non-USM tenant is rejected.
- The application never stores or requests the student's mailbox password.
- The sender address cannot be changed to an arbitrary address.

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
- Uploads require SMTP mode plus stored delegated `SMTP.Send` and `Files.ReadWrite.AppFolder` grants. The interface asks an older session to reconnect for SMTP, then offers a one-time Connect OneDrive action before it exposes uploads.
- The browser sends files only to the same-origin authenticated API. D1 stores ownership and integrity metadata; the signed-in student's OneDrive App Folder stores the bytes against that student's existing quota.
- Executable signatures, empty files, duplicate content, mismatched extensions and media types, and unsupported formats are rejected.
- Review displays filenames and sizes. Campaign creation sends only an opaque attachment-set identifier, never file bytes or private object keys.
- Abandoned uploads expire after 24 hours. Campaign attachment bytes are deleted after the campaign reaches a terminal state while audit metadata remains.

## UC-09 Send a test to self

The member can send one rendered message, including the selected attachment set, to the authenticated mailbox before starting the campaign. The interface reports `Accepted by Microsoft`, not `Delivered`.

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
- Each job records status, attempts, timestamps, provider response category, and a human-readable note.
- Campaigns can be paused and resumed.
- A resume starts from the first eligible unsent row.

## UC-12 Prevent blind duplicate sends

- Each recipient job has a deterministic unique send key.
- A conditional database transition claims only a pending job.
- A duplicate Queue delivery that finds a claimed or terminal job stops.
- A known throttle or pre-send temporary failure can retry after a delay.
- A timeout or lost response after the selected provider may have accepted a message becomes `unknown` and is never automatically resent.

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

The user-facing label for `accepted` is `Accepted by Microsoft`. The UI explains that final delivery can still fail later.

Members can export a result CSV containing row number, recipient, status, attempt count, timestamps, and diagnostic message.

## UC-14 Human-readable recovery

Examples include:

- Sign-in expired. Sign in again, then resume from the first unsent row.
- USM has not approved this application's mail permission. No messages were sent.
- Microsoft requested a temporary pause. Sending will continue at the displayed time.
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
