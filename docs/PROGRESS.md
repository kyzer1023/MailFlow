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

### 2026-09-03 - Authentication API route extraction

- Moved Microsoft sign-in, the shared Microsoft and OneDrive callback, OneDrive consent start, logout, and `/api/me` registration into a dedicated authentication route module.
- The root Hono application registers the extracted routes at the same position. Composed route order, cookies, response contracts, and permission gates remain unchanged.
- Focused authentication security tests and TypeScript checks passed at the extraction checkpoint. A repository-wide rerun follows the concurrent database and frontend phases.

### 2026-09-03 - Recipient-job D1 repository extraction

- Moved the recipient-job row mapper and repository into a dedicated D1 adapter module and exposed one shared recipient insert-statement builder.
- Campaign creation uses the shared builder while retaining the exact campaign insert, optional attachment association, rollback guard, recipient insertion order, and atomic D1 batch.
- Verification passed: TypeScript checks, both production builds, 15 test files, all 122 tests, and the database-scoped whitespace check.

### 2026-09-03 - Typed frontend helper extraction

- Added typed application state contracts and moved identifier generation, display formatting, view-model mapping, attachment normalization, editor DOM serialization, and validation-review helpers into focused modules under `src/app/`.
- Context providers, hooks, components, editor behavior, and routes remain in the application composition module for later isolated extractions. The new dependency direction remains acyclic.
- Verification passed: TypeScript checks, both production builds, 15 test files, all 122 tests, and the frontend-scoped whitespace check.

### 2026-09-03 - Attachment API route extraction

- Moved attachment-set creation, multipart file upload, and file removal into a dedicated route-registration module while keeping their position immediately after authentication routes.
- Preserved scope-gating order, multipart limits, response contracts, cleanup behavior, and the established OneDrive-only authorization rule on file removal.
- Verification passed: TypeScript checks, both production builds, 15 test files, all 122 tests, exact route-order comparison, and `git diff --check`.

### 2026-09-03 - Campaign D1 repository extraction

- Moved the campaign row mapper and repository into a dedicated D1 adapter module while preserving the `d1.ts` compatibility facade and factory.
- Campaign and recipient insert order, attachment association and rollback guards, lifecycle transitions, exhaustion checks, and state updates remain equivalent to the original implementation.
- Verification passed: exact normalized implementation comparison, TypeScript checks, both production builds, 15 test files, all 122 tests, and the database-scoped whitespace check.

### 2026-09-03 - Flow API route extraction

- Moved flow listing, creation, retrieval, update aliases, and template-version routes into a dedicated route-registration module. Campaign routes remain in the application composition module.
- Preserved route order, ownership and conflict checks, schemas, audit sequence, response shapes, and the paired `PATCH` and `PUT` update behavior.
- Verification passed: TypeScript checks, both production builds, 15 test files, all 122 tests, exact comparison of all 27 composed route declarations, and `git diff --check`.

### 2026-09-03 - Typed frontend session boundary

- Moved session and dashboard loading state into a typed API context, moved sign-out behavior into a dedicated hook, and moved the authenticated product-route guard into its own routing module.
- Preserved the `BrowserRouter`, API provider, draft provider, and route composition order along with existing loading, error, and sign-out behavior.
- Verification passed: TypeScript checks, both production builds, 15 test files, all 122 tests, and `git diff --check`.

### 2026-09-03 - Audit and attachment D1 repository extraction

- Moved audit-event and attachment-set/file D1 adapters into dedicated modules while retaining compatibility exports and composition through `d1.ts`.
- Exact normalized comparisons confirm that SQL, row mappings, ownership checks, conditional batches, cleanup queries, and limits remain unchanged.
- All 122 unit tests and the database-scoped whitespace check passed at this checkpoint. The full typecheck follows completion of a concurrent API extraction.

### 2026-09-03 - Campaign read API extraction

- Moved campaign listing, campaign detail, recipient-job listing, and CSV export into a dedicated route module while keeping campaign creation and mutations in the application composition module.
- Preserved route order, authentication and ownership checks, paging limits, response shapes, CSV headers, and the 10,000-job export bound.
- Verification passed: TypeScript checks, both production builds, 15 test files, all 122 tests, exact comparison of all 27 composed route declarations, and `git diff --check`.

### 2026-09-03 - Authentication D1 store extraction

- Split authentication users, OAuth resource tokens, sessions, and OAuth state into focused D1 store modules while retaining `d1-auth.ts` as the compatibility facade and factory.
- Preserved every SQL statement and mapper, fresh store instances per factory call, the separation between domain and authentication user adapters, and clock injection only for the one-time OAuth state store.
- Verification passed: exact normalized implementation comparisons, focused TypeScript checks, 15 test files, all 122 tests, and the database-scoped whitespace check. A repository-wide typecheck follows completion of a concurrent frontend extraction.

### 2026-09-03 - Typed frontend draft-state boundary

- Moved draft, workbook, mapping, attachment, and campaign state into a typed draft context while preserving state across wizard route navigation.
- Kept upload serialization, cancellation generations, source-file retry references, attachment-set promise reuse, cleanup, and reset behavior together within the provider.
- Verification passed: TypeScript checks, both production builds, 15 test files, all 122 tests, and `git diff --check`.

### 2026-09-03 - Typed frontend shell components

- Moved the brand, navigation sidebar, support footer, application shell, status chip, field wrapper, and dynamic-value chip into typed shared component modules.
- Preserved their markup, classes, icons, active navigation, sign-out behavior, keyboard behavior, and visible copy while leaving route-specific and interactive components for later phases.
- Verification passed: TypeScript checks, both production builds, 15 test files, all 122 tests, and the frontend-scoped whitespace check.

### 2026-09-03 - Campaign creation API extraction

- Moved campaign creation into a dedicated route module and retained its position between campaign listing and campaign detail routes.
- Preserved recipient and template validation, idempotency replay and race handling, attachment authorization and integrity gates, batch creation, lifecycle transition, audit order, and response contracts.
- Verification passed: exact normalized handler comparison, TypeScript checks, both production builds, 15 test files, all 122 tests, exact comparison of all 27 composed route declarations, and `git diff --check`.

### 2026-09-03 - Typed frontend overview components

- Moved reusable flow cards, campaign tables, and flow actions into typed component and hook modules used by the dashboard and library routes.
- Preserved loading and confirmation states, navigation, saved-flow hydration and reset, API mutations, dashboard refreshes, markup, classes, icons, and copy.
- Verification passed: TypeScript checks, both production builds, 15 test files, all 122 tests, and `git diff --check`.

### 2026-09-03 - Campaign mutation API extraction

- Moved campaign test-send, start, pause, and resume routes with their shared start helper into a dedicated mutation module.
- Preserved session and acknowledgement checks, provider and attachment gates, conditional transitions, queue handling, cleanup, audit order, provider result handling, and response contracts.
- Verification passed: normalized implementation comparisons, TypeScript checks, both production builds, 15 test files, all 122 tests, exact comparison of all 27 composed route declarations, and `git diff --check`.

### 2026-09-03 - Frontend stylesheet decomposition

