# R3 Product Configuration & Cart Design

**Sources of truth:** `architecture-p0-locked-baseline.md` wins over the older production plan. R2 public catalog and availability DTOs are frozen inputs.

## Scope

R3 adds a mobile product bottom sheet, generic client-side option validation, a per-store Pinia cart persisted to localStorage, a cart page, a sticky cart bar and a checkout shell. It does not write customer data or carts to Supabase and does not create orders.

## Product configuration

- Product cards expose a `Chọn món` button only in R3. The button is disabled unless the store is accepting orders and the fresh availability row exists with `isAvailable === true`.
- The sheet displays the selected product, linked option groups in catalog order, quantity `1..99`, and an optional item note capped at 500 characters.
- Defaults are selected when the sheet opens. Reopening a product starts a new configuration rather than leaking previous state.
- `single` groups use radios; `multiple` groups use checkboxes.
- A selection is valid only when every selected value belongs to its group, values are unique, each linked group satisfies `minSelect..maxSelect`, and a required group therefore has at least one value.
- Client price previews use decimal integer strings and `BigInt`. They are display-only; R4 revalidates identifiers, availability, constraints and prices inside PostgreSQL.

## Cart contract

Storage key:

```text
zeno-order:cart:v1:{publicSlug}
```

The slug is validated by the existing public slug schema. Each persisted document contains `version: 1`, `publicSlug`, `currency`, and items. Each item contains an opaque client line ID, product ID/name/base-price snapshot, selected option ID/name/price snapshots, quantity and note. Totals are derived, never persisted.

- Carts are isolated by `publicSlug`; items from different stores never share a document.
- Malformed, wrong-version or wrong-store local data is discarded safely.
- Cart state hydrates only in the browser and survives refresh/browser restart/offline periods.
- Quantity is constrained to `1..99`; removing the last item clears the storage key.
- Money addition/multiplication uses `BigInt` and returns decimal strings.

## Routes and UI

- `/s/:publicSlug`: product sheet plus sticky cart summary.
- `/s/:publicSlug/cart`: editable line list, subtotal and link to checkout.
- `/s/:publicSlug/checkout`: R3 shell showing cart summary and a clear message that order submission is enabled in R4; it has no submit-order network call.
- Empty or invalid carts have localized recovery links back to the same storefront.
- The sheet uses dialog semantics, focusable close controls, visible validation messages and a mobile bottom-sheet layout that becomes a centered dialog on wider screens.

## Acceptance boundaries

- Refresh restores the same store cart.
- A second store slug gets an independent cart.
- Missing availability fails closed.
- Invalid option combinations never enter the cart.
- R3 produces no Supabase cart/order writes, no checkout submission, no tracking token and no merchant UI.
