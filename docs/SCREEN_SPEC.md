# Mail Flow screen implementation specification

This document is the screen-level contract for the first Mail Flow prototype. It translates the approved PNG references into implementation targets that a frontend agent can use without reopening the original conversation.

The references are visual authority. Preserve their composition, hierarchy, palette, paper surfaces, thin borders, route motifs, and calm operational tone. This document does not introduce a new information architecture or a new visual direction.

## Reference and fidelity rules

### Approved source files

All product screen references are native 1672 x 941 PNGs with an aspect ratio of approximately 1.7768, close to 16:9.

| Screen | Reference |
| --- | --- |
| Landing | mock-images/01-landing.png |
| Dashboard | mock-images/02-dashboard.png |
| Template | mock-images/03-template.png |
| Mapping | mock-images/04-mapping.png |
| Review | mock-images/05-review.png |
| Campaign | mock-images/06-campaign.png |

The brand board is mock-images/brandkit.png, native 1224 x 1285 with an aspect ratio of approximately 0.9525. It is a token and asset reference, not a route.

Use the source aspect ratio for first-pass desktop comparison. Also compare implementation captures at 1440 x 900, 1024 x 768, and 390 x 844. Scale the composition fluidly; do not make the product dependent on the exact 1672 x 941 pixel dimensions.

### Global visual contract

| Token or rule | Implementation target |
| --- | --- |
| Deep Ink | #17211F, primary text and dark navigation surfaces |
| Moss | #516A59, accepted state, route line, secondary action emphasis |
| Signal Coral | #F0684F, primary actions, active step, sending and attention states |
| Mist | #DCE5DE, quiet fills and secondary surfaces |
| Paper | #F4F0E8, page and panel surfaces |
| Display face | Satoshi, or a close freely available geometric sans substitute |
| Field face | Satoshi Mono, or a close freely available monospace substitute |
| Controls | 8 to 10 px radius, thin neutral border |
| Primary panels | 12 to 16 px radius, thin border, restrained tinted shadow where elevation matters |
| Status chips | Fully rounded, semantic tint, icon plus text |
| Focus | Visible high-contrast focus ring using a token, never color-only state |
| Icon family | One installed icon family throughout; do not hand-draw SVG paths or use emoji |
| Background | Paper family; no blue-purple gradients or glass effects |

Use semantic CSS variables for all tokens. Do not scatter literal colors, radii, spacing, or z-index values through route components.

The visual language is tactile editorial product UI: large geometric headings, generous whitespace, paper-like surfaces, thin lines, and route/checkpoint graphics only where they explain workflow progress. Use motion for feedback and progress transitions. Every motion must have a reduced-motion fallback.

The source screenshots contain example people, mailboxes, organization names, and event content. Layout and hierarchy remain authoritative, but the organization-specific copy does not. Mail Flow serves USM student society members generally and sends through each authenticated member's own student mailbox. This specification uses neutral aliases only:

- Alex Tan, Jordan Lee, Sam Lee, Taylor Noor, and Morgan Ali are display-only test aliases.
- student@example.com, society@example.org, events@example.org, and support@example.org are display-only example addresses.
- Replace identity examples with the authenticated member and mailbox at runtime. Flow names, recipient data, and message content come from the member's own campaign.

No password, token, account identifier, or private screenshot value belongs in the client bundle, fixtures, tests, docs, or screenshots.

### Shared shell geometry

There are three shell variants in the approved references:

- Marketing shell: no rail, full-width header, split hero.
- Product shell: dark left rail, paper workspace, sidebar navigation.
- Review shell: Deep Ink outer background with a large Paper workspace inset by approximately 21 px and rounded at the outer edge.

The generated references show apparent desktop rail widths from about 164 px to 264 px. Treat this as a route-specific crop difference, not a different navigation model. Use one rail component and a bounded tokenized width. The route screenshot is the QA target for its apparent width:

| Reference | Apparent rail width | Approximate share |
| --- | ---: | ---: |
| Dashboard | 264 px | 15.8% |
| Template | 164 px | 9.8% |
| Mapping | 207 px | 12.4% |
| Campaign | 230 px | 13.8% |

The rail contains the prepared MailFlow logo, active navigation, general student-society context, and member identity where the reference shows them. A narrow viewport changes the rail into a compact header or drawer. It does not remove navigation or identity access.

### State and accessibility contract

Every route must implement the complete state family even if the reference shows only a populated state:

- Loading skeletons shaped like the final layout.
- Useful empty state with the next action.
- Inline or contextual error state with a recovery action.
- Disabled controls before prerequisites are met.
- Hover, pressed, keyboard focus, and validation states.
- Success and accepted states that do not claim final delivery.
- Reduced-motion behavior for route lines, skeleton shimmer, progress changes, and transitions.

The browser must never receive access or refresh tokens. Preview HTML is sanitized and rendered in an isolated iframe. Use semantic headings, labels, table headers, live regions for changing campaign status, keyboard reachable menus, and non-color status cues.

No user-visible copy may contain an em dash or en dash. When matching a reference that uses a long dash, use a short sentence, a comma, or a plain hyphen instead.

## Route map

The route slugs below are the stable client route contract. API routes remain governed by docs/ARCHITECTURE.md.

