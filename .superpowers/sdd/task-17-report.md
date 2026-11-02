# Task 17 report — public menu

Implemented the customer menu for `/s/[slug]`: category chips, Vietnamese-insensitive search, product option sheet with live prices, a temporary draft cart, and table QR fulfillment display. The UI is split across focused category, product, option sheet, and cart components. Shared search and cart-draft rules have unit coverage.

## Review follow-up

- Fulfillment now derives its URL and query from the reactive route slug and `?t=` value. Route changes clear the previous response; the current token is then fetched again, while token removal leaves fulfillment empty. Empty, repeated, and bare `t` values remain invalid.
- Draft lines are stored by store slug. Navigating between stores swaps to that store's cart, and returning restores its own draft without mixing lines or totals.
- Added unit coverage for QR query parsing, Nuxt coverage for reactive cart scope and fulfillment refresh inputs, and an E2E SPA navigation journey covering store changes, valid and cross-store tokens, and separate draft totals.

## Verification

- Unit: menu-search, cart-draft, and fulfillment-query focused tests passed.
- Nuxt: reactive cart scope and fulfillment navigation tests passed (2/2).
- E2E: SPA navigation regression passed on mobile Chrome and mobile Safari (`--workers=1`, port 3100).
- Lint, typecheck, and `git diff --check` passed.
