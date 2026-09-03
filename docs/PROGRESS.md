# Progress log

Keep this append-only except when updating the short current-state summary. Never include secrets, email passwords, token values, or private message content.

## Current state

- Phase: working Cloudflare prototype deployed and verified end to end with both approved USM test accounts.
- Git: initialized on `main`; the initial implementation commit was created after the local verification and secret-history gate.
- Visual references: seven approved PNG files present, desktop comparisons are stored under `qa/`, and responsive Chrome evidence is stored locally under ignored `output/playwright/`.
- Local test environment: root `.env` present and ignored; passwords and secret values are not stored in source control.
- Quality: TypeScript, 81 unit and integration tests, production build, live Chrome smoke checks, responsive Playwright captures, and Wrangler deployment pass.
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

### 2026-08-31 - Authoritative import state and exact HTML preview

- Restored explicit logout on both the authenticated landing header and dashboard rail while retaining the rolling 365-day session for members who do not sign out.
- Made the currently selected worksheet authoritative: replacing a workbook or worksheet now replaces the saved field map, and Template displays only that table's current headers.
- Removed the application-supplied MailFlow header and watermark from Review. The preview iframe now contains only the sanitized, personalized template HTML.
- Added a visible Review blocker panel with route-specific recovery links and explanatory disabled-button text.
- Added component and mapping coverage for logout and stale-header removal. TypeScript, 67 unit and integration tests, the production build, and a Wrangler deployment dry run pass.
- Confirmed that `npm run dev` serves both the client and Worker at port 5173 and that the local D1 migration succeeds. Before the ignored app-local environment files were configured, `/auth/microsoft/start` correctly returned `503` rather than pretending OAuth was available.
- Configured ignored app-local development secrets, verified the localhost Microsoft callback, completed interactive local sign-in, and confirmed that server-side logout returns the landing page to a signed-out state.
- Changed client validation to treat the DOMPurify output as the authoritative message body. Active markup and event handlers are still removed, while harmless email-HTML normalization no longer creates a false blocking issue.
- Re-ran the requested workbook and DOCX-derived HTML through localhost and the deployed Worker. Review reported Ready to queue, exposed only the two current workbook fields, enabled both send controls after acknowledgement, and added no MailFlow branding to the iframe.
- Deployed version `310fe61c-ff81-4c01-94d1-995055fc430f`. The test-to-self request was accepted by Microsoft; the five-recipient campaign completed with 5 accepted, 0 pending, 0 sending, 0 skipped, and 0 failed.
- The new message was observed in four recipient Gmail inboxes. The fifth recipient account was not present in the active Chrome Gmail sessions, so its inbox receipt remains not checked rather than inferred from Graph acceptance.

### 2026-08-31 - Explicit Microsoft account selection after logout

- Added `prompt=select_account` to every new Microsoft authorization request. MailFlow logout continues to revoke its own server session and clear its cookies, while the next sign-in can no longer silently reuse the last Microsoft account.
- Chose the account picker instead of Microsoft global logout so signing out of MailFlow does not unexpectedly sign the member out of Outlook, Teams, or other Microsoft applications.
- Added OAuth URL coverage and verified TypeScript, 67 unit and integration tests, and the production build with no local secret artifact.
- Verified both localhost and the deployed Worker in Chrome: after MailFlow sign-out, Continue with Microsoft opened the Microsoft `Pick an account` screen with saved accounts and `Use another account` rather than returning automatically to MailFlow.
- Deployed Worker version `08c97835-7b3a-4ed2-8dc7-a32fc75b91fd` and left the production landing page signed out after the check.

### 2026-08-31 - Fresh credentials after MailFlow logout

- Replaced the post-logout account-picker request with a conditional `prompt=login` authorization request. A normal signed-out visit still receives the Microsoft account picker, while a sign-in immediately following explicit MailFlow logout must enter fresh credentials and cannot silently restore the previous account.
- Kept the reauthentication scoped to MailFlow. The flow does not call Microsoft's global logout endpoint and therefore does not deliberately sign the member out of Outlook, Teams, or other Microsoft applications.
- Corrected the authenticated landing actions so both Dashboard links use reliable document navigation. Scoped the action-group alignment to the marketing header so the hero `Go to dashboard` button stays with the hero copy.
- Verified locally in Chrome: `Go to dashboard` opened `/dashboard`; Sign out returned to `/?signedOut=1`; the next Sign in opened Microsoft's blank username form rather than a remembered-account picker or the previous account's continuation screen.
- `npm run typecheck` and all 68 unit and integration tests pass. The local authorization endpoint returns `prompt=select_account` for ordinary sign-in and `prompt=login` for the explicit post-logout path.
- Production build and Wrangler dry run pass. Deployed version `f2e351ad-3cd4-41db-81c0-ef2653946165`; the live authorization endpoint returns the same ordinary and post-logout prompt split with the production callback URI.

### 2026-08-31 - Restored Microsoft browser SSO reuse

- Reverted forced credential entry after MailFlow logout at the user's request. Logout again clears only the MailFlow application session, and the following Microsoft authorization request uses `prompt=select_account` so an existing Microsoft browser session can be reused.
- Retained the independent Dashboard navigation and hero-action alignment fixes.
- TypeScript, all 67 tests, production build, and Wrangler dry run pass. Deployed version `8d885e01-a38e-4560-b7d0-d927452754d1`; both ordinary and formerly marked authorization URLs now return `prompt=select_account` with the production callback.