| Route | Screen | Access | Primary entry and exit |
| --- | --- | --- | --- |
| / | Landing | Public | Continue with Microsoft or Sign in starts Entra authorization |
| /dashboard | Dashboard overview | Authenticated | New flow starts a new wizard; flow and campaign cards open detail routes |
| /flows/new/template | Template composition | Authenticated | Save draft, then Continue to data |
| /flows/new/data | Mapping and validation | Authenticated | Upload or replace CSV/XLSX, map fields, then Continue to recipients |
| /flows/new/recipients | Recipient configuration | Authenticated | Configure recipient metadata and pacing, then continue to review |
| /flows/new/review | Review and test send | Authenticated | Back, test send, acknowledge, then Confirm & start |
| /campaigns/:campaignId | Campaign monitor | Authenticated and owner checked | Pause, resume, fix or export issues, close dashboard |

The approved PNG set does not include separate Details or Recipients images. Those routes should reuse the product shell, wizard stepper, form primitives, field token treatment, validation language, and action bar established by the Template, Mapping, and Review references. Do not invent a new shell for them.

## Screen 1: Landing

### Reference and intent

- Reference: mock-images/01-landing.png
- Native size: 1672 x 941, approximately 1.7768:1
- Route: /
- Intent: explain the safe workflow and start Microsoft sign-in
- Taste-skill boundary: apply the locally installed design-taste-frontend skill sourced from github.com/leonxlnx/taste-skill to this marketing surface only. Product screens remain governed by their approved mocks and the product image-to-code workflow.

### Layout and proportions

- Full-viewport Paper canvas with a slim top header occupying roughly 10% of the reference height.
- Header has the logo lockup at about 5% from the left, centered text navigation, and a bordered sign-in control at about 5% from the right.
- Main content is an asymmetric split: left copy occupies roughly 43% of the width and right workflow artwork occupies roughly 52%, with a generous central gap.
- Left content starts around 25% down the viewport. The progress eyebrow and six-segment progress rule sit above the headline.
- The headline is two lines and occupies about 40% of the left column height. The CTA and trust line remain visible without scrolling on the reference desktop viewport.
- The right side is a route illustration with three stacked paper cards and a receipt card. The route line crosses checkpoint circles and exits toward the right edge.

### Visual hierarchy and geometry

- H1 is Deep Ink, geometric sans, approximately 88 to 96 px at the source scale, heavy weight, tight line-height, and two lines.
- Eyebrow is small uppercase mono or tracked sans, Moss, with the wording SECTION 1 OF 6.
- The six-segment rule uses a thick Moss active segment and pale gray inactive segments. It is decorative progress context, not a required interactive control.
- Body copy is approximately 20 to 22 px with a relaxed line-height and a muted Deep Ink or Moss mix.
- Primary CTA is Signal Coral, roughly 367 x 80 px at source scale, 12 to 14 px radius, white label and Microsoft four-square mark.
- The sign-in control is a light outlined button, approximately 96 x 48 px and 10 px radius.
- Workflow cards use Paper surfaces with thin borders and quiet tinted shadows. Card corners are 10 to 14 px. Checkpoint circles are semantic route nodes, not generic decoration.
- Use the prepared MailFlow logo asset. Do not recreate the envelope mark in CSS or draw a replacement SVG.

### Functionally important visible copy

~~~text
How it works
Safety
For societies
Sign in
SECTION 1 OF 6
Every send,
accounted for.
Personalized email through your USM Outlook, checked, paced, and easy to resume.
Continue with Microsoft
Uses delegated Mail.Send · Your mailbox stays yours

1. Import
Upload CSV / Excel
512 recipients

2. Review
Preview & personalize
All good to send

3. Send
Send with Outlook
Paced delivery

Accepted by Microsoft
Message ID: <example-message-id>
~~~

The reference uses a sample recipient count and receipt time. Render neutral example values only when the illustration needs them; the real landing page does not know a recipient count before sign-in.

### Required interactions and states

- Continue with Microsoft and Sign in invoke the same server-side Entra authorization start route. Keep the sender mailbox implicit and never offer an arbitrary From field.
- Show a pressed state and a loading label while the browser leaves for Microsoft.
- If the authorization start fails, show an inline error near the CTA with a retry action and retain the rest of the page.
- If a non-USM tenant returns, show a concise rejection message and a sign-in retry. Do not expose tenant identifiers or Graph response data.
- Header links may anchor to explanatory sections if those sections are added. They must not become dead links.
- Route artwork may reveal cards in order on load, but motion is optional, short, and disabled or reduced under prefers-reduced-motion.
- The CTA remains keyboard reachable with a visible focus ring. Decorative route lines and cards are not focusable.

### Responsive collapse

- At 1024 px, preserve the split but reduce the artwork scale and keep the full CTA label on one line.
- Below 768 px, convert the header navigation to a compact menu or drawer. Keep the logo and sign-in action visible.
- Stack the hero with copy first and route artwork second. The artwork may crop or become a horizontal route strip, but all three step labels remain understandable.
- H1 scales to approximately 44 to 56 px and remains no more than three lines. Body copy is 17 to 18 px.
- Make the Microsoft CTA full width within the content column, with a minimum 44 px touch target.
- Use min-height: 100dvh, not h-screen, and let the page scroll naturally on short mobile viewports.