- Replaced the large base stylesheet with focused token, global, landing, shell, overview, wizard, data, recipient, review, campaign, and responsive files behind one ordered stylesheet entrypoint.
- Preserved the exact active declaration order and kept the existing wizard, campaign, and visual-polish override layers last in the cascade. Confirmed every retained class token is referenced by current source.
- Verification passed: normalized declaration and order comparison, both production builds, 15 test files, all 122 tests, and `git diff --check`. A repository-wide typecheck follows completion of a concurrent component extraction.

### 2026-09-03 - Worker runtime extraction

- Moved queue-batch processing and scheduled attachment cleanup into a dedicated Worker runtime module while keeping compatibility re-exports from the API composition module.
- Preserved malformed-message acknowledgement before lazy service initialization, shared services for valid batch messages, retry and acknowledgement behavior, cleanup, errors, and Worker-facing signatures.
- Verification passed: exact runtime implementation and export comparisons, both production builds, 15 test files, all 122 tests, exact comparison of all 27 composed route declarations, and `git diff --check`. A repository-wide typecheck follows completion of a concurrent component extraction.

### 2026-09-03 - Typed frontend wizard components

- Moved the wizard stepper and shell, token-aware message editor, recipient address-rule field, and attachment picker into typed component modules.
- Preserved the editor ref contract and selection behavior, source mode and sanitization, fixed and dynamic address modes, attachment upload/retry/removal, accessibility attributes, markup, classes, icons, and copy.
- Verification passed: TypeScript checks, both production builds, 15 test files, all 122 tests, and `git diff --check`.

### 2026-09-03 - Typed public and overview routes

- Moved the landing page, dashboard, flow library, and campaign history into typed route modules while leaving the central application route table as the composition boundary.
- Preserved session and API behavior, navigation, flow confirmation states, loading, empty and error rendering, markup, classes, icons, links, and visible copy.
- Verification passed: TypeScript checks, both production builds, 15 test files, all 122 tests, and `git diff --check`.

### 2026-09-03 - Typed Data and Template routes

- Moved the Data step plus new and existing flow Template editors into typed route modules.
- Preserved browser-side workbook parsing, sheet and header selection, column mapping, validation, token-editor refs, create/update behavior, navigation, loading and error states, accessibility attributes, markup, classes, icons, and copy.
- Verification passed: TypeScript checks, both production builds, 15 test files, all 122 tests, and `git diff --check`.

### 2026-09-03 - Typed Recipients and Review routes

- Moved recipient rule configuration, campaign review, and campaign creation orchestration into typed route and hook modules.
- Preserved fixed and dynamic address rules, importance defaults, validation issue order and actions, attachment readiness, request-key idempotency, test-send and start acknowledgements, navigation, loading and error states, accessibility, markup, classes, icons, and copy.
- Verification passed: TypeScript checks, both production builds, 15 test files, all 122 tests, and `git diff --check`.

### 2026-09-03 - Typed Campaign monitor route

- Moved the campaign monitor into a typed route module, leaving the root application file responsible only for providers, protection, and route composition.
- Preserved polling and cancellation, campaign and job rendering, status controls, pause, resume, export and copy actions, loading, error and empty states, accessibility, markup, classes, icons, and copy.
- Verification passed: TypeScript checks, both production builds, 15 test files, all 122 tests, and `git diff --check`.

### 2026-09-03 - Typed frontend composition boundary

- Converted the root application file to TypeScript after reducing it to provider, route-protection, and route-table composition.
- Preserved provider and route order exactly. The reachable frontend graph now contains 51 code modules and 157 resolved import edges with no cycles, unresolved relative imports, stale `App.jsx` or `base.css` references, or old inline component definitions.
- Verification passed: TypeScript checks, both production builds, 15 test files, all 122 tests, and `git diff --check`.

### 2026-09-03 - Repository cleanup and refactor verification

- Completed the approved cleanup of obsolete build, browser-QA, Wrangler trace, fixture, artwork, documentation, and merged-worktree artifacts. The previously locked empty worktree directory is now removed; development dependencies, secrets, and local D1 state remain intact.
- Final verification passed: `npm test` (TypeScript, both production builds, 15 test files, all 122 tests), `wrangler deploy --dry-run`, local D1 migration status with no pending migrations, and `git diff --check`.
- Chrome regression checks passed at 1440×900, 1024×768, and 390×844 across landing, dashboard, flow library, campaign history, all four wizard routes, a saved template editor, and a completed campaign monitor. No document overflow or browser console warnings appeared. Dashboard-to-wizard navigation and visual/source editor switching also passed.
- Removed the generated `dist/` directory again after validation so the checkout remains free of reproducible build output.

### 2026-09-04 - Isolated staging deployment foundation

- Provisioned the isolated APAC D1 database `mailflow-staging-db`, campaign Queue `mailflow-staging-campaign-ticks`, and dead-letter Queue `mailflow-staging-campaign-ticks-dlq`. No production D1, Queue, or Worker binding was changed.
- Added the Wrangler `staging` environment for `mailflow-staging` at `https://mailflow-staging.kyzer-hono-test.workers.dev`, with staging-specific D1, Queue, SMTP, pace 12, maximum 300, exact public origin, and a staging attachment-object namespace. R2 remains absent.
- Applied migrations `0001` through `0005` to staging only. A second remote migration listing reported no pending staging migrations.
- Added the staging Web callback to the existing single-tenant Entra application while preserving the localhost and production callbacks. Appended a separate 90-day staging credential without resetting or deleting the production credential.
- Stored independent staging `ENTRA_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY_B64`, and `SESSION_SECRET` values only in Cloudflare Worker secret storage. Secret values were piped directly, were not rendered or persisted, and the transient clipboard used for the portal-created credential was cleared immediately.
- Added a manual, serialized, exact-commit staging deployment workflow plus cross-platform staging build, migration, check, and deploy scripts. The workflow runs green checks before staging migration and deployment and never deploys production.
- Verification passed at `2026-09-04 20:09 MYT`: TypeScript, both production builds, 16 test files, all 125 tests, production Wrangler dry run, staging build and Wrangler dry run, staging secret-name listing, migration status, and `git diff --check`. Existing dependency-comment and client chunk-size warnings remain.
- Deployed candidate commit `7b280eacb7fada972aa2bb3cd829472bfbc28332` to the stable staging origin. Initial Worker version `ea654ea1-75d6-4987-ab9b-4acf65a56859` registered fetch, Queue, and scheduled handlers; the current secret-only version retains the same script etag and all expected bindings.
- Hosted smoke checks passed: landing `200 text/html`, both hashed assets `200`, unauthenticated `/api/me` `401 application/json`, unknown API `404 application/json`, and Microsoft authorization `302` using the USM tenant, exact staging callback, delegated `SMTP.Send`, and sealed state. Chrome rendered the public landing and sign-in controls without following the sign-in link.
- Remote binding checks confirmed the staging Queue has `mailflow-staging` as its single consumer with batch size 1, three retries, and `mailflow-staging-campaign-ticks-dlq` as its dead-letter Queue. The hourly schedule is active, all migrations remain applied, and the deployed binding list contains no R2 resource.
- Removed the two short-lived OAuth-state rows created by redirect smoke probes. Staging remains empty with zero OAuth states, users, flows, campaigns, recipient jobs, attachment sets, and audit events.
- Added a credential-free GitHub verification workflow for pull requests and main. It runs the same tests, production dry run, staging build, and staging dry run without deploying either environment.
- The legacy account-side `Workers Builds: mailflow` pull-request check remains pointed at the deleted `apps/mailflow` root and fails before executing a build command. This staging workstream did not change that production-owned build trigger because doing so could restore automatic production deployments, which are explicitly out of scope. The repository-native verification workflow is the authoritative PR check until the production trigger is separately reviewed or retired.
- No user sign-in, OneDrive consent, test-send, campaign, real recipient, message body, or production deployment was used for this checkpoint.