### 2026-09-01 - Wizard stepper refinement

- Reworked the four-step wizard header into one centered route with accurately aligned connectors, distinct completed/current/future states, and a contained step counter.
- Added `aria-current="step"` to the active route link, kept Phosphor checkmarks for completed steps, strengthened small-text contrast, and preserved the existing step order and navigation behavior.
- Added a mobile presentation that retains all four checkpoints while showing only the active label, with the count kept inside the same progress header.
- Playwright captures at 1440 x 900, 1024 x 768, and 390 x 844 show no horizontal overflow or console errors. Data and Template states were both checked, including the completed route segment.
- `npm test` passes: TypeScript, production build, and all 67 unit and integration tests.

### 2026-09-01 - General student-society positioning

- Removed the hard-coded USM Debate Society label from the product shell and stopped injecting that organization name into newly created flows.
- Reframed Mail Flow as a general tool for USM student society members who send personalized campaign email through their own student Outlook mailbox.
- Replaced debate-specific fixture and screen-spec content with a general annual-event invitation while retaining neutral test aliases and the approved mock layouts.
- Added durable guidance that organization names in the mock images are sample copy rather than product identity, plus a component assertion that the general audience label is rendered.
- `npm test` passes: TypeScript, production build, and all 67 unit and integration tests.

### 2026-09-01 - Power Automate-inspired sending rules and dynamic values

- Replaced the secondary CC, BCC, and Reply-to source dropdowns with direct address entry, removable address chips, and one explicit dynamic-value button that opens the available spreadsheet columns.
- Added Low, Normal, and High message Importance with Normal as the default. Importance is saved with template recipient configuration, copied into each recipient job, persisted through migration `0002_message_importance.sql`, included in test sends, and passed to Microsoft Graph.
- Replaced visible merge braces with readable green dynamic-value tokens in the detected-field panel, field mapping labels, dynamic-value picker, and message body editor. The underlying saved template continues to use deterministic merge keys.
- Recorded the Power Automate-like interaction as durable frontend guidance in `apps/mailflow/AGENTS.md` and updated the domain documentation for message importance.
- Applied the new D1 migration locally. `npm test` passes with TypeScript, the production build, and all 67 unit and integration tests; `npx wrangler deploy --dry-run` also passes.
- Checked the live local wizard with Playwright using the committed CSV fixture. Fixed-address chips, dynamic BCC selection, High importance, and inline body tokens behaved correctly. Captures at 1440 x 900, 1024 x 768, and 390 x 844 show no horizontal overflow after the tablet layout adjustment.
- Made dynamic-value insertion and selected-text replacement participate in the browser's native editing history. Chromium checks confirmed Ctrl+Z restores the prior body text and Ctrl+Shift+Z reapplies the same token transaction without introducing spacing before punctuation.

### 2026-09-01 - Clear spreadsheet mapping sidebar

- Renamed the confusing Detected fields panel to Map your spreadsheet and rewrote its description as a direct two-part instruction.
- Relabeled the primary setting as Recipient email column and each template mapping as a readable message value, such as Recipient Name in message.
- Removed merge braces and the dynamic-value icon from sidebar field names. Available spreadsheet columns remain visible as clearly labeled, plain reference tags.
- Verified the populated state with the committed CSV fixture and an inserted message value in Chromium at 1440 x 900. The mapping controls expose clear accessible names and the layout has no horizontal overflow.
- `npm test` passes: TypeScript, production build, and all 67 unit and integration tests.

### 2026-09-01 - Single-column sending rules

- Stacked CC, BCC, Reply-to, and Importance as four full-width rows instead of two paired rows.
- Preserved the existing address chips, dynamic-value controls, helper text, and Importance behavior.
- Verified the populated Recipients step in Chromium at 1440 x 1000 and confirmed no horizontal overflow at 390 x 844.
- `npm test` passes: TypeScript, production build, and all 67 unit and integration tests.

### 2026-09-01 - Test-send recipient metadata fix

- Fixed the Review test-send path so the selected personalized preview's CC, BCC, and Reply-to values are carried from the browser request through Worker validation into the Microsoft Graph message.
- Kept the authenticated member's mailbox as the test message's primary recipient and sender identity.
- Added API serialization, schema, service, and provider-boundary regression coverage. `npm test` passes: TypeScript, production build, and all 69 unit and integration tests; `npx wrangler deploy --dry-run` also passes.
- No real message was sent and no production deployment was changed during this checkpoint.

### 2026-09-01 - Campaign revisit integrity and flow naming

- Prevented personalized API GET responses from being cached by the browser or an intermediary, so revisiting Campaign history or an exact campaign ID cannot replay the campaign's initial validated or queued snapshot.
- Made campaign polling discard out-of-order responses. Pause and resume now apply the mutation response immediately and reload authoritative state even when a concurrent lifecycle change rejects the action.
- Replaced generated campaign-ID labels in Campaign history with the reusable flow name, using the source filename only as a fallback.
- Added case-insensitive, owner-scoped flow-name uniqueness in the API and D1 migration `0003_unique_flow_names.sql`. Existing duplicates keep the oldest name and receive friendly numbered suffixes such as `(2)`.
- Verified the migration against a temporary local D1 containing case-only duplicates and confirmed that a later case-insensitive duplicate insert is rejected.
- `npm test` passes: TypeScript, production build, and all 71 unit and integration tests. `npx wrangler deploy --dry-run` also passes.
- A read-only production D1 inspection could not run because the current Wrangler session was not authorized for that Cloudflare account. No production data, deployment, or real mail was changed.

