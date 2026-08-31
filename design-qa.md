# Mail Flow design QA

## Comparison target

- Source visual truth: `C:\Users\kyzer\AppData\Local\Temp\codex-clipboard-3d426273-9556-4673-a03a-0dd504f21583.png` for the authenticated dashboard shell; `codex-clipboard-cf6a9b40-be07-4c72-aab9-f5997a0cfa7b.png` for the approved natural-color MailFlow logo; images 4, 5, and 6 from the request for campaign receipt removal, fixed footer, and Help removal.
- Rendered implementation: `C:\Dev\MailFlow\.qa-dashboard-desktop.png`, `.qa-flows-desktop.png`, `.qa-data-desktop.png`, `.qa-data-imported.png`, `.qa-template-desktop.png`, `.qa-campaign-desktop-v2.png`, `.qa-data-mobile.png`, and `.qa-dashboard-fresh.png`.
- Side-by-side evidence: `C:\Dev\MailFlow\.qa-dashboard-comparison.png`.
- Browser: the user's selected Chrome session against `https://mailflow.kyzer-hono-test.workers.dev`.

## Normalization and state

- Dashboard source: 1914 x 989 pixels including 44 pixels of browser chrome. The compared content crop is 1914 x 945.
- Dashboard implementation: 1895 x 945 CSS pixels at device scale factor 1. The comparison plate places the equal-height source crop and implementation side by side without stretching.
- Mobile implementation: 390 x 844 CSS pixels at device scale factor 1.
- Desktop state: authenticated account before cleanup for populated dashboard and campaign evidence, then the same signed-in account after cleanup for the fresh empty dashboard.
- Onboarding state: empty import, parsed two-row CSV with `email`, `first_name`, and `society` headers, then template composition with selected-text replacement.

## Full-view comparison evidence

- The dashboard retains the approved Paper workspace, Deep Ink full-height rail, heading hierarchy, route card, bordered data surfaces, and Signal Coral actions.
- The implementation intentionally replaces the older white-only rail logo with the homepage natural-color logo requested by the user.
- The 264px desktop rail is consistent on Dashboard, Flows, Data, Template, Campaigns, and campaign detail routes. Recipients and Help are absent from the rail.
- The support line remains fixed to the viewport bottom on desktop and mobile. Workspace padding keeps content reachable above it.
- The final fresh dashboard visibly contains no preloaded flows, campaigns, recipients, or results.

## Focused region comparison evidence

- Flow library: `.qa-flows-desktop.png` shows separate Use flow and Edit actions with the same card language as the dashboard.
- Data first: `.qa-data-imported.png` shows the parsed header row, two real QA rows, recipient-column selection, and header-derived dynamic-field chips.
- Template: `.qa-template-desktop.png` shows the body value `Hello {{first_name}}, welcome to {{society}}.` after replacing the selected word `friend` through the dynamic-field control.
- Campaign detail: `.qa-campaign-desktop-v2.png` shows recipient outcomes plus useful campaign metadata with no decorative audit receipt. The Copy label stays on one line after the second-pass fix.
- Mobile: `.qa-data-mobile.png` shows the compact rail header, four-step sequence, stacked controls, and fixed support footer without horizontal overflow.

## Required fidelity surfaces

- Fonts and typography: display and UI weights preserve the approved editorial hierarchy, readable wraps, and compact mono metadata. No truncation or broken headings were observed.
- Spacing and layout rhythm: rail length and width are consistent, cards align to the same content grid, responsive stacks are coherent, and persistent controls remain visible.
- Colors and visual tokens: Paper, Deep Ink, Moss, Signal Coral, line, and semantic state colors come from the centralized token system.
- Image quality and asset fidelity: all visible MailFlow branding uses the supplied raster assets. No logo, illustration, or non-standard icon was recreated with CSS, glyphs, emoji, or hand-authored SVG.
- Copy and content: onboarding clearly explains why data comes first; dynamic-field behavior is described at the interaction point; campaign audit content is functional rather than decorative; empty states are explicit and honest.

## Findings and comparison history

- Pass 1, P2: the campaign ID Copy label wrapped to two lines in the narrow metadata card. Fix: reserve a non-shrinking, no-wrap action while allowing the ID code to wrap. Post-fix evidence: `.qa-campaign-desktop-v2.png`.
- Pass 1, expected deviation: the source dashboard contained Recipients, Help, and a white logo. These were deliberately changed to match the user's newer explicit requirements.
- Pass 2: no actionable P0, P1, or P2 differences remain.

## Interaction and quality checks

- Verified CSV file-picker import, header detection, automatic primary-recipient detection, Data-to-Template navigation, selected-text replacement, fresh-account empty state, saved-flow actions, and campaign metadata.
- Verified desktop and 390 x 844 mobile layouts.
- Chrome console warnings/errors: none.
- Typecheck, 66 unit/integration tests, production build, and Cloudflare deployment: passed.

## Follow-up polish

- P3: split the large client JavaScript bundle with route-level lazy loading when performance becomes a priority.
- P3: replace the placeholder support mailbox before a public demo.

final result: passed
