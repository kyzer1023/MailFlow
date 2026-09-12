# Operations and verification

Run application commands from the repository root. Read [Architecture](ARCHITECTURE.md) for invariants and [Roadmap](ROADMAP.md) for unresolved readiness work. Repository configuration describes expected resources; inspect the actual target before making remote changes. Do not infer live release identity from a local commit or old test evidence.

## Environment inventory

| Concern | Production | Staging |
| --- | --- | --- |
| Worker | `mailflow` | `mailflow-staging` |
| D1, binding `DB` | `mailflow-db` | `mailflow-staging-db` |
| Queue, binding `CAMPAIGN_QUEUE` | `mailflow-campaign-ticks` | `mailflow-staging-campaign-ticks` |
| Dead-letter Queue | None declared | `mailflow-staging-campaign-ticks-dlq` |
| Public origin | [Production](https://mailflow.kyzer-hono-test.workers.dev) | [Staging](https://mailflow-staging.kyzer-hono-test.workers.dev) |
| Attachment namespace | Default | `staging` |
| Schedule | Hourly, minute 15 | Hourly, minute 15 |

The exact non-secret IDs and bindings live in [wrangler.jsonc](../wrangler.jsonc). Both environments use the existing single-tenant Entra `MailFlow` application and each member's OneDrive App Folder, but separate D1, Queues and independent secrets. There is no R2 resource. Do not provision duplicates during routine maintenance.

The root package provides all commands. Static client output is reproducible through Vite; `worker/index.ts` remains the sole production application entrypoint. Cloudflare Git build directory configuration must point at the repository root.

## Local full-stack setup

1. Run `npm ci`.
2. Copy [.env.example](../.env.example) to ignored `.env` and supply local values securely. Use `.env` or `.dev.vars`, never both. Do not use `.env.test-accounts` as configuration.
3. Use a dedicated short-lived Entra client credential and independent local token/session secrets. Never extract/reuse production secrets.
4. Keep `http://localhost:5173/auth/microsoft/callback` registered as a Web redirect URI on the existing app. An alternate port requires a matching callback before OAuth testing.
5. Run `npm run db:migrate:local` for the local D1 schema.
6. Run `npm run dev`. The Cloudflare Vite plugin serves client and Worker on the same local origin; do not start a separate API server.
7. Before sign-in, check landing/static responses, unauthenticated `/api/me` returning 401 JSON, and unknown API GET/POST returning 404 JSON rather than the app shell.

An OAuth-start 503 indicates missing required local configuration; a working landing page does not establish OAuth readiness. Sign-in and mail testing require the relevant authorized accounts and recipients. For public UI captures, use synthetic local data and isolated mocked API responses; label them as illustrative.

## Credentials and Microsoft consent

Worker secrets are `ENTRA_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY_B64`, and `SESSION_SECRET`. Keep values out of vars, command arguments, logs, files committed to Git, screenshots and chat. Generate the token key from 32 cryptographically random bytes; use an independent high-entropy session secret. Pipe values directly to Wrangler secret input.

Keep localhost, production, and staging Web callbacks together where needed. Both mail and OneDrive authorization reuse `/auth/microsoft/callback` on the active origin. Preserve single-tenant support and delegated-only permissions. SMTP requests `https://outlook.office.com/SMTP.Send`; OneDrive separately requests `Files.ReadWrite.AppFolder`; Graph rollback uses `User.Read` and `Mail.Send`. Never combine SMTP and Graph resource grants into one token request.

Primary login establishes the app session, then chains missing OneDrive consent. Verify same-account identity binding, existing-grant skip, cancellation/failure preserving primary login, and recovery through Connect OneDrive. Missing SMTP authorization requires Microsoft reconnection. Consent policy and mailbox SMTP availability must be checked for intended users, not inferred from another account's success.

### Rotation and revocation

If an Entra client credential is exposed, revoke it, add a replacement without resetting other active credentials, update the appropriate Worker secret, and verify reauthorization/refresh. Treat staging and production separately.

Changing `TOKEN_ENCRYPTION_KEY_B64` alone makes existing ciphertext unreadable. The repository has [a rotation helper](../src/server/microsoft/token-crypto.ts) but no complete operational rotation command or tested automated migration. Plan a controlled re-encryption of all affected resource records with old/new keys kept only in protected memory, or deliberately invalidate grants and require reauthorization. Coordinate provider work, database updates, secret activation, verification, and recovery before performing rotation. Do not claim key-ring or automatic rotation support.

Rotate an exposed session secret and invalidate affected sessions. Preserve mailbox attempt accounting and recipient outcomes during credential recovery. Never restore old credentials from a documentation artifact.

## Verification by change type

| Change | Required evidence |
| --- | --- |
| Documentation/license only | Correct claims and links, no stale references, expected file scope, whitespace check; build/tests when removing assets or checking application references |
| Runtime logic | Relevant regressions, `npm test`, and integration/failure-path checks for changed behavior |
| Visible UI | Runtime checks plus actual browser states, keyboard/reduced-motion and responsive inspection |
| Schema/deployment | Full release gate, target/migration compatibility, local and isolated staging verification |
| Mail/storage behavior | Mocked boundaries first, then a separately bounded authorized Microsoft/OneDrive/inbox matrix |

`npm test` runs TypeScript, production builds, the 110 kB gzip initial-client bundle guard, and Vitest. `npm run test:unit` runs the unit/integration suite directly. There is no lint script. A passing test count does not prove production capacity, UI correctness, or mail delivery.

Meaningful regression coverage includes spreadsheet normalization/mapping, address parsing/duplicates, escaping/sanitization, MIME/STARTTLS/XOAUTH2, attachment count/size/type/hash checks, owner isolation, CSRF, resource consent, rate limits, test envelopes, campaign fingerprints, atomic creation and rollback, conditional claims, mailbox lease races, rolling-budget accounting, duplicate wakes, provider backoff, and crash recovery. Tests use mocked providers and SQLite-backed D1 adapters; verify affected Cloudflare runtime behavior separately.

For visual work, exercise the changed journey with synthetic data: valid/invalid rows, navigation, template reuse, representative previews, test/start feedback, attachments, mixed recipient results, and recovery. Check 1440 x 900, 1024 x 768, and 390 x 844, keyboard focus, contrast, page overflow, and reduced motion. Compare against the current baseline and any task-approved reference. Keep temporary captures and validation receipts in ignored output directories.

## Release gate

Fetch origin, compare the candidate with `origin/main`, and integrate the intended remote work before release. Preserve other contributors' commits; do not deploy solely because a local branch is named main. From an isolated checkout of the exact integrated candidate:

```text
npm ci
npm run check:staging
```

The second command runs `npm test`, the production Wrangler dry run, staging build, staging configuration validation, and the isolated staging dry run. Use the scripts in [package.json](../package.json); do not invent a second release pipeline.

Before deployment, inspect:

- Ignored secret files and the candidate diff; no private addresses, credentials or tokens are staged.
- Exact target Worker, public origin, D1, producer/consumer Queue, schedule, transport, and staging namespace/DLQ as applicable.
- Registered callback and delegated grant requirements, including SMTP and OneDrive for attachments.
- Pending migration list and compatibility with the selected code. Retain all committed migrations through `0012`, including manual receipt evidence `0010`, FIFO/cancellation `0011`, and mail authorization recovery `0012`.
- A staging build was generated with `CLOUDFLARE_ENV=staging`, followed by `prepare:staging-config`. Deploy only from `dist/client/mailflow/wrangler.staging-validated.json`; do not add `--env staging` to that generated snapshot or use mutable redirected production config.

### Staging

Staging hosts one candidate at a time. The existing [verification workflow](../.github/workflows/verify.yml) checks candidates without deployment. The [manual staging workflow](../.github/workflows/deploy-staging.yml) is serialized, checks out the supplied commit, verifies, applies only staging migrations, and deploys that candidate. The GitHub staging environment needs `CLOUDFLARE_ACCOUNT_ID` and a scoped `CLOUDFLARE_API_TOKEN`; use required reviewers where supported.

The local staging commands are `npm run db:migrate:staging` and `npm run deploy:staging`. Supply separate staging Worker secrets through `wrangler secret put <NAME> --env staging` using secure input. A new staging app credential must be added alongside the production credential, not replace it.

### Production

Promote a reviewed candidate through the production process. Rebuild the production artifact after staging builds and inspect the exact target. Apply only pending production migrations with `npm run db:migrate:remote`; deploy with `npm run deploy` after the gate. Never promote by binding production to staging data or Queues.

For first-time provisioning only, inspect/create the configured D1 and Queue, record their IDs in versioned configuration, set independent secrets, register the exact callback, apply migrations and deploy. Routine maintenance should use the existing resources. Remote resource, tenant, recipient and deployment actions must be within the user's authorized scope; existing session authorization persists.

Keep SQL migrations LF-only. Parenthesize `CASE ... END` inside D1 trigger bodies so the remote statement splitter does not mistake it for the trigger terminator.

### Hosted non-sending checks

Check landing and current hashed JS/CSS responses, unauthenticated `/api/me` 401 JSON, unknown API GET/POST 404 JSON, OAuth redirect origin/scopes without completing consent, migration status, Queue bindings, hourly schedule and deployed Worker version. Inspect deployment failures on the actual platform; a local success does not establish that an independent Git-build check passed. Record the currently verified candidate only, not a release diary.

## Controlled mail and storage matrix

Use only authorized accounts, recipients, content and file bytes. Run mocked/local checks first and keep live campaigns small.

1. Sign in with a primary USM account and verify locked sender, tenant and logout behavior.
2. Verify chained OneDrive consent and an existing-grant skip. Test declined consent separately and preserve login/recovery.
3. Send one self-test; confirm campaign CC/BCC/Reply-to are suppressed.
4. For attachment changes, use at least two small synthetic file types; verify Review names/sizes, test locking, and byte counts/hashes independently in Sent Items and an authorized inbox.
5. Start one small campaign, close its browser page, and verify background progress, pause/resume, recipient results and CSV export.
6. Observe intended inbox receipt and Sent Items separately from provider acceptance. Repeat the relevant matrix with a second authorized student account before claiming multi-account support.
7. Verify active App Folder cleanup. Ordinary deletion may retain recycle-bin quota; test scoped `permanentDelete` separately before claiming immediate reclamation.
8. Verify duplicate Queue delivery cannot resend accepted or unknown rows.

Record only date, source/deployment identity, sender alias, recipient count, provider category, campaign outcome, Sent Items/inbox observation and sanitized checks. Do not commit private addresses, message bodies, credentials or provider payloads.

## Recovery and rollback

- Pause a live campaign before investigation. Never reset Unknown to pending automatically or replay a dead-lettered tick until state proves another submission safe.
- Roll back application code only to a schema-compatible release. Preserve D1, Queues, attachment metadata, and mailbox attempt accounting. Do not blindly rewind the database or delete OneDrive App Folders.
- Migration `0007` is forward-only; earlier code must not recreate provider-bound work. Never clear `delivery_attempts` to remove a waiting period.
- After `0008`, older create code without fingerprints/atomic snapshots is incompatible. Preserve existing legacy null-fingerprint rows.
- Apply `0009` before code reading attachment issue/retry columns. Preserve terminal recipient outcomes during any storage recovery.
- For scheduler waits, inspect sanitized reason/time and allow the guarded wake/watchdog to proceed. Never expose wake/lease/attempt tokens in logs or tickets.
- For `attachment_retrying`, allow bounded backoff (30 seconds to 15 minutes, honoring longer Retry-After within the 24-hour Queue delay limit).
- For `attachment_authorization_required`, keep the campaign paused, reconnect the same owner, and resume pending rows only after revalidation.
- For missing/integrity/storage terminal failures, keep the campaign stopped. Do not replace its immutable set or reset rows. Investigate from sanitized categories.
- Cleanup is resumable: at most five objects per set and two eligible sets per scheduled pass. Monitor backlog and recycle-bin usage. Partial failure must not be reported as complete deletion.
- Graph rollback must reject attachment campaigns. No automatic transport fallback is safe after an ambiguous submission.
- Staging rollback selects a compatible prior commit through the same manual workflow; it does not copy or rewind data.

## Current schema and recovery contracts

Apply forward migrations 0010, 0011 and 0012 before deploying the current Worker. They preserve manual delivery evidence, FIFO turn order and cancellation timestamps, and mail authorization recovery/history indexing. Migration 0011 keeps in-flight work first and invalidates competing follower wakes. Do not roll back to a Worker that predates these contracts. Preserve the schema, audit triggers, cancellation markers, attempt ledger and budgets.

For `mail_authorization_required`, keep the campaign paused while its owner reconnects the same Microsoft account, then uses Resume pending rows. Resume checks the grant before rejoining FIFO. Invalid grants remain paused with 409; temporary token-service failures return 503. Never alter recipient outcomes or mailbox budget to bypass authorization. Only FIFO heads schedule timed wakes; followers wait for handoff events. Cancellation waits for an outstanding provider-bound attempt to settle and never releases accepted/Unknown charges.

A stale template publication returns `template_changed` (409); reload the saved version or save edited content as a new template. Name, version and current pointer publish transactionally. Check the saved template after an uncertain publication response before retrying: publication has stale-edit protection but is not client-key-idempotent. Campaign preparation remains an unpublished snapshot.

Manual receipt confirmation records owner, time and an optional private note while keeping the original Unknown provider result. SMTP failures use `mailflow.smtp.failure` with correlation ID, fixed stage, classification and elapsed time. API failures use `mailflow.api.failure` and return the generated `X-MailFlow-Request-Id`; background failures use allowlisted categories. Correlate these sanitized records without logging private notes, addresses, message content, raw exceptions, SQL, URLs or coordination tokens. A timeout category alone does not establish the delivery root cause.

## Capacity and recovery measurement

The pilot planning envelope is 10 simultaneously active mailboxes, up to 300 rows per campaign, the configured 12 messages/minute ceiling per mailbox, and at most five attachments totaling 20 MiB. These are workload targets for a controlled staging exercise, not measured production capacity or a larger release authorization. A 300-row campaign requires about 25 minutes at that pace before attachment downloads, network latency, retries, and provider backoff. Worst-case repeated attachment reads are 300 x 20 MiB = 5.86 GiB per campaign, excluding retries and test sends. Do not cache bytes across isolates or relax integrity checks merely to meet that estimate.

Collect these measurements for a no-attachment run and a representative attachment run, then for the maximum-size synthetic workload. Begin with one mailbox before increasing concurrent owners. Use synthetic data and a no-submit provider for load exercises; a live-mail exercise needs its own exact account/recipient authorization.

| Signal | Pilot investigation threshold | Evidence to retain |
| --- | --- | --- |
| History and campaign-create API | p95 over 2 seconds, excluding sign-in and upload | Sample count, latency distribution, D1 rows read/written and CPU; no request bodies |
| Due wake lag | Any due wake delayed over 5 minutes without explicit backoff | Scheduled due vs invocation time, Queue backlog/DLQ count, sanitized recovery category |
| Crash recovery | Missing wake/lease still unresolved after two hourly watchdog passes | Recovery counts and affected-state totals; hourly scheduling is not a sub-minute recovery guarantee |
| Provider uncertainty | Every new unknown outcome | Existing diagnostic ID, fixed SMTP stage, classification and elapsed duration; receipt evidence is separate |
| Attachment cleanup | Eligible backlog grows for two passes, or expired sets remain for another day | Eligible set counts, age, attempted/deleted counts and redacted storage failure category |
| Browser loading | Initial JS exceeds the existing 110 kB gzip budget | `npm run check:client-bundle`; deferred ExcelJS must stay out of the initial graph |

Run `scripts/operations-health.sql` as an occasional read-only D1 snapshot through the existing Wrangler database binding. For example, `npx wrangler d1 execute mailflow-staging-db --env staging --remote --file scripts/operations-health.sql` targets staging explicitly; use `--local` for a disposable local database. The query returns aggregate counts only. It scans operational history, so do not add a frequent scheduled scan without measuring D1 work. It complements Cloudflare Queue and request telemetry; it does not compute latency percentiles. The cleanup fallback has a hard ceiling of two sets per hourly invocation, shared with watchdog completions. Ten eligible sets need at least five successful passes if no new work arrives. Immediate terminal cleanup helps, but a sustained fallback arrival rate above two sets/hour needs investigation and a measured capacity change.

Current evidence: deterministic tests cover maximum 300-row atomic campaign creation, 20 MiB SMTP encoding bounds, duplicate delivery, provider uncertainty, mailbox handoff, cancellation, authorization recovery, tied-timestamp history pages, and cleanup bounds. Actual local Cloudflare D1 tests apply all migrations and exercise competing template publications. These checks do not establish the 10-mailbox latency target, OneDrive throughput, or production recovery time. Record those measurements before expanding the pilot.

## Retention and database restore

The current release retains saved template versions, campaign snapshots, recipient addresses/rendered content, audits, delivery verification notes, delivery attempts, and attachment metadata. No automatic campaign-history purge is introduced. Archive is a visibility action, not erasure. Expired authentication/control records use the bounded existing cleanup; OneDrive attachment bytes use terminal cleanup and 24-hour unassociated-set expiry. Ordinary deletion may leave bytes in the owner's recycle bin. History pagination now makes records beyond the first 50 discoverable.

Before a wider cohort, assign a data-retention owner and approve durations for recipient content, audit/evidence, backups, and deletion requests. Keep active/unknown delivery evidence and all unexpired mailbox charges through any later retention implementation; deleting a short-lived test-send record must not release its charge. A future purge needs bounded transactions, ownership checks, and referential-integrity tests. Do not infer a purge policy from QA cleanup authorization.

A database restore can rewind an accepted recipient to pending. A restored database alone cannot prove which mail was submitted after its recovery point. Use this fail-closed procedure:

1. Stop new campaign/test-send mutations and suspend the consumer and scheduled handler before restoration. Preserve the current database, deployment identity, recovery point and restricted operational evidence if available. Do not export secrets or message data into repository artifacts.
2. Restore into an isolated database with no active Queue consumer, scheduler, or valid provider credentials. Preserve the compatible schema, immutable snapshots, cancellation markers, attempts and budgets. Verify encrypted-token key compatibility through secret storage; if unavailable, require reauthorization.
3. Treat every restored runnable campaign as held for investigation. Compare a trusted post-incident snapshot/ledger and provider evidence against the recovery point. Rows that may have crossed the submission boundary since that point remain held or become Unknown through a reviewed reconciliation. Pending in the restored database is not sufficient proof for resending. Campaigns that existed only after the recovery point also need explicit accounting.
4. Reconcile mailbox-wide accepted/unknown charges for the full rolling 24-hour window, including test sends. If the evidence is incomplete, keep sending disabled for affected owners until their possible charges have aged out and recipient ambiguity is resolved conservatively. Preserve known accepted and unknown outcomes; do not use Message-ID as provider idempotency.
5. In the isolated copy, prove that duplicate old Queue messages do not send, stale provider-bound work stays Unknown, and only proven unsubmitted rows can resume. Run the repository tests plus owner-scoped API/history checks. Keep Queue ingestion disabled while replacing old physical messages with wakes derived from reconciled durable state.
6. Record a reviewed reconciliation, resume a small authorized canary, then restore normal processing. Retain separate provider-acceptance and receipt evidence.

Planning objectives are a recoverable database point within one hour and an isolated, paused application available for assessment within four hours. Neither objective is a promise of restored sending. The database backup/restore mechanism, retention window, measured RPO/RTO, and full isolated disaster-recovery drill still require operational validation on the actual Cloudflare account. The local recovery/rollback tests prove state transitions, not a hosted backup restore. Never reopen automatic sending merely to meet an RTO target.

## Latest useful evidence

Verified 2026-09-13 against the integrated candidate based on GitHub main `bbdcaf9`, including merged PRs 7 through 10 and the subsequent recovery/publication work. The documentation and presentation integration preserves those application changes; its only edits to existing application source are the public landing link and its styles.

An isolated clean install and `npm run check:staging` passed: TypeScript, production and staging builds, 346 tests across 43 files, production dry run, staging configuration validation, and staging dry run. Initial JavaScript is 83.96 kB gzip, below the 110 kB guard. All 43 relative links across the eight Markdown documents resolve. Browser checks passed for all 11 public slides at 1440 x 900, 1024 x 768, 390 x 844, and 320 x 700, including keyboard/history navigation, deep links, sharing, reading view, reduced motion and script-unavailable fallback. The deck makes no authentication or API requests. Its seven current UI captures use synthetic data from this integrated interface.

Before promotion, production had no queued/running campaigns or reserved/provider-bound attempts. Migrations `0010` through `0012` were pending and must be applied before the integrated Worker is deployed. This verification does not claim live-mail receipt, measured pilot capacity, or a completed hosted restore drill.