### 2026-09-01 - Safe flow removal

- Added a Remove action to reusable-flow cards with an inline confirmation that explains campaign history remains available.
- Removing a flow archives it through the existing owner-scoped API instead of deleting its D1 row, preserving campaign and template audit references while removing it from the active flow library.
- Changed flow-name uniqueness to apply to active flows. An archived flow's name can therefore be reused without weakening uniqueness in the visible library.
- Added API serialization and component interaction coverage. A temporary D1 check confirmed active duplicates are rejected and an archived name can be reused.
- `npm test` passes: TypeScript, production build, and all 73 unit and integration tests. `npx wrangler deploy --dry-run` also passes.
- No production data, deployment, or real mail was changed.

### 2026-09-01 - Reliable flow renaming and contextual save errors

- Fixed editing an existing flow so saving now updates the flow name through the owner-scoped flow API before creating the new template version.
- Refreshed the shared flow library after a successful save, so returning to Flows immediately shows the persisted name instead of stale dashboard data.
- Moved duplicate-name feedback beside the Flow name field with an invalid-field state, and kept other save failures inside the compose card without displacing the page layout.
- Cleared stale error and Saved states as soon as the member edits the draft again. Partial-save feedback now distinguishes a saved rename from template changes that still need attention.
- Added API and component regression coverage for successful renaming and duplicate-name conflicts. `npm test` passes: TypeScript, production builds, and all 76 unit and integration tests. `npx wrangler deploy --dry-run` also passes.
- No production data, deployment, or real mail was changed.

### 2026-09-01 - Chrome-verified route data revalidation

- Reproduced the stale-data defect in two authenticated local Chrome tabs: one tab created a flow while the second tab retained an older dashboard snapshot, and React Router navigation from Overview to Flows made no API request and omitted the new flow.
- Revalidated the shared flow and campaign snapshot whenever authenticated navigation enters Overview, Flows, or Campaigns, and after successful campaign create, start, pause, or resume mutations. Request generations prevent an older overlapping response from replacing the latest route data.
- Repeated the same two-tab scenario after the fix. Overview and Flows each requested fresh flow and campaign data, the previously stale tab displayed the new flow without a hard reload, and authenticated GET responses returned `Cache-Control: private, no-store, max-age=0`.
- Added focused component regressions for route-entry refresh and out-of-order response suppression. `npm test` passes with TypeScript, the production build, and all 78 unit and integration tests; `npx wrangler deploy --dry-run` also passes.
- The Chrome verification created two local-only flows named `Chrome stale-data check` and `Chrome route revalidation proof`. No message was sent and no production deployment or data was changed.

### 2026-09-01 - Production D1 schema-drift recovery

- Traced the generic Review action failure to production schema drift: the deployed Worker inserts recipient-job Importance, while remote D1 had only recorded `0001_initial.sql` and did not yet contain the `recipient_jobs.importance` column.
- Applied committed production migrations `0002_message_importance.sql` and `0003_unique_flow_names.sql` after explicit approval. The flow-name migration resolved one existing active duplicate with its deterministic friendly suffix before creating the unique index.
- Verified that remote D1 has no pending migrations, `recipient_jobs.importance` is a required text column with the `normal` default, the active flow-name uniqueness index exists, and no duplicate active-name groups remain.
- `npm test` passes with TypeScript, the production build, and all 78 unit and integration tests. `npx wrangler deploy --dry-run` also passes.
- No Worker deployment or real mail send was performed. The affected member can retry the existing Review action; the failed attempt did not reach Microsoft Graph.

### 2026-09-01 - Power Automate-style visual and HTML message editor

- Added a Power Automate-inspired code toggle to the Template message body. Visual mode now includes font, size, emphasis, highlight, list, alignment, link, and clear-formatting controls; HTML mode exposes the same body as editable source.
- Replaced the lossy plain-text editor serialization with an HTML-preserving round trip. Sanitized rich HTML paste now retains email-safe tables, inline borders, padding, background colors, highlights, lists, and dynamic-value placeholders.
- Made sanitized HTML authoritative before flow persistence and reused the isolated preview document in Review. Browser verification confirmed that the visual editor and send preview expose identical inline border and padding values.
- Expanded the sanitizer to support safe email formatting tags and attributes while removing inline CSS that the Worker would reject, keeping preview, stored template HTML, and Graph input aligned.
- Added regression coverage for visual/source toggling, sanitized rich paste, styled tables, highlight markup, unsafe script/CSS cleanup, and preview preservation. `npm test` passes with TypeScript, the production build, and all 81 unit and integration tests; `npx wrangler deploy --dry-run` also passes.
- Product Design browser QA passed at 1440 x 900 and 390 x 844 with no console warnings or errors. Evidence and comparison history are recorded in `apps/mailflow/design-qa.md`.
- No production deployment or real mail send was performed.

### 2026-09-02 - Legacy email-table rendering compatibility

