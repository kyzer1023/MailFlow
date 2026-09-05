# Mail Flow agent guide

Read this file before changing the repository. Then read the documents named under "Required context". The repository is designed so an agent can join a workstream without receiving the full conversation history.

## Required context

Read these files in order:

1. `docs/CONTEXT.md`
2. `docs/USE_CASES.md`
3. `docs/ARCHITECTURE.md`
4. `docs/DESIGN.md`
5. `docs/IMPLEMENTATION_PLAN.md`
6. `docs/PROGRESS.md`
7. `docs/OPERATIONS.md` when your task touches OAuth, Cloudflare, deployment, or real-mail testing
8. The files owned by your assigned workstream

Use `docs/DECISIONS.md` when a design or architecture choice is unclear. Use `docs/TESTING.md` before declaring a task complete.

## Authority order

When sources conflict, use this order:

1. The user's latest explicit instruction.
2. Security and privacy constraints in this file and `docs/ARCHITECTURE.md`.
3. Approved PNG references in `mock-images/` for visible layout and style.
4. Accepted behavior in `docs/USE_CASES.md`.
5. Architecture decisions in `docs/DECISIONS.md`.
6. Implementation details in the current code.

## Project boundaries

- Cloudflare is the only application hosting platform.
- Microsoft Entra ID is the only user identity provider.
- Delegated OAuth SMTP with `SMTP.Send` is the target mail transport. Microsoft Graph delegated `Mail.Send` remains a deployment-selectable rollback path during the staged migration.
- The first release accepts `.csv` and `.xlsx` uploads. It does not connect directly to Google Sheets.
- Every spreadsheet row produces a separate message.
- The sender is always the authenticated USM mailbox.
- Campaign-wide attachments are limited to five files and 20 MiB combined, use each signed-in student's OneDrive App Folder through delegated `Files.ReadWrite.AppFolder`, and require SMTP mode plus delegated `SMTP.Send`.
- Shared mailboxes, arbitrary From addresses, and application-level Microsoft permissions are out of scope for the prototype.

## Architecture boundaries

- Domain modules must not import Cloudflare runtime types.
- Database access goes through repository functions or interfaces.
- Queue publishing goes through a campaign queue adapter.
- Microsoft mail calls go through a mail provider adapter.
- Parsing workbooks happens in the browser, not in a Worker request.
- Database migrations, bindings, and operational configuration live in Git.
- Use conditional state transitions for recipient jobs. Queue delivery is at least once.
- A provider request with an ambiguous network outcome becomes `unknown`; it is not retried automatically.

## Application layout and local workflow

- Run application commands from the repository root beside `package.json` and `wrangler.jsonc`.
- Build app UI in `src/`. The production Worker API, Queue consumer, and scheduled handler enter through `worker/index.ts`.
- Static client output must remain reproducible, and unknown API or write requests must never fall through to the app shell.
- Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

## Frontend rules

- Match the approved mock for each route before inventing a new layout.
- The landing page uses the locally installed `design-taste-frontend` skill sourced from `github.com/leonxlnx/taste-skill`.
- Product screens follow the approved mocks and the Product Design image-to-code workflow.
- Design tokens are centralized. Do not scatter literal colors, radii, spacing, or z-index values.
- Use one icon family. Do not hand-draw SVG icons or substitute emoji.
- Implement keyboard access, visible focus, reduced-motion handling, loading, empty, error, disabled, and success states.
- Do not put an em dash or en dash in user-visible copy.
- Before making substantial visual changes, use the Product Design context workflow when the visual source is unclear or no longer matches the current goal. Record durable prototype-specific design feedback, preferences, and decisions in this guide.
- Do not hard-code the name or identity of USM Debate Society, or any other individual society, in UI copy, defaults, fixtures, tests, or flow creation. Organization-specific names in approved mocks are layout references only.

Recipient metadata controls should follow a Power Automate-like pattern: fixed CC, BCC, and Reply-to addresses use removable chips, while spreadsheet-sourced values stay behind one explicit dynamic-value control. Render dynamic values as readable green tokens without exposing merge braces in the interface, including inside the message editor. Email Importance is a first-class sending rule with Normal as the default.

The Data step sidebar should explain mappings in plain language: identify the recipient email column, label each message value by its readable name, and show detected spreadsheet columns without merge braces or dynamic-value icons. Reserve green token styling for places where a member inserts or selects a dynamic value.

