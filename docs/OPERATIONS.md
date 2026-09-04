# Operations runbook

This runbook is for a future agent or maintainer deploying Mail Flow to the existing USM Entra application and a Cloudflare account. Read `../AGENTS.md`, `CONTEXT.md`, `ARCHITECTURE.md`, and `TESTING.md` first. Never paste a secret into this file, a command transcript, a screenshot, or Git.

## Deployment inventory

| Concern | Expected resource |
| --- | --- |
| Worker and static site | `mailflow` |
| D1 database | `mailflow-db`, binding `DB` |
| Private attachment storage | Each member's OneDrive `Apps/MailFlow` folder |
| Queue | `mailflow-campaign-ticks`, binding `CAMPAIGN_QUEUE` |
| Public origin | `https://mailflow.kyzer-hono-test.workers.dev` |
| OAuth callback | `<PUBLIC_ORIGIN>/auth/microsoft/callback` |
| Entra application | Existing single-tenant application named `MailFlow` |
| Microsoft permissions | SMTP target: delegated `SMTP.Send`; attachment storage: delegated `Files.ReadWrite.AppFolder`; temporary rollback: delegated Graph `User.Read` and `Mail.Send` |

The source configuration is `../wrangler.jsonc`. The application package and all build commands live at the repository root. Configure Cloudflare Git builds to use the repository root as their build directory. Worker secret names are `ENTRA_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY_B64`, and `SESSION_SECRET`; tenant and client IDs remain non-secret vars in versioned configuration.

As of 2026-08-31, the D1 database and Queue are provisioned, the initial migration is applied, the Entra production callback is registered, all Worker secrets are present, and the public deployment is active. Do not create duplicate resources during routine maintenance; inspect the existing bindings first.

## Staging inventory and isolation

The top-level Wrangler configuration remains production. The named `staging` environment is a separate deployment:

| Concern | Staging resource |
| --- | --- |
| Worker and static site | `mailflow-staging` |
| Public origin | `https://mailflow-staging.kyzer-hono-test.workers.dev` |
| D1 database | `mailflow-staging-db`, binding `DB` |
| Campaign Queue | `mailflow-staging-campaign-ticks`, binding `CAMPAIGN_QUEUE` |
| Dead-letter Queue | `mailflow-staging-campaign-ticks-dlq` |
| Attachment storage | Each member's OneDrive `Apps/MailFlow` folder, with `staging` embedded in every new private object filename |
| OAuth callback | `https://mailflow-staging.kyzer-hono-test.workers.dev/auth/microsoft/callback` |

Staging has independent `ENTRA_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY_B64`, and `SESSION_SECRET` Worker secrets. Tenant and client IDs are non-secret vars shared with the existing single-tenant Entra application. Never reuse the production token-encryption key, session secret, or client credential in staging. R2 is absent.

The stable staging environment hosts one pull-request candidate at a time. `.github/workflows/verify.yml` runs tests and both deployment dry runs for pull requests and main without deploying. `.github/workflows/deploy-staging.yml` is manual-only and serialized. Its operator supplies the exact candidate commit SHA; the workflow checks out that commit, repeats the repository test suite and both dry runs, then applies staging migrations and deploys only after all checks pass. The GitHub `staging` environment must contain `CLOUDFLARE_ACCOUNT_ID` and a staging-deployment-scoped `CLOUDFLARE_API_TOKEN`. Configure required reviewers on that environment when the repository plan supports them.

## Preflight gate

From the repository root:

```text
npm ci
npm test
npx wrangler deploy --dry-run
npm run build:staging
npm run prepare:staging-config
npx wrangler deploy --config dist/client/mailflow/wrangler.staging-validated.json --dry-run
```

Then confirm:

- `.env` and `.dev.vars` are ignored.
- No password, token, client secret, or account address is staged in Git.
- `wrangler.jsonc` keeps the production `PUBLIC_ORIGIN`; loopback requests derive their own origin at runtime.
- The Entra app remains single tenant and uses only the delegated scopes required by the selected transport.
- `MAIL_TRANSPORT=smtp`, migrations `0004_campaign_attachments.sql`, `0005_oauth_resource_tokens.sql`, and `0006_public_endpoint_controls.sql`, and both delegated resource grants move together. Do not enable only part of this set.
- Migration `0008_campaign_create_safeguards.sql` is applied before code that writes campaign request fingerprints and bounded recipient chunks. It depends on the permanent transaction guard created by migration `0007`.
- Real-mail recipients and message content have been explicitly approved for the test.
- A staging build was generated with `CLOUDFLARE_ENV=staging`; otherwise the Cloudflare Vite plugin's redirected deploy configuration can still describe production.
- Run `prepare:staging-config` after the staging build and deploy only through its validated, staging-only config snapshot. Do not add `--env staging` to that generated snapshot or deploy from a mutable redirected config in a shared worktree.