- Reproduced the supplied template defect against the local visual editor and sanitized send preview. The affected table depended on legacy `border`, `cellpadding`, and `cellspacing` attributes, which did not survive DOMPurify, while source indentation was rendered as visible whitespace inside the rich editor.
- Added a pre-sanitization compatibility pass that converts those bounded numeric table attributes into inline border, spacing, and per-side cell padding CSS. Existing inline cell padding remains authoritative.
- Changed the rich editor to normal HTML whitespace collapsing and converted typed or pasted plain-text line breaks to `<br>` elements, aligning visual mode with browser and email HTML rendering.
- Fact-checked the legacy table behavior with an anonymized fixture in `htmlcodeeditor.com`, then loaded the exact supplied HTML into the local QA route. The visual editor and sanitized preview now contain the same inline table border, zero spacing, and 12-pixel cell padding, and the visible table renders as a compact two-row grid.
- `npm test` passes with TypeScript, the production build, and all 81 unit and integration tests. `npx wrangler deploy --dry-run` also passes.
- No production deployment, production data change, or real mail send was performed.

### 2026-09-02 - HTML editor production release

- Removed the standalone `html-editor-qa.html` harness and its React entry before release. The non-runtime design QA report and comparison captures remain as required verification evidence and are not included in the Vite production asset graph.
- Released the visual/HTML message editor and legacy table-attribute compatibility fix from isolated `main`, excluding the unfinished small-attachment workstream.
- Confirmed production D1 had no pending migrations, `npm test` passed with all 81 tests, and `npx wrangler deploy --dry-run` passed before deployment.
- Deployed Worker version `41f6518f-fb1f-48b1-82f7-fa060d535d19` to `https://mailflow.kyzer-hono-test.workers.dev` with the existing D1 and Queue bindings.
- Post-deployment smoke checks returned `200 text/html` for the landing page and the expected unauthenticated `401 application/json` for `/api/me`.
- No production data was changed and no real message was sent.

### 2026-09-02 - OneDrive App Folder attachment feasibility

- Investigated the stopped, undeployed R2 attachment workstream against the current authentication, Graph mail adapter, D1 repositories, campaign queue, and Cloudflare configuration.
- Verified from current official Microsoft documentation that Graph App Folder is documented across OneDrive work/school and home, while delegated `Files.ReadWrite.AppFolder` remains preview and tenant consent policy can still require administrator approval.
- Determined that direct `sendMail` is safe only when every attachment is under 3 MB and the complete serialized request remains below Graph's 4 MB write limit. The 3 MB to product-limit path requires per-recipient drafts, Outlook attachment upload sessions, delegated `Mail.ReadWrite`, and the existing `Mail.Send` for the final send.
- Confirmed Workers Free constraints of 10 ms CPU, 128 MB memory, 50 external subrequests, and 100 MB request bodies, plus Queues Free's 128 KB messages, 10,000 daily operations, and 24-hour retention. The proposed design uses direct browser-to-OneDrive uploads, ID-only queue messages, and streamed range forwarding.
- Identified Outlook's 150 MB per five-minute per-app/mailbox upload throttle as a required attachment-aware pacing constraint; the current 12 messages per minute is unsafe for large attachments.
- Recorded the conditional go recommendation, architecture, permissions, migration plan, risks, manual USM tenant test, acceptance criteria, and 12 to 17 engineer-day estimate in `docs/ONEDRIVE_APP_FOLDER_FEASIBILITY.md`.
- Documentation verification passed with `git diff --check`. Application tests were not rerun because this checkpoint changes documentation only.
- Live tenant testing stopped before the authorization boundary because the current Entra app and stored refresh tokens do not include `Files.ReadWrite.AppFolder` or `Mail.ReadWrite`; adding them would change external tenant state and require interactive consent. No production configuration, storage, deployment, data, or mail was changed.

### 2026-09-02 - USM delegated-permission consent probes

- Used separate read-only OAuth authorization requests against the primary USM student identity to test `Files.ReadWrite.AppFolder` and `Mail.ReadWrite` independently. The permissions were requested dynamically and were not added to the live app registration.
- `Files.ReadWrite.AppFolder` reached the ordinary Microsoft user-consent screen. This scope is not tenant-blocked for the tested account.
- `Mail.ReadWrite` reached Microsoft's administrator-approval screen. The effective USM tenant policy prevents the tested ordinary student from consenting to that scope.
- No consent button was accepted, no permission grant or app-registration change was made, no OneDrive folder or file was created, and no mail was sent.
- This result narrows the production blocker: card-free App Folder storage can advance to an authorized API test, while attachments requiring Outlook drafts and upload sessions still require USM administrator approval for `Mail.ReadWrite`.

### 2026-09-02 - Power Automate attachment-path clarification

- Confirmed from the supplied flow captures that Google Drive file bytes are mapped into the Office 365 Outlook `Send an email (V2)` attachment `ContentBytes` field, producing ordinary file attachments rather than drive links.
- Verified in the authenticated USM Power Automate environment that the tested student already has working Office 365 Outlook and Google Drive connector connections and that Power Automate is assigned in the tenant. No flow, connection, consent, or message was changed.
- Corrected the earlier blanket feasibility statement: the 4 MB write ceiling and `Mail.ReadWrite` draft blocker apply to MailFlow's direct public Graph path, while Microsoft's managed Outlook connector documents a separate 49 MB maximum mail-content length.
- Recorded the two Power Automate integration models and their tradeoffs. Run-only user connections preserve the invoking sender but require a Power Automate interaction; an HTTP-triggered central flow uses an embedded connection and does not automatically become the signed-in MailFlow member.
- Identified the connector's default timeout retry behavior as incompatible with MailFlow's ambiguous-send no-retry rule unless explicitly overridden and tested.
- Documentation verification passed with `git diff --check`. Application tests were not rerun because this checkpoint changes documentation only.

