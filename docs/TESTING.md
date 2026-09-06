# Testing and verification

## Principles

- Prefer deterministic tests for domain and state transitions.
- Use mocked Graph and scripted SMTP responses before any real send.
- Keep real-mail tests small, intentional, and traceable.
- A Graph `202` or SMTP's final post-DATA `250` proves acceptance by Microsoft, not delivery.
- Never put credentials, tokens, full private email addresses, or message bodies into committed test evidence.

## Automated checks

### Unit

- Header normalization and placeholder extraction.
- CSV and workbook row normalization.
- Email-list parsing and separator handling.
- Duplicate detection.
- Template escaping and rendering.
- HTML sanitization policy.
- Campaign duration and pacing.
- State transition guards and unique send keys.
- Graph and SMTP error classification, MIME structure, envelope privacy, and STARTTLS/XOAUTH2 state transitions.
- Attachment filename/type policy, executable signature rejection, duplicate detection, file-count and combined-size limits.
- Bounded MIME HTML and attachment encoding, exact base64 content, the five-file and 20 MiB transport limits, stable safe-retry MIME identity, pre-terminator retry safety, and post-terminator ambiguity.
- Test-send provider helpers force the authenticated mailbox as the sole envelope recipient and suppress CC, BCC, and Reply-To for Graph and SMTP.

### Integration

- Exercise campaign lifecycle against the actual local Cloudflare D1 binding, including FIFO and audit triggers. SQLite test adapters must report the `total_changes()` delta for D1 `meta.changes`, not direct `changes()`. Verify an acknowledged start replay recovers a missing queued wake without changing FIFO order, publishing duplicate running ticks, or restarting cancelled/paused campaigns.

- FIFO turns preserve start order across campaigns from one mailbox and permit independent mailboxes to progress. Followers cannot reserve wakes, claim recipients, or become provider-bound. Completing, pausing, cancelling, or terminally failing the head hands off promptly while preserving pace/backoff.
- Resume joins the back, including a pause/resume race with an existing provider call. Cancellation before submission releases only proven pre-submission reservations. Cancellation during accepted, unknown, or safely retryable outcomes waits for settlement, preserves evidence/budget, prevents another attempt, and produces one request and one completion audit.
- Cancellation requires ownership, authenticated same-origin CSRF protection, and explicit acknowledgement. Missing/forged confirmations fail. Replays retain first-write timestamps, audit failure rolls back the cancellation request, and cancelled campaigns cannot resume or test-send.
- Migration from 0010 preserves the in-flight head, its effective wake and ledger, and invalidates competing follower wakes. Scheduled recovery repairs a lost handoff and finalizes a cancelled stale provider-bound attempt as Unknown without resending it.

- Manual delivery verification enforces owner, campaign, Unknown status, authentication, same-origin and CSRF checks. First-write evidence survives concurrent/repeated actions; audit failure rolls back confirmation. Original outcome, timestamps, attempt count, delivery-attempt ledger and budget remain unchanged. Bounded notes reject controls, remain outside audit/diagnostic logs, and receive CSV formula protection.
- SMTP diagnostics distinguish acknowledgement timeout, socket closure, and socket failure from pre-terminator failures. Correlation IDs join to audits without changing provider evidence or retry suppression. API diagnostic redaction excludes arbitrary exception fields, URLs and payloads, including database error details.

