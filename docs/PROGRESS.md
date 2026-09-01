# Progress log

Keep this append-only except when updating the short current-state summary. Never include secrets, email passwords, token values, or private message content.

## Current state

- Phase: working Cloudflare prototype deployed and verified end to end with both approved USM test accounts.
- Git: initialized on `main`; the initial implementation commit was created after the local verification and secret-history gate.
- Visual references: seven approved PNG files present, desktop comparisons are stored under `qa/`, and responsive Chrome evidence is stored locally under ignored `output/playwright/`.
- Local test environment: root `.env` present and ignored; passwords and secret values are not stored in source control.
- Quality: TypeScript, 78 unit and integration tests, production build, live Chrome smoke checks, responsive Playwright captures, and Wrangler deployment pass.
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
