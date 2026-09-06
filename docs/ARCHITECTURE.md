# Architecture

## Runtime overview

```text
Browser
  React application
  CSV/XLSX parsing
  Mapping, validation, preview
        |
        | same-origin HTTPS
        v
Cloudflare Worker
  API routes
  Microsoft OAuth callbacks
  Session and CSRF enforcement
  Campaign commands
        |
        +--> D1
        |    users, sessions, flows, template versions,
        |    campaigns, recipient jobs, attachment metadata,
        |    audit events, encrypted tokens
        |
        +--> Microsoft Graph / OneDrive App Folder
        |    temporary attachment bytes in the signed-in student's drive
        |
        +--> Cloudflare Queue
             one campaign tick at a time
                    |
                    v
             Queue consumer
                    |
                    v
             Selected Microsoft mail transport
               - current fallback: Graph /me/sendMail
               - target: SMTP AUTH with OAuth on port 587
```

## Module boundaries

- `client`: routing, view models, browser-side workbook parsing, attachment selection, sanitization, preview, and user interaction.
- `api`: HTTP routes, input validation, session checks, and orchestration.
- `domain`: pure campaign states, validation rules, template rendering, pace calculations, and contracts.
- `database`: D1 schema, SQL migrations, and repositories.
- `attachments`: file policy, per-user OneDrive App Folder coordination, checksum verification, locking, and cleanup.
- `queue`: Cloudflare Queue adapter and campaign tick consumer.
- `microsoft`: OAuth, encrypted token storage, refresh, Graph fallback, SMTP adapter, MIME generation, and provider error mapping.

Domain modules must have no Cloudflare imports. Adapters depend on domain contracts, not the reverse.

### Browser loading and draft ownership

- The public landing entry loads session state and public controls. Product routes and their shared `ProductLayout` load on demand after the session gate.
- `ProductLayout` owns one `DraftProvider` across product navigation. Its inner route boundary isolates loading failures so a failed screen does not discard the draft. Reload recovery explicitly warns that unsaved work will be cleared.
- The draft provider coordinates editable state, saved-template hydration, and immutable review/request lifecycle. `useDraftValidation` derives mappings and validation; `useDraftAttachments` owns file references, serialized uploads, retries, and generation-based reset protection.
- CSV parsing stays synchronous in the browser. XLSX parsing imports ExcelJS only after size and package checks. No workbook parsing moves to the Worker.
- `npm run check:client-bundle` traverses the production manifest's static imports, checks route/ExcelJS boundaries, and enforces a 110 kB gzip initial JavaScript budget. `npm test` includes this check after building.

## Microsoft authorization

- Single-tenant Entra application.
- Server-side authorization-code flow with PKCE.
- Graph fallback scopes: `openid`, `profile`, `email`, `offline_access`, `User.Read`, and delegated `Mail.Send`.
- SMTP target scopes: `openid`, `profile`, `email`, `offline_access`, and delegated `https://outlook.office.com/SMTP.Send`.
- Attachment storage scopes: `openid`, `profile`, `email`, `offline_access`, and delegated Graph `Files.ReadWrite.AppFolder`.
- OAuth access tokens are resource-specific. SMTP delivery and OneDrive storage use separate encrypted refresh-token records for the same user.
- After a successful homepage SMTP callback creates the application session, the API checks the stored OneDrive resource record. If the grant is absent, it creates a second state, PKCE verifier, and nonce for `Files.ReadWrite.AppFolder`, omits the OAuth `prompt` parameter so Microsoft may reuse the active session, and redirects immediately. The second callback binds tenant and object identifiers to the primary user before storing the OneDrive token.
- Graph deployments, deployments without attachment support, already-authorized users, and unavailable storage authorization skip the second leg. Cancellation or failure preserves the primary session and returns to the state-validated local destination with a visible status. `/auth` destinations are rejected to prevent callback loops.
- In SMTP mode, the validated ID token supplies the tenant object identity, display name, principal name, and mailbox address. Graph mode retains the `/me` cross-check during the rollback period.
- Redirect route: `/auth/microsoft/callback` on local and deployed origins.
- Session cookie: `HttpOnly`, `Secure` in production, `SameSite=Lax`, rotated after login, and renewed on authenticated use with a 365-day rolling lifetime. Microsoft revocation and browser cookie clearing still end access.
- OAuth state and PKCE verifier are short-lived and bound to the initiating browser.
- Refresh tokens are encrypted before D1 storage using AES-GCM with a Worker secret that is not stored in D1.
- Student passwords are not part of the application architecture.