### Reusable components

- MarketingHeader
- BrandLockup
- HeroProgress
- WorkflowRoute
- WorkflowStepCard
- AcceptanceReceipt
- MicrosoftSignInButton
- TrustNote

## Screen 2: Dashboard

### Reference and intent

- Reference: mock-images/02-dashboard.png
- Native size: 1672 x 941, approximately 1.7768:1
- Route: /dashboard
- Intent: give a member one clear view of reusable flows, recent campaigns, route health, and the next action

### Layout and proportions

- Product shell with a dark rail of approximately 264 px in the reference, or about 16% of the width.
- Paper workspace starts immediately to the right of the rail and uses about 5% horizontal inset for its content.
- Header row is approximately 126 px high. Greeting and subtitle align left; New flow aligns right.
- Reusable flow cards form a two-column grid across most of the workspace. Each card is about half the available width with a 24 to 30 px gap.
- Lower content is a two-column grid: recent campaigns takes about 68% of the available width and Today's route takes about 32%.
- The main content has generous 28 to 32 px gutters. Cards are separated by whitespace and thin borders rather than heavy shadows.

### Sidebar

The rail is Deep Ink with a centered logo lockup and general audience context. It contains:

~~~text
MailFlow
For student societies
Overview
Flows
Campaigns
Recipients
Help
{Member name}
{student@example.com}
~~~

The current nav item uses a Moss-tinted selected surface. The signed-in identity is rendered from /api/me, not hard-coded. A role label may appear under the member name when available.

### Main visual hierarchy

- Greeting is approximately 42 to 48 px, bold geometric sans. Use runtime {firstName} rather than a screenshot name.
- Subtitle is approximately 20 px and muted.
- New flow is Signal Coral with a paper-plane icon, 12 px radius, and a clear pressed state.
- Flow cards have a top identity row with the MailFlow mark, a bold flow name, and a three-dot menu. A divider separates the name from template fields.
- Template fields are monospace chips with Mist or pale green fill. Keep braces visible so members understand that these are merge placeholders.
- Card metadata uses a clock or edit icon and a semantic status chip. Ready uses Moss. Draft uses a neutral gray.
- The campaign table is a real table at desktop. Columns are Campaign, Last updated, Status, and Results. Use row identity and a trailing navigation affordance.
- Today's route uses a vertical route line and semantic checkpoints. It explains progress rather than acting as a second dashboard chart.

### Functionally important visible copy

~~~text
Good afternoon, {firstName}.
Your society mail, in one clear view.
New flow

Annual Dinner Invitation
Template fields
{{recipient_name}}
{{event_name}}
Last used 28 Aug
Ready

Certificate Distribution
{{recipient_name}}
{{certificate_link}}
Last edited 26 Aug
Draft

View all flows
Recent campaigns
Campaign
Last updated
Status
Results
Completed
Accepted
Failed
Paused
Sent
View all campaigns
Today's route
Draft
Validated
2 need attention
Accepted
View route details
Need help? Contact us at support@example.org
~~~

The flow names and placeholder names are representative examples from the reference and are safe to use as fixture labels. Dates and counts should be data-driven. Do not copy screenshot member names or mailbox addresses into fixtures.

### Required interactions and states

- The rail navigates to the stable routes in the route map. Active state is conveyed by fill, icon, label weight, and a semantic state, not color alone.
- New flow creates or starts a draft after authentication.
- Flow cards open the current flow version. The overflow menu must expose only supported actions such as edit, duplicate, or archive when those actions exist.
- View all flows, View all campaigns, and View route details must navigate to real routes or be omitted until their destination exists.
- Campaign rows open the campaign monitor. The table supports keyboard row navigation and retains a visible status label.
- Loading uses skeleton cards, a table skeleton, and a route skeleton that follow final dimensions.
- Empty flows state: explain that a reusable flow can be created and provide New flow.
- Empty campaigns state: explain that a campaign appears after review and Confirm & start.
- API failure state: keep the rail and header usable, show a contextual retry, and avoid a blank workspace.
- Member menu supports sign out. Do not expose secrets, raw Graph errors, or token expiry details.

### Responsive collapse

- At 1024 px, reduce rail width to the shared compact token and keep labels if space permits.
- Below 900 px, switch the rail to a compact header or drawer. The drawer must trap focus while open and close on Escape.
- Flow cards become one column below 820 px.
- Recent campaigns and Today's route stack below 900 px. Preserve the route line as a vertical element.
- At 390 px, table columns may become concise campaign rows with the campaign and status first, or use a horizontal scroll region. Do not hide status or results.
- Keep New flow visible near the greeting; it may become a full-width action below the subtitle.

### Reusable components

- AppShell
- Sidebar
- SidebarNav
- MemberIdentity
- PageHeader
- PrimaryButton
- FlowCard
- TemplateFieldChip
- StatusChip
- CampaignSummaryTable
- RouteTimeline
- EmptyState
- LoadingSkeleton

## Screen 3: Template composition

### Reference and intent

