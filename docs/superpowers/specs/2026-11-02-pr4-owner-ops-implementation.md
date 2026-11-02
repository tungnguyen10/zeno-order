# PR4 — Owner operations implementation

Implements the existing V1 owner-operations design and PR4 plan on top of PR3 (`cef925d`).

## Delivered behavior

- Mobile order board with status tabs, cursor pagination, order snapshots/contact details and event history. One-tap fulfillment actions, cash collection, cancellation with a required reason and role-aware refund handling.
- Atomic status/payment updates and audit events. Expected-state predicates produce `409 STATUS_CONFLICT`; concurrent collections create exactly one payment. Staff cannot cancel a paid order; an owner cancellation moves its payment status to `REFUND_DUE`.
- Five-second polling while visible, optional sound after interaction, new-order notifications and tab counts. Offline refresh keeps existing cards and warns even on an empty board. Generation guards prevent old store/tab/page responses and completed mutations from overwriting a newer view.
- Owner team management: create an invitation link once, revoke pending invitations, disable/re-enable staff. Tokens contain 32 random bytes, only SHA-256 hashes are stored, and links expire after seven days and are consumed once.
- Invitation registration/login returns to the invitation. Acceptance ensures the profile and locks/consumes the invitation in the same transaction, checks normalized email and verification, and preserves existing effective owner privileges.
- Staff can read their store's daily summary; owners also receive today/7-day/30-day reports and top products. Vietnam date boundaries and actual recorded payment amounts determine reporting; cancelled orders are excluded from revenue.

## Decisions and handoff

`/app/team` is a separate owner route. `GET …/reports` is owner-only; `GET …/summary` allows assigned staff. `PATCH …/status` rejects cancellation, which uses `POST …/cancel`. The board refreshes its current leading page rather than attempting delta polling, so orders that leave a tab disappear correctly.

`INVITE_REQUIRE_VERIFIED_EMAIL` defaults to true; only the literal `false` disables verification. Both camelCase `emailVerified` and snake_case `email_verified` JWT claims require boolean true. Isolated local test environments disable this flag because their Neon Auth setup does not require verification. Before production, enable provider email verification and confirm the actual signed claim, as scheduled in PR7. Invitation tokens are redacted from error paths after the existing public-order path sanitizer.

`drizzle/0003_owner_ops.sql` is the only migration. It creates `order_payments` with tenant/order foreign keys, nonnegative VND amounts and unique `order_id`, and adds the missing `orders_board_idx`. The original PR4 plan assumed PR3 had already created that index; the actual PR3 schema had not. Migration was applied to the verified Neon `test` branch, never production. Reused the existing UUID guard in `server/utils/ids.ts` instead of introducing a duplicate utility.

PR5/PR6 can reuse `listBoard`, the `awaiting_payment` tab, `newOrderIds`, `statusConflict`, order detail/card components and the transaction/repository helpers. `AWAITING_PAYMENT → NEW` is a system transition and must bypass the staff endpoint. PR6 must allow `actorUserId: null` in the repository helper for system events (the DB column is already nullable), add the `bank_transaction_id` FK/conditional unique constraint and implement owner-only `BANK_MANUAL`/refund operations. The unique `order_id` permits one recorded payment per order.

## Verification

- Lint and TypeScript checks: passed; production build and `db:check`: passed.
- Unit/Nuxt: 1,010 tests across 89 files passed.
- Full integration: 256 tests across 26 files passed on the verified test branch.
- API tenant matrix: 246 tests passed, including the new routes' owner/staff/other-store/disabled/anonymous cases. The other 45 API cases passed in the full API run.
- New owner/staff E2E: 4/4 passed on mobile Chrome and Safari against the production build, with a 360×740 viewport and touch-target/overflow checks.
- Independent code review: no unresolved Critical/Important findings; the reported asynchronous board races have failing-before/passing-after regressions.

The conflict browser test waits for the owner's successful HTTP update before clicking the staff's deliberately stale card. Optimistic card removal alone does not prove the first transaction committed, and Safari correctly exposed that test synchronization error.

Browser verification uses the built server with the ignored test environment:

```sh
NITRO_PORT=3100 node --env-file=.env.test .output/server/index.mjs
npx playwright test tests/e2e/owner-ops.spec.ts --workers=2
```
