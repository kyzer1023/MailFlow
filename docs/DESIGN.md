# Design

Mail Flow uses a calm editorial interface with paper surfaces, thin borders, readable forms, and restrained route/checkpoint imagery. Preserve the current visual identity while making decisions understandable to nontechnical society members.

## Visual baseline

The running source interface and [centralized tokens](../src/app/styles/tokens.css) are the baseline. Current UI screenshots in the [committee presentation](https://mailflow.kyzer-hono-test.workers.dev/presentation/) illustrate the interface with synthetic data; they are not pixel-locking specifications. The future workspace image is explicitly a concept.

| Role | Brand color |
| --- | --- |
| Deep Ink: text and navigation | `#17211F` |
| Moss: navigation, validation, secondary emphasis | `#516A59` |
| Signal Coral: primary action and active progress | `#F0684F` |
| Mist: quiet fills | `#DCE5DE` |
| Paper: canvas and surfaces | `#F4F0E8` |

Use semantic tokens for actual CSS values, including spacing, radii, and z-index. Geometric sans typography with system fallbacks is the interface direction; the repository bundles no fonts. Use the existing Phosphor icon family and prepared logo. Keep thin neutral borders, restrained shadows, rounded controls, and generous but purposeful spacing. Avoid generic blue/purple gradients, glass effects, invented icons, and decorative dashboard metrics.

## Durable interaction rules

- The sender is always visible and locked to the authenticated mailbox.
- Normal interface text uses readable dynamic-field names, without merge braces. Green tokens are for inserting/selecting values and displaying them inside the editor.
- The Data sidebar labels the recipient email column and each message value plainly. Detected columns are plain reference labels, not insertion tokens.
- Fixed CC, BCC, and Reply-to values are removable chips. Each field has one explicit control for spreadsheet-sourced values.
- CC, BCC, Reply-to, and Importance each occupy their own full-width row. Normal importance is the default.
- Validation explains the problem and correction path beside the affected field or row. Disabled controls explain their prerequisite.
- Review shows the exact message without adding Mail Flow branding inside the recipient's email. Explain the self-only test substitutions and require final acknowledgement.
- Accepted means accepted by Microsoft, never delivered. Preserve explicit Unknown, Failed, Skipped, Not sent, and paused states. Finished processing is not universal success.
- Do not hard-code real society identities, private addresses, or private message content. Do not use em or en dashes in user-visible copy.

## Layout and accessibility

The public landing has a simple sign-in header and Paper hero. The product uses a shared Deep Ink navigation rail and Paper workspace. The current wizard has Recipients, Message, and Review & send, with an inset message preview in Review. Template editing remains available without a spreadsheet.

At narrow widths, navigation becomes a compact header/drawer, panels stack, steppers retain current-step context, and tables scroll or use readable rows. Keep sender, status, acknowledgement, and primary actions discoverable. The current landing artwork is omitted on narrow screens.

Support loading, empty, error, disabled, success, and recovery states. Use semantic labels/headings, keyboard access, visible focus, non-color status cues, live regions for changing results, and reduced-motion behavior. Avoid horizontal page overflow; keep email previews readable. Verify desktop 1440 x 900, tablet 1024 x 768, and mobile 390 x 844 when changing UI.

## Current preparation and results

Familiar Paper uses a recipients-first New send journey, followed by choosing a saved template or composing, then review and confirmation. Applying a template preserves recipients and current attachments. Explicit saving distinguishes a one-off send from reusable publication. Connected fields retain a visible mapping and keyboard focus; missing required values stay visible and block Review. A prepared send stays locked across retries, with an explicit new-send path.

History and detail share Queued, Sending, Waiting with a reason, Paused, Cancelling, and Cancelled meanings. Separate Failed and Unknown outcomes; manual receipt verification records evidence without changing the original provider result. Cancellation that stopped no rows retains its audit and uses the settled result presentation. Use viewer-local timestamps with UTC offset, readable wrapping status pills, and keyboard-accessible horizontal table regions at narrow widths.

Before a substantial redesign, inspect the actual rendered workflow and capture the affected states. Use the Product Design context workflow when the visual source or goal is unclear. A new approved task-specific reference may guide implementation; presentation concepts alone do not authorize it.

## Committee presentation

The [public web deck](https://mailflow.kyzer-hono-test.workers.dev/presentation/) is maintained in [public/presentation](../public/presentation). The landing page links to it. It explains the team's motivation from its earlier Power Automate workflow, emphasizes current features with real UI captures, and explicitly labels the final roadmap slides as unimplemented proposals. Do not describe the earlier experience as a general benchmark of Power Automate.

Current-interface screenshots were captured from the integrated application with synthetic API responses and example.com identities. They show real React layouts and interactions, not live campaign results or delivery evidence. The seven captures cover the dashboard, Recipients import, message editor, sending rules, Review, paused campaign monitor, and saved templates. Captions disclose the illustrative data; images open at full size for inspection.

The Society Workspaces illustration was generated with the built-in ImageGen tool using the current dashboard screenshot as a style reference. It retains Paper, Moss, Coral, the dark navigation rail, and the existing form/table language while envisioning approved membership and shared records. Assets used by the deck live in [public/assets/committee](../public/assets/committee); temporary captures and validation reports stay in ignored output directories. See [image licensing scope](../THIRD_PARTY_NOTICES.md) before redistributing the visuals.

The deck supports previous/next controls, a slide selector, keyboard navigation, shareable slide links, a continuous reading view, and a no-JavaScript reading fallback. Retain responsive layouts, visible focus, sufficient contrast, reduced-motion behavior, and explicit distinction between Microsoft acceptance and delivery. Keep theme values centralized in [presentation.css](../public/presentation/presentation.css).