- Reference: mock-images/03-template.png
- Native size: 1672 x 941, approximately 1.7768:1
- Route: /flows/new/template
- Intent: compose a reusable subject and sanitized HTML body before importing recipient data

### Layout and proportions

- Compact product shell with a dark rail of approximately 164 px in the source image.
- A horizontal wizard stepper occupies the top 86 px of the Paper workspace. The active step is Template, shown in Signal Coral with a numbered circle. Details is complete with a Moss check.
- Main content has a two-column layout. The editor column is about 68% of the content width; the Dynamic fields column is about 27%, with a 24 px gap.
- The heading and action row sit above the editor. The editor panel begins around 225 px from the top in the reference.
- The editor card includes flow name, subject, recipient metadata, a rich-text toolbar, a visual/HTML switch, the message body, and two collapsed optional rows.

### Wizard and sidebar copy

~~~text
Details
Template
Data
Recipients
Review
Campaign
Campaigns
Recipients
Templates
Reports
~~~

The source displays five wizard labels on this route. The final campaign monitor is shown as Section 6 of 6 in its own route. Keep the progress model consistent even if the compact rail does not show every label.

### Main visual hierarchy and copy

~~~text
Compose the reusable message.
Write it once. Each spreadsheet row makes it personal.
Save draft
Continue to data

Flow name
Annual Dinner Invitation
Subject
Invitation to {{event_name}}
CC
events@example.org

Visual
HTML
System Sans
14

Hello {{recipient_name}},

You are invited to {{event_name}}, an event organized for members of your student society.

The event will take place on {{event_date}}. We would be glad to have you join us.

Please confirm your attendance by {{reply_deadline}}.

Thank you for being part of the society community.

Warm regards,
Your Society Committee

BCC (optional)
Reply-to (optional)
Dynamic fields
From this flow
{{recipient_name}}
{{recipient_email}}
{{event_name}}
{{event_date}}
{{reply_deadline}}
More fields appear after you import a spreadsheet.
Envelope preview
HTML is cleaned before preview.
Unsafe elements are removed to keep recipients safe.
~~~

The values above are example content. In a live flow, the body is sanitized HTML and the sender remains the authenticated mailbox. CC, BCC, and Reply-To may be fixed or mapped according to the accepted use cases.

### Visual geometry

- Page H1 is approximately 46 to 52 px, bold, with a tight line-height.
- Subtitle is approximately 19 to 21 px, muted.
- Top actions are compact. Save draft is a Moss text or outlined action with a document icon; Continue to data is Signal Coral and approximately 220 px wide.
- Inputs are Paper or near-white with 8 to 10 px radius, one-pixel border, and 48 px minimum height. Labels sit to the left in the source desktop layout.
- The editor body is a large Paper surface with a subtle inset border. Toolbar controls are grouped by thin separators. The Visual tab has the Moss underline; HTML is a secondary tab.
- Merge fields use Satoshi Mono and Mist or pale green fills. Preserve the double braces.
- Dynamic fields panel is a bordered Paper card. Field rows are full-width, lightly tinted, and keyboard-draggable or click-insertable.
- The envelope preview is a small bordered preview card, not an interactive email client.
- The sanitization callout uses a Moss or pale green tint, a shield icon, and a concise safety statement.

### Required interactions and states

- Step navigation allows return to completed steps but guards forward navigation until required fields are valid.
- Save draft persists the flow and template version without starting a campaign. Show saving, saved, and failure feedback.
- Continue to data is disabled until the flow name, subject, and sanitized body meet minimum requirements.
- Subject and body inputs provide field-level validation for missing placeholders, malformed placeholder syntax, and unsupported HTML.
- The editor supports visual editing and an HTML view. The HTML view must sanitize on input and before preview.
- Selecting or activating a Dynamic field inserts its exact placeholder at the caret. Keep insertion keyboard accessible.
- BCC and Reply-To rows expand to fixed or mapped configuration controls.
- Unsafe event handlers, scripts, dangerous URLs, and unsupported HTML are removed. The callout explains this without exposing sanitizer internals.
- Show unsaved changes before leaving the route.
- Loading state uses editor-shaped skeletons. Error state retains any locally recoverable draft.
- The editor must support keyboard shortcuts only when they do not conflict with browser or assistive technology behavior.

### Responsive collapse

- At 1024 px, keep the wizard stepper but allow labels to compact. The editor and Dynamic fields panel may narrow.
- Below 900 px, stack Dynamic fields below the editor. Keep the action row visible above the editor or make it sticky at the bottom.
- At 768 px and below, collapse the stepper to current step plus Step 2 of 6 progress context. Make the rail a drawer.
- Inputs become full width with labels above. The editor toolbar can wrap into two rows.
- At 390 px, the HTML and Visual tabs remain usable. Do not reduce the message preview below readable text size. Optional metadata rows remain expandable.

### Reusable components

- WizardStepper
- WizardShell
- FormField
- SubjectField
- RichTextEditor
- EditorToolbar
- EditorModeTabs
- FieldToken
- DynamicFieldPanel
- OptionalMetadataAccordion
- EnvelopePreview
- SanitizationNotice
- SaveDraftAction

## Screen 4: Mapping and validation

### Reference and intent

