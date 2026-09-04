# Input hardening release audit

Date: 2026-09-05. Initial base: `7e14f4c07d7eb2dc10ce9696cf1d4e3f5b19934b`; rebased onto `efa001f` after concurrent attachment-recovery production release.

## Reconciliation and changes

PRs 5 and 6 are present on the base: bounded 8 MiB campaign requests, fingerprinted idempotency, atomic D1 recipient chunks and snapshot triggers, bounded OneDrive reads, transient pre-claim retry, integrity failures, MIME chunking, and resumable cleanup. The authoritative mailbox scheduler, rolling 8,000-recipient budget, recipient pagination, self-only tests, chained authorization, and exact-candidate staging workflow remain intact. This PR does not reimplement them. The rebase also preserves the new attachment authorization-pause/backoff recovery, campaign failure UI, migration 0009, and all five new AttachmentError categories.

Demonstrated remaining gaps addressed here:

- Legacy Office types were still allowed. Browser metadata validation accepted mismatched allowed MIME labels, and server validation accepted arbitrary non-executable bytes labeled as PDF, images, or Office. One shared pure policy now rejects those cases before upload and again before OneDrive persistence.
- Office package checks identify central/local ZIP structure, document subtype parts, required packaging entries, duplicated/overlapping names, encryption, obvious VBA parts, and bounded declared expansion. PDF, PNG, and JPEG have signature checks. Text uses strict UTF-8 or BOM-marked UTF-16 decoding and rejects binary controls. The five-file/20 MiB aggregate limit is unchanged.
- Unsupported spreadsheet filenames fell back to CSV. CSV decoding replaced malformed bytes, rows/columns/cells were unbounded, and malformed closing quotes were accepted. Import now rejects these inputs, bounds file bytes before reading in the UI, and clears a previous table when replacement import fails. Header keys stay inside the API field-name limit.
- Email validation allowed envelope delimiters, controls, and malformed mailbox syntax. Browser/domain/SMTP use one ASCII dot-atom rule, and resolved API array entries must each contain exactly one mailbox.
- Missing dynamic fields could resolve inherited JavaScript properties. Rendering and required-value checks now require own properties.
- Non-campaign JSON had no pre-parse size cap. Multipart relied on a caller-supplied Content-Length. Both now enforce actual stream limits, and multipart accepts one file field only.
- Slash-separated HTML event attributes bypassed the Worker guard. The guard now rejects them. Subject controls and source-filename controls are rejected or removed, respectively. Template-save failures no longer reflect raw D1 diagnostics.

## Release evidence

