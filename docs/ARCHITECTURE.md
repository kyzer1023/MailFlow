# Architecture

Mail Flow is a modular Cloudflare Worker application with a React client. This is the current design and its required safety contract. [Product](PRODUCT.md) describes user behavior; [Roadmap](ROADMAP.md) identifies implementation gaps rather than treating every intended behavior as complete.

## Runtime and module boundaries

```text
Browser: React, CSV/XLSX parsing, mapping, editing, validation, preview
  -> same-origin Worker API: OAuth, sessions, CSRF, commands, server validation
     -> D1: identity, encrypted grants, templates, campaigns, jobs, audit, coordination
     -> OneDrive App Folder: temporary owner-scoped attachment bytes
     -> Cloudflare Queue: paced campaign ticks
        -> selected Microsoft mail adapter: delegated OAuth SMTP or Graph rollback
Hourly Worker handler: delivery recovery, missing wakes, expiry, attachment cleanup
```

| Area | Responsibility |
| --- | --- |
| `src/app` | Routes, UI state, editor, preview and workflow controls |
| `src/client` | Browser parsing, mapping, rendering, and validation |
| `public/presentation`, `public/assets/committee` | Public static committee deck and illustrative screenshots, served through the existing Cloudflare asset binding |
| `src/domain` | Pure contracts, validation primitives, attachment limits, pacing and send keys |
| `src/server/api` | HTTP routes, validation, ownership, command orchestration |
| `src/server/database` | Repository interfaces, D1 queries, and conditional transitions |
| `src/server/attachments` | File policy, OneDrive coordination, integrity and cleanup |
| `src/server/queue` | Queue adapter and campaign-tick consumer |
| `src/server/microsoft`, `src/server/auth` | OAuth, sessions, encrypted tokens, SMTP/MIME, Graph rollback and error mapping |
| `worker/index.ts` | HTTP, Queue, and scheduled entrypoint composition |

Domain code does not import Cloudflare runtime types. Database, Queue, and Microsoft operations stay behind their adapters. Parsing workbooks in the browser avoids putting that CPU/memory work inside a Worker request. One deployable Worker is sufficient for the current scope; splitting services requires measured need.

The public `/presentation/` page is independent of the authenticated React application. It makes no API requests, needs no Microsoft session, and contains only synthetic screenshot data and a labeled workspace concept. Its HTML, CSS, JavaScript, and images are copied by the existing Vite build. Hash links identify individual slides; all content remains readable without JavaScript.

Product routes and their shared `ProductLayout` load after the session gate. That layout owns one `DraftProvider`; an inner route boundary preserves it across screen-loading failures. Draft coordination separates editable state and immutable request lifecycle from derived validation and serialized attachment uploads. CSV parsing stays synchronous; XLSX parsing imports ExcelJS only after size/package checks. `npm run check:client-bundle` enforces the static import boundaries and a 110 kB gzip initial JavaScript budget as part of `npm test`.

## Identity and authorization

Microsoft Entra is single-tenant. Authorization-code flows use PKCE, nonce, short-lived one-time browser-bound state, and validated local return paths. Tenant/object identity is verified; a visible email suffix is insufficient. SMTP mode takes mailbox identity from the validated ID token; Graph rollback also cross-checks `/me`.

| Resource | Delegated authorization |
| --- | --- |
| SMTP | `openid profile email offline_access https://outlook.office.com/SMTP.Send` |
| OneDrive | `openid profile email offline_access Files.ReadWrite.AppFolder` |
| Graph mail rollback | `openid profile email offline_access User.Read Mail.Send` |

Tokens are resource-specific. SMTP and OneDrive use separate encrypted refresh-token records for the same user; they are never interchangeable bearer tokens. After primary SMTP login establishes the app session, a missing OneDrive grant triggers a separate state/PKCE/nonce journey without forcing another account prompt. The second callback must match the primary tenant/object identity. Declining, failing, or mismatching OneDrive preserves primary login and returns a visible status. Existing grants, Graph mode, or unavailable storage skip this leg. Manual OneDrive connection remains a recovery route. `/auth` return destinations are rejected to prevent loops.

