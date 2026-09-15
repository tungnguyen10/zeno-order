# R3 Product Configuration & Cart Implementation Plan

> **Execution:** use Superpowers test-driven-development task by task and run the full R1–R2 regression gate at the end.

**Goal:** Let a customer configure a catalog product, keep a store-isolated local cart and navigate through cart/checkout shells without creating an order.

## Task 1 — Pure option and cart domain

**Create:** `shared/types/cart.ts`, `app/domain/product-configuration.ts`, `app/domain/cart.ts`, unit tests.

1. Write failing tests for defaults, group membership, duplicates, min/max/required rules, quantity/note limits and `BigInt` totals.
2. Implement pure validation and total functions; preserve decimal integer strings.
3. Verify focused unit tests and commit.

## Task 2 — Pinia persistence per public slug

**Create:** `app/stores/cart.ts`, `test/unit/cart-store.spec.ts`.

1. Write failing tests for browser-only hydrate, malformed/version/store mismatch rejection, independent slugs, add/update/remove/clear and persistence.
2. Implement a Pinia store with dependency-injected storage/id generation where tests need determinism.
3. Verify unit tests, lint/typecheck and commit.

## Task 3 — Product sheet and storefront integration

**Create:** `ProductConfigurator.vue`, `CartBar.vue`; modify `ProductCard.vue`, `ProductSection.vue`, storefront page and Nuxt tests.

1. Write failing component/page tests for dialog semantics, defaults, validation, sold-out/missing availability, adding a valid line and sticky summary.
2. Implement the bottom sheet and connect it to the slug cart.
3. Verify Nuxt tests, lint/typecheck and commit.

## Task 4 — Cart and checkout shells

**Create:** cart components, `/s/[publicSlug]/cart.vue`, `/s/[publicSlug]/checkout.vue`; extend Nuxt and Playwright tests.

1. Write failing tests for empty/populated cart, quantity/removal, subtotal, store-specific links and no order submission.
2. Implement mobile-first pages with same-store recovery.
3. Extend E2E for configure → persist → cart → checkout shell and cross-store isolation.
4. Update README/CI wording, run `npm run verify`, Playwright, remote pgTAP/advisors and commit.

## R3 Definition of Done

- Valid generic configurations can be added; invalid combinations cannot.
- Cart persists under `zeno-order:cart:v1:{publicSlug}` and never mixes stores.
- All money math is lossless; server pricing remains authoritative for R4.
- Store/product unavailability disables configuration actions, including a missing fresh availability row.
- Cart and checkout shell are usable on 360–430 px and accessible by keyboard.
- No R4/R5 behavior is introduced and every R1–R2 gate remains green.