### 2026-09-04 - Self-only test sends and public endpoint controls

- Made the Worker authoritative for test-send content and routing: it loads the reviewed persisted recipient snapshot, preserves its sanitized subject, HTML, importance, and attachment set, replaces `To` with the authenticated mailbox, and suppresses CC, BCC, and Reply-To again at both Graph and SMTP provider boundaries.
- Added dedicated D1 test-send idempotency and rate-counter records. Exact accepted and ambiguous-terminal replays cannot call Microsoft twice; failures proven to occur before submission can retry with the stable key. Test-send audit events never create or reference recipient jobs.
- Added five-per-user test-send limiting, privacy-preserving anonymous OAuth-start limits of 20 per client and 200 globally per 10 minutes, plus bounded multi-batch hourly cleanup for OAuth state, sessions, counters, and abandoned claims.
- Updated Review to keep original resolved campaign headers visible while clearly explaining the test-only recipient substitutions. Visual checks passed at 1440 x 900, 390 x 844, and the available medium-width browser workspace; the narrow view had no horizontal overflow or console errors.
- Verification passed: fresh local D1 migration state with all six migrations applied and none pending, `npm test` with TypeScript, both production builds, 17 test files and all 131 tests, `wrangler deploy --dry-run`, and `git diff --check`. The required independent security review confirmed the self-only envelope invariant and its two identified edge cases were corrected before this checkpoint.

### 2026-09-04 - Chained homepage OneDrive authorization

- Extended SMTP homepage sign-in into two resource-specific OAuth legs: primary `SMTP.Send` authorization establishes the MailFlow session, then a missing `Files.ReadWrite.AppFolder` grant starts immediately with its own state, PKCE verifier, nonce, and encrypted token record. The second request omits `prompt` so Microsoft can reuse the active session without forcing credential entry.
- Preserved tenant and object identity binding for the OneDrive callback. Existing OneDrive grants, Graph mode, unavailable attachment or storage authorization, and unsafe `/auth` return targets skip or fall back without loops.
- OneDrive success, cancellation, provider failure, invalid state, and identity mismatch return to a validated local app destination with a visible status. Cancellation and failure retain the primary application session, and the Recipients action remains available for recovery and legacy sessions.
- Verification passed: `npm test` with TypeScript, both production builds, 18 test files and all 135 tests; `wrangler deploy --dry-run`; local D1 migrations with none pending; and `git diff --check`. No production deployment or PR #3 infrastructure changes were made.

### 2026-09-04 - PR #2 staging-foundation rebase verification

- Rebased the self-only test-send controls and chained OneDrive onboarding commits onto staging-foundation merge `ca3cf98d9475fa424e286f602c7d83957b98adaf`. Conflict resolution preserved the isolated staging Worker, D1, Queue, dead-letter Queue, attachment namespace, workflows, and documentation while retaining every PR #2 behavior.
- Verification passed on the rebased tree: clean `npm ci`; `npm test` with TypeScript, both production builds, 19 test files and all 138 tests; production Wrangler dry run; staging-specific build and Wrangler dry run; local D1 migration status with none pending; and `git diff --check`.
- No production deployment, mail submission, campaign creation, or PR merge occurred during this checkpoint. Staging migration and deployment evidence is recorded separately after the exact rebased head is hosted.

### 2026-09-04 - Review action feedback hardening

- Added explicit pending, accepted, replayed, and failure feedback for Review test sends, plus a pending and recoverable failure cycle for campaign start. Both actions now use a synchronous shared lock so rapid activation cannot duplicate a request and either pending action disables the other.
- Made accepted test sends visibly complete, report replay responses without implying a new message was sent, and expose pending and failure copy through one atomic live status region. Safe test failures remain manually retryable, while the existing durable idempotency control keeps ambiguous outcomes terminal under the same request key.
- Preserved the approved Review layout, warm paper, moss, and coral palette, Phosphor icons, and existing control shapes. Added stable action widths, clean wrapping at narrow breakpoints, reduced-motion compatibility, and Review-specific AA text contrast without adding a dependency.
- Verification passed: `npm run check:staging` with TypeScript, both production builds, 20 test files and all 142 tests, production and staging Wrangler dry runs; local and remote staging D1 migration listings with none pending; and `git diff --check`.
- Local browser QA passed at 1440 x 900, 1024 x 900, and 390 x 844 with no horizontal overflow. Idle, test pending, test accepted, test replayed, start pending, and failed-start retry states were inspected using intercepted local responses. Keyboard focus, reduced motion, cross-action locking, stable labels, and measured AA contrast passed. No external mail, campaign, Microsoft OAuth, or production operation was performed.

### 2026-09-05 - Authoritative mailbox scheduling and crash recovery

- Added forward-only migration `0007_mailbox_scheduler_recovery.sql` with D1-authoritative mailbox leases, delivery-attempt reservations, provider-boundary state, rolling-budget expiry, campaign scheduler status, and one effective durable wake token per campaign.
- Enforced an 8,000 envelope-recipient rolling 24-hour budget per authenticated mailbox across campaigns and self-only test sends. To, every CC entry, every BCC entry, and repeated occurrences count; accepted and unknown outcomes remain charged, while only provider-proven no-send and stale pre-boundary work release their reservations.
- Serialized campaign and test-send provider calls through the shared mailbox lease, propagated the later of mailbox pace and Microsoft Retry-After, kept budget-blocked recipients pending with the exact earliest release time, and made duplicate Queue messages conditional no-ops.
- Extended the hourly scheduled handler with bounded, idempotent reconciliation for stale claimed work, stale provider-bound work, expired classified leases, lost wakes, and exhausted campaigns. Unknown outcomes never return to pending.
- Added a minimal campaign monitor notice with a safe waiting reason, next-check time, and explicit unknown-outcome warning. The public campaign contract strips wake tokens and due times.
- Added official Cloudflare D1 transaction and Queue delay documentation plus Microsoft Exchange Online rolling recipient-limit documentation to the architecture and ADR.
- Verification passed: `npm run check:staging` completed TypeScript, both production builds, 21 test files with all 157 tests, the production Wrangler dry run, a staging-specific build, and the staging Wrangler dry run. Existing dependency-comment and client chunk-size warnings remain non-blocking.
- A fresh isolated local Wrangler D1 state applied migrations `0001` through `0007`; schema inspection found all three mailbox tables and confirmed `delivery_attempts.test_send_id` has no cascade foreign key, preserving accepted and unknown budget entries beyond short-lived test-send control rows. Focused mailbox, Queue, and test-send runs passed all 25 tests, including D1 conditional races, duplicates, exact rolling releases, accepted and unknown charging, proven no-send release, Retry-After ordering, crash boundaries, watchdog idempotency, and lost ticks.
- Local Playwright QA passed at 1440 x 1000 and 390 x 844 using intercepted synthetic campaign data. The waiting notice, next-check date, safe status, and recovery warning remained readable with zero console errors. No Microsoft authorization, mail submission, campaign creation, production deployment, or production data access occurred.
- Marked the SQLite-backed repository test for Vitest's Node environment after GitHub Actions exposed Linux client-bundling of the built-in `node:sqlite` module. The focused 10-test repository suite and the full 21-file, 157-test suite pass with the portable test configuration.
- 2026-09-05: Scheduler notices now present exact retry and pacing timestamps in `Asia/Kuala_Lumpur` as readable Malaysia time with an explicit GMT+8 label. The campaign UI also converts ISO timestamps already stored by earlier staging deployments. `npm run check:staging` passed all 21 test files and 157 tests, both builds, production and isolated-staging Wrangler dry runs, and the staging-target validation guard.