## Data model

### users

Tenant object identity, display name, principal name, role, created time, and last login.

### sessions

Opaque session identifier hash, user reference, expiry, and revocation time. Raw session tokens are never stored.

### oauth_tokens

User reference, encrypted refresh token, access-token expiry metadata, granted scopes, encryption version, and update time.

### flows

Owner, optional society label, name, current template version, lifecycle state, and timestamps. Active flow names are unique per owner using case-insensitive comparison so campaign history can use the flow name as a stable human-readable label. Removing a flow archives it so existing campaigns and template references remain auditable. The application does not inject a specific society identity when the member creates a flow.

### template_versions

Flow reference, version number, subject template, sanitized body HTML, recipient configuration including message importance, placeholder manifest, and immutable creation metadata.

Campaign preparation may create an immutable version without publishing it as the flow's reusable template. Only explicit template saving advances `currentTemplateVersionId`. The browser submits the complete reviewed content with no selected version ID so exact campaign-create retries keep an identical fingerprint. Once preparation begins, the browser locks that reviewed snapshot, including after a lost response. Starting another send from the message preserves its content and recipients but requires attachment files to be selected again because a prepared attachment set belongs to its original campaign.

### campaigns

Flow and template references, owner, sender address, source filename, recipient totals, pace, state, pause reason, timestamps, and idempotency key.

The campaign-create API requires the idempotency key and stores a server-calculated fingerprint of the normalized, effective campaign snapshot. D1 enforces key uniqueness per owner. An exact ordinary replay or concurrent insert race resolves to the existing campaign response, while reuse of the key for different content fails with a stable conflict instead of silently returning the earlier campaign. Legacy campaigns created before fingerprints remain replay-compatible through their existing attachment-set check.