Session cookies are opaque, HTTP-only, SameSite=Lax, Secure in production, rotated on login, and renewed on authenticated use with a 365-day rolling lifetime. D1 stores session hashes, expiry, and revocation, not raw session tokens. Refresh tokens use AES-GCM with a secret outside D1. Browser JavaScript never receives OAuth tokens. Passwords are never part of the application.

Flows, campaigns, and attachment sets are owner-scoped. Every read/write/export must enforce ownership; mutation routes also enforce session, CSRF, same-origin, and schema validation. A society-name label or user role does not establish organization membership. The proposed workspace model needs new authorization contracts before implementation.

## Persistence and immutable sends

| Records | Purpose |
| --- | --- |
| users, sessions, OAuth states | Verified identity, session lifecycle and one-time login state |
| OAuth/resource token records | Encrypted per-user resource grants and encryption metadata |
| flows | Owner, optional society label, unique active name, current version and archive state |
| template_versions | Immutable subject, sanitized body, recipient configuration, importance and field manifest |
| campaigns | Owner/sender, flow/version, source filename, totals, pace, state, request fingerprint and recovery status |
| recipient_jobs | Row, resolved envelope/content, send key, status, attempts, timestamps and sanitized diagnostics |
| attachment_sets/files | Owner/campaign association, filename/type/size/hash, private locator, ordering and cleanup lifecycle |
| audit_events | Actor, event type, references, bounded metadata and time |
| test_sends, rate_limit_counters | Test idempotency and bounded endpoint controls |
| mailbox_send_state, delivery_attempts | Provider lease, pace, backoff and rolling-budget reservations |
| campaign_turns, campaign_turn_heads | Durable FIFO ordering and authoritative mailbox head projection |

Active flow names are unique per owner ignoring case. Archiving removes a flow from the active library while preserving campaign references. Template publication inserts an immutable version and conditionally advances the current pointer and name in one D1 batch. The browser supplies its expected published version; a stale editor receives a conflict. Campaign preparation allocates an unpublished snapshot without advancing that pointer. The browser retains and locks the exact prepared request across lost responses; starting a new send is explicit and requires attachment reselection.

Campaign-create requests require an owner-scoped idempotency key and a server-calculated fingerprint of the normalized effective snapshot. Exact replays and insert races return the existing campaign. Different content under that key conflicts. Legacy rows without fingerprints retain their attachment-set replay compatibility.

The API bounds create JSON at 8 MiB before buffering/parsing. Recipient snapshots and bound JSON chunks remain below D1's 2-MB string/row limit. One D1 batch inserts the campaign, owner-matching optional attachment association, all recipient snapshots, validation transition, and audit events atomically. SQLite JSON expansion avoids one insert query per row. Triggers independently enforce owner, sender, template, totals, initial state, fingerprint, and immutable snapshots. [D1 batch semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) provide transaction rollback.

Client escaping/sanitization supports usable feedback; independent server validation remains necessary. The HTML source editor keeps authored markup in the draft. Sanitization is applied when the visual editor displays the body, when Review builds the isolated preview iframe, and when a template or send is saved. The preview document does not apply application styles to the message body. CSV export protects against formula injection. Audit metadata excludes secrets and message bodies; attachment diagnostics also exclude addresses, filenames, drive identifiers, private URLs, provider payloads and coordination tokens.

Browser/domain/SMTP share an ASCII dot-atom mailbox rule; display names, delimiters, controls, and malformed labels are rejected. Dynamic lookup requires own properties. Other JSON mutations have a 2 MiB streamed limit. Multipart counts actual bytes up to 20 MiB plus 64 KiB and accepts exactly one file field. Shared file policy accepts modern Office packages, PDF, supported text and images; validates extension/MIME/signatures and bounded ZIP package structure; and rejects encrypted, ZIP64, macro-bearing and legacy Office formats. These are format checks, not malware scanning. Imports are bounded to 20 MiB, 10,000 rows, 100 columns and 20,000 characters per cell, while sends remain limited to 300 rows.