### 2026-09-05 - Staging release and deployment-target guard

- Confirmed staging D1 had migration `0007` applied with no pending migrations, then deployed the exact reviewed candidate to `mailflow-staging`. Hosted smoke checks passed for the landing page, hashed assets, unauthenticated API response, unknown read and write routes, mailbox coordination tables, Queue producer and consumer, and hourly schedule. No sign-in or mail action ran.
- A mutable Cloudflare Vite redirected config was replaced by a production build in the shared worktree during a later staging redeploy command, which caused the candidate Worker to be published briefly to production. No production migration or data command ran. Production was immediately restored to its prior Worker version `36c726b0-c2bc-4cf2-8880-87a56ebfbcd9`, and Cloudflare deployment status confirmed that version again received 100 percent of production traffic.
- Added a fail-closed staging config preparation step that validates the Worker name, public origin, D1 database, and Queue before freezing a separate generated config snapshot. Local scripts and the manual staging workflow now dry-run and deploy only that validated snapshot, so a later production build cannot retarget the staging deploy command.
- Staging retained two pre-existing completed campaigns and ten accepted terminal jobs. Read-only checks confirmed zero runnable campaigns, zero active wake tokens, and zero delivery attempts; no historical staging data was changed.

### 2026-09-05 - Complete recipient-job visibility

- Removed the campaign monitor's fixed five-row display cap. The page now requests the API's 500-row maximum, which covers the product's 300-recipient campaign limit, and renders every returned recipient job in source-row order.
- Replaced the misleading partial-range footer with an explicit all-jobs-visible confirmation while preserving the approved campaign layout, status language, sticky recipient column, and responsive horizontal table scrolling.
- Added a 108-recipient component regression that verifies the final row is rendered, all 108 body rows are present, and the full API page size is requested.
- Verification passed: `npm test` completed TypeScript, both production builds, 21 test files and all 158 tests; `git diff --check` passed with only informational Windows line-ending notices.
- Local Playwright QA passed with intercepted synthetic campaign data at 1440 x 900 and 390 x 844. Rows 1 through 108 and the final visibility confirmation were reachable, the mobile page had no document-level horizontal overflow, and the browser reported zero console errors or warnings. No Microsoft authorization, mail submission, campaign creation, production deployment, or production data access occurred.

### 2026-09-05 - Complete recipient-job visibility production release

- Pushed commit `b0121f5` to `origin/main` after `npm ci` and the full `npm run check:staging` release gate passed with 21 test files and all 158 tests, production and staging builds, the production dry run, and the validated staging-isolation dry run.
- Applied committed production D1 migrations `0006_public_endpoint_controls.sql` and `0007_mailbox_scheduler_recovery.sql`. A second remote migration listing reported no pending migrations.
- Deployed production Worker version `e0248ac1-dec0-4be8-bc50-3f172f448dab` to `https://mailflow.kyzer-hono-test.workers.dev` with the existing production D1, Queue producer and consumer, static assets, SMTP configuration, and hourly schedule.
- Non-sending hosted smoke checks passed: landing `200 text/html`, the newly built JavaScript asset `200 text/javascript`, unauthenticated `/api/me` `401 application/json`, and an unknown API route `404 application/json`. Deployment status confirmed the new version receives 100 percent of production traffic.
- No Microsoft authorization, test-send, campaign creation, real mail, recipient contact, or production campaign-data mutation was performed.

### 2026-09-05 - Fixed-height recipient pagination

- Replaced the unbounded recipient-job table with nine-row client-side pages while retaining the API's 500-row fetch, so every job remains reachable without allowing the campaign monitor to grow indefinitely.
- Added explicit visible-range and page-count feedback plus keyboard-accessible Previous and Next controls with disabled boundary states.
- Matched the desktop Recipient Jobs panel to the complete right-hand audit column height. Below the desktop breakpoint, the existing stacked responsive layout keeps its natural content height.
- Expanded the 108-recipient component regression to verify the first, second, and final pages, including row 108 and both pagination boundaries. `npm test` passed TypeScript, both production builds, 21 test files, and all 158 tests; `git diff --check` also passed.
- Local in-app browser QA passed at the 1909 by 911 reference viewport using synthetic local campaign data. The Recipient Jobs panel and audit column measured the same 633.58 px height, keyboard pagination advanced from rows 1-9 to 10-18, and the narrower layout stacked without clipping. No Microsoft authorization, mail submission, campaign creation, deployment, or production data access occurred.
- Refined the pagination controls to compact arrow-only buttons while retaining descriptive accessible names, native hover titles, disabled boundary states, and 40 px targets.

### 2026-09-05 - Recipient pagination production release

- Removed the temporary project-root design QA report and confirmed no `qa-*` fixture files remained before release.
- Pushed application commit `0aa0fa4` to `origin/main` after a clean `npm ci` and `npm run check:staging` passed all 158 tests, the production build and dry run, and the isolated staging build and dry run.
- Confirmed production D1 had no pending migrations, then deployed production Worker version `777de2ab-8eed-480b-8b61-d58e17a49ff9` to `https://mailflow.kyzer-hono-test.workers.dev` with the existing production D1, Queue producer and consumer, static assets, SMTP configuration, and hourly schedule.
- Non-sending hosted smoke checks passed: landing `200 text/html`, the new JavaScript asset `200 text/javascript`, the new stylesheet `200 text/css`, unauthenticated `/api/me` `401 application/json`, and an unknown API route `404 application/json`. Deployment status confirmed the new version receives 100 percent of production traffic.
- No Microsoft authorization, test-send, campaign creation, real mail, recipient contact, or production campaign-data mutation was performed.

### 2026-09-05 - Campaign payload and D1 creation safeguards

