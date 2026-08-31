# Progress log

Keep this append-only except when updating the short current-state summary. Never include secrets, email passwords, token values, or private message content.

## Current state

- Phase: working Cloudflare prototype deployed and verified end to end with both approved USM test accounts.
- Git: initialized on `main`; the initial implementation commit was created after the local verification and secret-history gate.
- Visual references: seven approved PNG files present, desktop comparisons are stored under `qa/`, and responsive Chrome evidence is stored locally under ignored `output/playwright/`.
- Local test environment: root `.env` present and ignored; passwords and secret values are not stored in source control.
- Quality: TypeScript, 66 unit and integration tests, production build, live Chrome smoke checks, responsive Playwright captures, and Wrangler deployment pass.
- Deployment: live at `https://mailflow.kyzer-hono-test.workers.dev` with D1, Queues, Workers Static Assets, and Worker secrets.
- Real Graph send: primary and secondary sender tests completed; each campaign recorded 5 accepted, 0 failed, 0 skipped, and 0 unknown.
- Delivery observation: both distinct campaign subjects were found in all five approved Gmail inboxes. This is test evidence, not a general delivery guarantee.
- Entra verification: existing single-tenant `MailFlow` app uses delegated `Mail.Send` and `User.Read`; local and production callbacks are configured and the Worker client credential is active.

## Log

### 2026-08-31 - Repository foundation

- Initialized the local Git repository on `main`.
- Confirmed the local test environment file is populated.
- Read the accepted research conversation and extracted use cases and platform decisions.
- Read the locally installed taste skill sourced from `github.com/leonxlnx/taste-skill`.
- Read the Product Design image-to-code workflow and inspected all seven visual references.
- Added durable agent, product, architecture, design, testing, decision, and implementation documents.

### 2026-08-31 - Typed Cloudflare client foundation

- Converted the Vite entry to strict React + TypeScript and added referenced app and node TypeScript configurations.
- Added React Router, Zod, Hono, Cloudflare Workers types, Vite's Cloudflare plugin, Wrangler, Vitest, and React testing-library baseline dependencies.
- Preserved the `dist/client` build output and existing static-worker packaging/test contract.
- Client build and static-worker tests pass. The full typecheck currently reports pre-existing auth-workstream issues in `src/server/auth/oauth-state.ts` and `src/server/auth/pkce.ts`.
- Verified the existing Entra app is single-tenant with delegated `Mail.Send` and `User.Read`.
- Found one legacy localhost redirect URI and no client credential. No Entra settings were changed.
- Bootstrapped the Product Design React starter under `apps/mailflow` and verified its initial build and packaging tests.
- Added a generated landing stationery composition and a transparent horizontal Mail Flow logo asset based on the approved mocks.

### 2026-08-31 - Domain, D1, and campaign queue contracts

- Added pure campaign and recipient state guards, deterministic recipient send keys, campaign validation contracts, pacing, and Retry-After parsing under `apps/mailflow/src/domain/`.
- Added safe template rendering helpers and D1 repository interfaces and adapters for auth users/sessions/tokens/state plus flows, template versions, campaigns, recipient jobs, and audit events.
- Added the initial D1 schema and indexes in `apps/mailflow/migrations/0001_initial.sql`.
- Added campaign-tick queue orchestration with conditional claims, pause/resume-aware scheduling, safe pre-send retries, and permanent `unknown` outcomes for ambiguous provider responses.
- Domain and queue tests pass; the existing application typecheck also passes at this checkpoint.

### 2026-08-31 - Persistence and queue boundary hardening

- Aligned D1 session timestamp columns with the authentication adapter's integer millisecond timestamps.
- Added runtime validation for malformed campaign queue payloads before accessing `campaignId`.
- Scoped domain, database, and queue typecheck passed; 12 domain and queue tests passed; initial migration parsed successfully in SQLite.

### 2026-08-31 - Worker and API integration