### 2026-09-02 - Power Automate transport prototype and attachment E2E

- Created two isolated flows in the current USM Power Automate environment without altering existing flows: `MailFlow Prototype - HTTP Outlook Delivery` and `MailFlow Prototype - Manual Attachment E2E`.
- Configured the HTTP prototype for tenant-authenticated requests, one base64 attachment, explicit post-send success response, secure trigger/action inputs and outputs, and `None` retry policy on the Outlook action.
- Confirmed the HTTP endpoint rejects unauthenticated requests with 401. The current local Entra credential returns `invalid_client` before it can obtain the required `https://service.flow.microsoft.com/` token, so no HTTP-triggered message was sent.
- Confirmed the environment marks the HTTP flow `Activity suspended` and displays that premium flows are turned off. No license was purchased, no admin consent was requested, and no tenant or production configuration was changed.
- Ran one authorized manual E2E send through the existing Office 365 Outlook connection to the single Gmail inbox visible in Chrome. Power Automate reported success, and Gmail showed the unique subject, synthetic HTML body, and `mailflow-prototype-proof.txt` attachment.
- Inspected `EMAIL.xlsx` and found 831 unique official-email values. The workbook was not used to launch a campaign, and no other recipient was contacted.
- Added a provider-neutral Power Automate adapter and nine unit tests. The adapter requires explicit flow confirmation and preserves the no-automatic-retry rule for ambiguous sends.
- Recorded the architecture boundary, promotion gates, evidence, and operational constraints in `docs/POWER_AUTOMATE_PROTOTYPE.md`, `docs/ARCHITECTURE.md`, and ADR-008.
- Verification passed: `npm test` completed type checking, both production builds, and 90 unit tests across 12 files. The existing chunk-size warning remains unchanged. No production deployment was performed.

### 2026-09-02 - Power Automate HTML-body correction

- The first Gmail delivery exposed the manually entered `<p>` element as literal text because it had been typed into the Outlook action's visual editor.
- Replaced the entire Outlook `Body` value in source mode, removing both the escaped original paragraph and an intermediate duplicate created while diagnosing the editor behavior.
- Ran a final bounded send to the same authorized Gmail inbox. Power Automate completed successfully; Gmail rendered exactly one paragraph with no visible HTML tags and retained `mailflow-prototype-proof.txt` as a normal attachment.
- No existing user flow, additional recipient, license, admin consent, tenant configuration, or production deployment was changed.

### 2026-09-02 - Power Automate prototype retirement

- Retired the isolated Power Automate transport experiment after OAuth SMTP attachment delivery proved viable for the primary USM student account.
- Removed the unwired application adapter, its nine dedicated tests, the prototype design note, the experimental architecture section, and the experimental ADR. Removed the managed-connector alternative from the separate OneDrive feasibility note while preserving the historical progress record.
- `npm test` passes after cleanup with TypeScript, both production builds, 11 test files, and all 81 remaining unit and integration tests. The existing client chunk-size warning remains unchanged.
- Permanently deleted only the two isolated cloud flows created for the experiment: `MailFlow Prototype - HTTP Outlook Delivery` and `MailFlow Prototype - Manual Attachment E2E`. The remaining pre-existing flows and connector connections were left unchanged.
- Attempted an authentication-only SMTP recheck using the first student account and stopped before contacting SMTP because the ignored local Entra client-secret value was rejected during OAuth token exchange. The portal shows the application's single deployment credential remains active, but its value is intentionally unrecoverable and does not match the stale local copy. No email was created or sent.
- After explicit authorization, created a separate one-day client secret inside the existing MailFlow Entra application and kept its value only in the in-memory probe. OAuth token exchange returned 200 for the first student account with delegated `SMTP.Send` present.
- Completed an authentication-only Exchange Online SMTP session: greeting `220`, pre- and post-TLS `EHLO` `250`, `STARTTLS` `220`, XOAUTH2 advertised, `AUTH XOAUTH2` `235`, and `QUIT` `221`. The probe never issued `MAIL FROM`, `RCPT TO`, or `DATA`, so it could not create or send a message.
- Deleted the temporary client secret immediately after the probe and verified that the credentials page returned to one client secret with the original `MailFlow Cloudflare Worker` credential still present. This confirms OAuth SMTP AUTH availability for the tested first student account only; it does not establish tenant-wide mailbox availability.
- No production deployment, D1 data, Queue configuration, existing deployment credential, connector connection, or pre-existing user flow was changed.

### 2026-09-02 - Staged OAuth SMTP transport implementation

