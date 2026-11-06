# PR6 — SePay payment webhook and Neon scheduled jobs

Baseline: `develop` at `50b9e634d35a97d00a3b08edf11df393503238ca` (PR #3). No production deployment, migration, bank transfer or SePay account operation is implied by this implementation.

## Behavior

- Authenticated raw UTF-8 webhook delivery is size-limited while streaming, checked with HMAC-SHA256 (`timestamp.raw_body`, ±300 seconds) or explicit API Key mode, then validated. No authentication fallback. The existing encrypted webhook-secret slot holds the credential for the selected mode; it is separate from the SePay API token. Changing mode invalidates prior webhook verification and pauses an ACTIVE integration until verified again.
- Tx1 persists the bank transaction and its provider identity. Tx2 matches it, records the payment, changes order/attempt state and appends audit events atomically. Success is returned only after the awaited commits. A failed Tx2 retains RECEIVED, returns failure and is recovered by retry or scheduled rematching. `id=0` is retained; the unverified dashboard-ping exception in the original plan is not enabled.
- Provider identities have a unique `(integration_id, source, provider_id)` constraint. Webhook integers and API v2 UUIDs use distinct namespaces. Order payment uniqueness and tenant-composite foreign keys are database safety nets.
- Automatic cross-source aliasing is OFF unless an integration UUID is explicitly listed in `SEPAY_VERIFIED_DEDUPE_INTEGRATIONS`, after real evidence. Even when enabled, matching requires a nonempty reference, identical bank/account/VA/amount/direction/instant and exactly one eligible counterpart. No fuzzy time matching. Without proof both reports remain visible; an already-paid order cannot be credited twice.
- Matching requires a live integration, linked account, normalized bank and snapshot receiver. For a VA attempt the VA itself must match, not merely the common parent account. Late-payment detection also considers transaction time against expiry, so a delayed cron does not make an expired QR timely.
- An organization-scoped shared/exclusive transaction advisory gate protects PR6 money mutations: single-order matching uses the shared gate, while cross-order assignment/refund and other writers take it exclusively. Independent orders can match in parallel. After that, row locking follows order then attempts, matching PR5 QR replacement. Bank-row mutations are protected by the same org mutex. PR5 replacement never acquires bank locks. Local lock/statement timeouts bound contention.
- Incorrect/missing code, wrong receiver, amount mismatch, second transfers and cancelled-order transfers remain in the owner review queue. Test integration money cannot auto-confirm or be manually assigned to a real order.
- Refund completion confirms the exact outstanding amount the owner saw (`expectedHeldVnd`). Accepted receipts track `refunded_at`; late-transfer review records resolve individually. Resolving one of several transfers cannot clear the remaining obligation. A new transfer after refund reopens REFUND_DUE.
- New owner APIs use existing store-owner guards, tenant predicates and no-store headers. Review is org scoped (unmatched money has no store); refunds/overdue lists are store scoped. CASH behavior remains staff-accessible; BANK_MANUAL is owner-only with a note.

## Neon scheduler (supersedes Vercel sections of original plan)

`neon.ts` declares function `paymentjobs` (`functions/payment-jobs.ts`), with schedules:

| Trigger | Path | UTC cron |
| --- | --- | --- |
| payment-expiry | /expire | `*/5 * * * *` |
| payment-reconcile | /reconcile | `*/15 * * * *` |

Both schedules and the runtime guard default OFF. Enable only on the intended database branch using `PAYMENT_JOBS_ENABLED=true`. No Vercel Cron, `CRON_SECRET`, or public Nuxt internal-cron endpoints are added. Neon strips caller-supplied X-Neon headers; the handler requires the platform's trigger-invocation attestation. This handler must be hosted on Neon, never copied unchanged to a generic HTTP host.

Reconcile scans company pages once and scopes imports to linked receiver records and historical attempt snapshots. It uses a 30-minute overlap and 2-minute settle delay, safe integer validation, page/elapsed-time limits, pacing before every API request, failure recording and retry on a later trigger. A 429 also delays subsequent integration processing, respecting Retry-After up to the job's bounded wait. Checkpoints only advance on complete window success and never go backwards. Long initial history is backfilled in bounded windows from outstanding attempts. High-volume windows exceeding the page cap remain failed (no checkpoint advance); operators can reduce `SEPAY_RECONCILE_MAX_WINDOW_HOURS` (1–48; default 48) to split the scan window before enabling auto-cancellation at that scale.

Per-integration leases prevent overlapping scheduled scans; crashed workers release by expiry. Processing is idempotent on retry. Expiry and auto-cancellation are distinct: cancellation rechecks eligibility under the order lock and requires contiguous successful historical coverage through a recent settled window, a live ACTIVE provider/API token, no fresh attempt and no relevant pending/review money. Missing coverage/token means no automatic cancellation.

## Verification

Local checks before PR creation:

- Unit + Nuxt: 113 files, 1,236 tests passed.
- ESLint and Nuxt typecheck passed.
- Neon function dependency graph typechecked independently and bundled with esbuild.
- Production Nuxt build passed.
- `drizzle-kit check` passed with a placeholder connection string (static migration validation only).
- Exactly one additive migration: `0005_payment_webhook.sql`. It has NOT been applied locally: no test database credentials are available in this workspace.

Integration/API/E2E execution is pending. The PR includes schema, duplicate/concurrency, rollback recovery, tenant HTTP matrix, QR-replacement race, late-payment, refund accounting, coverage and lease regressions. Code/test presence is not evidence that those database-backed tests passed. CI uses its existing isolated Neon branch and explicitly pulls Postgres/Auth/Storage env, without requiring Functions deployment. CI results must be recorded separately. Git push was blocked by automatic approval review, so no remote branch/PR/CI run has been created in this session.

## External gates — still open

| Gate | Evidence required |
| --- | --- |
| Neon environment | Supported Functions region, actual deployed function/runtime/secret injection, schedule authentication and scale-to-zero delivery; verify branch isolation and disabled inherited triggers |
| SePay API | Actual project token works in the selected live/sandbox environment; Bearer scheme is documented, token access is not tested |
| Cross-source identity | Compare webhook integer ID/reference/account/VA/time to the API v2 UUID record for the same actual transfer before enabling aliasing |
| Webhook retry | Real HMAC/API Key delivery, stale timestamp/retry/manual replay behavior and success-body contract |
| Bank/VA | Real accountNumber/subAccount/gateway mapping for each bank used; test-mode vs live signatures and dashboard ping payload |
| PR5 bank gates | Real QR scans/receiver/content on bank apps, real small transfer, mobile clipboard/image save; PR #3 merge does not close them |

No production-readiness or real-bank verification claim is made until these gates and database-backed checks have evidence.

Sources checked 2026-11-06: https://neon.com/docs/compute/functions/triggers/schedule ; https://neon.com/docs/compute/functions/get-started ; https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc ; https://developer.sepay.vn/vi/sepay-api/v2/xac-thuc ; https://developer.sepay.vn/vi/sepay-api/v2/giao-dich/danh-sach .

## CI review after publication

Run #7: lint, Nuxt/Functions typecheck, unit/Nuxt and build passed; migration applied and checked on an isolated Neon branch. Integration: 476/477 passed. The single multi-order burst failure was PostgreSQL 55P03 at the exclusive organization advisory lock (5-second wait), not a deadlock or duplicate credit. Matching now takes a shared organization gate before bank/order locks; multi-order mutations retain the exclusive gate. The burst regression and lock timeout remain unchanged. API was skipped after the integration failure.

The database CI suite now uses two Vitest integration shards and an API shard, each with its own separately created, validated and cleaned-up Neon branch. Tests still run serially within each branch; no assertions or tests are skipped. Follow-up CI results are recorded in PR #4.

Run #8: both integration shards executed all 40 files: 241/241 on shard 2 and 235/236 on shard 1; API 407/407 passed. The remaining burst failure is the test's 30-second total budget, not a PostgreSQL lock error. The fixture now bulk-inserts the nine RECEIVED rows; the same nine concurrent matcher calls and all assertions remain, with the original 30-second timeout. Tx1 recording/dedupe retains separate concurrency coverage. No production behavior changed in this fixture adjustment.