- Reconciled the original campaign hardening category against current main and left the landed mailbox scheduler, rolling 8,000-recipient budget, recovery paths, and recipient-results UI work unchanged.
- Added an 8 MiB streaming read limit for campaign-create JSON before buffering or parsing, bounded mapping counts and per-recipient snapshots below D1's 2 MB string and row ceiling, and rejected non-minimal or oversized Queue tick objects. Queue messages remain limited to the tick type, opaque campaign ID, and opaque wake token.
- Added a server-calculated normalized campaign request fingerprint. Exact replays and concurrent races return the original campaign, changed-content key reuse returns a stable conflict, and pre-migration campaigns retain their legacy attachment-set replay check.
- Reworked campaign creation into one D1 batch that inserts a draft campaign, optional guarded attachment association, bounded JSON recipient chunks, exact-count validation transition, and creation audit events. The externally visible campaign appears atomically as validated; a failed chunk, attachment race, incomplete row set, or audit insert rolls back the full creation.
- Added forward-only migration `0008_campaign_create_safeguards.sql` with owner, sender, active-flow, template, totals, fingerprint, initial-state, JSON shape/count/size, exact-recipient-count, and immutable-snapshot enforcement. Legacy campaign rows remain readable with a null fingerprint.
- Added migration and repository coverage for legacy upgrade, the full 300-row product limit, multi-chunk inserts, transaction rollback, attachment races, ownership and sender bypasses, incomplete campaigns, invalid JSON, and snapshot immutability. Campaign payload tests cover normalized fingerprints, changed-content conflicts, and pre-parse body rejection.
- Verification passed after rebasing onto current `origin/main`: `npm run check:staging` completed TypeScript, both production builds, 23 test files with all 169 tests, the production Wrangler dry run, staging-specific build, staging-target validation guard, and staging Wrangler dry run. Existing dependency-comment and client chunk-size warnings remain non-blocking.
- A fresh isolated Wrangler-local D1 applied migrations `0001` through `0008` and then reported no pending migrations. `git diff --check` passed with only informational Windows line-ending notices. No staging or production deployment, remote migration, OAuth action, campaign creation, attachment operation, or mail submission was performed.

### 2026-09-05 - Campaign safeguard staging verification

- Rebased the campaign-safeguard branch onto production commit `2aa4066`. The only conflict was the append-only progress log; campaign, D1, Queue, and recipient-pagination code required no manual merge.
- The first exact-candidate staging run stopped before deployment when Cloudflare D1's remote migration splitter rejected unparenthesized `CASE ... END` expressions inside triggers with `incomplete input`. The failed migration was atomic: `0008` remained pending, the fingerprint column was absent, no new triggers existed, and staging data was unchanged.
- Parenthesized every trigger `CASE` expression and added `.gitattributes` enforcement for LF-only migration files. Focused campaign and migration tests passed, followed by `npm run check:staging` with 23 test files and all 169 tests, both builds, both Wrangler dry runs, and the staging-isolation guard.
- GitHub Verify and Cloudflare Workers Builds passed candidate `e999a61`. Exact-candidate staging workflow run `33909791395` then applied `0008` and deployed Worker version `c69e9456-b7c2-4939-b078-a47cf206adf5` with 100 percent staging traffic.
- Post-deployment read-only checks confirmed no pending staging migrations, one `request_fingerprint` column, all five campaign and recipient snapshot triggers, landing page `200 text/html`, unauthenticated `/api/me` `401`, and an unknown API route `404`. No Microsoft authorization, campaign creation, attachment operation, recipient contact, or mail submission occurred.

### 2026-09-05 - Attachment execution resilience

- Reconciled the deployed OneDrive and SMTP attachment path against the approved hardening plan without changing campaign-create batching, D1 mailbox scheduling, the rolling recipient budget, or recipient UI contracts. No migration or cross-workstream PR dependency was required.
- Classified OneDrive throttles, service outages, network failures, and interrupted downloads as transient pre-submission failures. Queue processing now keeps the row unclaimed, consumes no mailbox budget, records an attachment-waiting audit event, and reserves one guarded delayed wake. Start and test-send paths remain safely retryable before any provider call.
- Made deleted OneDrive files and changed byte count or SHA-256 content explicit permanent failures for an immutable attachment set. Set-level counts and totals are verified before any object read, and every download is streamed only to its reviewed per-file bound.
- Aligned SMTP MIME with the product's five-file and 20 MiB limits, chunked both HTML and attachment base64 writes to at most 80 KiB, and derived stable hashed MIME identity for proven pre-submission retries without treating it as provider idempotency.
- Bounded cleanup to five object deletes per set and two eligible sets per scheduled invocation. Partial OneDrive or D1 failures and truncated App Folder listings retain active metadata for an idempotent later pass.
- Focused verification covered OneDrive deletion after redirect, changed and oversized content, Graph throttle and network classification, metadata bounds, MIME limits and chunk sizes, retry identity, pre-claim transient recovery, permanent integrity failure, and multi-pass cleanup.
- Rebasing onto the latest `main` preserved the parallel recipient-job visibility work without overlap. Verification passed after the rebase: `npm ci`; the focused attachment, OneDrive, SMTP, and Queue run with 4 files and 40 tests; `npm run check:staging` with TypeScript, both production builds, all 21 test files and 168 tests, the production Wrangler dry run, the isolated staging build and validated staging Wrangler dry run; and `git diff --check`. Existing dependency-comment and client chunk-size warnings remain non-blocking. No migration, staging deployment, OAuth action, OneDrive write, mail submission, campaign creation, or production operation was performed.

### 2026-09-05 - Attachment resilience staging deployment

- Deployed exact runtime candidate `920d48c749620d39ea166abae185e8f954c6f83a` through the validated staging-only workflow to `mailflow-staging` at `https://mailflow-staging.kyzer-hono-test.workers.dev`. Cloudflare deployment status reports Worker version `4e2a9a47-bfec-482a-8087-ca830e83feac` receiving 100 percent of staging traffic.
- The release gate passed TypeScript, both production builds, all 21 test files and 168 tests, the production Wrangler dry run, and the isolated staging build and validated staging Wrangler dry run. Staging D1 reported no pending migrations.
- Hosted non-sending checks passed: landing `200 text/html`, the current hashed JavaScript asset `200 text/javascript`, unauthenticated `/api/me` `401 application/json`, and unknown API reads and writes `404 application/json` without app-shell fallback.
- Remote resource checks confirmed the staging Queue retains `mailflow-staging` as its only producer and consumer, and the deployed Worker retains its hourly schedule, staging D1, staging attachment namespace, and no R2 binding.
- Read-only D1 checks found four completed campaigns, 20 accepted recipient jobs, ten accepted delivery-attempt records, zero active wake tokens, three deleted attachment sets, and one unbound open attachment set with one active file that remains inside its expiry window for scheduled cleanup. No staging record was changed.
- No Microsoft authorization, test-send, campaign start, OneDrive write or deletion, mail submission, recipient contact, production deployment, or production data operation was performed.

### 2026-09-05 - Campaign and attachment hardening production release