- Superseded the Graph-only architecture decision with a staged delegated OAuth SMTP target. Graph remains the default deployment transport and rollback path; no automatic per-message fallback is attempted because Microsoft Graph and Outlook SMTP access tokens are resource-specific.
- Added a Cloudflare Workers-compatible Exchange Online SMTP client using outbound TCP, STARTTLS, and XOAUTH2. The client records acceptance only after the final post-DATA `250`, treats a lost final response as `unknown`, and allows safe retry only for failures proven to occur before acceptance or for explicit transient SMTP replies.
- Added deterministic MIME generation for HTML, CC, Reply-To, importance, BCC envelope privacy, Unicode filenames, and up to 20 attachments with a conservative 20 MiB combined raw-byte cap. The current product UI and durable attachment storage remain out of scope; this prepares the transport boundary without presenting an unfinished attachment feature.
- Added SMTP-mode OAuth configuration and ID-token mailbox identity so the SMTP resource token does not require Graph `/me`. Existing users must complete SMTP-specific OAuth consent before a future transport switch.
- Added unit coverage for resource-scope separation, ID-token identity, authentication-only probing, multiple byte-exact attachments, BCC privacy, OAuth rejection, transient rejection, Graph fallback attachment refusal, and ambiguous post-DATA failure handling.
- Verification passed: `npm test` completed type checking, both production builds, 12 test files, and all 89 unit and integration tests. `npx wrangler deploy --dry-run` also passed with the existing Graph-default production configuration.
- After action-time confirmation, completed the second-student Cloudflare-hosted authentication-only probe using the existing MailFlow Entra application. The account reached ordinary delegated consent for `SMTP.Send` without an administrator-approval prompt, and the issued Outlook access token contained `SMTP.Send`.
- The temporary Worker observed Exchange Online SMTP greeting `220`, `STARTTLS` `220`, XOAUTH2 authentication `235`, and `QUIT` `221`. Its probe implementation could issue only greeting, TLS, authentication, and quit operations; it never issued `MAIL FROM`, `RCPT TO`, or `DATA`, so it could not create or send a message.
- Deleted the one-day Entra credential immediately and verified the credentials page returned to one secret with the original `MailFlow Cloudflare Worker` credential intact. Deleted the temporary Cloudflare Worker, verified its former endpoint returned `404`, and removed its local probe files and generated cache.
- Combined with the earlier first-student probe, this establishes OAuth SMTP AUTH compatibility for both tested USM student mailboxes. It is strong evidence for the intended student cohort but not a tenant-wide guarantee; onboarding should retain the authentication-only compatibility check because SMTP AUTH can still be overridden per mailbox.
- No email, production deployment, D1 data, Queue state, existing deployment credential, connector connection, or pre-existing flow was created or changed by the second-account probe.

### 2026-09-02 - SMTP campaign attachments ready for review

- Implemented campaign-wide attachment selection, upload, removal, retry states, Review summaries, and test-send locking. The product accepts up to five approved PDF, Office, CSV, text, PNG, or JPEG files totaling at most 20 MiB.
- Added owner-scoped D1 attachment-set and file metadata, private R2 object storage, SHA-256 integrity checks, immutable campaign association, terminal cleanup, and hourly 24-hour orphan cleanup. Queue messages and campaign payloads carry only opaque attachment-set identifiers.
- Enabled attachments only when the deployment selects SMTP, the private R2 binding is present, and the signed-in user's stored OAuth grant includes `SMTP.Send`. Older Graph-authorized sessions receive a Reconnect Microsoft action instead of a nonfunctional picker.
- Extended delegated OAuth SMTP MIME delivery to stream base64 attachment content in bounded writes. Malformed MIME fails before `DATA`; a network loss before the DATA terminator remains retryable, while a loss during or after the terminator is `unknown` and is not resent automatically.
- Hardened removal so conditional D1 metadata deletion must win before R2 bytes are touched, preventing a concurrent campaign lock from losing an attachment. Added replacement-ordering and untracked-object cleanup regressions.
- Completed an authenticated local Chrome walkthrough with the primary USM student account: imported one synthetic CSV row, uploaded two synthetic files, verified both filenames and exact byte totals in Review, and confirmed the final action stayed disabled until acknowledgment. Browser warnings and errors were empty. The test-send and campaign-start buttons were not activated.
- Verification passed: local migrations have no pending work; `npm test` completed type checking, both production builds, 14 test files, and all 115 tests; `npx wrangler deploy --dry-run` included D1, Queue, private R2, assets, the hourly trigger, and SMTP configuration. `git diff --check` passed apart from informational Windows line-ending notices.
- No production migration, R2 resource creation, Worker deployment, or real message send was performed. Promotion still requires creating the named private R2 bucket, applying migration `0004_campaign_attachments.sql`, deploying the reviewed branch, and completing the authorized attachment mail matrix.

### 2026-09-02 - Corrected attachment storage to per-user OneDrive

