# ZENO Mini Order — Operations (PR7)

Status: code/tests/runbooks prepared for `develop`. This is not evidence of a production deployment, live bank validation, completed restore drill or pilot sign-off. PR5/PR6 merging does not prove any of those gates.

## Deploy and scheduler

Payment jobs run on **Neon Functions + scheduled triggers**, declared in `neon.ts`: expiry every 5 minutes, reconciliation every 15 minutes. They do not use Vercel Cron, `pg_cron`, `CRON_SECRET` or public Nuxt cron endpoints. Keep `PAYMENT_JOBS_ENABLED=false` until the correct Neon branch, migrations, function secrets, trigger delivery and real-account behavior have been checked. An environment label alone does not attest the database endpoint.

1. Export env from the intended explicit Neon project/branch. Compare endpoint identity with Console. Restart the app after switching branches.
2. Run `npm run check:env -- --file <production-env> --target production --compare <test-env>` locally; never attach env files to issues or artifacts.
3. Snapshot/record the production restore window before any production migration. Deploy migration `0006_hardening_ops` before code that reads heartbeats; `npm run db:check` only checks migration consistency, not application against a live DB.
4. Deploy application and Neon function against the same migrated branch; supply its correct encryption key. Enable triggers only after branch-specific rehearsal. Verify actual cadence/retries in Neon Console. The application uses leases, idempotent imports and run-ID-fenced heartbeats; duplicate deliveries are expected, not grounds for disabling deduplication.
5. Run read-only smoke: `OPS_STATUS_SECRET=<from-secret-manager> npm run smoke:prod -- https://your-origin --slug your-store` (set secrets through the environment, not literal shell history).

Neon docs: https://neon.com/blog/your-neon-functions-can-now-run-on-a-schedule

## Health and alerts

`GET /api/internal/status` requires a distinct bearer `OPS_STATUS_SECRET` (at least 32 characters). Owner/staff JWTs are not operations credentials. All responses are `no-store`. It returns counters/reason codes, never integration IDs, customer fields or provider error messages. Missing/short configuration or DB failure is 503; invalid bearer is 401.

| Condition | Failure threshold |
|---|---|
| Jobs explicitly disabled | immediate |
| Expiry success missing/old, or latest run failed | 15 minutes |
| Reconcile success missing/old, or latest run failed | 45 minutes |
| Any ACTIVE live integration with API token missing/stale checkpoint, or last error | 45 minutes |
| RECEIVED transaction awaiting matching | over 10 minutes |
| PENDING attempt past expiry | over 10 minutes |

Manual-only integrations and REVIEW_REQUIRED counts are visible but do not automatically fail health. A human must review these queues; webhook-only integrations cannot independently recover missed events through the API. A quiet bank account is not unhealthy merely because no new webhook arrived. Health is operational telemetry, not proof of financial correctness. First enablement is unhealthy until successful job runs/checkpoints exist. Long backfills remain unhealthy until caught up. Backlog queries include all retained app data, so retire stale test integrations/data before production.

`ops-watch.yml` is an optional **read-only monitor**, disabled until repository variable `OPS_WATCH_ENABLED=true`. Configure `OPS_BASE_URL`, optional `OPS_STORE_SLUG` and secret `OPS_STATUS_SECRET`. This workflow does not perform payment work. GitHub scheduled workflows run from the default branch and may be delayed; a file only on `develop` does not guarantee scheduled execution. Before relying on it, verify the repo default branch/workflow availability and a deliberate failed probe reaching the intended operator via Actions notification settings. Otherwise dispatch on `develop` manually or use an independent uptime service. Do not claim alerts work until a person has received a test failure. Neither code merging nor setting the opt-in constitutes this verification.

## Headers, IPs and privacy

Production middleware enforces no framing, no referrer, nosniff, permissions restrictions and HSTS (HTTPS termination must be verified on the actual host). APIs/auth/order pages use no-store except successful public menu/fulfillment cache rules. CSP permits configured HTTPS Neon Auth and S3 origins, self-hosted fonts and `qr.sepay.vn`. It currently allows inline scripts/styles for Nuxt hydration, color mode and dynamic UI styles. This **is not a strict nonce-based CSP**; Vue escaping and absence of unsafe HTML sinks remain necessary. `unsafe-eval` is not allowed. New external origins require deliberate policy change and browser regression, never a blanket `https:` source.

