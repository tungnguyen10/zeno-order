# R2 Catalog Storefront Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a tenant-safe, mobile-first catalog storefront whose slow-changing catalog is cached for 120 seconds while store and product availability remains uncached.

**Architecture:** PostgreSQL owns catalog integrity and exposes two allow-listed read-only RPCs. Nitro maps those results into explicit public DTOs and applies separate cache policies. The Nuxt SSR page composes the two endpoints and renders availability as an overlay on the cached catalog.

**Tech Stack:** Node.js 24 LTS, Nuxt 4, Vue 3, TypeScript strict, Tailwind CSS 4, Supabase/PostgreSQL, Zod, Vitest, Nuxt Test Utils, pgTAP and Playwright.

## Global Constraints

- `architecture-p0-locked-baseline.md` wins over the older production plan.
- Public store route and identity remain `/s/{public_slug}` and `stores.public_slug`; never return store UUID publicly.
- Store-owned catalog rows use only `store_id`; cross-store references are blocked by composite constraints.
- Public reads use Nitro plus limited anon RPCs; anon receives no direct table `SELECT`.
- Service-role credentials never enter public runtime config or the client bundle.
- Catalog excludes live availability and uses `Cache-Control: public, max-age=0, s-maxage=120, stale-while-revalidate=60`.
- Availability uses `Cache-Control: no-store` on success and error responses.
- Product and option UUIDs are opaque public selection identifiers, not authorization.
- R2 excludes product configuration, option selection, cart, checkout, tracking and merchant mutations.
- Every behavior change follows red-green-refactor and preserves all R1 tests.

---

### Task 1: Tenant-safe catalog database, RPCs and fixtures

**Files:**

- Create: `supabase/migrations/20260915034919_r2_catalog_foundation.sql`
- Create: `supabase/tests/r2_catalog_foundation.test.sql`
- Create: `supabase/tests/r2_catalog_rls.test.sql`
- Modify: `supabase/seed.sql`

**Interfaces:**

- Produces RPC `public.get_storefront_catalog_by_slug(p_public_slug text) returns jsonb`.
- Produces RPC `public.get_storefront_availability_by_slug(p_public_slug text) returns jsonb`.
- Catalog JSON keys use snake_case equivalents of the approved DTO; availability source JSON contains store timezone/manual state/fulfillment flags, ordered hours and active product sold-out rows.

- [ ] **Step 1: Write failing pgTAP schema and tenant-integrity tests**

Create `r2_catalog_foundation.test.sql` with a transaction, temporary pgTAP enablement and assertions for all eight tables, non-negative prices, valid hour intervals, valid option bounds, section/menu ownership and cross-store menu/product/option relations. Include a positive aggregate catalog assertion proving inactive rows are filtered and arrays are deterministic.

The cross-store assertion must directly attempt this invalid shape:

```sql
insert into public.menu_items (
  store_id, menu_id, section_id, product_id, sort_order
) values (
  '20000000-0000-0000-0000-000000000111',
  '40000000-0000-0000-0000-000000000111',
  '50000000-0000-0000-0000-000000000111',
  '60000000-0000-0000-0000-000000000112',
  0
);
```

Expected SQLSTATE: `23503`.

- [ ] **Step 2: Write failing pgTAP privilege and RLS tests**

Create `r2_catalog_rls.test.sql` that verifies:

```text
organization owner/admin → all catalog rows for organization stores
direct store member       → assigned-store catalog rows only
outsider                  → zero catalog rows
anon direct SELECT        → SQLSTATE 42501 for every new table
anon RPC execution        → allowed for only catalog and availability
anon mutation             → SQLSTATE 42501
```

Pair every denied mutation with an assertion that the target row remained unchanged.

- [ ] **Step 3: Run both tests and verify RED**

Run:

```bash
npx supabase db query --linked --file supabase/tests/r2_catalog_foundation.test.sql --agent no
npx supabase db query --linked --file supabase/tests/r2_catalog_rls.test.sql --agent no
```

Expected: both fail because R2 tables/functions do not exist.

- [ ] **Step 4: Implement the migration**

Create the eight tables:

```text
store_hours
menus
menu_sections
products
menu_items
option_groups
option_values
product_option_groups
```

Use UUID primary keys, `timestamptz`, non-negative `bigint` money and explicit delete actions. Add `UNIQUE(store_id, id)` on every composite-FK parent. Required relations are:

