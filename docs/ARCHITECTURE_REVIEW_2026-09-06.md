# Architecture assessment

Date: 2026-09-06. Scope: the current working tree at `1122ec6`, including the existing uncommitted cleanup and frontend planning work. This is an assessment and proposed sequence, not an approved architecture change or a claim about the exact deployed release.

## Recommendation

Keep the core architecture and improve it incrementally. Mail Flow has a sound architecture for its accepted, deliberately bounded use cases, with uneven implementation maturity. Its delivery coordination and persistence foundations are stronger than its draft/template/campaign lifecycle and operational diagnostics. A complete rewrite is not justified by the evidence reviewed.

The application is effectively a modular monolith: one deployable Worker contains HTTP, Queue, and scheduled entrypoints, with a React client and explicit persistence, mail, and attachment adapters. That is a suitable level of separation for this product. The immediate investment should be clearer behavior and ownership at the existing boundaries, rather than additional services, databases, or orchestration frameworks.

## What is already a good foundation

| Accepted behavior | Existing architectural support | Assessment |
| --- | --- | --- |
| Signed-in mailbox identity and delegated authorization | Server-side OAuth, tenant verification, cookie sessions, encrypted resource-specific refresh tokens, ownership checks | Appropriate boundaries; no need to redesign identity for the current scope |
| CSV/XLSX import, mapping, validation, previews | Browser parsing, shared pure rules, server input checks, sanitization and isolated previews | Appropriate division of work; browser loading and workflow state need refinement |
| Immutable send history and attachments | Versioned templates, recipient snapshots, campaign fingerprints, atomic campaign/job/attachment association, integrity checks | Strong persistence foundation |
| Background paced sending and duplicate protection | Conditional claims, mailbox lease and budget ledger, durable wake tokens, Queue adapter | Necessary complexity tied directly to accepted requirements |
| Ambiguous mail outcomes | Explicit accepted/retryable/failed/unknown provider contract and no automatic retry of unknown work | Correct core policy; pre-submission classification needs correction |
| Recovery and maintainable deployment | Bounded watchdog and cleanup, migrations, isolated staging configuration, CI builds and deployment dry runs | Useful operational foundation; diagnosis, recovery objectives and growth policies need more evidence |

These conclusions come from implementation as well as documentation: `src/server/database/d1-campaigns.ts`, `d1-mailbox-delivery.ts`, `d1-recipient-jobs.ts`, migrations `0007` through `0009`, `src/server/queue/campaign-tick.ts`, and the attachment/auth/provider modules.