- Added the Hono API layer for Microsoft OAuth, secure sessions and CSRF, flows, template versions, campaign creation, test send, paced start, pause, resume, job status, and CSV export.
- Added server-side fail-closed template checks, ownership checks, JSON validation, same-origin enforcement, and redacted error responses.
- Added the TypeScript Cloudflare Worker entrypoint with static asset serving, SPA document fallback, runtime-safe Queue consumption, and Graph-backed campaign ticks.
- Added `wrangler.jsonc` with Workers Static Assets, D1 migration, Queue producer/consumer, and placeholder-safe local variables. No live Cloudflare resources or credentials were changed.
- Added API/Worker security and static routing tests. API integration tests pass; the complete suite remains gated by the active frontend workstream's current typecheck errors.

### 2026-08-31 - Browser prototype and visual verification

- Implemented the complete route set for landing, dashboard, template, data mapping, recipient rules, review, and campaign monitoring.
- Matched the approved Paper, Deep Ink, Moss, Signal Coral, editorial typography, rail, stepper, form, table, review, and audit-receipt direction using the prepared raster assets and Phosphor icons.
- Added working browser-side CSV/XLSX parsing, editable template and mapping controls, representative preview, acknowledgement gate, test-send state, campaign pause/resume state, and result CSV export.
- Verified every route in the user-selected Chrome browser and captured source-versus-implementation comparison evidence under `qa/`.
- Corrected the review shell to use the approved Deep Ink outer frame and inset Paper workspace, and compacted the campaign header and route summary so audit evidence begins above the fold.
- Verified that TypeScript, 50 unit tests, the production build, four static Worker packaging tests, and a Wrangler deploy dry run pass.

### 2026-08-31 - Security and replay hardening

- Made the campaign-create idempotency key mandatory from the browser contract through the Worker schema.
- Added owner-scoped idempotency lookup so ordinary retries and concurrent unique-key races return the original campaign rather than creating duplicate recipient jobs.
- Canonicalized numeric, named, whitespace, and double-encoded HTML character references before Worker-side unsafe URL and CSS protocol checks.
- Replaced partial character-reference handling with standards-compliant HTML entity decoding, then made inline CSS URL handling deliberately fail-closed. Numeric, named, double-encoded, protocol-relative, and CSS-escape reproducers are covered.
- TypeScript, 51 unit tests, four static packaging tests, the production build, and a Wrangler deploy dry run pass after the changes.
- The independent security verifier confirmed both prior findings resolved and found no remaining entity-encoded URL or CSS bypass in the focused scope.
- Added `design-qa.md`; desktop routes and core interactions are verified, while final visual QA remains blocked on tablet and mobile Chrome captures.

### 2026-08-31 - Frontend API integration

- Replaced visual-only frontend actions with a typed same-origin API client under `apps/mailflow/src/app/api.ts` for session, flow, campaign, test-send, queue control, polling, and export operations.
- Connected the mock-aligned React routes to `/api/me`, live dashboard resources, browser-side CSV/XLSX selection and mapping, client validation, flow/template persistence, stable campaign idempotency, test-send, acknowledgement, start, pause, resume, and campaign result polling.
- Preserved neutral fixture rendering when the local prototype has no authenticated session, while production authenticated routes use Worker responses and the signed-in mailbox identity.
- Verified `npm run typecheck`, `npm run test:unit -- --run` (51 tests), and `npm run build` pass after integration.

### 2026-08-31 - Frontend live-data integrity fixes

- Authenticated dashboard failures now show explicit error or empty states and never fall back to fixture flows or campaigns. Dashboard campaign result counts are loaded through owner-scoped campaign detail requests.
- Live campaign pages now clear remote snapshots on fetch failure, never substitute fixture jobs, counts, or statuses, and preserve `Failed` as a distinct campaign state. Demo routes remain local visual fixtures only.
- New flow resets workbook, mapping, flow/template IDs, campaign state, skipped-row acknowledgement, and generates a fresh idempotency key. Save draft now persists the current subject, body, recipient configuration, and placeholder mappings as a template version.
- Existing-flow cards temporarily became informational while saved-flow hydration was completed by the integration workstream.
- Full `npm test` passes: typecheck, production build, 57 unit tests, and four static packaging tests.