- Merged campaign payload and D1 safeguards as `dd3eb83`, rebased attachment resilience onto that contract, and merged the combined result as `605511a`. Post-merge GitHub Verify and Cloudflare Workers Builds both passed.
- Ran `npm run check:staging` from exact production commit `605511a`; TypeScript, both production builds, all 23 test files and 179 tests, the production Wrangler dry run, the isolated staging build, target validation, and the staging Wrangler dry run passed.
- Confirmed `0008_campaign_create_safeguards.sql` was the only pending production migration, applied it successfully, and verified no migrations remained. Read-only schema checks confirmed the request fingerprint column and all five campaign and recipient snapshot triggers.
- Deployed production Worker version `acf425e2-7da0-495d-a120-b30e471800ad` with release message `Production main 605511ab9f3cf6bbc19577152e3a7e1c04161473`; deployment status reports 100 percent production traffic with the production D1, Queue producer and consumer, SMTP configuration, static assets, and hourly schedule.
- Non-sending hosted smoke checks passed: landing `200 text/html`, the current hashed JavaScript asset `200 text/javascript`, unauthenticated `/api/me` `401 application/json`, and unknown API reads and writes `404 application/json` without app-shell fallback.
- No Microsoft authorization, campaign creation, attachment operation, mail submission, recipient contact, or production campaign-data mutation was performed during promotion.

### 2026-09-05 - Resilient preclaim attachment failure recovery

- Added forward-only migration `0009_attachment_failure_recovery.sql` with sanitized attachment issue state and a durable retry ordinal on campaigns. Updated the architecture, accepted ADR, use cases, implementation gate, operations runbook, and testing contract before finalizing the implementation.
- Classified OneDrive attachment-load failures before recipient claim. Network errors, Graph `429`, and Graph `5xx` retain attachment sets and untouched recipient rows, then use 30-second exponential retry through a 15-minute cap while honoring longer provider `Retry-After` values up to the 24-hour Queue limit. Authorization failures pause with a same-account OneDrive reconnect path. Missing, deleted, size-mismatched, checksum-mismatched, and unknown storage failures stop the campaign before another claim and request terminal cleanup.
- Resume now revalidates the same immutable attachment set before the conditional paused-to-running transition. The existing D1 claim predicate resumes from pending rows only; accepted, failed, skipped, and unknown rows remain terminal. Audit evidence stores only the allowlisted failure category, disposition, retry ordinal, and next-attempt timestamp.
- Corrected campaign history and detail UX so a campaign-level failure is distinct from recipient failure. Failed campaigns separately show accepted, recipient-failed, unknown, skipped, and not-sent counts; pending rows read `Not sent`; terminal screens remove time-remaining promises and unusable pause controls. Authorization-paused campaigns expose OneDrive reconnect and `Resume pending rows` guidance.
- Refined the user-reported failure-header spacing with centralized 16 px notice separation, 14 px identity-grid spacing, and a 20 px exit gap before the result route. In-app browser QA at `1105 x 900` used synthetic local-only data, compared the approved campaign mock and supplied failure crop with the revised capture, and passed with no remaining P0/P1/P2 finding. The temporary QA route, fixture data, report, and screenshots were removed before release.
- Pre-merge verification passed at `2026-09-05 03:26 MYT`: the focused attachment, queue, D1, and UI run passed 5 files and 62 tests; `npm run check:staging` passed TypeScript, both production builds, all 22 test files and 181 tests, the production Wrangler dry run, the staging build, staging target validation, and the isolated staging Wrangler dry run. Local D1 reported no pending migrations for that candidate; `git diff --check` reported only informational Windows line-ending notices.
- No Microsoft authorization, OneDrive write, test-send, campaign start or resume, real email, remote migration, staging deployment, production deployment, or existing campaign mutation was performed.

### 2026-09-05 - Attachment failure recovery production release

- Removed the temporary design QA report, screenshots, route, and fixture references before release. Rebased the recovery work onto current `main`, preserving the campaign-create, bounded-download, cleanup, mailbox scheduler, and rolling-recipient safeguards, then fast-forwarded and pushed exact runtime commit `1d357d728d48e92d94ffe00d33d38c685f43574f` to `origin/main`.
- Ran a clean `npm ci` and `npm run check:staging` from the merged production candidate. TypeScript, both production builds, all 24 test files and 198 tests, the production Wrangler dry run, staging-specific build, staging-target validation, and isolated staging Wrangler dry run passed. Existing dependency-comment and client chunk-size warnings remain non-blocking.
- Confirmed `0009_attachment_failure_recovery.sql` was the only pending production migration, applied it successfully, and verified no remote migrations remained.
- Deployed production Worker version `b84f9b93-b3c7-4cd9-b0d2-b4249106904d` with release message `Production main 1d357d728d48e92d94ffe00d33d38c685f43574f`; deployment status reports 100 percent production traffic with the production D1, Queue producer and consumer, SMTP configuration, static assets, and hourly schedule.
- Non-sending hosted smoke checks passed: landing `200 text/html`, current hashed JavaScript `200 text/javascript`, current stylesheet `200 text/css`, unauthenticated `/api/me` `401 application/json`, and unknown API reads and writes `404 application/json` without app-shell fallback.
- No Microsoft authorization, test-send, campaign creation, campaign start or resume, OneDrive write or deletion, mail submission, recipient contact, or production campaign-data mutation was performed during promotion.

### 2026-09-05 - Input boundaries and final release verification

- Reconciled base `7e14f4c` against the approved remaining-gap list; PRs 5 and 6 and the completed scheduler, budget, pagination, self-only tests, chained authorization, and no-R2 staging architecture remain intact.
- Removed legacy DOC/XLS/PPT uploads, shared browser/Worker attachment validation, checked signatures and Office package subtype, and retained five files / 20 MiB. Added bounded strict CSV/XLSX imports, mailbox validation, own-property dynamic lookups, streamed JSON/multipart limits, HTML event-attribute rejection, and safe persistence errors.
- `npm ci`, focused regression tests, and `npm run check:staging` pass: TypeScript, production builds, 26 test files / 192 tests, production dry run, isolated staging build/guard/dry run. `git diff --check` passes. Existing dependency-comment and client bundle warnings remain non-blocking.
- Fresh isolated local D1 applied all eight migrations and reports no pending migrations. Read-only production/staging migration lists also report none. Read-only Entra configuration confirms single-tenant delegated-only registration and three Web callbacks. Staging Queue and secret-name checks pass.
- Local in-app browser displayed the signed-out landing page; component tests verify signature failures occur before any attachment-set request or upload. Full release findings, scope reconciliation, and remaining manual checks are in `docs/RELEASE_AUDIT.md`.
- No Microsoft authorization, campaign creation, OneDrive write/delete, mail send, or production deployment occurred. The PR's exact-SHA staging workflow and non-sending hosted results will be recorded with the PR after the candidate is committed.

- Rebased onto concurrent main `efa001f`, preserving attachment failure recovery and migration 0009. Resolved only the append-only progress log and shared AttachmentError export, retaining every new recovery category. The post-rebase `npm run check:staging` passes 27 files / 211 tests and both deployment dry runs. Isolated local D1 now has all nine migrations; staging has only 0009 pending for the authorized manual workflow. The moderate transitive uuid advisory has no demonstrated affected ExcelJS call path and is recorded as non-blocking in the audit.
### 2026-09-05 - Code organization and maintainability review

