# ZENO Mini Order V1 — PR2 Catalog: Menu, Option, Bàn/QR, Khu vực giao, Menu public Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owner tạo menu (tên + giá trong ≤ 3 thao tác), option, bàn/QR và khu vực giao; khách mở `/s/:slug` (và `?t=`) xem menu + sheet option trên mobile. Link công khai chạy được ngay từ Task 4; owner bật nhận đơn và xem trang khách chỉ bằng 1 chạm. Chưa đặt đơn.

**Architecture:** Migration `catalog` thêm 6 bảng, mọi bảng có `org_id, store_id` + composite FK `(org_id, store_id) → stores(org_id, id)` và `unique(store_id, id)` để bảng con tham chiếu `(store_id, parent_id)`. Route handler mỏng → service (transaction nằm ở service) → repository nhận `{ orgId, storeId }`. API công khai `/api/public/**` đọc theo slug, không bao giờ trả `orgId`/`active=false`/token hash. Tính tiền và kiểm tra option nằm ở `shared/pricing.ts` (hàm thuần) để PR3 dùng lại ở server và client.

**Tech Stack:** Nuxt 4.5.2, Nuxt UI 4.12.0 (`UDrawer`, `UTabs` bọc trong `ZSheet`/`ZTabs`), drizzle-orm 0.45.4 / drizzle-kit 0.31.11, zod 4.6.5, h3 `readMultipartFormData`, `@aws-sdk/client-s3` (qua `server/services/storage`), `qrcode@1.5.4` (mới), vitest 5 + `@nuxt/test-utils`, Playwright 1.63.

**Spec:** [2026-10-31-zeno-mini-order-v1-design.md](../specs/2026-10-31-zeno-mini-order-v1-design.md) (§2, §3, §4.2–4.4, §7, §9) · PRD: [ZENO_MINI_ORDER_V1_IMPLEMENTATION_PLAN.md](../../ZENO_MINI_ORDER_V1_IMPLEMENTATION_PLAN.md) (§1 Delivery, §2.1–2.3, §3 O3/O4) · UI: [2026-10-31-ui-foundation-design.md](../specs/2026-10-31-ui-foundation-design.md) · Roadmap: [2026-10-31-zeno-v1-00-roadmap.md](./2026-10-31-zeno-v1-00-roadmap.md) (mục PR2) · Phụ thuộc: PR0, PR1 đã merge.

## Global Constraints

Áp dụng "Global Constraints" và "Quy ước xuyên PR" của roadmap. Điểm chạm PR này:
- **Package manager:** npm, pin version chính xác (không `^`/`~`): `qrcode@1.5.4`, `@types/qrcode@1.5.6`.
- **Import:** server dùng đường dẫn tương đối trong `server/`; `shared/` qua alias `#shared`. Không dùng `~/server/...`.
- **Lớp kiến trúc:** route handler mỏng (parse → guard → service). Transaction chỉ nằm trong `server/services/**`. Repository luôn nhận `{ orgId, storeId }` hoặc `StoreContext` và đưa cả hai vào `WHERE`.
- **Tenant:** mọi bảng thuộc store có `org_id`, `store_id`, composite FK `(org_id, store_id) → stores(org_id, id)`, `unique(store_id, id)`; bảng con tham chiếu `(store_id, parent_id)`. Không có quyền → **404 `NOT_FOUND`**; thiếu role → **403 `FORBIDDEN`**; thiếu/sai token → **401 `UNAUTHENTICATED`**. Staff **đọc**, owner **ghi** catalog.
- **Tiền:** VND `bigint` (mode `number`), số nguyên ≥ 0, tối đa `MAX_PRICE_VND = 100_000_000`; hiển thị bằng `formatVnd` (`35.000đ`).
- **Token:** 32 byte random base64url (43 ký tự); DB chỉ lưu `sha256` hex (`server/utils/tokens.ts`).
- **Lỗi API:** `{ code, message, details? }`, code theo spec §9. Không thêm mã lỗi mới trong PR này.
- **Route public:** `/api/public/**` không cần token, response không chứa `orgId`, `storeId`, `active`, `imageKey`, `tokenHash`, `customerPhone`, `address`; mọi route public có test quét khoá JSON.
- **Z\* trong pages:** `app/pages/**` và `app/layouts/**` chỉ dùng `Z*` cho Button/Input/Select/Switch/Card/Alert/Badge/FormField (ESLint chặn `U*`). `ZSheet` và `ZTabs` là primitive mới của PR này (UI foundation spec §1 đã hẹn "thêm khi phase đầu tiên cần").
- **UI:** tiếng Việt, mobile-first 360px, vùng bấm ≥ 44px, có loading/empty/error ở mọi màn, không scroll ngang.
- **Test DB:** integration/api test gọi `resetDb()` và tạo dữ liệu qua `tests/support/fixtures.ts`; không insert thô trong test.
- **Commit:** conventional commits `feat(catalog): …`, kèm trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

## Review Focus

PR này sở hữu Review Focus #7 (một phần: nền tảng `shared/pricing.ts`) của roadmap, cộng năm tình huống dưới đây mà spec không nói rõ nhưng hỏng là gây hại:

1. **Chủ quán gõ giá kiểu Việt Nam** (`35k`, `35.000`, `35,000đ`, `abc`, `-5`, `35.5`, `0`, quá lớn) → quick-add hiểu đúng `35k = 35.000đ`, `35.000 = 35000` (không bao giờ thành 35đ), chữ/số âm/số thập phân sai báo lỗi inline và **không tạo món**; bấm "Thêm món" hai lần liên tiếp chỉ tạo một món. → Task 14 (unit `parseVndInput` + e2e).
2. **Menu public rỗng hoặc bị ẩn:** store chưa có món, mọi món `active=false`, danh mục bị tắt, món có nhóm option bắt buộc nhưng hết lựa chọn → trang hiện "Menu đang được cập nhật" hoặc món "Hết hàng", không 500, không lộ món bị ẩn. → Task 3 (integration) + Task 4 (e2e).
3. **Slug lạ trên `/s/:slug` và `/api/public/stores/:slug/*`:** chữ hoa, rất dài (500 ký tự), ký tự đặc biệt, store `SUSPENDED`, org `SUSPENDED` → 404 sạch (không 500, không phân biệt "không tồn tại" với "bị khoá"); slug viết hoa của store có thật vẫn mở được. → Task 3 + Task 12.
4. **QR bàn cũ/hỏng:** `?t=` rỗng, lặp (`?t=a&t=b`), rác, token của store khác, token sau `regenerate`, bàn bị thu hồi → `INVALID_TABLE`, trang không gắn vào bàn nào và không lộ tên bàn khác; token mới hoạt động ngay. → Task 11, 12, 17, 18.
5. **Upload ảnh giả:** file text đặt tên `.png`, content-type khai gian, > 2 MB, thiếu field `file`, hai lần upload liên tiếp → 400 và không tạo object; ảnh cũ chỉ bị xoá **sau khi** ảnh mới đã ghi DB; lỗi xoá ảnh cũ không làm hỏng response. → Task 9.

Ngoài ra Task 10 pin hai race: bật/tắt mode đồng thời không thể tắt hết mode (khoá hàng store), và Task 8 pin việc `PUT options` đồng thời không để lại trạng thái lẫn lộn.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `server/utils/tokens.ts` | `generateToken`, `hashToken` |
| `server/db/schema/catalog.ts` | `categories`, `products`, `productOptionGroups`, `productOptionValues`, `storeTables`, `deliveryZones` |
| `server/db/schema/index.ts` (modify) | re-export catalog |
| `drizzle/0001_catalog.sql` (generated) | migration |
| `shared/pricing.ts` | `validateSelection`, `defaultSelection`, `toggleSelection`, `selectionDeltas`, `priceLine`, `orderTotals`, `toOptionRules` |
| `shared/money.ts` (modify) | thêm `parseVndInput` |
| `shared/menu-groups.ts`, `shared/menu-search.ts`, `shared/cart-draft.ts`, `shared/option-presets.ts`, `shared/catalog-limits.ts` | hàm thuần dùng chung client/server |
| `shared/schemas/common.ts`, `catalog.ts`, `fulfillment.ts` | zod schema (giá, danh mục, món, option, mode, khu vực, bàn) |
| `shared/types/catalog.ts` | DTO owner + public (`PublicMenu`, `PublicFulfillment`, `ProductDTO`, …) |
| `server/repositories/public-store.ts` | `findPublicStoreBySlug` |
| `server/repositories/catalog.ts` | đọc category/product/option/zone có scope |
| `server/services/catalog/*.ts` | `modes`, `product-view`, `public-menu`, `public-fulfillment`, `categories`, `products`, `options`, `product-image`, `fulfillment`, `delivery-zones`, `tables` |
| `server/utils/ids.ts`, `server/utils/image-type.ts` | `requireUuidParam`, `detectImageType` |
| `server/api/public/stores/[slug]/{menu,fulfillment}.get.ts` | route public |
| `server/api/stores/[storeId]/{categories,products,delivery-zones,tables,fulfillment}/**` | route owner |
| `app/components/z/Sheet.vue`, `Tabs.vue` | primitive mới |
| `app/components/app/StoreStatusAlert.vue` | banner "Quán đang tạm nghỉ" + 1 chạm "Bật nhận đơn" |
| `app/components/menu/*.vue` | `StoreHeader`, `CategoryChips`, `ProductCard`, `ProductSheet`, `CartBar`, `ProductEditor`, `OptionGroupEditor` |
| `app/components/settings/FulfillmentTab.vue`, `TablesTab.vue`, `TableQrSheet.vue` | tab cài đặt mới |
| `app/composables/useMenuAdmin.ts`, `useCartDraft.ts` | state owner menu, giỏ tạm của khách |
| `app/utils/qr.ts` | `qrDataUrl`, `qrFilename`, `escapeHtml`, `printQr` |
| `app/pages/s/[slug].vue` | trang khách C1/C2 |
| `app/pages/app/menu.vue` | O3 |
| `app/pages/app/orders.vue`, `settings.vue`, `app/layouts/owner.vue` (modify) | 1 chạm, tab, nav "Thực đơn" |
| `tests/support/{http,json}.ts`, `tests/support/fixtures.ts` (modify), `tests/e2e/support/owner.ts` | helper test |

---

### Task 1: Schema `catalog` + `tokens.ts` + migration + fixtures

**Files:**
- Create: `server/utils/tokens.ts`, `server/db/schema/catalog.ts`, `drizzle/0001_catalog.sql` (generated), `tests/unit/server/tokens.test.ts`, `tests/integration/catalog-schema.test.ts`
- Modify: `server/db/schema/index.ts`, `tests/support/fixtures.ts`

**Interfaces:**
- Consumes: `timestamps`, `stores` (PR1 `server/db/schema/identity.ts`); `getPgError` (`server/db/errors.ts`); `resetDb`, `createTenant` (PR0/PR1 tests).
- Produces:
  - `generateToken(bytes = 32): string`, `hashToken(token: string): string`.
  - Tables: `categories`, `products`, `productOptionGroups`, `productOptionValues`, `storeTables`, `deliveryZones`.
  - Constraint names (PR3 và test dùng): unique `categories_store_id_id_uq`, `products_store_id_id_uq`, `product_option_groups_store_id_id_uq`, `product_option_values_store_id_id_uq`, `store_tables_store_id_id_uq`, `delivery_zones_store_id_id_uq`, `store_tables_store_code_uq`, `store_tables_token_hash_uq`; FK `categories_store_fk`, `products_store_fk`, `products_category_fk`, `option_groups_store_fk`, `option_groups_product_fk`, `option_values_store_fk`, `option_values_group_fk`, `store_tables_store_fk`, `delivery_zones_store_fk`; check `products_base_price_nonneg`, `option_groups_min_max_valid`, `option_values_price_delta_nonneg`, `delivery_zones_fee_nonneg`.
  - Fixtures: `createCategory(store, name, opts?)`, `createProduct(store, opts?)`, `createOptionGroup(store, product, opts?)`, `createTable(store, code, opts?) → { table, token }`, `createZone(store, opts?)`. `store` là `{ id: string, orgId: string }`.

- [ ] **Step 1: Viết unit test thất bại cho `tokens.ts`**

`tests/unit/server/tokens.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { generateToken, hashToken } from '../../../server/utils/tokens'

describe('generateToken', () => {
  it('returns 32 random bytes as 43 base64url characters', () => {
    const token = generateToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('honours the byte length and never repeats', () => {
    expect(generateToken(16)).toMatch(/^[A-Za-z0-9_-]{22}$/)
    const seen = new Set(Array.from({ length: 200 }, () => generateToken()))
    expect(seen.size).toBe(200)
  })
})

describe('hashToken', () => {
  it('is a deterministic sha256 hex digest', () => {
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(hashToken('abc')).toBe(hashToken('abc'))
    expect(hashToken('abc')).not.toBe(hashToken('abd'))
  })
})
```

- [ ] **Step 2: Viết fixtures và integration test thất bại cho schema**

Trong `tests/support/fixtures.ts`, thay dòng import schema bằng:

```ts
import { categories, deliveryZones, organizationMembers, organizations, productOptionGroups, productOptionValues, products, storeMembers, storeTables, stores, userProfiles } from '../../server/db/schema'
import { generateToken, hashToken } from '../../server/utils/tokens'
```

và thêm vào cuối file (sau hàm `addStaff`):

```ts
type StoreRef = { id: string, orgId: string }

export async function createCategory(store: StoreRef, name: string, opts: { active?: boolean, position?: number } = {}) {
  const [row] = await getDb().insert(categories)
    .values({ orgId: store.orgId, storeId: store.id, name, active: opts.active ?? true, position: opts.position ?? 0 })
    .returning()
  return row!
}

export async function createProduct(
  store: StoreRef,
  opts: {
    name?: string
    basePriceVnd?: number
    categoryId?: string | null
    isAvailable?: boolean
    active?: boolean
    position?: number
    imageKey?: string | null
  } = {},
) {
  const [row] = await getDb().insert(products)
    .values({
      orgId: store.orgId,
      storeId: store.id,
      name: opts.name ?? `Món ${shortId()}`,
      basePriceVnd: opts.basePriceVnd ?? 25000,
      categoryId: opts.categoryId ?? null,
      isAvailable: opts.isAvailable ?? true,
      active: opts.active ?? true,
      position: opts.position ?? 0,
      imageKey: opts.imageKey ?? null,
    })
    .returning()
  return row!
}

export async function createOptionGroup(
  store: StoreRef,
  product: { id: string },
  opts: {
    name?: string
    required?: boolean
    minSelect?: number
    maxSelect?: number
    position?: number
    values?: { name: string, priceDeltaVnd?: number, active?: boolean }[]
  } = {},
) {
  const required = opts.required ?? false
  const [group] = await getDb().insert(productOptionGroups)
    .values({
      orgId: store.orgId,
      storeId: store.id,
      productId: product.id,
      name: opts.name ?? 'Size',
      required,
      minSelect: opts.minSelect ?? (required ? 1 : 0),
      maxSelect: opts.maxSelect ?? 1,
      position: opts.position ?? 0,
    })
    .returning()
  const valueInputs = opts.values ?? [{ name: 'M' }, { name: 'L', priceDeltaVnd: 5000 }]
  const values = valueInputs.length === 0
    ? []
    : await getDb().insert(productOptionValues)
        .values(valueInputs.map((value, index) => ({
          orgId: store.orgId,
          storeId: store.id,
          groupId: group!.id,
          name: value.name,
          priceDeltaVnd: value.priceDeltaVnd ?? 0,
          active: value.active ?? true,
          position: index,
        })))
        .returning()
  return { group: group!, values }
}

export async function createTable(store: StoreRef, code: string, opts: { active?: boolean, displayName?: string } = {}) {
  const token = generateToken()
  const [table] = await getDb().insert(storeTables)
    .values({
      orgId: store.orgId,
      storeId: store.id,
      code,
      displayName: opts.displayName ?? `Bàn ${code}`,
      tokenHash: hashToken(token),
      active: opts.active ?? true,
    })
    .returning()
  return { table: table!, token }
}

export async function createZone(
  store: StoreRef,
  opts: { name?: string, feeVnd?: number, active?: boolean, position?: number } = {},
) {
  const [row] = await getDb().insert(deliveryZones)
    .values({
      orgId: store.orgId,
      storeId: store.id,
      name: opts.name ?? `Khu vực ${shortId()}`,
      feeVnd: opts.feeVnd ?? 15000,
      active: opts.active ?? true,
      position: opts.position ?? 0,
    })
    .returning()
  return row!
}
```

`tests/integration/catalog-schema.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { getPgError } from '../../server/db/errors'
import { categories, deliveryZones, productOptionGroups, productOptionValues, products, storeTables } from '../../server/db/schema'
import { hashToken } from '../../server/utils/tokens'
import { resetDb } from '../support/db'
import { createCategory, createOptionGroup, createProduct, createTable, createTenant } from '../support/fixtures'

async function pgErrorOf(promise: PromiseLike<unknown>) {
  try {
    await promise
    return null
  }
  catch (err) {
    return getPgError(err)
  }
}

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('catalog tenant isolation at the database level', () => {
  it('rejects a product whose category belongs to another store (23503)', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const foreign = await createCategory(b.store, 'Trà')
    const error = await pgErrorOf(getDb().insert(products).values({
      orgId: a.org.id,
      storeId: a.store.id,
      categoryId: foreign.id,
      name: 'Trà đào',
      basePriceVnd: 30000,
    }))
    expect(error).toMatchObject({ code: '23503', constraint: 'products_category_fk' })
  })

  it('rejects an (org_id, store_id) pair that does not match the store (23503)', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const error = await pgErrorOf(getDb().insert(categories).values({ orgId: a.org.id, storeId: b.store.id, name: 'Lạc tenant' }))
    expect(error).toMatchObject({ code: '23503', constraint: 'categories_store_fk' })
  })

  it('allows a product without a category (quick add)', async () => {
    const a = await createTenant('a')
    const product = await createProduct(a.store, { name: 'Trà sữa', categoryId: null })
    expect(product.categoryId).toBeNull()
  })

  it('rejects an option group that points at a product of another store (23503)', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const foreign = await createProduct(b.store)
    const error = await pgErrorOf(getDb().insert(productOptionGroups).values({
      orgId: a.org.id,
      storeId: a.store.id,
      productId: foreign.id,
      name: 'Size',
    }))
    expect(error).toMatchObject({ code: '23503', constraint: 'option_groups_product_fk' })
  })

  it('rejects an option value that points at a group of another store (23503)', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const { group } = await createOptionGroup(b.store, await createProduct(b.store))
    const error = await pgErrorOf(getDb().insert(productOptionValues).values({
      orgId: a.org.id,
      storeId: a.store.id,
      groupId: group.id,
      name: 'M',
    }))
    expect(error).toMatchObject({ code: '23503', constraint: 'option_values_group_fk' })
  })
})

describe('catalog check constraints', () => {
  it('rejects a negative product price (23514)', async () => {
    const a = await createTenant('a')
    const error = await pgErrorOf(getDb().insert(products).values({
      orgId: a.org.id,
      storeId: a.store.id,
      name: 'Giá âm',
      basePriceVnd: -1,
    }))
    expect(error).toMatchObject({ code: '23514', constraint: 'products_base_price_nonneg' })
  })

  it('rejects max_select < min_select (23514)', async () => {
    const a = await createTenant('a')
    const product = await createProduct(a.store)
    const error = await pgErrorOf(getDb().insert(productOptionGroups).values({
      orgId: a.org.id,
      storeId: a.store.id,
      productId: product.id,
      name: 'Topping',
      minSelect: 3,
      maxSelect: 2,
    }))
    expect(error).toMatchObject({ code: '23514', constraint: 'option_groups_min_max_valid' })
  })

  it('rejects a negative option price delta (23514)', async () => {
    const a = await createTenant('a')
    const { group } = await createOptionGroup(a.store, await createProduct(a.store))
    const error = await pgErrorOf(getDb().insert(productOptionValues).values({
      orgId: a.org.id,
      storeId: a.store.id,
      groupId: group.id,
      name: 'Giảm giá',
      priceDeltaVnd: -1000,
    }))
    expect(error).toMatchObject({ code: '23514', constraint: 'option_values_price_delta_nonneg' })
  })

  it('rejects a negative delivery fee (23514)', async () => {
    const a = await createTenant('a')
    const error = await pgErrorOf(getDb().insert(deliveryZones).values({
      orgId: a.org.id,
      storeId: a.store.id,
      name: 'Quận 1',
      feeVnd: -1,
    }))
    expect(error).toMatchObject({ code: '23514', constraint: 'delivery_zones_fee_nonneg' })
  })
})

describe('store_tables uniqueness', () => {
  it('keeps table codes unique per store but reusable across stores (23505)', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    await createTable(a.store, '05')
    await createTable(b.store, '05')
    const error = await pgErrorOf(getDb().insert(storeTables).values({
      orgId: a.org.id,
      storeId: a.store.id,
      code: '05',
      displayName: 'Bàn 05 (trùng)',
      tokenHash: hashToken('another-token'),
    }))
    expect(error).toMatchObject({ code: '23505', constraint: 'store_tables_store_code_uq' })
  })

  it('keeps token hashes globally unique (23505)', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const { table } = await createTable(a.store, '01')
    const error = await pgErrorOf(getDb().insert(storeTables).values({
      orgId: b.org.id,
      storeId: b.store.id,
      code: '01',
      displayName: 'Bàn 01',
      tokenHash: table.tokenHash,
    }))
    expect(error).toMatchObject({ code: '23505', constraint: 'store_tables_token_hash_uq' })
  })
})

describe('option cascade', () => {
  it('deleting a group removes its values', async () => {
    const a = await createTenant('a')
    const { values } = await createOptionGroup(a.store, await createProduct(a.store))
    expect(values.length).toBeGreaterThan(0)
    await getDb().delete(productOptionGroups)
    expect(await getDb().select().from(productOptionValues)).toEqual([])
  })
})
```

- [ ] **Step 3: Chạy test để xác nhận thất bại**

Run: `npx vitest run --project unit tests/unit/server/tokens.test.ts && npx vitest run --project integration tests/integration/catalog-schema.test.ts`
Expected: FAIL — `Cannot find module '../../../server/utils/tokens'` / `'../../server/db/schema'` không export `categories`.

- [ ] **Step 4: Viết `tokens.ts`**

`server/utils/tokens.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto'

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
```

- [ ] **Step 5: Viết schema `catalog.ts`**

`server/db/schema/catalog.ts`:

```ts
import { sql } from 'drizzle-orm'
import { bigint, boolean, check, foreignKey, index, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'
import { stores, timestamps } from './identity'

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  storeId: uuid('store_id').notNull(),
  name: text('name').notNull(),
  position: integer('position').notNull().default(0),
  active: boolean('active').notNull().default(true),
  ...timestamps,
}, t => [
  unique('categories_store_id_id_uq').on(t.storeId, t.id),
  foreignKey({ name: 'categories_store_fk', columns: [t.orgId, t.storeId], foreignColumns: [stores.orgId, stores.id] }).onDelete('cascade'),
  index('categories_store_position_idx').on(t.storeId, t.position),
])

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  storeId: uuid('store_id').notNull(),
  // Nullable on purpose: quick add creates a product before any category exists (MATCH SIMPLE skips the FK when null).
  categoryId: uuid('category_id'),
  name: text('name').notNull(),
  description: text('description'),
  basePriceVnd: bigint('base_price_vnd', { mode: 'number' }).notNull(),
  isAvailable: boolean('is_available').notNull().default(true),
  active: boolean('active').notNull().default(true),
  position: integer('position').notNull().default(0),
  imageKey: text('image_key'),
  ...timestamps,
}, t => [
  unique('products_store_id_id_uq').on(t.storeId, t.id),
  foreignKey({ name: 'products_store_fk', columns: [t.orgId, t.storeId], foreignColumns: [stores.orgId, stores.id] }).onDelete('cascade'),
  foreignKey({ name: 'products_category_fk', columns: [t.storeId, t.categoryId], foreignColumns: [categories.storeId, categories.id] }),
  check('products_base_price_nonneg', sql`${t.basePriceVnd} >= 0`),
  index('products_store_position_idx').on(t.storeId, t.position),
])

export const productOptionGroups = pgTable('product_option_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  storeId: uuid('store_id').notNull(),
  productId: uuid('product_id').notNull(),
  name: text('name').notNull(),
  minSelect: integer('min_select').notNull().default(0),
  maxSelect: integer('max_select').notNull().default(1),
  required: boolean('required').notNull().default(false),
  position: integer('position').notNull().default(0),
  ...timestamps,
}, t => [
  unique('product_option_groups_store_id_id_uq').on(t.storeId, t.id),
  foreignKey({ name: 'option_groups_store_fk', columns: [t.orgId, t.storeId], foreignColumns: [stores.orgId, stores.id] }).onDelete('cascade'),
  foreignKey({ name: 'option_groups_product_fk', columns: [t.storeId, t.productId], foreignColumns: [products.storeId, products.id] }).onDelete('cascade'),
  check('option_groups_min_max_valid', sql`${t.minSelect} >= 0 and ${t.maxSelect} >= ${t.minSelect}`),
  index('option_groups_product_idx').on(t.storeId, t.productId),
])

export const productOptionValues = pgTable('product_option_values', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  storeId: uuid('store_id').notNull(),
  groupId: uuid('group_id').notNull(),
  name: text('name').notNull(),
  priceDeltaVnd: bigint('price_delta_vnd', { mode: 'number' }).notNull().default(0),
  active: boolean('active').notNull().default(true),
  position: integer('position').notNull().default(0),
  ...timestamps,
}, t => [
  unique('product_option_values_store_id_id_uq').on(t.storeId, t.id),
  foreignKey({ name: 'option_values_store_fk', columns: [t.orgId, t.storeId], foreignColumns: [stores.orgId, stores.id] }).onDelete('cascade'),
  foreignKey({ name: 'option_values_group_fk', columns: [t.storeId, t.groupId], foreignColumns: [productOptionGroups.storeId, productOptionGroups.id] }).onDelete('cascade'),
  check('option_values_price_delta_nonneg', sql`${t.priceDeltaVnd} >= 0`),
  index('option_values_group_idx').on(t.storeId, t.groupId),
])

export const storeTables = pgTable('store_tables', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  storeId: uuid('store_id').notNull(),
  code: text('code').notNull(),
  displayName: text('display_name').notNull(),
  tokenHash: text('token_hash').notNull(),
  active: boolean('active').notNull().default(true),
  ...timestamps,
}, t => [
  unique('store_tables_store_id_id_uq').on(t.storeId, t.id),
  unique('store_tables_store_code_uq').on(t.storeId, t.code),
  unique('store_tables_token_hash_uq').on(t.tokenHash),
  foreignKey({ name: 'store_tables_store_fk', columns: [t.orgId, t.storeId], foreignColumns: [stores.orgId, stores.id] }).onDelete('cascade'),
])

export const deliveryZones = pgTable('delivery_zones', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  storeId: uuid('store_id').notNull(),
  name: text('name').notNull(),
  feeVnd: bigint('fee_vnd', { mode: 'number' }).notNull(),
  active: boolean('active').notNull().default(true),
  position: integer('position').notNull().default(0),
  ...timestamps,
}, t => [
  unique('delivery_zones_store_id_id_uq').on(t.storeId, t.id),
  foreignKey({ name: 'delivery_zones_store_fk', columns: [t.orgId, t.storeId], foreignColumns: [stores.orgId, stores.id] }).onDelete('cascade'),
  check('delivery_zones_fee_nonneg', sql`${t.feeVnd} >= 0`),
  index('delivery_zones_store_idx').on(t.storeId, t.position),
])
```

Sửa `server/db/schema/index.ts` thành:

```ts
export * from './identity'
export * from './catalog'
```

- [ ] **Step 6: Sinh migration, kiểm tra, áp dụng lên branch `test`**

Run:

```bash
npx drizzle-kit generate --name catalog
npm run db:check
ENV_FILE=.env.test npx drizzle-kit migrate
```

Expected: tạo đúng một file `drizzle/0001_catalog.sql` (và cập nhật `drizzle/meta/_journal.json`, `0001_snapshot.json`); `db:check` in `Everything's fine`; migrate chạy không lỗi. Mở file SQL và xác nhận có `CREATE TABLE "categories"`, `"products"`, `"product_option_groups"`, `"product_option_values"`, `"store_tables"`, `"delivery_zones"`, các `CONSTRAINT ... CHECK` và `FOREIGN KEY ("store_id","category_id")`.

- [ ] **Step 7: Chạy test để xác nhận đạt**

Run: `npx vitest run --project unit tests/unit/server/tokens.test.ts && npm run test:integration -- tests/integration/catalog-schema.test.ts`
Expected: PASS (3 + 12 test).

- [ ] **Step 8: Commit**

```bash
git add server/utils/tokens.ts server/db/schema/catalog.ts server/db/schema/index.ts drizzle tests/unit/server/tokens.test.ts tests/integration/catalog-schema.test.ts tests/support/fixtures.ts
git commit -m "feat(catalog): add catalog schema, token helpers and fixtures

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: `shared/pricing.ts` — hàm thuần tính giá và kiểm tra option

**Files:**
- Create: `shared/pricing.ts`, `tests/unit/shared/pricing.test.ts`

**Interfaces:**
- Consumes: `assertVnd` (`shared/money.ts`).
- Produces (PR3 và UI dùng; giữ nguyên tên):
  - `interface OptionGroupRule { id: string; minSelect: number; maxSelect: number; required: boolean; values: { id: string; priceDeltaVnd: number; active: boolean }[] }`
  - `type SelectionFailureReason = 'REQUIRED_MISSING' | 'TOO_FEW' | 'TOO_MANY' | 'UNKNOWN_VALUE' | 'INACTIVE_VALUE' | 'DUPLICATE_VALUE'`
  - `type SelectionResult = { ok: true; valueIds: string[] } | { ok: false; reason: SelectionFailureReason; groupId?: string }`
  - `validateSelection(groups: OptionGroupRule[], selected: string[]): SelectionResult`
  - `defaultSelection(groups: OptionGroupRule[]): string[]`
  - `toggleSelection(group: OptionGroupRule, selected: string[], valueId: string): string[]`
  - `selectionDeltas(groups: OptionGroupRule[], valueIds: string[]): number[]`
  - `priceLine(input: { basePriceVnd: number; deltasVnd: number[]; quantity: number }): { unitPriceVnd: number; lineTotalVnd: number }` (quantity 1–50, ném `RangeError` nếu sai)
  - `orderTotals(input: { lineTotalsVnd: number[]; deliveryFeeVnd: number }): { subtotalVnd: number; deliveryFeeVnd: number; totalVnd: number }`
  - `toOptionRules(groups): OptionGroupRule[]` (nhận DTO có `values[].active` tuỳ chọn, mặc định `true`)
  - `MAX_LINE_QUANTITY = 50`

- [ ] **Step 1: Viết unit test thất bại**

`tests/unit/shared/pricing.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  defaultSelection,
  MAX_LINE_QUANTITY,
  orderTotals,
  priceLine,
  selectionDeltas,
  toggleSelection,
  toOptionRules,
  validateSelection,
  type OptionGroupRule,
} from '#shared/pricing'

const size: OptionGroupRule = {
  id: 'g-size',
  minSelect: 1,
  maxSelect: 1,
  required: true,
  values: [
    { id: 'm', priceDeltaVnd: 0, active: true },
    { id: 'l', priceDeltaVnd: 5000, active: true },
    { id: 'xl', priceDeltaVnd: 9000, active: false },
  ],
}
const topping: OptionGroupRule = {
  id: 'g-top',
  minSelect: 0,
  maxSelect: 2,
  required: false,
  values: [
    { id: 'tran-chau', priceDeltaVnd: 5000, active: true },
    { id: 'thach', priceDeltaVnd: 3000, active: true },
    { id: 'pudding', priceDeltaVnd: 7000, active: true },
  ],
}
const groups = [size, topping]

describe('validateSelection', () => {
  it('accepts a valid selection and returns ids in group order', () => {
    expect(validateSelection(groups, ['thach', 'l'])).toEqual({ ok: true, valueIds: ['l', 'thach'] })
  })

  it('accepts an empty selection when no group is required (min 0)', () => {
    expect(validateSelection([topping], [])).toEqual({ ok: true, valueIds: [] })
  })

  it('REQUIRED_MISSING when a required group has no pick', () => {
    expect(validateSelection(groups, ['thach'])).toEqual({ ok: false, reason: 'REQUIRED_MISSING', groupId: 'g-size' })
  })

  it('TOO_FEW when picks are below minSelect of an optional group', () => {
    const optionalMin2: OptionGroupRule = { ...topping, minSelect: 2 }
    expect(validateSelection([optionalMin2], ['thach'])).toEqual({ ok: false, reason: 'TOO_FEW', groupId: 'g-top' })
  })

  it('TOO_MANY when picks exceed maxSelect', () => {
    expect(validateSelection(groups, ['m', 'l'])).toEqual({ ok: false, reason: 'TOO_MANY', groupId: 'g-size' })
    expect(validateSelection(groups, ['m', 'tran-chau', 'thach', 'pudding'])).toEqual({ ok: false, reason: 'TOO_MANY', groupId: 'g-top' })
  })

  it('UNKNOWN_VALUE for an id that belongs to no group', () => {
    expect(validateSelection(groups, ['m', 'khong-co'])).toEqual({ ok: false, reason: 'UNKNOWN_VALUE' })
  })

  it('INACTIVE_VALUE for a disabled value, with its group', () => {
    expect(validateSelection(groups, ['xl'])).toEqual({ ok: false, reason: 'INACTIVE_VALUE', groupId: 'g-size' })
  })

  it('DUPLICATE_VALUE when the same id is sent twice', () => {
    expect(validateSelection(groups, ['m', 'm'])).toEqual({ ok: false, reason: 'DUPLICATE_VALUE', groupId: 'g-size' })
  })
})

describe('defaultSelection', () => {
  it('picks the first active value of every required group', () => {
    expect(defaultSelection(groups)).toEqual(['m'])
  })

  it('skips inactive values and optional groups', () => {
    const allButLast: OptionGroupRule = { ...size, values: [{ id: 'a', priceDeltaVnd: 0, active: false }, { id: 'b', priceDeltaVnd: 0, active: true }] }
    expect(defaultSelection([allButLast, topping])).toEqual(['b'])
  })

  it('returns enough values to satisfy a required group with minSelect > 1', () => {
    const two: OptionGroupRule = { ...topping, required: true, minSelect: 2 }
    expect(defaultSelection([two])).toEqual(['tran-chau', 'thach'])
  })

  it('always produces a selection that validates', () => {
    expect(validateSelection(groups, defaultSelection(groups)).ok).toBe(true)
  })
})

describe('toggleSelection', () => {
  it('replaces the pick of a single-choice group', () => {
    expect(toggleSelection(size, ['m', 'thach'], 'l')).toEqual(['thach', 'l'])
  })

  it('does not clear a required single-choice group by tapping the selected value', () => {
    expect(toggleSelection(size, ['m'], 'm')).toEqual(['m'])
  })

  it('clears an optional single-choice group when tapping the selected value', () => {
    const optional: OptionGroupRule = { ...size, required: false, minSelect: 0 }
    expect(toggleSelection(optional, ['m'], 'm')).toEqual([])
  })

  it('adds up to maxSelect in a multi group and ignores extra taps', () => {
    let selected = toggleSelection(topping, [], 'thach')
    selected = toggleSelection(topping, selected, 'pudding')
    expect(selected).toEqual(['thach', 'pudding'])
    expect(toggleSelection(topping, selected, 'tran-chau')).toEqual(['thach', 'pudding'])
    expect(toggleSelection(topping, selected, 'thach')).toEqual(['pudding'])
  })

  it('ignores inactive and unknown values', () => {
    expect(toggleSelection(size, ['m'], 'xl')).toEqual(['m'])
    expect(toggleSelection(size, ['m'], 'nope')).toEqual(['m'])
  })
})

describe('selectionDeltas', () => {
  it('returns the price delta of each selected value', () => {
    // Group order first (size), then value order inside the group (tran-chau 5000 before thach 3000).
    expect(selectionDeltas(groups, ['l', 'thach', 'tran-chau'])).toEqual([5000, 5000, 3000])
  })
})

describe('priceLine', () => {
  it('adds topping deltas to the base price and multiplies by quantity', () => {
    expect(priceLine({ basePriceVnd: 30000, deltasVnd: [5000, 3000], quantity: 2 })).toEqual({ unitPriceVnd: 38000, lineTotalVnd: 76000 })
  })

  it('works without options', () => {
    expect(priceLine({ basePriceVnd: 25000, deltasVnd: [], quantity: 1 })).toEqual({ unitPriceVnd: 25000, lineTotalVnd: 25000 })
  })

  it.each([0, 51, 1.5, -1, Number.NaN])('rejects quantity %s', (quantity) => {
    expect(() => priceLine({ basePriceVnd: 1000, deltasVnd: [], quantity })).toThrow(RangeError)
  })

  it('accepts the boundaries 1 and MAX_LINE_QUANTITY', () => {
    expect(priceLine({ basePriceVnd: 1000, deltasVnd: [], quantity: 1 }).lineTotalVnd).toBe(1000)
    expect(priceLine({ basePriceVnd: 1000, deltasVnd: [], quantity: MAX_LINE_QUANTITY }).lineTotalVnd).toBe(50000)
  })

  it('throws instead of overflowing past the safe integer range', () => {
    expect(() => priceLine({ basePriceVnd: Number.MAX_SAFE_INTEGER, deltasVnd: [1], quantity: 1 })).toThrow(RangeError)
    expect(() => priceLine({ basePriceVnd: Number.MAX_SAFE_INTEGER / 2, deltasVnd: [], quantity: 3 })).toThrow(RangeError)
  })

  it('rejects negative or fractional amounts', () => {
    expect(() => priceLine({ basePriceVnd: -1, deltasVnd: [], quantity: 1 })).toThrow(RangeError)
    expect(() => priceLine({ basePriceVnd: 1000, deltasVnd: [0.5], quantity: 1 })).toThrow(RangeError)
  })
})

describe('orderTotals', () => {
  it('sums lines and adds the delivery fee', () => {
    expect(orderTotals({ lineTotalsVnd: [76000, 25000], deliveryFeeVnd: 15000 })).toEqual({ subtotalVnd: 101000, deliveryFeeVnd: 15000, totalVnd: 116000 })
  })

  it('handles an empty order', () => {
    expect(orderTotals({ lineTotalsVnd: [], deliveryFeeVnd: 0 })).toEqual({ subtotalVnd: 0, deliveryFeeVnd: 0, totalVnd: 0 })
  })

  it('throws on overflow or invalid fee', () => {
    expect(() => orderTotals({ lineTotalsVnd: [Number.MAX_SAFE_INTEGER, 1], deliveryFeeVnd: 0 })).toThrow(RangeError)
    expect(() => orderTotals({ lineTotalsVnd: [1000], deliveryFeeVnd: -5 })).toThrow(RangeError)
  })
})

describe('toOptionRules', () => {
  it('defaults active to true and strips extra fields', () => {
    const rules = toOptionRules([{ id: 'g', name: 'Size', minSelect: 1, maxSelect: 1, required: true, values: [{ id: 'm', name: 'M', priceDeltaVnd: 0 }] }])
    expect(rules).toEqual([{ id: 'g', minSelect: 1, maxSelect: 1, required: true, values: [{ id: 'm', priceDeltaVnd: 0, active: true }] }])
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `npx vitest run --project unit tests/unit/shared/pricing.test.ts`
Expected: FAIL — `Failed to resolve import "#shared/pricing"`.

- [ ] **Step 3: Viết `shared/pricing.ts`**

```ts
import { assertVnd } from './money'

export const MAX_LINE_QUANTITY = 50

export interface OptionGroupRule {
  id: string
  minSelect: number
  maxSelect: number
  required: boolean
  values: { id: string, priceDeltaVnd: number, active: boolean }[]
}

export type SelectionFailureReason =
  | 'REQUIRED_MISSING'
  | 'TOO_FEW'
  | 'TOO_MANY'
  | 'UNKNOWN_VALUE'
  | 'INACTIVE_VALUE'
  | 'DUPLICATE_VALUE'

export type SelectionResult =
  | { ok: true, valueIds: string[] }
  | { ok: false, reason: SelectionFailureReason, groupId?: string }

function fail(reason: SelectionFailureReason, groupId?: string): SelectionResult {
  return groupId === undefined ? { ok: false, reason } : { ok: false, reason, groupId }
}

export function validateSelection(groups: OptionGroupRule[], selected: string[]): SelectionResult {
  const owner = new Map<string, { group: OptionGroupRule, active: boolean }>()
  for (const group of groups) {
    for (const value of group.values) owner.set(value.id, { group, active: value.active })
  }

  const seen = new Set<string>()
  for (const id of selected) {
    const entry = owner.get(id)
    if (seen.has(id)) return fail('DUPLICATE_VALUE', entry?.group.id)
    seen.add(id)
    if (!entry) return fail('UNKNOWN_VALUE')
    if (!entry.active) return fail('INACTIVE_VALUE', entry.group.id)
  }

  const valueIds: string[] = []
  for (const group of groups) {
    const picked = group.values.filter(value => seen.has(value.id)).map(value => value.id)
    if (group.required && picked.length === 0) return fail('REQUIRED_MISSING', group.id)
    if (picked.length < group.minSelect) return fail('TOO_FEW', group.id)
    if (picked.length > group.maxSelect) return fail('TOO_MANY', group.id)
    valueIds.push(...picked)
  }
  return { ok: true, valueIds }
}

export function defaultSelection(groups: OptionGroupRule[]): string[] {
  const picked: string[] = []
  for (const group of groups) {
    if (!group.required) continue
    const needed = Math.max(group.minSelect, 1)
    picked.push(...group.values.filter(value => value.active).slice(0, needed).map(value => value.id))
  }
  return picked
}

export function toggleSelection(group: OptionGroupRule, selected: string[], valueId: string): string[] {
  const value = group.values.find(candidate => candidate.id === valueId)
  if (!value || !value.active) return selected

  const inGroup = group.values.filter(candidate => selected.includes(candidate.id)).map(candidate => candidate.id)
  const others = selected.filter(id => !inGroup.includes(id))

  if (inGroup.includes(valueId)) {
    // A required single-choice group is a radio: tapping the chosen value must not leave it empty.
    if (group.maxSelect === 1 && group.required) return selected
    return [...others, ...inGroup.filter(id => id !== valueId)]
  }
  if (group.maxSelect === 1) return [...others, valueId]
  if (inGroup.length >= group.maxSelect) return selected
  return [...others, ...inGroup, valueId]
}

export function selectionDeltas(groups: OptionGroupRule[], valueIds: string[]): number[] {
  const picked = new Set(valueIds)
  return groups.flatMap(group => group.values.filter(value => picked.has(value.id)).map(value => value.priceDeltaVnd))
}

export function priceLine(input: { basePriceVnd: number, deltasVnd: number[], quantity: number }): { unitPriceVnd: number, lineTotalVnd: number } {
  const { quantity } = input
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LINE_QUANTITY) {
    throw new RangeError(`Invalid quantity: ${quantity}`)
  }
  let unitPriceVnd = assertVnd(input.basePriceVnd)
  for (const delta of input.deltasVnd) unitPriceVnd = assertVnd(unitPriceVnd + assertVnd(delta))
  return { unitPriceVnd, lineTotalVnd: assertVnd(unitPriceVnd * quantity) }
}

export function orderTotals(input: { lineTotalsVnd: number[], deliveryFeeVnd: number }): { subtotalVnd: number, deliveryFeeVnd: number, totalVnd: number } {
  let subtotalVnd = 0
  for (const line of input.lineTotalsVnd) subtotalVnd = assertVnd(subtotalVnd + assertVnd(line))
  const deliveryFeeVnd = assertVnd(input.deliveryFeeVnd)
  return { subtotalVnd, deliveryFeeVnd, totalVnd: assertVnd(subtotalVnd + deliveryFeeVnd) }
}

export function toOptionRules(
  groups: ReadonlyArray<{
    id: string
    minSelect: number
    maxSelect: number
    required: boolean
    values: ReadonlyArray<{ id: string, priceDeltaVnd: number, active?: boolean }>
  }>,
): OptionGroupRule[] {
  return groups.map(group => ({
    id: group.id,
    minSelect: group.minSelect,
    maxSelect: group.maxSelect,
    required: group.required,
    values: group.values.map(value => ({ id: value.id, priceDeltaVnd: value.priceDeltaVnd, active: value.active ?? true })),
  }))
}
```

- [ ] **Step 4: Chạy test để xác nhận đạt**

Run: `npx vitest run --project unit tests/unit/shared/pricing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/pricing.ts tests/unit/shared/pricing.test.ts
git commit -m "feat(catalog): add pure pricing and option selection helpers

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: API công khai `GET /api/public/stores/:slug/menu`

**Files:**
- Create: `shared/types/catalog.ts`, `server/repositories/public-store.ts`, `server/repositories/catalog.ts`, `server/services/catalog/modes.ts`, `server/services/catalog/product-view.ts`, `server/services/catalog/public-menu.ts`, `server/api/public/stores/[slug]/menu.get.ts`
- Create (test): `tests/unit/server/catalog-modes.test.ts`, `tests/integration/public-menu.test.ts`, `tests/api/catalog-api.test.ts`, `tests/support/http.ts`, `tests/support/json.ts`

**Interfaces:**
- Consumes: bảng catalog + fixtures (Task 1); `AppError`, `defineApiHandler`; `publicObjectUrl`, `PRODUCT_IMAGES_BUCKET` (`server/services/storage`).
- Produces:
  - Types trong `shared/types/catalog.ts` (hợp đồng cho mọi task sau và PR3): `PublicModes`, `PublicOptionValue`, `PublicOptionGroup`, `PublicProduct`, `PublicCategory`, `PublicMenu`, `PublicFulfillment`, `CategoryDTO`, `OptionValueDTO`, `OptionGroupDTO`, `ProductDTO`, `DeliveryZoneDTO`, `TableDTO`, `TableWithQr`.
  - `findPublicStoreBySlug(db: DbOrTx, slug: string): Promise<PublicStoreRow | null>` (chỉ store `ACTIVE` của org `ACTIVE`; slug được hạ chữ thường; slug > 40 ký tự → `null`).
  - `CatalogScope = { orgId: string, storeId: string }`, `inStore(table, scope)`, `listCategoryRows`, `listProductRows`, `listOptionGroupRows`, `listOptionValueRows`, `countActiveZones`.
  - `buildModes(store, activeZoneCount): PublicModes`.
  - `loadProductDTOs(db, scope, opts?: { publicOnly?: boolean, productId?: string }): Promise<ProductDTO[]>`, `toPublicProduct(p: ProductDTO): PublicProduct`, `imageUrlFor(key: string | null): string | null`.
  - `getPublicMenu(db: DbOrTx, slug: string): Promise<PublicMenu>` (ném `NOT_FOUND`).
  - Test helper `call(method, path, token?, body?) → { status, body, headers }`, `callForm`, `findForbiddenKeys(value): string[]`.
  - Hình dạng `modes` (roadmap chỉ ghi tên): `{ dineIn: boolean, pickup: boolean, delivery: { enabled: boolean, available: boolean } }`; `delivery.available = enabled && có ít nhất 1 zone active`.

- [ ] **Step 1: Viết unit test thất bại cho `buildModes`**

`tests/unit/server/catalog-modes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildModes } from '../../../server/services/catalog/modes'

const store = { dineInEnabled: true, pickupEnabled: true, deliveryEnabled: false }

describe('buildModes', () => {
  it('mirrors the store flags', () => {
    expect(buildModes(store, 0)).toEqual({ dineIn: true, pickup: true, delivery: { enabled: false, available: false } })
    expect(buildModes({ ...store, dineInEnabled: false }, 0).dineIn).toBe(false)
  })

  it('delivery is enabled but unavailable until an active zone exists', () => {
    const delivery = { ...store, deliveryEnabled: true }
    expect(buildModes(delivery, 0).delivery).toEqual({ enabled: true, available: false })
    expect(buildModes(delivery, 2).delivery).toEqual({ enabled: true, available: true })
  })

  it('zones alone do not make delivery available when the mode is off', () => {
    expect(buildModes(store, 3).delivery).toEqual({ enabled: false, available: false })
  })
})
```

- [ ] **Step 2: Viết integration test thất bại cho `getPublicMenu`**

`tests/support/json.ts`:

```ts
export const FORBIDDEN_PUBLIC_KEYS = [
  'orgId', 'storeId', 'org_id', 'store_id', 'active', 'imageKey', 'image_key',
  'tokenHash', 'token_hash', 'customerPhone', 'address', 'secret', 'hmacSecret', 'apiToken',
] as const

function collectKeys(value: unknown, into: Set<string>): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into)
  }
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      into.add(key)
      collectKeys(child, into)
    }
  }
  return into
}

/** Keys that must never appear anywhere in a public response. */
export function findForbiddenKeys(value: unknown): string[] {
  const keys = collectKeys(value, new Set<string>())
  return FORBIDDEN_PUBLIC_KEYS.filter(key => keys.has(key))
}
```

`tests/integration/public-menu.test.ts`:

```ts
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { organizations, stores } from '../../server/db/schema'
import { getPublicMenu } from '../../server/services/catalog/public-menu'
import { resetDb } from '../support/db'
import { createCategory, createOptionGroup, createProduct, createTenant, createZone } from '../support/fixtures'
import { findForbiddenKeys } from '../support/json'

const db = () => getDb()

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('getPublicMenu — store resolution', () => {
  it('returns NOT_FOUND for unknown, empty, oversized and path-like slugs', async () => {
    for (const slug of ['khong-ton-tai', '', 'a'.repeat(500), '../etc/passwd', 'khong có']) {
      await expect(getPublicMenu(db(), slug)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    }
  })

  it('treats suspended stores and stores of suspended organizations exactly like missing ones', async () => {
    const t = await createTenant('susp')
    await db().update(stores).set({ status: 'SUSPENDED' }).where(eq(stores.id, t.store.id))
    await expect(getPublicMenu(db(), t.store.slug)).rejects.toMatchObject({ code: 'NOT_FOUND' })

    await db().update(stores).set({ status: 'ACTIVE' }).where(eq(stores.id, t.store.id))
    await expect(getPublicMenu(db(), t.store.slug)).resolves.toBeTruthy()
    await db().update(organizations).set({ status: 'SUSPENDED' }).where(eq(organizations.id, t.org.id))
    await expect(getPublicMenu(db(), t.store.slug)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('resolves an upper-case slug of an existing store', async () => {
    const t = await createTenant('case')
    const menu = await getPublicMenu(db(), t.store.slug.toUpperCase())
    expect(menu.store.slug).toBe(t.store.slug)
  })
})

describe('getPublicMenu — content', () => {
  it('returns an empty menu for a fresh store', async () => {
    const t = await createTenant('empty')
    expect(await getPublicMenu(db(), t.store.slug)).toEqual({
      store: { name: t.store.name, slug: t.store.slug, isAcceptingOrders: false, logoUrl: null },
      modes: { dineIn: true, pickup: true, delivery: { enabled: false, available: false } },
      categories: [],
      products: [],
    })
  })

  it('hides inactive products/categories and the products of an inactive category, keeps unavailable ones flagged', async () => {
    const t = await createTenant('hide')
    const tea = await createCategory(t.store, 'Trà sữa', { position: 1 })
    const hidden = await createCategory(t.store, 'Ẩn', { active: false })
    await createProduct(t.store, { name: 'Trà đào', categoryId: tea.id, position: 2 })
    await createProduct(t.store, { name: 'Trà sữa', categoryId: tea.id, position: 1 })
    await createProduct(t.store, { name: 'Món tắt', active: false })
    await createProduct(t.store, { name: 'Món của danh mục ẩn', categoryId: hidden.id })
    await createProduct(t.store, { name: 'Hết hàng', isAvailable: false, position: 3 })

    const menu = await getPublicMenu(db(), t.store.slug)
    expect(menu.categories.map(c => c.name)).toEqual(['Trà sữa'])
    expect(menu.products.map(p => [p.name, p.isAvailable])).toEqual([['Trà sữa', true], ['Trà đào', true], ['Hết hàng', false]])
    expect(menu.products.find(p => p.name === 'Hết hàng')!.categoryId).toBeNull()
  })

  it('returns only active option values, in order', async () => {
    const t = await createTenant('opts')
    const product = await createProduct(t.store, { name: 'Trà sữa' })
    await createOptionGroup(t.store, product, {
      name: 'Size',
      required: true,
      values: [{ name: 'M' }, { name: 'L', priceDeltaVnd: 5000 }, { name: 'XL', active: false }],
    })
    await createOptionGroup(t.store, product, { name: 'Topping', maxSelect: 2, position: 1, values: [{ name: 'Trân châu', priceDeltaVnd: 5000 }] })

    const [item] = (await getPublicMenu(db(), t.store.slug)).products
    expect(item!.optionGroups.map(g => g.name)).toEqual(['Size', 'Topping'])
    expect(item!.optionGroups[0]).toMatchObject({ required: true, minSelect: 1, maxSelect: 1 })
    expect(item!.optionGroups[0]!.values.map(v => [v.name, v.priceDeltaVnd])).toEqual([['M', 0], ['L', 5000]])
  })

  it('marks a product unavailable when a required group has no active value left', async () => {
    const t = await createTenant('stuck')
    const product = await createProduct(t.store, { name: 'Cà phê' })
    await createOptionGroup(t.store, product, { required: true, values: [{ name: 'M', active: false }] })
    const [item] = (await getPublicMenu(db(), t.store.slug)).products
    expect(item).toMatchObject({ name: 'Cà phê', isAvailable: false, optionGroups: [] })
  })

  it('reports delivery availability from active zones only', async () => {
    const t = await createTenant('deliv')
    await db().update(stores).set({ deliveryEnabled: true }).where(eq(stores.id, t.store.id))
    expect((await getPublicMenu(db(), t.store.slug)).modes.delivery).toEqual({ enabled: true, available: false })
    await createZone(t.store, { active: false })
    expect((await getPublicMenu(db(), t.store.slug)).modes.delivery).toEqual({ enabled: true, available: false })
    await createZone(t.store, { active: true })
    expect((await getPublicMenu(db(), t.store.slug)).modes.delivery).toEqual({ enabled: true, available: true })
  })

  it('builds the image url from the stored key', async () => {
    const t = await createTenant('img')
    await createProduct(t.store, { imageKey: 'stores/s1/products/p1/abc.png' })
    const [item] = (await getPublicMenu(db(), t.store.slug)).products
    expect(item!.imageUrl).toMatch(/\/product-images\/stores\/s1\/products\/p1\/abc\.png$/)
  })

  it('never leaks tenant or internal fields', async () => {
    const t = await createTenant('leak')
    const cat = await createCategory(t.store, 'Trà')
    const product = await createProduct(t.store, { categoryId: cat.id, imageKey: 'stores/x/products/y/z.png' })
    await createOptionGroup(t.store, product)
    const menu = await getPublicMenu(db(), t.store.slug)
    expect(findForbiddenKeys(menu)).toEqual([])
    const json = JSON.stringify(menu)
    expect(json).not.toContain(t.org.id)
    expect(json).not.toContain(t.store.id)
  })
})
```

- [ ] **Step 3: Viết API test thất bại + helper HTTP**

`tests/support/http.ts`:

```ts
import { fetch } from '@nuxt/test-utils/e2e'

export interface CallResult {
  status: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
  headers: Headers
}

function authHeaders(token?: string | null): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {}
}

export async function call(method: string, path: string, token?: string | null, body?: unknown): Promise<CallResult> {
  const headers = authHeaders(token)
  let payload: string | undefined
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = typeof body === 'string' ? body : JSON.stringify(body)
  }
  const res = await fetch(path, { method, headers, body: payload })
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers }
}

export async function callForm(method: string, path: string, token: string | null, form: FormData): Promise<CallResult> {
  const res = await fetch(path, { method, headers: authHeaders(token), body: form })
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers }
}
```

`tests/api/catalog-api.test.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { setup } from '@nuxt/test-utils/e2e'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { stores } from '../../server/db/schema'
import { createTestAuth } from '../support/auth'
import { resetDb } from '../support/db'
import { addStaff, createCategory, createOptionGroup, createProduct, createTenant } from '../support/fixtures'
import { call } from '../support/http'
import { findForbiddenKeys } from '../support/json'

const auth = await createTestAuth()
process.env.AUTH_TEST_JWKS = auth.jwksJson

await setup({
  rootDir: fileURLToPath(new URL('../..', import.meta.url)),
  server: true,
  build: true,
  nuxtConfig: { typescript: { typeCheck: false } },
})

const seed = {} as {
  slug: string
  storeId: string
  orgId: string
  ownerToken: string
  staffToken: string
  otherStoreId: string
  otherOwnerToken: string
}

beforeAll(async () => {
  await resetDb()
  const a = await createTenant('pub-a')
  const b = await createTenant('pub-b')
  const staff = await addStaff(a.store)
  const category = await createCategory(a.store, 'Trà sữa')
  const product = await createProduct(a.store, { name: 'Trà sữa trân châu', basePriceVnd: 35000, categoryId: category.id })
  await createOptionGroup(a.store, product, { name: 'Size', required: true })
  const sign = (user: { userId: string, email: string }) => auth.sign({ sub: user.userId, email: user.email })
  Object.assign(seed, {
    slug: a.store.slug,
    storeId: a.store.id,
    orgId: a.org.id,
    ownerToken: await sign(a.owner),
    staffToken: await sign(staff),
    otherStoreId: b.store.id,
    otherOwnerToken: await sign(b.owner),
  })
})

afterAll(async () => {
  await closeDb()
})

describe('GET /api/public/stores/:slug/menu', () => {
  it('serves the menu anonymously with public cache headers', async () => {
    const res = await call('GET', `/api/public/stores/${seed.slug}/menu`)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=30, s-maxage=60')
    expect(res.body.store).toEqual({ name: 'Store pub-a', slug: seed.slug, isAcceptingOrders: false, logoUrl: null })
    expect(res.body.modes).toEqual({ dineIn: true, pickup: true, delivery: { enabled: false, available: false } })
    expect(res.body.products).toHaveLength(1)
    expect(res.body.products[0]).toMatchObject({ name: 'Trà sữa trân châu', basePriceVnd: 35000, isAvailable: true })
    expect(res.body.products[0].optionGroups[0]).toMatchObject({ name: 'Size', required: true })
  })

  it('does not leak internal or tenant fields', async () => {
    const res = await call('GET', `/api/public/stores/${seed.slug}/menu`)
    expect(findForbiddenKeys(res.body)).toEqual([])
    const json = JSON.stringify(res.body)
    expect(json).not.toContain(seed.orgId)
    expect(json).not.toContain(seed.storeId)
  })

  it('resolves an upper-case slug', async () => {
    const res = await call('GET', `/api/public/stores/${seed.slug.toUpperCase()}/menu`)
    expect(res.status).toBe(200)
    expect(res.body.store.slug).toBe(seed.slug)
  })

  it.each([
    ['unknown', 'khong-ton-tai'],
    ['500 characters', 'a'.repeat(500)],
    ['non-ascii', encodeURIComponent('không-có')],
  ])('returns a clean 404 for a %s slug and never caches it', async (_label, slug) => {
    const res = await call('GET', `/api/public/stores/${slug}/menu`)
    expect(res).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
    expect(res.headers.get('cache-control') ?? '').not.toContain('public')
  })

  it('returns the same 404 for a suspended store', async () => {
    await getDb().update(stores).set({ status: 'SUSPENDED' }).where(eq(stores.id, seed.storeId))
    const suspended = await call('GET', `/api/public/stores/${seed.slug}/menu`)
    await getDb().update(stores).set({ status: 'ACTIVE' }).where(eq(stores.id, seed.storeId))
    const missing = await call('GET', '/api/public/stores/khong-ton-tai/menu')
    expect(suspended.status).toBe(404)
    expect(suspended.body).toEqual(missing.body)
  })
})
```

- [ ] **Step 4: Chạy test để xác nhận thất bại**

Run: `npx vitest run --project unit tests/unit/server/catalog-modes.test.ts && npm run test:integration -- tests/integration/public-menu.test.ts`
Expected: FAIL — không resolve được `server/services/catalog/modes` và `public-menu`. (Chưa chạy `test:api` vì build Nuxt tốn thời gian; chạy ở Step 7.)

- [ ] **Step 5: Viết types dùng chung**

`shared/types/catalog.ts`:

```ts
export interface PublicModes {
  dineIn: boolean
  pickup: boolean
  delivery: { enabled: boolean, available: boolean }
}

export interface PublicOptionValue {
  id: string
  name: string
  priceDeltaVnd: number
}

export interface PublicOptionGroup {
  id: string
  name: string
  required: boolean
  minSelect: number
  maxSelect: number
  values: PublicOptionValue[]
}

export interface PublicProduct {
  id: string
  categoryId: string | null
  name: string
  description: string | null
  basePriceVnd: number
  isAvailable: boolean
  imageUrl: string | null
  optionGroups: PublicOptionGroup[]
}

export interface PublicCategory {
  id: string
  name: string
}

export interface PublicMenu {
  store: { name: string, slug: string, isAcceptingOrders: boolean, logoUrl: string | null }
  modes: PublicModes
  categories: PublicCategory[]
  products: PublicProduct[]
}

export interface PublicFulfillment {
  modes: PublicModes
  deliveryZones: { id: string, name: string, feeVnd: number }[]
  table: { displayName: string } | null
  tableError: 'INVALID_TABLE' | null
}

export interface CategoryDTO {
  id: string
  name: string
  position: number
  active: boolean
}

export interface OptionValueDTO {
  id: string
  name: string
  priceDeltaVnd: number
  active: boolean
  position: number
}

export interface OptionGroupDTO {
  id: string
  name: string
  required: boolean
  minSelect: number
  maxSelect: number
  position: number
  values: OptionValueDTO[]
}

export interface ProductDTO {
  id: string
  categoryId: string | null
  name: string
  description: string | null
  basePriceVnd: number
  isAvailable: boolean
  active: boolean
  position: number
  imageUrl: string | null
  optionGroups: OptionGroupDTO[]
}

export interface DeliveryZoneDTO {
  id: string
  name: string
  feeVnd: number
  active: boolean
  position: number
}

export interface TableDTO {
  id: string
  code: string
  displayName: string
  active: boolean
}

export interface TableWithQr extends TableDTO {
  qrUrl: string
}
```

- [ ] **Step 6: Viết repository, service và route**

`server/repositories/public-store.ts`:

```ts
import { and, eq } from 'drizzle-orm'
import type { DbOrTx } from '../db/client'
import { organizations, stores } from '../db/schema'

export interface PublicStoreRow {
  id: string
  orgId: string
  name: string
  slug: string
  isAcceptingOrders: boolean
  dineInEnabled: boolean
  pickupEnabled: boolean
  deliveryEnabled: boolean
  logoKey: string | null
}

const MAX_SLUG_LENGTH = 40

export async function findPublicStoreBySlug(db: DbOrTx, slug: string): Promise<PublicStoreRow | null> {
  const normalized = slug.trim().toLowerCase()
  if (normalized.length === 0 || normalized.length > MAX_SLUG_LENGTH) return null
  const [row] = await db
    .select({
      id: stores.id,
      orgId: stores.orgId,
      name: stores.name,
      slug: stores.slug,
      isAcceptingOrders: stores.isAcceptingOrders,
      dineInEnabled: stores.dineInEnabled,
      pickupEnabled: stores.pickupEnabled,
      deliveryEnabled: stores.deliveryEnabled,
      logoKey: stores.logoKey,
    })
    .from(stores)
    .innerJoin(organizations, eq(organizations.id, stores.orgId))
    .where(and(eq(stores.slug, normalized), eq(stores.status, 'ACTIVE'), eq(organizations.status, 'ACTIVE')))
    .limit(1)
  return row ?? null
}
```

`server/repositories/catalog.ts`:

```ts
import { and, asc, count, eq, inArray, isNull, or, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { DbOrTx } from '../db/client'
import { categories, deliveryZones, productOptionGroups, productOptionValues, products } from '../db/schema'

export interface CatalogScope {
  orgId: string
  storeId: string
}

export function inStore(table: { orgId: AnyPgColumn, storeId: AnyPgColumn }, scope: CatalogScope): SQL | undefined {
  return and(eq(table.orgId, scope.orgId), eq(table.storeId, scope.storeId))
}

export async function listCategoryRows(db: DbOrTx, scope: CatalogScope, opts: { activeOnly?: boolean } = {}) {
  return db
    .select()
    .from(categories)
    .where(and(inStore(categories, scope), opts.activeOnly ? eq(categories.active, true) : undefined))
    .orderBy(asc(categories.position), asc(categories.createdAt), asc(categories.id))
}

export async function listProductRows(db: DbOrTx, scope: CatalogScope, opts: { publicOnly?: boolean, productId?: string } = {}) {
  const rows = await db
    .select({ product: products })
    .from(products)
    .leftJoin(categories, and(eq(categories.storeId, products.storeId), eq(categories.id, products.categoryId)))
    .where(and(
      inStore(products, scope),
      opts.productId ? eq(products.id, opts.productId) : undefined,
      opts.publicOnly ? and(eq(products.active, true), or(isNull(products.categoryId), eq(categories.active, true))) : undefined,
    ))
    .orderBy(asc(products.position), asc(products.createdAt), asc(products.id))
  return rows.map(row => row.product)
}

export async function listOptionGroupRows(db: DbOrTx, scope: CatalogScope, productIds: string[]) {
  if (productIds.length === 0) return []
  return db
    .select()
    .from(productOptionGroups)
    .where(and(inStore(productOptionGroups, scope), inArray(productOptionGroups.productId, productIds)))
    .orderBy(asc(productOptionGroups.position), asc(productOptionGroups.createdAt), asc(productOptionGroups.id))
}

export async function listOptionValueRows(db: DbOrTx, scope: CatalogScope, groupIds: string[]) {
  if (groupIds.length === 0) return []
  return db
    .select()
    .from(productOptionValues)
    .where(and(inStore(productOptionValues, scope), inArray(productOptionValues.groupId, groupIds)))
    .orderBy(asc(productOptionValues.position), asc(productOptionValues.createdAt), asc(productOptionValues.id))
}

export async function countActiveZones(db: DbOrTx, scope: CatalogScope): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(deliveryZones)
    .where(and(inStore(deliveryZones, scope), eq(deliveryZones.active, true)))
  return row?.total ?? 0
}
```

`server/services/catalog/modes.ts`:

```ts
import type { PublicModes } from '#shared/types/catalog'

export function buildModes(
  store: { dineInEnabled: boolean, pickupEnabled: boolean, deliveryEnabled: boolean },
  activeZoneCount: number,
): PublicModes {
  return {
    dineIn: store.dineInEnabled,
    pickup: store.pickupEnabled,
    delivery: { enabled: store.deliveryEnabled, available: store.deliveryEnabled && activeZoneCount > 0 },
  }
}
```

`server/services/catalog/product-view.ts`:

```ts
import type { OptionGroupDTO, OptionValueDTO, ProductDTO, PublicOptionGroup, PublicProduct } from '#shared/types/catalog'
import type { DbOrTx } from '../../db/client'
import { listOptionGroupRows, listOptionValueRows, listProductRows, type CatalogScope } from '../../repositories/catalog'
import { PRODUCT_IMAGES_BUCKET, publicObjectUrl } from '../storage'

export function imageUrlFor(key: string | null): string | null {
  return key ? publicObjectUrl(PRODUCT_IMAGES_BUCKET, key) : null
}

export async function loadProductDTOs(
  db: DbOrTx,
  scope: CatalogScope,
  opts: { publicOnly?: boolean, productId?: string } = {},
): Promise<ProductDTO[]> {
  const productRows = await listProductRows(db, scope, opts)
  const groupRows = await listOptionGroupRows(db, scope, productRows.map(row => row.id))
  const valueRows = await listOptionValueRows(db, scope, groupRows.map(row => row.id))

  const valuesByGroup = new Map<string, OptionValueDTO[]>()
  for (const value of valueRows) {
    const list = valuesByGroup.get(value.groupId) ?? []
    list.push({ id: value.id, name: value.name, priceDeltaVnd: value.priceDeltaVnd, active: value.active, position: value.position })
    valuesByGroup.set(value.groupId, list)
  }

  const groupsByProduct = new Map<string, OptionGroupDTO[]>()
  for (const group of groupRows) {
    const list = groupsByProduct.get(group.productId) ?? []
    list.push({
      id: group.id,
      name: group.name,
      required: group.required,
      minSelect: group.minSelect,
      maxSelect: group.maxSelect,
      position: group.position,
      values: valuesByGroup.get(group.id) ?? [],
    })
    groupsByProduct.set(group.productId, list)
  }

  return productRows.map(row => ({
    id: row.id,
    categoryId: row.categoryId,
    name: row.name,
    description: row.description,
    basePriceVnd: row.basePriceVnd,
    isAvailable: row.isAvailable,
    active: row.active,
    position: row.position,
    imageUrl: imageUrlFor(row.imageKey),
    optionGroups: groupsByProduct.get(row.id) ?? [],
  }))
}

export function toPublicProduct(product: ProductDTO): PublicProduct {
  const optionGroups: PublicOptionGroup[] = product.optionGroups
    .map(group => ({
      id: group.id,
      name: group.name,
      required: group.required,
      minSelect: group.minSelect,
      maxSelect: group.maxSelect,
      values: group.values.filter(value => value.active).map(value => ({ id: value.id, name: value.name, priceDeltaVnd: value.priceDeltaVnd })),
    }))
    .filter(group => group.values.length > 0)

  // A required group that can no longer be satisfied makes the product impossible to order.
  const unfulfillable = product.optionGroups.some((group) => {
    const needed = Math.max(group.minSelect, group.required ? 1 : 0)
    return group.values.filter(value => value.active).length < needed
  })

  return {
    id: product.id,
    categoryId: product.categoryId,
    name: product.name,
    description: product.description,
    basePriceVnd: product.basePriceVnd,
    isAvailable: product.isAvailable && !unfulfillable,
    imageUrl: product.imageUrl,
    optionGroups,
  }
}
```

`server/services/catalog/public-menu.ts`:

```ts
import type { PublicMenu } from '#shared/types/catalog'
import type { DbOrTx } from '../../db/client'
import { countActiveZones, listCategoryRows } from '../../repositories/catalog'
import { findPublicStoreBySlug } from '../../repositories/public-store'
import { AppError } from '../../utils/errors'
import { buildModes } from './modes'
import { imageUrlFor, loadProductDTOs, toPublicProduct } from './product-view'

export async function getPublicMenu(db: DbOrTx, slug: string): Promise<PublicMenu> {
  const store = await findPublicStoreBySlug(db, slug)
  if (!store) throw new AppError('NOT_FOUND', 'Không tìm thấy')
  const scope = { orgId: store.orgId, storeId: store.id }

  const [categoryRows, productDTOs, zoneCount] = await Promise.all([
    listCategoryRows(db, scope, { activeOnly: true }),
    loadProductDTOs(db, scope, { publicOnly: true }),
    countActiveZones(db, scope),
  ])

  return {
    store: { name: store.name, slug: store.slug, isAcceptingOrders: store.isAcceptingOrders, logoUrl: imageUrlFor(store.logoKey) },
    modes: buildModes(store, zoneCount),
    categories: categoryRows.map(row => ({ id: row.id, name: row.name })),
    products: productDTOs.map(toPublicProduct),
  }
}
```

`server/api/public/stores/[slug]/menu.get.ts`:

```ts
import { getRouterParam, setResponseHeader } from 'h3'
import { getDb } from '../../../../db/client'
import { getPublicMenu } from '../../../../services/catalog/public-menu'
import { defineApiHandler } from '../../../../utils/api-handler'

export default defineApiHandler(async (event) => {
  const menu = await getPublicMenu(getDb(), getRouterParam(event, 'slug') ?? '')
  // Set only on success so a 404 is never cached by the CDN.
  setResponseHeader(event, 'cache-control', 'public, max-age=30, s-maxage=60')
  return menu
})
```

- [ ] **Step 7: Chạy test để xác nhận đạt**

Run:

```bash
npx vitest run --project unit tests/unit/server/catalog-modes.test.ts
npm run test:integration -- tests/integration/public-menu.test.ts
npm run test:api -- tests/api/catalog-api.test.ts
```

Expected: cả ba PASS (test API build Nuxt mất 1–3 phút).

- [ ] **Step 8: Commit**

```bash
git add shared/types/catalog.ts server/repositories server/services/catalog server/api/public tests
git commit -m "feat(catalog): add public menu API

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Trang khách `/s/[slug]` (header, badge, trạng thái menu rỗng)

**Files:**
- Create: `shared/menu-groups.ts`, `app/components/menu/StoreHeader.vue`, `app/pages/s/[slug].vue`
- Test: `tests/unit/shared/menu-groups.test.ts`, `tests/nuxt/menu/store-header.test.ts`, `tests/e2e/public-menu.spec.ts`

**Interfaces:**
- Consumes: `PublicMenu`, `PublicModes` (Task 3); `formatVnd` (`shared/money.ts`); `ZBadge`, `ZAlert`, `AppEmptyState`.
- Produces:
  - `groupByCategory<T extends { categoryId: string | null }>(categories: ReadonlyArray<{ id: string, name: string }>, products: ReadonlyArray<T>, opts?: { keepEmpty?: boolean, uncategorizedLabel?: string }): CategoryGroup<T>[]` với `CategoryGroup<T> = { id: string | null, name: string, products: T[] }`.
  - `<MenuStoreHeader name isAcceptingOrders modes tableLabel? />` (`data-testid="store-name"` trên `h1`).
  - Route `/s/:slug` (SSR). Slug không tồn tại → `createError({ statusCode: 404, fatal: true })` → `app/error.vue` "Không tìm thấy trang" kèm HTTP 404.
  - Task 17 sẽ thay thân trang này bằng bản đầy đủ (chip, tìm kiếm, sheet option, `?t=`); header và `groupByCategory` giữ nguyên.

- [ ] **Step 1: Viết unit test thất bại cho `groupByCategory`**

`tests/unit/shared/menu-groups.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { groupByCategory } from '#shared/menu-groups'

const categories = [{ id: 'c1', name: 'Trà sữa' }, { id: 'c2', name: 'Cà phê' }, { id: 'c3', name: 'Rỗng' }]
const p = (id: string, categoryId: string | null) => ({ id, categoryId })

describe('groupByCategory', () => {
  it('keeps category order and product order, and drops empty categories', () => {
    const groups = groupByCategory(categories, [p('a', 'c2'), p('b', 'c1'), p('c', 'c2')])
    expect(groups.map(g => [g.id, g.products.map(x => x.id)])).toEqual([['c1', ['b']], ['c2', ['a', 'c']]])
  })

  it('puts uncategorised products in a last group', () => {
    const groups = groupByCategory(categories, [p('a', null), p('b', 'c1')])
    expect(groups.map(g => [g.id, g.name])).toEqual([['c1', 'Trà sữa'], [null, 'Món khác']])
  })

  it('treats a product with an unknown category as uncategorised', () => {
    expect(groupByCategory(categories, [p('a', 'gone')]).map(g => g.id)).toEqual([null])
  })

  it('keeps empty categories when asked (owner view)', () => {
    expect(groupByCategory(categories, [], { keepEmpty: true }).map(g => g.id)).toEqual(['c1', 'c2', 'c3'])
  })

  it('returns no groups for an empty menu', () => {
    expect(groupByCategory([], [])).toEqual([])
  })

  it('supports a custom label for the uncategorised group', () => {
    expect(groupByCategory([], [p('a', null)], { uncategorizedLabel: 'Chưa phân loại' })[0]!.name).toBe('Chưa phân loại')
  })
})
```

- [ ] **Step 2: Viết component test thất bại cho header**

`tests/nuxt/menu/store-header.test.ts`:

```ts
import { renderSuspended } from '@nuxt/test-utils/runtime'
import { screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import MenuStoreHeader from '~/components/menu/StoreHeader.vue'

const modes = { dineIn: true, pickup: true, delivery: { enabled: true, available: true } }

describe('MenuStoreHeader', () => {
  it('shows the store name as the only h1 and the accepting badge', async () => {
    await renderSuspended(MenuStoreHeader, { props: { name: 'Trà Sữa Mây', isAcceptingOrders: true, modes } })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Trà Sữa Mây')
    expect(screen.getByText('Đang nhận đơn')).toBeTruthy()
  })

  it('shows the paused badge when the store is closed', async () => {
    await renderSuspended(MenuStoreHeader, { props: { name: 'Quán', isAcceptingOrders: false, modes } })
    expect(screen.getByText('Tạm nghỉ')).toBeTruthy()
    expect(screen.queryByText('Đang nhận đơn')).toBeNull()
  })

  it('lists pickup and (only when available) delivery', async () => {
    await renderSuspended(MenuStoreHeader, {
      props: { name: 'Quán', isAcceptingOrders: true, modes: { ...modes, delivery: { enabled: true, available: false } } },
    })
    expect(screen.getByText('Mang đi')).toBeTruthy()
    expect(screen.queryByText('Giao hàng')).toBeNull()
  })

  it('shows the table label instead of a dine-in chip when a valid table is given', async () => {
    await renderSuspended(MenuStoreHeader, { props: { name: 'Quán', isAcceptingOrders: true, modes, tableLabel: 'Bàn 05' } })
    expect(screen.getByText('Bàn 05')).toBeTruthy()
  })
})
```

- [ ] **Step 3: Viết E2E thất bại cho trang khách**

`tests/e2e/public-menu.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { closeDb, getDb } from '../../server/db/client'
import { stores } from '../../server/db/schema'
import { createCategory, createProduct, createTenant } from '../support/fixtures'
import { expectNoHorizontalOverflow } from './support/layout'

test.afterAll(async () => {
  await closeDb()
})

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
})

test('a store with no menu shows the updating state and the paused badge', async ({ page }) => {
  const t = await createTenant('e2e-empty')
  await page.goto(`/s/${t.store.slug}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.store.name)
  await expect(page.getByText('Tạm nghỉ', { exact: true })).toBeVisible()
  await expect(page.getByText('Menu đang được cập nhật')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('an accepting store lists products by category and flags sold-out items', async ({ page }) => {
  const t = await createTenant('e2e-menu')
  await getDb().update(stores).set({ isAcceptingOrders: true }).where(eq(stores.id, t.store.id))
  const tea = await createCategory(t.store, 'Trà sữa', { position: 1 })
  await createProduct(t.store, { name: 'Trà sữa trân châu', basePriceVnd: 35000, categoryId: tea.id, position: 1 })
  await createProduct(t.store, { name: 'Cà phê muối', basePriceVnd: 29000, isAvailable: false, position: 2 })

  await page.goto(`/s/${t.store.slug}`)
  await expect(page.getByText('Đang nhận đơn', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Trà sữa' })).toBeVisible()
  await expect(page.getByText('35.000đ')).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'Cà phê muối' }).getByText('Hết hàng')).toBeVisible()
  await expect(page.getByText('Menu đang được cập nhật')).toBeHidden()
  await expectNoHorizontalOverflow(page)
})

test('an upper-case slug opens the same store', async ({ page }) => {
  const t = await createTenant('e2e-case')
  await page.goto(`/s/${t.store.slug.toUpperCase()}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.store.name)
})

test('an unknown slug returns 404 with the not-found page', async ({ page }) => {
  const response = await page.goto('/s/khong-ton-tai-xyz')
  expect(response?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeVisible()
})
```

- [ ] **Step 4: Chạy test để xác nhận thất bại**

Run: `npx vitest run --project unit tests/unit/shared/menu-groups.test.ts && npx vitest run --project nuxt tests/nuxt/menu/store-header.test.ts`
Expected: FAIL — thiếu `#shared/menu-groups` và `~/components/menu/StoreHeader.vue`. (E2E chạy ở Step 7.)

- [ ] **Step 5: Viết `shared/menu-groups.ts`**

```ts
export interface CategoryGroup<T> {
  id: string | null
  name: string
  products: T[]
}

export function groupByCategory<T extends { categoryId: string | null }>(
  categories: ReadonlyArray<{ id: string, name: string }>,
  products: ReadonlyArray<T>,
  opts: { keepEmpty?: boolean, uncategorizedLabel?: string } = {},
): CategoryGroup<T>[] {
  const known = new Set(categories.map(category => category.id))
  const groups: CategoryGroup<T>[] = categories
    .map(category => ({ id: category.id, name: category.name, products: products.filter(product => product.categoryId === category.id) }))
    .filter(group => opts.keepEmpty || group.products.length > 0)

  const loose = products.filter(product => product.categoryId === null || !known.has(product.categoryId))
  if (loose.length > 0) groups.push({ id: null, name: opts.uncategorizedLabel ?? 'Món khác', products: [...loose] })
  return groups
}
```

- [ ] **Step 6: Viết header và trang**

`app/components/menu/StoreHeader.vue`:

```vue
<script setup lang="ts">
import type { PublicModes } from '#shared/types/catalog'

const props = defineProps<{
  name: string
  isAcceptingOrders: boolean
  modes: PublicModes
  tableLabel?: string | null
}>()

const chips = computed(() => {
  const list: { label: string, icon: string }[] = []
  if (props.tableLabel) list.push({ label: props.tableLabel, icon: 'i-lucide-armchair' })
  if (props.modes.pickup) list.push({ label: 'Mang đi', icon: 'i-lucide-shopping-bag' })
  if (props.modes.delivery.available) list.push({ label: 'Giao hàng', icon: 'i-lucide-bike' })
  return list
})
</script>

<template>
  <header class="flex flex-col gap-3">
    <div class="flex items-start justify-between gap-3">
      <h1 data-testid="store-name" class="text-h2 min-w-0 break-words text-default">
        {{ name }}
      </h1>
      <ZBadge
        :status="isAcceptingOrders ? 'success' : 'warning'"
        :icon="isAcceptingOrders ? 'i-lucide-circle-dot' : 'i-lucide-pause'"
        class="mt-2 shrink-0"
      >
        {{ isAcceptingOrders ? 'Đang nhận đơn' : 'Tạm nghỉ' }}
      </ZBadge>
    </div>
    <ul v-if="chips.length" class="flex flex-wrap gap-2" aria-label="Hình thức nhận món">
      <li v-for="chip in chips" :key="chip.label">
        <ZBadge status="neutral" size="sm" :icon="chip.icon">
          {{ chip.label }}
        </ZBadge>
      </li>
    </ul>
  </header>
</template>
```

`app/pages/s/[slug].vue`:

```vue
<script setup lang="ts">
import type { PublicMenu } from '#shared/types/catalog'
import { groupByCategory } from '#shared/menu-groups'
import { formatVnd } from '#shared/money'

const route = useRoute()
const slug = computed(() => String(route.params.slug ?? '').toLowerCase())

const { data: menu, error, refresh } = await useFetch<PublicMenu>(
  () => `/api/public/stores/${encodeURIComponent(slug.value)}/menu`,
)
if (error.value?.statusCode === 404) {
  throw createError({ statusCode: 404, statusMessage: 'Not Found', fatal: true })
}

useSeoMeta({
  title: () => menu.value?.store.name ?? 'Thực đơn',
  description: () => `Xem thực đơn và đặt món tại ${menu.value?.store.name ?? 'quán'}.`,
})

const sections = computed(() => (menu.value ? groupByCategory(menu.value.categories, menu.value.products) : []))
</script>

<template>
  <div class="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 pb-16 pt-[calc(1.25rem+env(safe-area-inset-top))]">
    <ZAlert v-if="error" color="error" title="Không tải được menu">
      <template #actions>
        <ZButton variant="secondary" size="sm" icon="i-lucide-refresh-cw" @click="refresh()">
          Thử lại
        </ZButton>
      </template>
    </ZAlert>

    <template v-else-if="menu">
      <MenuStoreHeader :name="menu.store.name" :is-accepting-orders="menu.store.isAcceptingOrders" :modes="menu.modes" />

      <ZAlert
        v-if="!menu.store.isAcceptingOrders"
        color="warning"
        title="Quán đang tạm nghỉ"
        description="Bạn vẫn xem được menu, nhưng chưa đặt món được lúc này."
      />

      <AppEmptyState
        v-if="sections.length === 0"
        icon="i-lucide-coffee"
        title="Menu đang được cập nhật"
        description="Quán đang thêm món. Bạn quay lại sau ít phút nhé."
      />

      <section v-for="section in sections" :key="section.id ?? 'other'" class="flex flex-col gap-3">
        <h2 class="text-h3 text-default">
          {{ section.name }}
        </h2>
        <ul class="flex flex-col gap-2">
          <li
            v-for="product in section.products"
            :key="product.id"
            class="flex items-center justify-between gap-3 rounded-md bg-(--zeno-surface) p-4 ring-1 ring-default"
          >
            <div class="min-w-0">
              <p class="break-words font-medium text-default">
                {{ product.name }}
              </p>
              <p class="font-mono text-sm text-muted">
                {{ formatVnd(product.basePriceVnd) }}
              </p>
            </div>
            <ZBadge v-if="!product.isAvailable" status="neutral" size="sm">
              Hết hàng
            </ZBadge>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
```

- [ ] **Step 7: Chạy test để xác nhận đạt**

Run:

```bash
npx vitest run --project unit tests/unit/shared/menu-groups.test.ts
npx vitest run --project nuxt tests/nuxt/menu/store-header.test.ts
npx playwright test tests/e2e/public-menu.spec.ts
npm run lint -- app/pages/s app/components/menu shared/menu-groups.ts
```

Expected: PASS; lint sạch (không dùng `U*` bị cấm trong `pages/`).

- [ ] **Step 8: Commit**

```bash
git add shared/menu-groups.ts app/components/menu app/pages/s tests
git commit -m "feat(catalog): add public store page with status badge and empty menu state

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Owner 1 chạm: "Xem trang khách" và "Bật nhận đơn" trên `/app/orders`

**Files:**
- Create: `app/components/app/StoreStatusAlert.vue`, `tests/e2e/support/owner.ts`
- Modify: `app/pages/app/orders.vue`
- Test: `tests/nuxt/app/store-status-alert.test.ts`, `tests/e2e/owner-quick-actions.spec.ts`

**Interfaces:**
- Consumes: `useApi`, `useMe().load(force)`, `useActiveStore()`, `extractApiError`, `PATCH /api/stores/:id` (`isAcceptingOrders`, PR1), `/s/[slug]` (Task 4).
- Produces:
  - `<AppStoreStatusAlert />`: hiện khi `activeStore.isAcceptingOrders === false`; nút "Bật nhận đơn" (chỉ role `OWNER`) PATCH `{ isAcceptingOrders: true }` rồi `load(true)`; không điều hướng.
  - Nút `Xem trang khách` (link `href="/s/<slug>"`, `target="_blank"`) thay "Mở cài đặt" trong empty state của `/app/orders`.
  - E2E helper `signUpAndOnboard(page, testInfo, storeName): Promise<{ slug: string, email: string }>` và `uniqueStamp(testInfo)`, `E2E_PASSWORD` (Task 14, 16, 17, 19 dùng lại).

- [ ] **Step 1: Viết component test thất bại**

`tests/nuxt/app/store-status-alert.test.ts`:

```ts
import { mockNuxtImport, renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen, waitFor } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AppStoreStatusAlert from '~/components/app/StoreStatusAlert.vue'

const { api } = vi.hoisted(() => ({ api: vi.fn() }))
mockNuxtImport('useApi', () => () => api)

function meWith(isAcceptingOrders: boolean, role: 'OWNER' | 'STAFF' = 'OWNER') {
  return {
    user: { id: 'u1', email: 'a@b.vn', displayName: 'A' },
    organizations: [],
    stores: [{ id: 's1', orgId: 'o1', name: 'Quán A', slug: 'quan-a', role, isAcceptingOrders }],
  }
}

beforeEach(() => {
  api.mockReset()
  useCookie('zeno_active_store').value = 's1'
})

describe('AppStoreStatusAlert', () => {
  it('turns ordering on in one tap and refreshes /api/me without navigating', async () => {
    useState('me').value = meWith(false)
    api.mockImplementation(async (url: string) => (url === '/api/me' ? meWith(true) : { id: 's1' }))
    await renderSuspended(AppStoreStatusAlert)

    await fireEvent.click(screen.getByRole('button', { name: 'Bật nhận đơn' }))

    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/stores/s1', { method: 'PATCH', body: { isAcceptingOrders: true } }))
    expect(api).toHaveBeenCalledWith('/api/me')
    await waitFor(() => expect(screen.queryByText(/Quán đang tạm nghỉ/)).toBeNull())
  })

  it('keeps the alert and re-enables the button when the request fails', async () => {
    useState('me').value = meWith(false)
    api.mockRejectedValue({ data: { code: 'INTERNAL', message: 'Lỗi máy chủ' } })
    await renderSuspended(AppStoreStatusAlert)

    const button = screen.getByRole('button', { name: 'Bật nhận đơn' })
    await fireEvent.click(button)

    await waitFor(() => expect(api).toHaveBeenCalledTimes(1))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Bật nhận đơn' }) as HTMLButtonElement).disabled).toBe(false))
    expect(screen.getByText(/Quán đang tạm nghỉ/)).toBeTruthy()
  })

  it('does not offer the button to staff', async () => {
    useState('me').value = meWith(false, 'STAFF')
    await renderSuspended(AppStoreStatusAlert)
    expect(screen.getByText(/Quán đang tạm nghỉ/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Bật nhận đơn' })).toBeNull()
  })

  it('renders nothing while the store accepts orders', async () => {
    useState('me').value = meWith(true)
    await renderSuspended(AppStoreStatusAlert)
    expect(screen.queryByText(/Quán đang tạm nghỉ/)).toBeNull()
  })
})
```

- [ ] **Step 2: Viết helper E2E và spec thất bại**

`tests/e2e/support/owner.ts`:

```ts
import { expect, type Page, type TestInfo } from '@playwright/test'

export const E2E_PASSWORD = 'E2e-Password-123'

export function uniqueStamp(testInfo: TestInfo): string {
  return `${Date.now().toString(36)}${testInfo.project.name === 'mobile-safari' ? 's' : 'c'}`
}

/** Real Neon Auth sign-up + onboarding; ends on /app/orders at a 360px viewport. */
export async function signUpAndOnboard(page: Page, testInfo: TestInfo, storeName: string): Promise<{ slug: string, email: string }> {
  const stamp = uniqueStamp(testInfo)
  const email = `e2e+${stamp}@example.com`
  const slug = `e2e-${stamp}`
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto('/signup')
  await page.getByLabel('Tên của bạn').fill('Chủ Quán E2E')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(E2E_PASSWORD)
  await page.getByRole('button', { name: 'Tạo tài khoản' }).click()
  await expect(page).toHaveURL(/\/onboarding$/)
  await page.getByLabel('Tên doanh nghiệp').fill(`${storeName} Group`)
  await page.getByLabel('Tên cửa hàng').fill(storeName)
  await page.getByLabel('Đường dẫn cửa hàng').fill(slug)
  await page.getByRole('button', { name: 'Tạo cửa hàng' }).click()
  await expect(page).toHaveURL(/\/app\/orders$/)
  await expect(page.getByTestId('active-store-name')).toHaveText(storeName)
  return { slug, email }
}
```

`tests/e2e/owner-quick-actions.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { signUpAndOnboard } from './support/owner'

test('owner enables ordering and opens the customer page, one tap each, without leaving /app/orders', async ({ page }, testInfo) => {
  const { slug } = await signUpAndOnboard(page, testInfo, 'Quán Một Chạm')

  await expect(page.getByText('Quán đang tạm nghỉ — khách không đặt được món')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Mở cài đặt' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Bật nhận đơn' }).click()
  await expect(page.getByText('Quán đang tạm nghỉ — khách không đặt được món')).toBeHidden()
  await expect(page.getByText('Đang nhận đơn', { exact: true }).first()).toBeVisible()
  await expect(page).toHaveURL(/\/app\/orders$/)

  const viewLink = page.getByRole('link', { name: 'Xem trang khách' })
  await expect(viewLink).toHaveAttribute('href', `/s/${slug}`)
  const [popup] = await Promise.all([page.waitForEvent('popup'), viewLink.click()])
  await expect(popup).toHaveURL(new RegExp(`/s/${slug}$`))
  await expect(popup.getByRole('heading', { level: 1 })).toHaveText('Quán Một Chạm')
  await expect(popup.getByText('Đang nhận đơn', { exact: true })).toBeVisible()
  await expect(popup.getByText('Menu đang được cập nhật')).toBeVisible()
})
```

- [ ] **Step 3: Chạy test để xác nhận thất bại**

Run: `npx vitest run --project nuxt tests/nuxt/app/store-status-alert.test.ts`
Expected: FAIL — `~/components/app/StoreStatusAlert.vue` chưa tồn tại.

- [ ] **Step 4: Viết component**

`app/components/app/StoreStatusAlert.vue`:

```vue
<script setup lang="ts">
const api = useApi()
const toast = useToast()
const { load } = useMe()
const { activeStore } = useActiveStore()

const enabling = ref(false)

async function enableOrders() {
  const store = activeStore.value
  if (!store || enabling.value) return
  enabling.value = true
  try {
    await api(`/api/stores/${store.id}`, { method: 'PATCH', body: { isAcceptingOrders: true } })
    await load(true)
    toast.add({ color: 'success', title: 'Quán đã bật nhận đơn' })
  }
  catch (err) {
    toast.add({ color: 'error', title: extractApiError(err).message })
  }
  finally {
    enabling.value = false
  }
}
</script>

<template>
  <ZAlert
    v-if="activeStore && !activeStore.isAcceptingOrders"
    color="warning"
    title="Quán đang tạm nghỉ — khách không đặt được món"
  >
    <template v-if="activeStore.role === 'OWNER'" #actions>
      <ZButton variant="secondary" size="sm" icon="i-lucide-power" :loading="enabling" @click="enableOrders">
        Bật nhận đơn
      </ZButton>
    </template>
  </ZAlert>
</template>
```

- [ ] **Step 5: Sửa `app/pages/app/orders.vue`**

Ba `edit` với `old_str` nguyên văn:

1. Banner — old_str:

```vue
    <ZAlert
      v-if="activeStore && !activeStore.isAcceptingOrders"
      color="warning"
      title="Quán đang tạm nghỉ — khách không đặt được món"
    >
      <template #actions>
        <ZButton variant="secondary" size="sm" to="/app/settings">
          Bật nhận đơn
        </ZButton>
      </template>
    </ZAlert>
```

new_str:

```vue
    <AppStoreStatusAlert />
```

2. Script — old_str `const publicUrl = computed(() => (activeStore.value ? `${config.public.appBaseUrl}/s/${activeStore.value.slug}` : ''))`, new_str là chính dòng đó cộng thêm dòng dưới:

```ts
const publicUrl = computed(() => (activeStore.value ? `${config.public.appBaseUrl}/s/${activeStore.value.slug}` : ''))
const viewPath = computed(() => (activeStore.value ? `/s/${activeStore.value.slug}` : ''))
```

3. Nút trong empty state — old_str:

```vue
          <ZButton variant="secondary" block icon="i-lucide-settings" to="/app/settings">
            Mở cài đặt
          </ZButton>
```

new_str:

```vue
          <ZButton v-if="viewPath" variant="secondary" block icon="i-lucide-external-link" :to="viewPath" target="_blank">
            Xem trang khách
          </ZButton>
```

Đường dẫn tương đối (không dùng `appBaseUrl`) để luôn mở đúng origin đang chạy; `AppCopyField` vẫn dùng link tuyệt đối để chia sẻ.

- [ ] **Step 6: Chạy test để xác nhận đạt**

Run:

```bash
npx vitest run --project nuxt tests/nuxt/app/store-status-alert.test.ts
npx playwright test tests/e2e/owner-quick-actions.spec.ts tests/e2e/onboarding.spec.ts
npm run lint -- app/pages/app/orders.vue app/components/app/StoreStatusAlert.vue
```

Expected: PASS (onboarding spec vẫn xanh vì không phụ thuộc nút đã đổi).

- [ ] **Step 7: Commit**

```bash
git add app/components/app/StoreStatusAlert.vue app/pages/app/orders.vue tests
git commit -m "feat(catalog): one-tap enable ordering and view customer page

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 6: Schema zod dùng chung + API danh mục (`categories`)

**Files:**
- Create: `shared/schemas/common.ts`, `shared/schemas/catalog.ts`, `server/utils/ids.ts`, `server/services/catalog/categories.ts`, `server/api/stores/[storeId]/categories/index.get.ts`, `server/api/stores/[storeId]/categories/index.post.ts`, `server/api/stores/[storeId]/categories/[categoryId].patch.ts`
- Modify: `tests/api/tenant-isolation.test.ts` (seed + hàng ma trận)
- Test: `tests/unit/shared/catalog-schemas.test.ts`, `tests/integration/catalog-categories.test.ts`

**Interfaces:**
- Consumes: `requireStoreStaff`, `requireStoreOwner`, `StoreContext` (PR1 guards); `listCategoryRows`, `inStore`, `CatalogScope` (Task 3); `CategoryDTO` (Task 3); `createCategory` fixture (Task 1).
- Produces:
  - `shared/schemas/common.ts`: `MAX_PRICE_VND`, `vndSchema`, `nameField(max)`, `positionSchema`, `hasChange(value)`, `NO_CHANGE`.
  - `shared/schemas/catalog.ts`: `createCategoryInputSchema`, `updateCategoryInputSchema`, `createProductInputSchema`, `updateProductInputSchema`, `replaceOptionsInputSchema` và các kiểu `CreateCategoryInput`, `UpdateCategoryInput`, `CreateProductInput`, `UpdateProductInput`, `ReplaceOptionsInput` (output sau normalize: nhóm `required` luôn có `minSelect ≥ 1`).
  - `requireUuidParam(event: H3Event, name: string): string` (`server/utils/ids.ts`, id sai định dạng → `NOT_FOUND`).
  - `listCategories(db: DbOrTx, scope: CatalogScope): Promise<CategoryDTO[]>`, `createCategory(db: DbOrTx, ctx: StoreContext, input: CreateCategoryInput): Promise<CategoryDTO>`, `updateCategory(db: DbOrTx, ctx: StoreContext, categoryId: string, patch: UpdateCategoryInput): Promise<CategoryDTO>`.
  - Route: `GET /api/stores/:id/categories → { categories: CategoryDTO[] }` (staff), `POST` → 201 `CategoryDTO` (owner), `PATCH …/categories/:categoryId` → `CategoryDTO` (owner).
  - Hạ tầng ma trận tenant: `ids.categoryA1/A2/B`, `productA1/A2/B`, `tableA1`, `zoneA1` trong `tenant-isolation.test.ts` (Task 7–11 dùng).

- [ ] **Step 1: Viết unit test thất bại cho schema**

`tests/unit/shared/catalog-schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { MAX_PRICE_VND, vndSchema } from '#shared/schemas/common'
import {
  createCategoryInputSchema,
  createProductInputSchema,
  replaceOptionsInputSchema,
  updateCategoryInputSchema,
  updateProductInputSchema,
} from '#shared/schemas/catalog'

describe('vndSchema', () => {
  it.each([0, 35000, MAX_PRICE_VND])('accepts %s', (value) => {
    expect(vndSchema.safeParse(value).success).toBe(true)
  })

  it.each([-1, 1.5, MAX_PRICE_VND + 1, Number.NaN, Number.POSITIVE_INFINITY, '35000', null])('rejects %s', (value) => {
    expect(vndSchema.safeParse(value).success).toBe(false)
  })
})

describe('category schemas', () => {
  it('trims names and rejects blank or over-long ones', () => {
    expect(createCategoryInputSchema.parse({ name: '  Trà sữa  ' })).toEqual({ name: 'Trà sữa' })
    expect(createCategoryInputSchema.safeParse({ name: '   ' }).success).toBe(false)
    expect(createCategoryInputSchema.safeParse({ name: 'a'.repeat(61) }).success).toBe(false)
  })

  it('requires at least one change on update', () => {
    expect(updateCategoryInputSchema.safeParse({}).success).toBe(false)
    expect(updateCategoryInputSchema.safeParse({ active: false }).success).toBe(true)
    expect(updateCategoryInputSchema.safeParse({ position: -1 }).success).toBe(false)
  })
})

describe('product schemas', () => {
  it('quick add needs only a name and a price', () => {
    expect(createProductInputSchema.parse({ name: ' Trà đào ', basePriceVnd: 30000 })).toEqual({ name: 'Trà đào', basePriceVnd: 30000 })
  })

  it('accepts a null or uuid category and rejects garbage', () => {
    const id = '5f0c1a52-6a6a-4f0e-9d2e-0d1f6f0f6f0f'
    expect(createProductInputSchema.safeParse({ name: 'A', basePriceVnd: 1, categoryId: null }).success).toBe(true)
    expect(createProductInputSchema.safeParse({ name: 'A', basePriceVnd: 1, categoryId: id }).success).toBe(true)
    expect(createProductInputSchema.safeParse({ name: 'A', basePriceVnd: 1, categoryId: 'abc' }).success).toBe(false)
  })

  it('rejects a negative, fractional or oversized price', () => {
    for (const basePriceVnd of [-1, 10.5, MAX_PRICE_VND + 1]) {
      expect(createProductInputSchema.safeParse({ name: 'A', basePriceVnd }).success).toBe(false)
    }
  })

  it('update treats categoryId null as a change and an empty patch as an error', () => {
    expect(updateProductInputSchema.safeParse({ categoryId: null }).success).toBe(true)
    expect(updateProductInputSchema.safeParse({ isAvailable: false }).success).toBe(true)
    expect(updateProductInputSchema.safeParse({}).success).toBe(false)
  })
})

describe('replaceOptionsInputSchema', () => {
  const value = (name: string, extra: Record<string, unknown> = {}) => ({ name, ...extra })

  it('applies value defaults and normalises a required group to minSelect ≥ 1', () => {
    const parsed = replaceOptionsInputSchema.parse({
      groups: [{ name: 'Size', required: true, minSelect: 0, maxSelect: 1, values: [value('M'), value('L', { priceDeltaVnd: 5000 })] }],
    })
    expect(parsed.groups[0]).toMatchObject({ minSelect: 1, maxSelect: 1 })
    expect(parsed.groups[0]!.values).toEqual([
      { name: 'M', priceDeltaVnd: 0, active: true },
      { name: 'L', priceDeltaVnd: 5000, active: true },
    ])
  })

  it('accepts an empty list (removes every option)', () => {
    expect(replaceOptionsInputSchema.parse({ groups: [] })).toEqual({ groups: [] })
  })

  it('rejects maxSelect < minSelect', () => {
    const result = replaceOptionsInputSchema.safeParse({
      groups: [{ name: 'Topping', required: false, minSelect: 3, maxSelect: 2, values: [value('a'), value('b'), value('c')] }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a minimum that exceeds the number of active values', () => {
    const result = replaceOptionsInputSchema.safeParse({
      groups: [{ name: 'Size', required: true, minSelect: 2, maxSelect: 2, values: [value('M'), value('L', { active: false })] }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a group without values, a negative delta and too many groups', () => {
    const group = (values: unknown[]) => ({ name: 'G', required: false, minSelect: 0, maxSelect: 1, values })
    expect(replaceOptionsInputSchema.safeParse({ groups: [group([])] }).success).toBe(false)
    expect(replaceOptionsInputSchema.safeParse({ groups: [group([value('a', { priceDeltaVnd: -1 })])] }).success).toBe(false)
    expect(replaceOptionsInputSchema.safeParse({ groups: Array.from({ length: 11 }, () => group([value('a')])) }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Viết integration test thất bại cho service danh mục**

`tests/integration/catalog-categories.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { StoreContext } from '../../server/auth/guards'
import { closeDb, getDb } from '../../server/db/client'
import { createCategory, listCategories, updateCategory } from '../../server/services/catalog/categories'
import { resetDb } from '../support/db'
import { createCategory as seedCategory, createTenant } from '../support/fixtures'

const ctxOf = (t: { owner: { userId: string }, org: { id: string }, store: { id: string } }): StoreContext => ({
  userId: t.owner.userId,
  orgId: t.org.id,
  storeId: t.store.id,
  role: 'OWNER',
})

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('categories service', () => {
  it('appends categories with increasing positions', async () => {
    const t = await createTenant('cat')
    const first = await createCategory(getDb(), ctxOf(t), { name: 'Trà sữa' })
    const second = await createCategory(getDb(), ctxOf(t), { name: 'Cà phê' })
    expect([first.position, second.position]).toEqual([0, 1])
    expect((await listCategories(getDb(), ctxOf(t))).map(c => c.name)).toEqual(['Trà sữa', 'Cà phê'])
  })

  it('lists inactive categories too (owner view) and scopes by store', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    await seedCategory(a.store, 'Ẩn', { active: false })
    await seedCategory(b.store, 'Của B')
    const list = await listCategories(getDb(), ctxOf(a))
    expect(list.map(c => [c.name, c.active])).toEqual([['Ẩn', false]])
  })

  it('updates name, active and position', async () => {
    const t = await createTenant('upd')
    const created = await createCategory(getDb(), ctxOf(t), { name: 'Cũ' })
    const updated = await updateCategory(getDb(), ctxOf(t), created.id, { name: 'Mới', active: false, position: 5 })
    expect(updated).toEqual({ id: created.id, name: 'Mới', active: false, position: 5 })
  })

  it('cannot update a category of another store or org (NOT_FOUND) and leaves it untouched', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const foreign = await seedCategory(b.store, 'Của B')
    await expect(updateCategory(getDb(), ctxOf(a), foreign.id, { name: 'Bị đổi' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect((await listCategories(getDb(), ctxOf(b)))[0]!.name).toBe('Của B')
  })
})
```

- [ ] **Step 3: Chạy test để xác nhận thất bại**

Run: `npx vitest run --project unit tests/unit/shared/catalog-schemas.test.ts && npm run test:integration -- tests/integration/catalog-categories.test.ts`
Expected: FAIL — thiếu `#shared/schemas/common`, `server/services/catalog/categories`.

- [ ] **Step 4: Viết schema dùng chung**

`shared/schemas/common.ts`:

```ts
import { z } from 'zod'

export const MAX_PRICE_VND = 100_000_000
export const NO_CHANGE = 'Không có thay đổi nào'

export const vndSchema = z
  .number('Giá phải là số')
  .int('Giá phải là số nguyên')
  .min(0, 'Giá không được âm')
  .max(MAX_PRICE_VND, 'Giá quá lớn')

export const nameField = (max: number) => z.string().trim().min(1, 'Không được để trống').max(max, `Tối đa ${max} ký tự`)

export const positionSchema = z.number().int().min(0).max(100_000)

export function hasChange(value: Record<string, unknown>): boolean {
  return Object.values(value).some(item => item !== undefined)
}
```

`shared/schemas/catalog.ts`:

```ts
import { z } from 'zod'
import { hasChange, nameField, NO_CHANGE, positionSchema, vndSchema } from './common'

export const createCategoryInputSchema = z.object({ name: nameField(60) })
export type CreateCategoryInput = z.output<typeof createCategoryInputSchema>

export const updateCategoryInputSchema = z
  .object({ name: nameField(60).optional(), position: positionSchema.optional(), active: z.boolean().optional() })
  .refine(hasChange, NO_CHANGE)
export type UpdateCategoryInput = z.output<typeof updateCategoryInputSchema>

const descriptionSchema = z.string().trim().max(300, 'Tối đa 300 ký tự')

export const createProductInputSchema = z.object({
  name: nameField(80),
  basePriceVnd: vndSchema,
  categoryId: z.uuid().nullable().optional(),
  description: descriptionSchema.optional(),
})
export type CreateProductInput = z.output<typeof createProductInputSchema>

export const updateProductInputSchema = z
  .object({
    name: nameField(80).optional(),
    basePriceVnd: vndSchema.optional(),
    categoryId: z.uuid().nullable().optional(),
    description: descriptionSchema.nullable().optional(),
    isAvailable: z.boolean().optional(),
    active: z.boolean().optional(),
    position: positionSchema.optional(),
  })
  .refine(hasChange, NO_CHANGE)
export type UpdateProductInput = z.output<typeof updateProductInputSchema>

const optionValueSchema = z.object({
  name: nameField(60),
  priceDeltaVnd: vndSchema.default(0),
  active: z.boolean().default(true),
})

const optionGroupSchema = z
  .object({
    name: nameField(60),
    required: z.boolean(),
    minSelect: z.number().int().min(0).max(30),
    maxSelect: z.number().int().min(1).max(30),
    values: z.array(optionValueSchema).min(1, 'Nhóm cần ít nhất 1 lựa chọn').max(30),
  })
  .superRefine((group, ctx) => {
    const minSelect = group.required ? Math.max(group.minSelect, 1) : group.minSelect
    const activeCount = group.values.filter(value => value.active).length
    if (group.maxSelect < minSelect) {
      ctx.addIssue({ code: 'custom', path: ['maxSelect'], message: 'Số lựa chọn tối đa phải lớn hơn hoặc bằng số tối thiểu' })
    }
    if (minSelect > activeCount) {
      ctx.addIssue({ code: 'custom', path: ['minSelect'], message: 'Số lựa chọn tối thiểu vượt quá số lựa chọn đang bật' })
    }
  })
  .transform(group => ({ ...group, minSelect: group.required ? Math.max(group.minSelect, 1) : group.minSelect }))

export const replaceOptionsInputSchema = z.object({ groups: z.array(optionGroupSchema).max(10, 'Tối đa 10 nhóm') })
export type ReplaceOptionsInput = z.output<typeof replaceOptionsInputSchema>
```

- [ ] **Step 5: Viết `ids.ts` và service danh mục**

`server/utils/ids.ts`:

```ts
import { getRouterParam, type H3Event } from 'h3'
import { z } from 'zod'
import { AppError } from './errors'

const uuid = z.uuid()

/** A malformed id is indistinguishable from a missing resource: 404, never 400/500. */
export function requireUuidParam(event: H3Event, name: string): string {
  const value = getRouterParam(event, name)
  if (!value || !uuid.safeParse(value).success) throw new AppError('NOT_FOUND', 'Không tìm thấy')
  return value
}
```

`server/services/catalog/categories.ts`:

```ts
import { and, eq, max } from 'drizzle-orm'
import type { CreateCategoryInput, UpdateCategoryInput } from '#shared/schemas/catalog'
import type { CategoryDTO } from '#shared/types/catalog'
import type { StoreContext } from '../../auth/guards'
import type { DbOrTx } from '../../db/client'
import { categories } from '../../db/schema'
import { inStore, listCategoryRows, type CatalogScope } from '../../repositories/catalog'
import { AppError } from '../../utils/errors'

function toDTO(row: typeof categories.$inferSelect): CategoryDTO {
  return { id: row.id, name: row.name, position: row.position, active: row.active }
}

export async function listCategories(db: DbOrTx, scope: CatalogScope): Promise<CategoryDTO[]> {
  return (await listCategoryRows(db, scope)).map(toDTO)
}

export async function createCategory(db: DbOrTx, ctx: StoreContext, input: CreateCategoryInput): Promise<CategoryDTO> {
  const [last] = await db.select({ top: max(categories.position) }).from(categories).where(inStore(categories, ctx))
  const [row] = await db
    .insert(categories)
    .values({ orgId: ctx.orgId, storeId: ctx.storeId, name: input.name, position: (last?.top ?? -1) + 1 })
    .returning()
  return toDTO(row!)
}

export async function updateCategory(db: DbOrTx, ctx: StoreContext, categoryId: string, patch: UpdateCategoryInput): Promise<CategoryDTO> {
  const [row] = await db
    .update(categories)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(categories.id, categoryId), inStore(categories, ctx)))
    .returning()
  if (!row) throw new AppError('NOT_FOUND', 'Không tìm thấy')
  return toDTO(row)
}
```

- [ ] **Step 6: Viết route**

`server/api/stores/[storeId]/categories/index.get.ts`:

```ts
import { getRouterParam } from 'h3'
import { requireStoreStaff } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { listCategories } from '../../../../services/catalog/categories'
import { defineApiHandler } from '../../../../utils/api-handler'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreStaff(event, getRouterParam(event, 'storeId'))
  return { categories: await listCategories(getDb(), ctx) }
})
```

`server/api/stores/[storeId]/categories/index.post.ts`:

```ts
import { getRouterParam, setResponseStatus } from 'h3'
import { createCategoryInputSchema } from '#shared/schemas/catalog'
import { requireStoreOwner } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { createCategory } from '../../../../services/catalog/categories'
import { defineApiHandler } from '../../../../utils/api-handler'
import { parseBody } from '../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const input = await parseBody(event, createCategoryInputSchema)
  const category = await createCategory(getDb(), ctx, input)
  setResponseStatus(event, 201)
  return category
})
```

`server/api/stores/[storeId]/categories/[categoryId].patch.ts`:

```ts
import { getRouterParam } from 'h3'
import { updateCategoryInputSchema } from '#shared/schemas/catalog'
import { requireStoreOwner } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { updateCategory } from '../../../../services/catalog/categories'
import { defineApiHandler } from '../../../../utils/api-handler'
import { requireUuidParam } from '../../../../utils/ids'
import { parseBody } from '../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const categoryId = requireUuidParam(event, 'categoryId')
  const patch = await parseBody(event, updateCategoryInputSchema)
  return updateCategory(getDb(), ctx, categoryId, patch)
})
```

- [ ] **Step 7: Mở rộng ma trận tenant (seed + hàng danh mục)**

Trong `tests/api/tenant-isolation.test.ts`:

1. Thay dòng import fixtures:

```ts
import { addStaff, createCategory, createProduct, createStore, createTable, createTenant, createUser, createZone } from '../support/fixtures'
```

2. Thay dòng khai báo `ids`:

```ts
const ids = {} as {
  orgA: string
  storeA1: string
  storeA2: string
  storeB: string
  storeA1Slug: string
  categoryA1: string
  categoryA2: string
  categoryB: string
  productA1: string
  productA2: string
  productB: string
  tableA1: string
  zoneA1: string
}
```

3. Thay dòng `Object.assign(ids, { orgA: … })` trong `beforeAll` bằng:

```ts
  const categoryA1 = await createCategory(a.store, 'Trà A1')
  const categoryA2 = await createCategory(storeA2, 'Trà A2')
  const categoryB = await createCategory(b.store, 'Trà B')
  const productA1 = await createProduct(a.store, { name: 'Món A1', categoryId: categoryA1.id })
  const productA2 = await createProduct(storeA2, { name: 'Món A2' })
  const productB = await createProduct(b.store, { name: 'Món B' })
  const tableA1 = await createTable(a.store, '01')
  const zoneA1 = await createZone(a.store, { name: 'Zone A1' })

  Object.assign(ids, {
    orgA: a.org.id,
    storeA1: a.store.id,
    storeA2: storeA2.id,
    storeB: b.store.id,
    storeA1Slug: a.store.slug,
    categoryA1: categoryA1.id,
    categoryA2: categoryA2.id,
    categoryB: categoryB.id,
    productA1: productA1.id,
    productA2: productA2.id,
    productB: productB.id,
    tableA1: tableA1.table.id,
    zoneA1: zoneA1.id,
  })
```

4. Thêm vào **cuối file** (dùng lại `call`, `tokens`, `ids`, `Actor`, `errorCodes` đã có):

```ts
describe('categories', () => {
  it.each<[Actor, number]>([
    ['ownerA', 200],
    ['staffA1', 200],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
  ])('GET /categories %s → %i', async (actor, status) => {
    const res = await call('GET', `/api/stores/${ids.storeA1}/categories`, tokens[actor])
    expect(res.status).toBe(status)
    if (status === 200) {
      const listed = (res.body.categories as { id: string }[]).map(c => c.id)
      expect(listed).toContain(ids.categoryA1)
      expect(listed).not.toContain(ids.categoryA2)
      expect(listed).not.toContain(ids.categoryB)
    }
    else {
      expect(res.body).toMatchObject({ code: errorCodes[status] })
    }
  })

  it.each<[Actor, number]>([
    ['ownerA', 201],
    ['staffA1', 403],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
  ])('POST /categories %s → %i', async (actor, status) => {
    const res = await call('POST', `/api/stores/${ids.storeA1}/categories`, tokens[actor], { name: `Mới ${actor}` })
    expect(res.status).toBe(status)
    if (status !== 201) expect(res.body).toMatchObject({ code: errorCodes[status] })
  })

  it.each<[Actor, number]>([
    ['ownerA', 200],
    ['staffA1', 403],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
  ])('PATCH /categories/:id %s → %i', async (actor, status) => {
    const res = await call('PATCH', `/api/stores/${ids.storeA1}/categories/${ids.categoryA1}`, tokens[actor], { active: true })
    expect(res.status).toBe(status)
    if (status !== 200) expect(res.body).toMatchObject({ code: errorCodes[status] })
  })

  it('a category of another store is 404 even for the owner of both orgs\' stores', async () => {
    expect(await call('PATCH', `/api/stores/${ids.storeA1}/categories/${ids.categoryA2}`, tokens.ownerA, { name: 'Hijack' }))
      .toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
    expect(await call('PATCH', `/api/stores/${ids.storeB}/categories/${ids.categoryA1}`, tokens.ownerB, { name: 'Hijack' }))
      .toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
    const own = await call('GET', `/api/stores/${ids.storeA2}/categories`, tokens.ownerA)
    expect((own.body.categories as { id: string, name: string }[]).find(c => c.id === ids.categoryA2)!.name).toBe('Trà A2')
  })

  it('treats a non-uuid category id as 404 and validates the body', async () => {
    expect(await call('PATCH', `/api/stores/${ids.storeA1}/categories/xyz`, tokens.ownerA, { active: true })).toMatchObject({ status: 404 })
    expect(await call('POST', `/api/stores/${ids.storeA1}/categories`, tokens.ownerA, { name: '   ' })).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
    expect(await call('PATCH', `/api/stores/${ids.storeA1}/categories/${ids.categoryA1}`, tokens.ownerA, {})).toMatchObject({ status: 400 })
  })
})
```

- [ ] **Step 8: Chạy test để xác nhận đạt**

Run:

```bash
npx vitest run --project unit tests/unit/shared/catalog-schemas.test.ts
npm run test:integration -- tests/integration/catalog-categories.test.ts
npm run test:api -- tests/api/tenant-isolation.test.ts
```

Expected: PASS (toàn bộ ma trận cũ của PR1 vẫn xanh).

- [ ] **Step 9: Commit**

```bash
git add shared/schemas server/utils/ids.ts server/services/catalog/categories.ts server/api/stores tests
git commit -m "feat(catalog): add catalog schemas and categories API

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 7: API món (`products`) — thêm nhanh, sửa, bật/tắt còn hàng

**Files:**
- Create: `server/services/catalog/products.ts`, `server/api/stores/[storeId]/products/index.get.ts`, `server/api/stores/[storeId]/products/index.post.ts`, `server/api/stores/[storeId]/products/[productId]/index.patch.ts`
- Modify: `tests/api/tenant-isolation.test.ts` (hàng món)
- Test: `tests/integration/catalog-products.test.ts`

**Interfaces:**
- Consumes: `loadProductDTOs`, `inStore` (Task 3), `createProductInputSchema`/`updateProductInputSchema` (Task 6), `requireUuidParam`, `categories` table.
- Produces:
  - `listProducts(db: DbOrTx, scope: CatalogScope): Promise<ProductDTO[]>` (gồm món `active=false`/hết hàng, kèm option).
  - `createProduct(db: DbOrTx, ctx: StoreContext, input: CreateProductInput): Promise<ProductDTO>` — `categoryId` không thuộc store → `NOT_FOUND`; thiếu `categoryId` → `null`.
  - `updateProduct(db: DbOrTx, ctx: StoreContext, productId: string, patch: UpdateProductInput): Promise<ProductDTO>` — `description: ''` → `null`.
  - Route: `GET /api/stores/:id/products → { products: ProductDTO[] }` (staff), `POST` → 201 `ProductDTO` (owner), `PATCH …/products/:productId` → `ProductDTO` (owner).

- [ ] **Step 1: Viết integration test thất bại**

`tests/integration/catalog-products.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { StoreContext } from '../../server/auth/guards'
import { closeDb, getDb } from '../../server/db/client'
import { createProduct, listProducts, updateProduct } from '../../server/services/catalog/products'
import { resetDb } from '../support/db'
import { createCategory, createOptionGroup, createProduct as seedProduct, createStore, createTenant } from '../support/fixtures'

const ctxOf = (t: { owner: { userId: string }, org: { id: string } }, store: { id: string }): StoreContext => ({
  userId: t.owner.userId,
  orgId: t.org.id,
  storeId: store.id,
  role: 'OWNER',
})

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('createProduct (quick add)', () => {
  it('needs only a name and a price', async () => {
    const t = await createTenant('qa')
    const first = await createProduct(getDb(), ctxOf(t, t.store), { name: 'Trà sữa trân châu', basePriceVnd: 35000 })
    const second = await createProduct(getDb(), ctxOf(t, t.store), { name: 'Cà phê muối', basePriceVnd: 29000 })
    expect(first).toEqual({
      id: first.id,
      categoryId: null,
      name: 'Trà sữa trân châu',
      description: null,
      basePriceVnd: 35000,
      isAvailable: true,
      active: true,
      position: 0,
      imageUrl: null,
      optionGroups: [],
    })
    expect(second.position).toBe(1)
  })

  it('attaches a category of the same store', async () => {
    const t = await createTenant('cat')
    const cat = await createCategory(t.store, 'Trà')
    const product = await createProduct(getDb(), ctxOf(t, t.store), { name: 'Trà đào', basePriceVnd: 30000, categoryId: cat.id })
    expect(product.categoryId).toBe(cat.id)
  })

  it('rejects a category from another org or from another store of the same org (NOT_FOUND)', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const a2 = await createStore(a.org.id, 'a2')
    const foreignOrg = await createCategory(b.store, 'B')
    const sameOrgOtherStore = await createCategory(a2, 'A2')
    for (const categoryId of [foreignOrg.id, sameOrgOtherStore.id]) {
      await expect(createProduct(getDb(), ctxOf(a, a.store), { name: 'X', basePriceVnd: 1000, categoryId })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    }
    expect(await listProducts(getDb(), ctxOf(a, a.store))).toEqual([])
  })
})

describe('updateProduct', () => {
  it('toggles availability and activity', async () => {
    const t = await createTenant('tog')
    const product = await seedProduct(t.store, { name: 'Trà' })
    const soldOut = await updateProduct(getDb(), ctxOf(t, t.store), product.id, { isAvailable: false })
    expect(soldOut.isAvailable).toBe(false)
    const hidden = await updateProduct(getDb(), ctxOf(t, t.store), product.id, { active: false })
    expect(hidden).toMatchObject({ isAvailable: false, active: false })
  })

  it('moves a product to another category and back to none', async () => {
    const t = await createTenant('mv')
    const cat = await createCategory(t.store, 'Trà')
    const product = await seedProduct(t.store, { name: 'Trà' })
    expect((await updateProduct(getDb(), ctxOf(t, t.store), product.id, { categoryId: cat.id })).categoryId).toBe(cat.id)
    expect((await updateProduct(getDb(), ctxOf(t, t.store), product.id, { categoryId: null })).categoryId).toBeNull()
  })

  it('edits name, price and turns an empty description into null', async () => {
    const t = await createTenant('ed')
    const product = await seedProduct(t.store, { name: 'Cũ', basePriceVnd: 10000 })
    const withDescription = await updateProduct(getDb(), ctxOf(t, t.store), product.id, { name: 'Mới', basePriceVnd: 45000, description: 'Ít đường' })
    expect(withDescription).toMatchObject({ name: 'Mới', basePriceVnd: 45000, description: 'Ít đường' })
    expect((await updateProduct(getDb(), ctxOf(t, t.store), product.id, { description: '' })).description).toBeNull()
  })

  it('cannot touch a product of another store (NOT_FOUND) or move it into a foreign category', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const mine = await seedProduct(a.store, { name: 'Của A' })
    const theirs = await seedProduct(b.store, { name: 'Của B' })
    const foreignCategory = await createCategory(b.store, 'B')
    await expect(updateProduct(getDb(), ctxOf(a, a.store), theirs.id, { name: 'Hijack' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(updateProduct(getDb(), ctxOf(a, a.store), mine.id, { categoryId: foreignCategory.id })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect((await listProducts(getDb(), ctxOf(b, b.store)))[0]!.name).toBe('Của B')
    expect((await listProducts(getDb(), ctxOf(a, a.store)))[0]!.categoryId).toBeNull()
  })
})

describe('listProducts', () => {
  it('returns hidden and sold-out products with their option groups, scoped to the store', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const shown = await seedProduct(a.store, { name: 'Hiện', position: 1 })
    await seedProduct(a.store, { name: 'Ẩn', active: false, position: 2 })
    await seedProduct(a.store, { name: 'Hết', isAvailable: false, position: 3 })
    await seedProduct(b.store, { name: 'Của B' })
    await createOptionGroup(a.store, shown, { name: 'Size', required: true })

    const list = await listProducts(getDb(), ctxOf(a, a.store))
    expect(list.map(p => [p.name, p.active, p.isAvailable])).toEqual([['Hiện', true, true], ['Ẩn', false, true], ['Hết', true, false]])
    expect(list[0]!.optionGroups).toHaveLength(1)
    expect(list[0]!.optionGroups[0]!.values.map(v => v.name)).toEqual(['M', 'L'])
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `npm run test:integration -- tests/integration/catalog-products.test.ts`
Expected: FAIL — không resolve được `server/services/catalog/products`.

- [ ] **Step 3: Viết service**

`server/services/catalog/products.ts`:

```ts
import { and, eq, max } from 'drizzle-orm'
import type { CreateProductInput, UpdateProductInput } from '#shared/schemas/catalog'
import type { ProductDTO } from '#shared/types/catalog'
import type { StoreContext } from '../../auth/guards'
import type { DbOrTx } from '../../db/client'
import { categories, products } from '../../db/schema'
import { inStore, type CatalogScope } from '../../repositories/catalog'
import { AppError } from '../../utils/errors'
import { loadProductDTOs } from './product-view'

const notFound = () => new AppError('NOT_FOUND', 'Không tìm thấy')

async function assertCategoryInStore(db: DbOrTx, scope: CatalogScope, categoryId: string): Promise<void> {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), inStore(categories, scope)))
    .limit(1)
  if (!row) throw notFound()
}

export async function listProducts(db: DbOrTx, scope: CatalogScope): Promise<ProductDTO[]> {
  return loadProductDTOs(db, scope)
}

export async function createProduct(db: DbOrTx, ctx: StoreContext, input: CreateProductInput): Promise<ProductDTO> {
  if (input.categoryId) await assertCategoryInStore(db, ctx, input.categoryId)
  const [last] = await db.select({ top: max(products.position) }).from(products).where(inStore(products, ctx))
  const [row] = await db
    .insert(products)
    .values({
      orgId: ctx.orgId,
      storeId: ctx.storeId,
      categoryId: input.categoryId ?? null,
      name: input.name,
      description: input.description ? input.description : null,
      basePriceVnd: input.basePriceVnd,
      position: (last?.top ?? -1) + 1,
    })
    .returning({ id: products.id })
  const [dto] = await loadProductDTOs(db, ctx, { productId: row!.id })
  return dto!
}

export async function updateProduct(db: DbOrTx, ctx: StoreContext, productId: string, patch: UpdateProductInput): Promise<ProductDTO> {
  if (patch.categoryId) await assertCategoryInStore(db, ctx, patch.categoryId)

  const set: Partial<typeof products.$inferInsert> = { updatedAt: new Date() }
  if (patch.name !== undefined) set.name = patch.name
  if (patch.basePriceVnd !== undefined) set.basePriceVnd = patch.basePriceVnd
  if (patch.categoryId !== undefined) set.categoryId = patch.categoryId
  if (patch.description !== undefined) set.description = patch.description ? patch.description : null
  if (patch.isAvailable !== undefined) set.isAvailable = patch.isAvailable
  if (patch.active !== undefined) set.active = patch.active
  if (patch.position !== undefined) set.position = patch.position

  const [row] = await db
    .update(products)
    .set(set)
    .where(and(eq(products.id, productId), inStore(products, ctx)))
    .returning({ id: products.id })
  if (!row) throw notFound()
  const [dto] = await loadProductDTOs(db, ctx, { productId })
  return dto!
}
```

- [ ] **Step 4: Viết route**

`server/api/stores/[storeId]/products/index.get.ts`:

```ts
import { getRouterParam } from 'h3'
import { requireStoreStaff } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { listProducts } from '../../../../services/catalog/products'
import { defineApiHandler } from '../../../../utils/api-handler'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreStaff(event, getRouterParam(event, 'storeId'))
  return { products: await listProducts(getDb(), ctx) }
})
```

`server/api/stores/[storeId]/products/index.post.ts`:

```ts
import { getRouterParam, setResponseStatus } from 'h3'
import { createProductInputSchema } from '#shared/schemas/catalog'
import { requireStoreOwner } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { createProduct } from '../../../../services/catalog/products'
import { defineApiHandler } from '../../../../utils/api-handler'
import { parseBody } from '../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const input = await parseBody(event, createProductInputSchema)
  const product = await createProduct(getDb(), ctx, input)
  setResponseStatus(event, 201)
  return product
})
```

`server/api/stores/[storeId]/products/[productId]/index.patch.ts`:

```ts
import { getRouterParam } from 'h3'
import { updateProductInputSchema } from '#shared/schemas/catalog'
import { requireStoreOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { updateProduct } from '../../../../../services/catalog/products'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { requireUuidParam } from '../../../../../utils/ids'
import { parseBody } from '../../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const productId = requireUuidParam(event, 'productId')
  const patch = await parseBody(event, updateProductInputSchema)
  return updateProduct(getDb(), ctx, productId, patch)
})
```

- [ ] **Step 5: Thêm hàng món vào ma trận tenant**

Thêm vào **cuối** `tests/api/tenant-isolation.test.ts`:

```ts
describe('products', () => {
  it.each<[Actor, number]>([
    ['ownerA', 200],
    ['staffA1', 200],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
  ])('GET /products %s → %i', async (actor, status) => {
    const res = await call('GET', `/api/stores/${ids.storeA1}/products`, tokens[actor])
    expect(res.status).toBe(status)
    if (status === 200) {
      const listed = (res.body.products as { id: string }[]).map(p => p.id)
      expect(listed).toContain(ids.productA1)
      expect(listed).not.toContain(ids.productA2)
      expect(listed).not.toContain(ids.productB)
    }
    else {
      expect(res.body).toMatchObject({ code: errorCodes[status] })
    }
  })

  it.each<[Actor, number]>([
    ['ownerA', 201],
    ['staffA1', 403],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
  ])('POST /products %s → %i', async (actor, status) => {
    const res = await call('POST', `/api/stores/${ids.storeA1}/products`, tokens[actor], { name: `Món ${actor}`, basePriceVnd: 20000 })
    expect(res.status).toBe(status)
    if (status !== 201) expect(res.body).toMatchObject({ code: errorCodes[status] })
  })

  it.each<[Actor, number]>([
    ['ownerA', 200],
    ['staffA1', 403],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
  ])('PATCH /products/:id %s → %i', async (actor, status) => {
    const res = await call('PATCH', `/api/stores/${ids.storeA1}/products/${ids.productA1}`, tokens[actor], { isAvailable: true })
    expect(res.status).toBe(status)
    if (status !== 200) expect(res.body).toMatchObject({ code: errorCodes[status] })
  })

  it('a category from another store is 404 on create and update (same org or other org)', async () => {
    for (const categoryId of [ids.categoryA2, ids.categoryB]) {
      expect(await call('POST', `/api/stores/${ids.storeA1}/products`, tokens.ownerA, { name: 'X', basePriceVnd: 1000, categoryId }))
        .toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
      expect(await call('PATCH', `/api/stores/${ids.storeA1}/products/${ids.productA1}`, tokens.ownerA, { categoryId }))
        .toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
    }
  })

  it('a product of another store is 404 and stays unchanged', async () => {
    expect(await call('PATCH', `/api/stores/${ids.storeA1}/products/${ids.productA2}`, tokens.ownerA, { name: 'Hijack' })).toMatchObject({ status: 404 })
    expect(await call('PATCH', `/api/stores/${ids.storeB}/products/${ids.productA1}`, tokens.ownerB, { name: 'Hijack' })).toMatchObject({ status: 404 })
    const list = await call('GET', `/api/stores/${ids.storeA2}/products`, tokens.ownerA)
    expect((list.body.products as { id: string, name: string }[]).find(p => p.id === ids.productA2)!.name).toBe('Món A2')
  })

  it('validates the body (negative price, blank name, unknown fields are ignored)', async () => {
    expect(await call('POST', `/api/stores/${ids.storeA1}/products`, tokens.ownerA, { name: 'A', basePriceVnd: -5 })).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
    expect(await call('POST', `/api/stores/${ids.storeA1}/products`, tokens.ownerA, { name: ' ', basePriceVnd: 5 })).toMatchObject({ status: 400 })
    const created = await call('POST', `/api/stores/${ids.storeA1}/products`, tokens.ownerA, { name: 'Có thừa', basePriceVnd: 5, orgId: ids.storeB, storeId: ids.storeB })
    expect(created.status).toBe(201)
    expect(created.body).not.toHaveProperty('orgId')
  })
})
```

- [ ] **Step 6: Chạy test để xác nhận đạt**

Run: `npm run test:integration -- tests/integration/catalog-products.test.ts && npm run test:api -- tests/api/tenant-isolation.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/services/catalog/products.ts server/api/stores tests
git commit -m "feat(catalog): add products API with quick add and availability toggle

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 8: `PUT /api/stores/:id/products/:productId/options` — thay toàn bộ nhóm option trong 1 transaction

**Files:**
- Create: `server/services/catalog/options.ts`, `server/api/stores/[storeId]/products/[productId]/options.put.ts`
- Modify: `tests/api/tenant-isolation.test.ts`
- Test: `tests/integration/catalog-options.test.ts`

**Interfaces:**
- Consumes: `replaceOptionsInputSchema`, `ReplaceOptionsInput` (Task 6); `loadProductDTOs` (Task 3); `productOptionGroups`, `productOptionValues`, `products`; `Db` từ `server/db/client` (cần `.transaction`).
- Produces:
  - `replaceProductOptions(db: Db, ctx: StoreContext, productId: string, input: ReplaceOptionsInput): Promise<OptionGroupDTO[]>` — khoá hàng món `FOR UPDATE`, xoá nhóm cũ (cascade giá trị), chèn nhóm mới theo thứ tự mảng; món không thuộc store → `NOT_FOUND`.
  - Route `PUT /api/stores/:id/products/:productId/options` body `{ groups }` → `{ optionGroups: OptionGroupDTO[] }` (owner).
  - Hệ quả cho PR3: id nhóm/giá trị đổi sau mỗi lần `PUT` → giỏ cũ nhận `CART_STALE`.

- [ ] **Step 1: Viết integration test thất bại**

`tests/integration/catalog-options.test.ts`:

```ts
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { StoreContext } from '../../server/auth/guards'
import { closeDb, getDb } from '../../server/db/client'
import { productOptionGroups, productOptionValues } from '../../server/db/schema'
import { loadProductDTOs } from '../../server/services/catalog/product-view'
import { replaceProductOptions } from '../../server/services/catalog/options'
import { replaceOptionsInputSchema } from '#shared/schemas/catalog'
import { resetDb } from '../support/db'
import { createOptionGroup, createProduct, createTenant } from '../support/fixtures'

const ctxOf = (t: { owner: { userId: string }, org: { id: string }, store: { id: string } }): StoreContext => ({
  userId: t.owner.userId,
  orgId: t.org.id,
  storeId: t.store.id,
  role: 'OWNER',
})

const input = (groups: unknown[]) => replaceOptionsInputSchema.parse({ groups })
const group = (name: string, values: string[], extra: Record<string, unknown> = {}) => ({
  name,
  required: false,
  minSelect: 0,
  maxSelect: 1,
  values: values.map(value => ({ name: value })),
  ...extra,
})

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('replaceProductOptions', () => {
  it('creates groups and values in array order', async () => {
    const t = await createTenant('opt')
    const product = await createProduct(t.store)
    const result = await replaceProductOptions(getDb(), ctxOf(t), product.id, input([
      group('Size', ['M', 'L'], { required: true, minSelect: 0 }),
      group('Topping', ['Trân châu', 'Thạch', 'Pudding'], { maxSelect: 2 }),
    ]))

    expect(result.map(g => [g.name, g.required, g.minSelect, g.maxSelect, g.position])).toEqual([
      ['Size', true, 1, 1, 0],
      ['Topping', false, 0, 2, 1],
    ])
    expect(result[1]!.values.map(v => [v.name, v.position])).toEqual([['Trân châu', 0], ['Thạch', 1], ['Pudding', 2]])
  })

  it('replaces the previous groups and removes their values', async () => {
    const t = await createTenant('rep')
    const product = await createProduct(t.store)
    await createOptionGroup(t.store, product, { name: 'Cũ', values: [{ name: 'x' }, { name: 'y' }] })
    await replaceProductOptions(getDb(), ctxOf(t), product.id, input([group('Mới', ['a'])]))

    const [dto] = await loadProductDTOs(getDb(), ctxOf(t), { productId: product.id })
    expect(dto!.optionGroups.map(g => g.name)).toEqual(['Mới'])
    expect(await getDb().select().from(productOptionValues)).toHaveLength(1)
  })

  it('an empty list removes every option', async () => {
    const t = await createTenant('clear')
    const product = await createProduct(t.store)
    await createOptionGroup(t.store, product)
    expect(await replaceProductOptions(getDb(), ctxOf(t), product.id, input([]))).toEqual([])
    expect(await getDb().select().from(productOptionGroups)).toEqual([])
  })

  it('NOT_FOUND for a product of another store and changes nothing there', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const theirs = await createProduct(b.store)
    await createOptionGroup(b.store, theirs, { name: 'Của B' })
    await expect(replaceProductOptions(getDb(), ctxOf(a), theirs.id, input([group('Hijack', ['x'])]))).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const remaining = await getDb().select().from(productOptionGroups).where(eq(productOptionGroups.productId, theirs.id))
    expect(remaining.map(g => g.name)).toEqual(['Của B'])
  })

  it('two concurrent replacements never leave a mixed state', async () => {
    const t = await createTenant('race')
    const product = await createProduct(t.store)
    const setA = input([group('A', ['a1', 'a2'])])
    const setB = input([group('B1', ['b1']), group('B2', ['b2', 'b3', 'b4'])])

    const results = await Promise.allSettled([
      replaceProductOptions(getDb(), ctxOf(t), product.id, setA),
      replaceProductOptions(getDb(), ctxOf(t), product.id, setB),
    ])
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'fulfilled'])

    const [dto] = await loadProductDTOs(getDb(), ctxOf(t), { productId: product.id })
    const shape = dto!.optionGroups.map(g => [g.name, g.values.length])
    expect([[['A', 2]], [['B1', 1], ['B2', 3]]]).toContainEqual(shape)
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `npm run test:integration -- tests/integration/catalog-options.test.ts`
Expected: FAIL — không resolve được `server/services/catalog/options`.

- [ ] **Step 3: Viết service**

`server/services/catalog/options.ts`:

```ts
import { and, eq } from 'drizzle-orm'
import type { ReplaceOptionsInput } from '#shared/schemas/catalog'
import type { OptionGroupDTO } from '#shared/types/catalog'
import type { StoreContext } from '../../auth/guards'
import type { Db } from '../../db/client'
import { productOptionGroups, productOptionValues, products } from '../../db/schema'
import { inStore } from '../../repositories/catalog'
import { AppError } from '../../utils/errors'
import { loadProductDTOs } from './product-view'

export async function replaceProductOptions(
  db: Db,
  ctx: StoreContext,
  productId: string,
  input: ReplaceOptionsInput,
): Promise<OptionGroupDTO[]> {
  await db.transaction(async (tx) => {
    // The row lock serialises concurrent replacements of the same product.
    const [product] = await tx
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.id, productId), inStore(products, ctx)))
      .limit(1)
      .for('update')
    if (!product) throw new AppError('NOT_FOUND', 'Không tìm thấy')

    await tx
      .delete(productOptionGroups)
      .where(and(eq(productOptionGroups.productId, productId), inStore(productOptionGroups, ctx)))

    for (const [groupIndex, group] of input.groups.entries()) {
      const [created] = await tx
        .insert(productOptionGroups)
        .values({
          orgId: ctx.orgId,
          storeId: ctx.storeId,
          productId,
          name: group.name,
          required: group.required,
          minSelect: group.minSelect,
          maxSelect: group.maxSelect,
          position: groupIndex,
        })
        .returning({ id: productOptionGroups.id })
      await tx.insert(productOptionValues).values(group.values.map((value, valueIndex) => ({
        orgId: ctx.orgId,
        storeId: ctx.storeId,
        groupId: created!.id,
        name: value.name,
        priceDeltaVnd: value.priceDeltaVnd,
        active: value.active,
        position: valueIndex,
      })))
    }
  })

  const [dto] = await loadProductDTOs(db, ctx, { productId })
  return dto!.optionGroups
}
```

- [ ] **Step 4: Viết route**

`server/api/stores/[storeId]/products/[productId]/options.put.ts`:

```ts
import { getRouterParam } from 'h3'
import { replaceOptionsInputSchema } from '#shared/schemas/catalog'
import { requireStoreOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { replaceProductOptions } from '../../../../../services/catalog/options'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { requireUuidParam } from '../../../../../utils/ids'
import { parseBody } from '../../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const productId = requireUuidParam(event, 'productId')
  const { groups } = await parseBody(event, replaceOptionsInputSchema)
  return { optionGroups: await replaceProductOptions(getDb(), ctx, productId, { groups }) }
})
```

- [ ] **Step 5: Thêm hàng ma trận tenant**

Thêm vào **cuối** `tests/api/tenant-isolation.test.ts`:

```ts
describe('PUT /products/:id/options', () => {
  const body = { groups: [{ name: 'Size', required: true, minSelect: 1, maxSelect: 1, values: [{ name: 'M' }, { name: 'L', priceDeltaVnd: 5000 }] }] }

  it.each<[Actor, number]>([
    ['staffA1', 403],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
    ['ownerA', 200],
  ])('%s → %i', async (actor, status) => {
    const res = await call('PUT', `/api/stores/${ids.storeA1}/products/${ids.productA1}/options`, tokens[actor], body)
    expect(res.status).toBe(status)
    if (status === 200) expect(res.body.optionGroups[0]).toMatchObject({ name: 'Size', required: true, minSelect: 1 })
    else expect(res.body).toMatchObject({ code: errorCodes[status] })
  })

  it('cannot replace the options of a product that belongs to another store', async () => {
    expect(await call('PUT', `/api/stores/${ids.storeA1}/products/${ids.productA2}/options`, tokens.ownerA, body)).toMatchObject({ status: 404 })
    expect(await call('PUT', `/api/stores/${ids.storeB}/products/${ids.productA1}/options`, tokens.ownerB, body)).toMatchObject({ status: 404 })
  })

  it('rejects inconsistent groups with 400', async () => {
    const bad = { groups: [{ name: 'Topping', required: false, minSelect: 3, maxSelect: 2, values: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] }] }
    expect(await call('PUT', `/api/stores/${ids.storeA1}/products/${ids.productA1}/options`, tokens.ownerA, bad))
      .toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
  })
})
```

- [ ] **Step 6: Chạy test để xác nhận đạt**

Run: `npm run test:integration -- tests/integration/catalog-options.test.ts && npm run test:api -- tests/api/tenant-isolation.test.ts`
Expected: PASS (kể cả test đồng thời).

- [ ] **Step 7: Commit**

```bash
git add server/services/catalog/options.ts server/api/stores tests
git commit -m "feat(catalog): replace product option groups atomically

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 9: Upload ảnh món qua server (multipart ≤ 2 MB, kiểm tra magic bytes)

**Files:**
- Create: `shared/catalog-limits.ts`, `server/utils/image-type.ts`, `server/services/catalog/product-image.ts`, `server/api/stores/[storeId]/products/[productId]/image.post.ts`
- Modify: `tests/api/catalog-api.test.ts` (seed `productId` + describe upload)
- Test: `tests/unit/server/image-type.test.ts`, `tests/integration/catalog-product-image.test.ts`

**Interfaces:**
- Consumes: `putObject`, `deleteObject`, `PRODUCT_IMAGES_BUCKET`, `publicObjectUrl` (`server/services/storage`); `generateToken` (Task 1); `inStore`; `callForm` (Task 3).
- Produces:
  - `MAX_PRODUCT_IMAGE_BYTES = 2 * 1024 * 1024`, `PRODUCT_IMAGE_TYPES`, `ProductImageType` (`shared/catalog-limits.ts`; client dùng để kiểm tra trước khi upload).
  - `detectImageType(bytes: Uint8Array): ProductImageType | null` (JPEG/PNG/WebP theo magic bytes, không tin content-type).
  - `interface ImageStorage { put(input: { bucket: string, key: string, body: Uint8Array, contentType: string, cacheControl?: string }): Promise<void>, remove(bucket: string, key: string): Promise<void> }`
  - `replaceProductImage(db: Db, ctx: StoreContext, productId: string, bytes: Uint8Array, storage?: ImageStorage): Promise<{ imageUrl: string }>` — key `stores/<storeId>/products/<productId>/<token>.<ext>`; ảnh cũ chỉ bị xoá **sau khi** ghi DB thành công; lỗi xoá ảnh cũ chỉ ghi log.
  - Route `POST /api/stores/:id/products/:productId/image` (multipart field `file`) → `{ imageUrl: string }` (owner).
  - **Lệch spec/roadmap có chủ đích:** upload qua server thay vì presigned PUT (CORS của Neon Storage cho browser PUT chưa xác minh). Ghi chú vào spec §2 ở Task 19.

- [ ] **Step 1: Viết unit test thất bại cho `detectImageType`**

`tests/unit/server/image-type.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { detectImageType } from '../../../server/utils/image-type'

const bytes = (...values: number[]) => Uint8Array.from(values)
const ascii = (text: string) => Uint8Array.from(Buffer.from(text, 'latin1'))

describe('detectImageType', () => {
  it('recognises JPEG, PNG and WebP by their signatures', () => {
    expect(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10))).toBe('image/jpeg')
    expect(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0))).toBe('image/png')
    expect(detectImageType(Uint8Array.from([...ascii('RIFF'), 0x24, 0, 0, 0, ...ascii('WEBPVP8 ')]))).toBe('image/webp')
  })

  it('rejects text, empty and truncated input', () => {
    expect(detectImageType(ascii('hello world, I am not an image'))).toBeNull()
    expect(detectImageType(new Uint8Array())).toBeNull()
    expect(detectImageType(bytes(0xff, 0xd8))).toBeNull()
    expect(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull()
  })

  it('does not mistake other RIFF containers for WebP', () => {
    expect(detectImageType(Uint8Array.from([...ascii('RIFF'), 0x24, 0, 0, 0, ...ascii('WAVEfmt ')]))).toBeNull()
  })

  it('does not accept GIF or SVG', () => {
    expect(detectImageType(ascii('GIF89a......'))).toBeNull()
    expect(detectImageType(ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull()
  })
})
```

- [ ] **Step 2: Viết integration test thất bại cho `replaceProductImage`**

`tests/integration/catalog-product-image.test.ts`:

```ts
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { MAX_PRODUCT_IMAGE_BYTES } from '#shared/catalog-limits'
import type { StoreContext } from '../../server/auth/guards'
import { closeDb, getDb } from '../../server/db/client'
import { products } from '../../server/db/schema'
import { replaceProductImage, type ImageStorage } from '../../server/services/catalog/product-image'
import { resetDb } from '../support/db'
import { createProduct, createTenant } from '../support/fixtures'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0, 0])

const ctxOf = (t: { owner: { userId: string }, org: { id: string }, store: { id: string } }): StoreContext => ({
  userId: t.owner.userId,
  orgId: t.org.id,
  storeId: t.store.id,
  role: 'OWNER',
})

const imageKeyOf = async (productId: string) =>
  (await getDb().select({ key: products.imageKey }).from(products).where(eq(products.id, productId)))[0]!.key

function fakeStorage(opts: { failPut?: boolean, failRemove?: boolean } = {}) {
  const calls = {
    put: [] as { bucket: string, key: string, contentType: string, cacheControl?: string }[],
    remove: [] as { bucket: string, key: string }[],
    keyInDbWhenRemoving: [] as (string | null)[],
    productId: '',
  }
  const storage: ImageStorage = {
    put: async (input) => {
      if (opts.failPut) throw new Error('storage down')
      calls.put.push({ bucket: input.bucket, key: input.key, contentType: input.contentType, cacheControl: input.cacheControl })
    },
    remove: async (bucket, key) => {
      calls.keyInDbWhenRemoving.push(await imageKeyOf(calls.productId))
      calls.remove.push({ bucket, key })
      if (opts.failRemove) throw new Error('cleanup failed')
    },
  }
  return { storage, calls }
}

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('replaceProductImage', () => {
  it('uploads with a tenant-scoped key, stores it and returns the public url', async () => {
    const t = await createTenant('img')
    const product = await createProduct(t.store)
    const { storage, calls } = fakeStorage()
    const result = await replaceProductImage(getDb(), ctxOf(t), product.id, PNG, storage)

    expect(calls.put).toHaveLength(1)
    expect(calls.put[0]).toMatchObject({ bucket: 'product-images', contentType: 'image/png', cacheControl: 'public, max-age=31536000, immutable' })
    expect(calls.put[0]!.key).toMatch(new RegExp(`^stores/${t.store.id}/products/${product.id}/[A-Za-z0-9_-]{22}\\.png$`))
    expect(await imageKeyOf(product.id)).toBe(calls.put[0]!.key)
    expect(result.imageUrl).toMatch(new RegExp(`${calls.put[0]!.key}$`))
  })

  it('maps JPEG to .jpg', async () => {
    const t = await createTenant('jpg')
    const product = await createProduct(t.store)
    const { storage, calls } = fakeStorage()
    await replaceProductImage(getDb(), ctxOf(t), product.id, JPEG, storage)
    expect(calls.put[0]!.key).toMatch(/\.jpg$/)
  })

  it('deletes the previous image only after the new key is in the database', async () => {
    const t = await createTenant('swap')
    const product = await createProduct(t.store)
    const { storage, calls } = fakeStorage()
    calls.productId = product.id
    await replaceProductImage(getDb(), ctxOf(t), product.id, PNG, storage)
    const firstKey = calls.put[0]!.key
    await replaceProductImage(getDb(), ctxOf(t), product.id, JPEG, storage)
    const secondKey = calls.put[1]!.key

    expect(secondKey).not.toBe(firstKey)
    expect(calls.remove).toEqual([{ bucket: 'product-images', key: firstKey }])
    expect(calls.keyInDbWhenRemoving).toEqual([secondKey])
  })

  it('still succeeds when removing the old image fails', async () => {
    const t = await createTenant('cleanup')
    const product = await createProduct(t.store, { imageKey: 'stores/x/products/y/old.png' })
    const { storage, calls } = fakeStorage({ failRemove: true })
    calls.productId = product.id
    const result = await replaceProductImage(getDb(), ctxOf(t), product.id, PNG, storage)
    expect(result.imageUrl).toMatch(/\.png$/)
    expect(await imageKeyOf(product.id)).toBe(calls.put[0]!.key)
  })

  it('rejects non-image bytes, empty and oversized files without uploading anything', async () => {
    const t = await createTenant('bad')
    const product = await createProduct(t.store)
    const { storage, calls } = fakeStorage()
    const text = Uint8Array.from(Buffer.from('<?php echo 1; ?> pretending to be a.png'))
    const tooBig = new Uint8Array(MAX_PRODUCT_IMAGE_BYTES + 1)
    tooBig.set(PNG)
    for (const bytes of [text, new Uint8Array(), tooBig]) {
      await expect(replaceProductImage(getDb(), ctxOf(t), product.id, bytes, storage)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    }
    expect(calls.put).toEqual([])
    expect(await imageKeyOf(product.id)).toBeNull()
  })

  it('accepts a file of exactly 2 MB', async () => {
    const t = await createTenant('edge')
    const product = await createProduct(t.store)
    const exact = new Uint8Array(MAX_PRODUCT_IMAGE_BYTES)
    exact.set(PNG)
    const { storage, calls } = fakeStorage()
    await replaceProductImage(getDb(), ctxOf(t), product.id, exact, storage)
    expect(calls.put).toHaveLength(1)
  })

  it('leaves the product untouched when the storage upload fails', async () => {
    const t = await createTenant('down')
    const product = await createProduct(t.store, { imageKey: 'stores/x/products/y/keep.png' })
    const { storage } = fakeStorage({ failPut: true })
    await expect(replaceProductImage(getDb(), ctxOf(t), product.id, PNG, storage)).rejects.toThrow('storage down')
    expect(await imageKeyOf(product.id)).toBe('stores/x/products/y/keep.png')
  })

  it('NOT_FOUND for a product of another store, without uploading', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const theirs = await createProduct(b.store)
    const { storage, calls } = fakeStorage()
    await expect(replaceProductImage(getDb(), ctxOf(a), theirs.id, PNG, storage)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(calls.put).toEqual([])
  })
})
```

- [ ] **Step 3: Chạy test để xác nhận thất bại**

Run: `npx vitest run --project unit tests/unit/server/image-type.test.ts && npm run test:integration -- tests/integration/catalog-product-image.test.ts`
Expected: FAIL — thiếu `server/utils/image-type` và `server/services/catalog/product-image`.

- [ ] **Step 4: Viết giới hạn dùng chung và `detectImageType`**

`shared/catalog-limits.ts`:

```ts
export const MAX_PRODUCT_IMAGE_BYTES = 2 * 1024 * 1024
export const PRODUCT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type ProductImageType = (typeof PRODUCT_IMAGE_TYPES)[number]
```

`server/utils/image-type.ts`:

```ts
import type { ProductImageType } from '#shared/catalog-limits'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function asciiAt(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end))
}

/** Trusts the file content, never the client-declared name or content-type. */
export function detectImageType(bytes: Uint8Array): ProductImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return 'image/png'
  if (bytes.length >= 12 && asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 12) === 'WEBP') return 'image/webp'
  return null
}
```

- [ ] **Step 5: Viết service**

`server/services/catalog/product-image.ts`:

```ts
import { and, eq } from 'drizzle-orm'
import { MAX_PRODUCT_IMAGE_BYTES, type ProductImageType } from '#shared/catalog-limits'
import type { StoreContext } from '../../auth/guards'
import type { Db } from '../../db/client'
import { products } from '../../db/schema'
import { inStore } from '../../repositories/catalog'
import { AppError } from '../../utils/errors'
import { detectImageType } from '../../utils/image-type'
import { logger } from '../../utils/logger'
import { generateToken } from '../../utils/tokens'
import { deleteObject, PRODUCT_IMAGES_BUCKET, publicObjectUrl, putObject } from '../storage'

export interface ImageStorage {
  put(input: { bucket: string, key: string, body: Uint8Array, contentType: string, cacheControl?: string }): Promise<void>
  remove(bucket: string, key: string): Promise<void>
}

const defaultStorage: ImageStorage = { put: putObject, remove: deleteObject }

const EXTENSIONS: Record<ProductImageType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

const notFound = () => new AppError('NOT_FOUND', 'Không tìm thấy')

export async function replaceProductImage(
  db: Db,
  ctx: StoreContext,
  productId: string,
  bytes: Uint8Array,
  storage: ImageStorage = defaultStorage,
): Promise<{ imageUrl: string }> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PRODUCT_IMAGE_BYTES) {
    throw new AppError('VALIDATION_FAILED', 'Ảnh phải nhỏ hơn hoặc bằng 2 MB')
  }
  const type = detectImageType(bytes)
  if (!type) throw new AppError('VALIDATION_FAILED', 'Chỉ nhận ảnh JPG, PNG hoặc WebP')

  const [existing] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, productId), inStore(products, ctx)))
    .limit(1)
  if (!existing) throw notFound()

  const key = `stores/${ctx.storeId}/products/${productId}/${generateToken(16)}.${EXTENSIONS[type]}`
  await storage.put({
    bucket: PRODUCT_IMAGES_BUCKET,
    key,
    body: bytes,
    contentType: type,
    cacheControl: 'public, max-age=31536000, immutable',
  })

  let previousKey: string | null
  try {
    previousKey = await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ imageKey: products.imageKey })
        .from(products)
        .where(and(eq(products.id, productId), inStore(products, ctx)))
        .limit(1)
        .for('update')
      if (!current) throw notFound()
      await tx.update(products).set({ imageKey: key, updatedAt: new Date() }).where(eq(products.id, productId))
      return current.imageKey
    })
  }
  catch (err) {
    await storage.remove(PRODUCT_IMAGES_BUCKET, key).catch(() => undefined)
    throw err
  }

  if (previousKey) {
    await storage.remove(PRODUCT_IMAGES_BUCKET, previousKey).catch((err: unknown) => {
      logger.warn('catalog.image_cleanup_failed', { productId, err })
    })
  }
  return { imageUrl: publicObjectUrl(PRODUCT_IMAGES_BUCKET, key) }
}
```

- [ ] **Step 6: Viết route**

`server/api/stores/[storeId]/products/[productId]/image.post.ts`:

```ts
import { getHeader, getRouterParam, readMultipartFormData } from 'h3'
import { MAX_PRODUCT_IMAGE_BYTES } from '#shared/catalog-limits'
import { requireStoreOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { replaceProductImage } from '../../../../../services/catalog/product-image'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { AppError } from '../../../../../utils/errors'
import { requireUuidParam } from '../../../../../utils/ids'

const MULTIPART_OVERHEAD_BYTES = 64 * 1024

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const productId = requireUuidParam(event, 'productId')

  const declared = Number(getHeader(event, 'content-length') ?? 0)
  if (declared > MAX_PRODUCT_IMAGE_BYTES + MULTIPART_OVERHEAD_BYTES) {
    throw new AppError('VALIDATION_FAILED', 'Ảnh phải nhỏ hơn hoặc bằng 2 MB')
  }
  const parts = await readMultipartFormData(event)
  const file = parts?.find(part => part.name === 'file' && part.filename !== undefined)
  if (!file) throw new AppError('VALIDATION_FAILED', 'Thiếu file ảnh')

  return replaceProductImage(getDb(), ctx, productId, file.data)
})
```

- [ ] **Step 7: Thêm test API (route + tenant) vào `tests/api/catalog-api.test.ts`**

Sửa seed: trong khai báo kiểu `seed`, thêm `productId: string` (thay `  otherStoreId: string\n  otherOwnerToken: string\n}` bằng `  otherStoreId: string\n  otherOwnerToken: string\n  productId: string\n}`) và trong `Object.assign(seed, {…})` thêm dòng `    productId: product.id,` sau `otherOwnerToken: await sign(b.owner),`.

Thay hai dòng import hiện có và thêm một dòng import mới ở đầu file:

```ts
import { products, stores } from '../../server/db/schema'
import { deleteObject, PRODUCT_IMAGES_BUCKET } from '../../server/services/storage'
import { call, callForm } from '../support/http'
```

(`products, stores` thay cho `import { stores } from '../../server/db/schema'`; `call, callForm` thay cho `import { call } from '../support/http'`; dòng `storage` là mới.)

Thêm vào **cuối file**:

```ts
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

function imageForm(bytes: Uint8Array, filename: string, type: string, field = 'file') {
  const form = new FormData()
  form.append(field, new Blob([bytes], { type }), filename)
  return form
}

const imageKeyInDb = async () =>
  (await getDb().select({ key: products.imageKey }).from(products).where(eq(products.id, seed.productId)))[0]!.key

describe('POST /api/stores/:id/products/:productId/image', () => {
  const path = () => `/api/stores/${seed.storeId}/products/${seed.productId}/image`

  it('stores a valid image, serves it publicly and exposes it in the public menu', async () => {
    const res = await callForm('POST', path(), seed.ownerToken, imageForm(PNG_1X1, 'tra-sua.png', 'image/png'))
    expect(res.status).toBe(200)
    expect(res.body.imageUrl).toMatch(/\.png$/)

    const served = await fetch(res.body.imageUrl)
    expect(served.status).toBe(200)
    const menu = await call('GET', `/api/public/stores/${seed.slug}/menu`)
    expect(menu.body.products.find((p: { id: string }) => p.id === seed.productId).imageUrl).toBe(res.body.imageUrl)

    const key = await imageKeyInDb()
    await deleteObject(PRODUCT_IMAGES_BUCKET, key!)
    await getDb().update(products).set({ imageKey: null }).where(eq(products.id, seed.productId))
  })

  it('rejects a text file renamed .png even when it claims image/png', async () => {
    const fake = Buffer.from('not really an image')
    const res = await callForm('POST', path(), seed.ownerToken, imageForm(fake, 'evil.png', 'image/png'))
    expect(res).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
    expect(await imageKeyInDb()).toBeNull()
  })

  it('rejects a request without a file field', async () => {
    const res = await callForm('POST', path(), seed.ownerToken, imageForm(PNG_1X1, 'a.png', 'image/png', 'other'))
    expect(res).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
  })

  it.each([2 * 1024 * 1024 + 1, 3 * 1024 * 1024])('rejects a %i byte file', async (size) => {
    const big = new Uint8Array(size)
    big.set(PNG_1X1)
    const res = await callForm('POST', path(), seed.ownerToken, imageForm(big, 'big.png', 'image/png'))
    expect(res).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
    expect(await imageKeyInDb()).toBeNull()
  })

  it('only the owner of that store can upload', async () => {
    expect((await callForm('POST', path(), null, imageForm(PNG_1X1, 'a.png', 'image/png'))).status).toBe(401)
    expect((await callForm('POST', path(), seed.staffToken, imageForm(PNG_1X1, 'a.png', 'image/png'))).status).toBe(403)
    expect((await callForm('POST', path(), seed.otherOwnerToken, imageForm(PNG_1X1, 'a.png', 'image/png'))).status).toBe(404)
    expect(await imageKeyInDb()).toBeNull()
  })
})
```

- [ ] **Step 8: Chạy test để xác nhận đạt**

Run:

```bash
npx vitest run --project unit tests/unit/server/image-type.test.ts
npm run test:integration -- tests/integration/catalog-product-image.test.ts
npm run test:api -- tests/api/catalog-api.test.ts
```

Expected: PASS (test API ghi/xoá một object thật trong bucket `product-images` của branch test).

- [ ] **Step 9: Commit**

```bash
git add shared/catalog-limits.ts server/utils/image-type.ts server/services/catalog/product-image.ts server/api/stores tests
git commit -m "feat(catalog): upload product images through the server

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 10: Cài đặt nhận món (`fulfillment`) + khu vực giao (`delivery-zones`)

**Files:**
- Create: `shared/schemas/fulfillment.ts`, `server/services/catalog/fulfillment.ts`, `server/services/catalog/delivery-zones.ts`, `server/api/stores/[storeId]/fulfillment.patch.ts`, `server/api/stores/[storeId]/delivery-zones/index.get.ts`, `server/api/stores/[storeId]/delivery-zones/index.post.ts`, `server/api/stores/[storeId]/delivery-zones/[zoneId].patch.ts`
- Modify: `server/repositories/catalog.ts` (thêm `listZoneRows`), `tests/api/tenant-isolation.test.ts`
- Test: `tests/unit/shared/fulfillment-schemas.test.ts`, `tests/integration/catalog-fulfillment.test.ts`

**Interfaces:**
- Consumes: `getStoreDetail` (PR1 `server/services/store/settings.ts`), `StoreDetail`, `inStore`, `deliveryZones` table, `vndSchema`, `nameField`, `hasChange`.
- Produces:
  - `updateFulfillmentInputSchema`, `createZoneInputSchema`, `updateZoneInputSchema` + kiểu `UpdateFulfillmentInput`, `CreateZoneInput`, `UpdateZoneInput`.
  - `listZoneRows(db: DbOrTx, scope: CatalogScope, opts?: { activeOnly?: boolean })` (repository).
  - `updateFulfillment(db: Db, ctx: StoreContext, patch: UpdateFulfillmentInput): Promise<StoreDetail>` — khoá hàng store `FOR UPDATE`; kết quả cuối phải còn ≥ 1 mode, ngược lại `VALIDATION_FAILED` (400, `details: [{ path: 'modes', … }]`). Bật `deliveryEnabled` khi chưa có zone active **được phép**.
  - `listZones(db: DbOrTx, scope): Promise<DeliveryZoneDTO[]>`, `createZone(db, ctx, input): Promise<DeliveryZoneDTO>`, `updateZone(db, ctx, zoneId, patch): Promise<DeliveryZoneDTO>`.
  - Route: `PATCH /api/stores/:id/fulfillment` → `StoreDetail` (owner); `GET /api/stores/:id/delivery-zones → { zones }` (staff); `POST` → 201 (owner); `PATCH …/delivery-zones/:zoneId` (owner). **Không có DELETE**: tắt bằng `active=false` (soft-disable, spec §4.4) vì PR3 sẽ có FK `(store_id, delivery_zone_id)` từ `orders`.

- [ ] **Step 1: Viết unit test thất bại cho schema**

`tests/unit/shared/fulfillment-schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createZoneInputSchema, updateFulfillmentInputSchema, updateZoneInputSchema } from '#shared/schemas/fulfillment'

describe('updateFulfillmentInputSchema', () => {
  it('accepts a partial toggle and rejects an empty or non-boolean patch', () => {
    expect(updateFulfillmentInputSchema.safeParse({ deliveryEnabled: true }).success).toBe(true)
    expect(updateFulfillmentInputSchema.safeParse({}).success).toBe(false)
    expect(updateFulfillmentInputSchema.safeParse({ pickupEnabled: 'yes' }).success).toBe(false)
  })
})

describe('delivery zone schemas', () => {
  it('requires a name and a non-negative integer fee', () => {
    expect(createZoneInputSchema.parse({ name: ' Quận 1 ', feeVnd: 15000 })).toEqual({ name: 'Quận 1', feeVnd: 15000 })
    expect(createZoneInputSchema.parse({ name: 'Nội bộ', feeVnd: 0 }).feeVnd).toBe(0)
    for (const feeVnd of [-1, 1.5, 100_000_001]) {
      expect(createZoneInputSchema.safeParse({ name: 'A', feeVnd }).success).toBe(false)
    }
    expect(createZoneInputSchema.safeParse({ name: ' ', feeVnd: 1000 }).success).toBe(false)
  })

  it('update needs at least one change', () => {
    expect(updateZoneInputSchema.safeParse({}).success).toBe(false)
    expect(updateZoneInputSchema.safeParse({ active: false }).success).toBe(true)
  })
})
```

- [ ] **Step 2: Viết integration test thất bại**

`tests/integration/catalog-fulfillment.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { StoreContext } from '../../server/auth/guards'
import { closeDb, getDb } from '../../server/db/client'
import { createZone, listZones, updateZone } from '../../server/services/catalog/delivery-zones'
import { updateFulfillment } from '../../server/services/catalog/fulfillment'
import { resetDb } from '../support/db'
import { createStore, createTenant, createZone as seedZone } from '../support/fixtures'

const ctxOf = (t: { owner: { userId: string }, org: { id: string } }, store: { id: string }): StoreContext => ({
  userId: t.owner.userId,
  orgId: t.org.id,
  storeId: store.id,
  role: 'OWNER',
})

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('updateFulfillment', () => {
  it('toggles individual modes and keeps the others', async () => {
    const t = await createTenant('ful')
    const detail = await updateFulfillment(getDb(), ctxOf(t, t.store), { deliveryEnabled: true })
    expect(detail).toMatchObject({ dineInEnabled: true, pickupEnabled: true, deliveryEnabled: true })
    const next = await updateFulfillment(getDb(), ctxOf(t, t.store), { dineInEnabled: false })
    expect(next).toMatchObject({ dineInEnabled: false, pickupEnabled: true, deliveryEnabled: true })
  })

  it('allows enabling delivery before any zone exists', async () => {
    const t = await createTenant('nozone')
    expect((await updateFulfillment(getDb(), ctxOf(t, t.store), { deliveryEnabled: true })).deliveryEnabled).toBe(true)
  })

  it('refuses to turn every mode off and leaves the store unchanged', async () => {
    const t = await createTenant('off')
    await expect(updateFulfillment(getDb(), ctxOf(t, t.store), { dineInEnabled: false, pickupEnabled: false }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    const detail = await updateFulfillment(getDb(), ctxOf(t, t.store), { pickupEnabled: true })
    expect(detail).toMatchObject({ dineInEnabled: true, pickupEnabled: true })
  })

  it('two concurrent requests cannot together turn off the last two modes', async () => {
    const t = await createTenant('race')
    const results = await Promise.allSettled([
      updateFulfillment(getDb(), ctxOf(t, t.store), { dineInEnabled: false }),
      updateFulfillment(getDb(), ctxOf(t, t.store), { pickupEnabled: false }),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1)
    const detail = await updateFulfillment(getDb(), ctxOf(t, t.store), { deliveryEnabled: false })
    expect([detail.dineInEnabled, detail.pickupEnabled, detail.deliveryEnabled].some(Boolean)).toBe(true)
  })

  it('cannot change a store the caller context does not own (NOT_FOUND)', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const foreign = { ...ctxOf(a, b.store) }
    await expect(updateFulfillment(getDb(), foreign, { deliveryEnabled: true })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('delivery zones', () => {
  it('creates zones in order and lists active and inactive ones', async () => {
    const t = await createTenant('zones')
    const first = await createZone(getDb(), ctxOf(t, t.store), { name: 'Quận 1', feeVnd: 15000 })
    const second = await createZone(getDb(), ctxOf(t, t.store), { name: 'Quận 3', feeVnd: 0 })
    expect([first.position, second.position]).toEqual([0, 1])
    await updateZone(getDb(), ctxOf(t, t.store), second.id, { active: false })
    expect((await listZones(getDb(), ctxOf(t, t.store))).map(z => [z.name, z.feeVnd, z.active])).toEqual([
      ['Quận 1', 15000, true],
      ['Quận 3', 0, false],
    ])
  })

  it('updates name and fee', async () => {
    const t = await createTenant('upd')
    const zone = await createZone(getDb(), ctxOf(t, t.store), { name: 'Cũ', feeVnd: 10000 })
    expect(await updateZone(getDb(), ctxOf(t, t.store), zone.id, { name: 'Mới', feeVnd: 20000 })).toMatchObject({ name: 'Mới', feeVnd: 20000 })
  })

  it('scopes zones to the store and hides foreign ones (NOT_FOUND)', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const a2 = await createStore(a.org.id, 'a2')
    const theirs = await seedZone(b.store, { name: 'Của B' })
    const sibling = await seedZone(a2, { name: 'Của A2' })
    await expect(updateZone(getDb(), ctxOf(a, a.store), theirs.id, { name: 'Hijack' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(updateZone(getDb(), ctxOf(a, a.store), sibling.id, { name: 'Hijack' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await listZones(getDb(), ctxOf(a, a.store))).toEqual([])
  })
})
```

- [ ] **Step 3: Chạy test để xác nhận thất bại**

Run: `npx vitest run --project unit tests/unit/shared/fulfillment-schemas.test.ts && npm run test:integration -- tests/integration/catalog-fulfillment.test.ts`
Expected: FAIL — thiếu `#shared/schemas/fulfillment` và hai service.

- [ ] **Step 4: Viết schema, repository và service**

`shared/schemas/fulfillment.ts`:

```ts
import { z } from 'zod'
import { hasChange, nameField, NO_CHANGE, positionSchema, vndSchema } from './common'

export const updateFulfillmentInputSchema = z
  .object({
    dineInEnabled: z.boolean().optional(),
    pickupEnabled: z.boolean().optional(),
    deliveryEnabled: z.boolean().optional(),
  })
  .refine(hasChange, NO_CHANGE)
export type UpdateFulfillmentInput = z.output<typeof updateFulfillmentInputSchema>

export const createZoneInputSchema = z.object({ name: nameField(60), feeVnd: vndSchema })
export type CreateZoneInput = z.output<typeof createZoneInputSchema>

export const updateZoneInputSchema = z
  .object({
    name: nameField(60).optional(),
    feeVnd: vndSchema.optional(),
    active: z.boolean().optional(),
    position: positionSchema.optional(),
  })
  .refine(hasChange, NO_CHANGE)
export type UpdateZoneInput = z.output<typeof updateZoneInputSchema>
```

Trong `server/repositories/catalog.ts`, thêm hàm mới ngay trước `countActiveZones` (old_str: `export async function countActiveZones(db: DbOrTx, scope: CatalogScope): Promise<number> {`):

```ts
export async function listZoneRows(db: DbOrTx, scope: CatalogScope, opts: { activeOnly?: boolean } = {}) {
  return db
    .select()
    .from(deliveryZones)
    .where(and(inStore(deliveryZones, scope), opts.activeOnly ? eq(deliveryZones.active, true) : undefined))
    .orderBy(asc(deliveryZones.position), asc(deliveryZones.createdAt), asc(deliveryZones.id))
}

export async function countActiveZones(db: DbOrTx, scope: CatalogScope): Promise<number> {
```

`server/services/catalog/fulfillment.ts`:

```ts
import { and, eq } from 'drizzle-orm'
import type { UpdateFulfillmentInput } from '#shared/schemas/fulfillment'
import type { StoreDetail } from '#shared/types/identity'
import type { StoreContext } from '../../auth/guards'
import type { Db } from '../../db/client'
import { stores } from '../../db/schema'
import { AppError } from '../../utils/errors'
import { getStoreDetail } from '../store/settings'

const AT_LEAST_ONE = 'Cần bật ít nhất một hình thức nhận món'

export async function updateFulfillment(db: Db, ctx: StoreContext, patch: UpdateFulfillmentInput): Promise<StoreDetail> {
  return db.transaction(async (tx) => {
    const scope = and(eq(stores.id, ctx.storeId), eq(stores.orgId, ctx.orgId))
    // The row lock makes "read current modes, check, write" atomic against a concurrent toggle.
    const [current] = await tx
      .select({ dineIn: stores.dineInEnabled, pickup: stores.pickupEnabled, delivery: stores.deliveryEnabled })
      .from(stores)
      .where(scope)
      .limit(1)
      .for('update')
    if (!current) throw new AppError('NOT_FOUND', 'Không tìm thấy')

    const next = {
      dineIn: patch.dineInEnabled ?? current.dineIn,
      pickup: patch.pickupEnabled ?? current.pickup,
      delivery: patch.deliveryEnabled ?? current.delivery,
    }
    if (!next.dineIn && !next.pickup && !next.delivery) {
      throw new AppError('VALIDATION_FAILED', AT_LEAST_ONE, [{ path: 'modes', message: AT_LEAST_ONE }])
    }

    await tx
      .update(stores)
      .set({ dineInEnabled: next.dineIn, pickupEnabled: next.pickup, deliveryEnabled: next.delivery, updatedAt: new Date() })
      .where(scope)
    return getStoreDetail(tx, ctx)
  })
}
```

`server/services/catalog/delivery-zones.ts`:

```ts
import { and, eq, max } from 'drizzle-orm'
import type { CreateZoneInput, UpdateZoneInput } from '#shared/schemas/fulfillment'
import type { DeliveryZoneDTO } from '#shared/types/catalog'
import type { StoreContext } from '../../auth/guards'
import type { DbOrTx } from '../../db/client'
import { deliveryZones } from '../../db/schema'
import { inStore, listZoneRows, type CatalogScope } from '../../repositories/catalog'
import { AppError } from '../../utils/errors'

function toDTO(row: typeof deliveryZones.$inferSelect): DeliveryZoneDTO {
  return { id: row.id, name: row.name, feeVnd: row.feeVnd, active: row.active, position: row.position }
}

export async function listZones(db: DbOrTx, scope: CatalogScope): Promise<DeliveryZoneDTO[]> {
  return (await listZoneRows(db, scope)).map(toDTO)
}

export async function createZone(db: DbOrTx, ctx: StoreContext, input: CreateZoneInput): Promise<DeliveryZoneDTO> {
  const [last] = await db.select({ top: max(deliveryZones.position) }).from(deliveryZones).where(inStore(deliveryZones, ctx))
  const [row] = await db
    .insert(deliveryZones)
    .values({ orgId: ctx.orgId, storeId: ctx.storeId, name: input.name, feeVnd: input.feeVnd, position: (last?.top ?? -1) + 1 })
    .returning()
  return toDTO(row!)
}

export async function updateZone(db: DbOrTx, ctx: StoreContext, zoneId: string, patch: UpdateZoneInput): Promise<DeliveryZoneDTO> {
  const [row] = await db
    .update(deliveryZones)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(deliveryZones.id, zoneId), inStore(deliveryZones, ctx)))
    .returning()
  if (!row) throw new AppError('NOT_FOUND', 'Không tìm thấy')
  return toDTO(row)
}
```

- [ ] **Step 5: Viết route**

`server/api/stores/[storeId]/fulfillment.patch.ts`:

```ts
import { getRouterParam } from 'h3'
import { updateFulfillmentInputSchema } from '#shared/schemas/fulfillment'
import { requireStoreOwner } from '../../../auth/guards'
import { getDb } from '../../../db/client'
import { updateFulfillment } from '../../../services/catalog/fulfillment'
import { defineApiHandler } from '../../../utils/api-handler'
import { parseBody } from '../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const patch = await parseBody(event, updateFulfillmentInputSchema)
  return updateFulfillment(getDb(), ctx, patch)
})
```

`server/api/stores/[storeId]/delivery-zones/index.get.ts`:

```ts
import { getRouterParam } from 'h3'
import { requireStoreStaff } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { listZones } from '../../../../services/catalog/delivery-zones'
import { defineApiHandler } from '../../../../utils/api-handler'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreStaff(event, getRouterParam(event, 'storeId'))
  return { zones: await listZones(getDb(), ctx) }
})
```

`server/api/stores/[storeId]/delivery-zones/index.post.ts`:

```ts
import { getRouterParam, setResponseStatus } from 'h3'
import { createZoneInputSchema } from '#shared/schemas/fulfillment'
import { requireStoreOwner } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { createZone } from '../../../../services/catalog/delivery-zones'
import { defineApiHandler } from '../../../../utils/api-handler'
import { parseBody } from '../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const input = await parseBody(event, createZoneInputSchema)
  const zone = await createZone(getDb(), ctx, input)
  setResponseStatus(event, 201)
  return zone
})
```

`server/api/stores/[storeId]/delivery-zones/[zoneId].patch.ts`:

```ts
import { getRouterParam } from 'h3'
import { updateZoneInputSchema } from '#shared/schemas/fulfillment'
import { requireStoreOwner } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { updateZone } from '../../../../services/catalog/delivery-zones'
import { defineApiHandler } from '../../../../utils/api-handler'
import { requireUuidParam } from '../../../../utils/ids'
import { parseBody } from '../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const zoneId = requireUuidParam(event, 'zoneId')
  const patch = await parseBody(event, updateZoneInputSchema)
  return updateZone(getDb(), ctx, zoneId, patch)
})
```

- [ ] **Step 6: Thêm hàng ma trận tenant**

Thêm vào **cuối** `tests/api/tenant-isolation.test.ts`:

```ts
describe('fulfillment settings', () => {
  it.each<[Actor, number]>([
    ['staffA1', 403],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
    ['ownerA', 200],
  ])('PATCH /fulfillment %s → %i', async (actor, status) => {
    const res = await call('PATCH', `/api/stores/${ids.storeA1}/fulfillment`, tokens[actor], { pickupEnabled: true })
    expect(res.status).toBe(status)
    if (status !== 200) expect(res.body).toMatchObject({ code: errorCodes[status] })
  })

  it('refuses to turn every mode off with 400 and keeps the previous state', async () => {
    const res = await call('PATCH', `/api/stores/${ids.storeA1}/fulfillment`, tokens.ownerA, { dineInEnabled: false, pickupEnabled: false, deliveryEnabled: false })
    expect(res).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
    const store = await call('GET', `/api/stores/${ids.storeA1}`, tokens.ownerA)
    expect([store.body.dineInEnabled, store.body.pickupEnabled, store.body.deliveryEnabled].some(Boolean)).toBe(true)
  })
})

describe('delivery zones', () => {
  it.each<[Actor, number]>([
    ['ownerA', 200],
    ['staffA1', 200],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
  ])('GET /delivery-zones %s → %i', async (actor, status) => {
    const res = await call('GET', `/api/stores/${ids.storeA1}/delivery-zones`, tokens[actor])
    expect(res.status).toBe(status)
    if (status === 200) expect((res.body.zones as { id: string }[]).map(z => z.id)).toEqual([ids.zoneA1])
    else expect(res.body).toMatchObject({ code: errorCodes[status] })
  })

  it.each<[Actor, number]>([
    ['ownerA', 201],
    ['staffA1', 403],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
  ])('POST /delivery-zones %s → %i', async (actor, status) => {
    const res = await call('POST', `/api/stores/${ids.storeA1}/delivery-zones`, tokens[actor], { name: `Khu ${actor}`, feeVnd: 12000 })
    expect(res.status).toBe(status)
    if (status !== 201) expect(res.body).toMatchObject({ code: errorCodes[status] })
  })

  it.each<[Actor, number]>([
    ['ownerA', 200],
    ['staffA1', 403],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
  ])('PATCH /delivery-zones/:id %s → %i', async (actor, status) => {
    const res = await call('PATCH', `/api/stores/${ids.storeA1}/delivery-zones/${ids.zoneA1}`, tokens[actor], { feeVnd: 18000 })
    expect(res.status).toBe(status)
    if (status !== 200) expect(res.body).toMatchObject({ code: errorCodes[status] })
  })

  it('a zone of another store is 404 and a negative fee is 400', async () => {
    expect(await call('PATCH', `/api/stores/${ids.storeA2}/delivery-zones/${ids.zoneA1}`, tokens.ownerA, { feeVnd: 1 })).toMatchObject({ status: 404 })
    expect(await call('PATCH', `/api/stores/${ids.storeA1}/delivery-zones/${ids.zoneA1}`, tokens.ownerA, { feeVnd: -1 })).toMatchObject({ status: 400 })
  })
})
```

Lưu ý: `GET /delivery-zones` kỳ vọng đúng một zone (`zoneA1`), nên trong khối này `it.each` của GET phải khai báo trước `it.each` của POST (đúng như code ở trên).

- [ ] **Step 7: Chạy test để xác nhận đạt**

Run:

```bash
npx vitest run --project unit tests/unit/shared/fulfillment-schemas.test.ts
npm run test:integration -- tests/integration/catalog-fulfillment.test.ts
npm run test:api -- tests/api/tenant-isolation.test.ts
```

Expected: PASS (gồm test race: đúng 1 request thành công).

- [ ] **Step 8: Commit**

```bash
git add shared/schemas/fulfillment.ts server/repositories/catalog.ts server/services/catalog server/api/stores tests
git commit -m "feat(catalog): add fulfillment modes and delivery zones API

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 11: Bàn và QR (`tables`) — token một lần, regenerate, thu hồi

**Files:**
- Create: `shared/schemas/tables.ts`, `server/services/catalog/tables.ts`, `server/api/stores/[storeId]/tables/index.get.ts`, `server/api/stores/[storeId]/tables/index.post.ts`, `server/api/stores/[storeId]/tables/[tableId]/index.patch.ts`, `server/api/stores/[storeId]/tables/[tableId]/regenerate.post.ts`
- Modify: `tests/api/tenant-isolation.test.ts`
- Test: `tests/unit/server/tables.test.ts`, `tests/integration/catalog-tables.test.ts`

**Interfaces:**
- Consumes: `generateToken`, `hashToken` (Task 1), `storeTables`, `stores`, `TableDTO`, `TableWithQr` (Task 3), `isUniqueViolation` (PR1), `findForbiddenKeys` (Task 3).
- Produces:
  - `createTableInputSchema` (`code?`, `displayName?`), `updateTableInputSchema` (`displayName?`, `active?`) + kiểu `CreateTableInput`, `UpdateTableInput`.
  - `nextTableCode(existing: string[]): string` (số nguyên lớn nhất + 1, đệm 2 chữ số: `'01'`, `'08'`, `'100'`).
  - `buildTableQrUrl(baseUrl: string, slug: string, token: string): string` → `${base}/s/${slug}?t=${token}`.
  - `listTables(db: DbOrTx, scope: CatalogScope): Promise<TableDTO[]>` (không bao giờ có token/hash).
  - `createTable(db: Db, ctx: StoreContext, input: CreateTableInput, baseUrl: string): Promise<TableWithQr>` — `qrUrl` chỉ trả ở đây; mã trùng khi nhập tay → `VALIDATION_FAILED`; mã tự sinh được khoá bằng advisory lock nên tạo đồng thời không trùng.
  - `regenerateTable(db: DbOrTx, ctx: StoreContext, tableId: string, baseUrl: string): Promise<TableWithQr>` — token cũ chết ngay; bàn được kích hoạt lại (`active = true`).
  - `updateTable(db: DbOrTx, ctx: StoreContext, tableId: string, patch: UpdateTableInput): Promise<TableDTO>` (`active=false` để thu hồi).
  - `resolveActiveTable(db: DbOrTx, storeId: string, token: string): Promise<{ id: string, code: string, displayName: string } | null>` — **PR3 `createOrder` dùng hàm này** để xác thực `tableToken`.
  - Route: `GET /api/stores/:id/tables → { tables }` (staff), `POST` → 201 `TableWithQr` (owner), `PATCH …/tables/:tableId` → `TableDTO`, `POST …/tables/:tableId/regenerate` → `TableWithQr` (owner).

- [ ] **Step 1: Viết unit test thất bại**

`tests/unit/server/tables.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createTableInputSchema, updateTableInputSchema } from '#shared/schemas/tables'
import { buildTableQrUrl, nextTableCode } from '../../../server/services/catalog/tables'

describe('nextTableCode', () => {
  it.each([
    [[], '01'],
    [['01', '02'], '03'],
    [['A1', '07'], '08'],
    [['99'], '100'],
    [['abc', 'T-1'], '01'],
  ])('%j → %s', (existing, expected) => {
    expect(nextTableCode(existing)).toBe(expected)
  })
})

describe('buildTableQrUrl', () => {
  it('joins base, slug and token without double slashes', () => {
    expect(buildTableQrUrl('https://zeno.vn/', 'tra-sua-may', 'abc_DEF-123')).toBe('https://zeno.vn/s/tra-sua-may?t=abc_DEF-123')
    expect(buildTableQrUrl('http://localhost:3000', 'a', 't')).toBe('http://localhost:3000/s/a?t=t')
  })
})

describe('table schemas', () => {
  it('accepts an empty create body (auto code) and restricts manual codes', () => {
    expect(createTableInputSchema.parse({})).toEqual({})
    expect(createTableInputSchema.parse({ code: ' A1 ', displayName: 'Bàn cửa sổ' })).toEqual({ code: 'A1', displayName: 'Bàn cửa sổ' })
    for (const code of ['', 'a b', 'bàn', 'x'.repeat(21), '../1']) {
      expect(createTableInputSchema.safeParse({ code }).success).toBe(false)
    }
  })

  it('update needs a change', () => {
    expect(updateTableInputSchema.safeParse({}).success).toBe(false)
    expect(updateTableInputSchema.safeParse({ active: false }).success).toBe(true)
  })
})
```

- [ ] **Step 2: Viết integration test thất bại**

`tests/integration/catalog-tables.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { StoreContext } from '../../server/auth/guards'
import { closeDb, getDb } from '../../server/db/client'
import { createTable, listTables, regenerateTable, resolveActiveTable, updateTable } from '../../server/services/catalog/tables'
import { resetDb } from '../support/db'
import { createStore, createTable as seedTable, createTenant } from '../support/fixtures'

const BASE = 'https://zeno.test'

const ctxOf = (t: { owner: { userId: string }, org: { id: string } }, store: { id: string }): StoreContext => ({
  userId: t.owner.userId,
  orgId: t.org.id,
  storeId: store.id,
  role: 'OWNER',
})

const tokenOf = (qrUrl: string) => new URL(qrUrl).searchParams.get('t')!

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('createTable', () => {
  it('auto-numbers tables and returns the qr url exactly once', async () => {
    const t = await createTenant('tb')
    const first = await createTable(getDb(), ctxOf(t, t.store), {}, BASE)
    const second = await createTable(getDb(), ctxOf(t, t.store), {}, BASE)
    expect([first.code, first.displayName]).toEqual(['01', 'Bàn 01'])
    expect(second.code).toBe('02')
    expect(first.qrUrl).toBe(`${BASE}/s/${t.store.slug}?t=${tokenOf(first.qrUrl)}`)
    expect(tokenOf(first.qrUrl)).toMatch(/^[A-Za-z0-9_-]{43}$/)

    const listed = await listTables(getDb(), ctxOf(t, t.store))
    expect(listed.map(x => x.code)).toEqual(['01', '02'])
    expect(JSON.stringify(listed)).not.toContain(tokenOf(first.qrUrl))
    expect(Object.keys(listed[0]!).sort()).toEqual(['active', 'code', 'displayName', 'id'])
  })

  it('accepts a manual code and display name, and rejects a duplicate code', async () => {
    const t = await createTenant('man')
    const table = await createTable(getDb(), ctxOf(t, t.store), { code: 'A1', displayName: 'Bàn cửa sổ' }, BASE)
    expect([table.code, table.displayName]).toEqual(['A1', 'Bàn cửa sổ'])
    await expect(createTable(getDb(), ctxOf(t, t.store), { code: 'A1' }, BASE)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('allows the same code in two stores', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    await createTable(getDb(), ctxOf(a, a.store), { code: '05' }, BASE)
    await expect(createTable(getDb(), ctxOf(b, b.store), { code: '05' }, BASE)).resolves.toMatchObject({ code: '05' })
  })

  it('concurrent auto-creation yields distinct codes', async () => {
    const t = await createTenant('par')
    const created = await Promise.all(Array.from({ length: 5 }, () => createTable(getDb(), ctxOf(t, t.store), {}, BASE)))
    expect(created.map(x => x.code).sort()).toEqual(['01', '02', '03', '04', '05'])
  })
})

describe('resolveActiveTable', () => {
  it('resolves the token of an active table of that store only', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const created = await createTable(getDb(), ctxOf(a, a.store), {}, BASE)
    const token = tokenOf(created.qrUrl)
    expect(await resolveActiveTable(getDb(), a.store.id, token)).toEqual({ id: created.id, code: '01', displayName: 'Bàn 01' })
    expect(await resolveActiveTable(getDb(), b.store.id, token)).toBeNull()
  })

  it.each(['', 'garbage', 'a'.repeat(500)])('returns null for %j', async (token) => {
    const t = await createTenant('bad')
    await createTable(getDb(), ctxOf(t, t.store), {}, BASE)
    expect(await resolveActiveTable(getDb(), t.store.id, token)).toBeNull()
  })
})

describe('regenerateTable and revoke', () => {
  it('kills the old token immediately and activates the new one', async () => {
    const t = await createTenant('regen')
    const created = await createTable(getDb(), ctxOf(t, t.store), {}, BASE)
    const oldToken = tokenOf(created.qrUrl)
    const renewed = await regenerateTable(getDb(), ctxOf(t, t.store), created.id, BASE)
    const newToken = tokenOf(renewed.qrUrl)

    expect(newToken).not.toBe(oldToken)
    expect(await resolveActiveTable(getDb(), t.store.id, oldToken)).toBeNull()
    expect(await resolveActiveTable(getDb(), t.store.id, newToken)).toMatchObject({ id: created.id })
  })

  it('revoking (active=false) stops the token; regenerating re-activates the table', async () => {
    const t = await createTenant('revoke')
    const created = await createTable(getDb(), ctxOf(t, t.store), {}, BASE)
    const token = tokenOf(created.qrUrl)
    expect(await updateTable(getDb(), ctxOf(t, t.store), created.id, { active: false })).toMatchObject({ active: false })
    expect(await resolveActiveTable(getDb(), t.store.id, token)).toBeNull()

    const renewed = await regenerateTable(getDb(), ctxOf(t, t.store), created.id, BASE)
    expect(renewed.active).toBe(true)
    expect(await resolveActiveTable(getDb(), t.store.id, tokenOf(renewed.qrUrl))).not.toBeNull()
  })

  it('cannot touch a table of another store or org (NOT_FOUND)', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const a2 = await createStore(a.org.id, 'a2')
    const theirs = await seedTable(b.store, '01')
    const sibling = await seedTable(a2, '01')
    for (const id of [theirs.table.id, sibling.table.id]) {
      await expect(updateTable(getDb(), ctxOf(a, a.store), id, { active: false })).rejects.toMatchObject({ code: 'NOT_FOUND' })
      await expect(regenerateTable(getDb(), ctxOf(a, a.store), id, BASE)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    }
    expect(await resolveActiveTable(getDb(), b.store.id, theirs.token)).not.toBeNull()
  })
})
```

- [ ] **Step 3: Chạy test để xác nhận thất bại**

Run: `npx vitest run --project unit tests/unit/server/tables.test.ts && npm run test:integration -- tests/integration/catalog-tables.test.ts`
Expected: FAIL — thiếu `#shared/schemas/tables` và `server/services/catalog/tables`.

- [ ] **Step 4: Viết schema và service**

`shared/schemas/tables.ts`:

```ts
import { z } from 'zod'
import { hasChange, nameField, NO_CHANGE } from './common'

export const createTableInputSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Không được để trống')
    .max(20, 'Tối đa 20 ký tự')
    .regex(/^[A-Za-z0-9-]+$/, 'Mã bàn chỉ gồm chữ không dấu, số và dấu gạch ngang')
    .optional(),
  displayName: nameField(40).optional(),
})
export type CreateTableInput = z.output<typeof createTableInputSchema>

export const updateTableInputSchema = z
  .object({ displayName: nameField(40).optional(), active: z.boolean().optional() })
  .refine(hasChange, NO_CHANGE)
export type UpdateTableInput = z.output<typeof updateTableInputSchema>
```

`server/services/catalog/tables.ts`:

```ts
import { and, asc, eq, sql } from 'drizzle-orm'
import type { CreateTableInput, UpdateTableInput } from '#shared/schemas/tables'
import type { TableDTO, TableWithQr } from '#shared/types/catalog'
import type { StoreContext } from '../../auth/guards'
import type { Db, DbOrTx } from '../../db/client'
import { isUniqueViolation } from '../../db/errors'
import { storeTables, stores } from '../../db/schema'
import { inStore, type CatalogScope } from '../../repositories/catalog'
import { AppError } from '../../utils/errors'
import { generateToken, hashToken } from '../../utils/tokens'

export interface ResolvedTable {
  id: string
  code: string
  displayName: string
}

const notFound = () => new AppError('NOT_FOUND', 'Không tìm thấy')
const MAX_TOKEN_LENGTH = 200

export function nextTableCode(existing: string[]): string {
  const numeric = existing.filter(code => /^\d+$/.test(code)).map(Number)
  const next = numeric.length === 0 ? 1 : Math.max(...numeric) + 1
  return String(next).padStart(2, '0')
}

export function buildTableQrUrl(baseUrl: string, slug: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/s/${slug}?t=${token}`
}

function toDTO(row: typeof storeTables.$inferSelect): TableDTO {
  return { id: row.id, code: row.code, displayName: row.displayName, active: row.active }
}

async function storeSlug(db: DbOrTx, ctx: StoreContext): Promise<string> {
  const [row] = await db.select({ slug: stores.slug }).from(stores).where(and(eq(stores.id, ctx.storeId), eq(stores.orgId, ctx.orgId))).limit(1)
  if (!row) throw notFound()
  return row.slug
}

export async function listTables(db: DbOrTx, scope: CatalogScope): Promise<TableDTO[]> {
  const rows = await db
    .select()
    .from(storeTables)
    .where(inStore(storeTables, scope))
    .orderBy(asc(storeTables.createdAt), asc(storeTables.code))
  return rows.map(toDTO)
}

export async function createTable(db: Db, ctx: StoreContext, input: CreateTableInput, baseUrl: string): Promise<TableWithQr> {
  const slug = await storeSlug(db, ctx)
  const token = generateToken()
  try {
    const row = await db.transaction(async (tx) => {
      // Serialises auto-numbering per store so concurrent "add table" taps get distinct codes.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`tables:${ctx.storeId}`}))`)
      const code = input.code ?? nextTableCode((await tx.select({ code: storeTables.code }).from(storeTables).where(inStore(storeTables, ctx))).map(r => r.code))
      const [created] = await tx
        .insert(storeTables)
        .values({
          orgId: ctx.orgId,
          storeId: ctx.storeId,
          code,
          displayName: input.displayName ?? `Bàn ${code}`,
          tokenHash: hashToken(token),
        })
        .returning()
      return created!
    })
    return { ...toDTO(row), qrUrl: buildTableQrUrl(baseUrl, slug, token) }
  }
  catch (err) {
    if (isUniqueViolation(err, 'store_tables_store_code_uq')) {
      throw new AppError('VALIDATION_FAILED', 'Mã bàn đã tồn tại', [{ path: 'code', message: 'Mã bàn đã tồn tại' }])
    }
    throw err
  }
}

export async function regenerateTable(db: DbOrTx, ctx: StoreContext, tableId: string, baseUrl: string): Promise<TableWithQr> {
  const slug = await storeSlug(db, ctx)
  const token = generateToken()
  const [row] = await db
    .update(storeTables)
    .set({ tokenHash: hashToken(token), active: true, updatedAt: new Date() })
    .where(and(eq(storeTables.id, tableId), inStore(storeTables, ctx)))
    .returning()
  if (!row) throw notFound()
  return { ...toDTO(row), qrUrl: buildTableQrUrl(baseUrl, slug, token) }
}

export async function updateTable(db: DbOrTx, ctx: StoreContext, tableId: string, patch: UpdateTableInput): Promise<TableDTO> {
  const [row] = await db
    .update(storeTables)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(storeTables.id, tableId), inStore(storeTables, ctx)))
    .returning()
  if (!row) throw notFound()
  return toDTO(row)
}

export async function resolveActiveTable(db: DbOrTx, storeId: string, token: string): Promise<ResolvedTable | null> {
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null
  const [row] = await db
    .select({ id: storeTables.id, code: storeTables.code, displayName: storeTables.displayName })
    .from(storeTables)
    .where(and(eq(storeTables.storeId, storeId), eq(storeTables.tokenHash, hashToken(token)), eq(storeTables.active, true)))
    .limit(1)
  return row ?? null
}
```

- [ ] **Step 5: Viết route**

`server/api/stores/[storeId]/tables/index.get.ts`:

```ts
import { getRouterParam } from 'h3'
import { requireStoreStaff } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { listTables } from '../../../../services/catalog/tables'
import { defineApiHandler } from '../../../../utils/api-handler'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreStaff(event, getRouterParam(event, 'storeId'))
  return { tables: await listTables(getDb(), ctx) }
})
```

`server/api/stores/[storeId]/tables/index.post.ts`:

```ts
import { getRouterParam, setResponseStatus } from 'h3'
import { useRuntimeConfig } from '#imports'
import { createTableInputSchema } from '#shared/schemas/tables'
import { requireStoreOwner } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { createTable } from '../../../../services/catalog/tables'
import { defineApiHandler } from '../../../../utils/api-handler'
import { parseBody } from '../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const input = await parseBody(event, createTableInputSchema)
  const table = await createTable(getDb(), ctx, input, useRuntimeConfig(event).public.appBaseUrl)
  setResponseStatus(event, 201)
  return table
})
```

`server/api/stores/[storeId]/tables/[tableId]/index.patch.ts`:

```ts
import { getRouterParam } from 'h3'
import { updateTableInputSchema } from '#shared/schemas/tables'
import { requireStoreOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { updateTable } from '../../../../../services/catalog/tables'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { requireUuidParam } from '../../../../../utils/ids'
import { parseBody } from '../../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const tableId = requireUuidParam(event, 'tableId')
  const patch = await parseBody(event, updateTableInputSchema)
  return updateTable(getDb(), ctx, tableId, patch)
})
```

`server/api/stores/[storeId]/tables/[tableId]/regenerate.post.ts`:

```ts
import { getRouterParam } from 'h3'
import { useRuntimeConfig } from '#imports'
import { requireStoreOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { regenerateTable } from '../../../../../services/catalog/tables'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { requireUuidParam } from '../../../../../utils/ids'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const tableId = requireUuidParam(event, 'tableId')
  return regenerateTable(getDb(), ctx, tableId, useRuntimeConfig(event).public.appBaseUrl)
})
```

- [ ] **Step 6: Thêm hàng ma trận tenant**

Thêm vào **cuối** `tests/api/tenant-isolation.test.ts`:

```ts
describe('tables', () => {
  it.each<[Actor, number]>([
    ['ownerA', 200],
    ['staffA1', 200],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
  ])('GET /tables %s → %i', async (actor, status) => {
    const res = await call('GET', `/api/stores/${ids.storeA1}/tables`, tokens[actor])
    expect(res.status).toBe(status)
    if (status === 200) {
      expect(JSON.stringify(res.body)).not.toMatch(/tokenHash|token_hash|qrUrl/)
      expect(Object.keys(res.body.tables[0]).sort()).toEqual(['active', 'code', 'displayName', 'id'])
    }
    else {
      expect(res.body).toMatchObject({ code: errorCodes[status] })
    }
  })

  it.each<[Actor, number]>([
    ['ownerA', 201],
    ['staffA1', 403],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
  ])('POST /tables %s → %i', async (actor, status) => {
    const res = await call('POST', `/api/stores/${ids.storeA1}/tables`, tokens[actor], {})
    expect(res.status).toBe(status)
    if (status === 201) expect(res.body.qrUrl).toContain(`/s/${ids.storeA1Slug}?t=`)
    else expect(res.body).toMatchObject({ code: errorCodes[status] })
  })

  it.each<[Actor, number]>([
    ['staffA1', 403],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
    ['ownerA', 200],
  ])('PATCH /tables/:id %s → %i', async (actor, status) => {
    const res = await call('PATCH', `/api/stores/${ids.storeA1}/tables/${ids.tableA1}`, tokens[actor], { active: true })
    expect(res.status).toBe(status)
    if (status !== 200) expect(res.body).toMatchObject({ code: errorCodes[status] })
  })

  it.each<[Actor, number]>([
    ['staffA1', 403],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
    ['ownerA', 200],
  ])('POST /tables/:id/regenerate %s → %i', async (actor, status) => {
    const res = await call('POST', `/api/stores/${ids.storeA1}/tables/${ids.tableA1}/regenerate`, tokens[actor])
    expect(res.status).toBe(status)
    if (status === 200) expect(Object.keys(res.body).sort()).toEqual(['active', 'code', 'displayName', 'id', 'qrUrl'])
    else expect(res.body).toMatchObject({ code: errorCodes[status] })
  })

  it('a table of another store is 404 for update and regenerate', async () => {
    expect(await call('PATCH', `/api/stores/${ids.storeA2}/tables/${ids.tableA1}`, tokens.ownerA, { active: false })).toMatchObject({ status: 404 })
    expect(await call('POST', `/api/stores/${ids.storeA2}/tables/${ids.tableA1}/regenerate`, tokens.ownerA)).toMatchObject({ status: 404 })
    expect(await call('POST', `/api/stores/${ids.storeB}/tables/${ids.tableA1}/regenerate`, tokens.ownerB)).toMatchObject({ status: 404 })
  })

  it('rejects a duplicate manual code with 400', async () => {
    const first = await call('POST', `/api/stores/${ids.storeA1}/tables`, tokens.ownerA, { code: 'VIP' })
    expect(first.status).toBe(201)
    expect(await call('POST', `/api/stores/${ids.storeA1}/tables`, tokens.ownerA, { code: 'VIP' })).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
  })
})
```

- [ ] **Step 7: Chạy test để xác nhận đạt**

Run:

```bash
npx vitest run --project unit tests/unit/server/tables.test.ts
npm run test:integration -- tests/integration/catalog-tables.test.ts
npm run test:api -- tests/api/tenant-isolation.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add shared/schemas/tables.ts server/services/catalog/tables.ts server/api/stores tests
git commit -m "feat(catalog): add tables with one-time QR token, regenerate and revoke

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 12: API công khai `GET /api/public/stores/:slug/fulfillment?t=`

**Files:**
- Create: `server/services/catalog/public-fulfillment.ts`, `server/api/public/stores/[slug]/fulfillment.get.ts`
- Modify: `tests/api/catalog-api.test.ts`
- Test: `tests/integration/public-fulfillment.test.ts`

**Interfaces:**
- Consumes: `findPublicStoreBySlug`, `listZoneRows`, `buildModes` (Task 3/10), `resolveActiveTable`, `regenerateTable`, `createTable` (Task 11), `PublicFulfillment` (Task 3).
- Produces:
  - `getPublicFulfillment(db: DbOrTx, slug: string, token: string | undefined): Promise<PublicFulfillment>` — `token === undefined` → `table: null, tableError: null`; token có nhưng không hợp lệ/đã thu hồi/của store khác → `table: null, tableError: 'INVALID_TABLE'`; `deliveryZones` chỉ gồm zone active và chỉ khi `deliveryEnabled`.
  - Route `GET /api/public/stores/:slug/fulfillment?t=` → `PublicFulfillment`, header `Cache-Control: no-store`; slug không hợp lệ/store `SUSPENDED` → 404. `?t=` rỗng hoặc lặp (`?t=a&t=b`) → `INVALID_TABLE`.

- [ ] **Step 1: Viết integration test thất bại**

`tests/integration/public-fulfillment.test.ts`:

```ts
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { StoreContext } from '../../server/auth/guards'
import { closeDb, getDb } from '../../server/db/client'
import { storeTables, stores } from '../../server/db/schema'
import { getPublicFulfillment } from '../../server/services/catalog/public-fulfillment'
import { createTable, regenerateTable } from '../../server/services/catalog/tables'
import { resetDb } from '../support/db'
import { createTable as seedTable, createTenant, createZone } from '../support/fixtures'
import { findForbiddenKeys } from '../support/json'

const db = () => getDb()
const ctxOf = (t: { owner: { userId: string }, org: { id: string }, store: { id: string } }): StoreContext => ({
  userId: t.owner.userId,
  orgId: t.org.id,
  storeId: t.store.id,
  role: 'OWNER',
})

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('getPublicFulfillment — store resolution', () => {
  it('NOT_FOUND for unknown or suspended stores', async () => {
    await expect(getPublicFulfillment(db(), 'khong-co', undefined)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const t = await createTenant('susp')
    await db().update(stores).set({ status: 'SUSPENDED' }).where(eq(stores.id, t.store.id))
    await expect(getPublicFulfillment(db(), t.store.slug, undefined)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('getPublicFulfillment — table token', () => {
  it('has no table and no error without a token', async () => {
    const t = await createTenant('none')
    expect(await getPublicFulfillment(db(), t.store.slug, undefined)).toMatchObject({ table: null, tableError: null })
  })

  it('resolves a valid token to the table display name only', async () => {
    const t = await createTenant('ok')
    const { token } = await seedTable(t.store, '05')
    const result = await getPublicFulfillment(db(), t.store.slug, token)
    expect(result).toMatchObject({ table: { displayName: 'Bàn 05' }, tableError: null })
    expect(Object.keys(result.table!)).toEqual(['displayName'])
  })

  it.each([['empty', ''], ['garbage', 'khong-phai-token'], ['500 chars', 'a'.repeat(500)]])('INVALID_TABLE for a %s token', async (_label, token) => {
    const t = await createTenant('bad')
    await seedTable(t.store, '05')
    expect(await getPublicFulfillment(db(), t.store.slug, token)).toMatchObject({ table: null, tableError: 'INVALID_TABLE' })
  })

  it('INVALID_TABLE for a token that belongs to another store, without revealing that table', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const theirs = await seedTable(b.store, '09', { displayName: 'Bàn bí mật' })
    const result = await getPublicFulfillment(db(), a.store.slug, theirs.token)
    expect(result).toMatchObject({ table: null, tableError: 'INVALID_TABLE' })
    expect(JSON.stringify(result)).not.toContain('Bàn bí mật')
  })

  it('INVALID_TABLE once the table is revoked', async () => {
    const t = await createTenant('rev')
    const { table, token } = await seedTable(t.store, '01')
    await db().update(storeTables).set({ active: false }).where(eq(storeTables.id, table.id))
    expect(await getPublicFulfillment(db(), t.store.slug, token)).toMatchObject({ tableError: 'INVALID_TABLE' })
  })

  it('INVALID_TABLE for the old token after regenerate, valid for the new one', async () => {
    const t = await createTenant('regen')
    const created = await createTable(db(), ctxOf(t), {}, 'https://zeno.test')
    const oldToken = new URL(created.qrUrl).searchParams.get('t')!
    const renewed = await regenerateTable(db(), ctxOf(t), created.id, 'https://zeno.test')
    const newToken = new URL(renewed.qrUrl).searchParams.get('t')!

    expect(await getPublicFulfillment(db(), t.store.slug, oldToken)).toMatchObject({ table: null, tableError: 'INVALID_TABLE' })
    expect(await getPublicFulfillment(db(), t.store.slug, newToken)).toMatchObject({ table: { displayName: 'Bàn 01' }, tableError: null })
  })
})

describe('getPublicFulfillment — modes and zones', () => {
  it('lists only active zones, only when delivery is enabled', async () => {
    const t = await createTenant('zones')
    await createZone(t.store, { name: 'Quận 1', feeVnd: 15000, position: 0 })
    await createZone(t.store, { name: 'Ẩn', feeVnd: 1000, active: false, position: 1 })

    const off = await getPublicFulfillment(db(), t.store.slug, undefined)
    expect(off.deliveryZones).toEqual([])
    expect(off.modes.delivery).toEqual({ enabled: false, available: false })

    await db().update(stores).set({ deliveryEnabled: true }).where(eq(stores.id, t.store.id))
    const on = await getPublicFulfillment(db(), t.store.slug, undefined)
    expect(on.modes.delivery).toEqual({ enabled: true, available: true })
    expect(on.deliveryZones.map(z => [z.name, z.feeVnd])).toEqual([['Quận 1', 15000]])
    expect(Object.keys(on.deliveryZones[0]!).sort()).toEqual(['feeVnd', 'id', 'name'])
  })

  it('never leaks tenant fields', async () => {
    const t = await createTenant('leak')
    await db().update(stores).set({ deliveryEnabled: true }).where(eq(stores.id, t.store.id))
    await createZone(t.store)
    const { token } = await seedTable(t.store, '01')
    const result = await getPublicFulfillment(db(), t.store.slug, token)
    expect(findForbiddenKeys(result)).toEqual([])
    expect(JSON.stringify(result)).not.toContain(t.org.id)
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `npm run test:integration -- tests/integration/public-fulfillment.test.ts`
Expected: FAIL — thiếu `server/services/catalog/public-fulfillment`.

- [ ] **Step 3: Viết service và route**

`server/services/catalog/public-fulfillment.ts`:

```ts
import type { PublicFulfillment } from '#shared/types/catalog'
import type { DbOrTx } from '../../db/client'
import { listZoneRows } from '../../repositories/catalog'
import { findPublicStoreBySlug } from '../../repositories/public-store'
import { AppError } from '../../utils/errors'
import { buildModes } from './modes'
import { resolveActiveTable } from './tables'

export async function getPublicFulfillment(db: DbOrTx, slug: string, token: string | undefined): Promise<PublicFulfillment> {
  const store = await findPublicStoreBySlug(db, slug)
  if (!store) throw new AppError('NOT_FOUND', 'Không tìm thấy')
  const scope = { orgId: store.orgId, storeId: store.id }

  const zones = await listZoneRows(db, scope, { activeOnly: true })
  let table: PublicFulfillment['table'] = null
  let tableError: PublicFulfillment['tableError'] = null
  if (token !== undefined) {
    const resolved = await resolveActiveTable(db, store.id, token)
    if (resolved) table = { displayName: resolved.displayName }
    else tableError = 'INVALID_TABLE'
  }

  return {
    modes: buildModes(store, zones.length),
    deliveryZones: store.deliveryEnabled ? zones.map(zone => ({ id: zone.id, name: zone.name, feeVnd: zone.feeVnd })) : [],
    table,
    tableError,
  }
}
```

`server/api/public/stores/[slug]/fulfillment.get.ts`:

```ts
import { getQuery, getRouterParam, setResponseHeader } from 'h3'
import { getDb } from '../../../../db/client'
import { getPublicFulfillment } from '../../../../services/catalog/public-fulfillment'
import { defineApiHandler } from '../../../../utils/api-handler'

export default defineApiHandler(async (event) => {
  const raw = getQuery(event).t
  // A repeated ?t=a&t=b is malformed: treat it as an invalid table instead of guessing.
  const token = raw === undefined ? undefined : typeof raw === 'string' ? raw : ''
  const result = await getPublicFulfillment(getDb(), getRouterParam(event, 'slug') ?? '', token)
  setResponseHeader(event, 'cache-control', 'no-store')
  return result
})
```

- [ ] **Step 4: Thêm test API vào `tests/api/catalog-api.test.ts`**

Thêm vào **cuối file**:

```ts
describe('GET /api/public/stores/:slug/fulfillment', () => {
  const url = (query = '') => `/api/public/stores/${seed.slug}/fulfillment${query}`
  const tokenOf = (qrUrl: string) => new URL(qrUrl).searchParams.get('t')!

  it('is never cached, has no table without ?t= and leaks nothing', async () => {
    const res = await call('GET', url())
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.body).toMatchObject({ table: null, tableError: null, modes: { dineIn: true, pickup: true } })
    expect(findForbiddenKeys(res.body)).toEqual([])
    expect(JSON.stringify(res.body)).not.toContain(seed.orgId)
  })

  it('binds a valid QR to its table, and the old QR dies right after regenerate', async () => {
    const created = await call('POST', `/api/stores/${seed.storeId}/tables`, seed.ownerToken, { code: 'F1', displayName: 'Bàn 05' })
    expect(created.status).toBe(201)
    const oldToken = tokenOf(created.body.qrUrl)
    expect((await call('GET', url(`?t=${oldToken}`))).body).toMatchObject({ table: { displayName: 'Bàn 05' }, tableError: null })

    const renewed = await call('POST', `/api/stores/${seed.storeId}/tables/${created.body.id}/regenerate`, seed.ownerToken)
    expect(renewed.status).toBe(200)
    expect((await call('GET', url(`?t=${oldToken}`))).body).toMatchObject({ table: null, tableError: 'INVALID_TABLE' })
    expect((await call('GET', url(`?t=${tokenOf(renewed.body.qrUrl)}`))).body).toMatchObject({ table: { displayName: 'Bàn 05' }, tableError: null })

    await call('PATCH', `/api/stores/${seed.storeId}/tables/${created.body.id}`, seed.ownerToken, { active: false })
    expect((await call('GET', url(`?t=${tokenOf(renewed.body.qrUrl)}`))).body).toMatchObject({ tableError: 'INVALID_TABLE' })
  })

  it.each([['empty', '?t='], ['repeated', '?t=a&t=b'], ['garbage', '?t=khong-phai-qr'], ['too long', `?t=${'x'.repeat(500)}`]])(
    'reports INVALID_TABLE for a %s token',
    async (_label, query) => {
      const res = await call('GET', url(query))
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ table: null, tableError: 'INVALID_TABLE' })
    },
  )

  it('keeps delivery unavailable until an active zone exists, then lists only that zone', async () => {
    await call('PATCH', `/api/stores/${seed.storeId}/fulfillment`, seed.ownerToken, { deliveryEnabled: true })
    expect((await call('GET', url())).body.modes.delivery).toEqual({ enabled: true, available: false })
    expect((await call('GET', `/api/public/stores/${seed.slug}/menu`)).body.modes.delivery).toEqual({ enabled: true, available: false })

    const zone = await call('POST', `/api/stores/${seed.storeId}/delivery-zones`, seed.ownerToken, { name: 'Quận 1', feeVnd: 15000 })
    expect(zone.status).toBe(201)
    const res = await call('GET', url())
    expect(res.body.modes.delivery).toEqual({ enabled: true, available: true })
    expect(res.body.deliveryZones).toEqual([{ id: zone.body.id, name: 'Quận 1', feeVnd: 15000 }])
  })

  it.each([['unknown', 'khong-ton-tai'], ['500 characters', 'a'.repeat(500)]])('returns 404 for a %s slug', async (_label, slug) => {
    expect(await call('GET', `/api/public/stores/${slug}/fulfillment`)).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
  })
})
```

- [ ] **Step 5: Chạy test để xác nhận đạt**

Run:

```bash
npm run test:integration -- tests/integration/public-fulfillment.test.ts
npm run test:api -- tests/api/catalog-api.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/services/catalog/public-fulfillment.ts server/api/public tests
git commit -m "feat(catalog): add public fulfillment API with table token validation

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 13: Primitive `ZSheet` (UDrawer) và `ZTabs` (UTabs)

**Files:**
- Create: `app/components/z/Sheet.vue`, `app/components/z/Tabs.vue`
- Test: `tests/nuxt/z/sheet-tabs.test.ts`

**Interfaces:**
- Consumes: Nuxt UI `UDrawer`, `UTabs`; tokens `--zeno-*` (UI foundation).
- Produces:
  - `<ZSheet v-model:open title description? >` slot `default` (thân, cuộn được) và `footer`; bottom sheet có focus trap sẵn của `UDrawer`; không có `description` thì mô tả ẩn bằng `sr-only` (đủ a11y).
  - `<ZTabs v-model items >` với `items: { label: string, value: string, icon?: string }[]`, chỉ là thanh tab (không render nội dung), cuộn ngang khi hẹp.
  - Cập nhật quy ước UI foundation §1: `ZSheet`, `ZTabs` đã có; `pages/**` dùng chúng thay vì `UDrawer`/`UTabs` trực tiếp.

- [ ] **Step 1: Viết component test thất bại**

`tests/nuxt/z/sheet-tabs.test.ts`:

```ts
import { renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import ZSheet from '~/components/z/Sheet.vue'
import ZTabs from '~/components/z/Tabs.vue'

const items = [
  { label: 'Cửa hàng', value: 'store' },
  { label: 'Nhận món & khu vực giao', value: 'fulfillment' },
  { label: 'Bàn & QR', value: 'tables' },
]

describe('ZTabs', () => {
  it('renders every item and marks the selected one', async () => {
    await renderSuspended(ZTabs, { props: { modelValue: 'fulfillment', items } })
    expect(screen.getAllByRole('tab').map(tab => tab.textContent?.trim())).toEqual(items.map(item => item.label))
    expect(screen.getByRole('tab', { name: 'Nhận món & khu vực giao' }).getAttribute('aria-selected')).toBe('true')
  })

  it('emits the new value when another tab is activated', async () => {
    const { emitted } = await renderSuspended(ZTabs, { props: { modelValue: 'store', items } })
    await fireEvent.mouseDown(screen.getByRole('tab', { name: 'Bàn & QR' }), { button: 0 })
    expect(emitted()['update:modelValue']).toEqual([['tables']])
  })
})

describe('ZSheet', () => {
  it('shows title, description, body and footer when open', async () => {
    await renderSuspended(ZSheet, {
      props: { open: true, title: 'Sửa món', description: 'Chỉnh thông tin món' },
      slots: { default: () => h('p', 'Nội dung sheet'), footer: () => h('button', 'Lưu món') },
    })
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Sửa món')).toBeTruthy()
    expect(screen.getByText('Chỉnh thông tin món')).toBeTruthy()
    expect(screen.getByText('Nội dung sheet')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Lưu món' })).toBeTruthy()
  })

  it('renders nothing while closed', async () => {
    await renderSuspended(ZSheet, { props: { open: false, title: 'Sửa món' }, slots: { default: () => h('p', 'Nội dung sheet') } })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('Nội dung sheet')).toBeNull()
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `npx vitest run --project nuxt tests/nuxt/z/sheet-tabs.test.ts`
Expected: FAIL — không resolve được `~/components/z/Sheet.vue`.

- [ ] **Step 3: Viết `ZSheet` và `ZTabs`**

`app/components/z/Sheet.vue`:

```vue
<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })

const props = defineProps<{ title: string, description?: string }>()
const slots = defineSlots<{ default?: () => unknown, footer?: () => unknown }>()

const ui = computed(() => ({
  content: 'bg-(--zeno-surface) max-h-[92dvh] rounded-t-lg ring-1 ring-default',
  container: 'mx-auto flex min-h-0 w-full max-w-lg flex-col',
  header: 'border-b border-default px-4 pb-3 pt-2',
  title: 'text-h3 text-default',
  description: props.description ? 'mt-1 text-sm text-muted' : 'sr-only',
  body: 'min-h-0 flex-1 overflow-y-auto px-4 py-4',
  footer: 'border-t border-default px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3',
}))
</script>

<template>
  <UDrawer v-model:open="open" :title="title" :description="description ?? title" :ui="ui">
    <template #body>
      <slot />
    </template>
    <template v-if="slots.footer" #footer>
      <slot name="footer" />
    </template>
  </UDrawer>
</template>
```

`app/components/z/Tabs.vue`:

```vue
<script setup lang="ts">
const model = defineModel<string>({ required: true })

defineProps<{
  items: Array<{ label: string, value: string, icon?: string }>
}>()

const ui = {
  root: 'w-full',
  list: 'overflow-x-auto rounded-md bg-(--zeno-surface-inset) p-1 shadow-inset dark:shadow-none dark:ring-1 dark:ring-default',
  indicator: 'rounded-md bg-(--zeno-surface) shadow-raised-sm dark:shadow-none',
  trigger: 'min-h-11 shrink-0 whitespace-nowrap rounded-md px-4 text-base font-medium text-muted data-[state=active]:text-primary focus-visible:outline-2 focus-visible:outline-primary',
}
</script>

<template>
  <UTabs
    :model-value="model"
    :items="items"
    :content="false"
    variant="pill"
    :ui="ui"
    @update:model-value="model = String($event)"
  />
</template>
```

- [ ] **Step 4: Chạy test để xác nhận đạt**

Run: `npx vitest run --project nuxt tests/nuxt/z/sheet-tabs.test.ts && npm run lint -- app/components/z`
Expected: PASS. Nếu happy-dom thiếu API mà `vaul-vue` cần (ví dụ `matchMedia`), stub API đó trong chính file test bằng `vi.stubGlobal` — **không** nới assertion; sheet được kiểm chứng thật bằng E2E ở Task 15 và Task 17.

- [ ] **Step 5: Commit**

```bash
git add app/components/z/Sheet.vue app/components/z/Tabs.vue tests/nuxt/z/sheet-tabs.test.ts
git commit -m "feat(catalog): add ZSheet and ZTabs primitives

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 14: Owner `/app/menu` — thêm món nhanh (≤ 3 thao tác), bật/tắt còn hàng

**Files:**
- Create: `app/composables/useMenuAdmin.ts`, `app/pages/app/menu.vue`
- Modify: `shared/money.ts` (thêm `parseVndInput`), `app/components/z/FormField.vue` (prop `error`), `app/layouts/owner.vue` (mục nav "Thực đơn")
- Test: `tests/unit/shared/money.test.ts` (thêm), `tests/nuxt/app/use-menu-admin.test.ts`, `tests/e2e/menu-admin.spec.ts`

**Interfaces:**
- Consumes: `GET/POST /api/stores/:id/categories`, `GET/POST/PATCH /api/stores/:id/products` (Task 6–7), `groupByCategory` (Task 4), `vndSchema` (Task 6), `useApi`, `useActiveStore`, `extractApiError`, `signUpAndOnboard` (Task 5).
- Produces:
  - `parseVndInput(input: string): number | null` — `35k`→35000, `2.5k`→2500, `35.000`/`35,000`/`35 000`→35000, hậu tố `đ`/`d`/`vnd`/`vnđ` được bỏ; chữ, số âm, thập phân sai, quá lớn → `null`.
  - `useMenuAdmin(): { storeId, categories, products, status, refresh, addProduct, addCategory, patchProduct, replaceProduct }` (`status: Ref<'pending' | 'success' | 'error'>`).
  - `ZFormField` nhận thêm prop `error?: string`.
  - Route `/app/menu` (SPA, owner layout). Quick-add = **gõ tên → gõ giá → bấm "Thêm món"** (hoặc Enter), nhập xong thì xoá ô và đưa focus về "Tên món".

- [ ] **Step 1: Viết unit test thất bại cho `parseVndInput`**

Thêm vào cuối `tests/unit/shared/money.test.ts` (và thêm `parseVndInput` vào dòng import `#shared/money`):

```ts
describe('parseVndInput', () => {
  it.each([
    ['35000', 35000],
    ['35.000', 35000],
    ['35,000', 35000],
    ['1.250.000', 1250000],
    [' 35 000 ', 35000],
    ['35k', 35000],
    ['35K', 35000],
    ['2.5k', 2500],
    ['2,5k', 2500],
    ['35000đ', 35000],
    ['35.000 đ', 35000],
    ['35000 VND', 35000],
    ['35000vnđ', 35000],
    ['0', 0],
    ['035000', 35000],
  ])('%s → %i', (input, expected) => {
    expect(parseVndInput(input)).toBe(expected)
  })

  it.each(['', '   ', 'abc', '-5', '35.5', '35.50', '3.5', '1,2', '35k5', '2.50k', 'k', '1.2.3', '35.0000', '99999999999999999999'])(
    '%j → null',
    (input) => {
      expect(parseVndInput(input)).toBeNull()
    },
  )

  it('never turns 35.000 into 35', () => {
    expect(parseVndInput('35.000')).not.toBe(35)
  })
})
```

- [ ] **Step 2: Viết test thất bại cho `useMenuAdmin`**

`tests/nuxt/app/use-menu-admin.test.ts`:

```ts
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CategoryDTO, ProductDTO } from '#shared/types/catalog'

const { api } = vi.hoisted(() => ({ api: vi.fn() }))
mockNuxtImport('useApi', () => () => api)

const product = (overrides: Partial<ProductDTO> = {}): ProductDTO => ({
  id: 'p1',
  categoryId: null,
  name: 'Trà sữa',
  description: null,
  basePriceVnd: 35000,
  isAvailable: true,
  active: true,
  position: 0,
  imageUrl: null,
  optionGroups: [],
  ...overrides,
})
const category: CategoryDTO = { id: 'c1', name: 'Trà', position: 0, active: true }

beforeEach(() => {
  api.mockReset()
  useState('me').value = {
    user: { id: 'u', email: 'a@b.vn', displayName: 'A' },
    organizations: [],
    stores: [{ id: 's1', orgId: 'o1', name: 'Quán', slug: 'quan', role: 'OWNER', isAcceptingOrders: true }],
  }
  useCookie('zeno_active_store').value = 's1'
})

describe('useMenuAdmin', () => {
  it('loads categories and products for the active store', async () => {
    api.mockImplementation(async (url: string) => (url.endsWith('/categories') ? { categories: [category] } : { products: [product()] }))
    const menu = useMenuAdmin()
    await vi.waitFor(() => expect(menu.status.value).toBe('success'))
    expect(api).toHaveBeenCalledWith('/api/stores/s1/categories')
    expect(api).toHaveBeenCalledWith('/api/stores/s1/products')
    expect(menu.categories.value).toEqual([category])
    expect(menu.products.value.map(p => p.name)).toEqual(['Trà sữa'])
  })

  it('moves to the error status when loading fails', async () => {
    api.mockRejectedValue(new Error('offline'))
    const menu = useMenuAdmin()
    await vi.waitFor(() => expect(menu.status.value).toBe('error'))
  })

  it('addProduct posts name, price and category and appends the created product', async () => {
    api.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (options?.method === 'POST') return product({ id: 'p2', name: 'Cà phê', basePriceVnd: 29000 })
      return url.endsWith('/categories') ? { categories: [] } : { products: [product()] }
    })
    const menu = useMenuAdmin()
    await vi.waitFor(() => expect(menu.status.value).toBe('success'))

    const created = await menu.addProduct({ name: 'Cà phê', basePriceVnd: 29000, categoryId: null })

    expect(api).toHaveBeenCalledWith('/api/stores/s1/products', { method: 'POST', body: { name: 'Cà phê', basePriceVnd: 29000, categoryId: null } })
    expect(created.id).toBe('p2')
    expect(menu.products.value.map(p => p.id)).toEqual(['p1', 'p2'])
  })

  it('patchProduct sends the patch and replaces the product in place', async () => {
    api.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (options?.method === 'PATCH') return product({ isAvailable: false })
      return url.endsWith('/categories') ? { categories: [] } : { products: [product()] }
    })
    const menu = useMenuAdmin()
    await vi.waitFor(() => expect(menu.status.value).toBe('success'))

    await menu.patchProduct('p1', { isAvailable: false })

    expect(api).toHaveBeenCalledWith('/api/stores/s1/products/p1', { method: 'PATCH', body: { isAvailable: false } })
    expect(menu.products.value[0]!.isAvailable).toBe(false)
    expect(menu.products.value).toHaveLength(1)
  })
})
```

- [ ] **Step 3: Viết E2E thất bại**

`tests/e2e/menu-admin.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { expectNoHorizontalOverflow } from './support/layout'
import { signUpAndOnboard } from './support/owner'

test('owner adds products in three interactions, rejects bad prices and toggles availability', async ({ page }, testInfo) => {
  const { slug } = await signUpAndOnboard(page, testInfo, 'Quán Thực Đơn')

  await page.getByRole('link', { name: 'Thực đơn', exact: true }).click()
  await expect(page).toHaveURL(/\/app\/menu$/)
  await expect(page.getByText('Chưa có món nào')).toBeVisible()

  // Three interactions: type the name, type the price, tap "Thêm món".
  await page.getByLabel('Tên món').fill('Trà sữa trân châu')
  await page.getByLabel('Giá (đ)').fill('35k')
  await page.getByRole('button', { name: 'Thêm món' }).click()

  const row = page.getByRole('listitem').filter({ hasText: 'Trà sữa trân châu' })
  await expect(row.getByText('35.000đ')).toBeVisible()
  await expect(page.getByLabel('Tên món')).toHaveValue('')
  await expect(page.getByLabel('Tên món')).toBeFocused()

  // A bad price never creates a product; a dotted price keeps its thousands.
  await page.getByLabel('Tên món').fill('Món lỗi')
  await page.getByLabel('Giá (đ)').fill('abc')
  await page.getByRole('button', { name: 'Thêm món' }).click()
  await expect(page.getByText('Nhập giá hợp lệ')).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'Món lỗi' })).toHaveCount(0)
  await page.getByLabel('Giá (đ)').fill('42.000')
  await page.getByRole('button', { name: 'Thêm món' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'Món lỗi' }).getByText('42.000đ')).toBeVisible()

  // Double tap creates a single product.
  await page.getByLabel('Tên món').fill('Cà phê muối')
  await page.getByLabel('Giá (đ)').fill('25000')
  await page.getByRole('button', { name: 'Thêm món' }).dblclick()
  await expect(page.getByRole('listitem').filter({ hasText: 'Cà phê muối' })).toHaveCount(1)
  await page.reload()
  await expect(page.getByRole('listitem').filter({ hasText: 'Cà phê muối' })).toHaveCount(1)

  // Availability persists and shows on the customer page.
  const soldOut = page.getByRole('listitem').filter({ hasText: 'Trà sữa trân châu' })
  await soldOut.getByRole('switch', { name: 'Còn hàng' }).click()
  await expect(soldOut.getByRole('switch', { name: 'Còn hàng' })).not.toBeChecked()
  await page.reload()
  await expect(page.getByRole('listitem').filter({ hasText: 'Trà sữa trân châu' }).getByRole('switch', { name: 'Còn hàng' })).not.toBeChecked()
  await expectNoHorizontalOverflow(page)

  await page.goto(`/s/${slug}`)
  await expect(page.getByRole('listitem').filter({ hasText: 'Trà sữa trân châu' }).getByText('Hết hàng')).toBeVisible()
})

test('owner creates a category and files a product under it', async ({ page }, testInfo) => {
  const { slug } = await signUpAndOnboard(page, testInfo, 'Quán Danh Mục')
  await page.goto('/app/menu')
  await page.getByLabel('Tên danh mục').fill('Trà sữa')
  await page.getByRole('button', { name: 'Thêm danh mục' }).click()
  await page.getByLabel('Danh mục của món').click()
  await page.getByRole('option', { name: 'Trà sữa' }).click()
  await page.getByLabel('Tên món').fill('Trà sữa matcha')
  await page.getByLabel('Giá (đ)').fill('39k')
  await page.getByRole('button', { name: 'Thêm món' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Trà sữa' })).toBeVisible()

  await page.goto(`/s/${slug}`)
  await expect(page.getByRole('heading', { level: 2, name: 'Trà sữa' })).toBeVisible()
  await expect(page.getByText('39.000đ')).toBeVisible()
})
```

- [ ] **Step 4: Chạy test để xác nhận thất bại**

Run: `npx vitest run --project unit tests/unit/shared/money.test.ts && npx vitest run --project nuxt tests/nuxt/app/use-menu-admin.test.ts`
Expected: FAIL — `parseVndInput` chưa tồn tại; `useMenuAdmin` chưa tồn tại.

- [ ] **Step 5: Thêm `parseVndInput` và prop `error` của `ZFormField`**

Thêm vào cuối `shared/money.ts`:

```ts
/**
 * Reads a price typed by a shop owner. `35k` = 35.000, `35.000` / `35,000` / `35 000` = 35000
 * (the separator is always a thousands separator). Anything ambiguous or invalid is null.
 */
export function parseVndInput(input: string): number | null {
  const text = input.toLowerCase().replace(/\s+/g, '').replace(/(vnđ|vnd|đ|d)$/u, '')
  let value: number
  const thousands = /^(\d+)(?:[.,](\d))?k$/.exec(text)
  if (thousands) value = Number(thousands[1]) * 1000 + Number(thousands[2] ?? 0) * 100
  else if (/^\d+$/.test(text)) value = Number(text)
  else if (/^\d{1,3}(?:[.,]\d{3})+$/.test(text)) value = Number(text.replace(/[.,]/g, ''))
  else return null
  return Number.isSafeInteger(value) ? value : null
}
```

`app/components/z/FormField.vue`: trong `defineProps` thêm `error?: string` và truyền xuống `UFormField`:

```vue
defineProps<{
  label?: string
  name?: string
  hint?: string
  help?: string
  description?: string
  required?: boolean
  error?: string
}>()
```

và đổi thẻ mở thành `<UFormField :label="label" :name="name" :hint="hint" :help="help" :description="description" :required="required" :error="error || undefined" :ui="ui">`.

- [ ] **Step 6: Viết composable**

`app/composables/useMenuAdmin.ts`:

```ts
import type { CategoryDTO, ProductDTO } from '#shared/types/catalog'

export function useMenuAdmin() {
  const api = useApi()
  const { activeStore } = useActiveStore()

  const categories = ref<CategoryDTO[]>([])
  const products = ref<ProductDTO[]>([])
  const status = ref<'pending' | 'success' | 'error'>('pending')
  const storeId = computed(() => activeStore.value?.id)

  async function refresh() {
    const id = storeId.value
    if (!id) return
    status.value = 'pending'
    try {
      const [categoryResult, productResult] = await Promise.all([
        api<{ categories: CategoryDTO[] }>(`/api/stores/${id}/categories`),
        api<{ products: ProductDTO[] }>(`/api/stores/${id}/products`),
      ])
      categories.value = categoryResult.categories
      products.value = productResult.products
      status.value = 'success'
    }
    catch {
      status.value = 'error'
    }
  }

  function replaceProduct(product: ProductDTO) {
    products.value = products.value.map(item => (item.id === product.id ? product : item))
  }

  async function addProduct(input: { name: string, basePriceVnd: number, categoryId: string | null }): Promise<ProductDTO> {
    const created = await api<ProductDTO>(`/api/stores/${storeId.value}/products`, { method: 'POST', body: input })
    products.value = [...products.value, created]
    return created
  }

  async function addCategory(name: string): Promise<CategoryDTO> {
    const created = await api<CategoryDTO>(`/api/stores/${storeId.value}/categories`, { method: 'POST', body: { name } })
    categories.value = [...categories.value, created]
    return created
  }

  async function patchProduct(productId: string, patch: Record<string, unknown>): Promise<ProductDTO> {
    const updated = await api<ProductDTO>(`/api/stores/${storeId.value}/products/${productId}`, { method: 'PATCH', body: patch })
    replaceProduct(updated)
    return updated
  }

  watch(storeId, refresh, { immediate: true })

  return { storeId, categories, products, status, refresh, addProduct, addCategory, patchProduct, replaceProduct }
}
```

- [ ] **Step 7: Viết trang `/app/menu`**

`app/pages/app/menu.vue`:

```vue
<script setup lang="ts">
import { groupByCategory } from '#shared/menu-groups'
import { formatVnd, parseVndInput } from '#shared/money'
import { vndSchema } from '#shared/schemas/common'
import type { ProductDTO } from '#shared/types/catalog'

definePageMeta({ layout: 'owner', middleware: ['auth', 'has-store'] })
useHead({ title: 'Thực đơn' })

const NO_CATEGORY = '__none'

const toast = useToast()
const { activeStore } = useActiveStore()
const { categories, products, status, refresh, addProduct, addCategory, patchProduct, replaceProduct } = useMenuAdmin()

const isOwner = computed(() => activeStore.value?.role === 'OWNER')
const form = reactive({ name: '', price: '', categoryId: NO_CATEGORY })
const errors = reactive({ name: '', price: '', category: '' })
const adding = ref(false)
const categoryName = ref('')
const addingCategory = ref(false)
const nameField = ref<{ $el: HTMLElement } | null>(null)

const categoryItems = computed(() => [
  { label: 'Không phân loại', value: NO_CATEGORY },
  ...categories.value.map(category => ({ label: category.name, value: category.id })),
])
const sections = computed(() => groupByCategory(categories.value, products.value, { uncategorizedLabel: 'Chưa phân loại' }))

async function submit() {
  if (adding.value) return
  const price = parseVndInput(form.price)
  errors.name = form.name.trim() ? '' : 'Nhập tên món'
  errors.price = price !== null && vndSchema.safeParse(price).success ? '' : 'Nhập giá hợp lệ, ví dụ 35000 hoặc 35k'
  if (errors.name || errors.price || price === null) return

  adding.value = true
  try {
    const created = await addProduct({
      name: form.name.trim(),
      basePriceVnd: price,
      categoryId: form.categoryId === NO_CATEGORY ? null : form.categoryId,
    })
    toast.add({ color: 'success', title: `Đã thêm ${created.name}` })
    form.name = ''
    form.price = ''
    nameField.value?.$el.querySelector('input')?.focus()
  }
  catch (err) {
    toast.add({ color: 'error', title: extractApiError(err).message })
  }
  finally {
    adding.value = false
  }
}

async function submitCategory() {
  if (addingCategory.value) return
  const name = categoryName.value.trim()
  errors.category = name ? '' : 'Nhập tên danh mục'
  if (!name) return
  addingCategory.value = true
  try {
    const created = await addCategory(name)
    form.categoryId = created.id
    categoryName.value = ''
    toast.add({ color: 'success', title: `Đã thêm danh mục ${created.name}` })
  }
  catch (err) {
    toast.add({ color: 'error', title: extractApiError(err).message })
  }
  finally {
    addingCategory.value = false
  }
}

async function setAvailable(product: ProductDTO, value: boolean) {
  replaceProduct({ ...product, isAvailable: value })
  try {
    await patchProduct(product.id, { isAvailable: value })
  }
  catch (err) {
    replaceProduct(product)
    toast.add({ color: 'error', title: extractApiError(err).message })
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <AppPageHeader title="Thực đơn" description="Thêm món nhanh: gõ tên, gõ giá, bấm Thêm món." />

    <ZAlert v-if="!isOwner" color="info" title="Chỉ chủ cửa hàng mới sửa được thực đơn." />

    <template v-if="isOwner">
      <ZCard title="Thêm món nhanh" padding="lg">
        <form class="flex flex-col gap-4" novalidate @submit.prevent="submit">
          <ZFormField label="Tên món" name="name" :error="errors.name">
            <ZInput ref="nameField" v-model="form.name" size="lg" placeholder="Ví dụ: Trà sữa trân châu" autocomplete="off" />
          </ZFormField>
          <ZFormField label="Giá (đ)" name="price" :error="errors.price" help="Gõ 35000, 35.000 hoặc 35k đều được.">
            <ZInput v-model="form.price" size="lg" inputmode="numeric" placeholder="35k" autocomplete="off" />
          </ZFormField>
          <ZFormField v-if="categories.length > 0" label="Danh mục của món" name="category">
            <ZSelect v-model="form.categoryId" :items="categoryItems" size="lg" aria-label="Danh mục của món" />
          </ZFormField>
          <ZButton type="submit" size="lg" block icon="i-lucide-plus" :loading="adding">
            Thêm món
          </ZButton>
        </form>
      </ZCard>

      <ZCard title="Danh mục" description="Nhóm món để khách dễ tìm. Không bắt buộc." padding="lg">
        <form class="flex flex-col gap-3 sm:flex-row sm:items-end" novalidate @submit.prevent="submitCategory">
          <ZFormField label="Tên danh mục" name="categoryName" :error="errors.category" class="flex-1">
            <ZInput v-model="categoryName" size="lg" placeholder="Ví dụ: Trà sữa" autocomplete="off" />
          </ZFormField>
          <ZButton type="submit" variant="secondary" size="lg" :loading="addingCategory">
            Thêm danh mục
          </ZButton>
        </form>
      </ZCard>
    </template>

    <div v-if="status === 'pending' && products.length === 0" class="flex flex-col gap-3" aria-busy="true" aria-label="Đang tải thực đơn">
      <USkeleton v-for="i in 3" :key="i" class="h-20 w-full rounded-md" />
    </div>

    <ZAlert v-else-if="status === 'error'" color="error" title="Không tải được thực đơn">
      <template #actions>
        <ZButton variant="secondary" size="sm" icon="i-lucide-refresh-cw" @click="refresh()">
          Thử lại
        </ZButton>
      </template>
    </ZAlert>

    <ZCard v-else-if="products.length === 0" variant="raised" padding="lg">
      <AppEmptyState icon="i-lucide-utensils-crossed" title="Chưa có món nào" description="Gõ tên và giá ở ô phía trên để thêm món đầu tiên." />
    </ZCard>

    <template v-else>
      <section v-for="section in sections" :key="section.id ?? 'none'" class="flex flex-col gap-3">
        <h2 class="text-h3 text-default">
          {{ section.name }}
        </h2>
        <ul class="flex flex-col gap-2">
          <li
            v-for="product in section.products"
            :key="product.id"
            class="flex flex-wrap items-center justify-between gap-3 rounded-md bg-(--zeno-surface) p-4 ring-1 ring-default"
          >
            <div class="flex min-w-0 items-center gap-3">
              <img v-if="product.imageUrl" :src="product.imageUrl" alt="" width="48" height="48" loading="lazy" class="size-12 shrink-0 rounded-md object-cover">
              <div class="min-w-0">
                <p class="break-words font-medium text-default">
                  {{ product.name }}
                </p>
                <p class="font-mono text-sm text-muted">
                  {{ formatVnd(product.basePriceVnd) }}
                </p>
              </div>
            </div>
            <ZSwitch
              :model-value="product.isAvailable"
              :disabled="!isOwner"
              label="Còn hàng"
              @update:model-value="setAvailable(product, $event)"
            />
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
```

- [ ] **Step 8: Thêm mục nav "Thực đơn"**

`app/layouts/owner.vue`, trong `navItems` thêm giữa hai mục hiện có (old_str: `  { label: 'Đơn hàng', to: '/app/orders', icon: 'i-lucide-receipt' },`):

```ts
  { label: 'Đơn hàng', to: '/app/orders', icon: 'i-lucide-receipt' },
  { label: 'Thực đơn', to: '/app/menu', icon: 'i-lucide-utensils-crossed' },
```

- [ ] **Step 9: Chạy test để xác nhận đạt**

Run:

```bash
npx vitest run --project unit tests/unit/shared/money.test.ts
npx vitest run --project nuxt tests/nuxt/app/use-menu-admin.test.ts tests/nuxt/z
npx playwright test tests/e2e/menu-admin.spec.ts tests/e2e/onboarding.spec.ts
npm run lint -- app shared/money.ts
```

Expected: PASS (nav 3 mục vẫn vừa 360px, `onboarding.spec.ts` không vỡ).

- [ ] **Step 10: Commit**

```bash
git add shared/money.ts app/components/z/FormField.vue app/layouts/owner.vue app/composables/useMenuAdmin.ts app/pages/app/menu.vue tests
git commit -m "feat(catalog): add owner menu page with 3-interaction quick add

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 15: Owner sửa món — nhóm option, ảnh

**Files:**
- Create: `shared/option-presets.ts`, `app/components/menu/OptionGroupEditor.vue`, `app/components/menu/ProductEditor.vue`
- Modify: `app/pages/app/menu.vue`
- Test: `tests/unit/shared/option-presets.test.ts`, thêm một test vào `tests/e2e/menu-admin.spec.ts`

**Interfaces:**
- Consumes: `ZSheet` (Task 13), `PUT …/options`, `PATCH …/products/:id`, `POST …/image` (Task 7–9), `OptionGroupDTO`, `ProductDTO`, `parseVndInput`, `vndSchema`, `MAX_PRODUCT_IMAGE_BYTES`, `PRODUCT_IMAGE_TYPES`, `useMenuAdmin().replaceProduct`.
- Produces:
  - `shared/option-presets.ts`: `GroupPreset = 'single-required' | 'single-optional' | 'multi'`, `PRESET_LABELS`, `EditableValue`, `EditableGroup`, `presetOf(group)`, `rulesOf(preset, valueCount)`, `toEditableGroups(groups: OptionGroupDTO[], makeKey: () => string): EditableGroup[]`, `buildOptionsPayload(groups: EditableGroup[]): { ok: true, groups: OptionsPayloadGroup[] } | { ok: false, error: string }`.
  - `<MenuProductEditor v-model:open :product :categories :store-id @saved />` — sửa tên/giá/mô tả/danh mục, nhóm option (3 mẫu: chọn 1 bắt buộc, chọn 1 tuỳ chọn, chọn nhiều), upload ảnh (tự lưu khi chọn file).
  - Nút "Sửa {tên món}" trên mỗi dòng ở `/app/menu`.

- [ ] **Step 1: Viết unit test thất bại cho `option-presets`**

`tests/unit/shared/option-presets.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildOptionsPayload, presetOf, rulesOf, toEditableGroups, type EditableGroup } from '#shared/option-presets'
import { replaceOptionsInputSchema } from '#shared/schemas/catalog'
import type { OptionGroupDTO } from '#shared/types/catalog'

let counter = 0
const makeKey = () => `k${++counter}`

const group = (overrides: Partial<EditableGroup> = {}): EditableGroup => ({
  key: 'g',
  name: 'Size',
  preset: 'single-required',
  values: [
    { key: 'v1', name: 'M', priceRaw: '', active: true },
    { key: 'v2', name: 'L', priceRaw: '5k', active: true },
  ],
  ...overrides,
})

describe('presets', () => {
  it('maps a group to its preset and back to rules', () => {
    expect(presetOf({ required: true, maxSelect: 1 })).toBe('single-required')
    expect(presetOf({ required: false, maxSelect: 1 })).toBe('single-optional')
    expect(presetOf({ required: false, maxSelect: 3 })).toBe('multi')
    expect(rulesOf('single-required', 3)).toEqual({ required: true, minSelect: 1, maxSelect: 1 })
    expect(rulesOf('single-optional', 3)).toEqual({ required: false, minSelect: 0, maxSelect: 1 })
    expect(rulesOf('multi', 4)).toEqual({ required: false, minSelect: 0, maxSelect: 4 })
    expect(rulesOf('multi', 1)).toEqual({ required: false, minSelect: 0, maxSelect: 2 })
  })
})

describe('toEditableGroups', () => {
  it('turns server groups into editable rows with price text', () => {
    const dto: OptionGroupDTO[] = [{
      id: 'g1', name: 'Topping', required: false, minSelect: 0, maxSelect: 2, position: 0,
      values: [{ id: 'v1', name: 'Trân châu', priceDeltaVnd: 5000, active: true, position: 0 }, { id: 'v2', name: 'Thạch', priceDeltaVnd: 0, active: false, position: 1 }],
    }]
    const [editable] = toEditableGroups(dto, makeKey)
    expect(editable).toMatchObject({ name: 'Topping', preset: 'multi' })
    expect(editable!.values.map(v => [v.name, v.priceRaw, v.active])).toEqual([['Trân châu', '5000', true], ['Thạch', '', false]])
  })
})

describe('buildOptionsPayload', () => {
  it('builds a payload the API schema accepts', () => {
    const result = buildOptionsPayload([group(), group({ name: 'Topping', preset: 'multi', values: [{ key: 'a', name: 'Trân châu', priceRaw: '5.000', active: true }, { key: 'b', name: 'Thạch', priceRaw: '3k', active: true }, { key: 'c', name: 'Pudding', priceRaw: '7k', active: true }] })])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.groups[0]).toEqual({
      name: 'Size', required: true, minSelect: 1, maxSelect: 1,
      values: [{ name: 'M', priceDeltaVnd: 0, active: true }, { name: 'L', priceDeltaVnd: 5000, active: true }],
    })
    expect(result.groups[1]).toMatchObject({ required: false, minSelect: 0, maxSelect: 3 })
    expect(replaceOptionsInputSchema.safeParse({ groups: result.groups }).success).toBe(true)
  })

  it('drops blank value rows and trims names', () => {
    const result = buildOptionsPayload([group({ name: '  Size ', values: [{ key: 'a', name: ' M ', priceRaw: '', active: true }, { key: 'b', name: '   ', priceRaw: '9k', active: true }] })])
    expect(result).toMatchObject({ ok: true, groups: [{ name: 'Size', values: [{ name: 'M', priceDeltaVnd: 0, active: true }] }] })
  })

  it('reports a missing group name, no values, a bad price and a required group with nothing active', () => {
    expect(buildOptionsPayload([group({ name: ' ' })])).toEqual({ ok: false, error: 'Nhóm option cần có tên' })
    expect(buildOptionsPayload([group({ values: [{ key: 'a', name: ' ', priceRaw: '', active: true }] })]))
      .toEqual({ ok: false, error: 'Nhóm "Size" cần ít nhất một lựa chọn' })
    expect(buildOptionsPayload([group({ values: [{ key: 'a', name: 'M', priceRaw: 'abc', active: true }] })]))
      .toEqual({ ok: false, error: 'Giá cộng thêm của "M" không hợp lệ' })
    expect(buildOptionsPayload([group({ values: [{ key: 'a', name: 'M', priceRaw: '', active: false }] })]))
      .toEqual({ ok: false, error: 'Nhóm "Size" cần ít nhất một lựa chọn đang bật' })
  })

  it('an empty editor list is a valid payload that clears every option', () => {
    expect(buildOptionsPayload([])).toEqual({ ok: true, groups: [] })
  })

  it('round-trips a server group without changing its rules', () => {
    const dto: OptionGroupDTO = {
      id: 'g', name: 'Đường', required: true, minSelect: 1, maxSelect: 1, position: 0,
      values: [{ id: 'a', name: '100%', priceDeltaVnd: 0, active: true, position: 0 }, { id: 'b', name: '50%', priceDeltaVnd: 0, active: true, position: 1 }],
    }
    const result = buildOptionsPayload(toEditableGroups([dto], makeKey))
    expect(result).toMatchObject({ ok: true, groups: [{ name: 'Đường', required: true, minSelect: 1, maxSelect: 1 }] })
  })
})
```

- [ ] **Step 2: Viết E2E thất bại**

Thêm vào cuối `tests/e2e/menu-admin.spec.ts`:

```ts
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

test('owner configures size options and an image, and the public menu reflects both', async ({ page }, testInfo) => {
  const { slug } = await signUpAndOnboard(page, testInfo, 'Quán Option')
  await page.goto('/app/menu')
  await page.getByLabel('Tên món').fill('Trà sữa')
  await page.getByLabel('Giá (đ)').fill('30k')
  await page.getByRole('button', { name: 'Thêm món' }).click()

  await page.getByRole('button', { name: 'Sửa Trà sữa' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Thêm nhóm option' }).click()
  await dialog.getByLabel('Tên nhóm').fill('Size')
  await dialog.getByLabel('Tên lựa chọn').first().fill('M')
  await dialog.getByRole('button', { name: 'Thêm lựa chọn' }).click()
  await dialog.getByLabel('Tên lựa chọn').nth(1).fill('L')
  await dialog.getByLabel('Giá cộng thêm').nth(1).fill('5k')

  await dialog.locator('input[type=file]').setInputFiles({ name: 'tra-sua.png', mimeType: 'image/png', buffer: PNG_1X1 })
  await expect(dialog.getByRole('img', { name: 'Ảnh món' })).toBeVisible()

  await dialog.getByRole('button', { name: 'Lưu món' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('listitem').filter({ hasText: 'Trà sữa' }).locator('img')).toBeVisible()

  await page.getByRole('button', { name: 'Sửa Trà sữa' }).click()
  await expect(page.getByRole('dialog').getByLabel('Tên nhóm')).toHaveValue('Size')
  await page.keyboard.press('Escape')

  const menu = await (await page.request.get(`/api/public/stores/${slug}/menu`)).json()
  const product = menu.products[0]
  expect(product.imageUrl).toMatch(/\.png$/)
  expect(product.optionGroups[0]).toMatchObject({ name: 'Size', required: true, minSelect: 1, maxSelect: 1 })
  expect(product.optionGroups[0].values.map((v: { name: string, priceDeltaVnd: number }) => [v.name, v.priceDeltaVnd])).toEqual([['M', 0], ['L', 5000]])
})

test('a text file renamed .png is rejected by the editor upload and nothing is stored', async ({ page }, testInfo) => {
  const { slug } = await signUpAndOnboard(page, testInfo, 'Quán Ảnh Giả')
  await page.goto('/app/menu')
  await page.getByLabel('Tên món').fill('Cà phê')
  await page.getByLabel('Giá (đ)').fill('25k')
  await page.getByRole('button', { name: 'Thêm món' }).click()
  await page.getByRole('button', { name: 'Sửa Cà phê' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('input[type=file]').setInputFiles({ name: 'evil.png', mimeType: 'image/png', buffer: Buffer.from('not an image') })
  await expect(page.getByText('Chỉ nhận ảnh JPG, PNG hoặc WebP')).toBeVisible()
  await expect(dialog.getByRole('img', { name: 'Ảnh món' })).toHaveCount(0)
  const menu = await (await page.request.get(`/api/public/stores/${slug}/menu`)).json()
  expect(menu.products[0].imageUrl).toBeNull()
})
```

- [ ] **Step 3: Chạy test để xác nhận thất bại**

Run: `npx vitest run --project unit tests/unit/shared/option-presets.test.ts`
Expected: FAIL — `#shared/option-presets` chưa tồn tại.

- [ ] **Step 4: Viết `shared/option-presets.ts`**

```ts
import { parseVndInput } from './money'
import { vndSchema } from './schemas/common'
import type { OptionGroupDTO } from './types/catalog'

export type GroupPreset = 'single-required' | 'single-optional' | 'multi'

export const PRESET_LABELS: Record<GroupPreset, string> = {
  'single-required': 'Chọn 1 (bắt buộc)',
  'single-optional': 'Chọn 1 (tuỳ chọn)',
  multi: 'Chọn nhiều (tuỳ chọn)',
}

export interface EditableValue {
  key: string
  name: string
  priceRaw: string
  active: boolean
}

export interface EditableGroup {
  key: string
  name: string
  preset: GroupPreset
  values: EditableValue[]
}

export interface OptionsPayloadGroup {
  name: string
  required: boolean
  minSelect: number
  maxSelect: number
  values: { name: string, priceDeltaVnd: number, active: boolean }[]
}

export function presetOf(group: { required: boolean, maxSelect: number }): GroupPreset {
  if (group.maxSelect > 1) return 'multi'
  return group.required ? 'single-required' : 'single-optional'
}

export function rulesOf(preset: GroupPreset, valueCount: number): { required: boolean, minSelect: number, maxSelect: number } {
  switch (preset) {
    case 'single-required': return { required: true, minSelect: 1, maxSelect: 1 }
    case 'single-optional': return { required: false, minSelect: 0, maxSelect: 1 }
    case 'multi': return { required: false, minSelect: 0, maxSelect: Math.max(valueCount, 2) }
  }
}

export function toEditableGroups(groups: OptionGroupDTO[], makeKey: () => string): EditableGroup[] {
  return groups.map(group => ({
    key: makeKey(),
    name: group.name,
    preset: presetOf(group),
    values: group.values.map(value => ({
      key: makeKey(),
      name: value.name,
      priceRaw: value.priceDeltaVnd > 0 ? String(value.priceDeltaVnd) : '',
      active: value.active,
    })),
  }))
}

export function buildOptionsPayload(groups: EditableGroup[]): { ok: true, groups: OptionsPayloadGroup[] } | { ok: false, error: string } {
  const payload: OptionsPayloadGroup[] = []
  for (const group of groups) {
    const name = group.name.trim()
    if (!name) return { ok: false, error: 'Nhóm option cần có tên' }

    const values: OptionsPayloadGroup['values'] = []
    for (const value of group.values) {
      const valueName = value.name.trim()
      if (!valueName) continue
      const delta = value.priceRaw.trim() === '' ? 0 : parseVndInput(value.priceRaw)
      if (delta === null || !vndSchema.safeParse(delta).success) {
        return { ok: false, error: `Giá cộng thêm của "${valueName}" không hợp lệ` }
      }
      values.push({ name: valueName, priceDeltaVnd: delta, active: value.active })
    }
    if (values.length === 0) return { ok: false, error: `Nhóm "${name}" cần ít nhất một lựa chọn` }

    const rules = rulesOf(group.preset, values.length)
    if (values.filter(value => value.active).length < rules.minSelect) {
      return { ok: false, error: `Nhóm "${name}" cần ít nhất một lựa chọn đang bật` }
    }
    payload.push({ name, ...rules, values })
  }
  return { ok: true, groups: payload }
}
```

- [ ] **Step 5: Viết `OptionGroupEditor`**

`app/components/menu/OptionGroupEditor.vue`:

```vue
<script setup lang="ts">
import { PRESET_LABELS, type EditableGroup, type GroupPreset } from '#shared/option-presets'

const group = defineModel<EditableGroup>({ required: true })
defineEmits<{ remove: [] }>()

const presetItems = (Object.keys(PRESET_LABELS) as GroupPreset[]).map(value => ({ label: PRESET_LABELS[value], value }))

function addValue() {
  group.value.values.push({ key: crypto.randomUUID(), name: '', priceRaw: '', active: true })
}

function removeValue(key: string) {
  group.value.values = group.value.values.filter(value => value.key !== key)
}
</script>

<template>
  <fieldset class="flex flex-col gap-3 rounded-md p-4 ring-1 ring-default">
    <legend class="sr-only">
      Nhóm option {{ group.name }}
    </legend>
    <div class="flex items-end gap-2">
      <ZFormField label="Tên nhóm" class="flex-1">
        <ZInput v-model="group.name" placeholder="Ví dụ: Size" autocomplete="off" />
      </ZFormField>
      <ZButton variant="ghost" square icon="i-lucide-trash-2" aria-label="Xoá nhóm option" @click="$emit('remove')" />
    </div>
    <ZFormField label="Cách chọn">
      <ZSelect v-model="group.preset" :items="presetItems" aria-label="Cách chọn" />
    </ZFormField>

    <ul class="flex flex-col gap-3">
      <li v-for="value in group.values" :key="value.key" class="flex flex-col gap-2 rounded-md bg-(--zeno-surface-inset) p-3">
        <div class="flex items-center gap-2">
          <ZInput v-model="value.name" aria-label="Tên lựa chọn" placeholder="Ví dụ: M" autocomplete="off" class="flex-1" />
          <ZInput v-model="value.priceRaw" aria-label="Giá cộng thêm" inputmode="numeric" placeholder="+0đ" autocomplete="off" class="w-28" />
          <ZButton variant="ghost" square icon="i-lucide-x" aria-label="Xoá lựa chọn" @click="removeValue(value.key)" />
        </div>
        <ZSwitch v-model="value.active" label="Đang bán" />
      </li>
    </ul>
    <ZButton variant="secondary" icon="i-lucide-plus" @click="addValue">
      Thêm lựa chọn
    </ZButton>
  </fieldset>
</template>
```

- [ ] **Step 6: Viết `ProductEditor`**

`app/components/menu/ProductEditor.vue`:

```vue
<script setup lang="ts">
import { MAX_PRODUCT_IMAGE_BYTES, PRODUCT_IMAGE_TYPES } from '#shared/catalog-limits'
import { parseVndInput } from '#shared/money'
import { buildOptionsPayload, toEditableGroups, type EditableGroup } from '#shared/option-presets'
import { vndSchema } from '#shared/schemas/common'
import type { CategoryDTO, OptionGroupDTO, ProductDTO } from '#shared/types/catalog'

const NO_CATEGORY = '__none'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ product: ProductDTO | null, categories: CategoryDTO[], storeId: string }>()
const emit = defineEmits<{ saved: [product: ProductDTO] }>()

const api = useApi()
const toast = useToast()

const draft = reactive({ name: '', price: '', description: '', categoryId: NO_CATEGORY })
const groups = ref<EditableGroup[]>([])
const imageUrl = ref<string | null>(null)
const initialOptionsJson = ref('')
const error = ref('')
const saving = ref(false)
const uploading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const categoryItems = computed(() => [
  { label: 'Không phân loại', value: NO_CATEGORY },
  ...props.categories.map(category => ({ label: category.name, value: category.id })),
])

function optionsJson(source: EditableGroup[]): string {
  const built = buildOptionsPayload(source)
  return built.ok ? JSON.stringify(built.groups) : ''
}

watch(
  [() => open.value, () => props.product?.id],
  ([isOpen]) => {
    const product = props.product
    if (!isOpen || !product) return
    draft.name = product.name
    draft.price = String(product.basePriceVnd)
    draft.description = product.description ?? ''
    draft.categoryId = product.categoryId ?? NO_CATEGORY
    groups.value = toEditableGroups(product.optionGroups, () => crypto.randomUUID())
    imageUrl.value = product.imageUrl
    initialOptionsJson.value = optionsJson(groups.value)
    error.value = ''
  },
  { immediate: true },
)

function addGroup() {
  groups.value.push({
    key: crypto.randomUUID(),
    name: '',
    preset: 'single-required',
    values: [{ key: crypto.randomUUID(), name: '', priceRaw: '', active: true }],
  })
}

function fail(message: string) {
  error.value = message
}

async function save() {
  const product = props.product
  if (!product || saving.value) return
  const price = parseVndInput(draft.price)
  if (!draft.name.trim()) return fail('Nhập tên món')
  if (price === null || !vndSchema.safeParse(price).success) return fail('Nhập giá hợp lệ, ví dụ 35000 hoặc 35k')
  const options = buildOptionsPayload(groups.value)
  if (!options.ok) return fail(options.error)

  error.value = ''
  saving.value = true
  try {
    let latest = await api<ProductDTO>(`/api/stores/${props.storeId}/products/${product.id}`, {
      method: 'PATCH',
      body: {
        name: draft.name.trim(),
        basePriceVnd: price,
        description: draft.description.trim() || null,
        categoryId: draft.categoryId === NO_CATEGORY ? null : draft.categoryId,
      },
    })
    if (JSON.stringify(options.groups) !== initialOptionsJson.value) {
      const replaced = await api<{ optionGroups: OptionGroupDTO[] }>(`/api/stores/${props.storeId}/products/${product.id}/options`, {
        method: 'PUT',
        body: { groups: options.groups },
      })
      latest = { ...latest, optionGroups: replaced.optionGroups }
    }
    emit('saved', latest)
    toast.add({ color: 'success', title: 'Đã lưu món' })
    open.value = false
  }
  catch (err) {
    error.value = extractApiError(err).message
  }
  finally {
    saving.value = false
  }
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  const product = props.product
  if (!file || !product) return
  if (!(PRODUCT_IMAGE_TYPES as readonly string[]).includes(file.type) || file.size === 0) {
    toast.add({ color: 'error', title: 'Chỉ nhận ảnh JPG, PNG hoặc WebP' })
    return
  }
  if (file.size > MAX_PRODUCT_IMAGE_BYTES) {
    toast.add({ color: 'error', title: 'Ảnh tối đa 2 MB' })
    return
  }
  // The server re-checks the file signature, so a renamed text file still fails there.
  uploading.value = true
  try {
    const form = new FormData()
    form.append('file', file)
    const result = await api<{ imageUrl: string }>(`/api/stores/${props.storeId}/products/${product.id}/image`, { method: 'POST', body: form })
    imageUrl.value = result.imageUrl
    emit('saved', { ...product, imageUrl: result.imageUrl })
  }
  catch (err) {
    toast.add({ color: 'error', title: extractApiError(err).message })
  }
  finally {
    uploading.value = false
  }
}
</script>

<template>
  <ZSheet v-model:open="open" :title="product ? `Sửa ${product.name}` : 'Sửa món'" description="Chỉnh thông tin, ảnh và các nhóm option của món.">
    <form id="product-editor" class="flex flex-col gap-4" novalidate @submit.prevent="save">
      <ZAlert v-if="error" color="error" :title="error" />

      <div class="flex items-center gap-3">
        <img v-if="imageUrl" :src="imageUrl" alt="Ảnh món" width="80" height="80" class="size-20 shrink-0 rounded-md object-cover">
        <div class="flex flex-col gap-1">
          <ZButton variant="secondary" icon="i-lucide-image-plus" :loading="uploading" @click="fileInput?.click()">
            {{ imageUrl ? 'Đổi ảnh' : 'Thêm ảnh' }}
          </ZButton>
          <p class="text-[13px] text-muted">
            JPG, PNG hoặc WebP, tối đa 2 MB.
          </p>
        </div>
        <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" class="hidden" @change="onFile">
      </div>

      <ZFormField label="Tên món">
        <ZInput v-model="draft.name" autocomplete="off" />
      </ZFormField>
      <ZFormField label="Giá (đ)" help="Gõ 35000, 35.000 hoặc 35k đều được.">
        <ZInput v-model="draft.price" inputmode="numeric" autocomplete="off" />
      </ZFormField>
      <ZFormField label="Mô tả ngắn">
        <ZInput v-model="draft.description" autocomplete="off" placeholder="Không bắt buộc" />
      </ZFormField>
      <ZFormField v-if="categories.length > 0" label="Danh mục">
        <ZSelect v-model="draft.categoryId" :items="categoryItems" aria-label="Danh mục" />
      </ZFormField>

      <section class="flex flex-col gap-3">
        <h3 class="text-h3 text-default">
          Nhóm option
        </h3>
        <MenuOptionGroupEditor
          v-for="(group, index) in groups"
          :key="group.key"
          :model-value="group"
          @update:model-value="groups[index] = $event"
          @remove="groups.splice(index, 1)"
        />
        <ZButton variant="secondary" icon="i-lucide-plus" @click="addGroup">
          Thêm nhóm option
        </ZButton>
      </section>
    </form>

    <template #footer>
      <ZButton type="submit" form="product-editor" size="lg" block :loading="saving">
        Lưu món
      </ZButton>
    </template>
  </ZSheet>
</template>
```

- [ ] **Step 7: Nối editor vào `/app/menu`**

Trong `app/pages/app/menu.vue`:

1. Thêm vào `<script setup>` (sau `const addingCategory = ref(false)`):

```ts
const editing = ref<ProductDTO | null>(null)
const editorOpen = ref(false)

function openEditor(product: ProductDTO) {
  editing.value = product
  editorOpen.value = true
}

function onSaved(product: ProductDTO) {
  replaceProduct(product)
  if (editing.value?.id === product.id) editing.value = product
}
```

2. Thay đúng khối `<ZSwitch … />` của dòng sản phẩm (old_str, thụt lề 12 khoảng trắng):

```vue
            <ZSwitch
              :model-value="product.isAvailable"
              :disabled="!isOwner"
              label="Còn hàng"
              @update:model-value="setAvailable(product, $event)"
            />
```

bằng (new_str):

```vue
            <div class="flex items-center gap-2">
              <ZSwitch
                :model-value="product.isAvailable"
                :disabled="!isOwner"
                label="Còn hàng"
                @update:model-value="setAvailable(product, $event)"
              />
              <ZButton v-if="isOwner" variant="ghost" size="sm" icon="i-lucide-pencil" :aria-label="`Sửa ${product.name}`" @click="openEditor(product)">
                Sửa
              </ZButton>
            </div>
```

3. Thêm `MenuProductEditor` ngay sau `</template>` của nhánh `v-else` (trước `</div>` ngoài cùng của template):

```vue
    <MenuProductEditor
      v-if="isOwner && activeStore"
      v-model:open="editorOpen"
      :product="editing"
      :categories="categories"
      :store-id="activeStore.id"
      @saved="onSaved"
    />
```

- [ ] **Step 8: Chạy test để xác nhận đạt**

Run:

```bash
npx vitest run --project unit tests/unit/shared/option-presets.test.ts
npx playwright test tests/e2e/menu-admin.spec.ts
npm run lint -- app shared
```

Expected: PASS (E2E dùng bucket thật của branch `test`; ảnh upload nằm dưới `stores/<storeId>/products/…`).

- [ ] **Step 9: Commit**

```bash
git add shared/option-presets.ts app/components/menu app/pages/app/menu.vue tests
git commit -m "feat(catalog): edit products with option groups and image upload

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 16: Cài đặt — tab "Nhận món & khu vực giao"

**Files:**
- Create: `app/components/settings/FulfillmentTab.vue`
- Modify: `app/pages/app/settings.vue`
- Test: `tests/nuxt/app/fulfillment-tab.test.ts`, `tests/e2e/settings-catalog.spec.ts`

**Interfaces:**
- Consumes: `ZTabs` (Task 13), `PATCH /api/stores/:id/fulfillment`, `GET/POST/PATCH /api/stores/:id/delivery-zones` (Task 10), `parseVndInput`, `vndSchema`, `StoreDetail`, `DeliveryZoneDTO`, `signUpAndOnboard`.
- Produces:
  - `<SettingsFulfillmentTab :store="StoreDetail" @changed />` — ba công tắc (Tại bàn / Mang đi / Giao hàng) lưu ngay khi gạt, hoàn tác và báo lỗi khi server từ chối (ví dụ tắt hết mode); danh sách khu vực giao (thêm bằng tên + phí, sửa tại chỗ, bật/tắt); cảnh báo "Chưa có khu vực giao đang bật" khi bật Giao hàng mà chưa có zone active.
  - `settings.vue`: `?tab=store|fulfillment|tables` (mặc định `store`), chỉ owner thấy thanh tab; staff chỉ thấy tab Cửa hàng.
  - `onFulfillmentChanged()` làm mới `store` và `useMe` để badge/menu phản ánh ngay.

- [ ] **Step 1: Viết component test thất bại**

`tests/nuxt/app/fulfillment-tab.test.ts`:

```ts
import { mockNuxtImport, renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen, waitFor } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsFulfillmentTab from '~/components/settings/FulfillmentTab.vue'
import type { StoreDetail } from '#shared/types/identity'

const { api } = vi.hoisted(() => ({ api: vi.fn() }))
mockNuxtImport('useApi', () => () => api)

const store = (overrides: Partial<StoreDetail> = {}): StoreDetail => ({
  id: 's1',
  orgId: 'o1',
  name: 'Quán',
  slug: 'quan',
  role: 'OWNER',
  isAcceptingOrders: true,
  dineInEnabled: true,
  pickupEnabled: true,
  deliveryEnabled: false,
  ...overrides,
})

const zone = (overrides = {}) => ({ id: 'z1', name: 'Quận 1', feeVnd: 15000, active: true, position: 0, ...overrides })

beforeEach(() => {
  api.mockReset()
  api.mockImplementation(async (url: string) => (url.endsWith('/delivery-zones') ? { zones: [] } : {}))
})

describe('SettingsFulfillmentTab', () => {
  it('saves a toggled mode immediately and tells the parent', async () => {
    const { emitted } = await renderSuspended(SettingsFulfillmentTab, { props: { store: store() } })
    await fireEvent.click(screen.getByRole('switch', { name: 'Giao hàng' }))
    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/stores/s1/fulfillment', { method: 'PATCH', body: { deliveryEnabled: true } }))
    await waitFor(() => expect(emitted().changed).toHaveLength(1))
  })

  it('reverts the switch and stays quiet to the parent when the server refuses', async () => {
    api.mockImplementation(async (url: string) => {
      if (url.endsWith('/delivery-zones')) return { zones: [] }
      throw { data: { code: 'VALIDATION_FAILED', message: 'Cần bật ít nhất một hình thức nhận món' } }
    })
    const { emitted } = await renderSuspended(SettingsFulfillmentTab, { props: { store: store({ pickupEnabled: false }) } })
    const dineIn = screen.getByRole('switch', { name: 'Tại bàn' })
    await fireEvent.click(dineIn)
    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/stores/s1/fulfillment', { method: 'PATCH', body: { dineInEnabled: false } }))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Tại bàn' }).getAttribute('aria-checked')).toBe('true'))
    expect(emitted().changed).toBeUndefined()
  })

  it('warns when delivery is on but no zone is active', async () => {
    await renderSuspended(SettingsFulfillmentTab, { props: { store: store({ deliveryEnabled: true }) } })
    expect(await screen.findByText(/Chưa có khu vực giao đang bật/)).toBeTruthy()
  })

  it('does not warn once an active zone exists', async () => {
    api.mockImplementation(async (url: string) => (url.endsWith('/delivery-zones') ? { zones: [zone()] } : {}))
    await renderSuspended(SettingsFulfillmentTab, { props: { store: store({ deliveryEnabled: true }) } })
    expect(await screen.findByDisplayValue('Quận 1')).toBeTruthy()
    expect(screen.queryByText(/Chưa có khu vực giao đang bật/)).toBeNull()
  })

  it('adds a zone from a short fee like 15k', async () => {
    api.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (options?.method === 'POST') return zone()
      return url.endsWith('/delivery-zones') ? { zones: [] } : {}
    })
    await renderSuspended(SettingsFulfillmentTab, { props: { store: store() } })
    await fireEvent.update(screen.getByLabelText('Tên khu vực'), 'Quận 1')
    await fireEvent.update(screen.getByLabelText('Phí giao (đ)'), '15k')
    await fireEvent.click(screen.getByRole('button', { name: 'Thêm khu vực' }))
    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/stores/s1/delivery-zones', { method: 'POST', body: { name: 'Quận 1', feeVnd: 15000 } }))
    expect(await screen.findByDisplayValue('Quận 1')).toBeTruthy()
  })

  it('rejects an invalid fee without calling the API', async () => {
    await renderSuspended(SettingsFulfillmentTab, { props: { store: store() } })
    await fireEvent.update(screen.getByLabelText('Tên khu vực'), 'Quận 1')
    await fireEvent.update(screen.getByLabelText('Phí giao (đ)'), 'abc')
    await fireEvent.click(screen.getByRole('button', { name: 'Thêm khu vực' }))
    expect(await screen.findByText(/Nhập phí giao hợp lệ/)).toBeTruthy()
    expect(api).not.toHaveBeenCalledWith('/api/stores/s1/delivery-zones', expect.objectContaining({ method: 'POST' }))
  })
})
```

- [ ] **Step 2: Viết E2E thất bại**

`tests/e2e/settings-catalog.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { expectNoHorizontalOverflow } from './support/layout'
import { signUpAndOnboard } from './support/owner'

test('owner enables delivery, adds a zone, and the last mode cannot be turned off', async ({ page }, testInfo) => {
  const { slug } = await signUpAndOnboard(page, testInfo, 'Quán Giao Hàng')
  await page.getByRole('link', { name: 'Cài đặt', exact: true }).click()
  await page.getByRole('tab', { name: 'Nhận món & khu vực giao' }).click()
  await expect(page).toHaveURL(/tab=fulfillment/)
  await expectNoHorizontalOverflow(page)

  const publicFulfillment = async () => (await (await page.request.get(`/api/public/stores/${slug}/fulfillment`)).json())

  await page.getByRole('switch', { name: 'Giao hàng' }).click()
  await expect(page.getByText(/Chưa có khu vực giao đang bật/)).toBeVisible()
  expect((await publicFulfillment()).modes.delivery).toEqual({ enabled: true, available: false })

  await page.getByLabel('Tên khu vực').fill('Quận 1')
  await page.getByLabel('Phí giao (đ)').fill('15k')
  await page.getByRole('button', { name: 'Thêm khu vực' }).click()
  await expect(page.getByLabel('Sửa tên khu vực')).toHaveValue('Quận 1')
  await expect(page.getByText(/Chưa có khu vực giao đang bật/)).toBeHidden()
  const fulfillment = await publicFulfillment()
  expect(fulfillment.modes.delivery).toEqual({ enabled: true, available: true })
  expect(fulfillment.deliveryZones).toEqual([expect.objectContaining({ name: 'Quận 1', feeVnd: 15000 })])

  // Turning off every mode is refused and the switch snaps back.
  await page.getByRole('switch', { name: 'Tại bàn' }).click()
  await page.getByRole('switch', { name: 'Mang đi' }).click()
  await expect(page.getByRole('switch', { name: 'Mang đi' })).not.toBeChecked()
  await page.getByRole('switch', { name: 'Giao hàng' }).click()
  await expect(page.getByText('Cần bật ít nhất một hình thức nhận món')).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Giao hàng' })).toBeChecked()
  await page.reload()
  await expect(page.getByRole('switch', { name: 'Giao hàng' })).toBeChecked()
})
```

- [ ] **Step 3: Chạy test để xác nhận thất bại**

Run: `npx vitest run --project nuxt tests/nuxt/app/fulfillment-tab.test.ts`
Expected: FAIL — `~/components/settings/FulfillmentTab.vue` chưa tồn tại.

- [ ] **Step 4: Viết `FulfillmentTab`**

`app/components/settings/FulfillmentTab.vue`:

```vue
<script setup lang="ts">
import { formatVnd, parseVndInput } from '#shared/money'
import { vndSchema } from '#shared/schemas/common'
import type { DeliveryZoneDTO } from '#shared/types/catalog'
import type { StoreDetail } from '#shared/types/identity'

type ModeKey = 'dineInEnabled' | 'pickupEnabled' | 'deliveryEnabled'

const props = defineProps<{ store: StoreDetail }>()
const emit = defineEmits<{ changed: [] }>()

const api = useApi()
const toast = useToast()

const modes = reactive<Record<ModeKey, boolean>>({
  dineInEnabled: props.store.dineInEnabled,
  pickupEnabled: props.store.pickupEnabled,
  deliveryEnabled: props.store.deliveryEnabled,
})
watch(() => props.store, (store) => {
  modes.dineInEnabled = store.dineInEnabled
  modes.pickupEnabled = store.pickupEnabled
  modes.deliveryEnabled = store.deliveryEnabled
})

const modeRows: { key: ModeKey, label: string, description: string }[] = [
  { key: 'dineInEnabled', label: 'Tại bàn', description: 'Khách quét QR trên bàn để gọi món.' },
  { key: 'pickupEnabled', label: 'Mang đi', description: 'Khách đặt trước rồi tới quán lấy.' },
  { key: 'deliveryEnabled', label: 'Giao hàng', description: 'Giao theo khu vực và phí bạn đặt bên dưới.' },
]

const zones = ref<DeliveryZoneDTO[]>([])
const zonesStatus = ref<'pending' | 'success' | 'error'>('pending')
const drafts = reactive<Record<string, { name: string, fee: string }>>({})
const newZone = reactive({ name: '', fee: '' })
const zoneErrors = reactive({ name: '', fee: '' })
const addingZone = ref(false)
const savingZoneId = ref<string | null>(null)

const zonesUrl = computed(() => `/api/stores/${props.store.id}/delivery-zones`)
const hasActiveZone = computed(() => zones.value.some(zone => zone.active))

function syncDraft(zone: DeliveryZoneDTO) {
  drafts[zone.id] = { name: zone.name, fee: String(zone.feeVnd) }
}

function replaceZone(zone: DeliveryZoneDTO) {
  zones.value = zones.value.map(item => (item.id === zone.id ? zone : item))
  syncDraft(zone)
}

async function loadZones() {
  zonesStatus.value = 'pending'
  try {
    const result = await api<{ zones: DeliveryZoneDTO[] }>(zonesUrl.value)
    zones.value = result.zones
    result.zones.forEach(syncDraft)
    zonesStatus.value = 'success'
  }
  catch {
    zonesStatus.value = 'error'
  }
}
loadZones()

async function setMode(key: ModeKey, value: boolean) {
  const previous = modes[key]
  modes[key] = value
  try {
    await api(`/api/stores/${props.store.id}/fulfillment`, { method: 'PATCH', body: { [key]: value } })
    emit('changed')
  }
  catch (err) {
    modes[key] = previous
    toast.add({ color: 'error', title: extractApiError(err).message })
  }
}

async function addZone() {
  if (addingZone.value) return
  const fee = parseVndInput(newZone.fee)
  zoneErrors.name = newZone.name.trim() ? '' : 'Nhập tên khu vực'
  zoneErrors.fee = fee !== null && vndSchema.safeParse(fee).success ? '' : 'Nhập phí giao hợp lệ, ví dụ 15k (nhập 0 nếu miễn phí)'
  if (zoneErrors.name || zoneErrors.fee || fee === null) return
  addingZone.value = true
  try {
    const created = await api<DeliveryZoneDTO>(zonesUrl.value, { method: 'POST', body: { name: newZone.name.trim(), feeVnd: fee } })
    zones.value = [...zones.value, created]
    syncDraft(created)
    newZone.name = ''
    newZone.fee = ''
  }
  catch (err) {
    toast.add({ color: 'error', title: extractApiError(err).message })
  }
  finally {
    addingZone.value = false
  }
}

function zoneDirty(zone: DeliveryZoneDTO): boolean {
  const draft = drafts[zone.id]
  return !!draft && (draft.name.trim() !== zone.name || parseVndInput(draft.fee) !== zone.feeVnd)
}

async function saveZone(zone: DeliveryZoneDTO) {
  const draft = drafts[zone.id]
  const fee = draft ? parseVndInput(draft.fee) : null
  if (!draft || !draft.name.trim() || fee === null || !vndSchema.safeParse(fee).success) {
    toast.add({ color: 'error', title: 'Kiểm tra lại tên và phí giao của khu vực' })
    return
  }
  savingZoneId.value = zone.id
  try {
    replaceZone(await api<DeliveryZoneDTO>(`${zonesUrl.value}/${zone.id}`, { method: 'PATCH', body: { name: draft.name.trim(), feeVnd: fee } }))
  }
  catch (err) {
    toast.add({ color: 'error', title: extractApiError(err).message })
  }
  finally {
    savingZoneId.value = null
  }
}

async function setZoneActive(zone: DeliveryZoneDTO, active: boolean) {
  zones.value = zones.value.map(item => (item.id === zone.id ? { ...item, active } : item))
  try {
    await api(`${zonesUrl.value}/${zone.id}`, { method: 'PATCH', body: { active } })
  }
  catch (err) {
    zones.value = zones.value.map(item => (item.id === zone.id ? zone : item))
    toast.add({ color: 'error', title: extractApiError(err).message })
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <ZCard title="Hình thức nhận món" description="Gạt là lưu ngay. Cần bật ít nhất một hình thức." padding="lg">
      <div class="flex flex-col gap-2">
        <ZSwitch
          v-for="row in modeRows"
          :key="row.key"
          :model-value="modes[row.key]"
          :label="row.label"
          :description="row.description"
          @update:model-value="setMode(row.key, $event)"
        />
      </div>
    </ZCard>

    <ZCard title="Khu vực giao hàng" description="Phí giao tính theo khu vực. Khách chọn khu vực rồi nhập địa chỉ chi tiết." padding="lg">
      <div class="flex flex-col gap-4">
        <ZAlert v-if="modes.deliveryEnabled && zonesStatus === 'success' && !hasActiveZone" color="warning" title="Chưa có khu vực giao đang bật — khách chưa chọn được Giao hàng." />

        <ZAlert v-if="zonesStatus === 'error'" color="error" title="Không tải được khu vực giao">
          <template #actions>
            <ZButton variant="secondary" size="sm" icon="i-lucide-refresh-cw" @click="loadZones()">
              Thử lại
            </ZButton>
          </template>
        </ZAlert>

        <ul v-if="zones.length > 0" class="flex flex-col gap-3">
          <li v-for="zone in zones" :key="zone.id" class="flex flex-col gap-3 rounded-md p-3 ring-1 ring-default">
            <div class="flex items-center gap-2">
              <ZInput v-if="drafts[zone.id]" v-model="drafts[zone.id]!.name" aria-label="Sửa tên khu vực" autocomplete="off" class="flex-1" />
              <ZInput v-if="drafts[zone.id]" v-model="drafts[zone.id]!.fee" aria-label="Sửa phí giao" inputmode="numeric" autocomplete="off" class="w-28" />
            </div>
            <div class="flex items-center justify-between gap-2">
              <ZSwitch :model-value="zone.active" label="Đang giao" @update:model-value="setZoneActive(zone, $event)" />
              <ZButton v-if="zoneDirty(zone)" size="sm" :loading="savingZoneId === zone.id" @click="saveZone(zone)">
                Lưu
              </ZButton>
              <span v-else class="font-mono text-sm text-muted">{{ formatVnd(zone.feeVnd) }}</span>
            </div>
          </li>
        </ul>

        <form class="flex flex-col gap-3" novalidate @submit.prevent="addZone">
          <ZFormField label="Tên khu vực" :error="zoneErrors.name">
            <ZInput v-model="newZone.name" placeholder="Ví dụ: Quận 1" autocomplete="off" />
          </ZFormField>
          <ZFormField label="Phí giao (đ)" :error="zoneErrors.fee">
            <ZInput v-model="newZone.fee" inputmode="numeric" placeholder="15k" autocomplete="off" />
          </ZFormField>
          <ZButton type="submit" variant="secondary" icon="i-lucide-plus" :loading="addingZone">
            Thêm khu vực
          </ZButton>
        </form>
      </div>
    </ZCard>
  </div>
</template>
```

- [ ] **Step 5: Sửa `settings.vue` — thêm tab**

Trong `app/pages/app/settings.vue` áp dụng bốn thay đổi (mỗi cái là một `edit` với `old_str` nguyên văn dưới đây):

1. Script — thêm sau dòng `const isOwner = computed(() => store.value?.role === 'OWNER')` (old_str là chính dòng đó):

```ts
const isOwner = computed(() => store.value?.role === 'OWNER')

const route = useRoute()
const router = useRouter()
const tabItems = [
  { label: 'Cửa hàng', value: 'store' },
  { label: 'Nhận món & khu vực giao', value: 'fulfillment' },
  { label: 'Bàn & QR', value: 'tables' },
]
const tab = computed({
  get: () => {
    const requested = typeof route.query.tab === 'string' ? route.query.tab : 'store'
    return isOwner.value && tabItems.some(item => item.value === requested) ? requested : 'store'
  },
  set: (value) => {
    void router.replace({ query: { ...route.query, tab: value === 'store' ? undefined : value } })
  },
})

async function onFulfillmentChanged() {
  await Promise.all([refresh(), load(true)])
}
```

2. Template — sau `AppPageHeader` (old_str: `    <AppPageHeader title="Cài đặt cửa hàng" description="Thông tin hiển thị cho khách và trạng thái nhận đơn." />`):

```vue
    <AppPageHeader title="Cài đặt cửa hàng" description="Thông tin hiển thị cho khách và trạng thái nhận đơn." />

    <ZTabs v-if="isOwner" v-model="tab" :items="tabItems" />
```

3. Chỉ hiện form cửa hàng ở tab `store` (old_str: `      <form id="store-settings" class="flex flex-col gap-6" @submit.prevent="save">`):

```vue
      <form v-if="tab === 'store'" id="store-settings" class="flex flex-col gap-6" @submit.prevent="save">
```

4. Nội dung tab mới và thanh lưu chỉ ở tab `store`. old_str (nguyên văn, thụt lề 6 khoảng trắng):

```vue
      </form>

      <div
        v-if="isOwner"
        v-show="isDirty"
```

new_str:

```vue
      </form>

      <SettingsFulfillmentTab v-if="tab === 'fulfillment'" :store="store" @changed="onFulfillmentChanged" />

      <div
        v-if="isOwner && tab === 'store'"
        v-show="isDirty"
```

- [ ] **Step 6: Chạy test để xác nhận đạt**

Run:

```bash
npx vitest run --project nuxt tests/nuxt/app/fulfillment-tab.test.ts
npx playwright test tests/e2e/settings-catalog.spec.ts tests/e2e/onboarding.spec.ts
npm run lint -- app
```

Expected: PASS (onboarding spec vẫn dùng tab `Cửa hàng` mặc định, switch "Đang nhận đơn" và thanh lưu không đổi).

- [ ] **Step 7: Commit**

```bash
git add app/components/settings/FulfillmentTab.vue app/pages/app/settings.vue tests
git commit -m "feat(catalog): add fulfillment modes and delivery zones to settings

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 17: Trang khách C1/C2 — chip danh mục, tìm kiếm, sheet option, giỏ tạm, `?t=`

**Files:**
- Create: `shared/menu-search.ts`, `shared/cart-draft.ts`, `app/composables/useCartDraft.ts`, `app/components/menu/CategoryChips.vue`, `app/components/menu/ProductCard.vue`, `app/components/menu/ProductSheet.vue`, `app/components/menu/CartBar.vue`
- Modify (thay toàn bộ nội dung): `app/pages/s/[slug].vue`
- Test: `tests/unit/shared/menu-search.test.ts`, `tests/unit/shared/cart-draft.test.ts`, thêm vào `tests/e2e/public-menu.spec.ts`

**Interfaces:**
- Consumes: `PublicMenu`, `PublicFulfillment`, `PublicProduct`, `PublicOptionGroup` (Task 3); `defaultSelection`, `validateSelection`, `toggleSelection`, `selectionDeltas`, `priceLine`, `toOptionRules`, `MAX_LINE_QUANTITY` (Task 2); `groupByCategory`, `MenuStoreHeader` (Task 4); `ZSheet` (Task 13); `GET /api/public/stores/:slug/fulfillment?t=` (Task 12); fixtures `createOptionGroup`, `createTable`.
- Produces:
  - `normalizeSearch(text): string` (bỏ dấu, `đ→d`, chữ thường), `filterProducts<T extends { name: string }>(products: readonly T[], query: string): T[]` (mọi từ khoá đều phải có trong tên, không phân biệt thứ tự), `SEARCH_THRESHOLD = 15`, `shouldShowSearch(productCount: number): boolean` (`> 15`).
  - `DraftLine { key, productId, name, optionLabels: string[], valueIds: string[], quantity, unitPriceVnd }`, `lineKey(productId, valueIds)`, `addToDraft(lines, product, valueIds, quantity): DraftLine[]` (ném `RangeError` khi món hết hàng, option sai hoặc số lượng ngoài 1–50; gộp dòng giống nhau, tối đa 50), `draftTotals(lines): { count: number, totalVnd: number }`.
  - `useCartDraft(slug: MaybeRefOrGetter<string>): { lines: Ref<DraftLine[]>, totals: ComputedRef<{ count, totalVnd }>, add(product, valueIds, quantity): void }` — giỏ **tạm** trong `useState` (PR3 thay bằng `useCart` có localStorage; tên `DraftLine`/`addToDraft` là của PR2).
  - Trang `/s/[slug]`: header, thanh chip danh mục sticky (khi > 1 nhóm), ô "Tìm món" khi > 15 món, card món (`formatVnd`, "Hết hàng", nút `+` có `aria-label="Thêm <tên>"`), `UDrawer` option có default selection và nút `Thêm • XX.000đ`, món không option bấm `+` thêm ngay, thanh giỏ tạm; `?t=` hiện "Bàn 05" hoặc cảnh báo "Mã QR không hợp lệ" (không gắn bàn).

- [ ] **Step 1: Viết unit test thất bại cho tìm kiếm và giỏ tạm**

`tests/unit/shared/menu-search.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { filterProducts, normalizeSearch, SEARCH_THRESHOLD, shouldShowSearch } from '#shared/menu-search'

const products = [{ name: 'Trà sữa trân châu' }, { name: 'Cà phê muối' }, { name: 'Đậu đỏ đá xay' }]

describe('normalizeSearch', () => {
  it('lower-cases and strips Vietnamese diacritics', () => {
    expect(normalizeSearch('Trà Sữa Đậu Đỏ')).toBe('tra sua dau do')
  })
})

describe('filterProducts', () => {
  it('matches without diacritics and in any word order', () => {
    expect(filterProducts(products, 'tra sua').map(p => p.name)).toEqual(['Trà sữa trân châu'])
    expect(filterProducts(products, 'SUA TRA').map(p => p.name)).toEqual(['Trà sữa trân châu'])
    expect(filterProducts(products, 'dau do').map(p => p.name)).toEqual(['Đậu đỏ đá xay'])
    expect(filterProducts(products, 'ca phe').map(p => p.name)).toEqual(['Cà phê muối'])
  })

  it('returns everything for a blank query and nothing for a miss', () => {
    expect(filterProducts(products, '   ')).toHaveLength(3)
    expect(filterProducts(products, 'xyz')).toEqual([])
  })
})

describe('shouldShowSearch', () => {
  it('only appears above the threshold', () => {
    expect(SEARCH_THRESHOLD).toBe(15)
    expect(shouldShowSearch(15)).toBe(false)
    expect(shouldShowSearch(16)).toBe(true)
  })
})
```

`tests/unit/shared/cart-draft.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { addToDraft, draftTotals, lineKey, type DraftLine } from '#shared/cart-draft'
import type { PublicProduct } from '#shared/types/catalog'

const tea: PublicProduct = {
  id: 'p1',
  categoryId: null,
  name: 'Trà sữa',
  description: null,
  basePriceVnd: 30000,
  isAvailable: true,
  imageUrl: null,
  optionGroups: [
    { id: 'g-size', name: 'Size', required: true, minSelect: 1, maxSelect: 1, values: [{ id: 'm', name: 'M', priceDeltaVnd: 0 }, { id: 'l', name: 'L', priceDeltaVnd: 5000 }] },
    { id: 'g-top', name: 'Topping', required: false, minSelect: 0, maxSelect: 2, values: [{ id: 'tc', name: 'Trân châu', priceDeltaVnd: 5000 }, { id: 'th', name: 'Thạch', priceDeltaVnd: 3000 }] },
  ],
}
const flan: PublicProduct = { ...tea, id: 'p2', name: 'Bánh flan', basePriceVnd: 20000, optionGroups: [] }

describe('addToDraft', () => {
  it('prices the line from the base price and the selected deltas', () => {
    expect(addToDraft([], tea, ['th', 'l'], 2)).toEqual<DraftLine[]>([{
      key: 'p1:l,th',
      productId: 'p1',
      name: 'Trà sữa',
      optionLabels: ['L', 'Thạch'],
      valueIds: ['l', 'th'],
      quantity: 2,
      unitPriceVnd: 38000,
    }])
  })

  it('merges identical selections regardless of click order and keeps different ones apart', () => {
    let lines = addToDraft([], tea, ['th', 'l'], 1)
    lines = addToDraft(lines, tea, ['l', 'th'], 2)
    lines = addToDraft(lines, tea, ['m'], 1)
    expect(lines.map(l => [l.key, l.quantity])).toEqual([['p1:l,th', 3], ['p1:m', 1]])
  })

  it('caps a merged line at 50', () => {
    const lines = addToDraft(addToDraft([], flan, [], 40), flan, [], 40)
    expect(lines[0]!.quantity).toBe(50)
  })

  it('rejects unavailable products, bad selections and bad quantities', () => {
    expect(() => addToDraft([], { ...tea, isAvailable: false }, ['m'], 1)).toThrow(RangeError)
    expect(() => addToDraft([], tea, [], 1)).toThrow(RangeError)
    expect(() => addToDraft([], tea, ['m', 'l'], 1)).toThrow(RangeError)
    expect(() => addToDraft([], flan, [], 0)).toThrow(RangeError)
    expect(() => addToDraft([], flan, [], 51)).toThrow(RangeError)
  })
})

describe('draftTotals', () => {
  it('counts items and sums line totals', () => {
    const lines = addToDraft(addToDraft([], tea, ['l'], 2), flan, [], 1)
    expect(draftTotals(lines)).toEqual({ count: 3, totalVnd: 2 * 35000 + 20000 })
    expect(draftTotals([])).toEqual({ count: 0, totalVnd: 0 })
  })
})

describe('lineKey', () => {
  it('is order independent', () => {
    expect(lineKey('p', ['b', 'a'])).toBe(lineKey('p', ['a', 'b']))
  })
})
```

- [ ] **Step 2: Viết E2E thất bại**

Thêm vào cuối `tests/e2e/public-menu.spec.ts` (thêm `createOptionGroup`, `createTable` vào import fixtures):

```ts
async function openStore(opts: { accepting?: boolean } = {}) {
  const t = await createTenant('e2e-cx')
  if (opts.accepting ?? true) await getDb().update(stores).set({ isAcceptingOrders: true }).where(eq(stores.id, t.store.id))
  return t
}

test('customer picks options with defaults, sees live prices and fills the draft cart', async ({ page }) => {
  const t = await openStore()
  const tea = await createProduct(t.store, { name: 'Trà sữa', basePriceVnd: 30000, position: 1 })
  await createOptionGroup(t.store, tea, { name: 'Size', required: true, values: [{ name: 'M' }, { name: 'L', priceDeltaVnd: 5000 }] })
  await createOptionGroup(t.store, tea, {
    name: 'Topping',
    maxSelect: 2,
    position: 1,
    values: [{ name: 'Trân châu', priceDeltaVnd: 5000 }, { name: 'Thạch', priceDeltaVnd: 3000 }, { name: 'Pudding', priceDeltaVnd: 7000 }],
  })
  await createProduct(t.store, { name: 'Bánh flan', basePriceVnd: 20000, position: 2 })

  await page.goto(`/s/${t.store.slug}`)
  await page.getByRole('button', { name: 'Thêm Trà sữa' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Thêm • 30.000đ' })).toBeVisible()
  await expect(dialog.getByRole('radio', { name: /^M/ })).toBeChecked()

  await dialog.getByText('L', { exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Thêm • 35.000đ' })).toBeVisible()
  await dialog.getByText('Trân châu').click()
  await dialog.getByText('Thạch').click()
  await expect(dialog.getByRole('button', { name: 'Thêm • 43.000đ' })).toBeVisible()
  await dialog.getByText('Pudding').click()
  await expect(dialog.getByRole('checkbox', { name: /Pudding/ })).not.toBeChecked()
  await expect(dialog.getByRole('button', { name: 'Thêm • 43.000đ' })).toBeVisible()

  await dialog.getByRole('button', { name: 'Tăng số lượng' }).click()
  await expect(dialog.getByRole('button', { name: 'Thêm • 86.000đ' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Thêm • 86.000đ' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Giỏ • 2 món')).toBeVisible()

  // A product without options is added with a single tap on +.
  await page.getByRole('button', { name: 'Thêm Bánh flan' }).click()
  await expect(page.getByText('Giỏ • 3 món')).toBeVisible()
  await expect(page.getByText('106.000đ', { exact: true })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('a required option group blocks adding until chosen again', async ({ page }) => {
  const t = await openStore()
  const tea = await createProduct(t.store, { name: 'Cà phê' })
  await createOptionGroup(t.store, tea, { name: 'Đường', required: true, values: [{ name: '100%' }, { name: '50%' }] })
  await page.goto(`/s/${t.store.slug}`)
  await page.getByRole('button', { name: 'Thêm Cà phê' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('radio', { name: '100%' })).toBeChecked()
  await dialog.getByText('50%').click()
  await expect(dialog.getByRole('radio', { name: '50%' })).toBeChecked()
  // Tapping the selected value of a required group does not clear it.
  await dialog.getByText('50%').click()
  await expect(dialog.getByRole('radio', { name: '50%' })).toBeChecked()
})

test('search appears only above 15 products and filters without diacritics', async ({ page }) => {
  const small = await openStore()
  for (let i = 1; i <= 15; i++) await createProduct(small.store, { name: `Món số ${i}`, position: i })
  await page.goto(`/s/${small.store.slug}`)
  await expect(page.getByText('Món số 15')).toBeVisible()
  await expect(page.getByLabel('Tìm món')).toHaveCount(0)

  const big = await openStore()
  for (let i = 1; i <= 15; i++) await createProduct(big.store, { name: `Món số ${i}`, position: i })
  await createProduct(big.store, { name: 'Bánh flan caramel', position: 16 })
  await page.goto(`/s/${big.store.slug}`)
  await page.getByLabel('Tìm món').fill('BANH flan')
  await expect(page.getByText('Bánh flan caramel')).toBeVisible()
  await expect(page.getByText('Món số 3', { exact: true })).toBeHidden()
  await page.getByLabel('Tìm món').fill('khong co mon nay')
  await expect(page.getByText('Không tìm thấy món')).toBeVisible()
})

test('category chips list every non-empty category', async ({ page }) => {
  const t = await openStore()
  const tea = await createCategory(t.store, 'Trà sữa', { position: 1 })
  const coffee = await createCategory(t.store, 'Cà phê', { position: 2 })
  await createCategory(t.store, 'Rỗng', { position: 3 })
  await createProduct(t.store, { name: 'Trà đào', categoryId: tea.id })
  await createProduct(t.store, { name: 'Bạc xỉu', categoryId: coffee.id })
  await page.goto(`/s/${t.store.slug}`)
  const chips = page.getByRole('navigation', { name: 'Danh mục' })
  await expect(chips.getByRole('button')).toHaveText(['Trà sữa', 'Cà phê'])
  await chips.getByRole('button', { name: 'Cà phê' }).click()
  await expect(chips.getByRole('button', { name: 'Cà phê' })).toHaveAttribute('aria-current', 'true')
})

test('a paused store and a sold-out product cannot be added', async ({ page }) => {
  const paused = await openStore({ accepting: false })
  await createProduct(paused.store, { name: 'Trà đào' })
  await page.goto(`/s/${paused.store.slug}`)
  await expect(page.getByRole('button', { name: 'Thêm Trà đào' })).toBeDisabled()

  const open = await openStore()
  await createProduct(open.store, { name: 'Hết rồi', isAvailable: false })
  await page.goto(`/s/${open.store.slug}`)
  await expect(page.getByRole('button', { name: 'Thêm Hết rồi' })).toBeDisabled()
})

test('a table QR binds the table; a broken, empty or stale QR never does', async ({ page }) => {
  const t = await openStore()
  const { token } = await createTable(t.store, '05')

  await page.goto(`/s/${t.store.slug}?t=${token}`)
  await expect(page.getByText('Bàn 05', { exact: true })).toBeVisible()
  await expect(page.getByText(/Mã QR không hợp lệ/)).toBeHidden()

  for (const query of ['?t=sai-roi', '?t=', '?t=a&t=b', `?t=${'x'.repeat(300)}`]) {
    await page.goto(`/s/${t.store.slug}${query}`)
    await expect(page.getByText(/Mã QR không hợp lệ/)).toBeVisible()
    await expect(page.getByText('Bàn 05', { exact: true })).toBeHidden()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.store.name)
  }

  await page.goto(`/s/${t.store.slug}`)
  await expect(page.getByText(/Mã QR không hợp lệ/)).toBeHidden()
  await expect(page.getByText('Bàn 05', { exact: true })).toBeHidden()
})
```

- [ ] **Step 3: Chạy test để xác nhận thất bại**

Run: `npx vitest run --project unit tests/unit/shared/menu-search.test.ts tests/unit/shared/cart-draft.test.ts`
Expected: FAIL — thiếu `#shared/menu-search`, `#shared/cart-draft`.

- [ ] **Step 4: Viết `menu-search.ts` và `cart-draft.ts`**

`shared/menu-search.ts`:

```ts
export const SEARCH_THRESHOLD = 15

export function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/đ/g, 'd')
}

export function filterProducts<T extends { name: string }>(products: readonly T[], query: string): T[] {
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return [...products]
  return products.filter((product) => {
    const name = normalizeSearch(product.name)
    return terms.every(term => name.includes(term))
  })
}

export function shouldShowSearch(productCount: number): boolean {
  return productCount > SEARCH_THRESHOLD
}
```

`shared/cart-draft.ts`:

```ts
import { assertVnd } from './money'
import { MAX_LINE_QUANTITY, orderTotals, priceLine, selectionDeltas, toOptionRules, validateSelection } from './pricing'
import type { PublicProduct } from './types/catalog'

export interface DraftLine {
  key: string
  productId: string
  name: string
  optionLabels: string[]
  valueIds: string[]
  quantity: number
  unitPriceVnd: number
}

export function lineKey(productId: string, valueIds: string[]): string {
  return `${productId}:${[...valueIds].sort().join(',')}`
}

export function addToDraft(lines: DraftLine[], product: PublicProduct, valueIds: string[], quantity: number): DraftLine[] {
  if (!product.isAvailable) throw new RangeError('Product is not available')
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LINE_QUANTITY) throw new RangeError(`Invalid quantity: ${quantity}`)

  const rules = toOptionRules(product.optionGroups)
  const selection = validateSelection(rules, valueIds)
  if (!selection.ok) throw new RangeError(`Invalid selection: ${selection.reason}`)

  const key = lineKey(product.id, selection.valueIds)
  const existing = lines.find(line => line.key === key)
  if (existing) {
    return lines.map(line => (line === existing ? { ...line, quantity: Math.min(MAX_LINE_QUANTITY, line.quantity + quantity) } : line))
  }

  const { unitPriceVnd } = priceLine({
    basePriceVnd: product.basePriceVnd,
    deltasVnd: selectionDeltas(rules, selection.valueIds),
    quantity: 1,
  })
  const picked = new Set(selection.valueIds)
  return [
    ...lines,
    {
      key,
      productId: product.id,
      name: product.name,
      optionLabels: product.optionGroups.flatMap(group => group.values.filter(value => picked.has(value.id)).map(value => value.name)),
      valueIds: selection.valueIds,
      quantity,
      unitPriceVnd,
    },
  ]
}

export function draftTotals(lines: DraftLine[]): { count: number, totalVnd: number } {
  const lineTotalsVnd = lines.map(line => assertVnd(line.unitPriceVnd * line.quantity))
  return {
    count: lines.reduce((sum, line) => sum + line.quantity, 0),
    totalVnd: orderTotals({ lineTotalsVnd, deliveryFeeVnd: 0 }).totalVnd,
  }
}
```

- [ ] **Step 5: Viết composable và các component**

`app/composables/useCartDraft.ts`:

```ts
import { addToDraft, draftTotals, type DraftLine } from '#shared/cart-draft'
import type { PublicProduct } from '#shared/types/catalog'

export function useCartDraft(slug: MaybeRefOrGetter<string>) {
  const lines = useState<DraftLine[]>(`cart-draft:${toValue(slug)}`, () => [])
  const totals = computed(() => draftTotals(lines.value))

  function add(product: PublicProduct, valueIds: string[], quantity: number) {
    lines.value = addToDraft(lines.value, product, valueIds, quantity)
  }

  return { lines, totals, add }
}
```

`app/components/menu/CategoryChips.vue`:

```vue
<script setup lang="ts">
defineProps<{ items: { id: string | null, name: string }[] }>()
const emit = defineEmits<{ select: [id: string | null] }>()

const active = ref<string | null | undefined>(undefined)

function pick(id: string | null) {
  active.value = id
  emit('select', id)
}
</script>

<template>
  <nav aria-label="Danh mục" class="sticky top-0 z-10 -mx-4 bg-default/95 px-4 py-2 backdrop-blur">
    <ul class="flex gap-2 overflow-x-auto">
      <li v-for="item in items" :key="item.id ?? 'other'" class="shrink-0">
        <button
          type="button"
          class="min-h-11 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary"
          :class="active === item.id ? 'bg-primary text-(--zeno-on-primary)' : 'bg-(--zeno-surface) text-default ring-1 ring-default'"
          :aria-current="active === item.id ? 'true' : undefined"
          @click="pick(item.id)"
        >
          {{ item.name }}
        </button>
      </li>
    </ul>
  </nav>
</template>
```

`app/components/menu/ProductCard.vue`:

```vue
<script setup lang="ts">
import { formatVnd } from '#shared/money'
import type { PublicProduct } from '#shared/types/catalog'

defineProps<{ product: PublicProduct, canOrder: boolean }>()
defineEmits<{ add: [product: PublicProduct] }>()
</script>

<template>
  <li class="flex items-center gap-3 rounded-md bg-(--zeno-surface) p-3 ring-1 ring-default" :class="{ 'opacity-60': !product.isAvailable }">
    <img
      v-if="product.imageUrl"
      :src="product.imageUrl"
      alt=""
      width="80"
      height="80"
      loading="lazy"
      class="size-20 shrink-0 rounded-md bg-(--zeno-surface-inset) object-cover"
    >
    <div class="min-w-0 flex-1">
      <p class="break-words font-medium text-default">
        {{ product.name }}
      </p>
      <p v-if="product.description" class="line-clamp-2 text-sm text-muted">
        {{ product.description }}
      </p>
      <p class="mt-1 flex flex-wrap items-center gap-2 font-mono text-sm text-default">
        {{ formatVnd(product.basePriceVnd) }}
        <ZBadge v-if="!product.isAvailable" status="neutral" size="sm">
          Hết hàng
        </ZBadge>
        <span v-else-if="product.optionGroups.length > 0" class="font-sans text-[13px] text-muted">Tuỳ chọn</span>
      </p>
    </div>
    <ZButton
      square
      icon="i-lucide-plus"
      :aria-label="`Thêm ${product.name}`"
      :disabled="!product.isAvailable || !canOrder"
      @click="$emit('add', product)"
    />
  </li>
</template>
```

`app/components/menu/ProductSheet.vue`:

```vue
<script setup lang="ts">
import { formatVnd } from '#shared/money'
import {
  defaultSelection,
  MAX_LINE_QUANTITY,
  priceLine,
  selectionDeltas,
  toggleSelection,
  toOptionRules,
  validateSelection,
} from '#shared/pricing'
import type { PublicOptionGroup, PublicProduct } from '#shared/types/catalog'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ product: PublicProduct | null, canOrder: boolean }>()
const emit = defineEmits<{ add: [payload: { valueIds: string[], quantity: number }] }>()

const rules = computed(() => toOptionRules(props.product?.optionGroups ?? []))
const selected = ref<string[]>([])
const quantity = ref(1)

watch(
  [() => open.value, () => props.product?.id],
  ([isOpen]) => {
    if (!isOpen) return
    selected.value = defaultSelection(rules.value)
    quantity.value = 1
  },
  { immediate: true },
)

const validation = computed(() => validateSelection(rules.value, selected.value))
const total = computed(() => {
  if (!props.product) return 0
  return priceLine({
    basePriceVnd: props.product.basePriceVnd,
    deltasVnd: selectionDeltas(rules.value, selected.value),
    quantity: quantity.value,
  }).lineTotalVnd
})
const problem = computed(() => {
  const result = validation.value
  if (result.ok || !result.groupId) return ''
  const group = props.product?.optionGroups.find(item => item.id === result.groupId)
  return group ? `Chọn ${group.name} để tiếp tục` : ''
})

function hint(group: PublicOptionGroup): string {
  const base = group.required ? 'Bắt buộc' : 'Tuỳ chọn'
  return group.maxSelect > 1 ? `${base} · chọn tối đa ${group.maxSelect}` : base
}

function onToggle(group: PublicOptionGroup, valueId: string, event: Event) {
  const rule = rules.value.find(item => item.id === group.id)
  if (!rule) return
  selected.value = toggleSelection(rule, selected.value, valueId)
  // A controlled input must show the state we kept, e.g. when the maximum is already reached.
  const input = event.target as HTMLInputElement
  input.checked = selected.value.includes(valueId)
}

function confirm() {
  const result = validation.value
  if (!result.ok || !props.canOrder) return
  emit('add', { valueIds: result.valueIds, quantity: quantity.value })
}
</script>

<template>
  <ZSheet v-model:open="open" :title="product?.name ?? 'Chọn món'" :description="product?.description ?? undefined">
    <div v-if="product" class="flex flex-col gap-5">
      <fieldset v-for="group in product.optionGroups" :key="group.id" class="flex flex-col gap-2">
        <legend class="flex w-full items-baseline justify-between gap-2 pb-1">
          <span class="font-semibold text-default">{{ group.name }}</span>
          <span class="text-sm text-muted">{{ hint(group) }}</span>
        </legend>
        <label
          v-for="value in group.values"
          :key="value.id"
          class="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 ring-1 ring-default has-[:checked]:bg-(--zeno-surface-inset) has-[:checked]:ring-2 has-[:checked]:ring-primary"
        >
          <input
            :type="group.maxSelect === 1 ? 'radio' : 'checkbox'"
            :name="group.id"
            :value="value.id"
            :checked="selected.includes(value.id)"
            class="size-5 accent-(--ui-primary)"
            @change="onToggle(group, value.id, $event)"
          >
          <span class="flex-1 text-default">{{ value.name }}</span>
          <span v-if="value.priceDeltaVnd > 0" class="font-mono text-sm text-muted">+{{ formatVnd(value.priceDeltaVnd) }}</span>
        </label>
      </fieldset>

      <div class="flex items-center justify-between gap-3">
        <span class="font-semibold text-default">Số lượng</span>
        <div class="flex items-center gap-2">
          <ZButton variant="secondary" square icon="i-lucide-minus" aria-label="Giảm số lượng" :disabled="quantity <= 1" @click="quantity -= 1" />
          <span class="w-8 text-center font-mono text-lg" aria-live="polite">{{ quantity }}</span>
          <ZButton variant="secondary" square icon="i-lucide-plus" aria-label="Tăng số lượng" :disabled="quantity >= MAX_LINE_QUANTITY" @click="quantity += 1" />
        </div>
      </div>
    </div>

    <template #footer>
      <p v-if="problem" class="mb-2 text-sm text-error" role="status">
        {{ problem }}
      </p>
      <p v-else-if="!canOrder" class="mb-2 text-sm text-muted" role="status">
        Quán đang tạm nghỉ nên chưa thêm món được.
      </p>
      <ZButton size="lg" block :disabled="!validation.ok || !canOrder" @click="confirm">
        Thêm • {{ formatVnd(total) }}
      </ZButton>
    </template>
  </ZSheet>
</template>
```

`app/components/menu/CartBar.vue`:

```vue
<script setup lang="ts">
import { formatVnd } from '#shared/money'

defineProps<{ count: number, totalVnd: number }>()
</script>

<template>
  <div
    v-if="count > 0"
    class="fixed inset-x-0 bottom-0 z-20 border-t border-default bg-default/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur"
    aria-live="polite"
  >
    <div class="mx-auto flex max-w-2xl items-center justify-between gap-3">
      <span class="font-medium text-default">Giỏ • {{ count }} món</span>
      <span class="font-mono text-lg text-default">{{ formatVnd(totalVnd) }}</span>
    </div>
  </div>
</template>
```

- [ ] **Step 6: Thay trang `/s/[slug]`**

Thay toàn bộ nội dung `app/pages/s/[slug].vue` bằng:

```vue
<script setup lang="ts">
import { groupByCategory } from '#shared/menu-groups'
import { filterProducts, shouldShowSearch } from '#shared/menu-search'
import type { PublicFulfillment, PublicMenu, PublicProduct } from '#shared/types/catalog'

const route = useRoute()
const toast = useToast()
const slug = computed(() => String(route.params.slug ?? '').toLowerCase())

const { data: menu, error, refresh } = await useFetch<PublicMenu>(
  () => `/api/public/stores/${encodeURIComponent(slug.value)}/menu`,
)
if (error.value?.statusCode === 404) {
  throw createError({ statusCode: 404, statusMessage: 'Not Found', fatal: true })
}

// ?t= present but empty or repeated is a broken QR, never a silent fallback to "no table".
const rawTable = route.query.t
const tableToken = typeof rawTable === 'string' ? rawTable : rawTable === undefined ? undefined : ''
const { data: fulfillment } = await useFetch<PublicFulfillment>(
  () => `/api/public/stores/${encodeURIComponent(slug.value)}/fulfillment`,
  { query: { t: tableToken }, immediate: tableToken !== undefined, watch: false },
)

useSeoMeta({
  title: () => menu.value?.store.name ?? 'Thực đơn',
  description: () => `Xem thực đơn và đặt món tại ${menu.value?.store.name ?? 'quán'}.`,
})

const cart = useCartDraft(slug)
const query = ref('')
const sheetOpen = ref(false)
const sheetProduct = ref<PublicProduct | null>(null)

const canOrder = computed(() => menu.value?.store.isAcceptingOrders ?? false)
const tableLabel = computed(() => fulfillment.value?.table?.displayName ?? null)
const tableInvalid = computed(() => fulfillment.value?.tableError === 'INVALID_TABLE')
const showSearch = computed(() => shouldShowSearch(menu.value?.products.length ?? 0))
const visibleProducts = computed(() => (menu.value ? filterProducts(menu.value.products, query.value) : []))
const sections = computed(() => (menu.value ? groupByCategory(menu.value.categories, visibleProducts.value) : []))
const chipItems = computed(() => sections.value.map(section => ({ id: section.id, name: section.name })))
const searching = computed(() => query.value.trim().length > 0)

function scrollToSection(id: string | null) {
  document.getElementById(`cat-${id ?? 'other'}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function onAdd(product: PublicProduct) {
  if (!product.isAvailable || !canOrder.value) return
  if (product.optionGroups.length === 0) {
    cart.add(product, [], 1)
    toast.add({ color: 'success', title: `Đã thêm ${product.name}` })
    return
  }
  sheetProduct.value = product
  sheetOpen.value = true
}

function onSheetAdd(payload: { valueIds: string[], quantity: number }) {
  const product = sheetProduct.value
  if (!product) return
  cart.add(product, payload.valueIds, payload.quantity)
  sheetOpen.value = false
  toast.add({ color: 'success', title: `Đã thêm ${product.name}` })
}
</script>

<template>
  <div class="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-5 px-4 pb-28 pt-[calc(1.25rem+env(safe-area-inset-top))]">
    <ZAlert v-if="error" color="error" title="Không tải được menu">
      <template #actions>
        <ZButton variant="secondary" size="sm" icon="i-lucide-refresh-cw" @click="refresh()">
          Thử lại
        </ZButton>
      </template>
    </ZAlert>

    <template v-else-if="menu">
      <MenuStoreHeader :name="menu.store.name" :is-accepting-orders="menu.store.isAcceptingOrders" :modes="menu.modes" :table-label="tableLabel" />

      <ZAlert
        v-if="tableInvalid"
        color="warning"
        title="Mã QR không hợp lệ hoặc đã bị thu hồi"
        description="Bạn vẫn xem được menu nhưng chưa gắn với bàn nào. Hãy quét lại mã QR trên bàn hoặc hỏi nhân viên."
      />

      <ZAlert
        v-if="!menu.store.isAcceptingOrders"
        color="warning"
        title="Quán đang tạm nghỉ"
        description="Bạn vẫn xem được menu, nhưng chưa đặt món được lúc này."
      />

      <ZInput v-if="showSearch" v-model="query" type="search" icon="i-lucide-search" placeholder="Tìm món" aria-label="Tìm món" autocomplete="off" />

      <AppEmptyState
        v-if="menu.products.length === 0"
        icon="i-lucide-coffee"
        title="Menu đang được cập nhật"
        description="Quán đang thêm món. Bạn quay lại sau ít phút nhé."
      />
      <AppEmptyState v-else-if="searching && sections.length === 0" icon="i-lucide-search-x" title="Không tìm thấy món" description="Thử gõ từ khoá khác, không cần dấu." />

      <MenuCategoryChips v-if="chipItems.length > 1" :items="chipItems" @select="scrollToSection" />

      <section v-for="section in sections" :id="`cat-${section.id ?? 'other'}`" :key="section.id ?? 'other'" class="flex scroll-mt-16 flex-col gap-3">
        <h2 class="text-h3 text-default">
          {{ section.name }}
        </h2>
        <ul class="flex flex-col gap-2">
          <MenuProductCard v-for="product in section.products" :key="product.id" :product="product" :can-order="canOrder" @add="onAdd" />
        </ul>
      </section>

      <MenuProductSheet v-model:open="sheetOpen" :product="sheetProduct" :can-order="canOrder" @add="onSheetAdd" />
      <MenuCartBar :count="cart.totals.value.count" :total-vnd="cart.totals.value.totalVnd" />
    </template>
  </div>
</template>
```

- [ ] **Step 7: Chạy test để xác nhận đạt**

Run:

```bash
npx vitest run --project unit tests/unit/shared/menu-search.test.ts tests/unit/shared/cart-draft.test.ts
npx playwright test tests/e2e/public-menu.spec.ts tests/e2e/owner-quick-actions.spec.ts
npm run lint -- app shared
npm run typecheck
```

Expected: PASS. E2E Task 4 (menu rỗng, danh sách theo danh mục, "Hết hàng", slug hoa, 404) vẫn xanh với trang mới.

- [ ] **Step 8: Commit**

```bash
git add shared/menu-search.ts shared/cart-draft.ts app/composables/useCartDraft.ts app/components/menu app/pages/s tests
git commit -m "feat(catalog): complete public menu with option sheet, search and table QR

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 18: Cài đặt — tab "Bàn & QR" (qrcode, tải PNG, in)

**Files:**
- Create: `app/utils/qr.ts`, `app/components/settings/TablesTab.vue`, `app/components/settings/TableQrSheet.vue`
- Modify: `app/pages/app/settings.vue`, `nuxt.config.ts` (`optimizeDeps`), `package.json`/`package-lock.json` (qua `npm install`)
- Test: `tests/unit/app/qr.test.ts`, thêm test vào `tests/e2e/settings-catalog.spec.ts`

**Interfaces:**
- Consumes: `ZSheet` (Task 13), `AppCopyField`, `POST/GET/PATCH /api/stores/:id/tables`, `POST …/tables/:id/regenerate` (Task 11), `TableDTO`, `TableWithQr`, `slugify` (`#shared/schemas/identity`), `/s/[slug]?t=` (Task 17).
- Produces:
  - `qrDataUrl(text: string, width = 512): Promise<string>` (PNG data URL), `qrFilename(storeSlug: string, tableName: string): string` → `qr-<slug>-<ten-ban>.png`, `escapeHtml(text: string): string`, `downloadDataUrl(dataUrl: string, filename: string): void`, `printQr(dataUrl: string, title: string): void`.
  - `<SettingsTableQrSheet v-model:open :title :url :slug />` — QR, `AppCopyField` "Link bàn", nút "Tải ảnh PNG" và "In".
  - `<SettingsTablesTab :store />` — "Thêm bàn" **1 chạm** (mã tự đánh số), "Tạo lại QR" (hỏi xác nhận, token cũ chết ngay), "Thu hồi"/"Dùng lại". Link QR chỉ hiện đúng một lần lúc tạo/tạo lại.

- [ ] **Step 1: Cài thư viện QR (pin chính xác)**

Run:

```bash
npm install --save-exact qrcode@1.5.4
npm install --save-dev --save-exact @types/qrcode@1.5.6
```

Expected: `package.json` có `"qrcode": "1.5.4"` (dependencies) và `"@types/qrcode": "1.5.6"` (devDependencies), không có `^`/`~`; `package-lock.json` được cập nhật.

- [ ] **Step 2: Viết unit test thất bại cho `qr.ts`**

`tests/unit/app/qr.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { escapeHtml, qrDataUrl, qrFilename } from '../../../app/utils/qr'

describe('qrDataUrl', () => {
  it('returns a PNG data url', async () => {
    const url = await qrDataUrl('https://zeno.vn/s/tra-sua?t=abc')
    expect(url.startsWith('data:image/png;base64,')).toBe(true)
    const bytes = Buffer.from(url.split(',')[1]!, 'base64')
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  })

  it('encodes different links into different images', async () => {
    expect(await qrDataUrl('https://zeno.vn/s/a?t=1')).not.toBe(await qrDataUrl('https://zeno.vn/s/a?t=2'))
  })
})

describe('qrFilename', () => {
  it('builds an ascii file name from the store slug and the table name', () => {
    expect(qrFilename('tra-sua-may', 'Bàn 05')).toBe('qr-tra-sua-may-ban-05.png')
    expect(qrFilename('a', 'Bàn cửa sổ')).toBe('qr-a-ban-cua-so.png')
  })

  it('falls back to "ban" when the name has no usable characters', () => {
    expect(qrFilename('a', '???')).toBe('qr-a-ban.png')
  })
})

describe('escapeHtml', () => {
  it('escapes markup characters', () => {
    expect(escapeHtml('<img src=x onerror="a()">&\'')).toBe('&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;')
  })
})
```

- [ ] **Step 3: Viết E2E thất bại**

Thêm vào cuối `tests/e2e/settings-catalog.spec.ts`:

```ts
test('owner adds a table in one tap, downloads the QR, and regenerate kills the old link', async ({ page, browser }, testInfo) => {
  const { slug } = await signUpAndOnboard(page, testInfo, 'Quán Bàn QR')
  await page.goto('/app/settings?tab=tables')

  await page.getByRole('button', { name: 'Thêm bàn' }).click()
  const dialog = page.getByRole('dialog')
  const qrImage = dialog.getByRole('img', { name: 'Mã QR Bàn 01' })
  await expect(qrImage).toBeVisible()
  await expect(qrImage).toHaveAttribute('src', /^data:image\/png;base64,/)
  const firstLink = await dialog.getByLabel('Link bàn').inputValue()
  const asPath = (link: string) => `${new URL(link).pathname}${new URL(link).search}`

  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Tải ảnh PNG' }).click()])
  expect(download.suggestedFilename()).toBe(`qr-${slug}-ban-01.png`)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('listitem').filter({ hasText: 'Bàn 01' })).toBeVisible()
  await expect(page.getByLabel('Link bàn')).toHaveCount(0)

  // The customer scans the QR (a fresh context, no login).
  const customerContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width: 360, height: 740 } })
  const customer = await customerContext.newPage()
  await customer.goto(asPath(firstLink))
  await expect(customer.getByText('Bàn 01', { exact: true })).toBeVisible()
  await customer.goto(asPath(firstLink).replace(/t=.{6}/, 't=XXXXXX'))
  await expect(customer.getByText(/Mã QR không hợp lệ/)).toBeVisible()
  await expect(customer.getByText('Bàn 01', { exact: true })).toBeHidden()

  // Regenerate: the old link dies immediately, the new one works.
  page.once('dialog', confirm => void confirm.accept())
  await page.getByRole('button', { name: 'Tạo lại QR Bàn 01' }).click()
  const secondLink = await page.getByRole('dialog').getByLabel('Link bàn').inputValue()
  expect(secondLink).not.toBe(firstLink)
  await customer.goto(asPath(firstLink))
  await expect(customer.getByText(/Mã QR không hợp lệ/)).toBeVisible()
  await customer.goto(asPath(secondLink))
  await expect(customer.getByText('Bàn 01', { exact: true })).toBeVisible()

  // Revoke: the new link stops working too.
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Thu hồi Bàn 01' }).click()
  await expect(page.getByRole('button', { name: 'Dùng lại Bàn 01' })).toBeVisible()
  await customer.goto(asPath(secondLink))
  await expect(customer.getByText(/Mã QR không hợp lệ/)).toBeVisible()
  await customerContext.close()
})
```

- [ ] **Step 4: Chạy test để xác nhận thất bại**

Run: `npx vitest run --project unit tests/unit/app/qr.test.ts`
Expected: FAIL — `app/utils/qr` chưa tồn tại.

- [ ] **Step 5: Viết `qr.ts`**

`app/utils/qr.ts`:

```ts
import { slugify } from '#shared/schemas/identity'

type QrModule = typeof import('qrcode')

export async function qrDataUrl(text: string, width = 512): Promise<string> {
  const loaded = (await import('qrcode')) as QrModule & { default?: QrModule }
  const qr = loaded.default ?? loaded
  return qr.toDataURL(text, { width, margin: 2, errorCorrectionLevel: 'M' })
}

export function qrFilename(storeSlug: string, tableName: string): string {
  return `qr-${storeSlug}-${slugify(tableName) || 'ban'}.png`
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export function printQr(dataUrl: string, title: string): void {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0'
  frame.onload = () => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    setTimeout(() => frame.remove(), 1000)
  }
  frame.srcdoc = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>`
    + '<style>body{font-family:sans-serif;text-align:center;margin:0;padding:24px}img{width:320px;height:320px}h1{font-size:28px}</style>'
    + `</head><body><h1>${escapeHtml(title)}</h1><img src="${dataUrl}" alt=""><p>Quét mã để gọi món</p></body></html>`
  document.body.appendChild(frame)
}
```

Trong `nuxt.config.ts` thay dòng `optimizeDeps` (old_str: `optimizeDeps: { include: ['@neon/auth', 'zod'] },`) bằng:

```ts
    optimizeDeps: { include: ['@neon/auth', 'zod', 'qrcode'] },
```

- [ ] **Step 6: Viết sheet QR và tab bàn**

`app/components/settings/TableQrSheet.vue`:

```vue
<script setup lang="ts">
import { downloadDataUrl, printQr, qrDataUrl, qrFilename } from '~/utils/qr'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ title: string, url: string, slug: string }>()

const dataUrl = ref('')
const failed = ref(false)

watch(
  [() => open.value, () => props.url],
  async ([isOpen, url]) => {
    if (!isOpen || !url) return
    failed.value = false
    try {
      dataUrl.value = await qrDataUrl(url)
    }
    catch {
      dataUrl.value = ''
      failed.value = true
    }
  },
  { immediate: true },
)
</script>

<template>
  <ZSheet v-model:open="open" :title="`Mã QR ${title}`" description="Mã này chỉ hiện một lần. Hãy tải về hoặc in ngay.">
    <div class="flex flex-col items-center gap-4">
      <ZAlert v-if="failed" color="error" title="Không tạo được ảnh QR, hãy thử lại" />
      <img v-else-if="dataUrl" :src="dataUrl" :alt="`Mã QR ${title}`" width="256" height="256" class="size-64 rounded-md bg-white p-2">
      <USkeleton v-else class="size-64 rounded-md" aria-label="Đang tạo mã QR" />
      <AppCopyField :value="url" label="Link bàn" class="w-full" />
    </div>
    <template #footer>
      <div class="flex gap-3">
        <ZButton class="flex-1" icon="i-lucide-download" :disabled="!dataUrl" @click="downloadDataUrl(dataUrl, qrFilename(slug, title))">
          Tải ảnh PNG
        </ZButton>
        <ZButton class="flex-1" variant="secondary" icon="i-lucide-printer" :disabled="!dataUrl" @click="printQr(dataUrl, title)">
          In
        </ZButton>
      </div>
    </template>
  </ZSheet>
</template>
```

`app/components/settings/TablesTab.vue`:

```vue
<script setup lang="ts">
import type { TableDTO, TableWithQr } from '#shared/types/catalog'
import type { StoreDetail } from '#shared/types/identity'

const props = defineProps<{ store: StoreDetail }>()

const api = useApi()
const toast = useToast()

const tables = ref<TableDTO[]>([])
const status = ref<'pending' | 'success' | 'error'>('pending')
const adding = ref(false)
const busyId = ref<string | null>(null)
const qr = reactive({ open: false, title: '', url: '' })

const baseUrl = computed(() => `/api/stores/${props.store.id}/tables`)

const toDto = (table: TableDTO): TableDTO => ({ id: table.id, code: table.code, displayName: table.displayName, active: table.active })

function showQr(table: TableWithQr) {
  qr.title = table.displayName
  qr.url = table.qrUrl
  qr.open = true
}

async function load() {
  status.value = 'pending'
  try {
    tables.value = (await api<{ tables: TableDTO[] }>(baseUrl.value)).tables
    status.value = 'success'
  }
  catch {
    status.value = 'error'
  }
}
load()

async function addTable() {
  if (adding.value) return
  adding.value = true
  try {
    const created = await api<TableWithQr>(baseUrl.value, { method: 'POST', body: {} })
    tables.value = [...tables.value, toDto(created)]
    showQr(created)
  }
  catch (err) {
    toast.add({ color: 'error', title: extractApiError(err).message })
  }
  finally {
    adding.value = false
  }
}

async function regenerate(table: TableDTO) {
  if (!window.confirm(`Mã QR cũ của ${table.displayName} sẽ ngừng hoạt động ngay. Tiếp tục?`)) return
  busyId.value = table.id
  try {
    const renewed = await api<TableWithQr>(`${baseUrl.value}/${table.id}/regenerate`, { method: 'POST' })
    tables.value = tables.value.map(item => (item.id === table.id ? toDto(renewed) : item))
    showQr(renewed)
  }
  catch (err) {
    toast.add({ color: 'error', title: extractApiError(err).message })
  }
  finally {
    busyId.value = null
  }
}

async function setActive(table: TableDTO, active: boolean) {
  busyId.value = table.id
  try {
    const updated = await api<TableDTO>(`${baseUrl.value}/${table.id}`, { method: 'PATCH', body: { active } })
    tables.value = tables.value.map(item => (item.id === table.id ? updated : item))
  }
  catch (err) {
    toast.add({ color: 'error', title: extractApiError(err).message })
  }
  finally {
    busyId.value = null
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <ZCard title="Bàn & mã QR" description="Mỗi bàn có một mã QR riêng. Mã chỉ hiện một lần khi tạo. Quên tải về thì bấm Tạo lại QR." padding="lg">
      <div class="flex flex-col gap-4">
        <ZButton size="lg" block icon="i-lucide-plus" :loading="adding" @click="addTable">
          Thêm bàn
        </ZButton>

        <div v-if="status === 'pending' && tables.length === 0" class="flex flex-col gap-3" aria-busy="true" aria-label="Đang tải danh sách bàn">
          <USkeleton v-for="i in 2" :key="i" class="h-16 w-full rounded-md" />
        </div>

        <ZAlert v-else-if="status === 'error'" color="error" title="Không tải được danh sách bàn">
          <template #actions>
            <ZButton variant="secondary" size="sm" icon="i-lucide-refresh-cw" @click="load()">
              Thử lại
            </ZButton>
          </template>
        </ZAlert>

        <AppEmptyState
          v-else-if="tables.length === 0"
          icon="i-lucide-qr-code"
          title="Chưa có bàn nào"
          description="Bấm Thêm bàn để tạo bàn đầu tiên và mã QR của bàn đó."
        />

        <ul v-else class="flex flex-col gap-3">
          <li v-for="table in tables" :key="table.id" class="flex flex-col gap-3 rounded-md p-3 ring-1 ring-default">
            <div class="flex items-center justify-between gap-2">
              <p class="min-w-0 break-words font-medium text-default">
                {{ table.displayName }}
              </p>
              <ZBadge :status="table.active ? 'success' : 'neutral'" size="sm">
                {{ table.active ? 'Đang dùng' : 'Đã thu hồi' }}
              </ZBadge>
            </div>
            <div class="flex flex-wrap gap-2">
              <ZButton variant="secondary" size="sm" icon="i-lucide-refresh-cw" :loading="busyId === table.id" :aria-label="`Tạo lại QR ${table.displayName}`" @click="regenerate(table)">
                Tạo lại QR
              </ZButton>
              <ZButton
                v-if="table.active"
                variant="ghost"
                size="sm"
                icon="i-lucide-ban"
                :disabled="busyId === table.id"
                :aria-label="`Thu hồi ${table.displayName}`"
                @click="setActive(table, false)"
              >
                Thu hồi
              </ZButton>
              <ZButton
                v-else
                variant="ghost"
                size="sm"
                icon="i-lucide-rotate-ccw"
                :disabled="busyId === table.id"
                :aria-label="`Dùng lại ${table.displayName}`"
                @click="setActive(table, true)"
              >
                Dùng lại
              </ZButton>
            </div>
          </li>
        </ul>
      </div>
    </ZCard>

    <SettingsTableQrSheet v-model:open="qr.open" :title="qr.title" :url="qr.url" :slug="store.slug" />
  </div>
</template>
```

- [ ] **Step 7: Nối tab vào `settings.vue`**

Trong `app/pages/app/settings.vue` (old_str: dòng `      <SettingsFulfillmentTab v-if="tab === 'fulfillment'" :store="store" @changed="onFulfillmentChanged" />`):

```vue
      <SettingsFulfillmentTab v-if="tab === 'fulfillment'" :store="store" @changed="onFulfillmentChanged" />
      <SettingsTablesTab v-if="tab === 'tables'" :store="store" />
```

- [ ] **Step 8: Chạy test để xác nhận đạt**

Run:

```bash
npx vitest run --project unit tests/unit/app/qr.test.ts
npx playwright test tests/e2e/settings-catalog.spec.ts
npm run lint -- app nuxt.config.ts
npm run typecheck
```

Expected: PASS. (Phần khách mở link bàn dùng trang `/s/[slug]` đầy đủ của Task 17, đã làm trước task này.)

- [ ] **Step 9: Commit**

```bash
git add app/utils/qr.ts app/components/settings app/pages/app/settings.vue nuxt.config.ts package.json package-lock.json tests
git commit -m "feat(catalog): add tables and QR codes to settings

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 19: Hành trình E2E end-to-end, ghi chú spec/roadmap, kiểm chứng toàn PR

**Files:**
- Create: `tests/e2e/catalog-journey.spec.ts`
- Modify: `docs/superpowers/specs/2026-10-31-zeno-mini-order-v1-design.md` (§2 bảng "Ảnh"), `docs/superpowers/plans/2026-10-31-zeno-v1-00-roadmap.md` (bảng "Plan files")

**Interfaces:**
- Consumes: toàn bộ Task 1–18 qua UI thật; `signUpAndOnboard` (Task 5).
- Produces: bằng chứng Exit của PR2 — owner tạo menu ≤ 3 thao tác, option, bàn/QR, bật nhận đơn 1 chạm; khách mở link chung/QR thấy menu + sheet option trên 360px; chưa có đặt đơn.

- [ ] **Step 1: Viết E2E hành trình (thất bại nếu thiếu bất kỳ mảnh nào ở Task 1–18)**

`tests/e2e/catalog-journey.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { expectNoHorizontalOverflow } from './support/layout'
import { signUpAndOnboard } from './support/owner'

test('owner sets up a store in a few taps and a customer opens the menu from the table QR', async ({ page, browser }, testInfo) => {
  const { slug } = await signUpAndOnboard(page, testInfo, 'Quán Hành Trình')

  // One tap to accept orders, no navigation.
  await page.getByRole('button', { name: 'Bật nhận đơn' }).click()
  await expect(page.getByText('Quán đang tạm nghỉ — khách không đặt được món')).toBeHidden()
  await expect(page).toHaveURL(/\/app\/orders$/)

  // Quick add: name, price, tap.
  await page.getByRole('link', { name: 'Thực đơn', exact: true }).click()
  await page.getByLabel('Tên món').fill('Trà sữa trân châu')
  await page.getByLabel('Giá (đ)').fill('35k')
  await page.getByRole('button', { name: 'Thêm món' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'Trà sữa trân châu' }).getByText('35.000đ')).toBeVisible()

  // A required size group.
  await page.getByRole('button', { name: 'Sửa Trà sữa trân châu' }).click()
  const editor = page.getByRole('dialog')
  await editor.getByRole('button', { name: 'Thêm nhóm option' }).click()
  await editor.getByLabel('Tên nhóm').fill('Size')
  await editor.getByLabel('Tên lựa chọn').first().fill('M')
  await editor.getByRole('button', { name: 'Thêm lựa chọn' }).click()
  await editor.getByLabel('Tên lựa chọn').nth(1).fill('L')
  await editor.getByLabel('Giá cộng thêm').nth(1).fill('5k')
  await editor.getByRole('button', { name: 'Lưu món' }).click()
  await expect(editor).toBeHidden()

  // One table, one tap; read its link from the one-time QR sheet.
  await page.goto('/app/settings?tab=tables')
  await page.getByRole('button', { name: 'Thêm bàn' }).click()
  const qrSheet = page.getByRole('dialog')
  await expect(qrSheet.getByRole('img', { name: 'Mã QR Bàn 01' })).toBeVisible()
  const link = new URL(await qrSheet.getByLabel('Link bàn').inputValue())
  await page.keyboard.press('Escape')

  // The customer scans the QR on a phone.
  const customerContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width: 360, height: 740 } })
  const customer = await customerContext.newPage()
  await customer.goto(`${link.pathname}${link.search}`)
  await expect(customer.getByRole('heading', { level: 1 })).toHaveText('Quán Hành Trình')
  await expect(customer.getByText('Đang nhận đơn', { exact: true })).toBeVisible()
  await expect(customer.getByText('Bàn 01', { exact: true })).toBeVisible()
  await customer.getByRole('button', { name: 'Thêm Trà sữa trân châu' }).click()
  const sheet = customer.getByRole('dialog')
  await expect(sheet.getByRole('button', { name: 'Thêm • 35.000đ' })).toBeVisible()
  await sheet.getByText('L', { exact: true }).click()
  await expect(sheet.getByRole('button', { name: 'Thêm • 40.000đ' })).toBeVisible()
  await sheet.getByRole('button', { name: 'Thêm • 40.000đ' }).click()
  await expect(customer.getByText('Giỏ • 1 món')).toBeVisible()
  await expectNoHorizontalOverflow(customer)

  // The shared link (no ?t=) shows the same menu without a table.
  await customer.goto(`/s/${slug}`)
  await expect(customer.getByText('Bàn 01', { exact: true })).toBeHidden()
  await expect(customer.getByText('Trà sữa trân châu')).toBeVisible()
  await customerContext.close()
})
```

- [ ] **Step 2: Ghi chú lệch spec và cập nhật roadmap**

Trong `docs/superpowers/specs/2026-10-31-zeno-mini-order-v1-design.md` §2 (old_str: `upload bằng presigned PUT. Bucket`):

```
upload qua server (multipart ≤ 2 MB, kiểm tra magic bytes JPG/PNG/WebP; key `stores/<storeId>/products/<productId>/<token>.<ext>`, xoá ảnh cũ sau khi ghi DB) vì CORS của Neon Storage cho browser PUT chưa được xác minh. Bucket
```

Trong `docs/superpowers/plans/2026-10-31-zeno-v1-00-roadmap.md`, bảng "Plan files", thay đúng dòng sau:

```
| 2 | `feat(catalog)` | `2026-10-31-zeno-v1-03-catalog.md` | Outline bên dưới, viết chi tiết khi PR1 merge |
```

bằng:

```
| 2 | `feat(catalog)` | [2026-10-31-zeno-v1-03-catalog.md](./2026-10-31-zeno-v1-03-catalog.md) | **Chi tiết, sẵn sàng thực thi** |
```

- [ ] **Step 3: Chạy toàn bộ kiểm chứng**

Run lần lượt (mỗi lệnh phải xanh trước khi sang lệnh sau):

```bash
npm run db:check
npm run lint
npm run typecheck
npm run test
npm run test:integration
npm run test:api
npm run build
npx playwright test
```

Expected: tất cả PASS. Nếu một test E2E của PR1 (`onboarding.spec.ts`, `ui-foundation.spec.ts`) đỏ vì nav có thêm mục "Thực đơn" hoặc settings có thanh tab, sửa **code sản phẩm** hoặc cập nhật selector trong test cho đúng ý định (không nới assertion về chiều cao 44px/overflow).

- [ ] **Step 4: Kiểm tra thủ công nhanh (mobile 360px)**

Run: `npm run dev`, mở `http://localhost:3000` bằng DevTools 360×740 và xác nhận:
1. Đăng ký → onboarding → `/app/orders`: banner "Quán đang tạm nghỉ" có nút "Bật nhận đơn"; bấm 1 lần, banner biến mất, đầu trang đổi thành "Đang nhận đơn".
2. Empty state có nút "Xem trang khách" mở tab mới `/s/<slug>` hiện "Menu đang được cập nhật".
3. `/app/menu`: gõ `Trà sữa` + `35k` + bấm "Thêm món" → món hiện `35.000đ`, ô tên được xoá và focus lại.
4. Settings: 3 tab, không scroll ngang trang; tab "Bàn & QR" tạo được bàn và tải được PNG.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/catalog-journey.spec.ts docs
git commit -m "test(catalog): add end-to-end catalog journey and record spec notes

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Lệch so với roadmap (có chủ đích)

| Điểm | Roadmap | Plan này | Lý do |
|---|---|---|---|
| Thứ tự task | Public API/UI ở task 5 và 7 | Public API + trang `/s/[slug]` ở Task 3–4, nút 1 chạm ở Task 5 | Yêu cầu: link công khai chạy sớm, owner ít thao tác nhất |
| `products.category_id` | Không nói rõ | `nullable` | Quick add chỉ cần tên + giá, store mới chưa có danh mục |
| `modes` trong public API | Chỉ ghi tên | `{ dineIn, pickup, delivery: { enabled, available } }` | Cần để UI/PR3 biết giao hàng có dùng được không (roadmap Task 4: `delivery.available=false`) |
| `defaultSelection` | "giá trị đầu tiên còn active của nhóm required" | Lấy `max(minSelect, 1)` giá trị đầu tiên còn active | Giữ đúng với `minSelect > 1`; trùng kết quả khi `minSelect = 1` |
| Hàm bổ sung trong `shared/pricing.ts` | — | `toggleSelection`, `selectionDeltas`, `toOptionRules` | UI sheet option và PR3 dùng chung, tránh lặp logic |
| Delivery zones | "CRUD" | Không có `DELETE`; tắt bằng `active=false` | Spec §4.4 soft-disable; PR3 sẽ có FK từ `orders` |
| Mã bàn | `code`, `display_name` | `code` tự đánh số khi bỏ trống (advisory lock) | "Thêm bàn" 1 chạm |
| Regenerate bàn | Token cũ chết ngay | Đồng thời kích hoạt lại bàn (`active = true`) | Luồng "thu hồi → tạo lại QR" không cần thêm bước |
| Cache menu | `max-age=30, s-maxage=60` | Giữ nguyên | Lưu ý: bật/tắt nhận đơn có thể chậm tới 60 s mới hiện trên trang khách (CDN); PR3 `createOrder` vẫn kiểm `is_accepting_orders` thật ở server |
| Upload ảnh | Qua server | Qua server + kiểm tra magic bytes, ghi chú vào spec §2 (Task 19) | Đã nêu ở roadmap; thêm kiểm tra nội dung file |
| Org `SUSPENDED` | Quy ước #6 áp dụng khi có tính năng tạm ngưng | `findPublicStoreBySlug` đã join `organizations.status = 'ACTIVE'` + test | Rẻ và an toàn cho route public; `findStoreAccess` vẫn chờ PR có tính năng tạm ngưng |
| Primitive | Không nêu | `ZSheet`, `ZTabs` (Task 13), prop `error` của `ZFormField` (Task 14) | UI foundation §1 đã hẹn thêm khi phase đầu cần |