- Reference: mock-images/04-mapping.png
- Native size: 1672 x 941, approximately 1.7768:1
- Route: /flows/new/data
- Intent: inspect workbook rows, connect placeholders to columns, and resolve validation issues before recipients and review

### Layout and proportions

- Product shell with a dark rail of approximately 207 px in the source image.
- The workspace header contains a back arrow, flow name, Draft chip, and Section 4 of 6 context. A five-step progress line sits below it.
- Main content uses a two-column grid. The data preview occupies about 61% of the workspace; Column mapping and validation occupy about 33%.
- The title and action row occupy about 120 px. The table panel begins around 247 px from the top.
- A fixed bottom footer is approximately 70 px high and contains brand, copyright, Help, and Contact support.

### Functionally important visible copy

~~~text
Annual Dinner Invitation
Draft
Section 4 of 6
Details
Template
Data
Recipients
Review
Connect the rows to the message.
We found 148 rows in recipients.xlsx.
Replace file
Continue to recipients
Members
Row 1
Recipient Name
Email
Event Name
Event Date
Reply Deadline

Column mapping
{{recipient_name}}
Recipient Name
{{recipient_email}}
Email
{{event_name}}
Event Name
{{event_date}}
Event Date
{{reply_deadline}}
Reply Deadline

Row 87 · Invalid email address
The address "invalid@" is missing a domain (for example, name@example.com). Please update and re-upload.
Review 3 flagged rows

145
ready
2
need attention
1
duplicate

recipients.xlsx
312 KB · uploaded just now
Nothing will be sent until Review.
Help
Contact support
~~~

Use neutral display rows in fixtures and screenshots:

| Row | Recipient Name | Email | Event Name | Event Date | Reply Deadline |
| ---: | --- | --- | --- | --- | --- |
| 1 | Alex Tan | alex@example.com | Student Leadership Night 2026 | 2026-08-15 | 2026-07-31 |
| 2 | Jordan Lee | jordan@example.com | Student Leadership Night 2026 | 2026-08-15 | 2026-07-31 |
| 3 | Sam Lee | sam@example.com | Student Leadership Night 2026 | 2026-08-15 | 2026-07-31 |
| 87 | Taylor Noor | invalid@ | Student Leadership Night 2026 | 2026-08-15 | 2026-07-31 |
| 88 | Morgan Ali | morgan@example.com | Student Leadership Night 2026 | 2026-08-15 | 2026-07-31 |

The exact counts above are illustrative and should come from parsed data. Every source row still produces one recipient job and one separate message.

### Visual geometry

- Main H1 is approximately 42 to 50 px, bold. The row count 148 is Signal Coral and visually emphasized.
- Replace file is a light outlined action with upload icon. Continue to recipients is Signal Coral.
- Workbook selector is a bordered control with an Excel or file icon, worksheet label, and dropdown.
- Data preview is a bordered table panel. Use a sticky header and subtle row separators. The first invalid row receives a Signal Coral outline or tinted row, not just red text.
- Mapping rows align a monospace token on the left, a dotted route connector in the middle, and a dropdown source column on the right.
- Validation summary is a bordered card with three metrics. Use icon plus number plus label. The attention link is Signal Coral.
- The uploaded-file card contains a file icon, filename, size, upload timing, and a Moss accepted check.
- The lock note is muted and placed below the summary. It explicitly reassures that sending cannot happen before Review.

### Required interactions and states

- Accept .csv and .xlsx through file picker and drag and drop. Reject unsupported type, corrupt content, empty workbook, and oversized campaign with an actionable message.
- Parse files in the browser. The Worker must not receive or parse the workbook.
- For .xlsx, provide worksheet selection and header-row selection. Preserve original labels while creating safe placeholder keys.
- Replace file confirms or clearly warns before replacing an existing local mapping.
- The recipient column is required. Do not enable the next step until a valid primary recipient mapping exists and blocking validation errors are resolved or explicitly skipped.
- Each mapping dropdown exposes available normalized columns and a clear unmapped option. Changing a mapping re-runs field and row validation.
- Clicking a highlighted row opens a focused correction view or explains that the file must be corrected and re-uploaded.
- Support malformed primary addresses, invalid CC/BCC/Reply-To, duplicates, missing values, missing template fields, unsafe content, and campaign limit above 300.
- Review 3 flagged rows opens a keyboard accessible filtered issue list. The count is data-driven.
- Loading state uses table rows and mapping row skeletons. Empty state explains how to upload a file. Error state retains the previous parsed file only when safe.
- The lock note and disabled next action must remain visible when prerequisites are incomplete.

### Responsive collapse

- At 1024 px, keep the table and mapping side by side if both remain readable. Otherwise let mapping narrow first.
- Below 900 px, stack the mapping and validation panels below the data preview.
- At narrow widths, put the data table in a horizontal scroll region with a sticky identity column and visible scroll affordance. Do not squeeze email addresses into unreadable text.
- The mapping list becomes a vertical pair of token and source dropdown. Hide decorative connectors but retain the semantic relationship.
- Place validation summary above the mapping list or immediately after the table. Keep Continue to recipients sticky and reachable.
- The file card and lock note become full width. Footer controls wrap into two rows.