Campaign-create JSON is limited to 8 MiB at the Worker boundary before it is buffered or parsed. This application limit is deliberately below Cloudflare's plan-level request-body allowance because Workers have a fixed [128 MB isolate memory limit](https://developers.cloudflare.com/workers/platform/limits/) and Cloudflare recommends enforcing a maximum before consuming JSON bodies. Individual persisted recipient snapshots are also bounded below D1's [2 MB maximum string or row size](https://developers.cloudflare.com/d1/platform/limits/).

### attachment_sets and attachment_files

An attachment set belongs to one user and at most one campaign. D1 stores the sanitized original filename, media type, byte count, SHA-256 digest, private OneDrive locator, immutable ordering, lifecycle state, and expiry metadata. Attachment bytes live only in that user's OneDrive `Apps/MailFlow` folder and count against their OneDrive quota.

The product limit is five files and 20 MiB combined raw bytes. Open sets may be edited. Test-send locks a set, and campaign creation atomically associates an open set with one owner-matching campaign. Abandoned unassociated sets expire after 24 hours. Terminal campaign cleanup removes active OneDrive items and retains metadata for audit. Ordinary Graph deletion uses the user's recycle bin unless the scoped `permanentDelete` path is separately proven in the tenant.

Before reading bytes, the attachment service verifies that the active file rows agree with the set's bounded file count and total size. OneDrive downloads are then streamed only up to each reviewed file's stored byte count before SHA-256 verification. A missing object or an integrity mismatch is permanent for the immutable campaign set and fails clearly before another recipient is claimed. A Graph throttle, provider outage, interrupted download, or network failure remains a proven pre-submission condition: a running campaign retains its pending row and reserves one guarded delayed wake instead of failing or consuming mailbox budget.

Cleanup is resumable and deliberately bounded. An immediate terminal cleanup pass deletes no more than five active or untracked objects for one set. The hourly fallback handles at most two eligible sets per invocation, keeps metadata active after a partial OneDrive or D1 failure, and repeats idempotent deletes on a later pass. A truncated App Folder listing can never mark a set deleted.

### recipient_jobs

Campaign reference, source row, resolved recipient metadata, message importance, normalized merge data JSON, rendered subject and sanitized body, unique send key, status, attempt count, claim time, accepted time, last error category, last error message, and Graph request metadata.

Campaign creation inserts the campaign, optional owner-matching attachment association, every recipient snapshot, and the creation audit events in one D1 batch transaction. Recipient snapshots are encoded into bounded JSON chunks and expanded with SQLite JSON functions so the 300-recipient product limit does not require one query per row. Each bound chunk remains below D1's 2 MB string limit, and the full batch remains far below D1's per-invocation query limits. Database triggers independently enforce campaign ownership, sender, template, total, fingerprint, and recipient snapshot invariants if a repository caller bypasses the HTTP schema.

### audit_events

Actor, campaign, recipient job when relevant, event type, structured metadata, and timestamp. Secrets and message bodies are excluded from audit metadata.

Attachment-load audit events record only the failure category, disposition,
retry ordinal, and next-attempt timestamp when applicable. They never record
addresses, filenames, message content, bearer tokens, refresh tokens, Graph
response bodies, private download URLs, drive item identifiers, or generated
storage locators.

### test_sends and rate_limit_counters

Test sends use a dedicated owner-scoped record rather than recipient jobs. A stable client idempotency key and a server-calculated fingerprint cover the campaign, sanitized subject and HTML body, importance, and selected attachment set. The first request claims the key before Microsoft is called; exact replays return the stored terminal result, while a key reused for different effective content is rejected. A failure proven to occur before submission releases the claim so the same key may retry; an ambiguous provider outcome remains terminal and is never automatically resubmitted. Test-send audit events reference the campaign but never a recipient job and never store addresses, message bodies, or attachment bytes.

Bounded D1 counters allow five new test-send attempts per authenticated user per 10 minutes. Anonymous Microsoft OAuth starts allow 20 attempts per privacy-preserving client hash and 200 attempts globally per 10 minutes. Idempotent accepted or terminal test-send replays do not consume another rate-limit unit. The public OAuth limiter stores no raw IP address. The hourly scheduled handler drains expired authentication and control rows in bounded batches sized to outpace the globally accepted OAuth-state creation rate.

## State transitions

```text
pending -> claimed -> accepted
                   -> failed
                   -> unknown
pending -> skipped
pending -> pending after an explicitly safe retry condition
```

Campaign states:

```text
draft -> validated -> queued -> running -> completed
                              -> paused -> queued
                              -> failed
```

Only conditional SQL updates can claim a pending job. A queue duplicate that cannot claim exits successfully.

## Queue pacing

The queue carries campaign tick messages, not an uncontrolled burst of all recipients. A tick:

1. Verifies that the campaign is runnable.
2. Loads and checksum-verifies the campaign-wide attachment set before claiming a row. Transient OneDrive failures reserve a delayed attachment-check wake; deleted or changed immutable files fail the campaign without claiming the row.
3. Conditionally claims the next pending job.
4. Refreshes the user's access token for the selected Microsoft resource when needed.
5. Calls the selected mail provider once.
6. Records the result.
7. Enqueues the next tick with a delay derived from the configured pace.

At 12 messages per minute, the next tick is delayed by approximately 5 seconds. Graph `429` and explicit transient SMTP replies use their provider retry delay when present. Paused campaigns do not enqueue progress until resumed.

### Attachment-load recovery

Attachment loading is a pre-submission operation and always finishes before a
recipient row is claimed. Failures are classified at the OneDrive boundary and
have one of three durable outcomes:

- Network failures, Microsoft Graph `429` responses, and Graph `5xx` responses
  keep the campaign runnable and every recipient job unchanged. The campaign
  records an attachment retry count and schedules one guarded wake using
  exponential delay from 30 seconds through 15 minutes. A provider
  `Retry-After` value takes precedence when it is longer, and the final Queue
  delay remains clamped to Cloudflare's 86,400-second limit.
- OneDrive authorization failures pause the campaign before a recipient is
  claimed, retain the attachment set, and record an explicit reconnect-required
  issue code. Resume validates the same owner-scoped attachment set before the
  conditional `paused -> queued` transition and joins the back of the mailbox FIFO. Only the head reserves a new wake.
- A permanently missing OneDrive object, deleted attachment metadata, byte-size
  mismatch, or SHA-256 mismatch fails the campaign before a recipient is
  claimed. The campaign keeps a sanitized terminal issue code and explanation;
  terminal cleanup may remove any remaining active attachment bytes.

`campaigns.attachment_issue_code` is the machine-readable recovery contract and
`campaigns.attachment_retry_count` supplies durable backoff state. Successful
attachment loading clears both before the next recipient claim. Neither field
contains a filename, object locator, token, address, or message content.

Resuming never rewrites recipient outcomes. The next tick continues through the
existing conditional `claimNextPending` path, so `accepted`, `failed`, `skipped`,
and `unknown` jobs remain terminal and cannot be sent again through recovery or
duplicate Queue delivery.

## Mailbox scheduler, budget, and recovery

### FIFO campaign turns and cancellation (2026-09-06)

Visible results distinguish a cancellation request from its effect. A settled cancelled campaign whose complete recipient counts contain no pending, claimed or sending rows uses completed-result presentation, retaining failure/Unknown/skipped warnings. Fully accepted results display Completed. History and detail explain that cancellation stopped no rows, while the underlying irreversible cancellation state, timestamps, audit events and CSV evidence remain unchanged. Missing/incomplete counts or an attempt still settling must not receive this presentation.

Campaign mutation success uses positive D1 `meta.changes` for primary-key conditional updates, because D1 counts trigger writes as well as the campaign row. Tests emulate the `total_changes()` delta and include the local D1 runtime. Repeating an acknowledged start for an owned queued/running/completed campaign returns that same campaign. A queued replay requests the existing mailbox head's missing wake without changing FIFO order, recipient evidence, or a reserved wake; running/completed replays never publish another tick. Paused, cancelled and failed campaigns cannot use start replay to resume.

Each mailbox has a durable FIFO of campaign turns. Starting or resuming appends a new monotonically numbered turn; resume joins the back. Only the head may reserve/consume a wake or cross the campaign provider boundary. Followers stay Queued without timer polling. Completion, pause, cancellation, and terminal failure release the turn and request the next head's wake. An outstanding reserved or provider-bound mailbox attempt blocks handoff until it settles. The scheduled watchdog is fallback recovery for a missed event or publication; pacing, backoff, attachment retries, and budget waits schedule only the head.

Cancellation is an explicit owner-scoped, CSRF-protected, audited action. Forward-only migration 0011 stores immutable cancellation request and completion timestamps, projecting Cancelling and Cancelled from the existing stopped database lifecycle to avoid rebuilding referenced tables. Cancellation prevents new provider calls; an already provider-bound attempt records its real accepted, failed, or unknown result before cancellation completes. Pending rows remain original pending evidence and display Not sent (cancelled). Cancellation never recalls mail, changes accepted/unknown evidence, releases their budget, or permits resume. Pause and cancellation release proven pre-submission reservations atomically; provider-bound attempts remain protected. A new test send against a cancelled campaign is rejected, while an existing provider-bound test preserves its actual result.

`campaign_turns.sequence` is an autoincrementing durable order assigned inside the campaign lifecycle transaction. `campaign_turn_heads` is the authoritative SQL head projection, enforced at wake, claim, lease, and provider-bound transitions. A lease collision leaves only the head dormant until the holder's completion event; no five-minute collision wake is published. New handoff due times respect persisted pending-row retry deadlines and mailbox pace/backoff. Only a real timed restriction creates a delayed head wake.

At the storage boundary cancellation uses `state = 'paused'` plus `cancel_requested_at` and `cancelled_at`. Repository reads project `cancelling` or `cancelled`; public consumers must use that projection. SQL terminal-retention queries must include non-null `cancelled_at`. Two database triggers atomically append first-request and final-completion audit events. Existing accepted/unknown jobs and delivery-attempt records are immutable under cancellation; CSV includes cancellation fields separately from raw job status. Migration backfill retains the in-flight campaign first, then queued-time order, keeps the head's existing wake, and invalidates legacy competing follower wakes.

D1 coordinates delivery per authenticated mailbox, not merely per campaign. Each mailbox has one durable expiring provider lease plus mailbox-wide `next_send_at` and `provider_backoff_until` timestamps. Every campaign provider call and self-only test send must atomically acquire that lease and create a delivery-attempt reservation before crossing the provider boundary. The attempt and lease use a cryptographically unguessable token carried through conditional transitions. A Worker process-local mutex is insufficient and is not used. Cloudflare documents that [`D1Database::batch()` executes as a transaction and rolls the sequence back when a statement fails](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch); guarded conditional batches rely on that behavior.

The application reserves the full provider envelope count against an 8,000-recipient rolling 24-hour mailbox budget. To, CC, BCC, and self-only test recipients all count. Duplicate address occurrences are counted separately, including repeats across fields, so the calculation is deterministic and conservative. Accepted and ambiguous or unknown provider attempts consume their full reservation. Explicit failures that prove no provider submission and stale pre-boundary attempts release it. Budget exhaustion keeps campaign work pending, records the earliest reservation expiry as the next eligible time, and creates one bounded wake reservation rather than failing or skipping a recipient. The headroom is measured against Microsoft's documented [10,000 recipients per mailbox in a rolling 24-hour period](https://learn.microsoft.com/en-us/office365/servicedescriptions/exchange-online-service-description/exchange-online-limits#sending-limits).

Campaign wake-up is also D1-authoritative. The runnable head of a mailbox FIFO stores no more than one effective wake token and due time. Followers store none. Each Queue message carries that token, and only the consumer that conditionally consumes the matching due token may advance work. Duplicate or stale Queue messages are acknowledged as no-ops. Start, resume, pacing, throttling, and recovery reserve a wake in D1 before publishing it. If publication or a Worker invocation is lost, the hourly watchdog finds mailbox heads with pending work and recreates the missing physical wake without creating a second effective wake. Queue delays are clamped because Cloudflare's [`delaySeconds` range is 0 through 86,400 seconds](https://developers.cloudflare.com/queues/configuration/javascript-apis/#queuesendoptions); longer waits are represented by another guarded wake.

The delivery-attempt ledger distinguishes `reserved` from `provider_bound`. A crash while a job is only claimed or an attempt is only reserved is recoverable as proven pre-submission work. Once the attempt and job cross the provider boundary, stale work becomes terminal `unknown` and retains its daily-budget charge. The hourly watchdog reconciles expired mailbox leases and stale work in bounded batches, completes exhausted campaigns, and never automatically resends unknown work. User-visible scheduler messages show waiting or recovery times without exposing recipients, message content, attachments, or coordination tokens.

## Ambiguous outcomes

### Manual delivery evidence (2026-09-05)

An owner may explicitly mark an unknown recipient's delivery verified after checking receipt. `POST /api/campaigns/:id/jobs/:jobId/delivery-verification` requires the existing authenticated, same-origin, CSRF-protected mutation session and `{ confirmed: true, note?: string }`. Notes are trimmed, limited to 500 characters, and reject control characters. They are private owner-visible evidence, never diagnostic or audit metadata.

Forward-only migration `0010_manual_delivery_verification.sql` adds a separate actor, timestamp, and optional note to recipient jobs. One conditional owner-scoped update records the first confirmation; an SQLite trigger atomically appends `recipient.delivery_verified` without the note. Replays return the original evidence, including when their note differs. The database enforces owner identity, unknown status, and immutable confirmation evidence. This action changes no provider outcome, job update timestamp, attempt count, campaign state, delivery ledger, or budget. Reads and CSV expose confirmation separately from raw `unknown`; it is member-reported receipt, not new SMTP evidence. It cannot resend mail.

Diagnostics use only fixed stage and failure classifications, elapsed milliseconds, and generated correlation IDs. Raw exception messages, stacks, request paths or query strings, provider payloads, credentials, addresses, message content, and OneDrive locators are excluded. SMTP diagnostics do not change the DATA terminator ambiguity boundary, retry policy, or timeouts.

Neither Graph sendMail nor SMTP submission provides a safe application idempotency key. Graph records `accepted` after `202`. SMTP records `accepted` only after the final `250` response following the terminating DATA marker. If a known response proves that no send occurred, apply the safe retry policy. If the network fails after either provider may have accepted the message, record `unknown` and stop automatic retry for that row. This favors no duplicate message over an automatic blind rerun.

## API shape

Expected route groups:

- `/auth/microsoft/start`, `/auth/microsoft/callback`, `/auth/logout`, `/api/me`
- `/api/flows`, `/api/flows/:id`, `/api/flows/:id/versions`
- `/api/attachment-sets`, `/api/attachment-sets/:id/files`, `/api/attachment-sets/:id/files/:fileId`
- `/api/campaigns`, `/api/campaigns/:id`, `/api/campaigns/:id/jobs`
- `/api/campaigns/:id/test-send`
- `/api/campaigns/:id/start`, `/pause`, `/resume`, `/cancel`
- `/api/campaigns/:id/export.csv`

All mutating routes require an authenticated session, CSRF protection, same-origin checks, Zod validation, and ownership checks.

The campaign list includes current recipient status counts with each public campaign record. The owner-scoped repository query calculates these counts from recipient jobs in the same read as the bounded campaign list. Dashboard and history screens consume that response directly instead of requesting every campaign detail; no duplicated count storage or background synchronization is needed.

The test-send route is additionally server-authoritative at the final mail-provider boundary: `To` is always the authenticated mailbox, and campaign CC, BCC, and Reply-To are always empty even if those fields are present in the request. The validated subject, sanitized HTML body, message importance, and immutable campaign attachment set remain unchanged. A bounded per-user limit and stable idempotency key apply before provider submission.

`/auth/microsoft/start` is intentionally public, but each anonymous client hash is rate-limited before a new OAuth state record is created. The existing scheduled handler removes expired OAuth-state rows, expired or revoked session rows, expired rate-limit counters, and stale test-send claim records in addition to OneDrive orphan cleanup.

The internally chained OneDrive authorization does not create another anonymous start request. It begins only after the rate-limited primary sign-in succeeds and the application session exists. Manual `/auth/microsoft/onedrive/start` remains an authenticated recovery route and keeps account selection available when a member must correct a declined or mismatched grant.

## Cloudflare bindings

- `DB`: D1 database.
- `CAMPAIGN_QUEUE`: Queue producer.
- Queue consumer in the same Worker deployment unless operational evidence calls for a split Worker.
- Static assets binding for the Vite client.
- Secrets for Entra client secret, token-encryption key, and session integrity.
- Plain variables for tenant ID, client ID, public origin, campaign limit, and default pace.
- `MAIL_TRANSPORT` selects `graph` or `smtp`. Attachments are exposed and accepted only in `smtp` mode when the user's stored grants include both `SMTP.Send` and `Files.ReadWrite.AppFolder`.
- `ATTACHMENT_OBJECT_NAMESPACE`, when set, is a short deployment discriminator embedded in every new private OneDrive filename. Staging sets it to `staging`; production omits it to preserve the deployed filename format.
- An hourly scheduled handler removes attachment sets that remain unassociated past their 24-hour expiry. Campaign terminal paths also request immediate cleanup.

The Wrangler `staging` environment is a separate Worker with independent D1, Queue, dead-letter Queue, vars, and secrets. It shares no Cloudflare stateful binding with the top-level production deployment. Both environments use the same Entra application and per-user OneDrive App Folder, so the staging attachment namespace is the storage-level isolation boundary in addition to separate D1 ownership metadata.

## Security boundaries

- No access or refresh token reaches browser JavaScript.
- No HTML from a workbook is trusted by default.
- Spreadsheet values are escaped before insertion into templates.
- Preview content is sanitized and isolated in an iframe.
- Campaign ownership is checked on every read and write.
- Attachment APIs require the same authenticated owner, CSRF protection, same-origin mutation checks, bounded multipart bodies, approved file types, and content-signature validation.
- Queue messages and campaign JSON carry only opaque attachment-set identifiers. They never contain attachment bytes, user filenames as storage keys, or private OneDrive locators.
- OneDrive bytes are loaded through the reviewed per-file and 20 MiB aggregate bounds and rehashed before every test or campaign send. Missing or changed bytes fail the campaign before a recipient is claimed, while transient storage failures retry only from that pre-claim boundary.
- SMTP MIME permits the same maximum of five files and 20 MiB raw bytes, chunks HTML and base64 attachment output into writes no larger than 80 KiB, and derives a stable MIME boundary and Message-ID from the opaque send key for proven pre-submission retries. This identity is not treated as provider idempotency, and ambiguous submissions are still never retried.
- User-facing errors do not reveal tokens, Graph response bodies, or internal stack traces.
- Production configuration is reproducible from `wrangler` configuration, migration files, and documented secret names.

## Input boundary contract (2026-09-05)

New attachment uploads accept only DOCX, XLSX, PPTX, PDF, CSV, TXT, PNG, JPG, and JPEG. Legacy binary DOC, XLS, and PPT are discontinued. Browser preflight and Worker upload use the same pure file policy, including filename normalization, extension-specific MIME aliases, executable rejection, format signatures, and Office ZIP package subtype checks. Generic or absent browser MIME is inferred only for an allowed extension. Text accepts strict UTF-8 or BOM-marked UTF-16 and rejects binary controls. These checks identify formats, not malware or full document validity. Existing immutable attachment snapshots are not rewritten.

Office packages must have consistent local/central ZIP names, bounded entry counts and declared expansion, and the expected document part plus packaging metadata. Encrypted, ZIP64, ambiguous subtype, and macro-bearing packages are unsupported. Spreadsheet imports remain browser-only CSV/XLSX, with a 20 MiB file limit, 10,000 source rows, 100 columns, and 20,000 characters per cell; the campaign limit remains 300 selected recipient rows. The API retains its 8 MiB campaign request ceiling; all other JSON mutation bodies have a 2 MiB streaming ceiling. Template persistence failures expose only a stable recovery message.

Mailbox validation uses one ASCII dot-atom rule across browser, domain, and SMTP MIME boundaries; display-name syntax, controls, delimiters within a mailbox, and malformed labels are rejected before submission. Dynamic template lookups use only own properties, so absent fields cannot resolve inherited JavaScript properties.

Multipart upload counts actual streamed bytes through the 20 MiB plus 64 KiB envelope limit even without Content-Length, and accepts exactly one file field.
