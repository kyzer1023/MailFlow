# Mail Flow design QA

## Scope and visual authority

- Source references: `mock-images/01-landing.png` through `mock-images/06-campaign.png`.
- Brand reference: `mock-images/brandkit.png`.
- Implementation: `apps/mailflow/src/App.jsx`, `apps/mailflow/src/styles.css`, and focused responsive overrides under `apps/mailflow/src/app/styles/`.
- Product routes: `/`, `/dashboard`, `/flows/new/template`, `/flows/new/data`, `/flows/new/recipients`, `/flows/new/review`, and `/campaigns/:campaignId`.
- Browser: the user's selected Chrome session.
- Source viewport: 1672 x 941 for every route mock.
- Captured implementation viewport: 1920 x 889. Side-by-side comparison plates normalize the images into a common canvas without cropping their contents.

## Evidence

| Route | Final implementation capture | Side-by-side comparison |
| --- | --- | --- |
| Landing | `qa/landing-implementation-final3.jpg` | `qa/landing-comparison-latest.png` |
| Dashboard | `qa/dashboard-implementation-final3.jpg` | `qa/dashboard-comparison-latest.png` |
| Template | `qa/template-implementation-final3.jpg` | `qa/template-comparison-latest.png` |
| Mapping | `qa/mapping-implementation-final3.jpg` | `qa/mapping-comparison-latest.png` |
| Review | `qa/review-implementation-final3.jpg` | `qa/review-comparison-latest.png` |
| Campaign | `qa/campaign-implementation-final3.jpg` | `qa/campaign-comparison-latest.png` |

The full-view captures preserve enough detail to inspect the important regions without additional crops: landing CTA and illustration, dashboard cards and route, template editor and dynamic fields, mapping table and validation summary, review preview and acknowledgement, and campaign route, job table, recovery rules, and receipt.

The `final3` captures were taken after the real frontend API integration. Each source mock and matching `final3` capture was then loaded together in one comparison pass; no new desktop P0, P1, or P2 regression was observed.

Responsive evidence is stored locally under ignored `output/playwright/` at 1024 x 768 and 390 x 844 for Landing, Dashboard, Template, Mapping, Review, and Campaign. The final measured document width equals the viewport width for the corrected responsive routes. The campaign job table deliberately keeps a horizontally scrollable detail surface with a sticky recipient column and a visible swipe instruction.

## Comparison history

### Pass 1

- P1: Review incorrectly retained the product sidebar and did not use the approved Deep Ink outer frame. Fixed by introducing the full-frame review shell and inset Paper workspace.
- P2: Campaign progress and audit evidence fell below the useful first viewport. Fixed by compacting the header, separating route counts from pace progress, and bringing the audit receipt into view.
- P2: Landing workflow artwork was undersized and the progress treatment did not resemble the source. Fixed by increasing the raster artwork scale and matching the segmented rule.

### Pass 2

- P2: Mapping lacked the visible 145 ready, 2 skipped, and 1 attention summary and recovery affordance. Fixed with the reference metrics, flagged-row review action, upload card, lock note, and Reply Deadline mapping.
- P2: Review preview and summary were too sparse. Fixed with the richer branded message frame plus Sender, Recipients, CC, Pacing, Estimated duration, and Validation rows.
- P2: Template metadata and branding were incomplete. Fixed with the CC row and prepared Mail Flow raster logo.
- P3: Campaign accepted-state wording was ambiguous. Fixed to the exact label `Accepted by Microsoft`.

## Interaction checks

- Review test-send control reaches the accepted-by-Microsoft state.
- Confirm and start is disabled until the acknowledgement checkbox is checked.
- Campaign pause changes the state to `Paused safely` and exposes Resume.
- Resume restores `Sending safely` without changing accepted rows.
- Primary route navigation and wizard links are keyboard-reachable and use visible focus styles.
- Reduced-motion and narrow-layout CSS rules are present.

## Remaining non-blocking visual differences

- P2: The template body remains a dependable plain-text/HTML-backed editing surface rather than reproducing every decorative rich-editor control in the mock. Template editing, merge fields, preview sanitization, saving, and campaign rendering are functional.
- P2: The prepared landing raster retains a subtle internal paper rectangle. Its outer edge is softly masked into the page, but it is not a pixel-identical transparent reconstruction of the source composition.
- P3: Exact source typography is approximated with the selected available font stack. Hierarchy, weight, spacing, palette, and overall composition remain aligned with the approved direction.

## Final result

`passed for working prototype`

Desktop, tablet, and mobile routes are usable without page-level overflow. The accepted prototype direction, core interactions, trust-critical validation, review, pacing, result, and recovery states are represented. The differences above are polish opportunities rather than blockers for the requested working prototype.
