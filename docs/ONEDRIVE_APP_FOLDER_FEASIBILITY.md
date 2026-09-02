# OneDrive App Folder attachment feasibility

Date: 2026-09-02

Status: superseded by the delegated OAuth SMTP plus private R2 implementation in ADR-009. This document remains as historical evidence for the rejected Graph draft-upload path.

## Recommendation

**Conditional go for a tenant-scoped prototype. No-go for production rollout until the USM tenant test passes.**

OneDrive App Folder is the best card-free storage candidate for MailFlow because Microsoft documents the Graph app-folder feature across OneDrive for work or school and OneDrive for home, and the bytes count against the signed-in user's existing OneDrive quota. The delegated `Files.ReadWrite.AppFolder` scope limits the application to its own folder and does not require administrator consent in the Microsoft permission catalog.

The gate remains conditional for four reasons:

1. The delegated `Files.ReadWrite.AppFolder` permission is still labeled **preview**.
2. A read-only OAuth probe confirmed that the primary USM student can reach an ordinary consent screen for delegated `Files.ReadWrite.AppFolder`, but delegated `Mail.ReadWrite` is blocked by tenant policy and requires administrator approval.
3. Files of 3 MB or more require per-recipient Outlook drafts and attachment upload sessions, which adds the tenant-blocked delegated `Mail.ReadWrite` scope alongside the existing `Mail.Send`.
4. MailFlow has not proved App Folder creation, background refresh-token access, permanent deletion, the secondary-account consent result, or the end-to-end large-attachment send path in the USM tenant.

This investigation made no Entra, Cloudflare, deployment, D1, OneDrive, or mail changes.

## Official evidence