## Local full-stack development

`npm run dev` is the full-stack local command. The Cloudflare Vite plugin serves the React client and executes the Worker routes on the same `http://localhost:5173` origin. Do not start a second API server.

Before testing sign-in locally:

1. Copy `.env.example` to the ignored `.env` file beside `wrangler.jsonc`. Use `.env` or `.dev.vars`, never both.
2. Supply a dedicated, short-lived Entra client secret and independent local values for `TOKEN_ENCRYPTION_KEY_B64` and `SESSION_SECRET`. Never reuse or extract production Worker secrets.
3. Confirm that `http://localhost:5173/auth/microsoft/callback` remains registered as a Web redirect URI in the existing Entra application.
4. Run `npm run db:migrate:local` once for a fresh local D1 state.
5. Run `npm run dev`, then verify `/api/me` returns `401` before sign-in and that Microsoft sign-in returns to the local callback.
6. In SMTP mode, verify the primary SMTP callback immediately continues to the separate OneDrive authorization for a user without an App Folder grant. The second request should reuse Microsoft SSO, although first-time consent may appear, and should return to the original app page.
7. Verify `/api/me` reports attachments enabled after both grants and that a synthetic multi-file upload appears in Review. Decline the OneDrive step once in a disposable local session to confirm the primary login survives and the Recipients recovery action remains available. Do not start a campaign unless its test recipients are explicitly authorized.

If `/auth/microsoft/start` returns `503`, the Worker is running but one or more required values are missing from the app-local `.env` or `.dev.vars`. A successful landing-page response does not by itself prove local OAuth is configured.

## Provision Cloudflare

These actions create persistent external resources and require action-time user confirmation.

1. Authenticate Wrangler to the intended Cloudflare account.
2. Create D1 database `mailflow-db`.
3. Add the returned `database_id` to the existing `DB` entry in `wrangler.jsonc`.
4. Create Queue `mailflow-campaign-ticks`.
5. Deploy once to obtain the `workers.dev` origin, or confirm the intended custom domain.
6. Set `PUBLIC_ORIGIN` to that exact HTTPS origin.
7. Apply production D1 migrations, including `0004_campaign_attachments.sql`, `0005_oauth_resource_tokens.sql`, and `0006_public_endpoint_controls.sql`.
8. Store every secret using Wrangler secret storage, never `vars` or a committed file.
9. Deploy the verified build.

Generate `TOKEN_ENCRYPTION_KEY_B64` from 32 cryptographically random bytes and make `SESSION_SECRET` an independent high-entropy value. Record neither value here. Rotating the token key requires the rotation procedure described in the auth implementation; rotating blindly makes stored refresh tokens unreadable.

For staging, create or inspect the exact resources in the staging inventory and add their non-secret identifiers to `wrangler.jsonc`. Apply migrations with `npm run db:migrate:staging`. Set staging secrets by piping each value directly to `wrangler secret put <NAME> --env staging`; never pass a secret as a command-line argument. A staging Entra credential must be appended to the existing application, given the shortest practical lifetime, and piped directly into the staging Worker secret. Do not reset or delete the production credential.

## Configure Entra

These actions change tenant state and require action-time user confirmation.

1. Open the existing `MailFlow` app registration.
2. Preserve single-tenant account support.
3. Add the exact production Web redirect URI.
4. Keep the local callback only while local OAuth testing is needed.
5. Create one confidential client credential with the shortest practical lifetime.
6. Copy the credential value directly into the Worker secret prompt. Do not save it in `.env`, notes, chat, or screenshots.
7. OneDrive consent reuses the existing `/auth/microsoft/callback` registration. A purpose-prefixed OAuth state dispatches the shared callback without another Entra redirect URI.
8. During Graph rollback, confirm delegated `User.Read` and `Mail.Send`. For SMTP, request delegated `https://outlook.office.com/SMTP.Send`; for attachment storage, request delegated `Files.ReadWrite.AppFolder`. Never use SMTP Basic authentication or application-level mail or file access.

Keep the staging callback alongside localhost and production. OneDrive consent continues to reuse the same callback path on the active origin.

The staged attachment configuration declares `MAIL_TRANSPORT=smtp`. Both tested USM student accounts passed Cloudflare-hosted STARTTLS/XOAUTH2 authentication-only probes. Before deployment, apply both attachment migrations and verify chained OneDrive consent through the shared callback. Because Microsoft access tokens are resource-specific, never combine SMTP and Graph scopes into one authorization request or token record. New homepage sign-ins chain the two grants; members whose stored grant lacks `SMTP.Send` use Reconnect Microsoft, while declined, failed, or legacy OneDrive grants use the separate Connect OneDrive recovery action.

