# PR3 — COD ordering implementation

Implements the existing V1 ordering design and PR3 plan on top of PR2 (`01c4660`).

## Delivered behavior

- Store-scoped cart persisted in localStorage, with memory fallback when storage is blocked; customer form, quantity edits and pending checkout intent survive reloads.
- COD checkout for table QR, pickup and delivery. Server validates current fulfillment settings, table/zone ownership, product availability, options and prices, and writes immutable item snapshots.
- Advisory locking and unique constraints serialize the same store/idempotency key. A repeated request returns the original guest token; a changed payload receives a new client key.
- Public tracking at `/o/:token`, masked phone, no address or tenant identifiers, visibility-aware polling, recent orders, noindex and no-referrer protection on direct and client navigation.
- AES-256-GCM guest-token encryption, ordering migration, atomic DB rate limiting, reusable status-transition rules, token-safe paths and database-error log redaction.

## Decisions confirmed during implementation

Rate admission happens after the same-key advisory lock and idempotency recheck, on the transaction connection. Expected business failures during read-only preparation return a typed outcome so the rate counter commits; the service throws the error after commit. Order inserts/items/events and unexpected failures remain outside that catch and roll back together. This avoids duplicate rate charges and connection-pool starvation. Store eligibility is reread with a SHARE lock before admission.

Checkout error recovery bypasses browser/CDN menu cache before reconciling stale lines. Fulfillment refresh can switch a table customer to pickup/delivery if dine-in was disabled. The PR2 test that expected no fulfillment request without a QR token now asserts the required PR3 request for delivery zones and verifies the old table is cleared.

The temporary PR2 cart and its unit/composable tests are replaced by persistent-cart coverage; existing catalog browser journeys remain regression checks.

## Environment and migration

`drizzle/0002_ordering.sql` is the only schema migration. Applied to the verified Neon `test` branch, never production. Local ignored environment files have separate encryption keys; CI generates an ephemeral integration key.

Before deploying PR3, configure a distinct, durable `APP_ENCRYPTION_KEY` (32 bytes, base64) in each Vercel environment and apply the migration there. The startup plugin rejects a missing/invalid key. Changing an existing key requires a data rotation procedure because stored guest tokens must remain decryptable for retries. No Vercel project is linked in this checkout; deployment and remote environment changes are outside this PR's execution.

## Verification

- `npm run lint` and `npm run typecheck`: passed.
- `npm run test:unit`: 522 tests / 42 files passed.
- `npm run test:nuxt`: 101 tests / 25 files passed.
- Full integration: 167 tests / 19 files passed on the verified test branch.
- `npm run test:api`: 187 tests / 4 files passed.
- `npm run db:check` and production build: passed.
- Invalid encryption key: built server exits before listening.
- Checkout inspected visually at 360×740 with a scrollable body and visible submit footer.
- Browser E2E: **60/60 passed** across mobile Chrome and mobile Safari, including ordering, tracking, public-menu regression and owner-to-customer catalog journey.

Browser verification reused the built server started with `NITRO_PORT=3100 node --env-file=.env.test .output/server/index.mjs`, then ran:

```sh
npx playwright test tests/e2e/ordering.spec.ts tests/e2e/order-tracking.spec.ts tests/e2e/public-menu.spec.ts tests/e2e/catalog-journey.spec.ts --workers=2
```

Initial dev-server runs exposed cold compilation/navigation timing and clicks before hydration; tests now await app hydration before interacting. The referrer assertion accepts both absent and empty browser header representations and rejects any nonempty referrer. The complete final production run passed without retries or increased assertion limits.