- Reviewed application routing and draft state, browser parsing and validation, API orchestration, authentication and mail adapters, D1 repositories, Queue recovery, styling organization, and CI configuration. The layered architecture and backend state safeguards are sound foundations; frontend lifecycle consistency and readability need focused work.
- Confirmed two frontend contract defects with temporary isolated tests using the real DraftProvider and useEnsureCampaign hook: editing a draft after campaign creation returns the old campaign snapshot, and retrying a lost creation response generates a different template version and campaign fingerprint under the same idempotency key. The probes reproduced both conditions without contacting a provider and were removed after verification. These findings are not fixed.
- Additional maintainability observations: dashboard loading fans out to one detail request per campaign; validation primitives are duplicated between client and domain; dense JSX and scattered CSS values impede review; the initial client bundle remains large; the top-level API error handler discards diagnostic context.
- Verification: `npm test` passed TypeScript, both production builds, and all 179 tests across 23 files. `npx vitest run src/app/hooks/code-review.probe.test.tsx` passed both temporary reproduction checks. The client build emitted a 1,434.12 kB JavaScript bundle (416.44 kB gzip) and the existing chunk-size and dependency-comment warnings. Application source is unchanged. No deployment, remote data operation, or real-mail check ran for this review.

### 2026-09-05 - PR 7 review and merge

- Reviewed all 28 changed files in PR #7 at `954eaeda557996b4326639752269cf00a1a6ed5b` against `efa001f`, including shared attachment policy, browser imports, own-property rendering, mailbox validation, bounded API streams, error redaction, and compatibility with existing immutable attachments and recovery categories. No merge-blocking regression was identified in this diff. The separate draft lifecycle defects recorded above remain outside this PR.
- Independently ran `npm ci` and `npm run check:staging` in an isolated checkout: TypeScript, production client/Worker builds, all 27 test files and 211 tests, production Wrangler dry run, staging build, staging configuration guard, and staging Wrangler dry run passed. `git diff origin/main HEAD --check` passed before merge. Existing dependency-comment and client chunk-size warnings remain.
- Started the isolated local server and opened the signed-out landing page in the in-app browser. HTTP smoke checks returned landing 200 HTML, unauthenticated `/api/me` 401 JSON, and unknown API GET/POST 404 JSON. Existing PR checks and manual staging workflow were successful; no review threads or requested changes were present.
- Under the user's explicit review-and-merge authorization, merged exact PR head `954eaeda557996b4326639752269cf00a1a6ed5b` into GitHub `main` with merge commit `726e07e2ee18649f0e10c772e8fdd7b3d00bfc1e` at 2026-09-05 03:56 MYT. GitHub confirms PR #7 is MERGED. Preserved pre-existing uncommitted progress notes and left the shared checkout's branch and application files unchanged.
- This review performed no manual production deployment, remote migration, Microsoft authorization, OneDrive write/delete, or mail send. Authenticated real-mail and attachment lifecycle checks were not rerun.

### 2026-09-05 - First-principles simplification

- Kept the mailbox lease, immutable campaign snapshots, conditional recipient claims, resource-specific OAuth grants, and unknown-outcome handling: each supports an accepted product or safety requirement. The previously documented draft editing and campaign-create retry defects still need a separate lifecycle correction; this cleanup does not resolve them.
- Removed dashboard/history fan-out to one campaign detail request per listed campaign. The existing owner-scoped, bounded campaign list now includes live recipient counts from the same D1 query, and the client consumes those counts directly. The API extension is additive, uses existing indexes and tables, and requires no migration, stored counters, cache, or synchronization worker.
- Deleted the unused `DraftSnapshot` interface and identity-only status branches in the campaign view model. Preserved the pre-existing uncommitted progress entries and the checkout's branch.
- Verification: `npx vitest run src/server/database/d1-campaign-create.test.ts src/app/App.test.tsx` passed 2 files and 29 tests. Added SQLite-backed coverage for all seven statuses, live count changes, consistency with detail counts, owner isolation, ordering, limits, empty job sets, and public serialization without coordination fields. History coverage now asserts that no detail request is made.
- `npm test` passed TypeScript, production client and Worker builds, and all 199 tests across 24 files. `git diff --check` passed with informational Windows line-ending notices. Existing dependency-comment and client chunk-size warnings remain.
- Started the local Vite server and opened the signed-out landing in the in-app browser. Local HTTP checks passed: landing 200 HTML, unauthenticated `/api/me` 401 JSON, and unknown API GET/POST 404 JSON. Authenticated history behavior was checked with synthetic component tests; no visual layout changed. No deployment, remote data operation, Microsoft authorization, or mail submission ran.

### 2026-09-05 - Campaign-list simplification production release

- Under the user's explicit push-and-deploy request, integrated cleanup commit `1122ec6` on current `origin/main` (`726e07e`) in an isolated checkout and pushed runtime commit `fa793656437ebd2d2687e0dd878f5df865cd5204`. Application files merged cleanly; the append-only progress conflict retained both histories. The main working directory's frontend planning changes and local branch were preserved.
- A clean `npm ci` and `npm run check:staging` passed TypeScript, both production builds, all 27 test files and 212 tests, the production Wrangler dry run, staging build, staging configuration validation, and staging Wrangler dry run. GitHub Verify run `33946792007` also passed. Existing dependency-comment and client chunk-size warnings remain.
- Production D1 reported no pending migrations. Rebuilt the production artifact after staging verification and checked the exact production Worker name, origin, D1, Queue producer/consumer, and SMTP configuration before deploying.
- The separate Cloudflare Workers Builds Git check for this commit failed (build `e410dc5d-71dc-42bc-9440-9ff9eadef844`). Its check output contained no failure details; the dashboard required login and available Wrangler credentials were denied access to the Builds logs API. The cause remains unverified. The independently validated local build deployed successfully through Wrangler; the failed Git-build check was not claimed as passing.
- Deployed Worker version `5d84ce0d-a290-4f8c-a1ca-f3ddf67a92f3` with release message `Production main fa793656437ebd2d2687e0dd878f5df865cd5204`; deployment status confirmed 100 percent traffic with the existing production D1, Queue producer/consumer, SMTP configuration, and hourly schedule.
- Local and hosted non-sending smoke checks passed: landing 200 HTML, current JavaScript and stylesheet 200, unauthenticated `/api/me` 401 JSON, and unknown API GET/POST 404 JSON. The hosted HTML references the exact candidate JavaScript asset. The in-app browser displayed the signed-out local and production landing pages.
- No migration, Microsoft authorization, OneDrive operation, campaign mutation, or mail submission ran. Existing draft editing/retry defects remain outside this cleanup. The main task's application code and frontend planning files were not altered.

### 2026-09-05 - Familiar Paper recipient-first frontend implementation

