# HTML editor design QA

## Comparison target

- Source visual truth, visual mode: `C:/Users/kyzer/AppData/Local/Temp/codex-clipboard-da682845-0c8e-46fa-b0f1-89fd499dd8b7.png`
- Source visual truth, HTML mode: `C:/Users/kyzer/AppData/Local/Temp/codex-clipboard-6e103519-d001-45e5-b40e-24784a8c418d.png`
- Implementation, visual mode: `C:/Dev/MailFlow/apps/mailflow/design-qa/html-editor-visual-1440x900.png`
- Implementation, HTML mode: `C:/Dev/MailFlow/apps/mailflow/design-qa/html-editor-source-1440x900.png`
- Implementation, mobile visual mode: `C:/Dev/MailFlow/apps/mailflow/design-qa/html-editor-visual-390x844.png`
- Focused visual comparison: `C:/Dev/MailFlow/apps/mailflow/design-qa/compare-visual-reference-implementation.png`
- Focused HTML comparison: `C:/Dev/MailFlow/apps/mailflow/design-qa/compare-source-reference-implementation.png`

## Capture normalization

- Desktop CSS viewport: 1440 x 900 at device scale factor 1.
- Mobile CSS viewport: 390 x 844 at device scale factor 1.
- Source pixels: visual reference 579 x 82; HTML reference 590 x 79.
- Implementation pixels: 1440 x 900 desktop; 390 x 844 mobile.
- The focused comparisons resize each reference to the 945 px editor crop width, then place it directly above the implementation crop. The screenshots are interaction references rather than Mail Flow brand references, so typography and palette intentionally use the existing Mail Flow tokens.
- State: a realistic invitation template containing headings, highlight markup, a three-row table, cell borders, padding, background color, lists, and bold text.

## Full-view comparison evidence

- The implementation retains Mail Flow's paper surface, thin borders, compact control radii, Satoshi-derived typography, and Phosphor icon family.
- Visual mode presents font and size selectors, formatting controls, and a right-aligned code toggle in one compact toolbar, matching the Power Automate interaction model.
- HTML mode replaces visual controls with an explicit source label, monospace code editor, the same code toggle, and a sanitizer-status row.
- The browser-rendered send preview shows the intended yellow highlight and visible borders around every table cell. It receives the exact same inline `style` values as the visual editor.
- At 390 x 844 the toolbar wraps without document-level horizontal overflow; the measured document scroll width was 375 px against a 390 px viewport.

## Focused comparison evidence

- `compare-visual-reference-implementation.png` confirms the same control hierarchy: font, size, emphasis, list/alignment/link tools, code toggle, and editable rendered body.
- `compare-source-reference-implementation.png` confirms the source-state hierarchy: code mode indicator, raw HTML field, and immediate HTML content. Mail Flow adds a safety-status row because sanitized sending is part of the product contract.
- No separate asset comparison was needed. The reference contains standard interface icons only, and the implementation uses the repository's established Phosphor icon family rather than custom art.

## Required fidelity surfaces

- Fonts and typography: Power Automate's generic system typography is translated into Mail Flow's existing display and monospace tokens. Toolbar labels remain legible at desktop and mobile sizes; source HTML uses the established monospace stack.
- Spacing and layout rhythm: toolbar controls fit one desktop row and wrap predictably on mobile. Editor, toolbar, and status row share one continuous bordered container.
- Colors and visual tokens: controls use existing Paper, Ink, Moss, line, focus, and warning tokens. Active HTML mode uses Ink, consistent with existing selected controls.
- Image quality and asset fidelity: no raster assets are required by this component. All controls use Phosphor icons already used throughout Mail Flow.
- Copy and content: labels clearly distinguish `Message body`, `HTML source`, `Edit HTML source`, and `Return to visual editor`. The status explains whether unsupported markup was actually removed.

## Comparison history

### Iteration 1

- [P2] Safe source HTML showed the warning state after harmless browser normalization inserted a `<tbody>`.
- Fix: compare canonical browser-parsed HTML before deciding that sanitization removed content.
- Post-fix evidence: a safe table source now reports `Preview and sending use this sanitized HTML.` Unsafe scripts still produce the cleaned-HTML warning in automated coverage.
- Post-fix parity check: the visual editor and iframe preview both exposed `border:2px solid #516a59;padding:18px` for the same test cell.

## Findings

- No actionable P0, P1, or P2 findings remain.

## Primary interactions tested

- Switched visual editor to HTML source and back.
- Edited raw HTML and observed the iframe update.
- Verified table, highlight, list, border, background, padding, and bold rendering.
- Verified sanitized status for safe HTML and automated cleanup coverage for unsafe HTML/CSS.
- Verified desktop and mobile toolbar layouts.
- Checked browser console warnings and errors: none.

## Follow-up polish

- [P3] A future iteration could add syntax highlighting to source mode. It is not necessary for the requested Power Automate-style toggle or accurate HTML rendering.

final result: passed

## 2026-09-03 - Review attachment metadata alignment

- Source visual truth: `C:/Users/kyzer/AppData/Local/Temp/codex-clipboard-c1d5540a-c257-40df-91f1-264fb7eda885.png` at 821 x 114 pixels.
- Browser-rendered implementation: `C:/Users/kyzer/.codex/visualizations/2026/09/01/01a05e0c-6089-7f83-bf22-f6f0f8dd171e/mailflow-review-attachments-after.jpg` at 820 x 105 pixels, CSS scale 1.
- Combined comparison: `C:/Users/kyzer/.codex/visualizations/2026/09/01/01a05e0c-6089-7f83-bf22-f6f0f8dd171e/mailflow-review-attachments-comparison.png`.
- State: focused review-message metadata with two campaign attachments.

### Comparison history

- Pass 1, P1: the fixed 58px label track was narrower than `Attachments`, so the label collided with the first filename and made the row difficult to scan.
- Fix: the definition list now owns a content-sized label column and a flexible value column; each row participates through CSS subgrid. Labels do not wrap, while long values wrap safely.
- Pass 2: desktop browser measurements show a consistent 12px label-to-value gap on all three rows and no horizontal overflow. A focused 390px-width check also shows the same 12px gap with no horizontal overflow.

### Required fidelity surfaces

- Typography: existing family, weight, size, line height, and hierarchy are unchanged; the attachment value remains readable when it wraps.
- Spacing and layout: To, Subject, and Attachments share one aligned label track and a 12px inter-column gap.
- Colors and tokens: existing Paper, Deep Ink, muted label, and divider tokens are unchanged.
- Image quality and assets: this metadata region contains no image assets; no icons or imagery changed.
- Copy and content: labels, recipient, subject, filenames, and sizes are unchanged.
- Browser console warnings and errors: none in the focused verification page.

No actionable P0, P1, or P2 findings remain.

final result: passed
