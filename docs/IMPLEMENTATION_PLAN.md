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
- Flow, template version, campaign, recipient job, and audit persistence.
- Queue tick pacing, pause, resume, conditional claims, retries, and unknown outcomes.

Acceptance: local D1 and queue tests cover state transitions and duplicate deliveries.

### W4 Client workflow and mock fidelity

- Landing, dashboard, template, mapping, review, and campaign routes.
- Browser-side CSV/XLSX parsing, mapping, validation, sanitization, preview, and export.
- Responsive and accessibility states.

Acceptance: primary journey works locally and visual comparison matches the approved references closely.

### W5 Verification and deployment

- Unit, integration, security, accessibility, and visual QA.
- Cloudflare D1 and Queue setup, Worker secrets, Entra redirects, and deployment.
- Real email tests across both USM senders and five Gmail recipients.

Acceptance: deployed URL works, real acceptance is recorded accurately, and test evidence is documented without secrets.

## Milestones

1. Repository and durable documentation.
2. Local runnable shell matching the mocks.
3. Domain and persistence contracts.
4. Authentication plus one-message Microsoft transport feasibility test.
5. Complete local campaign journey with simulated mail.
6. Cloudflare resource provisioning and deployment.
7. Real-mail verification with both senders.
8. Final design QA, accessibility pass, and handoff documentation.

## Cross-workstream gates

- No real sending before test-send confirmation and a visible recipient summary.
- No deployment before `.env` and `.dev.vars` are ignored and Git history is checked for secrets.
- No automatic retry for `unknown` outcomes.
- No visual handoff before `design-qa.md` says `final result: passed` or accurately records a blocker.
- No completion claim before the deployed journey is tested in a real browser.