On direct Node hosts, the socket peer is authoritative. Never expose the origin publicly while trusting forwarded headers. Only an ingress that overwrites XFF may use `TRUST_FORWARDED_FOR=1`; default is 0. The existing optional Vercel adapter reads the platform-specific overwritten header only when `VERCEL=1`; payment scheduling remains Neon. If the chosen host proxies every connection, verify its IP contract before enabling checkout: otherwise all customers appear as one peer and share the per-store checkout allowance. Bare Neon Functions scheduling does not automatically establish the Nuxt host's ingress contract.

Tracking is 40/minute/capability with a high 2000/minute/IP ceiling; menu/fulfillment is 120/minute/store/IP; checkout retains 10/10 minutes/store/IP, with idempotent replays exempt. Webhook ingress/failure limits remain 600/minute/IP and 20 failures/10 minutes/IP. Keys are hashed. Limits fail closed on DB outage. These are DB-backed fixed windows, not a substitute for network/DDoS protection. Rate counters need a retention policy: delete old rows (`window_start < now() - interval '1 day'`) in a reviewed maintenance window/job on the correct branch; PR7 expiry housekeeping handles this only after jobs are enabled.

Application access/error logs record route shapes, never queries, raw capabilities, body or headers. Hosting/CDN/Neon platform access logs are outside that logger: configure masking/exclusion for `/o/*`, webhook endpoints and invitation URLs and limit log retention before pilot. Browser traces/screenshots/test logs may contain fixture bearer URLs; CI uses synthetic data, artifacts expire after 7 days. Never upload real-customer traces.

## Backup, restore and rollback

Check the plan's actual restore window/snapshot capability in Neon Console. Neon database snapshots do not prove that Auth identities, object storage, external bank records or application encryption keys can be recovered. Preserve encryption keys in the secret manager with access-controlled recovery instructions.

Use a dedicated **quiescent** `restore-source-*` rehearsal branch with synthetic data and jobs disabled; never use production in the drill script. `npm run ops:restore-drill -- restore-source-example` is a dry run. With explicit project/API credentials and `ZENO_RESTORE_DRILL=1`, add `--execute` to attest the endpoint, fingerprint app/migration rows, snapshot, restore into a new temporary branch **without finalize**, compare and clean up. Output is a redacted `test-results/restore-drill-*.json`; read it and verify Auth/storage separately. Network/provider failure may leave a rehearsal resource; inspect its generated name in Neon Console and remove it. The script never switches production computes. Do not mark the drill complete based on CLI `--help`, dry-run output or row counts alone.

On a production incident: close the store to new orders, disable payment triggers, record in-flight payments and deployment SHA, investigate the reconciliation queue, then roll application code back to the last compatible deployment. Migration 0006 is additive; leave its table in place during app rollback. Do not reverse financial writes or finalize a snapshot over incoming transfers. A production database restore requires a separately reviewed recovery plan, write freeze and reconciliation against the bank after recovery.

## Keys and dependency updates

**Do not replace `APP_ENCRYPTION_KEY` directly.** Existing integration secrets and guest capabilities use AES-GCM v1 and depend on that key. This release has no online multi-key decrypt/re-encryption protocol. Preserve the old key; rehearse a complete, transactional inventory/re-encryption migration with a backup and decrypt checks for *both* integrations and guest tokens before rotating. If compromise requires immediate response, suspend affected payment operations/access and follow a reviewed recovery plan. Re-entering only SePay secrets does not repair old guest tokens. No key-rotation rehearsal has been performed by this PR.

Rotate `OPS_STATUS_SECRET` separately on app and monitor together, verify old bearer rejected/new bearer accepted. SePay HMAC/API-key rotation is per integration and needs coordinated provider/app configuration plus real signed delivery tests; do not log either secret.

Run `npm run audit:runtime`. CI fails on unaccepted high/critical npm advisories; exceptions must match package/advisory, include a reason and have an expiry. The initial allowlist is empty. Dependency updates require lint, all tests and build, not an unrestricted `npm audit fix --force`. Moderate advisories are reviewed separately and recorded in the implementation report.

## CI Auth isolation

CI app databases/storage are disposable per-run Neon branches. Because fresh managed Auth provisioning on schema-only clones returned HTTP 412 even with verified role privileges, browser journeys use the existing non-production `test` Auth service. CI never relaxes its configuration. It requires compatible localhost/noninteractive signup settings and no external user-created webhooks, exports only its public Auth/JWKS URLs, namespaces synthetic emails by workflow run and cleans only those accounts through the Auth API. Other users and production Auth are untouched. A cancelled/crashed cleanup can leave synthetic accounts; rerun the scoped cleanup with the same run ID in an authorized CI context. Do not broadly delete Auth users or reset the shared `test` Auth schema. Standalone provisioning on a fresh branch is still unverified and must be resolved with the provider before relying on that deployment path.