- D1 migrations from an empty database.
- Flow and template version repositories.
- Campaign creation and recipient-job insertion.
- Campaign-create request-size rejection before JSON parsing, normalized request-fingerprint replay and changed-content conflict behavior.
- Atomic 300-row campaign creation through bounded D1 JSON chunks, including full rollback on one invalid recipient or a lost attachment association.
- Campaign and recipient snapshot triggers for owner, sender, flow/template, totals, initial state, JSON shape, size, and immutability bypasses.
- Conditional claim behavior under duplicate Queue deliveries.
- D1 transaction-backed mailbox lease races across campaigns, with exactly one acquired provider attempt.
- Durable wake reservation and duplicate physical Queue delivery consumption.
- Rolling 8,000-recipient accounting across To, CC, BCC, duplicate occurrences, and self-only test sends.
- Exact rolling-window release, shared campaign and test-send pacing, and provider Retry-After backoff.
- Idempotent watchdog recovery for stale reserved attempts, stale provider-bound attempts, missing wakes, and exhausted campaigns.
- Pause and resume behavior.
- Safe retry for explicit throttles.
- `unknown` behavior for ambiguous transport failures.
- Authentication state, callback, session creation, expiry, logout, tenant rejection, and CSRF.
- Homepage SMTP-to-OneDrive chaining, separate resource-token persistence, SSO prompt omission, existing-grant and Graph-mode skips, cancellation and provider-failure recovery, identity mismatch rejection, missing-storage skip, safe return targets, and loop prevention.
- Attachment-set ownership, idempotent creation, immutable association, aggregate metadata bounds before download, OneDrive deletion and byte-integrity distinction, bounded terminal cleanup, and resumable 24-hour orphan cleanup.
- Attachment preclaim failures: network, HTTP 429 with `Retry-After`, and Microsoft 5xx schedule bounded retries without changing recipient state; authorization pauses while retaining the attachment set; missing or integrity-invalid objects fail before claim and request terminal cleanup.
- Attachment retry ordinal and issue state persist through D1, successful loading clears them, and authorization recovery resumes only pending jobs while accepted and unknown jobs remain terminal.
- Attachment audit evidence contains only the allowlisted category, disposition, retry ordinal, and next-attempt timestamp. It excludes raw exceptions, URLs, identifiers, provider payloads, filenames, and message content.
- Campaign creation and test-send reject attachment sets unless SMTP mode plus stored `SMTP.Send` and `Files.ReadWrite.AppFolder` grants are present.
- Test-send idempotent replay, changed-fingerprint rejection, safe pre-provider retry, ambiguous-outcome suppression, per-user limits, audit events without recipient jobs, and anonymous OAuth per-client/global limits.
- Scheduled expiry cleanup drains full OAuth-state, session, rate-counter, and stale test-claim batches while retaining a hard per-run bound.

### Frontend

- Product route loading preserves the draft through navigation, suspended chunks, and recovery from a failed chunk. Verify direct route loads still enforce session and wizard prerequisites.
- Attachment hook regression checks cover serialized uploads, retained-byte retry, reset during set creation and upload, stale queued work, and prepared-campaign removal guards.
- After `npm run build`, run `npm run check:client-bundle` (also included in `npm test`). In a production-build browser preview, confirm landing loads no product chunks, CSV import requests no ExcelJS, and the first XLSX import requests its deferred chunk.
- Campaign names remain keyboard-accessible links at narrow widths where the separate Open column is hidden.

- History/detail agree on Queued, Sending, Waiting with a local-time reason, Paused, Cancelling, and Cancelled. Normal pace is Sending. Clean completed campaigns have a clear Completed badge and successful-submission summary without claiming inbox delivery.
- Cancel confirmation is gated by acknowledgement; dismissal sends no request, failure permits retry, and successful cancellation restores focus to the campaign status. Cancelled campaigns have no pause/resume/cancel action, keep in-flight and original outcomes visible, and label pending rows Not sent. Legacy recipient waiting timestamps display in the member's browser timezone.

- Wizard navigation and prerequisite gating.
- `.csv` and `.xlsx` import.
- Worksheet and header selection.
- Mapping, validation, flagged rows, and representative previews.
- Test-send and final acknowledgement.
- Review keeps the original campaign headers visible and explains that test delivery replaces `To` with the signed-in mailbox while suppressing CC, BCC, and Reply-To.
- Multi-file selection, upload progress, retry/remove states, 5-file and 20-MiB limits, Review summary, and attachment locking after test-send.
- Campaign polling or live refresh, pause, resume, and CSV export.
- Campaign-level failure is visually and semantically distinct from recipient-level failure, pending rows become `Not sent`, accepted and unknown outcomes remain separate, terminal campaigns show no remaining-time promise, and OneDrive authorization pauses expose a reconnect plus pending-only resume path.
- Loading, empty, failure, and narrow-screen states.
- Authenticated OneDrive connected, cancelled, unavailable, failed, and identity-mismatch notices with a recovery link.

## Visual QA

For each mock route:

1. Open the reference at original detail.
2. Render the implementation at a comparable viewport and state.
3. Capture the implementation.
4. Compare reference and capture together.
5. Fix P0, P1, and P2 differences.
6. Record the final comparison and any remaining blocker in `docs/PROGRESS.md`.

Also test 1440 x 900, 1024 x 768, and 390 x 844. Check keyboard focus, contrast, overflow, and reduced motion.

For attachment UI changes, use a synthetic recipient file and at least two synthetic attachment types. Confirm the attachment picker is present only for an SMTP-authorized session, filenames and byte totals match in Review, final confirmation remains gated, and browser console warnings/errors remain empty. Stop before test-send unless the recipient and message have current authorization.

## Real Microsoft and Gmail matrix

Run only after mocked and local integration tests pass.