### Reusable components

- DataWizardHeader
- WizardStepper
- WorkbookPicker
- WorksheetSelector
- HeaderRowSelector
- DataPreviewTable
- MappingRow
- ColumnMappingPanel
- ValidationSummary
- IssueAlert
- FlaggedRowsDrawer
- UploadFileCard
- LockedUntilReviewNote
- ScrollableTable

## Screen 5: Review and test send

### Reference and intent

- Reference: mock-images/05-review.png
- Native size: 1672 x 941, approximately 1.7768:1
- Route: /flows/new/review
- Intent: preview representative rendered messages, verify the locked sender and counts, send one test to self, and explicitly confirm the campaign

### Layout and proportions

- Deep Ink outer background with a Paper workspace inset by about 21 px on every side. The workspace has a roughly 12 px outer radius.
- Header inside the workspace is approximately 100 px high and contains the logo, wizard steps, and 5 of 6.
- Heading and action row occupy about 110 px below the header.
- Main content is a three-column grid: sample selector about 13%, email preview about 55%, and review summary about 31%, with 16 to 20 px gaps.
- The preview panel is the visual center and should remain readable. Do not shrink it to fit the summary at the expense of the email body.

### Functionally important visible copy

~~~text
Details
Template
Data
Recipients
Review
5 of 6
Review the message they'll receive.
Preview representative rows before anything leaves your mailbox.
Back
Send test to me
Confirm & start

First · Row 1
Middle · Row 74
Last · Row 148
Previous
Next

Sender <student@example.com>
To: Alex Tan <alex@example.com>
Subject: Invitation to Student Leadership Night 2026

Sender
student@example.com
Locked to signed-in account
Recipients
148 individual messages
CC
events@example.org
Pace
12 messages/min
Estimated duration
~13 minutes
Validation
145 ready · 3 skipped
I reviewed the sender, recipients and message.
Accepted means Microsoft received the request; final delivery may still fail later.
Test accepted by Microsoft · 10:42 AM
~~~

The message preview may use a representative branded body such as:

~~~text
You're invited
Student Leadership Night 2026
Dear Alex Tan,
You're invited to Student Leadership Night 2026.
View event details
Reply to this email if you have questions.
~~~

Use the current user's display name and mailbox in the real sender row. The From or Sender value is locked and has no arbitrary address control.

### Visual geometry

- Heading is approximately 34 to 40 px and bold. Subtitle is approximately 18 to 20 px and muted.
- Top actions are ordered Back, Send test to me, Confirm & start. The final action is Signal Coral; the test action is outlined.
- Sample selector is a bordered Paper card. The selected row has a pale green fill and Moss accent. Previous and Next are compact outlined controls at the bottom.
- Email preview resembles a restrained mailbox message: toolbar row, sender row, recipient row, subject row, and isolated HTML body frame. Use icons from the chosen icon family.
- Review summary is a bordered Paper card with one row per fact. Each row has a semantic circular icon, label, and value. The sender and validation lines must not be visually de-emphasized.
- The acknowledgement checkbox precedes the explanatory accepted note. The final action is disabled until the checkbox is checked and no blocking validation remains.
- The test-send result is a live status line at the bottom of the summary. Use Test accepted by Microsoft, never Delivered.

### Required interactions and states

- Sample selector switches among first, middle, and last valid rows. Show a loading state in the preview while resolving a new row.
- Preview subject, recipient metadata, and body are rendered from sanitized template data in an isolated iframe. Spreadsheet values are escaped by default.
- Send test to me sends one rendered message to the authenticated mailbox. It must show idle, sending, accepted, and failure states. Do not send to campaign recipients.
- If the test request is accepted, show the exact semantic label Test accepted by Microsoft and explain that acceptance is not final delivery.
- Confirm & start is disabled until the member acknowledges the sender, recipients, and message. It is also disabled when blocking validation issues remain.
- Start confirmation persists the campaign and queues work. The UI transitions to the campaign monitor only after the server confirms the campaign is queued.
- Back preserves draft data. If data changed locally, ask before leaving.
- Field-level issue links return to Mapping with the relevant row or mapping focus.
- Loading, preview error, test failure, and campaign-start failure remain recoverable and do not discard the draft.
- Keyboard users can reach sample choices, preview controls, acknowledgement, and all actions. A live region announces test-send and start outcomes.

### Responsive collapse

- At 1024 px, keep the preview center stage and let the summary narrow. Sample selector can become a horizontal tab strip.
- Below 900 px, stack sample selector above preview and summary below the preview. Keep Send test to me and Confirm & start reachable without hunting.
- At 390 px, summary rows stack label above value. The email body keeps a readable minimum width inside a horizontally scrollable isolated frame if needed.
- The action row becomes a sticky bottom action bar with safe-area padding. Ensure the acknowledgement checkbox remains visible before the final action.
- The stepper collapses to current-step context and progress count. The outer Deep Ink frame may become a simple dark header to preserve space.

### Reusable components

- ReviewShell
- WizardStepper
- SampleSelector
- SampleNavigation
- MailboxPreview
- PreviewToolbar
- IsolatedHtmlPreview
- ReviewSummary
- ReviewFactRow
- AcknowledgementField
- TestSendStatus
- ConfirmStartAction

