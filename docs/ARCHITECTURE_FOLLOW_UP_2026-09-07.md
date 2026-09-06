# Architecture follow-up: 2026-09-07

The implementation was based on remote `main` at `1b64123`. The earlier assessment inspected an older local tree; several recommendations had already reached remote main. Existing local work and other worktrees were preserved.

| Assessment area | Resolution in this follow-up |
| --- | --- |
| Draft versus immutable preparation, lost-response retries | Retained current main's preparation lock, exact request reuse and explicit New send transition; existing lifecycle regressions pass |
| Mail authorization recovery | Added preparation before row/lease acquisition, explicit reconnect disposition in SMTP and Graph, atomic pending/reservation/pause settlement, owner reconnect/resume, and cancellation/rollback regressions |
| Explicit reusable-template publication | Retained unpublished campaign snapshots and recipients-preserving template selection; made version allocation, name update and current-pointer publication transactional with stale-version conflicts |
| Outcome and diagnostics contract | Retained current main's separate failed/unknown/verified states and SMTP/API correlation evidence; added mail-recovery audit categories, allowlisted background error classification and aggregate operational health SQL |
| Application boundaries | Shared service construction accepts bindings/origin directly; background entrypoints no longer fabricate HTTP contexts; public campaign responses use an explicit allowlist; retained extracted attachment/validation coordination |
| Integration seams | Added adapter/queue/D1 recovery, failed transaction, slow preparation, stale template, API resume and cursor/UI regressions; actual local D1 proves competing publication behavior |
| Loading, history and operations | Retained deferred routes/ExcelJS; added owner-scoped history cursors and recoverable older-page UI; documented migration, capacity targets, retention and fail-closed database restore |

Validation: `npm run check:staging` passed TypeScript, production build, initial bundle guard, 346 tests in 43 files, production packaging dry run, isolated staging build/configuration, and staging packaging dry run. Initial JavaScript measured 83.92 kB gzip within the existing 110 kB budget. Seven product route entries defer ExcelJS. The maximum-size deferred ExcelJS chunk still produces Vite's size advisory.

Browser checks used local synthetic API fixtures: history failure/retry retained rows; phone history remained keyboard-accessible within its horizontal table scroller; reconnect state preserved distinct pending/accepted/unknown counts; stale publication kept the editor open and allowed recovery as a new template. Reconnect was inspected at 1440 x 900, 1024 x 768, and 390 x 844, with a narrow-screen button-wrap fix. History and conflict dialogs were checked at desktop and phone sizes. Fresh browser startup had no console warnings/errors. Temporary preview files were kept outside production imports and removed after verification.

Cleanup removed five obsolete recipient-job screenshots and two old browser capture/log files from the original checkout (890,686 bytes total). Approved design mocks, reusable fixtures, local secrets, D1 state, and other worktrees were preserved.

Release requirement: apply forward migration `0012_mail_authorization_recovery.sql` after 0010/0011 and before deploying the Worker. This work does not deploy, migrate remote databases, or submit real mail. Hosted multi-mailbox latency, OneDrive throughput, and a full isolated Cloudflare backup/restore drill remain explicit operational validation gates in `OPERATIONS.md`; the deterministic tests do not certify those properties.
