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
    basePrice: string
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
      priceAdjustment: string
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

The catalog RPC returns the following exact snake-case JSON before Nitro maps it to the DTO above:

```ts
interface CatalogRpcPayload {
  store: {
    public_slug: string
    name: string
    description: string | null
    logo_path: string | null
    cover_path: string | null
    timezone: string
    currency: string
  }
  menus: Array<{ id: string, name: string }>
  sections: Array<{ id: string, menu_id: string, name: string, slug: string, description: string | null }>
  menu_items: Array<{ id: string, menu_id: string, section_id: string, product_id: string }>
  products: Array<{ id: string, name: string, slug: string, description: string | null, base_price: string, image_path: string | null }>
  option_groups: Array<{
    id: string
    name: string
    selection_type: 'single' | 'multiple'
    required: boolean
    min_select: number
    max_select: number
    values: Array<{ id: string, name: string, price_adjustment: string, is_default: boolean }>
  }>
  product_option_groups: Array<{ product_id: string, option_group_id: string }>
}
```

Successful and intentional not-found responses use:

```http
Cache-Control: public, max-age=0, s-maxage=120, stale-while-revalidate=60
```

Missing, inactive and unpublished stores return the existing safe `404 STORE_NOT_FOUND` envelope. Database failures become a generic 500 without raw SQL details and use `Cache-Control: no-store`; they are never publicly cached.

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

Phase 1 stores at most one row per store/day. Overnight intervals are rejected by database constraints. Open intervals use `[open_time, close_time)`, so the exact closing instant is closed. When schedule-controlled and currently closed, `nextOpeningAt` scans today plus the next six local calendar days for the first future opening and returns an RFC 3339 instant. Manual overrides are indefinite and therefore return `nextOpeningAt = null`. If an opening lands in a daylight-saving gap or a timezone offset changes before that opening, R2 returns `null` rather than guessing; an overlap uses the earlier matching instant. Invalid IANA timezones are rejected by a database trigger, and a defensive runtime failure maps to a safe no-store 500.

`orderingEnabled` is true only when status is `open` and at least one fulfillment method is enabled. Product availability is independent of store status and equals `!is_sold_out` for public active products; the UI combines both flags when enabling actions.

The availability RPC returns the exact source payload below. Time strings use PostgreSQL `HH:mm:ss` format and collections are ordered by day/time or product ID.

```ts
interface AvailabilityRpcPayload {
  public_slug: string
  timezone: string
  manual_open_state: 'open' | 'closed' | 'temporarily_closed' | null
  delivery_enabled: boolean
  pickup_enabled: boolean
  hours: Array<{
    day_of_week: number
    open_time: string | null
    close_time: string | null
    is_closed: boolean
  }>
  products: Array<{ product_id: string, is_sold_out: boolean }>
}
```

Only currently active products appear in the fresh availability payload. If a product present in a cached catalog is missing from availability, the UI treats it as unavailable. This fail-closed rule covers products deactivated or deleted during the catalog cache window.

### Database rules

The table contract is exact:

```text
store_hours(id uuid PK, store_id uuid NOT NULL, day_of_week smallint NOT NULL,
  open_time time NULL, close_time time NULL, is_closed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now())
menus(id uuid PK, store_id uuid NOT NULL, name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0,
  created_at/updated_at timestamptz NOT NULL DEFAULT now())
menu_sections(id uuid PK, store_id/menu_id uuid NOT NULL, name/slug text NOT NULL,
  description text NULL, sort_order integer NOT NULL DEFAULT 0,
  created_at/updated_at timestamptz NOT NULL DEFAULT now())
products(id uuid PK, store_id uuid NOT NULL, name/slug text NOT NULL,
  description/image_path text NULL, base_price bigint NOT NULL,
  is_active boolean NOT NULL DEFAULT true, is_sold_out boolean NOT NULL DEFAULT false,
  created_at/updated_at timestamptz NOT NULL DEFAULT now())
menu_items(id uuid PK, store_id/menu_id/section_id/product_id uuid NOT NULL,
  sort_order integer NOT NULL DEFAULT 0, created_at/updated_at timestamptz NOT NULL DEFAULT now())
option_groups(id uuid PK, store_id uuid NOT NULL, name text NOT NULL,
  selection_type text NOT NULL, required boolean NOT NULL DEFAULT false,
  min_select integer NOT NULL DEFAULT 0, max_select integer NOT NULL DEFAULT 1,
  sort_order integer NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true,
  created_at/updated_at timestamptz NOT NULL DEFAULT now())
option_values(id uuid PK, store_id/option_group_id uuid NOT NULL, name text NOT NULL,
  price_adjustment bigint NOT NULL DEFAULT 0, is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0,
  created_at/updated_at timestamptz NOT NULL DEFAULT now())
product_option_groups(store_id/product_id/option_group_id uuid NOT NULL,
  sort_order integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(store_id, product_id, option_group_id))
```

Every FK to `stores` cascades on store deletion. Menu deletion cascades its sections and placements; section/product deletion cascades placements; option-group deletion cascades values and product links; product deletion cascades product-option links. Historical order rows introduced in R4 will store snapshots rather than cascade catalog history.

Catalog RPCs return SQL `NULL` for missing/inactive/unpublished stores. For visible stores, all collection keys are present and use empty arrays rather than JSON null. Option groups and product-option links are included only when linked to an active product placed in an active menu/section; values must also be active.

- Money uses non-negative `bigint` in PostgreSQL and decimal integer strings in public JSON; R2 does not allow negative option adjustments or unsafe JavaScript number conversion.
- `day_of_week` is `0` Sunday through `6` Saturday.
- `UNIQUE(store_id, day_of_week)` permits one hours row per day. Open rows require non-null `open_time < close_time`; closed-day rows have null times, so contradictory/overlapping day records are impossible.
- Slugs are lowercase kebab-case and unique within the store for products, and within a menu for sections.
- Names contain 1–120 characters, slug length is 1–63, and every `sort_order` is non-negative.
- `selection_type` is `single` or `multiple`; `min_select >= 0`, `max_select >= min_select`, single groups have `max_select = 1`, and `required` is equivalent to `min_select > 0`.
- Every option group has at most one active default value in Phase 1.
- `menu_sections` has `UNIQUE(store_id, menu_id, id)` so `menu_items(store_id, menu_id, section_id)` can reference it directly.
- A product can appear only once in a section, and an option group can link only once to a product.
- All new public-schema tables have RLS enabled.
- Authenticated reads use `private.has_store_role`; no R2 mutation policy is introduced.
- The expected anon-executable app functions are the retained R1 profile resolver plus the two R2 RPCs. `PUBLIC` itself has no execute privilege and no other app function is exposed.
- Public RPCs are `SECURITY DEFINER`, use `search_path = ''`, fully qualify objects and return only the approved payload.

### UI behavior

- `/s/:publicSlug` SSR-fetches catalog and availability with slug-specific keys so hydration does not duplicate requests.
- The menu remains readable when closed or sold out.
- Status text and product disabled state come only from availability data.
- A catalog product is actionable only when its availability row exists with `isAvailable === true`; missing availability rows are disabled.
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

Local and remote demo data are separated: `supabase/seed-demo.sql` contains no auth user or password and may be applied to the linked development project; `supabase/seed.sql` contains only local auth/membership fixtures and runs after the demo seed during local reset.

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
