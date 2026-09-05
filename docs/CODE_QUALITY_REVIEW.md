# Code quality review, 2026-09-05

Status: reviewed; cleanup proposed, not implemented.

Reviewed checkout: `feat/frontend-refinement`, HEAD `dc1a0ebdae86074d97dbd52771b49e2573506ce4`. Its latest staging runtime is `812ab2bd4f5bacf6a47cf75923c8720e3ace46cc`. This review covers application and Worker entry points, draft state, editor/import/review/results flows, client utilities, API orchestration, validation, persistence, mail/queue adapters, styles and tests. Reference searches include `src/`, `worker/` and `scripts/`; searches identify candidates, followed by reading the declarations and actual callers. This is a maintainability review, not an exhaustive security audit or a formal dead-code proof.

The user reports that the latest version works in real use. Record that as user-confirmed functional verification. No detailed sender/recipient/attachment matrix was supplied, and this review did not independently send mail.

## Findings and proposed actions

### 1. Unused helpers and tests for obsolete paths

- `src/client/template.ts:99`: `replaceTextSelection` is called only by two tests in `src/client/client.test.ts:25`. The current editor manipulates DOM selections and tokens instead. Remove the helper and those two tests; retain actual editor insertion, paste and serialization coverage.
- `src/client/mapping.ts:195`: `mappingsForCurrentTable` is called only by its test at `src/client/client.test.ts:42`. Its assertion that an arbitrary old key is absent never supplies old state. Remove this helper/test and preserve the current workbook/template reuse regressions.
- `src/client/spreadsheet.ts:420`: `parseAndSelectSpreadsheet` only composes two operations and is used by its convenience test. Remove it and exercise format detection through the real `parseSpreadsheet` entry point; retain the unsupported-XLSX assertion from that test.
- Unused aliases include `getRepresentativeRows`, `createCampaignRequest`, `validateCampaignData`, `normalizeHeader`, `buildResultsCsv` and `generateResultCsv`. Unused mapping/display helpers include `normalizePlaceholderMapping`, `mappingColumnOptions` and `previewPositionLabel`. Remove these after checking the final import graph. The repository is an application, with no published library contract requiring alternate names.
- `src/domain/template.ts` and the whole-campaign `validateCampaign` / `assertCampaignValid` portion of `src/domain/validation.ts` have no runtime consumers in the reviewed tree. The Worker uses its route validation plus `validateRecipientRows`; the browser uses its client renderer/validator. Remove the unused implementations after moving any unique escaping, missing-value and header-safety assertions to those live paths. Keep the domain primitives used by Worker validation.

These are opportunities to remove maintenance, not a target test-count reduction. Some tests of small functions protect important contracts and should remain.

### 2. Two CSV exporters, with tests on the unused one

`src/client/results-export.ts` implements CSV generation, aliases, Blob creation and browser downloading. No production caller reaches it. `CampaignPage` calls `downloadCampaignExport`, and the Worker actually generates CSV with `jobCsv` in `src/server/api/helpers.ts:339`.

Remove the unused client exporter and its exclusive types/exports. Move its valuable quoting and spreadsheet-formula protection assertions (`src/client/client.test.ts:464`) onto `jobCsv` and add an owner-scoped export-route regression. Do not remove formula protection. This is a coverage correction as well as dead-code removal.

### 3. Draft state retains obsolete fields and optional safety plumbing

- `DraftState.pace` and `DraftState.separator` remain in defaults and assignments although sending now uses deployment configuration and automatic parsing. Remove those UI-state fields, retaining backend pace and saved-record compatibility.
- Draft `templateVersionId` is written on save, select and reset but never consumed by application behavior. Campaign preparation explicitly sends a null version ID so the server resolves an immutable snapshot. Remove this write-only state, not the actual campaign/template version fields in API or database records.
- `src/app/state/types.ts:95` makes preparation, snapshot locking, restart and test-request state optional even though `DraftProvider` supplies all of them. `use-ensure-campaign.ts:17` and `ReviewPage.tsx:46` consequently invent fallback refs, while safety calls use optional chaining. Make the provider contract required and update the partial Review test fixture. Keep the stable provider-owned refs, in-flight coalescing and retry/lock tests.
- `draft-context.tsx:106` calls `mapSpreadsheetRows(table, mapping)` in two separate memos for rows and issues. Compute once and read both results. Tighten `updateDraft` to a generic key/value pair so TypeScript cannot accept a number for a string field.

Some of this residue came from the recent frontend implementation and should be cleaned up directly.

### 4. Duplicate API plumbing and speculative response compatibility

