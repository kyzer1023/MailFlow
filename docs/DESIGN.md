# Design reference

## Visual authority

The PNG files in `mock-images/` are the approved visual targets. Match their layout, hierarchy, typography, color, density, and component shape at comparable desktop viewport sizes. Adapt responsively without turning the desktop product into a separate visual language.

## Reference inventory

The 2026-09-05 approved Familiar Paper references in `mock-images/refinement/` supersede the original import and message screens: `01-recipients-familiar-paper.png`, `02-message-familiar-paper.png`, `03-save-template.png`, `04-template-picker.png`, and `05-missing-fields.png`. New send has three steps: Recipients, Message, Review & send. The saved-template library remains independently editable without importing a file. Missing message values resolve in the sidebar beside the editor. These screens use flatter surfaces and the centralized 5px `--send-radius`; their approved component shapes supersede the older radius guidance below.

- `brandkit.png`: logo system, palette, typography direction, status language, and material references.
- `01-landing.png`: public landing page and Microsoft sign-in entry.
- `02-dashboard.png`: authenticated overview, sidebar, flows, campaigns, and route summary.
- `03-template.png`: template composition step.
- `04-mapping.png`: workbook preview, column mapping, and validation summary.
- `05-review.png`: representative email preview, test send, and final confirmation.
- `06-campaign.png`: running campaign, pacing, job states, recovery, and audit receipt.

## Extracted brand tokens

- Deep Ink: `#17211F`
- Moss: `#516A59`
- Signal Coral: `#F0684F`
- Mist: `#DCE5DE`
- Paper: `#F4F0E8`
- Display and interface direction: Satoshi or a close freely available geometric sans substitute.
- Template-field direction: Satoshi Mono or a close freely available monospace substitute.

Use semantic tokens in code rather than direct color literals. Status colors may extend the palette only where the state requires it.

## Design read

Mail Flow is a trust-first student-society service with a tactile editorial product language. Paper, envelope, route, and checkpoint imagery reinforce the workflow without making operational screens decorative. The interface should feel calm, accountable, and human rather than like a generic SaaS dashboard.

The product serves members of USM student societies generally. Organization names and event copy visible in the approved mocks are sample content, not product identity. The live interface must not present Mail Flow as belonging to USM Debate Society or any other single society.

Landing-page dials:

- `DESIGN_VARIANCE: 6`
- `MOTION_INTENSITY: 4`
- `VISUAL_DENSITY: 5`

The operational UI is outside the marketing-only scope of the taste skill. It follows the approved mocks first, with accessible product patterns and complete interaction states.

## Fidelity rules

- Preserve the left-rail navigation, stepper hierarchy, paper surfaces, thin borders, and restrained tinted shadows.
- Use the route line and checkpoint motif only where it explains progress.
- Use Signal Coral for the primary action and active sending state.
- Use Moss and Deep Ink for validation, acceptance, navigation, and brand anchoring.
- Keep the page background within the Paper family. Do not introduce generic blue-purple gradients or glass effects.
- Use consistent radius rules: controls 8-10px, primary panels 12-16px, status chips fully rounded.
- Avoid hand-built icon SVGs. Use one close icon library and a prepared logo asset.
- User-visible copy contains no em dash or en dash.

## Required states

For the main path, implement:

- Loading skeletons shaped like the final layout.
- Empty flows and campaigns.
- Field-level validation and mapped/unmapped states.
- Disabled actions before prerequisites are met.
- Test-send progress, accepted, and failure.
- Campaign pending, sending, accepted, skipped, failed, paused, completed, and unknown states.
- Keyboard focus, hover, pressed, and reduced-motion behavior.

## Responsive behavior

- At narrow widths, the sidebar becomes a compact header or drawer.
- The three New send labels remain visible at narrow widths, with smaller progress nodes.
- Mapping panels stack below the data preview.
- Review metadata stacks above or below the email preview without shrinking the preview to illegibility.
- Wide result tables become horizontally scrollable with sticky identity columns or transform into concise job rows.

## QA viewports

- Reference desktop: use each source image's native aspect ratio and a matching browser viewport where possible.
- Desktop usability: 1440 x 900.
- Tablet: 1024 x 768.
- Mobile: 390 x 844.

Design QA is complete only after reference and implementation screenshots are compared at the same viewport and visible state.

## Stylesheet ownership

`src/app/styles/index.css` loads centralized tokens and shared controls, then landing, shell, overview, data, recipients, message, attachments, review and campaign styles. The final wizard stylesheet owns the shared three-step send layout and its responsive sizing. Component styles keep their related breakpoint rules in the same file. Add styles to the appropriate owner instead of creating another visual-polish or refinement override layer.
