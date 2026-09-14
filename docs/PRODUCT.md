# Product

Mail Flow is a focused mail-merge application for USM student society members. It supports committee members who want to prepare and monitor personalized email without maintaining an automation workflow. It sends through the signed-in member's Outlook mailbox.

The proposal grew from the team's experience with its earlier Power Automate workflow: preparation was tedious, and understanding the sending status or the next useful action was difficult. Mail Flow addresses that need with a focused preparation journey, campaign progress, recipient outcomes, pause/resume, and exportable results. This is the team's motivation, not a general claim about Power Automate's capabilities.

This document describes the integrated source based on GitHub main at `bbdcaf9`, checked on 13 September 2026. [Operations](OPERATIONS.md) records release evidence; [Roadmap](ROADMAP.md) separates operational validation and proposed features from available behavior.

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
2. **Recipients.** Import CSV or XLSX, select a worksheet/header row, inspect rows, and confirm the recipient email column. Workbook parsing happens in the browser. Headers supply readable labels and normalized dynamic-field keys.
3. **Message.** Choose a reusable template or compose the subject and body. Insert spreadsheet values, resolve missing fields, check sender and sending options, and add campaign attachments. Choosing a template preserves imported recipients and current attachments.
4. **Review & send.** Inspect representative personalized messages and validation issues. Optionally test to the signed-in mailbox. Acknowledge the review before starting. The configured pace is automatic; members see an estimated duration.
5. **Monitor.** Track recipient results and mailbox waiting, pause/resume or cancel eligible campaigns, record manual receipt verification for Unknown rows, revisit history, and export CSV results. Queue processing can continue after the browser closes.

The wizard has three steps: Recipients, Message, and Review & send. Editing a saved template does not require a recipient file. Required missing values remain visible and block progression until resolved; mapping controls retain their connection and keyboard focus.

## Available capabilities and rules

### Recipients and messages

- CSV and XLSX only; worksheet and header-row selection for workbooks.
- One source row creates one recipient job and one separate message when eligible. Unrelated rows are not combined into a shared To list.
- Subject/body dynamic values, escaped spreadsheet values, sanitized HTML, and an isolated preview iframe. HTML source editing shows a live iframe of that cleaned HTML without Mail Flow fonts, image resizing, or table styles. Pasted HTML source is treated as markup.
- Fixed addresses use chips; column-based CC, BCC, and Reply-to use explicit dynamic controls. Importance is Low, Normal, or High, defaulting to Normal.
- Validation detects malformed/missing addresses, duplicate recipients, missing columns/mappings, empty required values, unsupported content, and campaign limits. Flagged rows require correction or explicit skipping where allowed; unresolved required mappings remain blockers.
- Review offers first, middle, and last valid examples plus navigation between samples, showing sender, headers, subject, body, and attachments.

### Reuse and history

The flow library supports creation, reuse, editing, renaming, and removal. Active flow names are unique per owner, ignoring case. Removal archives the flow so existing campaign references survive. The reuse shortcut starts a new send; choosing a template within an existing send preserves its imported recipients and attachments.

Campaign preparation creates an unpublished immutable snapshot. Only explicit template saving updates the reusable template. Name, version, and current pointer publish transactionally; stale editors receive a conflict and can reload or save a new template. Once preparation begins, the reviewed content is locked, including after a lost response. An explicit new-send action preserves the message and recipients but requires attachment reselection because the prepared set belongs to the original campaign. Drafts are not durable across a full browser reload.

### Attachments

Up to five PDF, DOCX, XLSX, PPTX, CSV, TXT, PNG, JPG, or JPEG files may total at most 20 MiB of raw bytes. Legacy DOC, XLS, and PPT are unsupported. Every valid recipient receives the same reviewed set. Uploads require SMTP mode and the member's separate `SMTP.Send` and `Files.ReadWrite.AppFolder` grants.

The same-origin API receives the files. D1 stores ownership/integrity metadata; the member's OneDrive App Folder stores temporary bytes. Empty/unsupported files, executable signatures, mismatched types, duplicate content, and exceeded limits are rejected. Locked or campaign-associated sets are immutable. Missing/changed bytes stop sending before another recipient is claimed.

Unassociated uploads expire after 24 hours. Terminal campaigns trigger deletion with scheduled cleanup retries. Ordinary OneDrive deletion uses the recycle bin; immediate quota reclamation is not guaranteed. This is not a permanent society document archive.

### Test and start

Test sends use only the authenticated mailbox as To and suppress CC, BCC, and Reply-to at the provider boundary. The reviewed subject, sanitized body, importance, and attachment set remain the test content. Test outcomes say Accepted by Microsoft, not Delivered.

Test and campaign-create requests have stable keys. Exact completed replays avoid another submission; changed-content reuse conflicts. The browser retains the exact prepared request across lost-response retries. Start replays for queued, running, or completed campaigns return the same campaign without resubmitting recipients. An ambiguous provider result is not automatically retried.

### Background processing and recovery

Campaigns use paced Queue ticks, conditional recipient claims, and a first-in-first-out queue per mailbox. Only its head campaign may submit work; followers stay Queued without polling. Resume joins the back of the queue. Campaigns and tests share mailbox coordination, pace, provider backoff, and a rolling recipient budget. Known transient failures can retry only where no submission occurred. Unknown outcomes remain terminal.

OneDrive throttling/outages retain pending rows and schedule a retry. Mail or storage authorization failures pause for same-account reconnection; resume validates authorization before rejoining the queue. Missing or integrity-invalid attachments stop the campaign. Recovery preserves accepted, failed, skipped, and unknown results.

Recipient results distinguish pending, claimed/sending, accepted, failed, skipped, and Unknown. An owner may confirm receipt for an Unknown row with an optional private note. Actor and time are audited, the original provider result remains Unknown, and no resend or budget release occurs. Timestamps use the viewer's timezone with UTC offset. Microsoft acceptance remains separate from receipt evidence.

Cancellation is permanent and requires confirmation. It prevents new submissions; an attempt already crossing the provider boundary settles with its real outcome before Cancelling becomes Cancelled. Pending rows display Not sent. A cancellation that stopped no rows uses the actual completed-result presentation while retaining the cancellation audit. It never recalls submitted mail or permits resume.

Result CSV preserves raw outcomes, row/recipient details, attempts, timestamps, diagnostics, cancellation fields, and separate member-reported verification evidence. Owner-scoped campaign history has cursor pagination with recoverable older-page loading.

## Default limits and adoption boundary

| Concern | Current configured/application bound |
| --- | --- |
| Campaign size | 300 source recipients |
| Default pace | 12 messages per minute; actual progress may be slower |
| Mailbox budget | 8,000 envelope-recipient entries in a rolling 24 hours, including CC, BCC, and tests |
| Test rate | Five new attempts per user per 10 minutes |
| Attachments | Five files, 20 MiB combined raw bytes |
| Spreadsheet import | 20 MiB, 10,000 source rows, 100 columns, 20,000 characters per cell; at most 300 rows per campaign |
| Storage expiry | Unassociated attachment sets after 24 hours |

These are application limits, not tenant-wide capacity or delivery promises. Ordinary Outlook activity is not visible to Mail Flow. A committee pilot needs a compatible USM account, tenant permission availability, a technical custodian, and an authorized recipient list. Address the readiness gaps in [Roadmap](ROADMAP.md) before broader adoption.

Shared mailboxes, arbitrary From addresses, application-level Microsoft permissions, direct Google Sheets authorization/write-back, and automatic delivery/NDR ingestion are outside the current prototype. Cloudflare remains the application host.