### 2026-08-31 - Saved-flow reuse and final local gate

- Made every reusable-flow card an accessible action that loads the owner-scoped flow and its current immutable template version before opening the wizard.
- Hydration now restores the subject, HTML body, primary recipient column, fixed or column-based CC/BCC/reply-to rules, separator, and placeholder mappings.
- Reusing a flow deliberately clears the previous workbook, selected table, campaign response, skipped-row choice, and campaign idempotency key. A new recipient file is therefore required and every new campaign receives a fresh request key.
- Template saving now persists the active recipient mapping rather than flattening column-based rules into fixed addresses.
- Verified the route and card interaction in the user-selected Chrome browser. `npm test` passes with 57 unit and integration tests, and `npx wrangler deploy --dry-run` passes with the expected D1, Queue, static assets, and public configuration bindings.
- Removed the inherited Sites packaging shim and its duplicate static-only Worker. The repository now has one deployment entrypoint, `worker/index.ts`, and one hosting target, Cloudflare Workers.
- An independent read-only integration review confirmed saved-flow ownership, complete template and recipient-rule hydration, fresh-upload enforcement, new campaign idempotency state, mapping preservation, and authenticated fixture isolation.
- Tablet and mobile image captures remain the only local visual-QA blocker because the selected Chrome automation session exposes a fixed viewport. Direct Playwright use requires explicit user permission under the active Product Design workflow.

### 2026-08-31 - Review HTML canonicalization fix

- Fixed generated plain-text draft bodies to emit canonical `<br>` elements. DOMPurify serializes the equivalent `<br />` input as `<br>`, so strict sanitized-body equality previously raised a false `unsafe_html` validation issue for an otherwise clean multiline message.
- Added a regression covering five clean recipient rows and a safe multiline body; the Review validation result is now ready with zero issues when optional CC is cleared.
- Verified the focused client suite (18 tests) and full `npm test`: typecheck, production build, and 59 unit/integration tests pass.

### 2026-08-31 - Cloudflare deployment and controlled live validation

- Provisioned the APAC D1 database `mailflow-db` and Queue `mailflow-campaign-ticks`, applied the initial migration remotely, and deployed the Worker, API, queue consumer, and static client to `https://mailflow.kyzer-hono-test.workers.dev`.
- Configured the existing single-tenant Entra `MailFlow` registration with the local and production callbacks, created a time-limited confidential client credential, and stored all three runtime secrets only in Cloudflare Worker secret storage.
- Fixed two pre-send findings before live campaign transmission: canonical `<br>` comparison no longer raises a false unsafe-HTML issue, and clearing a direct recipient mapping can no longer resurrect a legacy saved value.
- Primary sender alias: test-to-self accepted by Microsoft; five-recipient campaign completed with 5 accepted, 0 failed, 0 skipped, and 0 unknown; the distinct subject was observed in all five approved Gmail inboxes.
- Secondary sender alias: independent interactive OAuth consent and locked sender identity verified; test-to-self accepted by Microsoft; five-recipient campaign completed with 5 accepted, 0 failed, 0 skipped, and 0 unknown; the distinct subject was observed in all five approved Gmail inboxes.
- Sent Items was not checked. No recipient address, account password, token, client secret, or private message body is recorded in repository documentation.
- Added real 1440 x 900, 1024 x 768, and 390 x 844 Playwright Chrome captures. Corrected review sample overlap, mobile stepper overflow, campaign checkpoint clipping, dashboard table overflow, mapping issue readability, compact-height campaign evidence, and the landing headline composition.
- Timestamp: `2026-08-31 13:54 MYT`. Final responsive deployment version: `4fa5fa73-b99d-4492-a572-1c5e4e1a2f3b`.

### 2026-08-31 - Landing authentication and hero refinement