```text
menu_sections(store_id, menu_id)                  → menus(store_id, id)
menu_items(store_id, menu_id)                     → menus(store_id, id)
menu_items(store_id, menu_id, section_id)         → menu_sections(store_id, menu_id, id)
menu_items(store_id, product_id)                  → products(store_id, id)
option_values(store_id, option_group_id)          → option_groups(store_id, id)
product_option_groups(store_id, product_id)       → products(store_id, id)
product_option_groups(store_id, option_group_id)  → option_groups(store_id, id)
```

Add indexes matching the public traversal and RLS predicates. Apply `private.set_updated_at()` to mutable catalog tables. Enable RLS on every table, grant authenticated read only, and use `private.has_store_role(store_id, array['owner','manager','staff'])` for select policies.

Both public RPCs must be `stable`, `security definer`, `set search_path = ''`, fully qualified and explicitly revoked from `public` before granting execute to `anon, authenticated`. Revoke all direct R2 table privileges from `anon`.

- [ ] **Step 5: Add representative local seed data**

Extend `mochi-cafe` with:

```text
Menu: Thực đơn chính
Sections: Cà phê, Trà trái cây, Bánh ngọt
Products: Cà phê sữa đá, Trà đào cam sả, Matcha latte, Mochi dâu
Sold-out fixture: Mochi dâu
Option groups: Kích cỡ (required single), Topping (optional multiple)
Hours: 07:00–22:00 for every day
```

Use fixed local-only UUIDs and no real credentials.

- [ ] **Step 6: Push migration, run tests and verify GREEN**

Run sequentially:

```bash
npx supabase db push --linked --dry-run --skip-vault --agent no
npx supabase db push --linked --skip-vault --yes --agent no
npx supabase db query --linked --file supabase/tests/r2_catalog_foundation.test.sql --agent no
npx supabase db query --linked --file supabase/tests/r2_catalog_rls.test.sql --agent no
npx supabase db advisors --linked --type all --level warn --fail-on error --agent no
```

