# R2 Catalog Storefront Design

**Status:** Approved by the existing seven-slice roadmap and the instruction to continue implementation.

**Sources of truth:** `architecture-p0-locked-baseline.md` takes precedence over `food-ordering-platform-production-plan.md` whenever they conflict.

## Scope

R2 delivers a browsable, mobile-first storefront backed by a tenant-safe catalog and a separately refreshed availability feed.

Included:

- `store_hours`, menus, sections, products, menu placements, generic option groups and option values.
- Tenant constraints, authenticated read RLS and limited public RPCs.
- One cached catalog endpoint and one uncached availability endpoint.
- SSR storefront header, status, section navigation and product cards.
- Seed data plus pgTAP, unit, Nuxt and Playwright coverage.

Excluded:

- Product configuration bottom sheet, option selection and cart persistence; these belong to R3.
- Checkout, order creation and tracking; these belong to R4.
- Merchant mutations; these belong to R6.

## Decisions

### Public identifiers

- Storefront URLs and cart namespaces use immutable `publicSlug`.
- Store UUID is not returned by public APIs.
- Menu, section, product, option-group and option-value UUIDs are exposed as opaque catalog identifiers because R3/R4 must submit product and option selections. They grant no authority; checkout revalidates every identifier in the atomic database transaction.

### Tenant ownership

Every R2 business row has `store_id`, including `option_values` and `product_option_groups`. Composite foreign keys prove every menu, section, product and option relation belongs to the same store. This resolves the older production-plan omission in favor of P0-04.

### Catalog contract

`GET /api/storefront/:publicSlug/catalog` returns:

```ts
interface StorefrontCatalog {
  store: {
    publicSlug: string
    name: string
    description: string | null
    logoPath: string | null
    coverPath: string | null
    timezone: string
    currency: string
  }
  menus: Array<{ id: string, name: string }>
  sections: Array<{
    id: string
    menuId: string
    name: string
    slug: string
    description: string | null
  }>
  menuItems: Array<{
    id: string
    menuId: string
    sectionId: string
    productId: string
  }>
  products: Array<{
    id: string
    name: string
    slug: string
    description: string | null
    basePrice: number
    imagePath: string | null
  }>
  optionGroups: Array<{
    id: string
    name: string
    selectionType: 'single' | 'multiple'
    required: boolean
    minSelect: number
    maxSelect: number
    values: Array<{
      id: string
      name: string
      priceAdjustment: number
      isDefault: boolean
    }>
  }>
  productOptionGroups: Array<{
    productId: string
    optionGroupId: string
  }>
}
```

Arrays are already ordered by `sort_order`, then stable identifiers. Only published, active stores and active menus/products/groups/values are returned. Live open/closed and sold-out fields are deliberately absent.

Successful and not-found responses use:

```http
Cache-Control: public, max-age=0, s-maxage=120, stale-while-revalidate=60
```

Missing, inactive and unpublished stores return the existing safe `404 STORE_NOT_FOUND` envelope. Database failures become a generic 500 without raw SQL details.

The existing profile endpoint remains backward compatible and receives the same catalog cache policy. The SSR storefront switches to the catalog endpoint so store profile has one rendering source.

### Availability contract

`GET /api/storefront/:publicSlug/availability` returns:

```ts
interface StorefrontAvailability {
  publicSlug: string
  status: 'open' | 'closed' | 'temporarily_closed'
  orderingEnabled: boolean
  fulfillment: {
    delivery: boolean
    pickup: boolean
  }
  nextOpeningAt: string | null
  products: Array<{
    productId: string
    isAvailable: boolean
  }>
}
```

Every response sets:

```http
Cache-Control: no-store
```

Visibility still requires an active, published store. For a visible store, status precedence is:

1. `manual_open_state = temporarily_closed` → `temporarily_closed`.
2. `manual_open_state = closed` → `closed`.
3. `manual_open_state = open` → `open`.
4. Otherwise resolve the current local time against `store_hours` in the store timezone.
5. Missing or closed-day hours → `closed`.

Phase 1 hours support multiple same-day intervals. Overnight intervals are rejected by database constraints. `nextOpeningAt` scans the next seven local calendar days and returns an ISO timestamp when a future interval exists.

`orderingEnabled` is true only when status is `open` and at least one fulfillment method is enabled. Product availability is independent of store status and equals `!is_sold_out` for public active products; the UI combines both flags when enabling actions.

### Database rules

- Money uses non-negative `bigint`; R2 does not allow negative option adjustments.
- `day_of_week` is `0` Sunday through `6` Saturday.
- Open intervals require non-null `open_time < close_time`; closed-day records have null times.
- Slugs are lowercase kebab-case and unique within the store for products, and within a menu for sections.
- `selection_type` is `single` or `multiple`; `min_select >= 0`, `max_select >= min_select`, single groups have `max_select = 1`, and `required` is equivalent to `min_select > 0`.
- A single-select group has at most one active default value.
- All new public-schema tables have RLS enabled.
- Authenticated reads use `private.has_store_role`; no R2 mutation policy is introduced.
- Anon has no direct table privileges and can only execute the two allow-listed public RPCs.
- Public RPCs are `SECURITY DEFINER`, use `search_path = ''`, fully qualify objects and return only the approved payload.

### UI behavior

- `/s/:publicSlug` SSR-fetches catalog and availability with slug-specific keys so hydration does not duplicate requests.
- The menu remains readable when closed or sold out.
- Status text and product disabled state come only from availability data.
- The baseline viewport is 360–430 px; desktop progressively widens the content grid.
- Section navigation uses anchors and product cards show name, description, integer-money formatting and an explicit sold-out badge.
- Empty catalog and safe 404/500 states are localized and accessible.
- No customer Realtime subscription is added.

## Work lanes

1. Database/security foundation is sequential because it owns schema, RPC signatures and seed fixtures.
2. Catalog HTTP/domain and the pure availability resolver can run in parallel after the interfaces above are fixed.
3. Availability HTTP integration follows the resolver and RPC row contract.
4. Storefront UI follows both endpoints.
5. Contract/E2E verification closes the slice.

No two implementers may edit the same migration, shared DTO or storefront page concurrently.

## Acceptance gates

- Schema is reproducible and blocks cross-store menu/product/option relations.
- pgTAP proves constraints, RLS inheritance, anon denial, public RPC filtering and deterministic order.
- Catalog response contains no live availability data and has the exact 120-second shared-cache policy.
- Availability has the exact `no-store` policy and changes independently of catalog.
- SSR HTML contains the seeded store, sections and products.
- Mobile Playwright covers ordered catalog rendering, sold-out state, closed state, safe 404s and both cache headers.
- Lint, strict typecheck, unit/Nuxt tests, production build and client-secret scan pass.

## Deferred P0 note

Before R4, resolve the baseline wording conflict by using the more specific P0-02 order: validation → PostgreSQL rate limit → Turnstile → atomic order RPC. Public order requests will use `publicSlug`, not a store UUID.
