# PR7 — Hardening implementation and evidence

Base: merged PR6 #4, `develop` `0ea7421ebe0d99a3f4b4d0a5341e1cb9056e937b`; the implementation worktree started from the identical tree. Target is `develop`, never `main`. Operational activation is separate from merging code.

## Plan reconciliation

The original 16-task proposal had stale Vercel cron interfaces and unsafe single-key rotation instructions. Its dated implementation override supersedes those examples. This mapping describes the actual code rather than claiming all original snippets were copied.

| Plan task | Implementation / regression |
|---|---|
| 1 Production harness | `tests/support/production-server.ts`, `tests/hardening/global-setup.ts`, shared EdDSA signer and `hardening` Vitest project; real `.output/server/index.mjs` |
| 2 Pilot data | existing transactional/idempotent `seedCatalog`, guarded dry-run `scripts/seed-pilot.ts`; no fake owners/accounts/verification/paid orders; tables/zones configured through UI |
| 3 Route inventory | filesystem-discovered routes in `tests/support/route-inventory.ts`; guard/classification checks in production tenant matrix |
| 4 Sanitized logs | route shapes only in access logs and API error logs; no query/headers/body/raw resource IDs; canary production log regression |
| 5 Tenant matrix | every discovered org/store route rejects anonymous, foreign owner, disabled staff; owner-only paths reject staff; existing API suite covers same-org other-store/resource attacks and positive roles |
| 6 Public leaks | delivery PII canaries, public tracking exclusions, log and client asset secret scans; checkout capability is intentionally returned to its creator |
| 7 Headers | production security middleware; deny framing/no-referrer/no-store on private routes, configured auth/storage/VietQR CSP; inline Nuxt scripts/styles documented limitation |
| 8 XSS/CSRF/audit | browser hostile-text regression, cookie-only auth rejection; Bearer API boundary; npm runtime gate with expiring exact advisory exceptions (initially empty) |
| 9 Rate limits | centralized policies, validated trusted-ingress IP, hashed counters, per-token tracking and high shared-IP ceiling; concurrent menu, forged XFF, checkout replay regressions |
| 10 Accessibility | axe serious/critical WCAG gate, hydration/CSP/viewport, drawer focus/Escape/return, keyboard/44px controls on production browser suite |
| 11 Performance | production Lighthouse mobile performance >=80, accessibility >=95, LCP <=2500ms, CLS <=0.1, initial script gzip <=400KiB; reports retained; no claim before run |
| 12 Existing journeys | desktop Chromium added; existing customer/owner/payment suites run with production browser config on all 3 projects |
| 13 Operations/cron | Neon POST boundary retained, global scheduled leases + run-ID-fenced heartbeat; partial reconciliation fails; private status worst integration/checkpoint/backlog; optional read-only watcher, off until configured |
| 14 Restore | dedicated quiescent synthetic `restore-source-*`, explicit endpoint attestation, no-finalize snapshot restore, exact table/migration data fingerprints, resource cleanup/report; Auth/storage/keys separately reviewed |
| 15 Env separation | validator, private read-only smoke, CI schema-only branches; CI-only attested app-schema rebuild avoids missing journal rows and preserves Auth schema; isolated fresh app migrations |
| 16 Operations/pilot | operations, executable go-live checklist, pilot runbook/report, structural evidence validator; no false bank/restore/alert sign-off |

## Changes requiring particular review

- Additive migration `0006_hardening_ops`: global operational metadata only (`payment_job_runs`). No new public financial write surface.
- Expiry/reconcile use distinct scheduled leases; actual heartbeat written inside the lease and fenced by random run ID. Skipped overlapping invocations do not refresh health. Provider/SQL error messages are never persisted to heartbeat. Per-integration checkpoint errors remain visible independently.
- Reconciliation may successfully import some transactions and later fail. Imports remain committed/idempotent; the job fails and its heartbeat stays unhealthy. Stuck rematches are detected by backlog age. No financial semantics or PR6 advisory lock order changed.
- Forwarded IP trust is disabled by default outside an explicit host contract. The actual Nuxt ingress must be checked before production; Neon scheduler deployment alone does not prove how HTTP customer traffic is proxied.
- API test JWT override is also rejected on non-Vercel production, unless it is the explicitly flagged isolated production-build test harness. Actual `production` branch always rejects it.
- The monitor has no production opt-in enabled by this PR. GitHub schedules require default-branch availability; manual `develop` dispatch or an independent monitor is necessary until that contract is established.
- CSP still permits inline Nuxt scripts/styles. Platform access logs, real devices and auth/storage recovery need deployment review beyond application tests.

## Validation state

Local and final CI results will be recorded after the final patch. A local build/typecheck or migration generation with a placeholder URL is not a live database migration result. Isolated Neon CI can verify migration/transactions/API behavior but not a bank account's real SePay delivery contract.

Real SePay HMAC/API-key payloads, webhook integer/API UUID correlation, VA receiver mapping, actual API v2 plan/pagination, bank-app QR, late payments from a real bank, deployed trigger cadence/retries, operator alert receipt, restore rehearsal, physical devices and pilot bank totals remain **unverified**. See `docs/pilot-report.md`.

## Sources checked

- Neon schedule trigger/POST/attestation contract: https://neon.com/blog/your-neon-functions-can-now-run-on-a-schedule
- Neon CLI 8.4.1 `snapshots create --help`, `snapshots restore --help`, global `--help` (read-only help, not a completed restore).
- Neon create-branch action schema-only input: https://github.com/neondatabase/create-branch-action/blob/main/action.yml
- Vercel optional HTTP ingress header adapter: https://vercel.com/docs/headers/request-headers (not used for payment scheduling).
- OWASP HTTP/CSP baseline: https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html
- Runtime advisories motivate patched Nuxt/DOM/validation dependencies; pinned versions and regression run are tracked in this PR. No blanket force-fix or permanent advisory waiver.

### Local verification before opening PR

- 1,087 unit tests and 182 Nuxt tests pass after updating compatible test utilities (Nuxt 4.6.4, test-utils 4.3.4, Vitest 5.1.0, Happy DOM 21.0.4, Zod 4.6.7). The Nuxt patch required explicit imports for template-only utilities and a typed dynamic API wrapper; no typecheck was disabled.
- Production build, Nuxt typecheck, Functions typecheck, strict hardening-suite/script typecheck and lint pass. Migration generation is local-only with a placeholder URL; applying it requires isolated Neon CI.
- Runtime audit gate passes without high/critical exceptions. Moderate findings are not waived by this threshold; review their advisory report during maintenance. There is no claim that npm reports zero advisories.
- Local Playwright browser download produced an invalid/truncated archive, so no local browser pass is claimed. CI browser installation/execution is still required.
- New production HTTP/tenant/status and real Postgres tests are pending their isolated Neon CI execution. No production env, migration, schedule or pilot was activated.