Expected: both pgTAP suites pass; advisors return no error. Warnings for the two intentionally public limited RPCs are documented, not hidden.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260915034919_r2_catalog_foundation.sql supabase/tests/r2_catalog_foundation.test.sql supabase/tests/r2_catalog_rls.test.sql supabase/seed.sql
git commit -m "feat: add tenant-safe catalog schema"
```

---

### Task 2: Cached catalog domain and Nitro endpoint

**Files:**

- Create: `shared/types/catalog.ts`
- Create: `server/domain/catalog/public-catalog.ts`
- Create: `server/repositories/catalog.repository.ts`
- Create: `server/api/storefront/[publicSlug]/catalog.get.ts`
- Create: `test/unit/public-catalog.spec.ts`
- Create: `test/unit/catalog-repository.spec.ts`
- Create: `test/nuxt/catalog-api.spec.ts`
- Modify: `server/api/storefront/[publicSlug].get.ts`

**Interfaces:**

- Produces `StorefrontCatalog` exactly as frozen in the R2 design document.
- Repository method: `findPublicBySlug(publicSlug: string): Promise<PublicCatalogRpcRow | null>`.
- Service method: `resolve(publicSlug: string): Promise<StorefrontCatalog>`.

- [ ] **Step 1: Write unit tests for validation and mapping**

Test valid slug mapping, invalid/reserved slug rejection as `StoreNotFoundError`, empty RPC result as 404, database errors propagating to the API layer, nested option-value mapping and preservation of deterministic array order.

- [ ] **Step 2: Run unit tests and verify RED**

```bash
npm run test:unit -- test/unit/public-catalog.spec.ts test/unit/catalog-repository.spec.ts
```

Expected: fail because catalog modules do not exist.

- [ ] **Step 3: Implement shared DTO, mapper and repository**

Define `StorefrontCatalog` with the exact field names and nullability in the R2 design. Reuse `publicSlugSchema` and `StoreNotFoundError`; do not duplicate the reserved-slug list. Type the RPC client so only `get_storefront_catalog_by_slug` is callable from this repository.

- [ ] **Step 4: Write Nuxt route tests**

Assert the success DTO, safe 404, generic 500, and exact header:

```text
public, max-age=0, s-maxage=120, stale-while-revalidate=60
```

Assert the response has no `storeId`, `organizationId`, `isSoldOut`, `manualOpenState`, `deliveryEnabled` or `pickupEnabled` key.

- [ ] **Step 5: Run route tests and verify RED**

```bash
npm run test:nuxt -- test/nuxt/catalog-api.spec.ts
```

Expected: fail because the catalog route does not exist.

- [ ] **Step 6: Implement the catalog route and profile cache policy**

Use the sessionless public Supabase client, typed repository and service. Set the cache header before success/error mapping. Preserve the existing safe error envelope. Add the same cache header to the backward-compatible profile endpoint.

- [ ] **Step 7: Verify GREEN and commit**

```bash
npm run test:unit -- test/unit/public-catalog.spec.ts test/unit/catalog-repository.spec.ts
npm run test:nuxt -- test/nuxt/catalog-api.spec.ts
git add shared/types/catalog.ts server/domain/catalog/public-catalog.ts server/repositories/catalog.repository.ts 'server/api/storefront/[publicSlug]/catalog.get.ts' 'server/api/storefront/[publicSlug].get.ts' test/unit/public-catalog.spec.ts test/unit/catalog-repository.spec.ts test/nuxt/catalog-api.spec.ts
git commit -m "feat: expose cached storefront catalog"
```

---

### Task 3: Availability resolver and no-store endpoint

**Files:**

- Create: `shared/types/availability.ts`
- Create: `server/domain/availability/store-availability.ts`
- Create: `server/repositories/availability.repository.ts`
- Create: `server/api/storefront/[publicSlug]/availability.get.ts`
- Create: `test/unit/store-availability.spec.ts`
- Create: `test/unit/availability-repository.spec.ts`
- Create: `test/nuxt/availability-api.spec.ts`

**Interfaces:**

- Produces `StorefrontAvailability` exactly as frozen in the R2 design.
- Pure resolver: `resolveStoreAvailability(source: AvailabilitySource, now: Date): StorefrontAvailability`.
- Repository method: `findPublicBySlug(publicSlug: string): Promise<AvailabilitySource | null>`.

- [ ] **Step 1: Write pure resolver tests**

Cover manual `open`, `closed`, `temporarily_closed`, currently open hours, closed day, before-opening `nextOpeningAt`, multiple same-day intervals, timezone boundary, no hours, disabled fulfillment, sold-out and available products. Pass a fixed `Date` into every test.

- [ ] **Step 2: Run resolver tests and verify RED**

```bash
npm run test:unit -- test/unit/store-availability.spec.ts
```

Expected: fail because the resolver does not exist.

- [ ] **Step 3: Implement the pure resolver**

Use `Intl.DateTimeFormat(...).formatToParts()` for the store timezone; do not change process timezone. Apply the precedence and seven-day next-opening scan from the design. Return ISO timestamps and never read the system clock inside the pure function.

- [ ] **Step 4: Write repository and route tests**

Test typed RPC invocation, null result, database failure, safe 404/generic 500 and exact `Cache-Control: no-store` on every response path.

- [ ] **Step 5: Run repository/route tests and verify RED**

```bash
npm run test:unit -- test/unit/availability-repository.spec.ts
npm run test:nuxt -- test/nuxt/availability-api.spec.ts
```

Expected: fail because repository and endpoint do not exist.

- [ ] **Step 6: Implement repository and endpoint**

Validate the slug with the existing schema. Call only `get_storefront_availability_by_slug`. Resolve with a request-time `new Date()` injected at the API boundary. Set `no-store` before all response/error branches.

- [ ] **Step 7: Verify GREEN and commit**

```bash
npm run test:unit -- test/unit/store-availability.spec.ts test/unit/availability-repository.spec.ts
npm run test:nuxt -- test/nuxt/availability-api.spec.ts
git add shared/types/availability.ts server/domain/availability/store-availability.ts server/repositories/availability.repository.ts 'server/api/storefront/[publicSlug]/availability.get.ts' test/unit/store-availability.spec.ts test/unit/availability-repository.spec.ts test/nuxt/availability-api.spec.ts
git commit -m "feat: add fresh storefront availability"
```

---

### Task 4: Mobile-first SSR catalog UI

**Files:**

- Create: `app/components/storefront/StoreHeader.vue`
- Create: `app/components/storefront/StoreStatus.vue`
- Create: `app/components/storefront/SectionNav.vue`
- Create: `app/components/storefront/ProductCard.vue`
- Create: `app/components/storefront/ProductSection.vue`
- Create: `app/utils/format-money.ts`
- Create: `test/unit/format-money.spec.ts`
- Modify: `app/pages/s/[publicSlug]/index.vue`
- Modify: `app/assets/css/main.css`
- Modify: `test/nuxt/storefront-page.spec.ts`

**Interfaces:**

- Page consumes `StorefrontCatalog` and `StorefrontAvailability` from the two Nitro endpoints.
- `ProductCard` consumes one catalog product and `isAvailable`; it emits no cart action in R2.

- [ ] **Step 1: Write failing money formatter and page tests**

Assert `35000` VND renders as `35.000 ₫`, ordered sections/products appear in SSR output, availability status is localized, sold-out product remains visible with a badge, empty sections are omitted, and both `useFetch` calls use slug-specific keys.

- [ ] **Step 2: Run tests and verify RED**

```bash
npm run test:unit -- test/unit/format-money.spec.ts
npm run test:nuxt -- test/nuxt/storefront-page.spec.ts
```

Expected: fail because formatter/components/catalog rendering do not exist.

- [ ] **Step 3: Implement components and page composition**

Fetch catalog with key `storefront-catalog:${publicSlug}` and availability with key `storefront-availability:${publicSlug}`. Keep both awaited during SSR. Build section product lists from normalized `menuItems` without mutating DTO arrays. Use semantic headings, anchor navigation, `aria-live="polite"` for status and visible text for sold-out state.

- [ ] **Step 4: Apply mobile-first styling**

Keep the primary content optimized for 360–430 px, make section navigation horizontally scrollable/sticky, reserve image aspect ratio, lazy-load below-fold product images and progressively use two columns on wider screens. Do not add cart UI.

- [ ] **Step 5: Verify GREEN and commit**

```bash
npm run test:unit -- test/unit/format-money.spec.ts
npm run test:nuxt -- test/nuxt/storefront-page.spec.ts
git add app/components/storefront app/utils/format-money.ts 'app/pages/s/[publicSlug]/index.vue' app/assets/css/main.css test/unit/format-money.spec.ts test/nuxt/storefront-page.spec.ts
git commit -m "feat: render mobile storefront catalog"
```

---

### Task 5: R2 contract E2E, documentation and full gate

**Files:**

- Modify: `test/e2e/storefront.spec.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`
- Create: `.superpowers/sdd/progress.md` (ignored local execution ledger)

**Interfaces:**

- Verifies the complete R2 public contract without introducing new production behavior.

- [ ] **Step 1: Extend Playwright tests**

Add mobile Chromium coverage for seeded section/product SSR, deterministic order, sold-out visibility, section anchors, safe unknown-store 404, catalog cache header, availability no-store header and absence of store/organization UUIDs or private operational fields.

- [ ] **Step 2: Run E2E and fix only contract regressions**

```bash
npm run test:e2e
```

Expected: all R1 and R2 Playwright tests pass.

- [ ] **Step 3: Update CI and README**

Rename the CI job from R1-specific wording to Phase 1 verification. Document R2 endpoints, cache split, migration workflow, remote pgTAP fallback and verification commands. Keep Docker as the supported local Supabase prerequisite.

- [ ] **Step 4: Run complete verification**

```bash
npm run verify
npm run test:e2e
npx supabase db query --linked --file supabase/tests/r2_catalog_foundation.test.sql --agent no
npx supabase db query --linked --file supabase/tests/r2_catalog_rls.test.sql --agent no
npx supabase migration list --linked --agent no
npx supabase db advisors --linked --type all --level warn --fail-on error --agent no
git diff --check
```

Expected: all commands exit 0; local and remote migrations match; only intentional warnings for allow-listed public resolver functions remain.

- [ ] **Step 5: Final whole-slice review**

Review the full R2 diff against the design and both source documents. Fix every Critical or Important finding, rerun the affected tests, then rerun the complete verification command set.

- [ ] **Step 6: Commit**

```bash
git add test/e2e/storefront.spec.ts .github/workflows/ci.yml README.md
git commit -m "test: close R2 storefront acceptance gates"
```
