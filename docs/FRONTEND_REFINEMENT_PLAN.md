# Frontend refinement and proposed backend stability boundary

Date: 2026-09-05.
Status: the approved Recipients, Message, save, picker, and field-resolution flow is implemented in the isolated frontend refinement checkout. Local verification is recorded in PROGRESS.md and design-qa.md. This is not an approved backend freeze or a production release.

## User outcome

A nontechnical USM society member can prepare personalized email, identify and correct recipient problems, understand the exact message and attachment set being reviewed, start safely, and understand the result without learning the application's internal state model.

The user requested a substantial improvement in intuitiveness and UI/UX, alongside the findings in the Codex task [Review codebase structure](codex://threads/01a06dec-334a-71c1-b528-117b009b9240). Its latest proposed grouping is three PRs: campaign correctness and outcome reporting; delivery verification and diagnostics; structure, readability, and performance. That discussion is planning evidence, not proof that its fixes have shipped.

## Recommended backend boundary

Keep the core architecture stable for the current prototype scope: Cloudflare Worker and D1, Queue-driven background sending, Microsoft delegated identity and mail adapters, browser-side workbook parsing, and per-user OneDrive attachments. The source and existing transaction, concurrency, retry, and recovery tests provide a sound basis for frontend work. This is not evidence of readiness for unrestricted production scale or every tenant configuration.

Preserve these behavioral contracts:

- The authenticated mailbox is the sender; one source row produces one separate message.
- Campaign snapshots and attachment associations are immutable once prepared for execution.
- Conditional recipient claims, mailbox coordination, and owner-scoped idempotency protect against duplicate submission.
- A request with an ambiguous provider outcome remains Unknown and is never retried automatically.
- Campaign completion means processing has finished, not that every message was accepted or delivered.
- Provider acceptance and independent delivery verification are different facts.
- Attachment recovery cannot resend accepted or unknown rows.

Avoid new transport choices, hosting changes, generic orchestration frameworks, or storage migrations for frontend convenience. Continue allowing narrowly justified correctness, security, diagnostics, and additive API changes. Do not freeze away missing information the UI needs to explain outcomes truthfully.

Before treating frontend-facing contracts as fixed:

1. Fix draft-to-campaign identity: edits cannot start a previously prepared, different snapshot; exact retries reuse the same prepared request and template version. Verify attachment behavior when revising a tested campaign rather than assuming its immutable set can be rebound.
2. Establish consistent meanings for Failed, Unknown, Accepted, Skipped, Not sent, and Finished processing across counts, detail, history, and exports.
3. Complete sanitized SMTP stage/failure diagnostics and API correlation so acknowledgement-loss incidents can be investigated. Do not assume a longer timeout fixes the unproven cause.
4. If manual delivery verification remains in scope, define its additive persistence/API contract before implementing its controls. Record actor and time separately from the original provider outcome, without initiating a resend. This feature is not a prerequisite for starting the rest of the frontend overhaul.
5. Verify the resulting contracts together on the exact integrated candidate. Existing passing suites are useful evidence but previously missed cross-feature draft lifecycle failures.

## Frontend design brief

The target is the existing responsive web application. The intended users and product scope are already defined in CONTEXT.md and USE_CASES.md. After requesting Image Gen comparisons of the existing identity against a new identity, the user preferred the first displayed mock, Familiar Paper. The selected recipient screen is saved at `mock-images/refinement/01-recipients-familiar-paper.png`.

The first exploration compared Familiar Paper (existing identity with guided steps), Open Desk (existing palette with an open workspace), and Clear Signal (new white/cobalt identity with a focused task rail). Familiar Paper is the selected direction. The user's follow-up favors a default journey of importing the spreadsheet before choosing a saved template or writing a new message. The user accepted the matching Message-screen concept and asked to clarify saving, choosing previous messages, and handling unavailable dynamic fields. That accepted Message reference is saved at `mock-images/refinement/02-message-familiar-paper.png`; the approved flow is now implemented and locally verified; member usability testing is still pending.

Default New send journey: Recipients (import and confirm the email column), Message (choose a saved template or write from scratch, then message and optional settings), Review & send (preview, optional self-only test, explicit final confirmation). Selecting a template after import must preserve the imported workbook and confirmed recipient column. Validate only the chosen template against available fields; do not fetch every template version just to decorate a chooser with speculative compatibility badges. Template management stays independent of campaign preparation. A Use this template shortcut that preselects a template before importing is a recommended convenience, not a new mandatory step.

Prioritize the member's decisions:

1. Start: make preparing a send and reusing a saved setup understandable without requiring prior knowledge of "flow" versus "campaign".
2. Recipients: import the spreadsheet, confirm the email column, understand valid and flagged rows, and resolve problems in context. Evaluate whether the duplicated recipient-column selection across Data and Recipients is necessary.
3. Message: compose with readable spreadsheet values, preview representative recipients, and keep advanced HTML controls available without making them part of the normal path.
4. Options: make attachments discoverable; progressively disclose optional CC, BCC, Reply-to, and sending settings. Keep existing chip/token behavior and full-width sending-rule rows.
5. Review: show the exact snapshot that will start, explain a self-only test, preserve a stable retry, and give a direct path back to each blocking issue. Reconfirm material changes after a test.
6. Results: lead with what happened and the next useful action. Separate successful provider acceptance, explicit failures, uncertain outcomes, and rows never attempted. Label configured pace as a maximum; avoid promising delivery or an unsupported completion time.

These are design hypotheses to test against the rendered journey, not findings from a completed usability study. Do not assume fewer wizard steps automatically means less effort. Remove repeated decisions and unnecessary information before consolidating screens.

## Approved template saving, selection, and missing-field behavior

The user accepted these interactions after reviewing the three continuation images. The implementation preserves the contracts below; production deployment and usability testing with members remain separate steps.

### Save deliberately

- Provide a visible Save as template action near the message editor. A new message asks for a unique template name. For a reused template, offer Save as a new template by default and an explicit Update existing template choice.
- Save the subject, sanitized message, dynamic field definitions, and sending options. Do not save imported spreadsheet rows, resolved per-person values, or campaign attachment bytes as reusable template content. Disclose any saved fixed CC/BCC/Reply-to values as sending options; they are not included in the claim that spreadsheet rows are excluded.
- Ordinary editing changes the current send. Publishing an update to the reusable template is explicit and cannot alter historical campaign snapshots. Saving a reusable message is distinct from saving the whole in-progress campaign draft; do not imply automatic draft persistence.
- Reusable templates may contain fields that the current spreadsheet cannot supply. That prevents this send from proceeding until resolved, but does not inherently make the reusable template invalid or require removing its fields to save it.

### Choose with a preview

- The saved-template chooser has searchable names and update dates in a compact list. Loading the selected template shows its subject/body preview and the field compatibility check against the current spreadsheet. Avoid fetching every template version before opening the chooser.
- Browse without replacing the current message. Apply only through Use this template. If applying replaces edited content, explain the replacement and preserve a recovery/cancel path. Retain the imported workbook, confirmed primary recipient column, and current campaign attachment selection.
- Make reused sending options visible for review, including fixed addresses. Template selection must not overwrite the authenticated sender or substitute previous spreadsheet rows.
- Send history remains the record of individual campaigns. Do not silently make every past send into a reusable template or load rendered recipient-specific messages as template content.

### Resolve unavailable fields explicitly

- Unambiguous exact normalized column matches can connect automatically. Differently named columns are suggestions that the member accepts; for example Name can suggest Full name. Show the resulting mapping in readable language.
- If Venue is absent, retain a readable Venue token with a warning and offer an explicit mapping to a current column, Replace with text for a shared literal value, editing/removing the field in the message, or replacing the spreadsheet. Never use an earlier spreadsheet's value, silently blank a field, or silently remove it.
- A fixed-text replacement edits the affected current-template references safely rather than creating an implicit fallback to old recipient data. Preserve intentional subject/body escaping and sanitization.
- Resolve references in both subject and body and validate mapped CC/BCC/Reply-to sources as well. A missing template column is a campaign-wide blocker and cannot be bypassed by the ordinary skip-bad-rows action. A present column with empty values in some rows is a row-level problem that can be corrected or explicitly skipped.
- Keep unresolved tokens visibly distinguished through a warning icon/outline and readable error text. Retain the green token family for dynamic values. Editing and reusable-template saving remain available; preview/test/start must not imply a valid send while unresolved fields remain. The proposed screen blocks Continue to review until its message values are resolved.
- Changes made to adapt a template for this spreadsheet remain local to the send unless the member explicitly updates the saved template.

### Implementation implications

The post-import chooser uses a separate application path that preserves recipient and attachment state; standalone template editing still loads its own saved content without requiring a spreadsheet. Campaign preparation now creates an immutable version without advancing the reusable template pointer. Explicit saving remains the publication action. This contract is recorded in ARCHITECTURE.md. Campaign-create retries keep the same request fingerprint, and test retries keep the same sample payload even after leaving and reopening Review.

Once preparation begins, including a lost response, the reviewed draft is locked. New send from this message preserves content and recipients, creates new request keys, and requires attachment files to be selected again. This respects the existing immutable attachment association without silently rebinding files or sending stale edits. Drafts remain in browser memory; saving a template does not persist the entire send.

## Sequence and coordination

- Audit the actual rendered first-send journey using synthetic local data, including an invalid file/row, back navigation, a simulated test, revised content, and mixed results. Capture screenshots and behavior before making a substantial visual change.
- Resolve the campaign lifecycle contract alongside that audit. Design exploration can proceed while those fixes are implemented; final send/review behavior must use the corrected contract.
- Explore the proposed workflow visually, select its direction, then implement a complete path through the existing application. Do not replace the backend with fixture-only behavior.
- Fold state cleanup, readable components, design tokens, and loading performance into the affected frontend work. Avoid formatting components that the overhaul is about to replace.
- Follow with dashboard, saved-flow reuse, history, responsive behavior, keyboard interaction, and recovery states. Keep landing-page work secondary to the authenticated member journey.
- Reconcile existing work before opening or merging PRs. Campaign list counts are implemented in local commit `1122ec6`; they must not be implemented again as a separate dashboard workstream. The related review also records a merged PR #7, so reconcile with current main before production integration.

The three PRs remain a useful engineering grouping, but not a claim that a substantial frontend redesign must fit into one cleanup diff. Keep each review centered on a coherent behavior and avoid duplicating work across tasks.

## Acceptance evidence

- First-time members can explain what happens next and distinguish a reusable setup from an individual send. Validate this with representative users when available; synthetic QA alone does not prove intuitiveness.
- The reviewed message, recipients, importance, and attachments match the campaign that starts after back navigation and edits.
- A lost creation response can retry without duplicate campaign creation or changed-content conflicts.
- Every blocking issue has an understandable explanation and correction path.
- Unknown is never presented as Failed or Delivered, and manual verification cannot overwrite SMTP evidence.
- Optional controls remain discoverable and accessible; loading, empty, error, disabled, and recovery states work with keyboard and narrow screens.
- Relevant type checks, integration tests, production builds, and visual comparisons pass on the integrated candidate. Real mail requires a separately authorized, bounded verification run.
