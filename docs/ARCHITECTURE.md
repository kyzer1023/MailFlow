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
        |    campaigns, recipient jobs, audit events, encrypted tokens
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

- `client`: routing, view models, browser-side workbook parsing, sanitization, preview, and user interaction.
- `api`: HTTP routes, input validation, session checks, and orchestration.
- `domain`: pure campaign states, validation rules, template rendering, pace calculations, and contracts.
- `database`: D1 schema, SQL migrations, and repositories.
- `queue`: Cloudflare Queue adapter and campaign tick consumer.
- `microsoft`: OAuth, encrypted token storage, refresh, Graph fallback, SMTP adapter, MIME generation, and provider error mapping.

Domain modules must have no Cloudflare imports. Adapters depend on domain contracts, not the reverse.

## Microsoft authorization

- Single-tenant Entra application.
- Server-side authorization-code flow with PKCE.
- Graph fallback scopes: `openid`, `profile`, `email`, `offline_access`, `User.Read`, and delegated `Mail.Send`.
- SMTP target scopes: `openid`, `profile`, `email`, `offline_access`, and delegated `https://outlook.office.com/SMTP.Send`.
- OAuth access tokens are resource-specific. A deployment selects Graph or SMTP before authorization; it does not use one token for both transports.
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

### campaigns

Flow and template references, owner, sender address, source filename, recipient totals, pace, state, pause reason, timestamps, and idempotency key.

The campaign-create API requires the idempotency key. D1 enforces uniqueness per owner, and both an ordinary replay and a concurrent insert race resolve to the existing campaign response.

### recipient_jobs

Campaign reference, source row, resolved recipient metadata, message importance, normalized merge data JSON, rendered subject and sanitized body, unique send key, status, attempt count, claim time, accepted time, last error category, last error message, and Graph request metadata.

### audit_events

Actor, campaign, recipient job when relevant, event type, structured metadata, and timestamp. Secrets and message bodies are excluded from audit metadata.

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
                              -> paused -> running
                              -> failed
```

Only conditional SQL updates can claim a pending job. A queue duplicate that cannot claim exits successfully.

## Queue pacing

The queue carries campaign tick messages, not an uncontrolled burst of all recipients. A tick:

1. Verifies that the campaign is runnable.
2. Conditionally claims the next pending job.
3. Refreshes the user's access token for the selected Microsoft resource when needed.
4. Calls the selected mail provider once.
5. Records the result.
6. Enqueues the next tick with a delay derived from the configured pace.

At 12 messages per minute, the next tick is delayed by approximately 5 seconds. Graph `429` and explicit transient SMTP replies use their provider retry delay when present. Paused campaigns do not enqueue progress until resumed.

## Ambiguous outcomes

Neither Graph sendMail nor SMTP submission provides a safe application idempotency key. Graph records `accepted` after `202`. SMTP records `accepted` only after the final `250` response following the terminating DATA marker. If a known response proves that no send occurred, apply the safe retry policy. If the network fails after either provider may have accepted the message, record `unknown` and stop automatic retry for that row. This favors no duplicate message over an automatic blind rerun.

## API shape

Expected route groups:

- `/auth/microsoft/start`, `/auth/microsoft/callback`, `/auth/logout`, `/api/me`
- `/api/flows`, `/api/flows/:id`, `/api/flows/:id/versions`
- `/api/campaigns`, `/api/campaigns/:id`, `/api/campaigns/:id/jobs`
- `/api/campaigns/:id/test-send`
- `/api/campaigns/:id/start`, `/pause`, `/resume`
- `/api/campaigns/:id/export.csv`

All mutating routes require an authenticated session, CSRF protection, same-origin checks, Zod validation, and ownership checks.

## Cloudflare bindings

- `DB`: D1 database.
- `CAMPAIGN_QUEUE`: Queue producer.
- Queue consumer in the same Worker deployment unless operational evidence calls for a split Worker.
- Static assets binding for the Vite client.
- Secrets for Entra client secret, token-encryption key, and session integrity.
- Plain variables for tenant ID, client ID, public origin, campaign limit, and default pace.
- `MAIL_TRANSPORT` selects `graph` or `smtp`; omission keeps Graph during the staged rollout.

## Security boundaries

- No access or refresh token reaches browser JavaScript.
- No HTML from a workbook is trusted by default.
- Spreadsheet values are escaped before insertion into templates.
- Preview content is sanitized and isolated in an iframe.
- Campaign ownership is checked on every read and write.
- User-facing errors do not reveal tokens, Graph response bodies, or internal stack traces.
- Production configuration is reproducible from `wrangler` configuration, migration files, and documented secret names.
