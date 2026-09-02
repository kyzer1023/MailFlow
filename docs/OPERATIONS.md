# Operations runbook

This runbook is for a future agent or maintainer deploying Mail Flow to the existing USM Entra application and a Cloudflare account. Read `../AGENTS.md`, `CONTEXT.md`, `ARCHITECTURE.md`, and `TESTING.md` first. Never paste a secret into this file, a command transcript, a screenshot, or Git.

## Deployment inventory

| Concern | Expected resource |
| --- | --- |
| Worker and static site | `mailflow` |
| D1 database | `mailflow-db`, binding `DB` |
| Private attachment storage | `mailflow-attachments`, binding `ATTACHMENTS` |
| Queue | `mailflow-campaign-ticks`, binding `CAMPAIGN_QUEUE` |
| Public origin | `https://mailflow.kyzer-hono-test.workers.dev` |
| OAuth callback | `<PUBLIC_ORIGIN>/auth/microsoft/callback` |
| Entra application | Existing single-tenant application named `MailFlow` |
| Mail permissions | SMTP target: delegated `SMTP.Send`; temporary rollback: delegated Graph `User.Read` and `Mail.Send` |

The source configuration is `../apps/mailflow/wrangler.jsonc`. Production secret names are `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY_B64`, and `SESSION_SECRET`.

As of 2026-08-31, the D1 database and Queue are provisioned, the initial migration is applied, the Entra production callback is registered, all Worker secrets are present, and the public deployment is active. Do not create duplicate resources during routine maintenance; inspect the existing bindings first.

## Preflight gate

From `apps/mailflow`:

```text
npm ci
npm test
npx wrangler deploy --dry-run
```

Then confirm:

- `.env` and `.dev.vars` are ignored.
- No password, token, client secret, or account address is staged in Git.
- `wrangler.jsonc` keeps the production `PUBLIC_ORIGIN`; loopback requests derive their own origin at runtime.
- The Entra app remains single tenant and uses only the delegated scopes required by the selected transport.
- `MAIL_TRANSPORT=smtp`, the `ATTACHMENTS` binding, and migration `0004_campaign_attachments.sql` move together. Do not enable only part of this set.
- Real-mail recipients and message content have been explicitly approved for the test.

## Local full-stack development

`npm run dev` is the full-stack local command. The Cloudflare Vite plugin serves the React client and executes the Worker routes on the same `http://localhost:5173` origin. Do not start a second API server.

Before testing sign-in locally:

1. Copy `.env.example` to the ignored `.env` file beside `wrangler.jsonc`. Use `.env` or `.dev.vars`, never both.
2. Supply a dedicated, short-lived Entra client secret and independent local values for `TOKEN_ENCRYPTION_KEY_B64` and `SESSION_SECRET`. Never reuse or extract production Worker secrets.
3. Confirm that `http://localhost:5173/auth/microsoft/callback` remains registered as a Web redirect URI in the existing Entra application.
4. Run `npm run db:migrate:local` once for a fresh local D1 state.
5. Run `npm run dev`, then verify `/api/me` returns `401` before sign-in and that Microsoft sign-in returns to the local callback.
6. In SMTP mode, verify `/api/me` reports attachments enabled after consent and that a synthetic multi-file upload appears in Review. Do not start a campaign unless its test recipients are explicitly authorized.

If `/auth/microsoft/start` returns `503`, the Worker is running but one or more required values are missing from the app-local `.env` or `.dev.vars`. A successful landing-page response does not by itself prove local OAuth is configured.

## Provision Cloudflare

These actions create persistent external resources and require action-time user confirmation.

1. Authenticate Wrangler to the intended Cloudflare account.
2. Create D1 database `mailflow-db`.
3. Add the returned `database_id` to the existing `DB` entry in `wrangler.jsonc`.
4. Create Queue `mailflow-campaign-ticks`.
5. Create a private R2 bucket named `mailflow-attachments`. Do not configure a public development URL or custom domain for it.
6. Deploy once to obtain the `workers.dev` origin, or confirm the intended custom domain.
7. Set `PUBLIC_ORIGIN` to that exact HTTPS origin.
8. Apply production D1 migrations, including `0004_campaign_attachments.sql`.
9. Store every secret using Wrangler secret storage, never `vars` or a committed file.
10. Deploy the verified build.

Generate `TOKEN_ENCRYPTION_KEY_B64` from 32 cryptographically random bytes and make `SESSION_SECRET` an independent high-entropy value. Record neither value here. Rotating the token key requires the rotation procedure described in the auth implementation; rotating blindly makes stored refresh tokens unreadable.

## Configure Entra

These actions change tenant state and require action-time user confirmation.

1. Open the existing `MailFlow` app registration.
2. Preserve single-tenant account support.
3. Add the exact production Web redirect URI.
4. Keep the local callback only while local OAuth testing is needed.
5. Create one confidential client credential with the shortest practical lifetime.
6. Copy the credential value directly into the Worker secret prompt. Do not save it in `.env`, notes, chat, or screenshots.
7. During Graph rollback, confirm delegated `User.Read` and `Mail.Send`. For SMTP, request delegated `https://outlook.office.com/SMTP.Send`; never use SMTP Basic authentication or application-level mail access.

The staged attachment configuration declares `MAIL_TRANSPORT=smtp`. Both tested USM student accounts passed Cloudflare-hosted STARTTLS/XOAUTH2 authentication-only probes. Before deployment, confirm the R2 bucket exists and the attachment migration is applied. Because Microsoft access tokens are resource-specific, members whose stored grant lacks `SMTP.Send` must sign out or use the Reconnect Microsoft action before attachments become available.

The scheduled handler runs hourly at minute 15 and deletes unassociated attachment sets after their 24-hour expiry. Terminal campaign paths also request immediate byte deletion. Monitor scheduled-run failures and R2 storage growth; repeated growth with no active campaigns indicates cleanup needs investigation.

## Smoke test order

1. Public landing page and static assets.
2. Primary account sign-in, tenant identity, dashboard, and logout.
3. Secondary account sign-in through the same application.
4. One test-send to the authenticated mailbox.
5. One attachment test-send to the authenticated mailbox with two small synthetic files; verify exact filenames and downloaded hashes in Sent Items.
6. One five-recipient campaign from the primary account.
7. Queue progress after closing the browser.
8. Pause and resume.
9. Result CSV export.
10. Gmail receipt observation and Outlook Sent Items observation.
11. A small campaign from the secondary account, proving the sender is locked to that mailbox.

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
- Preserve D1 attachment metadata and the private R2 bucket during a code rollback. Graph mode must reject campaigns that reference attachment sets.
- If the Entra client credential is exposed, revoke it first, create a replacement, update the Worker secret, then redeploy.
- If a session or token-encryption secret is exposed, rotate it and invalidate affected sessions. Follow the token-key rotation path before changing the encryption key.
