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

`npm test` runs TypeScript, production builds and Vitest. `npm run test:unit` runs the unit/integration suite directly. There is no lint script. A passing test count does not prove production capacity, UI correctness, or mail delivery.

Meaningful regression coverage includes spreadsheet normalization/mapping, address parsing/duplicates, escaping/sanitization, MIME/STARTTLS/XOAUTH2, attachment count/size/type/hash checks, owner isolation, CSRF, resource consent, rate limits, test envelopes, campaign fingerprints, atomic creation and rollback, conditional claims, mailbox lease races, rolling-budget accounting, duplicate wakes, provider backoff, and crash recovery. Tests use mocked providers and SQLite-backed D1 adapters; verify affected Cloudflare runtime behavior separately.

For visual work, exercise the changed journey with synthetic data: valid/invalid rows, navigation, template reuse, representative previews, test/start feedback, attachments, mixed recipient results, and recovery. Check 1440 x 900, 1024 x 768, and 390 x 844, keyboard focus, contrast, page overflow, and reduced motion. Compare against the current baseline and any task-approved reference. Keep temporary captures and validation receipts in ignored output directories.

## Release gate

From an isolated checkout of the exact candidate:

```text
npm ci
npm run check:staging
```

The second command runs `npm test`, the production Wrangler dry run, staging build, staging configuration validation, and the isolated staging dry run. Use the scripts in [package.json](../package.json); do not invent a second release pipeline.

Before deployment, inspect:

- Ignored secret files and the candidate diff; no private addresses, credentials or tokens are staged.
- Exact target Worker, public origin, D1, producer/consumer Queue, schedule, transport, and staging namespace/DLQ as applicable.
- Registered callback and delegated grant requirements, including SMTP and OneDrive for attachments.
- Pending migration list and compatibility with the selected code. Retain all committed migrations, including public controls `0006`, scheduler `0007`, create safeguards `0008`, and attachment recovery `0009`.
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

## Latest useful evidence

Source baseline: `dd2d125`, local `main`, with the documentation consolidation, generic MIT contributor notice, public committee presentation, and landing-page presentation link in the working tree. Mail-processing code, migrations, dependencies, and CI/CD configuration were not changed by this work.

On 12 September 2026, an isolated candidate copy passed `npm ci` and `npm run check:staging`: TypeScript, production builds, all 193 tests across 23 test files, production Wrangler dry run, staging build/configuration validation, and staging Wrangler dry run. Existing Zod annotation and large-client-chunk warnings remain. These checks do not resolve the readiness issues in [Roadmap](ROADMAP.md).

The public committee presentation contains 11 slides. Browser checks covered 1440 x 900, 1024 x 768, 390 x 844, and 320 x 700, image loading, keyboard controls, browser history, direct slide links, reading view, link copying, reduced motion, and fallback when its script is unavailable. It made no API or authentication requests. The seven current-interface captures use synthetic data; the workspace image is a labeled proposal. These assets do not constitute a live mail integration test.

Production Worker `mailflow` was deployed on 12 September 2026 as version `81be2163-9197-4c62-9561-2066241f3509`. The [public presentation](https://mailflow.kyzer-hono-test.workers.dev/presentation/) returned 200, and its HTML, CSS, JavaScript, and eight images matched the local source byte for byte. Hosted browser checks confirmed slide navigation, mobile layout, and the landing-page link. The landing bundles returned 200; unauthenticated `/api/me` returned 401 JSON; unknown API GET/POST returned 404 JSON; the Microsoft redirect retained the production callback and delegated SMTP scope. Production had no pending migrations, and the expected campaign Queue and hourly schedule were retained. All 50 relative Markdown links resolved and `git diff --check` passed.

The bounded prior mail evidence supports SMTP authentication for two tested USM accounts and an observed primary-account SMTP/OneDrive campaign with byte-matched attachments on 3 September. It does not establish tenant-wide support, permanent deletion, or every intended user's delivery. No real mail or OAuth consent was performed for the presentation work.