## Attachments

Attachment bytes live in the owning student's OneDrive `Apps/MailFlow` folder, using their quota. The browser uploads through the authenticated same-origin API. D1 records sanitized names, approved media types, byte counts, SHA-256, ordering, private locators and lifecycle. Queue messages and campaign-create JSON carry opaque set identifiers, never bytes or locators.

The product and SMTP layer share five-file/20-MiB raw-byte bounds. Open sets may be edited; test-send locks them and campaign creation atomically associates an owner-matching set. Before loading bytes, verify file count/total metadata. Stream downloads only up to each stored byte size and verify hashes. Users can change/delete OneDrive objects, so storage location alone is not immutability.

Attachment loading finishes before claiming the next recipient. Outcomes are:

- Network failures, Graph 429/5xx and interrupted downloads preserve pending work, increment a durable retry ordinal, and reserve one delayed wake. Backoff grows from 30 seconds to 15 minutes; a longer Retry-After takes precedence within the Queue's 86,400-second limit.
- OneDrive authorization failures pause for same-account reconnection and retain the immutable set. Resume revalidates before a conditional paused-to-queued transition and appends a new mailbox turn.
- Missing objects, invalid metadata, size/hash mismatch, or terminal storage failure stop the campaign before claim. Pending rows become Not sent in terminal presentation.

Successful loading clears the attachment recovery state. Resume never rewrites terminal recipient outcomes. Unassociated sets expire after 24 hours. Terminal cleanup handles at most five objects per set; scheduled cleanup processes at most two eligible sets per run. Partial failures and truncated listings remain eligible for idempotent continuation. Ordinary delete uses the OneDrive recycle bin; scoped permanent deletion and immediate quota recovery are unproven.

## Delivery coordination

One campaign tick advances one eligible recipient and reserves the next wake. A mailbox has one durable expiring provider lease plus next-send and provider-backoff times, shared by campaigns and self-tests. Conditional D1 batches acquire a lease and reserve a delivery attempt before a provider call. Process-local locks are not a correctness mechanism.

