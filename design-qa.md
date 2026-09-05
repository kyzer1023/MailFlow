Source visual truth: `mock-images/refinement/01-recipients-familiar-paper.png` through `05-missing-fields.png`.

Initial comparison: `artifacts/local/message-comparison-initial.png`, source on the left and implementation on the right. Source 1487 × 1058, with its 45 px concept heading excluded. Browser CSS viewport 1488 × 1011 at device scale factor 1; the initial full-page implementation was 1473 × 1054 because of scrollbar and page height. The combined image normalizes each panel to 1487 × 1013. A final comparison must remove this initial height mismatch.

State: imported synthetic recipients, 48 rows, 46 valid addresses, 2 needing attention; Workshop invitation selected; attachments and sending options closed.

**Findings**

- [P2] Message region was too wide and started too low. Narrowed the main content region, increased the column gap, and reduced heading spacing to match the source's two-column composition.
- [P2] Message text and inline tokens were too small. Increased the readable body and token sizes; retained the existing geometric interface font stack.
- [P2] Navigation incorrectly highlighted Saved templates during New send. Corrected the active section to Home and matched the reference's document/history icons using the existing Phosphor family.
- [P2] Footer button weight, text color, and shadow diverged. Changed the primary action to ink text on coral with a flat surface and increased the control size.
- [P2] Native dialog focus started on Close. Focus now starts on the first form control and returns to the opening button.

**Required fidelity surfaces**

- Fonts and typography: initial body and token size corrections applied; final rendered comparison pending.
- Spacing and layout rhythm: initial region-width and header-spacing corrections applied; final comparison pending.
- Colors and tokens: Paper/Moss/Coral retained; new design values centralized in tokens. Flat primary actions match the selected direction.
- Image quality: supplied Mail Flow logo retained rather than replacing the brand asset. The existing paper-backed logo and signed-in member card are intentional production identity controls; icons use Phosphor.
- Copy and content: Recipients → Message → Review & send; current file preserved by template selection; explicit template save; readable missing-field choices. Synthetic member data only.

**Initial implementation checklist (completed below)**

- Re-capture and compare desktop screens and all three dialog states.
- Exercise missing fields, template saving, attachments, and review.
- Check tablet, mobile, keyboard focus, reduced motion, and browser console.
- Finish automated checks and record final evidence.

**Final verification**

The initial findings above are resolved. Final desktop captures use a 1488 × 1011 CSS viewport. The source images are 1487 × 1058 pixels; removing their 45px concept heading leaves 1487 × 1013. Comparison images normalize this one-pixel width and two-pixel height difference. All content is synthetic.

Full-view comparisons in `artifacts/local/`: `recipients-comparison-final.png`, `message-comparison-final.png`, `save-comparison-final.png`, `picker-comparison-final.png`, and `missing-fields-comparison-final.png`. Their individual implementation captures are `recipients-final.png`, `message-final.png`, `save-template-final.png`, `picker-viewport-final.png`, and `missing-fields-final.png`. The missing-value picker variant is also recorded in `template-picker-final.png`. Focused checks inspected the editor, field-resolution sidebar, dialog controls, step labels, sample recipient buttons, and footer in these full-view images together with DOM geometry and accessibility state; separate crops were unnecessary.

Additional P2 corrections and evidence:

- Missing values initially opened a modal. Replaced it with the approved sidebar, with explicit suggestions, fixed-text replacement, and warning outlines. `missing-fields-comparison-final.png` confirms the corrected composition.
- Picker initially deferred compatibility information until after application. It now checks only the selected template and distinguishes connected, suggested, and unavailable fields before application. Current recipients and attachments are preserved.
- Existing mobile CSS hid non-current step labels and squeezed Message actions into a narrow column. All three labels are now visible, secondary actions share one row, and the primary action takes the full width. At 390px, secondary buttons measured approximately 173px each, the primary button 358px, and the document 390px. See `message-mobile-final.png`.
- The narrow Review sample rail truncated recipient addresses. Samples now sit above the message preview and stack on mobile. The original metadata, acknowledgement, attachments, and provider-acceptance distinction remain available. See `review-mobile.png` and the browser geometry checks.
- Final paragraph edge margins and editor height restore both optional Message sections above the footer at reference size. See `message-comparison-final.png`.

Final required surfaces:

- Typography: existing Avenir Next / Segoe UI / Arial stack retained, with large geometric headings and readable message and token text. Checked weights, wrapping, sample recipients, and small labels. The reference is generated imagery rather than a supplied font file.
- Spacing: left rail, three steps, primary import/editor region, contextual sidebar, thin borders, flat coral actions, and action bar follow the approved composition. The missing-field sidebar receives more width. Long content remains scrollable.
- Colors: centralized Paper/Moss/Coral tokens, readable green dynamic values, warm unresolved-field outlines, and visible focus. No new decorative gradient or icon family.
- Assets: reused the actual Mail Flow logo and Phosphor icons. The production logo's paper backing and signed-in member control are deliberate existing-product details. No hand-drawn substitute assets were introduced.
- Copy: recipients first, explicit template publication, preview before use, readable field connections, and separate recipient/file state. No single society is hard-coded. No whole-draft autosave is promised.

Verified interactions: CSV and XLSX import; 48/46/2 counts; two-row issue filter; template preview and application; duplicate-name recovery; copy/update saving; Name-to-Full-name confirmation; Venue-to-Room-101 replacement; preserved recipient file; personalized Review; two synthetic attachments (TXT and CSV, 72 bytes); explicit row skipping and acknowledgement. Automated tests additionally cover standalone template editing, stale snapshots, locked attachments, retry/replay behavior, and snapshot restart. The visual fixture blocks test/start/resume, and no real provider call ran.

Responsive checks used 1488 × 1011 reference size, 1440 × 900 desktop, 1024 × 768 tablet, and 390 × 844 mobile. No document overflow beyond the viewport was observed; wide recipient tables scroll inside their panels. Supporting captures include `message-tablet-final.png`, `message-mobile-final.png`, and `review-mobile.png`. Escape and focus restoration passed. Reduced-motion emulation reported zero running animations and was cleared. The final interaction pass logged no runtime exceptions or browser errors.

The in-app browser's full-page helper sometimes captured its physical narrow surface despite the viewport override. Final desktop comparisons use origin-scoped CDP viewport capture verified against DOM dimensions. Earlier malformed captures are not acceptance evidence.

**Open questions and residual test gaps**

No blocking design question remains for the approved slice. Member usability testing, authenticated tenant testing, delivery verification, and deployment are separate release steps. Existing client bundle-size and dependency-comment warnings remain.

**Follow-up polish**

- [P3] The existing richer formatting toolbar and logo treatment differ slightly from the simplified mock while preserving established capabilities and identity.
- [P3] The name field is shared beneath the new/update choices so either choice can rename a template. Grouping differs slightly from the concept; defaults and publishing behavior match.

final result: passed
