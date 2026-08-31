# Mail Flow application instructions

Read `../../AGENTS.md` and every required document it names before substantial work. The root guide is authoritative for product, security, architecture, and shared-worktree rules.

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Mail Flow is deployed only to Cloudflare. The production Worker API and Queue consumer live in `worker/index.ts`; static client output must remain reproducible and unknown API or write requests must never fall through to the app shell.

Mail Flow is a general tool for USM student society members who send personalized campaign email from their own student mailbox. Do not hard-code the name or identity of USM Debate Society, or any other individual society, in UI copy, defaults, fixtures, tests, or flow creation. Organization-specific names in approved mock images are layout references only.

Recipient metadata controls should follow a Power Automate-like pattern: fixed CC, BCC, and Reply-to addresses use removable chips, while spreadsheet-sourced values stay behind one explicit dynamic-value control. Render dynamic values as readable green tokens without exposing merge braces in the interface, including inside the message editor. Email Importance is a first-class sending rule with Normal as the default.

The Data step sidebar should explain mappings in plain language: identify the recipient email column, label each message value by its readable name, and show detected spreadsheet columns without merge braces or dynamic-value icons. Reserve green token styling for places where a member inserts or selects a dynamic value.

In Sending rules, CC, BCC, Reply-to, and Importance each occupy their own full-width row. Do not pair these inputs into two-column groups.

Do not edit files owned by another active workstream. Check `../../docs/PROGRESS.md` for current ownership and record meaningful checkpoints there.