The rolling 24-hour application budget reserves 8,000 envelope-recipient entries per authenticated mailbox. To, CC, BCC, tests, and repeated address occurrences all count. Accepted and unknown attempts retain their budget charge. Only outcomes proving no submission, or stale pre-boundary attempts, release it. Budget exhaustion leaves work pending until the earliest reservation expiry. The bound leaves headroom below [Microsoft's documented mailbox limit](https://learn.microsoft.com/en-us/office365/servicedescriptions/exchange-online-service-description/exchange-online-limits#sending-limits), but Mail Flow cannot observe ordinary Outlook use.

Only the mailbox FIFO head has an effective D1 wake token/due time and may cross the provider boundary. Start/resume appends a monotonically ordered turn. Followers remain Queued without timer polling. Completion, pause, cancellation and terminal failure release the turn and request the next head's wake after any outstanding attempt settles. The SQL head projection guards wake, claim, lease and provider-bound transitions. Duplicate/stale Queue messages are no-ops. Due time respects pace, backoff, retry eligibility and budget expiry; [Queue delays](https://developers.cloudflare.com/queues/configuration/javascript-apis/#queuesendoptions) are clamped to 0-86,400 seconds. Lease collisions wait for handoff events, with the watchdog as fallback.

Conditional primary-key mutation success uses positive D1 `meta.changes`, including trigger writes. Start replay returns an owned queued/running/completed campaign. Only a queued replay may repair its mailbox head's missing wake, without changing order or reserving a second wake. Paused, cancelled and failed campaigns cannot resume through start replay.

Cancellation stores `state = paused` with immutable `cancel_requested_at` and `cancelled_at`; repository reads project Cancelling/Cancelled. Owner/CSRF checks and audit triggers protect the action. It prevents new submissions and releases proven pre-submission reservations atomically. Existing provider-bound work settles with its real result; pending rows retain raw evidence and display Not sent. Cancellation never recalls mail, permits resume, or alters accepted/Unknown charges. Complete, settled results with no stopped rows use completed-result presentation while retaining cancellation evidence; incomplete counts must not receive that presentation. Retention queries must account for cancellation timestamps.

The hourly watchdog reconciles bounded batches. A stale claim or reserved attempt that never crossed the provider boundary can return to pending. Stale sending/provider-bound work becomes terminal Unknown and retains its budget charge. It releases classified expired leases, recreates missing wakes, and completes exhausted campaigns. Never reset an Unknown row or clear the attempt ledger to force progress.

SMTP uses port 587 with STARTTLS and delegated XOAUTH2. MIME preserves HTML, importance, visible headers and BCC envelope privacy; byte output is chunked to at most 80 KiB. Stable hashed Message-ID/MIME identity supports safe pre-submission retries but is not provider idempotency. Graph is selected only at deployment and rejects attachment sends.

Acceptance requires Graph 202 or the final SMTP 250 after the DATA terminator. A loss after submission may mean acceptance, so record Unknown without automatic retry. Explicit provider rejection and proven pre-submission failures follow their retry/recovery category. Neither transport supplies a safe application idempotency key or proves inbox delivery.

Mail token preparation completes before recipient claim or test lease acquisition. A reconnect disposition pauses unsent work; a proven authorization rejection after claim returns the row to pending and releases its reservation in the same transaction as the pause. `mail_issue_code` is separate from attachment recovery. Resume verifies the same owner's mail grant before rejoining FIFO. HTTP and background handlers construct services from bindings/origin directly; background work does not fabricate HTTP contexts.

Manual delivery verification is owner-reported receipt for an Unknown row. The first confirmation atomically records actor, server time, optional private note (up to 500 characters), and audit evidence. Replays return the original evidence; provider status, attempt accounting and budget remain unchanged. Public outcomes distinguish this evidence from Microsoft acceptance and show timestamps in the viewer's timezone.

SMTP/API/background diagnostics use generated correlation IDs, fixed stages and allowlisted classifications/timing. API errors return `X-MailFlow-Request-Id` with generic text. Logs omit raw exceptions, SQL, stacks, request URLs/bodies, addresses, message content and control tokens. A network classification does not prove delivery or explain an older undiagnosed Unknown row.

## Test sends and public controls

The Worker forces test To to the authenticated mailbox and removes CC/BCC/Reply-to at the final provider boundary. It retains the reviewed subject/body, importance and attachment set. Tests have separate records, effective-content fingerprints, stable keys and audit events; they never create recipient campaign jobs.

Exact terminal replays do not call Microsoft again or consume another rate-limit unit. Changed-content keys conflict. Proven pre-submission failure may release a claim for deliberate retry; ambiguous outcomes remain terminal. Limits are five new tests per user per 10 minutes, and anonymous OAuth starts are limited to 20 per secret-derived client hash and 200 globally per 10 minutes. Store no raw client IP. Chained authenticated OneDrive consent is not a second anonymous start.

## API and deployment contract

Routes cover `/auth/microsoft/start`, the shared `/auth/microsoft/callback`, manual `/auth/microsoft/onedrive/start`, `/auth/logout`, `/api/me`, flows/versions, attachment sets/files, campaign create/list/detail/jobs, test-send, start/pause/resume/cancel, manual delivery verification, and result CSV export. Campaign listing includes live counts and owner-scoped `(created_at, id)` cursor pagination; no duplicated count store is required. Public campaign fields use an explicit allowlist.

Cloudflare bindings are `DB`, `CAMPAIGN_QUEUE`, and `ASSETS`. Secrets are `ENTRA_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY_B64`, and `SESSION_SECRET`. Non-secret configuration includes tenant/client IDs, public origin, transport, pace, and campaign limit. The hourly schedule is minute 15.

Staging has a separate Worker, D1, campaign Queue/DLQ, vars and secrets. Both environments use the same Entra application and the member's App Folder, so staging embeds `ATTACHMENT_OBJECT_NAMESPACE=staging` in new private filenames. Production omits it. No R2 binding exists. [Operations](OPERATIONS.md) governs migration compatibility, target validation, and rollback.
