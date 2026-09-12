# Roadmap

This document distinguishes known readiness work from future product proposals. Priorities are recommendations, not delivery dates or implementation authorization. The current capabilities are in [Product](PRODUCT.md). Current-source documentation was reviewed on 12 September 2026; the recorded issue reproductions below were made on 6 September and were not rerun during this documentation task.

## 1. Strengthen the existing member journey

Keep the Cloudflare Worker/D1/Queue architecture, delegated Microsoft identity, mailbox delivery coordination, browser parsing, and per-user OneDrive integration. A broad rewrite or hard backend freeze is not approved. Address correctness and recovery before expanding the cohort.

| Priority | Open issue or improvement | Completion criterion |
| --- | --- | --- |
| High | Draft edits can reuse an earlier prepared campaign; a lost create response can retry with a different template version under the same key | Review and start refer to the same immutable revision; exact uncertain-response retries reuse the exact prepared request; test edits, attachment changes, double clicks, and lost responses |
| High | OAuth invalid-grant can fail a recipient while the campaign continues; missing-token errors can become Unknown before SMTP submission | Proven pre-submission authorization failures preserve unsent work and pause for same-account reconnection; actual uncertain submissions remain terminal Unknown |
| High | Preparing a one-off campaign can publish its version as the flow's current reusable template; version insert and publication are separate writes | Separate apply-template, save-new, explicit publication, and campaign preparation; publish atomically with a defined concurrent-edit policy |
| Medium | Normal campaign monitor combines failed and unknown; diagnostics do not consistently expose safe correlation/stage information | Consistent outcome meanings across summaries, details, and exports; allowlisted stage/timing/correlation diagnostics without private content |
| Medium | Existing unit suites missed cross-feature lifecycle failures | Durable regression scenarios cross draft edits, preparation, request retry, test/start, auth recovery, and provider boundaries |
| Before wider rollout | Eager workbook loading, bounded history, and unmeasured operating capacity | Measure lazy-loading benefit, add history pagination, and establish capacity, cleanup backlog, retention, and tested restore procedures |

Useful code entrypoints are [campaign preparation](../src/app/hooks/use-ensure-campaign.ts), [draft state](../src/app/state/draft-context.tsx), [template helpers](../src/server/api/helpers.ts), [SMTP adapter](../src/server/microsoft/smtp-adapter.ts), [Queue consumer](../src/server/queue/campaign-tick.ts), and [campaign monitor](../src/app/routes/campaigns/CampaignPage.tsx). Recheck the exact candidate before implementing an older finding; related branches may have separate work. Do not broaden this documentation cleanup into a code or pipeline review.

Capacity work should measure active mailboxes, campaign sizes, queue delay, database work, OneDrive transfer/memory, and cleanup throughput. Re-reading a full 20-MiB set for 300 successful recipients implies about 5.86 GiB of attachment reads before retries; this is a workload calculation, not measured failure or capacity. Define recipient/body/audit retention and restore behavior that cannot replay submitted mail.

## 2. Refine preparation and reuse

Accepted direction: retain Familiar Paper, with Recipients (import/confirm), Message (choose a saved template or write), and Review & send. The current checkout still uses four wizard steps. The following details remain proposed:

- Applying a selected template preserves the imported workbook, confirmed email column, and current attachments. Load and validate the chosen version instead of fetching every version to populate speculative compatibility badges.
- Let members browse a searchable template list and preview before applying. Explain replacement of edited content and preserve a cancel/recovery path.
- Save as template is explicit. For a reused template, default to saving a new template and offer a deliberate update of the existing one. Ordinary edits affect the current send; publication must not alter historical campaigns.
- Reusable content includes subject, sanitized HTML, field definitions, and disclosed sending options. Imported rows, rendered per-person values, and temporary campaign attachments are not reusable template content. Do not imply automatic campaign-draft persistence.
- Exact normalized column matches can connect automatically. Other matches are suggestions to accept. Preserve missing-field tokens visibly; offer mapping, replacement with shared text, message editing, or a new file. Never silently insert old data, blank a value, or remove a token.
- Missing columns block the send globally. Empty values in particular rows are row-level issues that can be corrected or explicitly skipped. Validate subject/body and dynamic CC/BCC/Reply-to consistently.
- Editing and saving a reusable template stay available without a recipient file. An optional preselected-template shortcut can coexist with the default import-first journey.