- Microsoft documents App Folder as supported across OneDrive for work or school and OneDrive for home. The folder is created on first access at `Apps/{application name}`, and the app is automatically constrained to that folder after consent: [Using app folder in OneDrive and SharePoint](https://learn.microsoft.com/en-us/graph/onedrive-sharepoint-appfolder).
- The Microsoft Graph permission catalog lists delegated `Files.ReadWrite.AppFolder` as preview, with permission ID `8019c312-3263-48e6-825e-2b833497195b`, and says administrator consent is not inherently required: [Microsoft Graph permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference#filesreadwriteappfolder).
- A separate direct-endpoint compatibility table still says `Files.ReadWrite.AppFolder` is not supported by the legacy SharePoint/OneDrive for Business direct endpoint. MailFlow should use `https://graph.microsoft.com/v1.0`, not the legacy direct endpoint: [Direct endpoint differences](https://learn.microsoft.com/en-us/onedrive/developer/rest-api/concepts/direct-endpoint-differences?view=odsp-graph-online).
- Tenant policy remains authoritative. An organization can disable user consent or limit it to selected low-impact permissions, in which case a user sees an approval requirement even for a delegated permission whose catalog entry says no administrator consent is required: [User and admin consent overview](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/user-admin-consent-overview).
- App-folder content consumes the user's existing OneDrive quota. MailFlow must read the drive `quota` values instead of assuming a USM allocation: [App Folder considerations](https://learn.microsoft.com/en-us/graph/onedrive-sharepoint-appfolder#other-considerations) and [quota resource](https://learn.microsoft.com/en-us/graph/api/resources/quota?view=graph-rest-1.0).

## Required permissions

| Capability | Delegated permission | Why |
| --- | --- | --- |
| Existing identity | `User.Read` | Identify the signed-in mailbox owner. |
| Background execution | `offline_access` | Refresh a user's access token after the browser closes. |
| App-folder storage | `Files.ReadWrite.AppFolder` | Create, read, verify, and delete only MailFlow's OneDrive App Folder items. Preview. The tenant test must separately prove the `permanentDelete` action accepts this scoped permission. |
| Direct small send | `Mail.Send` | Send a message with small inline `fileAttachment` JSON. Already configured. |
| Draft and Outlook attachment sessions | `Mail.ReadWrite` | Create a draft, add attachments, and create attachment upload sessions. Required for the 3 MB to USM-limit path. |
| Send prepared draft | `Mail.Send` | Send the existing draft after all attachment uploads complete. |

Do not add Graph application permissions. This design remains delegated and owner-scoped.

Adding the scopes to the Entra registration is not enough by itself. Existing users must complete a new interactive authorization so the stored refresh token covers the additional scopes. MailFlow already persists the granted scope list; queue work should fail closed when either new scope is absent.

## Cost and payment-card impact

- No R2 subscription or R2 payment-card binding is needed.
- App Folder uses the signed-in member's licensed OneDrive quota. It does not create a separate paid storage account for MailFlow.
- There is no safe assumption about a USM student's available capacity. Read `/me/drive?$select=id,driveType,quota` and reject an upload when the reported remaining quota is insufficient or the drive is read-only.
- Extra OneDrive capacity, if ever required, is a tenant licensing decision. MailFlow must not initiate a purchase or require the member to bind a payment card.
- Workers Free currently includes 100,000 Worker invocations per day and Queues Free includes 10,000 operations per day. A 300-recipient tick campaign is roughly 900 Queue operations before retries, because delivery normally costs one write, one read, and one delete operation per tick.

## Proposed architecture

```text
Browser
  select up to 5 files
  calculate SHA-256 and QuickXorHash
       |
       | metadata only, authenticated + CSRF
       v
Cloudflare Worker ------------------------> Microsoft Graph
  create attachment set                    create approot/folder
  create OneDrive upload session           return short-lived uploadUrl
       |                                          |
       | uploadUrl only                           |
       +-------------------- Browser -------------+
                              PUT file slices directly to OneDrive
                                                   |
                                                   v
                                          OneDrive App Folder
                                          immutable MailFlow name
                                          drive item bytes
                                                   |
Cloudflare D1                                      |
  attachment set state                             |
  owner/campaign IDs                               |
  drive ID + item ID + version ID if usable        |
  filename/type/size/eTag/cTag/QuickXor/SHA-256    |
       |                                           |
Cloudflare Queue                                   |
  { type, campaignId } only                        |
       |                                           |
       v                                           |
Queue consumer -- refresh delegated token --------+
  verify metadata/hash/version
  < 3 MB and serialized request < 4 MB: download, base64, /me/sendMail
  otherwise: create draft, attach each file, /me/messages/{id}/send
       |
       v
Terminal campaign committed in D1
       |
       +--> POST /drives/{driveId}/items/{itemId}/permanentDelete
            mark metadata deleted only after Graph returns 204
```

The browser receives only an upload-session URL scoped to the selected destination and valid for a short time. It never receives the Graph access or refresh token. Microsoft says the upload-session `PUT` must omit the Authorization header: [driveItem createUploadSession](https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0).

## Upload, read, and delete APIs

1. Create or read the app root: `GET /me/drive/special/approot`.
2. Create an opaque per-set folder below approot, then create an upload session: `POST /me/drive/items/{approot-or-parent-id}:/{opaque-name}:/createUploadSession`.
3. Browser uploads sequential byte ranges to the returned `uploadUrl`. OneDrive permits each range below 60 MiB and requires non-final fragments to be multiples of 320 KiB. A 5 or 10 MiB multiple is suitable for the browser-to-OneDrive step.
4. Verify the resulting drive item by ID with `$select=id,parentReference,name,size,eTag,cTag,file`. `quickXorHash` is the only file hash Microsoft guarantees across work/school and home; Graph explicitly says its `sha256Hash` field is unsupported. Keep the browser-computed SHA-256 as an independent test checksum, and store/compare QuickXorHash for Graph metadata checks: [hashes resource](https://learn.microsoft.com/en-us/graph/api/resources/hashes?view=graph-rest-1.0).
5. Get a short-lived preauthenticated download URL from `GET /drives/{driveId}/items/{itemId}?$select=id,@microsoft.graph.downloadUrl`. Range requests must be sent to that URL, not to `/content`: [Download driveItem content](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0).
6. At terminal state use `POST /drives/{driveId}/items/{itemId}/permanentDelete`. Ordinary `DELETE` is insufficient because it moves bytes to the recycle bin; `permanentDelete` returns 204 and does not create a recoverable recycle-bin item: [driveItem permanentDelete](https://learn.microsoft.com/en-us/graph/api/driveitem-permanentdelete?view=graph-rest-1.0).

The `permanentDelete` API page lists delegated `Files.ReadWrite`, not the narrower `Files.ReadWrite.AppFolder`, while the App Folder documentation says the scoped permission allows delete operations within the folder. This ambiguity must be resolved by the USM tenant test. If `permanentDelete` returns 403 with only the App Folder permission, the strict immediate-deletion requirement is a no-go unless Microsoft confirms support or the user explicitly accepts broader `Files.ReadWrite`. Ordinary recycle-bin deletion is not an equivalent fallback.

The App Folder documentation warns that the user can edit, replace, or delete its files. MailFlow therefore cannot treat storage location as immutability. It must lock its own attachment-set API, use opaque item names, retain the original item/version identifiers and hashes, and fail before sending if size, eTag/cTag, version, or QuickXorHash changes. Version-pinned reads should be tested and preferred if the USM drive exposes a durable uploaded version.

## Mail-delivery strategy

### Small path

`POST /me/sendMail` may include `fileAttachment` objects and needs only `Mail.Send`. Use it only when:

- every attachment is under 3 MB; and
- the complete serialized Graph write, including base64 expansion, message HTML, recipients, and JSON, is below Graph's 4 MB write-request limit.

The second condition matters with several files. Base64 expands bytes by about one third, so five individually small files can still exceed the request limit. The existing stopped branch's 2 MiB combined cap was a sensible conservative small-path ceiling, but it does not meet the new 25 MiB product requirement. Sources: [sendMail with a file attachment](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0) and [Graph 4 MB write limit](https://learn.microsoft.com/en-us/graph/use-the-api#http-methods).

### Draft path

Use a per-recipient draft whenever any file is at least 3 MB or the direct JSON request would exceed 4 MB:

1. `POST /me/messages` to create the personalized draft. Requires `Mail.ReadWrite`.
2. For each file under 3 MB, `POST /me/messages/{draftId}/attachments` with one file attachment. Requires `Mail.ReadWrite`.
3. For each file from 3 MB through the product cap, `POST /me/messages/{draftId}/attachments/createUploadSession`, then upload sequential ranges to the preauthenticated Outlook URL. Microsoft recommends range requests below 4 MB. Requires `Mail.ReadWrite` for session creation.
4. `POST /me/messages/{draftId}/send`. Requires `Mail.Send` and returns 202 when accepted.

Sources: [Create message](https://learn.microsoft.com/en-us/graph/api/user-post-messages?view=graph-rest-1.0), [Add small attachment](https://learn.microsoft.com/en-us/graph/api/message-post-attachments?view=graph-rest-1.0), [Outlook large attachments](https://learn.microsoft.com/en-us/graph/outlook-large-attachments), and [Send existing draft](https://learn.microsoft.com/en-us/graph/api/message-send?view=graph-rest-1.0).

The queue state machine must persist the draft ID and delivery phase. Failures before the final send are safe pre-send failures. A connection loss during or after the final `send` request remains `unknown` and is never retried automatically. A stale draft should be cleaned up with a separate, bounded recovery action; the preauthenticated Outlook upload URL is sensitive and should not be stored unencrypted in D1, Queue messages, logs, or audit events.

### Product size cap

The user-supplied USM policy says attachments must be under 25 MiB. Before implementation, the tenant test must determine whether that is a per-file raw limit, a combined raw-attachment limit, or a whole-message transport limit. Exchange message-size enforcement can include headers, body, and roughly 33 percent transfer-encoding growth. Until tested, MailFlow should treat **25 MiB as an exclusive combined raw-attachment ceiling** and reserve headroom for the message body; do not promise that a 24.99 MiB file will be accepted externally. See [Exchange message-size encoding guidance](https://learn.microsoft.com/en-us/exchange/mail-flow/message-size-limits).

## Cloudflare Free feasibility

Current official limits relevant to this design:

| Limit | Workers Free / Queues Free | Design response |
| --- | --- | --- |
| CPU | 10 ms per invocation | Do not hash, parse multipart, or copy a 25 MiB upload in the Worker. Browser computes hashes and uploads directly. Queue forwarding uses streams. Benchmark the small-path base64 conversion. |
| Memory | 128 MB | Never buffer the large path. Process one attachment/range at a time. |
| External subrequests | 50 per invocation | A 25 MiB file in approximately 4 MiB Outlook ranges needs about seven range downloads and seven PUTs, plus metadata, draft, session, token, and send calls. One recipient remains below 50. Reject a OneDrive range response that ignores `Range` and returns the full file. |
| Simultaneous outgoing connections | 6 | Keep the delivery state machine sequential. |
| HTTP request body | 100 MB on Cloudflare Free account plan | Not the primary constraint because browser file bytes bypass the Worker. |
| Queue message | 128 KB | Carry IDs only. Current `{ type, campaignId }` is already suitable. |
| Queue wall time | 15 minutes | One recipient per invocation remains appropriate. Network wait does not consume CPU, but slow sessions must be tested. |
| Queue operations | 10,000/day; 24-hour retention | The current paced tick chain fits ordinary prototype campaigns, but long pauses can outlive retention and already require explicit resume behavior. |

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers streams](https://developers.cloudflare.com/workers/runtime-apis/streams/), [Queues limits](https://developers.cloudflare.com/queues/platform/limits/), and [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/).

One additional Microsoft constraint controls pace. Outlook limits one app/mailbox combination to 150 MB of uploaded `POST`, `PUT`, and `PATCH` data per five minutes. Re-sending the same attachment bytes to every recipient counts repeatedly. At 25 MiB per recipient, the theoretical ceiling is about six messages per five minutes before accounting for drafts, bodies, and safety margin. MailFlow's current default of 12 messages per minute is therefore not feasible for large attachments. Attachment campaigns need a size-aware pace, a conservative safety factor, and `Retry-After` handling. See [Microsoft Graph Outlook throttling limits](https://learn.microsoft.com/en-us/graph/throttling-limits#outlook-service-limits).

## Exact repository changes

The current production branch has no attachment schema, no storage binding, and a one-call `MailProvider.send` queue path. The stopped R2 work exists only in unreachable local commits and was not deployed.

Required changes:

1. **Auth:** add delegated `Files.ReadWrite.AppFolder` and `Mail.ReadWrite` to `src/server/microsoft/config.ts`, make missing granted scopes explicit, and require reauthorization for existing sessions/tokens.
2. **Microsoft adapter:** add an App Folder adapter for approot, folders, drive-item metadata, download URL, and permanent delete. Extend the mail adapter with direct-small and draft/upload-session strategies.
3. **D1 migration:** replace the stopped R2 `object_key` model with `drive_id`, `drive_item_id`, optional `drive_item_version_id`, eTag, cTag, QuickXorHash, client SHA-256, deletion state, cleanup attempts, and last cleanup error. Add draft/progress fields to recipient jobs or a dedicated delivery-attempt table.
4. **API:** create attachment-set and upload-session routes that accept metadata only; return a short-lived OneDrive upload URL; finalize an upload only after server-side ownership, parent-folder, size, and hash verification. Campaign creation accepts only an owner-scoped locked attachment-set ID.
5. **Client:** the stopped branch's five-file selection, validation, review summary, and attachment-set lifecycle can be adapted. Replace its same-origin Worker byte upload with direct range PUTs to OneDrive and show quota/consent/tamper/cleanup errors.
6. **Queue:** keep ID-only tick messages. Before Graph mail submission, verify the locked drive items. For the large path persist draft phase and upload progress, stream exact OneDrive ranges into Outlook attachment sessions, then perform the single ambiguous final send boundary.
7. **Terminal cleanup:** after the terminal campaign transaction commits, call `permanentDelete` for every item. If cleanup fails, persist `cleanup_pending` and enqueue an ID-only cleanup retry. Do not report bytes deleted until every call returned 204 or a verified 404.
8. **Pacing:** derive the maximum rate from serialized/raw attachment bytes and the Outlook 150 MB/five-minute upload limit. The member may choose a lower rate, never a higher unsafe rate.
9. **Documentation and tests:** update the current attachments-out-of-scope boundary only after the tenant gate passes. Add mocked Graph, D1 migration, queue resume, tamper, cleanup, ambiguous-send, Free-limit, and browser-upload coverage.

Safe reuse from the stopped branch: UI interaction, filename/type/count policy, owner-scoped metadata repository patterns, and direct-small Graph serialization tests. Do not reuse its R2 binding, object keys, Worker upload body handling, 2 MiB-only product assumption, or one-step queue delivery design unchanged.

## USM feasibility test and current blocker

On 2026-09-02, read-only dynamic OAuth probes tested the two proposed delegated permissions independently against the primary USM student identity. `Files.ReadWrite.AppFolder` reached the normal Microsoft user-consent screen, proving that this scope is not tenant-blocked for that account. `Mail.ReadWrite` reached Microsoft's administrator-approval screen, proving that this scope is blocked by the effective USM tenant policy for an ordinary student. Neither permission was accepted, granted, or added to the live app registration.

The production Entra app and stored refresh tokens therefore still cover only `User.Read` and `Mail.Send`. The card-free OneDrive storage concept can proceed to an authorized App Folder API test without administrator consent for the primary account, but the 3 MB to product-limit Outlook draft path cannot proceed without USM administrator approval for `Mail.ReadWrite`. Creating approot, granting consent, or changing the live app registration remains an external tenant-state change.

Minimum authorized manual test:

1. In the existing single-tenant MailFlow registration, add delegated `Files.ReadWrite.AppFolder`. Add delegated `Mail.ReadWrite` only for the draft/large-send test. Do not add application permissions.
2. Start a fresh MailFlow authorization request containing the new scopes. Record only whether ordinary user consent succeeds, an approval workflow appears, or an administrator must consent. Never record tokens or account addresses.
3. With the refreshed token, call `GET /me/drive?$select=id,driveType,quota` and `GET /me/drive/special/approot?$select=id,name,parentReference,folder`. Confirm a work/school drive, non-exceeded quota, and approot creation.
4. Create an opaque test folder and upload one non-sensitive synthetic file through a OneDrive upload session directly from the browser. Use at least 4 MiB to exercise resumable upload and store no upload URL in logs.
5. Compare browser SHA-256, browser QuickXorHash, returned size, and Graph QuickXorHash. Download the item and compare SHA-256.
6. Force an access-token refresh, then execute the same metadata and download checks from a background/queue-style Worker invocation. This proves the encrypted refresh token and new granted scopes survive after the browser closes.
7. Lock the attachment set. Confirm MailFlow rejects modification. Then deliberately replace the synthetic OneDrive item with same-size different bytes and prove the queue preflight detects eTag/cTag/QuickXor mismatch before any mail call. If version-pinned reads are implemented, prove the stored version still returns the original checksum.
8. Re-upload a clean item. With explicit real-mail authorization, send one small-path message and one draft/upload-session message to self or one approved recipient. Record Graph acceptance, Sent Items observation, and inbox receipt separately. A 202 is not delivery proof.
9. Mark the test campaign terminal and call `permanentDelete`. Require 204, then verify item lookup returns 404. Record the timestamp and sanitized result only.
10. Repeat approot, background refresh, and permanent-delete checks with the second USM test account before release.

## Acceptance criteria

Production implementation remains no-go until all of these are true:

- Both USM accounts can consent or the required tenant administrator grants the exact delegated scopes.
- `GET /me/drive/special/approot` works through Microsoft Graph v1.0 for both accounts.
- Direct browser upload works without exposing an access/refresh token or sending file bytes through the Worker.
- Quota is checked and over-quota/read-only states are human-readable.
- A locked attachment set contains at most five files, uses an exclusive combined size cap derived from the confirmed USM rule, and every campaign recipient references the same set.
- Metadata and checksum tampering is detected before Graph mail submission.
- Small direct requests are proven below 4 MB after serialization.
- The 3 MB to product-limit draft/session path resumes safely and stays below 50 Worker subrequests and 128 MB memory.
- Attachment-aware pacing stays below Outlook's per-mailbox upload throttle with headroom.
- Network ambiguity after the final send becomes `unknown` with no automatic resend.
- Terminal cleanup uses `permanentDelete`, retries by identifier only, and never claims deletion before 204 or verified 404.
- Graph 202, Sent Items, and recipient inbox observation are recorded as three distinct facts.
- Typecheck, unit/integration tests, build, Wrangler dry run, browser upload QA, and a controlled two-account real-mail matrix pass.

## Estimated implementation scope

Estimated focused engineering effort after tenant permission approval: **12 to 17 engineer-days**, roughly two to three calendar weeks for one experienced contributor.

- App Folder adapter, incremental consent, quota, and upload-session API: 2 to 3 days.
- D1 migration, repositories, lifecycle, and cleanup recovery: 2 to 3 days.
- Browser upload and attachment UI adaptation: 2 to 3 days.
- Direct-small plus draft/large mail state machines and streaming: 4 to 6 days.
- Pacing, tests, tenant verification, operations, and documentation: 2 to 3 days.

The preview permission, USM consent response, actual OneDrive range behavior, and physical runtime CPU measurements are schedule risks. A small-only release capped near the stopped branch's 2 MiB combined limit would be materially smaller, but it would not satisfy the stated 25 MiB goal.