1. Primary USM account signs in and sends a test to self.
2. Primary USM account sends one small campaign to the five authorized Gmail recipients.
3. Verify provider acceptance, Sent Items, and inbox receipt where available.
4. Verify each attachment filename, downloaded byte count, SHA-256 digest, and content independently in Sent Items and the authorized inbox.
5. Verify app-folder cleanup, recycle-bin behavior, and whether `permanentDelete` succeeds with only delegated `Files.ReadWrite.AppFolder` before claiming immediate quota reclamation.
6. Sign out completely.
7. Secondary USM account signs in through the same Entra application.
8. Secondary account sends a test to self and a small external campaign.
9. Verify sender identity is locked to the secondary mailbox.
10. Confirm accepted recipients cannot be sent again through a duplicate queue delivery.

Record sanitized evidence: test timestamp, sender alias such as `primary` or `secondary`, recipient count, provider result category, campaign status, and whether inbox receipt was observed. Do not commit account addresses or credentials.

## Deployment checks

- Production D1 migrations applied.
- Queue producer and consumer bound.
- Attachment, resource-token, public endpoint control, mailbox scheduler, and attachment failure recovery migrations applied and hourly cleanup and recovery trigger registered.
- Production and local OneDrive callback URIs registered on the existing Entra application.
- Static assets served by the Worker.
- Production origin and both local and production Entra redirect URIs configured.
- Worker secrets present without appearing in `wrangler` files or Git.
- Public sign-in, callback, dashboard, campaign queue, pause, resume, export, and logout tested.
- Logs contain correlation identifiers but no tokens or message bodies.

For staging, verify separately:

- The named environment resolves `mailflow-staging`, `mailflow-staging-db`, `mailflow-staging-campaign-ticks`, and `mailflow-staging-campaign-ticks-dlq`; no staging binding names a production stateful resource.
- `PUBLIC_ORIGIN` is the exact stable staging URL, SMTP is selected, pace is 12, maximum recipients is 300, and the attachment object namespace is `staging`.
- All migrations are applied to staging with no pending entries, and no production migration command ran during the staging release.
- Independent staging Worker secrets exist without values appearing in configuration, command output, screenshots, or Git.
- Localhost, production, and staging Web callbacks coexist on the existing Entra application.
- A staging build runs with `CLOUDFLARE_ENV=staging` before the staging Wrangler dry run or deploy.
- Hosted landing, hashed assets, unauthenticated API behavior, OAuth redirect origin and SMTP scope, schedule, D1, Queue, and DLQ checks pass without initiating mail.
- Migration `0007_mailbox_scheduler_recovery.sql` is applied before deploying code that reads scheduler or delivery-attempt tables.
- Migration `0008_campaign_create_safeguards.sql` is applied before deploying code that writes campaign request fingerprints or bulk recipient chunks.
- Migration `0009_attachment_failure_recovery.sql` is applied before deploying code that reads attachment issue or retry columns.
- The deployed Worker version corresponds to the recorded exact candidate commit.


## Architecture follow-up regression gate (2026-09-07)

- Missing/revoked SMTP and Graph tokens pause before a row claim or mailbox charge. Temporary token failures retry preparation; a proven provider authorization rejection atomically returns the row to pending, releases its reservation, and pauses. Cancellation races and failed pause persistence preserve the original evidence through rollback.
- Same-account resume validates the recovered mail grant before the conditional transition. Accepted and unknown rows stay terminal. Self-test preparation failures retain same-key retry without a provider attempt.
- Competing template publications create one successful current version and one stale-edit conflict in actual local D1. Name conflicts, archived/foreign-owner publication, and forced transaction failure must not partially publish a name or version. One-off preparation remains unpublished.
- History cursors preserve deterministic `(created_at, id)` order across tied timestamps and new inserts, stay owner-scoped, reject malformed input, and expose only allowlisted campaign fields. Older-page failure preserves loaded rows; retry retains the cursor and obsolete responses cannot append to a refreshed first page.
- Browser verification covers reconnect/pending-only recovery, older-history retry, and stale-template conflict at 1440 x 900, 1024 x 768, and 390 x 844 where applicable. The reconnect button wraps below its explanatory text on phones.
- Run `npm run check:staging` for TypeScript, production build, initial bundle budget, unit/integration tests, production packaging dry run, isolated staging build/configuration and packaging dry run. Local D1 test configurations have no env-file or remote bindings and do not send mail.
- Consult the capacity/retention/restore section in `OPERATIONS.md` before reporting scale or disaster-recovery readiness. An isolated hosted restore and concurrent-mailbox workload measurement remain operational exercises, not claims established by unit tests.
