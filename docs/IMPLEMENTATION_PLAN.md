# Implementation plan

## Workstream ownership

Workstreams are intentionally broad enough to produce coherent results. Coordinating agents assign exact file ownership before work begins.

### W1 Foundation and contracts

- Product Design starter initialization.
- Package layout and commands.
- Shared TypeScript types, domain states, API contracts, and fixtures.
- Design tokens and common shell.

Acceptance: installs reproducibly, type checks, tests run, and other workstreams have stable contracts.

### W2 Authentication and Microsoft mail transport

- Entra authorization-code flow with PKCE and resource-specific Graph or SMTP scopes.
- Session handling, tenant restriction, token encryption, refresh, Graph fallback, OAuth SMTP adapter, MIME generation, and test send.
- Human-readable provider error mapping.

Acceptance: mocked integration tests pass, then both student accounts can authenticate and send a controlled test.

### W3 D1, campaigns, and queue

- SQL migrations and repositories.
- Flow, template version, campaign, recipient job, attachment metadata, and audit persistence.
- Per-user OneDrive App Folder attachment bytes, integrity checks, immutable association, and retention cleanup.
- Queue tick pacing, pause, resume, conditional claims, retries, and unknown outcomes.
- D1 mailbox-wide leases, provider-bound attempt ledger, rolling 8,000-recipient budget, durable wake tokens, and bounded scheduled recovery.

Acceptance: local D1 and queue tests cover state transitions, atomic mailbox races, duplicate deliveries, exact backoff and budget release times, and crash-boundary recovery.

### W4 Client workflow and mock fidelity

- Landing, dashboard, template, mapping, review, and campaign routes.
- Browser-side CSV/XLSX parsing, attachment selection, mapping, validation, sanitization, preview, and export.
- Responsive and accessibility states.

Acceptance: primary journey works locally and visual comparison matches the approved references closely.

### W5 Verification and deployment

- Unit, integration, security, accessibility, and visual QA.
- Cloudflare D1 and Queue setup, Worker secrets, Entra redirects, OneDrive App Folder consent, and deployment.
- Real email tests across both USM senders and five Gmail recipients.

Acceptance: deployed URL works, real acceptance is recorded accurately, and test evidence is documented without secrets.

## Milestones

1. Repository and durable documentation.
2. Local runnable shell matching the mocks.
3. Domain and persistence contracts.
4. Authentication plus one-message Microsoft transport feasibility test.
5. Complete local campaign journey with simulated mail.
6. Private attachment storage and delegated OAuth SMTP MIME delivery.
7. Cloudflare resource provisioning and deployment.
8. Real-mail verification with both senders.
9. Final design QA, accessibility pass, and handoff documentation.

## Cross-workstream gates

- No real sending before test-send confirmation and a visible recipient summary.
- No attachment deployment unless SMTP mode, migrations `0004`, `0005`, `0007`, and `0008`, `SMTP.Send` reauthorization, the shared OAuth callback, and `Files.ReadWrite.AppFolder` consent are ready together.
- No deployment before `.env` and `.dev.vars` are ignored and Git history is checked for secrets.
- No automatic retry for `unknown` outcomes.
- No provider submission outside the shared mailbox lease and attempt ledger, including self-only test sends.
- No visual handoff before reference and implementation states are compared at the required viewports and any remaining blocker is recorded.
- No completion claim before the deployed journey is tested in a real browser.