## Screen 6: Campaign monitor

### Reference and intent

- Reference: mock-images/06-campaign.png
- Native size: 1672 x 941, approximately 1.7768:1
- Route: /campaigns/:campaignId
- Intent: show paced background sending, explain recovery, and make every recipient result auditable

### Layout and proportions

- Product shell with a dark rail of approximately 230 px in the source image.
- Paper workspace begins to the right of the rail. Header content has a 40 to 48 px top inset and a generous horizontal gutter.
- Campaign title and sender identity occupy about 20% of the visible vertical space.
- The route status summary occupies about 18% and spans nearly the full content width.
- Below it, the job table takes about 68% of the horizontal workspace and the recovery/audit column takes about 30%, with a 24 px gap.
- The lower table and cards may continue below the reference viewport. Do not hide actions to force the entire campaign into one screen.

### Header and campaign identity

~~~text
Section 6 of 6
The campaign can leave without you.
MailFlow will keep pacing, retrying temporary issues, and recording each row.
Pause campaign
Close dashboard
Annual Dinner Guests - 31 Aug 2026
student@example.com
Sending safely
~~~

The date, flow name, sender, and state are data-driven. Keep the sender locked to the authenticated mailbox. Pause campaign changes to Resume campaign when the campaign is paused. Close dashboard returns to the relevant campaign list or dashboard.

### Route summary and pacing copy

The route summary shows six semantic checkpoints:

~~~text
148
Total
26
Pending
4
Sending
115
Accepted
3
Skipped
0
Failed

12 messages/min · About 2 minutes remaining
80%
~~~

The source uses the envelope, clock, paper plane, check, minus, and exclamation icons to explain the sequence. Keep the route line and checkpoint arrows semantic. Use status labels and accessible text even if the route is visually condensed.

### Job table and recovery copy

~~~text
Recipient
Row
Status
Attempts
Last update
Note
Accepted by Microsoft
Request accepted
Sending
Waiting for Microsoft
Skipped
Invalid email address
Pending
Queued
Fix row
Export issues
Showing 1-5 of 148 rows

If something interrupts
Resume from the first unsent row.
Accepted recipients are never sent twice.

Audit receipt
Campaign ID
CMP-2026-08-31-DEMO
Template
Event Invitation v2.1
Started
31 Aug 2026 10:40:10 (MYT)
Started by
Alex Tan (student@example.com)
~~~

Use neutral fixture rows:

| Recipient | Row | Status | Attempts | Last update | Note |
| --- | ---: | --- | ---: | --- | --- |
| Alex Tan | 1 | Accepted by Microsoft | 1 | 10:42:12 | Request accepted |
| Jordan Lee | 2 | Accepted by Microsoft | 1 | 10:42:17 | Request accepted |
| Sam Lee | 3 | Sending | 1 | 10:42:22 | Waiting for Microsoft |
| Taylor Noor | 87 | Skipped | 0 | Not available | Invalid email address |
| Morgan Ali | 88 | Pending | 0 | Not available | Queued |

unknown must be available as a job state even though the reference table shows no unknown row. Its copy must explain that Graph may have received the request and that the row will not be automatically resent.

### Visual geometry

- Section label is small and quiet. H1 is approximately 42 to 50 px, bold. Subtitle is approximately 18 to 20 px.
- Header actions are outlined. Pause is dark outlined with a pause icon; close is lighter and can be disabled while a transition is pending.
- Campaign identity includes the MailFlow mark, bold flow name and date, and a monospace sender line.
- Sending safely is a pale green fully rounded chip with a small Moss state dot.
- Route summary is a Paper panel with thin border, six large circular checkpoints, dotted connectors, and large counts below each node. Sending uses Signal Coral; accepted uses Moss; pending and skipped use neutral fills.
- Pacing line and progress bar sit below the route. The bar is restrained and uses Moss with a small envelope marker; it is not a decorative comparison chart.
- Job table uses a sticky identity column and semantic status chips. The status label for accepted is exactly Accepted by Microsoft.
- Recovery and audit cards are Paper surfaces with thin borders and small, purposeful illustrations. The audit receipt can use the prepared envelope asset or a neutral paper receipt treatment.

### Required interactions and states

- Campaign states are pending, queued, running, paused, completed, and failed. Job states are pending, claimed, sending, accepted, failed, skipped, and unknown.
- Pause campaign is available while runnable. Show a pending transition, then show the pause reason and Resume campaign.
- Resume starts from the first eligible unsent row. Accepted recipients are never sent twice.
- Live updates can poll or subscribe through the Worker API. Announce meaningful changes in an accessible live region without stealing focus.
- Fix row returns to the relevant data correction path when supported. It must not silently mutate a running campaign.
- Export issues and the result CSV export include row number, recipient, status, attempt count, timestamps, and diagnostic message.
- Temporary known throttles or pre-send failures may display a retry time. A timeout or lost Graph response becomes unknown and is not automatically retried.
- Show human-readable recovery messages for expired sign-in, missing USM mail approval, temporary Microsoft pause, invalid recipient, and missing template field.
- Table menus may expose row details. Never expose access tokens, raw Graph response bodies, or internal stack traces.
- Loading state uses route-node, progress, table-row, recovery-card, and audit-card skeletons. Empty state explains that no jobs exist yet. Error state distinguishes campaign fetch failure from a single recipient failure.
- Completed state replaces Sending safely with a completion summary while preserving the route and audit receipt. Paused state remains visibly distinct from failed.