- Removed the landing marketing link group and the decorative section counter requested for the simplified hero.
- Connected both landing actions to application session state. Signed-out visitors see Microsoft sign-in, signed-in members receive dashboard links, and session loading has a disabled checking state.
- Dissolved the stationery artwork into the Paper surface with edge masking, tonal blending, and a desktop viewport bleed so the raster canvas no longer reads as a pasted rectangle.
- Added two component tests for authenticated and unauthenticated landing actions.
- Verified 1440 x 900, 1024 x 768, and 390 x 844 browser layouts with no horizontal overflow or console errors. `npm test` passes with 61 tests, and `npx wrangler deploy --dry-run` passes.

### 2026-08-31 - Flow onboarding, navigation, and clean demo state

- Standardized the authenticated shell on the landing-page MailFlow logo, a 264px desktop rail, Overview/Flows/Campaigns navigation, a fixed support footer, and no sidebar Recipients, Help, or logout controls.
- Rebuilt `/flows` as the saved-flow library with use, edit, create, loading, error, and empty states. Direct saved-flow edit URLs now rehydrate after reload.
- Reordered onboarding to Data, Template, Recipients, Review. New flows start with no file, recipients, template copy, mappings, or sample values. Spreadsheet headers now define the available dynamic fields before composition.
- Added selected-text replacement in the message editor. A dynamic-field click replaces the highlighted body text, or inserts at the caret when nothing is selected.
- Replaced the decorative campaign audit receipt with usable campaign metadata, preserved recipient-level results, and corrected the narrow audit-ID copy action.
- Changed application sessions to a rolling 365-day lifetime while preserving Microsoft revocation, explicit server-side logout, and browser cookie clearing as security exits.
- Verified the deployed Chrome flow at desktop and 390 x 844 mobile: fresh CSV import, header discovery, dynamic-field replacement, empty dashboard state, campaign details, fixed footer, and zero console warnings or errors.
- `npm run typecheck`, `npm run test:unit` (66 tests), `npm run build`, and Cloudflare deployment passed. Production product data was then cleared: 0 flows, 0 template versions, 0 campaigns, 0 recipient jobs, and 0 audit events. User, OAuth token, and active session records were preserved so the demo opens signed in and empty.

### 2026-08-31 - Responsive landing background refinement

- Removed the standalone landing workflow image element and moved the existing stationery composition into one oversized hero background layer on viewports wider than 900px.
- Extended the background beyond the hero's top and bottom edges and used a directional mask so it fades into the Paper surface behind the copy without a visible image boundary.
- Disabled the background rule at 900px and below. Small screens now render a one-viewport Paper hero with no artwork beneath the CTA and no workflow image in the document.
- Verified 1440 x 900, 1024 x 768, and 390 x 844 layouts with no overflow or browser console errors. `npm test` passes with 66 tests, and `npx wrangler deploy --dry-run` passes.

### 2026-08-31 - Full landing artwork framing

- Changed the desktop hero background from an intentionally oversized crop to a contained, aspect-ratio-preserving size with 16px of vertical breathing room.
- Verified that the complete stationery composition remains visible at 1920 x 928, 1440 x 900, and 1024 x 768 without document overflow.
- Reconfirmed at 390 x 844 that the artwork is absent from the pseudo-element and document image list, leaving a plain Paper hero beneath the CTA.
- `npm test` passes with 66 tests, and `npx wrangler deploy --dry-run` passes.

### 2026-08-31 - Wide hero copy alignment

- Removed all hero padding above 900px and positioned the landing copy independently toward the center, reaching about 221px from the left at 1920px, 154px at 1440px, and 95px at 1024px.
- Verified the adjustment at 1920 x 832, 1440 x 900, and 1024 x 768, then confirmed that 390 x 844 retains its 18px mobile gutter, plain Paper background, and overflow-free layout.
- `npm test` passes with 66 tests, and `npx wrangler deploy --dry-run` passes.

### 2026-08-31 - GitHub publication gate

- Prepared the current `main` history and working snapshot for initial publication to the project GitHub repository.
- Kept the ignored root `.env` and local `.qa-*.png` captures out of Git. The local QA captures can contain mailbox or recipient identifiers and are not publication-safe evidence.
- Verified `npm test`: TypeScript, the production build, and 67 unit and integration tests pass before publication.
