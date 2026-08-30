# Mail Flow

Mail Flow is a focused mail-merge application for USM student societies. Members sign in with their USM Microsoft account, import recipient data, personalize an HTML message, validate every row, preview representative emails, send a test to themselves, and start a paced campaign through Microsoft Graph.

The deployed application uses Cloudflare only: Workers Static Assets, a Worker API, D1, Queues, and Worker secrets. Microsoft Entra ID provides identity and delegated authorization. Microsoft Graph sends from the signed-in member's Outlook mailbox.

## Repository map

- `AGENTS.md`: first read for every coding agent.
- `docs/CONTEXT.md`: durable project brief and authority order.
- `docs/USE_CASES.md`: accepted functional requirements and release boundaries.
- `docs/ARCHITECTURE.md`: runtime, security, data, and integration design.
- `docs/DESIGN.md`: mock inventory, visual tokens, and fidelity rules.
- `docs/IMPLEMENTATION_PLAN.md`: milestones, ownership boundaries, and acceptance gates.
- `docs/PROGRESS.md`: append-only implementation log and current state.
- `docs/TESTING.md`: local, integration, visual, and real-mail verification plan.
- `docs/DECISIONS.md`: architecture decision log.
- `docs/OPERATIONS.md`: Cloudflare, Entra, smoke-test, evidence, and recovery runbook.
- `design-qa.md`: source-to-implementation visual comparison record and current QA result.
- `mock-images/`: approved visual references.

## Application commands

Run commands from `apps/mailflow`:

```text
npm install
npm run typecheck
npm run test
npm run dev
```

The Vite dev server serves the client and the Cloudflare Vite plugin's local
Worker preview. Copy `apps/mailflow/.dev.vars.example` to a local `.dev.vars`
and fill it with non-committed development values before exercising OAuth.
Apply the local D1 schema with `npm run db:migrate:local`.

For a Cloudflare deployment, create the D1 database and Queue named in
`apps/mailflow/wrangler.jsonc`, add the resulting D1 id to that file, configure
the Entra redirect URI, then set Worker secrets with Wrangler. Finally run:

```text
npm run db:migrate:remote
npm run deploy
```

The deploy command builds the Vite client and publishes `worker/index.ts` with
the static assets. Keep `PUBLIC_ORIGIN` aligned with the deployed origin so
same-origin and OAuth redirect checks remain valid. The exact provisioning and
real-mail test gates are recorded in `docs/TESTING.md` and `docs/PROGRESS.md`.

## Non-negotiable safety rules

- Never commit `.env`, `.dev.vars`, access tokens, refresh tokens, passwords, or client secrets.
- Never use stored student passwords in the deployed application. User authentication is interactive Microsoft OAuth.
- Never request application-level `Mail.Send`. Mail Flow uses delegated `Mail.Send` for the signed-in mailbox.
- Never call a Graph `202 Accepted` response "delivered". The correct state is "Accepted by Microsoft".
- Never automatically resend an ambiguous outcome. Surface it as `unknown` and require a human decision.