### Responsive collapse

- At 1024 px, compress the rail and let the job table take priority. Recovery and audit cards may narrow.
- Below 900 px, move the rail to a drawer. Stack route summary, pacing, job table, recovery, and audit in that order.
- At 768 px, route checkpoints can become a horizontal scroll strip or a two-row semantic summary. Keep all six labels and counts available.
- The job table becomes a horizontally scrollable region with a sticky recipient column, or concise job rows that preserve recipient, status, and note. Attempts and last update must remain discoverable.
- Pause or Resume stays sticky near the top of the content on mobile. Export and Fix row remain per-row or in an overflow menu.
- Audit receipt fields stack. Decorative paper artwork may be removed on narrow screens if the receipt facts remain clear.

### Reusable components

- CampaignShell
- CampaignHeader
- CampaignIdentity
- CampaignActionBar
- CampaignStatusChip
- CampaignRouteSummary
- RouteCheckpoint
- PaceProgress
- RecipientJobTable
- RecipientJobRow
- JobStatusChip
- RecoveryCard
- AuditReceipt
- IssuesExportAction
- Pagination
- LiveStatusRegion

## Cross-screen component inventory

Use these names as conceptual boundaries. Exact file placement belongs to the frontend workstream, but shared behavior should not be copied route by route.

### Brand and shell

- MailFlowLogo: prepared image or asset with accessible alt text. Never hand-draw the mark.
- BrandLockup: logo plus wordmark for landing and wider rails.
- AppShell: product layout with rail, workspace, responsive drawer, and skip link.
- Sidebar: identity, nav, active state, Help, and member menu.
- ReviewShell: Deep Ink backdrop and inset Paper workspace.
- MarketingHeader: landing navigation and sign-in entry.
- PageHeader: title, subtitle, optional route context, and actions.
- WizardStepper: completed, current, upcoming, blocked, and compact mobile variants.

### Primitives

- PrimaryButton, SecondaryButton, TextButton, IconButton
- StatusChip
- FormField, SelectField, CheckboxField
- FieldToken, TemplateFieldChip
- Tooltip or accessible description for icon-only controls
- LoadingSkeleton, EmptyState, ErrorState, InlineNotice
- LiveStatusRegion

All controls need 44 px minimum touch target, visible focus, disabled styling, pressed styling, and a reduced-motion-safe transition.

### Workflow and data

- WorkflowRoute, RouteCheckpoint, HeroProgress
- FlowCard
- CampaignSummaryTable
- RouteTimeline
- RichTextEditor, EditorToolbar, EditorModeTabs
- DynamicFieldPanel, OptionalMetadataAccordion
- WorkbookPicker, WorksheetSelector, HeaderRowSelector
- DataPreviewTable, ScrollableTable
- MappingRow, ColumnMappingPanel
- ValidationSummary, IssueAlert, FlaggedRowsDrawer
- UploadFileCard, LockedUntilReviewNote
- SampleSelector, MailboxPreview, IsolatedHtmlPreview
- ReviewSummary, ReviewFactRow, AcknowledgementField
- CampaignRouteSummary, PaceProgress, RecipientJobTable
- RecoveryCard, AuditReceipt, Pagination

### State conventions

| Concern | Required treatment |
| --- | --- |
| Loading | Shape-matched skeleton; preserve page geometry and action placement |
| Empty | Explain what is absent and provide the next useful action |
| Validation | Inline near the field or row, summary count near the relevant panel |
| Disabled | Explain the missing prerequisite, not only gray the control |
| Accepted | Label Accepted by Microsoft; explain that final delivery may still fail |
| Sending | Signal Coral, live progress, and no misleading delivery claim |
| Failed | Human-readable cause and recovery action |
| Skipped | Explicit row-level reason; excluded from sending |
| Unknown | Explain ambiguous Graph outcome; never automatically resend |
| Paused | Campaign-level state with a visible resume action |
| Reduced motion | Disable route travel, shimmer, and nonessential transitions while preserving state |

## Implementation handoff checklist

Before a route is considered visually ready:

- Compare the route at the native source aspect and at 1440 x 900.
- Confirm the Paper, Deep Ink, Moss, Signal Coral, and Mist roles match the brand board.
- Confirm shared rail, wizard, status chips, table identity, and button shapes are reused.
- Confirm all functionally important copy above is present or intentionally replaced with live data.
- Confirm no screenshot private name or mailbox was copied into fixtures.
- Confirm no user-visible em dash or en dash exists.
- Confirm keyboard focus, loading, empty, error, disabled, success, and reduced-motion states.
- Confirm mobile collapse at 390 x 844 without making the email preview or data table illegible.
- Confirm accepted status says Accepted by Microsoft and never Delivered.
- Confirm the final review acknowledgement is required before campaign start.
- Confirm the campaign monitor preserves the no-blind-resend rule, including unknown outcomes.
