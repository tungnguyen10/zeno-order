# Go-live gates — PR7

Unchecked means unverified. Automated suites never authorize a live bank pilot or mark a manual gate complete.

- [ ] Clean install, lint, typechecks, unit/Nuxt and production build pass for the final SHA.
  Verify: `npm ci && npm run lint && npm run typecheck && npm run typecheck:functions && npm run test && npm run build`
- [ ] No unaccepted high/critical runtime advisory.
  Verify: `npm run audit:runtime`
- [ ] Migration, integration/API and production hardening suites pass on an attested isolated Neon branch.
  Verify: `npm run db:migrate && npm run db:check && npm run test:integration && npm run test:api && npm run test:hardening`
- [ ] Production browser journeys on desktop Chromium, mobile Chromium and mobile WebKit pass; axe, CSP, focus, touch, Lighthouse budgets hold.
  Verify: `npm run build:hardening && npm run test:e2e:hardening && npx playwright test --config playwright.production.config.ts`
- [ ] Production/test endpoints, Auth, storage and secrets are separated; production rejects test auth overrides; actual ingress overwrites the chosen IP header.
  Verify: `npm run check:env -- --file <production-env> --target production --compare <test-env>` and Console/ingress review (validator is not endpoint ownership evidence).
- [ ] Backup restore rehearsal passes on a quiescent synthetic branch and Auth/storage/key recovery is separately evidenced.
  Verify: `ZENO_RESTORE_DRILL=1 npm run ops:restore-drill -- restore-source-<name> --execute` (requires explicit project credentials; never production).
- [ ] Correct migrated Neon deployment, schedules, disabled/re-enabled behavior and deliberate failure alert are verified by the operator.
  Verify: `npm run smoke:prod -- https://your-origin --slug your-store` with ops credential; review actual Neon invocations and a received monitor failure. A successful smoke cannot prove alerts were delivered.
- [ ] Real SePay/bank cases and pilot totals are reviewed, including raw-body auth, integer/UUID distinction, duplicate sources, amount discrepancies, cancelled orders, late payments and webhook loss/API backfill.
  Verify: follow `docs/pilot-runbook.md`, attach sanitized evidence to `docs/pilot-report.md`, then `node scripts/check-pilot-evidence.mjs <evidence.json>` to validate completeness. This command checks record structure, not bank authenticity; a human reviews provider/bank evidence.
- [ ] Operator approved go/no-go and rollback ownership after all above gates.
  Verify: `node scripts/check-pilot-evidence.mjs <evidence.json>` plus named human review/sign-off.