Coordinate this work with the preparation/publication fixes above. Existing saved-flow hydration clears workbook and attachment state and cannot power a post-import chooser unchanged. Verify first-time understanding with representative members; fewer screens alone are not usability evidence.

## 3. Society Workspaces

**Proposed feature:** a shared home for a society's email templates, campaign records, and committee handover. The [web presentation](https://mailflow.kyzer-hono-test.workers.dev/presentation/#society-workspaces) includes one ImageGen concept in the current visual theme. It is not an implemented screen.

### Membership and shared work

1. A society administrator maintains an approved list of student email addresses or identities.
2. A student signs in with Microsoft. Enrollment matches the approved invitation to the verified identity and then binds membership to the tenant/object identity, rather than relying on an email suffix alone.
3. Workspace members view, create, and reuse shared flows/templates and inspect shared campaign records within their permissions.
4. Records can be organized by event and academic year, with authorship, update attribution, and an archive for earlier committees.
5. Administrators manage membership, revoke access, and transfer ownership to the next committee while retaining the society's records.

Start with owner/administrator and member responsibilities. Shared visibility does not imply that every member can start, stop, or modify another member's send. Define campaign-control permissions and recipient-data access explicitly. Future approver or read-only roles should follow an actual committee need.

### Feasibility and boundaries

The existing authentication, templates, campaign snapshots, and audit records are a useful foundation. The current schema has individual ownership, a society label, and a basic user role; it has no organization or membership boundary. This is a coordinated authorization/data-model feature, not a dashboard filter.

Required design work includes organizations, memberships/invitations, workspace-scoped authorization on every API, template conflict/version behavior, audit ownership, migration of existing personal records, access revocation, and committee handover. Personal data must not become shared implicitly. Test isolation between societies and personal workspaces, including guessed IDs and removed members.

Shared records stay separate from sender authorization. Each sender uses their own delegated mailbox and tokens; members cannot use another person's credentials. Keep mailbox budgets global to the sender across workspaces. Define what happens to an already-running campaign when membership or the sender's grant is revoked.

Current OneDrive attachments are temporary and tied to an individual. A permanent society document library requires a separate ownership, storage, permission, retention, and offboarding decision. Do not promise it as a consequence of adding workspace membership. Keep the application hosted on Cloudflare and retain the current delegated-permission boundaries unless separately revised.

### Acceptance criteria

- An approved member can join the correct workspace; an unapproved or revoked member cannot access it.
- Members can create and reuse shared templates and view authorized campaign records with visible authorship.
- Changes are consistently visible to other members; concurrent updates have an explicit conflict policy.
- Earlier committee records remain discoverable without sharing credentials or automatically resending messages.
- Sending preserves the authenticated mailbox, immutable snapshots, pacing, and Unknown handling.
- Migration is deliberate, and organization isolation is verified across APIs, exports, and attachments.

## 4. Later options

Subject to separate product decisions: approval workflows, scheduled sends with a reviewed snapshot, searchable event/year archives, activity summaries, and manual delivery-verification notes that preserve the original provider outcome and record actor/time without triggering a resend. Activity reporting must distinguish acceptance from delivery; open/click tracking is not part of this proposal.

Direct Google Sheets integration, shared mailbox support, and a durable society file library would each change current boundaries and need their own feasibility/permission decision.

## Roadmap validation and rollout

After the high-priority readiness work is verified, nominate a committee sponsor and technical custodian, confirm Microsoft permissions for the intended users, and run one small authorized campaign. Evaluate whether members can prepare/review unaided, understand results, recover without duplicate sends, and obtain useful records. Confirm real inbox receipt separately. Set rollout size and operational expectations from measured evidence, not a test count or an assumed free-service quota.