| Area | Evidence and result |
| --- | --- |
| Automated gate | `npm ci`; focused policy, import, metadata, rendering, multipart/JSON, error-redaction and component tests; `npm run check:staging`: TypeScript, production builds, 27 files / 211 tests, production dry run, isolated staging build, staging guard and staging dry run pass. |
| Migrations | Fresh `.wrangler/input-release-check` local D1 applied 0001 through 0009 and reports no pending migrations. Production has no pending migrations. Staging has only the newly landed 0009 pending; the manual exact-candidate workflow will apply it before deployment. No remote migration was applied by this PR's local commands. |
| Cloudflare bindings | `wrangler.jsonc` and generated staging snapshot name distinct production/staging D1 IDs and Queues, SMTP, 300 recipients, pace 12, assets, and hourly `15 * * * *`. Staging has its own DLQ and `staging` object namespace. No R2 binding or runtime storage adapter exists. |
| Remote staging Queue/secrets | `wrangler queues info mailflow-staging-campaign-ticks` reports one producer and one consumer, both `mailflow-staging`. `wrangler secret list --env staging` returns only the three expected secret names; no values were read. |
| Entra | Read-only `az ad app show` confirms `AzureADMyOrg`, only Scope entries, and all three expected Web callbacks. Graph service-principal scope lookup identifies configured rollback permissions as Mail.Send and User.Read. Runtime OAuth configuration separately requests delegated SMTP.Send and Files.ReadWrite.AppFolder; no consent or token-grant operation ran. |
| Scheduler/retry | Reviewed campaign-tick, worker-runtime, D1 mailbox repository and regression coverage: attachment load precedes claim, lease/attempt acquisition precedes provider submission, wake tokens gate duplicates, accepted/unknown budget remains charged, and watchdog never requeues provider-bound unknown work. All relevant existing tests pass. |
| OneDrive isolation | Owner-scoped repositories, per-owner `/me/drive/special/approot`, opaque namespace-bearing object names, byte/hash verification, and bounded idempotent cleanup remain unchanged and covered by the full suite. No OneDrive API write/delete was performed. |
| Public endpoints | Worker routing and security tests cover anonymous 401s, unknown API 404s, no write-to-SPA fallback, same-origin/CSRF and ownership boundaries. Local in-app browser displayed the signed-out landing page without authorization. Hosted exact-candidate evidence is recorded in the PR after deployment. |
| CI/deployment | Verify has read-only repository permissions and runs dry runs only. Manual staging workflow checks out and verifies the supplied full SHA, serializes deploys, uses the staging environment, applies only staging migrations, and deploys the validated snapshot. Production was not deployed. |
| Secrets | `.env`, `.dev.vars` and test-account notes are ignored and absent from tracked Git history. High-confidence private-key, GitHub-token and credential-assignment pattern scans found zero matches in history and tracked text. This is a bounded pattern scan, not a proof about every possible secret encoding. |

## Limits and non-blocking observations

- Format identification is not antivirus or full document validation. Office attachment payloads are not decompressed or rendered by the Worker. Package limits bound declared expansion; ExcelJS still parses XLSX locally on the browser thread, so hostile or unusually complex workbooks may affect that user's browser. Moving parsing to a terminable browser worker is a separate performance/resilience workstream.
- PDF/image signature checks do not prove the document is readable or benign. Existing immutable attachment snapshots remain unchanged. New uploads enforce the discontinued legacy formats.
- The staging guard checks resource names, not the D1 UUID or every optional binding. The committed and generated configuration for this candidate was separately checked for exact UUIDs and absence of production stateful bindings. Strengthening that general guard is a future deployment-maintenance improvement; current configuration is correct.
- Production's Queue has no DLQ declared, unlike staging. Existing durable-wake recovery handles lost publishes and exhausted transport retries; adding a production DLQ is an operational follow-up outside this input PR.
- `npm audit --omit=dev` reports two moderate entries (ExcelJS and its transitive uuid), zero high or critical. The advisory concerns uuid v3/v5/v6 with caller-provided buffers; the installed ExcelJS call sites use v4 without buffers. No affected path was demonstrated, and the suggested ExcelJS downgrade is not taken.
- Existing dependency-comment and large client-chunk build warnings remain. No unrelated dependency or layout upgrade was made.

## Manual checks requiring later authorization

- Both test accounts' interactive SMTP and chained OneDrive journeys, including decline/recovery.
- Upload representative modern Office/PDF/text/image files through authenticated staging, verify Review names/sizes, and exercise removal/expiry cleanup in the authorized account's App Folder.
- Approved self-only and campaign submissions, downloaded attachment hashes, Sent Items and recipient inbox observation, and background pause/resume behavior. Microsoft acceptance alone does not establish delivery.
- OneDrive recycle-bin and scoped permanent-delete behavior before claiming immediate quota reclamation.

Format references: [Library of Congress OOXML family](https://www.loc.gov/preservation/digital/formats/fdd/fdd000395.shtml), [ZIP format](https://www.loc.gov/preservation/digital/formats/fdd/fdd000354), and [Open Packaging Conventions](https://wwws.loc.gov/preservation/digital/formats/fdd/fdd000363.shtml).