In Sending rules, CC, BCC, Reply-to, and Importance each occupy their own full-width row. Do not pair these inputs into two-column groups.

2026-09-05 staging feedback: place Attachments and Sending options above the message editor so long HTML messages cannot hide them. The template save button must show a confirmed saved state and return to its save action when template content or sending rules change. Automatically recognize comma, semicolon, and newline address lists, including when reusing older templates. Use the deployment's configured sending pace and existing mailbox scheduling safeguards without exposing separator or messages-per-minute controls to members. Check wide-screen spacing, stepper alignment, long HTML, and responsive layouts in Chrome.

2026-09-05 frontend direction: the user requested an overhaul/refinement centered on a more intuitive experience for nontechnical members. Evaluate the workflow and terminology as well as visual styling. After comparing Image Gen concepts, the user preferred the first displayed mock, Familiar Paper, preserving the Paper/Moss/Coral identity. Its selected recipient-screen reference is `mock-images/refinement/01-recipients-familiar-paper.png`. The default New send journey imports recipients first, then lets the member choose a saved template or write a message, then reviews and confirms. A saved-template reuse shortcut remains a proposal; do not remove template management or require a spreadsheet merely to edit a saved template. The scope and proposed backend stability boundary are recorded in `docs/FRONTEND_REFINEMENT_PLAN.md`; the backend freeze remains a recommendation, not a finalized decision.

The user also accepted the Message-screen continuation at `mock-images/refinement/02-message-familiar-paper.png` and the save, reuse, and missing-field interactions at `03-save-template.png`, `04-template-picker.png`, and `05-missing-fields.png` in that directory. Missing-field resolution belongs beside the editor. Template selection preserves the imported recipient file, primary email column, and attachments. Template publication is explicit. Preparing a test or send locks the reviewed snapshot; changing it requires a new send, with attachment files selected again.

2026-09-05 mapping feedback: keep message-value connections visible after resolution, including a green Connected state and the selected spreadsheet column. Members must be able to inspect and change a connection. Selecting a column must retain focus on that control and must never automatically focus the subject. Preserve readable template-value names in the editor; the connection panel explains their source columns.

2026-09-06 scheduling and results feedback: use FIFO campaign turns per mailbox. New campaigns stay Queued without periodic follower wake-ups. Completion, pause, cancellation, and terminal failure hand off to the next campaign after any current submission settles; retain scheduled recovery for missed handoffs. Resume joins the back. History and detail use the same Queued, Sending, Waiting (with a reason), and Paused wording. Routine mailbox pacing remains Sending. A fully accepted campaign shows Completed with a successful Microsoft-submission summary; recipient evidence stays Accepted by Microsoft. Cancellation requires explicit confirmation, cannot resume or withdraw submitted mail, shows Cancelling while an attempt settles, then Cancelled with pending rows labeled Not sent. All display timestamps, including persisted recipient notes, use the member's browser timezone.

## Secret handling

- Do not print or copy values from `.env`, `.env.test-accounts`, or `.dev.vars` into logs, documentation, prompts, tests, or source files.
- The root `.env` holds local application configuration. The ignored `.env.test-accounts` holds local test-only notes and currently uses colon-separated labels. Never load that account file into the application or treat it as deployable dotenv configuration.
- Student account passwords are for local interactive test support only. They must never enter Cloudflare, D1, browser bundles, fixtures, screenshots, or Git history.
- OAuth secrets belong in Worker secrets. Encrypted refresh tokens belong in D1 only when server-side encryption and key rotation notes are present.

## Shared-worktree etiquette

- Other agents may edit the repository at the same time. Do not revert their changes.
- Own only the files or modules assigned to your workstream.
- Before editing a shared file, inspect the latest version and preserve unrelated changes.
- Add a dated entry to `docs/PROGRESS.md` when your workstream reaches a meaningful checkpoint.
- If a cross-workstream contract changes, update `docs/ARCHITECTURE.md` or `docs/DECISIONS.md` first and notify the coordinating agent.

## Completion standard

A task is complete only when relevant type checks, tests, build checks, and visual or integration checks pass. Record commands and results in `docs/PROGRESS.md`. Do not claim real mail delivery from provider acceptance alone.