- Corrected the review branch after the user rejected payment-bound R2 storage. The final branch no longer declares an R2 bucket or `ATTACHMENTS` binding; temporary bytes use each signed-in student's OneDrive `Apps/MailFlow` folder through delegated `Files.ReadWrite.AppFolder`.
- Kept delegated OAuth SMTP as the delivery transport. Added separate encrypted D1 refresh-token records for `smtp`, `onedrive`, and the Graph-mail rollback path because Microsoft access tokens are resource-specific.
- Added a same-account OneDrive consent flow, a Connect OneDrive prerequisite in the attachment UI, and a Graph App Folder adapter that uploads generated private names, follows preauthenticated downloads without forwarding the bearer token, verifies bytes through the existing SHA-256 path, and removes active app-folder items.
- Preserved the five-file and 20 MiB limits, immutable campaign association, test-send and queue integration, and 24-hour orphan cleanup. Ordinary Graph deletion moves an item to the student's recycle bin; immediate quota reclamation remains gated on a tenant test of scoped `permanentDelete`.
- Applied migration `0005_oauth_resource_tokens.sql` locally and verified its composite per-user resource key. `npm test` passed TypeScript, both production builds, 15 test files, and all 121 tests. `npx wrangler deploy --dry-run` passed with D1, Queue, Assets, SMTP configuration, and no R2 binding.
- No production migration, Entra callback change, OneDrive consent, OneDrive item creation, Worker deployment, or email send was performed. The next live gate is to register the additional callback on the existing Entra application and run a bounded primary-student OneDrive upload, download, cleanup, and SMTP attachment test.

### 2026-09-03 - OneDrive and SMTP multi-attachment E2E passed

- Reused the existing `/auth/microsoft/callback` for both SMTP sign-in and OneDrive consent by purpose-prefixing the sealed OAuth state. The live primary-student consent reached the ordinary Microsoft user-consent screen and granted `Files.ReadWrite.AppFolder` without an administrator prompt or an additional Entra redirect URI.
- Corrected a Cloudflare runtime defect in the OneDrive adapter by invoking the runtime-bound global `fetch` through a wrapper. Before this fix, the first live upload failed with an illegal-invocation error; after it, the App Folder accepted the synthetic file bytes.
- Serialized the browser's bounded multi-file uploads and retained the attachment-set ID synchronously. This prevents parallel selections from racing the D1 file counter or creating a second idempotent set request. Added component coverage that holds the first upload open and proves the second does not start early.
- Corrected unreadable refresh-token ciphertext handling so a key mismatch is classified as an authentication failure before SMTP, not an ambiguous transport outcome. Two local diagnostic campaigns encountered the intentionally stale local SMTP ciphertext; no SMTP socket was opened and neither message appeared in Gmail. Reconnecting the same primary account under the current local key resolved the test-only mismatch.
- Ran the final bounded campaign through the normal MailFlow UI to the single authorized Gmail address. Microsoft returned the final SMTP acceptance response on the first attempt, MailFlow recorded `accepted`, and Gmail displayed the personalized HTML body plus both attachments.
- Downloaded both Gmail attachments independently. `mailflow-onedrive-proof-a.txt` was 122 bytes with SHA-256 `2a346e583b9938ebc0fbe1b6d77f85f191aa9af6c389499206a9822f64bcafb0`; `mailflow-onedrive-proof-b.txt` was 122 bytes with SHA-256 `884bcd90e87574baa7cb1de47b4f15e9a027145842160f13d609691cb3b6406a`. Both matched the source bytes and D1 integrity metadata exactly.
- Terminal cleanup removed both objects from the active OneDrive App Folder and marked the attachment set and file bytes deleted. This remains a recoverable OneDrive recycle-bin deletion; scoped permanent deletion and immediate quota reclamation are still not claimed.
- Final verification passed: `npm test` completed TypeScript, both production builds, 15 test files, and all 122 tests; `npx wrangler deploy --dry-run` reported D1, Queue, Assets, SMTP configuration, and no R2 binding; `git diff --check` passed apart from informational Windows line-ending notices.
- No production migration, Worker deployment, production D1 write, admin consent, license purchase, or application-hosting change was performed.

### 2026-09-03 - Review attachment label collision fixed

- Replaced the review email preview's fixed metadata label width with a shared content-sized grid so `Attachments` cannot overlap the filename summary.
- Preserved the established review styling and added safe wrapping for long metadata values.
- Focused Chrome verification at 820px and 390px widths measured a consistent 12px label-to-value gap with no horizontal overflow.
- Verification passed: `npm test` completed type checking, both production builds, 15 test files, and all 122 tests; `git diff --check` passed apart from the informational Windows line-ending notice.

### 2026-09-03 - Release artifact cleanup

- Removed committed visual-QA screenshots and standalone QA reports after the user completed manual acceptance. Feature unit, integration, security, SMTP, OneDrive, Queue, and UI behavior tests remain in the source tree.
- No synthetic attachment bytes or temporary secret files remain in the worktree.

### 2026-09-03 - SMTP and OneDrive attachment release deployed

- Merged PR 1 into `main` at merge commit `92ca21e` after the final Cloudflare PR build passed.
- Applied production D1 migrations `0004_campaign_attachments.sql` and `0005_oauth_resource_tokens.sql`; a second migration listing reported no pending work.
- Preserved the existing production `ENTRA_CLIENT_SECRET`, `SESSION_SECRET`, and `TOKEN_ENCRYPTION_KEY_B64` Worker secrets. Deployed SMTP mode with D1, Queue producer and consumer, static assets, and the hourly attachment cleanup trigger. No R2 binding was created.
- Completed the primary production account's normal SMTP reconnect and OneDrive App Folder connection through the shared Entra callback. Production D1 contains separate `smtp` and `onedrive` grant records for that account; no test message or attachment was sent during deployment verification.
- Public smoke checks passed: the landing page returned 200, unauthenticated `/api/me` returned 401, the sign-in route requested delegated `SMTP.Send`, and an authenticated Chrome session rendered the production dashboard with no console warnings or errors.
- Fast-forwarded the local main checkout, consolidated local secrets into one ignored `apps/mailflow/.env`, removed the redundant `.env.local`, applied both local migrations, installed dependencies, and started the full-stack development server on port 5173.
- Local main verification passed: 15 test files and all 122 tests, both production builds, Wrangler deployment dry run, root HTTP 200, unauthenticated API 401, SMTP OAuth scope, localhost callback, and no pending local migrations.

