# Mail Flow agent guide

## Required context

Read [Product](docs/PRODUCT.md), [Architecture](docs/ARCHITECTURE.md), [Design](docs/DESIGN.md), and [Roadmap](docs/ROADMAP.md), then the files relevant to the task. Read [Operations](docs/OPERATIONS.md) for setup, verification, OAuth, Cloudflare, deployment, or real-mail work.

Authority order: the user's latest instruction; security and privacy constraints here and in Architecture; accepted behavior in Product and Design; approved task-specific references; implementation. Roadmap proposals are not implemented features or approval to change runtime contracts.

## Product and architecture boundaries

- Cloudflare is the only application host. Microsoft Entra ID is the only user identity provider, restricted to the configured USM tenant.
- Delegated OAuth SMTP with `SMTP.Send` is the configured transport. Graph delegated `Mail.Send` remains a deployment-selected rollback path, never an automatic per-message fallback.
- The sender is the authenticated member's mailbox. Shared mailboxes, arbitrary From addresses, application-level Microsoft permissions, and direct Google Sheets access are outside the current prototype.
- Parse CSV and XLSX in the browser. Each source row becomes one recipient job; each eligible row receives a separate message.
- Attachments use each member's OneDrive App Folder through delegated `Files.ReadWrite.AppFolder`. Require SMTP and both resource grants; preserve the five-file and 20-MiB combined limits.
- Domain modules have no Cloudflare runtime imports. Database access uses repositories, Queue publishing uses its adapter, and Microsoft calls use mail/storage adapters.
- Preserve conditional recipient transitions, immutable campaign snapshots, mailbox coordination, and request idempotency. Queue delivery is at least once. An ambiguous provider submission becomes `unknown` and is never automatically resent.
- Unknown API routes and write requests must never fall through to the app shell.
- Organization membership, shared records, and durable society file storage are roadmap proposals. A society label is not an authorization boundary.

## Local workflow and shared files

- Run application commands from the repository root. UI lives in `src/app`; production entrypoints are composed in `worker/index.ts`.
- Start the local server and open the preview yourself when visual work requires it.
- Other agents may edit this checkout. Inspect shared files before editing and preserve unrelated changes. Own only the assigned files or responsibility.
- Update Architecture before implementing an approved cross-module contract change. Keep Roadmap status accurate when work completes.

## Frontend rules

- Preserve the current Paper, Moss, Coral, and Deep Ink identity and the durable interaction rules in Design. The running interface is the baseline for refinements; proposed presentation imagery is not implementation authority.
- Use the local `design-taste-frontend` skill for landing-page work. For substantial product redesign, inspect the current rendered journey and use the Product Design context/image-to-code workflow when appropriate.
- Centralize colors, radii, spacing, and z-index tokens. Use one icon family, currently Phosphor; do not hand-draw replacement SVG icons or use emoji.
- Provide keyboard access, visible focus, reduced motion, and loading, empty, error, disabled, and success states.
- Do not use em or en dashes in user-visible copy. Do not hard-code a real society identity in UI defaults, fixtures, tests, or flow creation.
- Fixed CC, BCC, and Reply-to values use removable chips. Spreadsheet values use one explicit dynamic-value control and readable green tokens, including in the message editor. Hide merge braces in the normal interface.
- Data mapping labels explain the recipient email column and each message value in plain language. Detected columns are plain labels; green tokens are reserved for selecting or inserting dynamic values.
- CC, BCC, Reply-to, and Importance each occupy their own full-width row. Normal is the default importance.
- The current Familiar Paper journey is Recipients, Message, then Review & send. Template management remains independent of recipient import. Preserve explicit template publication, prepared-send locking, field-resolution feedback, and the current shared draft lifecycle.
- Before integration or deployment, fetch origin and compare the candidate with `origin/main`. Preserve merged PRs; a local branch named main is not evidence that it contains the latest remote work. Verify the exact integrated commit before release.

## Secrets and privacy

- Never print or copy values from `.env`, `.env.test-accounts`, or `.dev.vars` into logs, documentation, prompts, tests, source, screenshots, or Git.
- `.env` is ignored local application configuration. `.env.test-accounts` contains colon-separated local test notes; never load it into the application or treat it as deployable dotenv configuration.
- Student passwords are for authorized local interactive support only. Never put them in Cloudflare, D1, browser bundles, fixtures, or Git.
- OAuth client secrets belong in Worker secrets. Refresh tokens belong only in encrypted server-side storage, with the rotation constraints in Operations.
- Use synthetic identities and data for public screenshots. Do not present simulated provider responses as evidence of delivery.

## Documentation and completion

- Maintain current guidance, not a diary. Revise the relevant document in place; do not recreate progress logs, dated review reports, archive folders, or mock-image collections.
- Preserve current decisions, unresolved limitations, recovery procedures, and a compact dated verification summary. Remove superseded instructions and repair links when consolidating.
- Every committed presentation asset must be used by the deck. Keep temporary scripts, renders, browser captures, and validation receipts in ignored output directories.
- Run the checks relevant to the change, including type checks, tests, builds, and visual/integration checks where applicable. Operations defines the verification matrix.
- Report what was actually verified. Provider acceptance is never proof of inbox delivery. Record only the latest useful verification state in Operations; use commits for change history.