The coordination is not gratuitous abstraction. Cloudflare Queues explicitly permits repeated delivery, and D1 documents transactional batch rollback. Those platform properties support retaining the existing conditional writes and durable coordination. Sources checked for this review: [Queues delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/) and [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

## Findings and refactor priorities

### 1. High: give editable drafts and prepared campaigns distinct identities

`src/app/hooks/use-ensure-campaign.ts:16` returns any existing `campaignResponse` without comparing it to the current draft. `src/app/state/draft-context.tsx:118` changes draft values without invalidating that prepared snapshot. Review renders the current draft, but its start action uses the campaign returned by that hook.

Consequence: prepare a campaign through test-send, return to edit the subject or message, then review and start. The displayed content can differ from the immutable campaign being started. A local probe with the real DraftProvider and preparation hook reproduced the old campaign being returned after a subject change. The start endpoint accepts a campaign ID and acknowledgement, so it cannot detect the browser's newer draft by itself.

There is a related retry defect: the hook creates a new template version on every preparation attempt. If campaign creation succeeds but its response is lost, retry retains the campaign key while changing `templateVersionId`. The server fingerprint explicitly includes that version ID (`src/server/api/campaign-create-control.ts:43`) and rejects changed content. A second local probe reproduced the same-key/different-version requests.

Proposed change: model an editable draft revision and an immutable prepared request explicitly. Cache the exact request and its preparation steps for an uncertain-response retry. Material edits invalidate preparation and acknowledgement; a new revision must not reuse an earlier campaign silently. Do not solve this by weakening the server fingerprint or automatically minting a new key after a network failure, which could create another campaign.

Attachment revisions need an explicit policy because the old set is already associated with an immutable campaign. Simply clearing `campaignResponse` cannot make that set reusable. Include tested-message edits, changed mappings/rows/importance, attachment revisions, double clicks, and lost create/start responses in the lifecycle acceptance tests.

### 2. High: separate authorization recovery from recipient failure

In `src/server/microsoft/smtp-adapter.ts:44`, an OAuth `invalid_grant` becomes a failed authentication result. `src/server/queue/campaign-tick.ts:347` handles it like a rejected recipient, persists a terminal failed row, and schedules subsequent work. There is no corresponding campaign pause in this path. This conflicts with the sign-in-again/resume-unsent behavior described in UC-14.

A missing resource token has another classification problem. `src/server/auth/service.ts:209` throws `AuthFlowError`, which falls into the SMTP adapter's generic unknown branch. A local probe confirmed a row becomes unknown even though `smtp.send` was never called. The scheduler also marks the attempt provider-bound before the adapter refreshes its token. That conservatively prevents duplicates after a crash, but unnecessarily broadens the uncertainty window around proven pre-submission work.

Two local adapter-plus-queue probes reproduced these behaviors without network or mail operations: invalid grant left a failed row and a running campaign; missing token left an unknown row and a running campaign.

Proposed change: introduce an explicit reconnect-required disposition and separate token/provider preparation from submission. Proven pre-submission authorization failures should preserve unsent work and pause for recovery through conditional database transitions. Actual uncertain submissions must still remain terminal unknown. Verify behavior across both SMTP and the retained Graph rollback adapter, including mailbox budget release and same-account reconnect. Do not reclassify historical unknown rows solely from this finding.

### 3. High: separate saving a reusable template from preparing one send

The API helper `src/server/api/helpers.ts:307` creates a version and then advances the flow's current-template pointer. Campaign preparation calls that helper's route. Consequently, preparing a one-off send also changes the saved reusable template. The version insert and flow update are separate writes, and version numbering is computed by loading all versions first. Concurrent saves and partial failures deserve an explicit contract.

`hydrateSavedFlow` also clears the workbook and attachments. That behavior supports starting fresh from a saved flow, but cannot directly support the selected recipients-first template chooser, which must preserve already imported data.

Proposed change: make apply-template, save-new-template, publish-template-update, and prepare-campaign distinct application operations. Publish a reusable version and its pointer atomically, with a defined stale-edit/conflict policy. Template selection should preserve the current send's recipients and report unresolved fields. Record this behavior in the architecture/decision documents before implementation. This aligns with the existing refinement plan and does not require replacing the underlying versioned data model.

### 4. Medium: establish consistent outcome and diagnostic contracts

The campaign monitor separates failed and unknown counts for campaign-level failures, but its ordinary branch still labels `failed + unknown` as Failed (`src/app/routes/campaigns/CampaignPage.tsx:127`). The view model retains that combined field too. The current history table already separates these outcomes and should not be described as wholly unfixed.

The HTTP error handler discards the exception (`src/server/api/app.ts:47`), several Queue/runtime catches omit diagnostic context, and the SMTP adapter returns null provider identifiers after success. Existing audit events are valuable, but do not provide enough detail to explain every acknowledgement-loss incident.

Proposed change: give API/UI consumers explicit accepted, failed, unknown, skipped, pending and not-sent meanings, with processing completion kept separate from delivery. Add allowlisted correlation IDs, SMTP stage codes, elapsed durations, recovery categories and useful operational metrics. Keep credentials, addresses, message content, attachment locators, raw SMTP transcripts and coordination tokens out of logs. Longer timeouts should follow measured evidence rather than substitute for diagnosis.

### 5. Medium: clarify internal application boundaries as these paths change

The project already has useful modules; a wholesale directory migration would add little. The main structural pressure is ownership. DraftContext exposes broad raw setters and combines workbook selection, mapping, validation, upload lifecycle and campaign identity. API handlers mix HTTP handling with application decisions. Queue/scheduled code constructs a fake Hono context through type assertions to reuse service configuration (`src/server/api/worker-runtime.ts:28`). Public client types also derive from internal database-oriented records.

Proposed change: use semantic draft commands backed by a reducer or small explicit state model; isolate attachment upload coordination; extract the affected application operations behind ordinary typed inputs. Construct shared services from bindings/configuration and origin directly, with HTTP and background entrypoints supplying their own context. Use deliberate public response types instead of incrementally omitting internal fields. Preserve direct SQL in repositories and preserve transaction boundaries while refactoring.

Large components and compressed JSX make behavior harder to inspect, but splitting files by an arbitrary line limit is not the objective. Extract components around independently understandable member decisions while implementing the accepted frontend direction.

### 6. Medium: strengthen integration evidence at the seams

The current suite is meaningful: it includes transaction-backed SQLite tests for campaign creation and mailbox coordination, scripted SMTP tests, API tests and component tests. All 193 existing tests passed during this review. Nevertheless, the lifecycle and authorization compositions above were not protected by those passing tests.

The Vitest setup uses jsdom, a socket stub, and a local SQLite implementation of the D1 interface. These tests provide good deterministic logic evidence, but cannot alone prove Cloudflare runtime, distributed timing or actual mailbox behavior.

Add a small durable suite that crosses draft edits, preparation, request retries, test-send, start and recovery. Retain deterministic fault injection around transaction and provider boundaries, and add local Worker/runtime integration plus controlled staging verification for affected behavior. A test count or successful build is not a substitute for these scenarios.

### 7. Before broader rollout: make growth and operations measurable

The production client build currently emits one JavaScript asset of 1,436.69 kB, 417.16 kB gzip. Routes are eagerly imported, and `src/client/spreadsheet.ts` eagerly imports ExcelJS. Lazy-load the workbook parser and relevant routes, then measure loading and interaction performance. Browser-side parsing remains the right responsibility boundary.

History is bounded to the latest 50 campaigns by the current client/default API request; the endpoint accepts a limit but has no history cursor. Add pagination so retained older campaigns remain discoverable.

Attachment integrity is rechecked before each recipient claim. At the configured maximum, 300 successful recipient attempts with a 20 MiB attachment set imply roughly 5.86 GiB of OneDrive attachment reads, excluding retries and other checks. This is a workload calculation, not a measured limit or proof of failure. The hourly cleanup fallback also processes at most two sets per run. Those deliberate safety bounds need backlog monitoring and workload tests before a larger cohort; they should not be removed blindly.

Define expected active mailboxes, campaign sizes, acceptable wait/recovery time, and retained history. Measure database work, attachment transfer/memory, scheduler delays and cleanup throughput against them. Document recipient/body/audit retention and a restore procedure that cannot replay already submitted mail. The repository has deployment/rollback instructions, but I did not find evidence of a tested database disaster-recovery procedure or quantified capacity/SLO validation in the reviewed runbook.

## Suggested implementation sequence

1. Fix draft revision, immutable preparation, exact retry and explicit template publication together with regression scenarios. Coordinate this with the selected frontend journey.
2. Correct mail authorization recovery and pre-submission classification, including conditional persistence and budget behavior.
3. Complete outcome semantics, safe diagnostics and integrated runtime/failure tests. These are practical rollout gates, not merely cosmetic cleanup.
4. Improve affected service/state boundaries, lazy loading, history pagination and operational capacity/retention documentation in separate reviewable changes.

Keep this sequence flexible where changes are independent. Do not combine the entire assessment into one large refactor or deploy solely because all unit tests pass. Existing historical campaigns, recipient outcomes, keys and attachment associations must retain their meaning through forward-compatible changes.

## When a larger redesign would be justified

Revisit major boundaries if measured workloads exceed this deployment's practical capacity, if organization-level collaboration substantially changes ownership, or if multi-tenant identity, shared mailboxes or delivery-feedback ingestion become approved requirements. Those are evidence or scope changes, not present reasons to rewrite.

Even then, use the current adapters and explicit persistence contracts to replace affected subsystems incrementally. A rewrite would have to reproduce the same distributed delivery hazards and migrate live history; it would not eliminate the need for leases, immutable snapshots or unknown-outcome handling.

## Verification and limits

- `npm test`: passed TypeScript, production Worker/client builds, 23 test files and 193 tests.
- Two temporary probe files: four tests passed, reproducing the stale prepared campaign, changed-version retry, invalid-grant row failure, and missing-token unknown classification. The probes used synthetic identities, mocked API/provider boundaries and the existing queue test harness. They were removed after inspection; permanent regressions belong with the fixes.
- Existing build warnings remain: Zod annotation comments and the large client chunk.
- No application implementation changed in this assessment. Existing working-tree edits were preserved. Only this report and an appended progress entry remain from the review.
- No deployment, remote migration, Microsoft authorization, OneDrive operation, real mail submission, authenticated browser journey or load test ran. The conclusions concern architecture and source/test evidence, not a full security audit or production certification.