### 2026-09-03 - Single-application repository root

- Flattened `apps/mailflow` into the repository root and removed both empty wrapper directories. All 102 moved source, test, asset, migration, package, and configuration files match their original Git blobs.
- Merged the application-specific instructions into the root `AGENTS.md`, promoted the application `.env.example`, and updated the README and operations runbook so commands and deployment paths resolve from the root. Historical progress entries retain their original paths.
- Preserved ignored dependency files, local D1 state, and Playwright artifacts at the root. Moved the active application `.env` to the root and retained the former root test-account notes as ignored `.env.test-accounts`; both files retained their original hashes and no secret values were printed or committed.
- Verification passed from the repository root: `npm test` completed TypeScript checks, both production builds, 15 test files, and all 122 tests; `npx wrangler deploy --dry-run` passed; `npx wrangler d1 migrations list mailflow-db --local` reported no pending migrations; `git diff --check` passed. Existing dependency-comment and client chunk-size warnings remain.
- Started the full-stack preview from the root on port 5173. HTTP checks returned 200 for the landing page, client entry, and logo asset, 401 for unauthenticated `/api/me`, and 302 for sign-in with delegated `SMTP.Send` and the localhost callback.
- Cloudflare Git builds must use the repository root as their build directory when this change is rolled out. This checkpoint does not alter remote build settings or deploy production code.

### 2026-09-03 - Local artifact and dead-file cleanup

- Removed the unused `src/app/fixtures.ts` module and unreferenced `public/assets/campaign-audit-receipt.png` asset. Retained the two public assets used by the application.
- Cleared obsolete local Playwright output, QA captures, generated build output, Wrangler dry-run files, and Wrangler observability traces while retaining `node_modules`, local environment files, and local D1 state.
- Removed the clean, fully merged `feature/smtp-campaign-attachments` Codex worktree and deleted its local branch. Windows continues to hold the final empty worktree directory open, but its contents and Git registration are gone.
- Verification passed: `npm test` completed TypeScript checks, both production builds, 15 test files, and all 122 tests. Existing dependency-comment and client chunk-size warnings remain.

### 2026-09-03 - Package script cleanup

- Removed the unused `dev:worker` command and redundant `build:client` alias. The documented `npm run dev` full-stack workflow and the standard build, preview, migration, deployment, and test commands remain.
- Verification passed: `npm test` completed TypeScript checks, both production builds, 15 test files, and all 122 tests. Existing dependency-comment and client chunk-size warnings remain.

### 2026-09-03 - Documentation lifecycle cleanup

- Updated the README and ADR-008 to describe delegated OAuth SMTP as the deployed transport and Graph as the deployment-selectable rollback path.
- Removed active gates and repository-map references to the deleted `design-qa.md`; visual verification remains required and is recorded in this progress log.
- Moved the superseded OneDrive attachment feasibility investigation to `docs/archive/` with an archive note pointing to the authoritative architecture, decision, and progress records.
- Documentation link checks and `git diff --check` passed.

### 2026-09-03 - Shared D1 adapter helpers

- Added one internal D1 helper module for JSON serialization and fallback parsing, statement binding, prepared-statement binding, and affected-row counts. Both domain repositories and authentication stores now use the shared implementation.
- Repository classes, SQL, transaction ordering, attachment guards, claim behavior, and clock injection remain unchanged.
- Verification passed: TypeScript checks, both production builds, 15 test files, and all 122 tests. `git diff --check` passed with only informational Windows line-ending notices.

### 2026-09-03 - Frontend entrypoint relocation

- Moved the React application and its component test under `src/app/`, and moved the global stylesheet to `src/app/styles/base.css`. Updated entrypoint and relative imports while preserving the existing stylesheet cascade and application behavior.
- The relocated stylesheet matches its original contents apart from the adjacent load-order comment, which now names `base.css`.
- Verification passed: the production build, all 122 unit tests, and the focused 15-test application suite. Full TypeScript verification is recorded after the concurrent server extraction phases complete.

### 2026-09-03 - API shared-boundary extraction

- Extracted API context types, runtime dependency construction, attachment serialization and integrity bridges, and common request, session, response, template, CSV, and queue helpers from the main Hono module.
- Kept all route declarations in `app.ts` in their original order and preserved its Worker-facing compatibility exports. Route paths, response contracts, authorization order, queue behavior, and error handling remain unchanged.
- Verification passed: TypeScript checks, both production builds, 15 test files, and all 122 tests. Route declarations match the pre-extraction list and `git diff --check` passed.

### 2026-09-03 - Core D1 repository extraction

- Moved the user, flow, and template-version D1 adapters into dedicated modules. The existing `d1.ts` facade continues to export their classes and compose the same repository factory.
- Extracted adapter blocks match the prior implementations; SQL, row mapping, JSON fallbacks, and behavior remain unchanged.
- Verification passed: TypeScript checks, both production builds, 15 test files, all 122 tests, and the database-scoped whitespace check.