The scheduled handler runs hourly at minute 15. It first performs a bounded mailbox scheduler reconciliation: pre-submission stale attempts return safely to pending, provider-bound stale attempts become terminal `unknown`, expired classified leases are released, exhausted campaigns complete, and missing or stale durable Queue wakes are recreated. It then drains expired OAuth states, expired or revoked sessions, endpoint counters, and abandoned test-send claims in bounded batches before removing unassociated attachment sets from the owning student's active OneDrive App Folder after their 24-hour expiry. Terminal campaign paths also request immediate removal. Ordinary Graph delete moves items to the user's recycle bin, so monitor both stale app-folder files and recycle-bin quota usage until scoped `permanentDelete` is proven in the USM tenant.

## Smoke test order

For a staging deployment, complete the non-sending checks first: landing page, hashed static asset, unauthenticated `/api/me`, an unknown `/api/*` route that must not fall through to the app shell, Microsoft authorization redirect origin and SMTP scope, D1 migration status, Queue producer/consumer binding, dead-letter Queue configuration, hourly schedule, and absence of R2. Do not sign in, test-send, or start a campaign without a separately approved account and recipient.

1. Public landing page and static assets.
2. Primary account sign-in, tenant identity, dashboard, and logout.
3. Primary account chained OneDrive consent, return to dashboard, and `/api/me` attachment readiness. Repeat with an existing grant and confirm the second leg is skipped.
4. Secondary account sign-in through the same application.
5. One test-send to the authenticated mailbox.
6. One attachment test-send to the authenticated mailbox with two small synthetic files; verify exact filenames and downloaded hashes in Sent Items.
7. One five-recipient campaign from the primary account.
8. Queue progress after closing the browser.
9. Pause and resume.
10. Result CSV export.
11. Gmail receipt observation and Outlook Sent Items observation.
12. A small campaign from the secondary account, proving the sender is locked to that mailbox.

Graph `202 Accepted` or SMTP's final post-DATA `250` is recorded as `Accepted by Microsoft`. Neither is proof of inbox delivery. An ambiguous transport result is `unknown` and is never automatically resent.

## Sanitized evidence template

Append results to `PROGRESS.md` using aliases only:

```text
Timestamp (MYT):
Deployment URL:
Sender alias: primary | secondary
Recipient count:
Provider result: accepted | failed | unknown
Campaign result:
Sent Items observed: yes | no | not checked
Inbox receipt observed: yes | no | partial | not checked
Notes without addresses, tokens, or message content:
```

## Rollback and recovery

- Pause the campaign before investigating a live sending problem.
- Never reset an `unknown` row to pending automatically.
- A Worker rollback may use Cloudflare deployment history, but do not roll back D1 schema blindly.
- Preserve D1 and Queue resources when rolling back application code.
- Migration `0007_mailbox_scheduler_recovery.sql` is forward-only. Do not deploy earlier code that assumes it can recreate provider-bound work, and never delete or reset `delivery_attempts` to clear a wait because accepted and unknown rows are part of the rolling mailbox budget.
- Migration `0008_campaign_create_safeguards.sql` is forward-only. After it is applied, do not roll back to campaign-create code that inserts `draft` campaigns without a request fingerprint; the database triggers intentionally reject that unsafe write path. Preserve legacy rows with a null fingerprint.
- If a campaign is waiting, inspect only its public scheduler reason and next-attempt time plus sanitized audit categories. Never copy wake, lease, claim, or attempt tokens into tickets or logs.
- Preserve D1 attachment metadata and do not delete a member's OneDrive App Folder during a code rollback. Graph mail mode must reject campaigns that reference attachment sets.
- If the Entra client credential is exposed, revoke it first, create a replacement, update the Worker secret, then redeploy.
- If a session or token-encryption secret is exposed, rotate it and invalidate affected sessions. Follow the token-key rotation path before changing the encryption key.

### Staging promotion and rollback

- Promotion is a Git decision, not a data copy: merge the reviewed candidate, repeat the production release gate, apply only pending production migrations, and deploy through the production procedure. Never promote by rebinding production to staging D1 or Queues.
- To roll back staging code, manually dispatch the staging workflow with an earlier known-good commit SHA. Preserve staging D1 and Queue resources and inspect migration compatibility first. Do not reverse or delete applied D1 migrations blindly.
- Record the currently hosted candidate commit and Worker version in `PROGRESS.md`. A new staging deployment replaces the previous candidate on the stable URL.
- A dead-lettered campaign tick requires human investigation. Do not replay it until campaign and recipient state prove that another send is safe; never auto-retry an `unknown` recipient outcome.
