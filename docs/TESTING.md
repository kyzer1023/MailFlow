# Testing and verification

## Principles

- Prefer deterministic tests for domain and state transitions.
- Use mocked Graph responses before any real send.
- Keep real-mail tests small, intentional, and traceable.
- A Graph `202` proves acceptance by Microsoft, not delivery.
- Never put credentials, tokens, full private email addresses, or message bodies into committed test evidence.

## Automated checks

### Unit

- Header normalization and placeholder extraction.
- CSV and workbook row normalization.
- Email-list parsing and separator handling.
- Duplicate detection.
- Template escaping and rendering.
- HTML sanitization policy.
- Campaign duration and pacing.
- State transition guards and unique send keys.
- Graph error classification.

### Integration

- D1 migrations from an empty database.
- Flow and template version repositories.
- Campaign creation and recipient-job insertion.
- Conditional claim behavior under duplicate Queue deliveries.
- Pause and resume behavior.
- Safe retry for explicit throttles.
- `unknown` behavior for ambiguous transport failures.
- Authentication state, callback, session creation, expiry, logout, tenant rejection, and CSRF.

### Frontend

- Wizard navigation and prerequisite gating.
- `.csv` and `.xlsx` import.
- Worksheet and header selection.
- Mapping, validation, flagged rows, and representative previews.
- Test-send and final acknowledgement.
- Campaign polling or live refresh, pause, resume, and CSV export.
- Loading, empty, failure, and narrow-screen states.

## Visual QA

For each mock route:

1. Open the reference at original detail.
2. Render the implementation at a comparable viewport and state.
3. Capture the implementation.
4. Compare reference and capture together.
5. Fix P0, P1, and P2 differences.
6. Record the final comparison in `design-qa.md`.

Also test 1440 x 900, 1024 x 768, and 390 x 844. Check keyboard focus, contrast, overflow, and reduced motion.

## Real Microsoft and Gmail matrix

Run only after mocked and local integration tests pass.

1. Primary USM account signs in and sends a test to self.
2. Primary USM account sends one small campaign to the five authorized Gmail recipients.
3. Verify Graph acceptance, Sent Items, and inbox receipt where available.
4. Sign out completely.
5. Secondary USM account signs in through the same Entra application.
6. Secondary account sends a test to self and a small external campaign.
7. Verify sender identity is locked to the secondary mailbox.
8. Confirm accepted recipients cannot be sent again through a duplicate queue delivery.

Record sanitized evidence: test timestamp, sender alias such as `primary` or `secondary`, recipient count, Graph result category, campaign status, and whether inbox receipt was observed. Do not commit account addresses or credentials.

## Deployment checks

- Production D1 migrations applied.
- Queue producer and consumer bound.
- Static assets served by the Worker.
- Production origin and both local and production Entra redirect URIs configured.
- Worker secrets present without appearing in `wrangler` files or Git.
- Public sign-in, callback, dashboard, campaign queue, pause, resume, export, and logout tested.
- Logs contain correlation identifiers but no tokens or message bodies.