- Implemented the approved Recipients, Message, Save, Picker, and missing-field continuation in the isolated `feat/frontend-refinement` checkout at `C:/Dev/MailFlow-frontend-refinement`, based on `c8aef8d`. The shared `C:/Dev/MailFlow` application checkout was preserved. Approved references and durable guidance are recorded in AGENTS.md, DESIGN.md, and FRONTEND_REFINEMENT_PLAN.md.
- New send now imports recipients, composes or selects a message, and reviews before confirmation. Added five-row recipient paging, an issue filter, readable subject/body tokens, explicit missing-field connections and safe fixed-text replacement, selected-template compatibility, and explicit save-copy/update choices. Templates remain editable without a spreadsheet. CC, BCC, Reply-to, and Importance keep separate full-width rows; attachments stay with the send.
- Recorded the focused contract change in ARCHITECTURE.md before implementation: campaign snapshot creation does not publish reusable template changes. Campaign-create retries preserve their fingerprint, simultaneous preparation coalesces, and lost responses retain the locked snapshot. Test retries preserve the original sample payload across Review remounts. New send from this message creates new request keys and preserves content/recipients while requiring attachment reselection, respecting immutable attachment ownership. Removed the obsolete recipient-options route component; its old URL redirects to Message.
- `npm test` passed TypeScript, production client/Worker builds, and 225 tests in 29 files. New regressions cover stale drafts, lost-response retries, duplicate preparation, publication separation, selected-only preview fetching, recipient-preserving reuse, missing fields, escaped fixed replacements, and persistent test retry payloads. Final spacing/copy cleanup also passed `npm run typecheck` and `npm run build`. `npx wrangler deploy --dry-run` passed. `git diff --check` passed. Existing dependency-comment and large-client-chunk warnings remain.
- Local Worker smoke checks passed: landing 200 HTML, unauthenticated `/api/me` 401 JSON, unknown API GET/POST 404 JSON. Production assets contain no synthetic preview identity, CSRF fixture, or fixture entry. The ignored local preview entry is generated by `node scripts/create-frontend-fixtures.mjs`; its browser-only fixture is never imported by production and blocks provider-bound actions.
- Ran the app on port 5180 and verified CSV/XLSX import (48 rows, 46 ready, 2 issues), template preview/save/duplicate-name recovery, Name-to-Full-name confirmation, Venue replacement, two synthetic attachments (TXT/CSV), personalized Review, row skipping, and acknowledgement. Reference comparisons and desktop/tablet/mobile checks are recorded in `design-qa.md`, with `final result: passed`. The final browser pass logged no exceptions or browser errors; reduced-motion emulation showed no running animations.
- No deployment, remote migration, Microsoft authorization, OneDrive operation, or real-mail submission ran. Drafts remain in browser memory; Save as template does not promise whole-send persistence. Member usability testing and authenticated tenant checks remain separate release work.

### 2026-09-05 - Familiar Paper staging deployment

- At the user's request, deployed exact runtime candidate `1e6de9f7e578567ff8998083ae64f531d5a4ba7c` from the isolated `feat/frontend-refinement` checkout using the validated staging-only Wrangler configuration. Staging URL: `https://mailflow-staging.kyzer-hono-test.workers.dev`. Worker version `e49b1f68-3c13-4c3b-a4e1-dbb25239a958` receives 100 percent of staging traffic, confirmed at 15:30 MYT.
- `npm run check:staging` passed TypeScript, production and staging builds, all 225 tests in 29 files, production packaging dry run, staging target validation, and staging packaging dry run. Existing dependency-comment and client chunk-size warnings remain non-blocking. Staging D1 reported no pending migrations, so no migration was applied.
- Verified separate staging D1 ID, Queue producer/consumer, dead-letter Queue, hourly schedule, SMTP mode, staging attachment namespace, absence of R2, and the three required Worker secret names. No secret values were inspected or recorded.
- Hosted checks passed: landing 200 HTML; JavaScript and CSS 200 with exact SHA-256 byte equality against the candidate build; unauthenticated `/api/me` 401 JSON; unknown API GET and POST 404 JSON. Served assets contain no synthetic preview fixture. The Microsoft start route returned 302 with the staging callback and delegated SMTP scope; the redirect was not followed. The in-app browser opened the hosted sign-in page successfully.
- This replaces the prior staging candidate only. Production was not deployed or merged. No authenticated Microsoft session, test-send, campaign start/resume, OneDrive write, or mail submission was performed. Authenticated member testing is now available to the user on staging.

### 2026-09-05 - Staging feedback refinement and Chrome QA

- Addressed the user's six screenshots in the isolated frontend checkout: moved Attachments and Sending options above the editor; added saving/saved button feedback that invalidates on template changes; removed member-facing separator and messages-per-minute controls; applied automatic separators and the deployment pace consistently to validation and campaign payloads. Fixed newline-separated clipboard lists before single-line input normalization. CC/BCC/Reply-to/Importance remain separate full-width rows.
- Refined centered wide-screen content, equal step columns, explicit skipped-row progress, bounded long-message scrolling, disclosure spacing, tablet sidebar/logo fit and action-bar wrapping, and dialog background scrolling. Updated AGENTS.md and accepted use cases to record the user's preferences. Domain mailbox pacing, provider backoff, recipient limits, one-primary-recipient-per-row validation, and unknown-outcome protections remain in force.
- Used the explicitly requested Chrome browser to test a synthetic long HTML email, an 800px table, XLSX import, four mixed-separator CC addresses, TXT/CSV attachments, save/update feedback and invalidation, picker dismissal/focus, Review, skipping and acknowledgement at wide desktop, desktop, tablet and mobile widths. Final comparison images and results are recorded in design-qa.md with `final result: passed`. No document overflow or app console errors were found; reduced motion passed and overrides were cleared.
- `npm run check:staging` passed TypeScript, production and staging builds, all 226 tests in 29 files, both deployment dry runs, and staging target validation. The new regression proves automatic mixed-address parsing and use of a configured pace of 8 despite an obsolete draft value of 20; existing and extended UI tests cover saved feedback, unsaved changes, save failure and newline paste. Existing dependency-comment and large-client-bundle warnings remain non-blocking. No real mail was sent.

### 2026-09-05 - Staging feedback refinement deployment

- Deployed runtime candidate `812ab2bd4f5bacf6a47cf75923c8720e3ace46cc` through the validated staging-only config. Worker version `3e91ddc6-98ce-4fb5-b080-ffcacab396f3` receives 100 percent of traffic at `https://mailflow-staging.kyzer-hono-test.workers.dev`, confirmed at 16:12 MYT. No schema change was needed.
- Hosted landing and current JavaScript/CSS returned 200; both asset byte hashes matched the verified build. Unauthenticated `/api/me` returned 401 JSON and unknown API GET/POST returned 404 JSON. Assets contain no local fixture identity or script. Chrome opened the hosted sign-in page and confirmed `index-N3R3WGCG.js`; the tab remains open for the user.
- The deployment retained staging D1, Queue producer/consumer, SMTP configuration, attachment namespace and hourly schedule. Production was unchanged. Visual interaction testing used the actual app in Chrome with synthetic local fixtures; no authenticated provider action or real mail ran.
