# Product

Mail Flow is a focused mail-merge application for USM student society members. It supports committee members who want to prepare and monitor personalized email without maintaining an automation workflow. It sends through the signed-in member's Outlook mailbox.

The proposal grew from the team's experience with its earlier Power Automate workflow: preparation was tedious, and understanding the sending status or the next useful action was difficult. Mail Flow addresses that need with a focused preparation journey, campaign progress, recipient outcomes, pause/resume, and exportable results. This is the team's motivation, not a general claim about Power Automate's capabilities.

This document describes the current source checkout, reviewed on 12 September 2026. It does not certify the currently hosted release. [Roadmap](ROADMAP.md) separates unresolved limitations and proposed features from available behavior.

## Terminology and ownership

| Term | Meaning today |
| --- | --- |
| Member | A person authenticated through the configured USM Microsoft tenant |
| Flow | A named reusable message setup with a current template version |
| Template version | A stored version of the subject, sanitized HTML, fields, and sending options |
| Campaign | One prepared send using a flow version, recipient snapshots, and optional attachments |
| Recipient job | The processing record for one spreadsheet row |
| Accepted | Microsoft accepted the submission; final inbox delivery is not established |

Flows and campaigns belong to individual users. The schema's society-name label and basic administrator role do not provide shared society access. Society Workspaces is proposed, not available.

## Current member journey

1. **Sign in.** Microsoft OAuth verifies the configured tenant and establishes an application session. In SMTP mode, members without the storage grant continue through separate OneDrive App Folder consent. Declining that step preserves login and exposes a recovery action.
2. **Data.** Import CSV or XLSX, select a worksheet/header row, inspect rows, and choose the recipient email column. Workbook parsing happens in the browser. Headers supply readable labels and normalized dynamic-field keys.
3. **Template.** Name the flow, write the subject and body, insert spreadsheet values, and use visual formatting or sanitized HTML source. Save or edit reusable flows through the flow library.
4. **Recipients.** Review the locked sender, primary recipient column, fixed or column-based CC/BCC/Reply-to, importance, attachments, and pace.
5. **Review.** Inspect representative personalized messages and validation issues. Optionally test to the signed-in mailbox. Acknowledge the review before starting.
6. **Monitor.** Track recipient results, pause/resume eligible campaigns, revisit campaign history, and export CSV results. Queue processing can continue after the browser closes.

The wizard currently labels its four steps Data, Template, Recipients, and Review. The proposed Recipients / Message / Review & send refinement is not yet implemented in this checkout.

## Available capabilities and rules

### Recipients and messages

- CSV and XLSX only; worksheet and header-row selection for workbooks.
- One source row creates one recipient job and one separate message when eligible. Unrelated rows are not combined into a shared To list.
- Subject/body dynamic values, escaped spreadsheet values, sanitized HTML, and an isolated preview iframe.
- Fixed addresses use chips; column-based CC, BCC, and Reply-to use explicit dynamic controls. Importance is Low, Normal, or High, defaulting to Normal.
- Validation detects malformed/missing addresses, duplicate recipients, missing columns/mappings, empty required values, unsupported content, and campaign limits. Flagged rows require correction or explicit skipping where allowed; unresolved required mappings remain blockers.
- Review offers first, middle, and last valid examples plus navigation between samples, showing sender, headers, subject, body, and attachments.

### Reuse and history

The flow library supports creation, reuse, editing, renaming, and removal. Active flow names are unique per owner, ignoring case. Removal archives the flow so existing campaign references survive. Reuse starts a new campaign and clears the previous workbook and attachment selection.

Campaigns retain the selected template and per-recipient message snapshots. Current one-off preparation can also advance the reusable flow's template pointer; deliberate publication and safe draft revision are outstanding work, not a promised separation between one-off edits and saved templates.

### Attachments

Up to five PDF, Word, Excel, PowerPoint, CSV, text, PNG, or JPEG files may total at most 20 MiB of raw bytes. Every valid recipient receives the same reviewed set. Uploads require SMTP mode and the member's separate `SMTP.Send` and `Files.ReadWrite.AppFolder` grants.

The same-origin API receives the files. D1 stores ownership/integrity metadata; the member's OneDrive App Folder stores temporary bytes. Empty/unsupported files, executable signatures, mismatched types, duplicate content, and exceeded limits are rejected. Locked or campaign-associated sets are immutable. Missing/changed bytes stop sending before another recipient is claimed.

Unassociated uploads expire after 24 hours. Terminal campaigns trigger deletion with scheduled cleanup retries. Ordinary OneDrive deletion uses the recycle bin; immediate quota reclamation is not guaranteed. This is not a permanent society document archive.

### Test and start

Test sends use only the authenticated mailbox as To and suppress CC, BCC, and Reply-to at the provider boundary. The reviewed subject, sanitized body, importance, and attachment set remain the test content. Test outcomes say Accepted by Microsoft, not Delivered.

Test and campaign-create requests have stable keys. Exact completed replays avoid another submission; changed-content reuse conflicts. An ambiguous provider result is not automatically retried. Browser draft/preparation retry gaps remain listed in Roadmap despite server safeguards.

### Background processing and recovery

Campaigns use paced Queue ticks and conditional recipient claims. All campaigns and tests from a mailbox share coordination, pace, provider backoff, and a rolling recipient budget. Known transient failures can retry only where no submission occurred. Unknown outcomes remain terminal.

OneDrive throttling/outages retain pending rows and schedule a retry. Storage authorization failures pause for same-account reconnection; missing or integrity-invalid attachments stop the campaign. Resume preserves accepted, failed, skipped, and unknown results.

Recipient results include pending, claimed/sending, accepted, failed, skipped, and unknown. Campaign pause/failure is separate from recipient outcomes. Pending rows in a terminal failed campaign are shown as Not sent. The normal monitor still combines failed and unknown in one summary counter; consistent presentation remains a known gap.

Result CSV contains row number, recipient, status, attempts, timestamps, and diagnostics. Current campaign history is bounded and lacks a cursor for discovering all older campaigns.

## Default limits and adoption boundary

| Concern | Current configured/application bound |
| --- | --- |
| Campaign size | 300 source recipients |
| Default pace | 12 messages per minute; actual progress may be slower |
| Mailbox budget | 8,000 envelope-recipient entries in a rolling 24 hours, including CC, BCC, and tests |
| Test rate | Five new attempts per user per 10 minutes |
| Attachments | Five files, 20 MiB combined raw bytes |
| Storage expiry | Unassociated attachment sets after 24 hours |

These are application limits, not tenant-wide capacity or delivery promises. Ordinary Outlook activity is not visible to Mail Flow. A committee pilot needs a compatible USM account, tenant permission availability, a technical custodian, and an authorized recipient list. Address the readiness gaps in [Roadmap](ROADMAP.md) before broader adoption.

Shared mailboxes, arbitrary From addresses, application-level Microsoft permissions, direct Google Sheets authorization/write-back, and automatic delivery/NDR ingestion are outside the current prototype. Cloudflare remains the application host.