`apiRequest` (`src/app/api.ts:110`) already supports FormData. `apiRequestFormData` repeats request execution, error handling and response decoding. Use one implementation, preserving multipart boundary ownership, credentials, CSRF, cache behavior and 204 handling. Keep named endpoint functions: they centralize URLs and request contracts and are useful wrappers.

`src/app/lib/attachments.ts:23` accepts multiple invented response shapes and defaults missing IDs/metadata into a ready attachment. The actual upload API returns typed `{ file: AttachmentFileRecord }`. Map that explicit shape and fail clearly if required data is absent. Retain upload-generation, serialization and immutable-set safeguards.

Opening a template for editing currently fetches/hydrates it in `use-flow-actions.tsx:26`, then fetches/hydrates again in `TemplatePage.tsx:497`. Let the edit route own loading and navigate directly for edit; keep loading for the separate reuse action and retain direct-link support.

### 5. Shared primitives still have duplicate implementations

Client and domain validation separately implement email normalization, separator patterns and placeholder extraction. Reuse runtime-neutral domain primitives. Client and server address-list functions currently differ: the client separates valid and invalid parts, while the domain parser retains invalid entries for validation. Preserve that distinction explicitly rather than substituting functions because they share names. Browser sanitization and Worker input rejection remain separate responsibilities.

`src/client/campaign.ts:204` builds `validSourceRows` from the same validated rows used by its only push loop, then tests membership at line 228. That final check cannot fail in the current control flow. Remove it and its explanatory comment. Retain checks against supplied source rows, missing values and invalid validation results.

### 6. CSS revisions obscure which rule owns the design

`src/app/styles/index.css` loads base, responsive, wizard, visual-polish and refinement layers in order. Old review-step rules in `wizard.css:67` describe five columns and hidden labels; the current three-step rules override them. `responsive.css:76` hides inactive labels, while `refinement.css:210` restores them. `.sr-only` is also declared twice.

Move final styles into the appropriate component/route stylesheet, remove superseded selectors and reconcile breakpoint rules and tokens. Do not delete whole stylesheets solely because some selectors are obsolete. Format dense JSX in `App.tsx`, `CampaignTable.tsx` and related touched files without splitting each expression into a new component. Preserve the approved appearance with screenshot comparisons at 1920, 1440, 1024 and 390px, including long content, dialogs and error states.

### 7. Behavior and performance follow-ups, separate from cleanup

- `CampaignPage.tsx:127` still reports `failed + unknown` as Failed outside the campaign-level-failure branch. History already separates them. Correct the monitor and cover running/completed campaigns with unknown outcomes. Remove unused `failed` and `sent` projections from `view-models.ts:51` if final caller checks remain empty; do not remove real count fields.
- `App.tsx` eagerly imports routes and `spreadsheet.ts:8` eagerly imports ExcelJS. Follow cleanup with route-level loading and on-demand workbook parsing. Measure entry chunks and import behavior; a parser Web Worker is a separate responsiveness change requiring dedicated validation.
- Recoverable drafts and safe production diagnostics remain product/reliability work, not cleanup. The global error handler intentionally redacts browser errors but currently discards its exception; any diagnostic improvement must use allowlisted categories/correlation, without bodies, addresses or tokens.

## Delivery order and gates

1. **Remove unused paths and repair test placement.** Items 1 and 2 plus the impossible payload guard. Typecheck, build and full existing tests; targeted real exporter/editor assertions. No UI or mail-transport change.
2. **Simplify active plumbing.** Items 3 through 5: required draft contract, one mapping pass, one request implementation, explicit attachment mapping, one edit fetch and shared primitives. Keep lifecycle, legacy-record, multipart and failure-path coverage. Run the full staging check and synthetic browser journey.
3. **Consolidate presentation code.** Item 6, with before/after screenshots against the current approved staging design. Keep screenshot artifacts separate from application bundles.
4. **Deliver behavior/performance changes separately.** Unknown/Failed correction first, then measured lazy loading. Draft recovery and diagnostics retain their own scope. Do not mix feature changes into deletion-only commits.

No new framework, repository abstraction, hook hierarchy or broad backend rewrite is proposed. Keep repository and provider adapters, conditional transitions, mailbox leases, attempt accounting, ambiguous-outcome handling, OAuth/CSRF, immutable attachments and their meaningful tests.

## Verification for this review

- `npm run test:unit`: passed, 29 files and 226 tests (2026-09-05).
- No application code changed. No new build/deployment claim is made; the previous staging check remains recorded in PROGRESS.md.
- Cleanup, exact deletion counts and bundle improvements remain proposals until implemented and verified.
