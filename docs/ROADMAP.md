# Roadmap

This roadmap is aligned with GitHub main at `bbdcaf9` and its integrated presentation on 13 September 2026. Priorities are recommendations, not delivery dates or implementation authorization. [Product](PRODUCT.md) describes available behavior.

## 1. Validate wider rollout

The current foundation already includes the three-step recipients-first journey, recipient-preserving template selection, explicit transactional publication, immutable prepared requests and retry locking, mail reconnection, FIFO turns, cancellation, separate Unknown outcomes with manual receipt evidence, diagnostics, deferred loading, and paginated history. These are implemented capabilities, not future feature requests. Preserve their regression coverage and the Cloudflare/delegated-mail boundaries.

| Remaining work | Completion criterion |
| --- | --- |
| Measured operating capacity | Exercise one mailbox before the planning target of 10 active mailboxes, with no-submit synthetic workloads; measure request latency, queue delay, OneDrive throughput, cleanup backlog, and maximum-size attachment cost |
| Retention and recovery | Assign retention ownership, approve durations for recipient content and evidence, and complete an isolated Cloudflare restore drill that cannot replay uncertain submissions |
| Member usability and tenant readiness | Verify preparation, reuse, recovery, and outcome interpretation with intended members; validate their Microsoft grants and separately bounded real-mail cases |
| Browser parsing responsiveness | Evaluate a terminable parser worker for complex XLSX files; current size/package limits and deferred loading do not remove main-thread parsing cost |
| Operational configuration | Consider a production dead-letter Queue and stronger staging binding validation; these require separate deployment changes and evidence |

[Operations](OPERATIONS.md) defines workload targets, investigation thresholds, migration compatibility, and the fail-closed restore procedure. A 300-row campaign at the configured 12/minute ceiling takes about 25 minutes before waits; repeatedly reading a full 20 MiB set implies about 5.86 GiB of reads. These are calculations, not measured capacity or promised completion times. A broad rewrite or hard backend freeze is not approved.

## 2. Society Workspaces

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

## 3. Later options

Subject to separate product decisions: approval workflows, scheduled sends with a reviewed snapshot, searchable event/year archives, and activity summaries. Manual delivery verification is already available for Unknown rows. Activity reporting must distinguish acceptance from delivery; open/click tracking is not part of this proposal.

Direct Google Sheets integration, shared mailbox support, and a durable society file library would each change current boundaries and need their own feasibility/permission decision.

## Roadmap validation and rollout

After the relevant operational readiness gates are verified, nominate a committee sponsor and technical custodian, confirm Microsoft permissions for the intended users, and run one small authorized campaign. Evaluate whether members can prepare/review unaided, understand results, recover without duplicate sends, and obtain useful records. Confirm real inbox receipt separately. Set rollout size and operational expectations from measured evidence, not a test count or an assumed free-service quota.
