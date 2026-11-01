# ZENO Mini Order V1 — PR3 Ordering: Giỏ hàng, Checkout COD, Idempotency, Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khách đặt đơn trả khi nhận (COD) end-to-end cho cả ba hình thức nhận món (tại bàn, mang đi, giao hàng) trên điện thoại 360px, retry/double tap không bao giờ tạo đơn trùng, và theo dõi đơn ở `/o/:token` mà không cần tài khoản.

**Architecture:** `createOrder` là một service duy nhất chạy trong **một transaction**: khoá advisory theo `(store, idempotencyKey)`, đọc lại món/option theo `store_id`, tính lại tiền bằng `shared/pricing.ts`, so với giá khách đang thấy (`expectedUnitPriceVnd`, `expectedTotalVnd`) rồi mới ghi `orders` + `order_items` (snapshot tên/option/giá) + `order_events`. `guestToken` sinh ngẫu nhiên, DB lưu `sha256` (tra cứu) và bản mã hoá AES-256-GCM (để retry trả lại đúng token cũ). Giỏ hàng sống ở `localStorage` theo từng store; `pendingIdempotencyKey` gắn với "dấu vân tay" của payload nên retry giống hệt thì dùng lại key, sửa giỏ thì sang key mới.

**Tech Stack:** Nuxt 4.5.2, Nuxt UI 4.12.0 (qua `Z*` primitives), drizzle-orm 0.45.4 / drizzle-kit 0.31.11, zod 4.6.5, Node `crypto` (AES-256-GCM), vitest 5 + `@nuxt/test-utils`, Playwright 1.63.

**Spec:** [2026-10-31-zeno-mini-order-v1-design.md](../specs/2026-10-31-zeno-mini-order-v1-design.md) (§3.2, §4.3, §4.4, §5.1–5.3, §5.5, §9, §10) · PRD: [ZENO_MINI_ORDER_V1_IMPLEMENTATION_PLAN.md](../../ZENO_MINI_ORDER_V1_IMPLEMENTATION_PLAN.md) (§2.2 C3/C4, §4, §6, §7) · UI: [2026-10-31-ui-foundation-design.md](../specs/2026-10-31-ui-foundation-design.md) · Roadmap: [2026-10-31-zeno-v1-00-roadmap.md](./2026-10-31-zeno-v1-00-roadmap.md) (mục PR3) · PR2: [2026-10-31-zeno-v1-03-catalog.md](./2026-10-31-zeno-v1-03-catalog.md) · Phụ thuộc: PR0, PR1, PR2 đã merge.

## Global Constraints

Áp dụng "Global Constraints" và "Quy ước xuyên PR" của roadmap, copy nguyên văn các dòng PR này chạm tới:
- **Package manager:** npm, commit `package-lock.json`; pin version chính xác (không `^`/`~`). PR này **không thêm dependency mới**.
- **Runtime:** Node `>=24 <25`. Deploy Vercel.
- **Import:** server dùng import tường minh (`h3`, `zod`, `drizzle-orm`) và đường dẫn tương đối trong `server/`; `shared/` qua alias `#shared`. Không dùng `~/server/...`. Riêng `server/db/schema/**` import `shared/` bằng đường dẫn tương đối vì `drizzle-kit` không biết alias Nuxt.
- **Lớp kiến trúc:** route handler mỏng (parse → guard → service). Transaction chỉ nằm trong `server/services/**`. Repository luôn nhận `{orgId, storeId}` hoặc `StoreContext`.
- **Tenant:** mọi bảng thuộc store có `org_id`, `store_id`, composite FK `(org_id, store_id) → stores(org_id, id)`, `unique(store_id, id)`; bảng con tham chiếu `(store_id, parent_id)`. Ngoại lệ có chủ đích: `rate_limits` là bảng hạ tầng, không thuộc store. Không có quyền → **404**; thiếu role → **403**; thiếu/sai token → **401**.
- **Tiền:** VND `bigint` (mode `number`), số nguyên ≥ 0; server luôn tự tính lại; snapshot tên/option/giá vào `order_items`.
- **Kiểu dữ liệu:** id `uuid default gen_random_uuid()`; thời gian `timestamptz`; enum `pgEnum` đồng bộ `shared/enums.ts`.
- **Token:** 32 byte random base64url; DB chỉ lưu `sha256` hex (`server/utils/tokens.ts`, có từ PR2).
- **Secret:** mã hoá AES-256-GCM bằng `APP_ENCRYPTION_KEY` (`server/utils/crypto.ts`, có từ PR3); không bao giờ trả secret ra API; không đưa vào `runtimeConfig.public`.
- **Lỗi API:** `{ code, message, details? }`, code theo spec §9. Không thêm mã lỗi mới trong PR này.
- **Log:** qua `logger` (redact PII/secret); không log body webhook, chữ ký, SĐT, địa chỉ; **không để guest token lọt vào log đường dẫn** (Task 7).
- **UI:** tiếng Việt, mobile-first 360px, Nuxt UI v4, vùng bấm ≥ 44px, có trạng thái loading/empty/error ở mọi màn. `pages/` và `layouts/` chỉ dùng `Z*` (ESLint enforce); Nuxt UI trực tiếp chỉ trong `app/components/**`.
- **Thời gian báo cáo:** `Asia/Ho_Chi_Minh`.
- **Route public:** `/api/public/**` không cần token, response không chứa `orgId`, `storeId`, `customerPhone`, `address`, secret hay token hash; mọi route public có test quét khoá JSON.
- **Commit:** conventional commits `feat(order): …`, kèm trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

## Review Focus

PR này sở hữu Review Focus #7 (giá/món đổi giữa lúc thêm giỏ và lúc đặt) và #8 (retry/double tap) của roadmap, cộng năm tình huống thật mà spec không nói rõ:

1. **Khách gõ SĐT theo mọi kiểu quen tay** (`+84 912 345 678`, `0912.345.678`, `091-234-5678`, dán thừa khoảng trắng, đầu số `02…`, thiếu số) → kiểu hợp lệ được chuẩn hoá về `0912345678`; kiểu sai báo lỗi inline đúng ô SĐT (400 `VALIDATION_FAILED`, `details[].path = customer.phone`), không bao giờ 500 và không tạo đơn. → Task 2 (unit), Task 7 (API).
2. **Tên/địa chỉ/ghi chú chỉ toàn khoảng trắng, hoặc chứa HTML (`<img onerror=…>`), emoji, tiếng Việt có dấu tổ hợp** → khoảng trắng coi như trống (báo "Vui lòng nhập tên"); HTML được lưu và trả về **nguyên văn** như text, trang theo dõi hiển thị dạng chữ, không thực thi. → Task 2, Task 7, Task 10 (E2E).
3. **Link `/o/:token` bị chia sẻ/forward, hoặc token lọt vào log lỗi 5xx / header Referer** → trang không lộ SĐT đầy đủ, địa chỉ, `orgId`/`storeId`; `Referrer-Policy: no-referrer`, `noindex`; đường dẫn có token bị che trong log. → Task 7, Task 10.
4. **Quán đóng cửa, tắt hình thức nhận, tắt khu vực giao hoặc đổi phí giao đúng lúc khách đang ở giỏ** → 422 `STORE_CLOSED`/`MODE_DISABLED`/`INVALID_ZONE` hoặc 409 `CART_STALE` (kèm phí/tổng mới), giỏ **không mất**, khách thấy thông báo tiếng Việt rõ ràng và đặt lại được. → Task 5, Task 11.
5. **Trình duyệt không cho dùng `localStorage` (Safari private, hết quota, dữ liệu hỏng/bị sửa tay) hoặc mở trang qua `http://` LAN (không có `crypto.randomUUID`)** → giỏ rỗng/giữ trong bộ nhớ, trang không crash, vẫn sinh được `idempotencyKey` hợp lệ. → Task 8, Task 9.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `server/utils/crypto.ts` | `encryptSecret`, `decryptSecret`, `assertEncryptionKey` (AES-256-GCM, định dạng `v1.<iv>.<tag>.<ct>`) |
| `server/plugins/assert-encryption-key.ts` | fail-fast khi khởi động nếu `APP_ENCRYPTION_KEY` sai |
| `.env.example` (create), `.github/workflows/ci.yml` (modify) | tài liệu env + khoá test cho CI |
| `shared/enums.ts` | `FULFILLMENT_TYPES`, `ORDER_STATUSES`, `PAYMENT_METHODS`, `PAYMENT_STATUSES` + kiểu, `isTerminalStatus` |
| `shared/types/order.ts` | `OrderItemOptionSnapshot`, `CartStaleLine`, `CartStaleDetails`, `PaymentQr`, `CreateOrderResponse`, `PublicOrderView` |
| `shared/phone.ts` | `normalizeVnPhone`, `maskPhone` |
| `shared/schemas/checkout.ts` | `checkoutInputSchema`, `CHECKOUT_LIMITS`, `CheckoutInput`, `CheckoutBody` |
| `server/db/schema/ordering.ts` | enums + `orders`, `orderItems`, `orderEvents`, `rateLimits` |
| `drizzle/0002_ordering.sql` (generated) | migration |
| `tests/support/checkout-fixtures.ts` | `seedMenu`, `openStore`, `pickupBody`, `dineInBody`, `deliveryBody`, `insertRawOrder`, `seedCartJson` |
| `server/services/ordering/constants.ts` | `CHECKOUT_RATE_LIMIT`, `MAX_PUBLIC_CODE_ATTEMPTS` |
| `server/services/ordering/rate-limit.ts` | `consumeRateLimit` |
| `server/services/ordering/public-code.ts` | `PUBLIC_CODE_ALPHABET`, `generatePublicCode` |
| `server/services/ordering/create-order.ts` | `createOrder`, `CreateOrderResult`, `CreateOrderDeps` |
| `server/services/ordering/transitions.ts` | `nextStatuses`, `canCancel`, `ActorRole` |
| `server/services/ordering/public-view.ts` | `getPublicOrderView` |
| `server/utils/safe-path.ts` | `safePath` (che token trong đường dẫn khi log) |
| `server/api/public/stores/[slug]/orders.post.ts`, `server/api/public/orders/[token].get.ts` | route handler mỏng |
| `app/utils/uuid.ts`, `cart-storage.ts`, `checkout-body.ts`, `order-labels.ts`, `recent-orders.ts` | hàm thuần phía client (unit test được) |
| `app/composables/useCart.ts`, `useRecentOrders.ts`, `useVisiblePolling.ts` | state client |
| `app/components/order/{CartBar,CheckoutSheet,RecentOrders,StatusSteps}.vue` | UI giỏ + checkout + tiến độ |
| `app/pages/o/[token].vue` | C4 theo dõi đơn |
| `nuxt.config.ts` (modify) | `routeRules` cho `/o/**` |
| `tests/unit/**`, `tests/integration/**`, `tests/api/**`, `tests/nuxt/**`, `tests/e2e/**` | test theo từng task |

## Điểm nối với PR2 (đối chiếu trước khi bắt đầu)

PR2 đã chốt (xem plan PR2): schema `server/db/schema/catalog.ts` (`categories`, `products`, `productOptionGroups`, `productOptionValues`, `storeTables`, `deliveryZones`; cột `products.{basePriceVnd,isAvailable,active}`, `productOptionValues.{priceDeltaVnd,active}`, `storeTables.{displayName,tokenHash,active}`, `deliveryZones.{feeVnd,active}`), `server/utils/tokens.ts` (`generateToken`, `hashToken`), `shared/pricing.ts` (`validateSelection`, `defaultSelection`, `selectionDeltas`, `toOptionRules`, `priceLine`, `orderTotals`, `MAX_LINE_QUANTITY`), fixtures `createProduct/createOptionGroup/createTable/createZone` trong `tests/support/fixtures.ts`, API public `GET /api/public/stores/:slug/menu` và `/fulfillment`. Phần UI khách của PR2 Task 17 (`app/pages/s/[slug].vue`, `useCartDraft`, `shared/cart-draft.ts`, `menu/CartBar`) được **thay/nối** ở Task 11 (Step 0 đối chiếu, Step 7 thay); `ZSheet` (PR2 Task 13) được dùng làm khung bottom sheet của checkout.

- [ ] **Step 0: Đối chiếu tên PR2 trước khi viết code**

Run:

```bash
grep -nE "export const (categories|products|productOptionGroups|productOptionValues|storeTables|deliveryZones)\b" server/db/schema/catalog.ts
grep -nE "export (async )?function (generateToken|hashToken|validateSelection|selectionDeltas|toOptionRules|priceLine|orderTotals)\b" server/utils/tokens.ts shared/pricing.ts
grep -nE "export async function (createProduct|createOptionGroup|createTable|createZone)\b" tests/support/fixtures.ts
```

Expected: mỗi lệnh in đủ các tên. Nếu thiếu, dừng và sửa plan PR3 theo tên thật (không đổi PR2).

---

### Task 1: `server/utils/crypto.ts` — AES-256-GCM + `APP_ENCRYPTION_KEY`

**Files:**
- Create: `server/utils/crypto.ts`, `server/plugins/assert-encryption-key.ts`, `.env.example`, `tests/unit/server/crypto.test.ts`
- Modify: `.github/workflows/ci.yml`, `.env` và `.env.test` (không commit; đã bị `.gitignore`)

**Interfaces:**
- Consumes: `requireEnv(name: string): string` (`server/utils/env.ts`, PR0).
- Produces (PR3 `createOrder`, PR5 SePay secret, PR6 webhook dùng; giữ nguyên tên):
  - `encryptSecret(plain: string): string` — định dạng `v1.<iv>.<tag>.<ciphertext>`, mỗi phần base64url, IV 12 byte, tag 16 byte.
  - `decryptSecret(blob: string): string` — ném `Error('Invalid encrypted secret')` khi sai định dạng, bị sửa, hoặc sai key.
  - `assertEncryptionKey(): void` — ném lỗi nếu `APP_ENCRYPTION_KEY` thiếu hoặc không phải 32 byte base64.

- [ ] **Step 1: Viết unit test thất bại**

`tests/unit/server/crypto.test.ts`:

```ts
import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertEncryptionKey, decryptSecret, encryptSecret } from '../../../server/utils/crypto'

const KEY = randomBytes(32).toString('base64')

beforeEach(() => {
  vi.stubEnv('APP_ENCRYPTION_KEY', KEY)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

function tamper(blob: string, partIndex: number): string {
  const parts = blob.split('.')
  const bytes = Buffer.from(parts[partIndex]!, 'base64url')
  bytes[0] = bytes[0]! ^ 0x01
  parts[partIndex] = bytes.toString('base64url')
  return parts.join('.')
}

describe('encryptSecret / decryptSecret', () => {
  it.each(['', 'hmac-secret', 'Trà sữa 🧋 — bí mật', 'x'.repeat(5000)])('round-trips %j', (plain) => {
    expect(decryptSecret(encryptSecret(plain))).toBe(plain)
  })

  it('uses the v1.<iv>.<tag>.<ct> format with base64url parts', () => {
    const parts = encryptSecret('abc').split('.')
    expect(parts).toHaveLength(4)
    expect(parts[0]).toBe('v1')
    for (const part of parts.slice(1)) expect(part).toMatch(/^[A-Za-z0-9_-]*$/)
    expect(Buffer.from(parts[1]!, 'base64url')).toHaveLength(12)
    expect(Buffer.from(parts[2]!, 'base64url')).toHaveLength(16)
  })

  it('never reuses an IV, so equal plaintexts give different blobs', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'))
  })

  it.each([['iv', 1], ['tag', 2], ['ciphertext', 3]] as const)('rejects a tampered %s', (_label, index) => {
    const blob = encryptSecret('top-secret')
    expect(() => decryptSecret(tamper(blob, index))).toThrow('Invalid encrypted secret')
  })

  it('rejects a blob encrypted under another key', () => {
    const blob = encryptSecret('top-secret')
    vi.stubEnv('APP_ENCRYPTION_KEY', randomBytes(32).toString('base64'))
    expect(() => decryptSecret(blob)).toThrow('Invalid encrypted secret')
  })

  it.each(['', 'garbage', 'v2.a.b.c', 'v1.a.b', 'v1.a.b.c.d', 'v1...'])('rejects malformed blob %j', (blob) => {
    expect(() => decryptSecret(blob)).toThrow('Invalid encrypted secret')
  })

  it('reports a missing key instead of a generic failure', () => {
    const blob = encryptSecret('x')
    vi.stubEnv('APP_ENCRYPTION_KEY', '')
    expect(() => encryptSecret('x')).toThrow('Missing env APP_ENCRYPTION_KEY')
    expect(() => decryptSecret(blob)).toThrow('Missing env APP_ENCRYPTION_KEY')
  })
})

describe('assertEncryptionKey', () => {
  it('accepts a 32-byte base64 key', () => {
    expect(() => assertEncryptionKey()).not.toThrow()
  })

  it.each([
    ['missing', ''],
    ['16 bytes', randomBytes(16).toString('base64')],
    ['33 bytes', randomBytes(33).toString('base64')],
    ['not base64', 'this is not base64!!'],
    ['hex instead of base64', randomBytes(32).toString('hex')],
  ])('rejects a %s key', (_label, value) => {
    vi.stubEnv('APP_ENCRYPTION_KEY', value)
    expect(() => assertEncryptionKey()).toThrow('APP_ENCRYPTION_KEY')
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `npx vitest run --project unit tests/unit/server/crypto.test.ts`
Expected: FAIL — `Cannot find module '../../../server/utils/crypto'`.

- [ ] **Step 3: Viết `server/utils/crypto.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { requireEnv } from './env'

const ENV_NAME = 'APP_ENCRYPTION_KEY'
const VERSION = 'v1'
const IV_BYTES = 12
const TAG_BYTES = 16
// 32 bytes in canonical base64 are always 43 characters followed by a single "=".
const KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/

function loadKey(): Buffer {
  const raw = requireEnv(ENV_NAME)
  if (!KEY_PATTERN.test(raw)) throw new Error(`${ENV_NAME} must be 32 bytes encoded as base64`)
  return Buffer.from(raw, 'base64')
}

export function assertEncryptionKey(): void {
  loadKey()
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', loadKey(), iv, { authTagLength: TAG_BYTES })
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [VERSION, iv, cipher.getAuthTag(), ciphertext].map(part => (typeof part === 'string' ? part : part.toString('base64url'))).join('.')
}

export function decryptSecret(blob: string): string {
  const parts = blob.split('.')
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('Invalid encrypted secret')
  const iv = Buffer.from(parts[1]!, 'base64url')
  const tag = Buffer.from(parts[2]!, 'base64url')
  const ciphertext = Buffer.from(parts[3]!, 'base64url')
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error('Invalid encrypted secret')

  const key = loadKey()
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES })
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  }
  catch {
    throw new Error('Invalid encrypted secret')
  }
}
```

- [ ] **Step 4: Chạy test để xác nhận đạt**

Run: `npx vitest run --project unit tests/unit/server/crypto.test.ts`
Expected: PASS.

- [ ] **Step 5: Fail-fast khi khởi động + tài liệu env + CI**

`server/plugins/assert-encryption-key.ts` (`defineNitroPlugin` là auto-import của Nitro; đây là chỗ duy nhất ngoại lệ quy tắc import tường minh vì `nitropack` không phải dependency trực tiếp):

```ts
import { assertEncryptionKey } from '../utils/crypto'

// Crash on boot rather than at the first checkout, so a bad deploy is caught by the platform health check.
export default defineNitroPlugin(() => {
  assertEncryptionKey()
})
```

Tạo `.env.example` (file này được commit; `.gitignore` đã có `!.env.example`):

```bash
# Postgres (Neon). Migration dùng bản UNPOOLED.
DATABASE_URL=
DATABASE_URL_UNPOOLED=
NEON_BRANCH=

# Neon Auth
NEON_AUTH_BASE_URL=
NEON_AUTH_JWKS_URL=

# Neon Object Storage (S3-compatible)
AWS_ENDPOINT_URL_S3=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=

# URL gốc của app, dùng dựng link tuyệt đối (QR bàn, link theo dõi đơn)
APP_BASE_URL=http://localhost:3000

# AES-256-GCM cho secret lưu trong DB và guest token. Đúng 32 byte, base64.
# Sinh khoá:  openssl rand -base64 32
# Mỗi môi trường (dev, test, Vercel Preview, Vercel Production) dùng khoá riêng; không commit khoá thật.
APP_ENCRYPTION_KEY=

# Chỉ test/CI
ZENO_TEST_DB=
```

Sinh khoá cho máy dev và branch test (hai file này bị `.gitignore`, **không commit**):

```bash
printf 'APP_ENCRYPTION_KEY=%s\n' "$(openssl rand -base64 32)" >> .env
printf 'APP_ENCRYPTION_KEY=%s\n' "$(openssl rand -base64 32)" >> .env.test
grep -c '^APP_ENCRYPTION_KEY=' .env .env.test
```

Expected: mỗi file in `1`.

Trong `.github/workflows/ci.yml`, job `integration`, thêm step ngay sau `- run: npm ci` (khoá sinh mới mỗi lần chạy, nên không cần secret của repo):

```yaml
      - name: Generate APP_ENCRYPTION_KEY
        run: |
          key="$(openssl rand -base64 32)"
          echo "::add-mask::$key"
          echo "APP_ENCRYPTION_KEY=$key" >> "$GITHUB_ENV"
```

Thêm biến cho Vercel (thủ công, một lần, không nằm trong git):

```bash
openssl rand -base64 32 | vercel env add APP_ENCRYPTION_KEY production
openssl rand -base64 32 | vercel env add APP_ENCRYPTION_KEY preview
```

- [ ] **Step 6: Xác nhận plugin chặn khởi động khi khoá sai và API test vẫn chạy**

Run:

```bash
npm run build
APP_ENCRYPTION_KEY=short PORT=3199 node .output/server/index.mjs; echo "exit=$?"
npm run test:api -- tests/api/health.test.ts
```

Expected: lệnh thứ hai in lỗi chứa `APP_ENCRYPTION_KEY must be 32 bytes encoded as base64` và `exit=` khác 0 (server không lắng nghe); lệnh thứ ba PASS (khoá hợp lệ nằm trong `.env.test`).

- [ ] **Step 7: Commit**

```bash
git add server/utils/crypto.ts server/plugins/assert-encryption-key.ts tests/unit/server/crypto.test.ts .env.example .github/workflows/ci.yml
git commit -m "feat(order): add AES-256-GCM secret encryption with fail-fast key check" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: `shared/enums.ts`, `shared/phone.ts`, `shared/schemas/checkout.ts`

**Files:**
- Create: `shared/enums.ts`, `shared/types/order.ts`, `shared/phone.ts`, `shared/schemas/checkout.ts`, `tests/unit/shared/enums.test.ts`, `tests/unit/shared/phone.test.ts`, `tests/unit/shared/checkout-schema.test.ts`
- Modify: `docs/superpowers/plans/2026-10-31-zeno-v1-00-roadmap.md` (ghi các điểm lệch vào outline PR3, theo quy tắc "muốn lệch thì cập nhật outline trước")

**Interfaces:**
- Consumes: `zod` (4.6.5).
- Produces (server, client, PR4–PR6 dùng; giữ nguyên tên):
  - `shared/enums.ts`: `FULFILLMENT_TYPES = ['DINE_IN','PICKUP','DELIVERY']`, `ORDER_STATUSES = ['AWAITING_PAYMENT','NEW','PREPARING','READY','DELIVERING','COMPLETED','CANCELLED']`, `PAYMENT_METHODS = ['BANK_QR','PAY_ON_RECEIPT']`, `PAYMENT_STATUSES = ['UNPAID','PENDING','PAID','REVIEW_REQUIRED','REFUND_DUE','REFUNDED']` (đều `as const`), kiểu `FulfillmentType`, `OrderStatus`, `PaymentMethod`, `PaymentStatus`, và `isTerminalStatus(status: OrderStatus): boolean` (`COMPLETED`, `CANCELLED`).
  - `shared/types/order.ts`:
    - `interface OrderItemOptionSnapshot { groupId: string; groupName: string; valueId: string; valueName: string; priceDeltaVnd: number }` (hình dạng của `order_items.options_snapshot_json`)
    - `type CartStaleReason = 'PRODUCT_UNAVAILABLE' | 'OPTION_INVALID' | 'PRICE_CHANGED'`
    - `interface CartStaleLine { index: number; productId: string; name: string | null; reason: CartStaleReason; currentUnitPriceVnd: number | null }`
    - `interface CartStaleDetails { lines: CartStaleLine[]; deliveryFeeVnd: number | null; totalVnd: number | null }`
    - `interface PaymentQr { bankName: string; accountNumber: string; accountHolder: string; amountVnd: number; transferContent: string; imageUrl: string; expiresAt: string }` (PR5 điền)
    - `interface CreateOrderResponse { publicCode: string; guestToken: string; status: OrderStatus; paymentStatus: PaymentStatus; totalVnd: number; qr?: PaymentQr }`
    - `interface PublicOrderItem`, `interface PublicOrderView` (hình dạng đầy đủ ở Step 4)
  - `shared/phone.ts`: `normalizeVnPhone(input: string): string | null`, `maskPhone(phone: string | null): string | null`.
  - `shared/schemas/checkout.ts`: `CHECKOUT_LIMITS`, `checkoutInputSchema`, kiểu `CheckoutInput` (output đã chuẩn hoá) và `CheckoutBody` (input thô).

- [ ] **Step 1: Viết unit test thất bại cho enums và phone**

`tests/unit/shared/enums.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { FULFILLMENT_TYPES, isTerminalStatus, ORDER_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES } from '#shared/enums'

describe('shared enums', () => {
  it('lists the values defined by the spec, in state-machine order', () => {
    expect(FULFILLMENT_TYPES).toEqual(['DINE_IN', 'PICKUP', 'DELIVERY'])
    expect(ORDER_STATUSES).toEqual(['AWAITING_PAYMENT', 'NEW', 'PREPARING', 'READY', 'DELIVERING', 'COMPLETED', 'CANCELLED'])
    expect(PAYMENT_METHODS).toEqual(['BANK_QR', 'PAY_ON_RECEIPT'])
    expect(PAYMENT_STATUSES).toEqual(['UNPAID', 'PENDING', 'PAID', 'REVIEW_REQUIRED', 'REFUND_DUE', 'REFUNDED'])
  })

  it('treats only COMPLETED and CANCELLED as terminal', () => {
    expect(ORDER_STATUSES.filter(isTerminalStatus)).toEqual(['COMPLETED', 'CANCELLED'])
  })
})
```

`tests/unit/shared/phone.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { maskPhone, normalizeVnPhone } from '#shared/phone'

describe('normalizeVnPhone', () => {
  it.each([
    ['0912345678', '0912345678'],
    ['+84912345678', '0912345678'],
    ['84912345678', '0912345678'],
    ['0912 345 678', '0912345678'],
    ['0912.345.678', '0912345678'],
    ['091-234-5678', '0912345678'],
    ['  (+84) 912 345 678  ', '0912345678'],
    ['0351234567', '0351234567'],
    ['0561234567', '0561234567'],
    ['0771234567', '0771234567'],
    ['0881234567', '0881234567'],
  ])('accepts %j as %s', (input, expected) => {
    expect(normalizeVnPhone(input)).toBe(expected)
  })

  it.each([
    '',
    '   ',
    'abcdefghij',
    '091234567',
    '09123456789',
    '0212345678',
    '0412345678',
    '0612345678',
    '0112345678',
    '+8491234567',
    '+840912345678',
    '+1 415 555 0132',
    '0912 345 67a',
  ])('rejects %j', (input) => {
    expect(normalizeVnPhone(input)).toBeNull()
  })
})

describe('maskPhone', () => {
  it('keeps only the last 3 digits', () => {
    expect(maskPhone('0912345678')).toBe('*******678')
  })

  it('passes null through and never throws on short input', () => {
    expect(maskPhone(null)).toBeNull()
    expect(maskPhone('12')).toBe('12')
  })
})
```

- [ ] **Step 2: Viết unit test thất bại cho schema checkout**

`tests/unit/shared/checkout-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CHECKOUT_LIMITS, checkoutInputSchema } from '#shared/schemas/checkout'

const UUID_A = '3f6c1a52-8d0e-4b7a-9c11-2e5d7f0a9b34'
const UUID_B = '6a1d2c33-5b4e-4f10-8a77-0c9e1d2b3a45'
const UUID_C = '9b8a7c66-1d2e-4a3b-8c4d-5e6f7a8b9c01'

const item = { productId: UUID_B, quantity: 2, optionValueIds: [UUID_C], expectedUnitPriceVnd: 35000 }

function body(over: Record<string, unknown> = {}) {
  return {
    idempotencyKey: UUID_A,
    fulfillmentType: 'PICKUP',
    customer: { name: 'Lan', phone: '0912345678' },
    items: [item],
    paymentMethod: 'PAY_ON_RECEIPT',
    expectedTotalVnd: 70000,
    ...over,
  }
}

function issuePaths(raw: unknown): string[] {
  const result = checkoutInputSchema.safeParse(raw)
  return result.success ? [] : result.error.issues.map(issue => issue.path.join('.'))
}

describe('checkoutInputSchema — happy paths', () => {
  it('normalises a pickup order', () => {
    const parsed = checkoutInputSchema.parse(body({ customer: { name: '  Lan  ', phone: '+84 912 345 678' }, note: '  ít đá ' }))
    expect(parsed).toEqual({
      idempotencyKey: UUID_A,
      fulfillmentType: 'PICKUP',
      tableToken: null,
      customer: { name: 'Lan', phone: '0912345678', address: null },
      deliveryZoneId: null,
      items: [{ productId: UUID_B, quantity: 2, optionValueIds: [UUID_C], note: null, expectedUnitPriceVnd: 35000 }],
      expectedTotalVnd: 70000,
      paymentMethod: 'PAY_ON_RECEIPT',
      note: 'ít đá',
    })
  })

  it('accepts dine-in with only a table token and nothing about the customer', () => {
    const parsed = checkoutInputSchema.parse(body({ fulfillmentType: 'DINE_IN', tableToken: 'x'.repeat(43), customer: {} }))
    expect(parsed.tableToken).toBe('x'.repeat(43))
    expect(parsed.customer).toEqual({ name: null, phone: null, address: null })
  })

  it('accepts a complete delivery order and keeps the address', () => {
    const parsed = checkoutInputSchema.parse(body({
      fulfillmentType: 'DELIVERY',
      deliveryZoneId: UUID_C,
      customer: { name: 'Lan', phone: '0912345678', address: ' 12 Lê Lợi, Quận 1 ' },
    }))
    expect(parsed.deliveryZoneId).toBe(UUID_C)
    expect(parsed.customer.address).toBe('12 Lê Lợi, Quận 1')
  })

  it('drops fields that do not belong to the fulfillment type', () => {
    const parsed = checkoutInputSchema.parse(body({
      tableToken: 'y'.repeat(43),
      deliveryZoneId: UUID_C,
      customer: { name: 'Lan', phone: '0912345678', address: 'Không dùng' },
    }))
    expect(parsed).toMatchObject({ tableToken: null, deliveryZoneId: null, customer: { address: null } })
  })

  it('defaults optionValueIds to an empty list', () => {
    const parsed = checkoutInputSchema.parse(body({ items: [{ productId: UUID_B, quantity: 1, expectedUnitPriceVnd: 20000 }] }))
    expect(parsed.items[0]!.optionValueIds).toEqual([])
  })

  it('stores HTML verbatim; escaping is the renderer\'s job', () => {
    const parsed = checkoutInputSchema.parse(body({ items: [{ ...item, note: '<img src=x onerror=alert(1)>' }] }))
    expect(parsed.items[0]!.note).toBe('<img src=x onerror=alert(1)>')
  })
})

describe('checkoutInputSchema — required fields per fulfillment', () => {
  it('requires a table token for dine-in', () => {
    expect(issuePaths(body({ fulfillmentType: 'DINE_IN', customer: {} }))).toEqual(['tableToken'])
  })

  it('requires name and phone for pickup', () => {
    expect(issuePaths(body({ customer: {} })).sort()).toEqual(['customer.name', 'customer.phone'])
  })

  it('treats whitespace-only name as missing', () => {
    expect(issuePaths(body({ customer: { name: '   ', phone: '0912345678' } }))).toEqual(['customer.name'])
  })

  it('requires zone and address for delivery', () => {
    expect(issuePaths(body({ fulfillmentType: 'DELIVERY' })).sort()).toEqual(['customer.address', 'deliveryZoneId'])
  })

  it('reports an invalid phone on the phone field, also for dine-in where it is optional', () => {
    expect(issuePaths(body({ customer: { name: 'Lan', phone: '0212345678' } }))).toEqual(['customer.phone'])
    expect(issuePaths(body({ fulfillmentType: 'DINE_IN', tableToken: 'x'.repeat(43), customer: { phone: '123' } }))).toEqual(['customer.phone'])
  })
})

describe('checkoutInputSchema — limits', () => {
  it('exposes the spec limits', () => {
    expect(CHECKOUT_LIMITS).toEqual({ maxLines: 30, maxQuantity: 50, maxNote: 200, maxName: 80, maxAddress: 300 })
  })

  it.each([
    ['quantity 0', { items: [{ ...item, quantity: 0 }] }, 'items.0.quantity'],
    ['quantity 51', { items: [{ ...item, quantity: 51 }] }, 'items.0.quantity'],
    ['fractional quantity', { items: [{ ...item, quantity: 1.5 }] }, 'items.0.quantity'],
    ['no items', { items: [] }, 'items'],
    ['31 lines', { items: Array.from({ length: 31 }, () => item) }, 'items'],
    ['201-char item note', { items: [{ ...item, note: 'a'.repeat(201) }] }, 'items.0.note'],
    ['81-char name', { customer: { name: 'a'.repeat(81), phone: '0912345678' } }, 'customer.name'],
    ['201-char order note', { note: 'a'.repeat(201) }, 'note'],
    ['negative expected price', { items: [{ ...item, expectedUnitPriceVnd: -1 }] }, 'items.0.expectedUnitPriceVnd'],
    ['negative expected total', { expectedTotalVnd: -1 }, 'expectedTotalVnd'],
    ['bad idempotency key', { idempotencyKey: 'not-a-uuid' }, 'idempotencyKey'],
    ['unknown payment method', { paymentMethod: 'CARD' }, 'paymentMethod'],
    ['unknown fulfillment', { fulfillmentType: 'DRIVE_THRU' }, 'fulfillmentType'],
    ['bad product id', { items: [{ ...item, productId: 'nope' }] }, 'items.0.productId'],
  ])('rejects %s', (_label, over, path) => {
    expect(issuePaths(body(over))).toContain(path)
  })

  it('rejects an address over 300 characters for delivery', () => {
    const raw = body({ fulfillmentType: 'DELIVERY', deliveryZoneId: UUID_C, customer: { name: 'Lan', phone: '0912345678', address: 'a'.repeat(301) } })
    expect(issuePaths(raw)).toEqual(['customer.address'])
  })
})
```

- [ ] **Step 3: Chạy test để xác nhận thất bại**

Run: `npx vitest run --project unit tests/unit/shared/enums.test.ts tests/unit/shared/phone.test.ts tests/unit/shared/checkout-schema.test.ts`
Expected: FAIL — `Failed to resolve import "#shared/enums"` (và hai module còn lại).

- [ ] **Step 4: Viết enums, types, phone**

`shared/enums.ts`:

```ts
export const FULFILLMENT_TYPES = ['DINE_IN', 'PICKUP', 'DELIVERY'] as const
export type FulfillmentType = (typeof FULFILLMENT_TYPES)[number]

export const ORDER_STATUSES = ['AWAITING_PAYMENT', 'NEW', 'PREPARING', 'READY', 'DELIVERING', 'COMPLETED', 'CANCELLED'] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const PAYMENT_METHODS = ['BANK_QR', 'PAY_ON_RECEIPT'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const PAYMENT_STATUSES = ['UNPAID', 'PENDING', 'PAID', 'REVIEW_REQUIRED', 'REFUND_DUE', 'REFUNDED'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

const TERMINAL_STATUSES: readonly OrderStatus[] = ['COMPLETED', 'CANCELLED']

export function isTerminalStatus(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}
```

`shared/types/order.ts`:

```ts
import type { FulfillmentType, OrderStatus, PaymentMethod, PaymentStatus } from '../enums'

export interface OrderItemOptionSnapshot {
  groupId: string
  groupName: string
  valueId: string
  valueName: string
  priceDeltaVnd: number
}

export type CartStaleReason = 'PRODUCT_UNAVAILABLE' | 'OPTION_INVALID' | 'PRICE_CHANGED'

export interface CartStaleLine {
  /** Index of the offending line in the submitted `items` array. */
  index: number
  productId: string
  name: string | null
  reason: CartStaleReason
  currentUnitPriceVnd: number | null
}

export interface CartStaleDetails {
  lines: CartStaleLine[]
  /** Current fee of the chosen zone; null for non-delivery orders. */
  deliveryFeeVnd: number | null
  /** Current total; null while some line is still stale. */
  totalVnd: number | null
}

export interface PaymentQr {
  bankName: string
  accountNumber: string
  accountHolder: string
  amountVnd: number
  transferContent: string
  imageUrl: string
  expiresAt: string
}

export interface CreateOrderResponse {
  publicCode: string
  guestToken: string
  status: OrderStatus
  paymentStatus: PaymentStatus
  totalVnd: number
  qr?: PaymentQr
}

export interface PublicOrderItem {
  name: string
  quantity: number
  unitPriceVnd: number
  lineTotalVnd: number
  options: { name: string, priceDeltaVnd: number }[]
  note: string | null
}

export interface PublicOrderView {
  publicCode: string
  status: OrderStatus
  paymentStatus: PaymentStatus
  paymentMethod: PaymentMethod
  fulfillmentType: FulfillmentType
  tableLabel: string | null
  deliveryZoneName: string | null
  customerName: string | null
  phoneMasked: string | null
  items: PublicOrderItem[]
  subtotalVnd: number
  deliveryFeeVnd: number
  totalVnd: number
  createdAt: string
  store: { name: string, slug: string }
  qr: PaymentQr | null
}
```

`shared/phone.ts`:

```ts
const SEPARATORS = /[\s.\-()]/g
const MOBILE_PREFIX = /^0(?:3|5|7|8|9)\d{8}$/

/** Accepts +84 / 84 / 0 prefixes and common separators; returns the 10-digit 0xxxxxxxxx form or null. */
export function normalizeVnPhone(input: string): string | null {
  const compact = input.replace(SEPARATORS, '')
  let national: string
  if (/^\+84\d{9}$/.test(compact)) national = `0${compact.slice(3)}`
  else if (/^84\d{9}$/.test(compact)) national = `0${compact.slice(2)}`
  else if (/^0\d{9}$/.test(compact)) national = compact
  else return null
  return MOBILE_PREFIX.test(national) ? national : null
}

export function maskPhone(phone: string | null): string | null {
  if (phone === null) return null
  return `${'*'.repeat(Math.max(phone.length - 3, 0))}${phone.slice(-3)}`
}
```

- [ ] **Step 5: Viết schema checkout**

`shared/schemas/checkout.ts`:

```ts
import { z } from 'zod'
import { FULFILLMENT_TYPES, PAYMENT_METHODS, type FulfillmentType, type PaymentMethod } from '../enums'
import { normalizeVnPhone } from '../phone'

export const CHECKOUT_LIMITS = { maxLines: 30, maxQuantity: 50, maxNote: 200, maxName: 80, maxAddress: 300 } as const

const text = (max: number) => z.string().trim().max(max, `Tối đa ${max} ký tự`).optional()
// zod 4: .int() already rejects values outside the safe-integer range.
const vnd = z.number().int().nonnegative()

const itemSchema = z.object({
  productId: z.uuid(),
  quantity: z.number().int().min(1, 'Số lượng tối thiểu là 1').max(CHECKOUT_LIMITS.maxQuantity, `Tối đa ${CHECKOUT_LIMITS.maxQuantity} phần mỗi món`),
  optionValueIds: z.array(z.uuid()).max(30).default([]),
  note: text(CHECKOUT_LIMITS.maxNote),
  expectedUnitPriceVnd: vnd,
})

const baseSchema = z.object({
  idempotencyKey: z.uuid(),
  fulfillmentType: z.enum(FULFILLMENT_TYPES),
  tableToken: z.string().trim().min(1).max(64).nullish(),
  customer: z.object({
    name: text(CHECKOUT_LIMITS.maxName),
    phone: z.string().trim().max(24, 'Số điện thoại không hợp lệ').optional(),
    address: text(CHECKOUT_LIMITS.maxAddress),
  }).default({}),
  deliveryZoneId: z.uuid().nullish(),
  items: z.array(itemSchema).min(1, 'Giỏ hàng trống').max(CHECKOUT_LIMITS.maxLines, `Tối đa ${CHECKOUT_LIMITS.maxLines} dòng mỗi đơn`),
  paymentMethod: z.enum(PAYMENT_METHODS),
  expectedTotalVnd: vnd,
  note: text(CHECKOUT_LIMITS.maxNote),
})

export interface CheckoutInput {
  idempotencyKey: string
  fulfillmentType: FulfillmentType
  tableToken: string | null
  customer: { name: string | null, phone: string | null, address: string | null }
  deliveryZoneId: string | null
  items: { productId: string, quantity: number, optionValueIds: string[], note: string | null, expectedUnitPriceVnd: number }[]
  expectedTotalVnd: number
  paymentMethod: PaymentMethod
  note: string | null
}

export const checkoutInputSchema = baseSchema
  .superRefine((value, ctx) => {
    const name = value.customer.name ?? ''
    const phoneRaw = value.customer.phone ?? ''
    const problem = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message })

    if (phoneRaw && !normalizeVnPhone(phoneRaw)) problem(['customer', 'phone'], 'Số điện thoại không hợp lệ')

    if (value.fulfillmentType === 'DINE_IN' && !value.tableToken) problem(['tableToken'], 'Thiếu mã bàn, vui lòng quét lại QR')
    if (value.fulfillmentType !== 'DINE_IN') {
      if (!name) problem(['customer', 'name'], 'Vui lòng nhập tên')
      if (!phoneRaw) problem(['customer', 'phone'], 'Vui lòng nhập số điện thoại')
    }
    if (value.fulfillmentType === 'DELIVERY') {
      if (!value.deliveryZoneId) problem(['deliveryZoneId'], 'Vui lòng chọn khu vực giao')
      if (!value.customer.address) problem(['customer', 'address'], 'Vui lòng nhập địa chỉ giao hàng')
    }
  })
  .transform((value): CheckoutInput => ({
    idempotencyKey: value.idempotencyKey,
    fulfillmentType: value.fulfillmentType,
    tableToken: value.fulfillmentType === 'DINE_IN' ? (value.tableToken ?? null) : null,
    customer: {
      name: value.customer.name || null,
      phone: value.customer.phone ? normalizeVnPhone(value.customer.phone) : null,
      address: value.fulfillmentType === 'DELIVERY' ? (value.customer.address || null) : null,
    },
    deliveryZoneId: value.fulfillmentType === 'DELIVERY' ? (value.deliveryZoneId ?? null) : null,
    items: value.items.map(item => ({
      productId: item.productId,
      quantity: item.quantity,
      optionValueIds: item.optionValueIds,
      note: item.note || null,
      expectedUnitPriceVnd: item.expectedUnitPriceVnd,
    })),
    expectedTotalVnd: value.expectedTotalVnd,
    paymentMethod: value.paymentMethod,
    note: value.note || null,
  }))

export type CheckoutBody = z.input<typeof checkoutInputSchema>
```

- [ ] **Step 6: Chạy test để xác nhận đạt**

Run: `npx vitest run --project unit tests/unit/shared/enums.test.ts tests/unit/shared/phone.test.ts tests/unit/shared/checkout-schema.test.ts`
Expected: PASS.

- [ ] **Step 7: Ghi các điểm lệch vào outline PR3 của roadmap**

Trong `docs/superpowers/plans/2026-10-31-zeno-v1-00-roadmap.md`, ngay dưới danh sách "Tasks" của mục `PR3`, trước dòng `---` dẫn sang `PR4`, thêm khối:

```markdown
**Điểm lệch đã chốt khi viết plan chi tiết ([04-ordering](./2026-10-31-zeno-v1-04-ordering.md)):**
- Body checkout có thêm `expectedUnitPriceVnd` (mỗi dòng) và `expectedTotalVnd` (cả đơn): server chỉ biết giá đã đổi khi khách gửi giá họ đang thấy; không có hai trường này thì `CART_STALE` vì "giá đổi" không thể phát hiện. Thêm `note` tuỳ chọn cho cả đơn (C3 có "ghi chú cho quán").
- `orders` thêm `table_label`, `delivery_zone_name` (snapshot, nullable); `order_items` dùng `qty` và `options_snapshot_json` đúng PRD §6.
- Enum dùng chung ở `shared/enums.ts` (không phải `shared/types`).
- `consumeRateLimit` nhận thêm `now?: Date` (để test cửa sổ mới); `createOrder` nhận tham số thứ ba tuỳ chọn `deps` (seam cho test: `generatePublicCode`, `beforeCommit`).
- Rate limit được tính **sau** khi kiểm tra idempotency và **trước** transaction (kể cả đơn bị `CART_STALE`/422 vẫn tính, để spam đơn sai không rẻ).
- Polling khi tab hiển thị dùng composable tự viết `useVisiblePolling` thay cho `useDocumentVisibility` của VueUse, để không thêm dependency.
- Thêm `server/utils/safe-path.ts` để che guest token trong log đường dẫn.
```

- [ ] **Step 8: Commit**

```bash
git add shared/enums.ts shared/types/order.ts shared/phone.ts shared/schemas/checkout.ts tests/unit/shared/enums.test.ts tests/unit/shared/phone.test.ts tests/unit/shared/checkout-schema.test.ts docs/superpowers/plans/2026-10-31-zeno-v1-00-roadmap.md
git commit -m "feat(order): add checkout schema, phone normalisation and shared order enums" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Schema `ordering` + migration + fixtures

**Files:**
- Create: `server/db/schema/ordering.ts`, `drizzle/0002_ordering.sql` (generated), `tests/support/checkout-fixtures.ts`, `tests/integration/ordering-schema.test.ts`
- Modify: `server/db/schema/index.ts`

**Interfaces:**
- Consumes: `timestamps`, `stores`, `userProfiles` (`server/db/schema/identity.ts`, PR1); `deliveryZones`, `products`, `storeTables` (`server/db/schema/catalog.ts`, PR2); `FULFILLMENT_TYPES`, `ORDER_STATUSES`, `PAYMENT_METHODS`, `PAYMENT_STATUSES`, `OrderItemOptionSnapshot` (Task 2); `getPgError` (`server/db/errors.ts`); `generateToken`, `hashToken` (`server/utils/tokens.ts`); `createTenant`, `createProduct`, `createOptionGroup`, `createTable`, `createZone` (`tests/support/fixtures.ts`).
- Produces (PR4–PR6 dùng; giữ nguyên tên):
  - pgEnum: `fulfillmentType` (`fulfillment_type`), `orderStatus` (`order_status`), `paymentMethod` (`payment_method`), `paymentStatus` (`payment_status`).
  - Bảng: `orders`, `orderItems`, `orderEvents`, `rateLimits`.
    - `orders`: `id, orgId, storeId, publicCode, guestTokenHash, guestTokenEncrypted, fulfillmentType, tableId, tableLabel, customerName, customerPhone, deliveryZoneId, deliveryZoneName, addressSnapshot, notes, subtotalVnd, deliveryFeeVnd, totalVnd, status, paymentMethod, paymentStatus, idempotencyKey, latePayment, createdAt, updatedAt`.
    - `orderItems`: `id, orgId, storeId, orderId, productId, position, nameSnapshot, optionsSnapshotJson (OrderItemOptionSnapshot[]), qty, unitPriceVnd, lineTotalVnd, note, createdAt`.
    - `orderEvents`: `id, orgId, storeId, orderId, actorUserId, eventType (text), fromState, toState, metadata (jsonb), createdAt`.
    - `rateLimits`: `key, windowStart, count`.
  - Tên constraint: unique `orders_guest_token_hash_uq`, `orders_store_idem_uq`, `orders_store_public_code_uq`, `orders_store_id_id_uq`, `order_items_store_id_id_uq`, `order_events_store_id_id_uq`; FK `orders_store_fk`, `orders_table_fk`, `orders_zone_fk`, `order_items_store_fk`, `order_items_order_fk`, `order_items_product_fk`, `order_events_store_fk`, `order_events_order_fk`; check `orders_money_check`, `order_items_qty_check`, `order_items_money_check`; PK `rate_limits_pk`.
  - Fixtures trong `tests/support/checkout-fixtures.ts`: `seedMenu(store)`, `openStore(storeId, patch?)`, `pickupBody(menu, over?)`, `dineInBody(menu, over?)`, `deliveryBody(menu, over?)`, `teaItem(menu, over?)`, `breadItem(menu, over?)`, `insertRawOrder(store, over?)`, `seedCartJson(menu, quantity?)`, kiểu `SeededMenu`.

- [ ] **Step 1: Viết fixtures**

`tests/support/checkout-fixtures.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getDb } from '../../server/db/client'
import { orders, stores } from '../../server/db/schema'
import type { CheckoutBody } from '../../shared/schemas/checkout'
import { createOptionGroup, createProduct, createTable, createZone } from './fixtures'

type StoreRef = { id: string, orgId: string }
type BodyItem = CheckoutBody['items'][number]

export const TEA_PRICE = 35_000
export const BREAD_PRICE = 20_000

export async function seedMenu(store: StoreRef) {
  const tea = await createProduct(store, { name: 'Trà sữa trân châu', basePriceVnd: TEA_PRICE, position: 0 })
  const size = await createOptionGroup(store, tea, {
    name: 'Size',
    required: true,
    values: [{ name: 'M' }, { name: 'L', priceDeltaVnd: 7_000 }],
  })
  const topping = await createOptionGroup(store, tea, {
    name: 'Topping',
    required: false,
    minSelect: 0,
    maxSelect: 2,
    position: 1,
    values: [{ name: 'Trân châu', priceDeltaVnd: 5_000 }, { name: 'Thạch', priceDeltaVnd: 5_000 }],
  })
  const bread = await createProduct(store, { name: 'Bánh mì que', basePriceVnd: BREAD_PRICE, position: 1 })
  const zone = await createZone(store, { name: 'Quận 1', feeVnd: 15_000 })
  const { table, token } = await createTable(store, '05')
  const value = (values: { id: string, name: string }[], name: string) => values.find(v => v.name === name)!

  return {
    tea: {
      id: tea.id,
      name: tea.name,
      basePriceVnd: TEA_PRICE,
      size: { groupId: size.group.id, m: value(size.values, 'M'), l: value(size.values, 'L') },
      topping: { groupId: topping.group.id, pearl: value(topping.values, 'Trân châu'), jelly: value(topping.values, 'Thạch') },
    },
    bread: { id: bread.id, name: bread.name, basePriceVnd: BREAD_PRICE },
    zone: { id: zone.id, name: zone.name, feeVnd: 15_000 },
    table: { id: table.id, token, displayName: table.displayName },
  }
}

export type SeededMenu = Awaited<ReturnType<typeof seedMenu>>

export async function openStore(storeId: string, patch: Partial<typeof stores.$inferInsert> = {}) {
  await getDb().update(stores).set({ isAcceptingOrders: true, ...patch }).where(eq(stores.id, storeId))
}

export const teaItem = (menu: SeededMenu, over: Partial<BodyItem> = {}): BodyItem => ({
  productId: menu.tea.id,
  quantity: 2,
  optionValueIds: [menu.tea.size.m.id],
  expectedUnitPriceVnd: TEA_PRICE,
  ...over,
})

export const breadItem = (menu: SeededMenu, over: Partial<BodyItem> = {}): BodyItem => ({
  productId: menu.bread.id,
  quantity: 1,
  optionValueIds: [],
  expectedUnitPriceVnd: BREAD_PRICE,
  ...over,
})

export function pickupBody(menu: SeededMenu, over: Partial<CheckoutBody> = {}): CheckoutBody {
  return {
    idempotencyKey: randomUUID(),
    fulfillmentType: 'PICKUP',
    customer: { name: 'Lan', phone: '0912345678' },
    items: [teaItem(menu)],
    expectedTotalVnd: 2 * TEA_PRICE,
    paymentMethod: 'PAY_ON_RECEIPT',
    ...over,
  }
}

export function dineInBody(menu: SeededMenu, over: Partial<CheckoutBody> = {}): CheckoutBody {
  return pickupBody(menu, { fulfillmentType: 'DINE_IN', tableToken: menu.table.token, customer: {}, ...over })
}

export function deliveryBody(menu: SeededMenu, over: Partial<CheckoutBody> = {}): CheckoutBody {
  return pickupBody(menu, {
    fulfillmentType: 'DELIVERY',
    deliveryZoneId: menu.zone.id,
    customer: { name: 'Lan', phone: '0912345678', address: '12 Lê Lợi, Quận 1' },
    expectedTotalVnd: 2 * TEA_PRICE + menu.zone.feeVnd,
    ...over,
  })
}

/** Raw insert that bypasses createOrder; defaults satisfy every constraint. */
export async function insertRawOrder(store: StoreRef, over: Partial<typeof orders.$inferInsert> = {}) {
  const [row] = await getDb().insert(orders).values({
    orgId: store.orgId,
    storeId: store.id,
    publicCode: randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase(),
    guestTokenHash: randomUUID(),
    guestTokenEncrypted: 'v1.x.y.z',
    fulfillmentType: 'PICKUP',
    customerName: 'Lan',
    customerPhone: '0912345678',
    subtotalVnd: 50_000,
    deliveryFeeVnd: 0,
    totalVnd: 50_000,
    status: 'NEW',
    paymentMethod: 'PAY_ON_RECEIPT',
    paymentStatus: 'UNPAID',
    idempotencyKey: randomUUID(),
    ...over,
  }).returning()
  return row!
}

/** localStorage payload (`zeno:cart:<slug>`) for e2e: two Size-M teas, nothing else filled in. */
export function seedCartJson(menu: SeededMenu, quantity = 2): string {
  return JSON.stringify({
    version: 1,
    lines: [{
      lineId: randomUUID(),
      productId: menu.tea.id,
      name: menu.tea.name,
      optionValueIds: [menu.tea.size.m.id],
      optionLabels: ['M'],
      unitPriceVnd: TEA_PRICE,
      quantity,
      note: '',
      stale: null,
      currentUnitPriceVnd: null,
    }],
    pendingIdempotencyKey: null,
    pendingFingerprint: null,
    fulfillmentType: null,
    customer: { name: '', phone: '', address: '' },
    deliveryZoneId: null,
    note: '',
  })
}
```

- [ ] **Step 2: Viết integration test thất bại cho schema**

`tests/integration/ordering-schema.test.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { FULFILLMENT_TYPES, ORDER_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES } from '#shared/enums'
import { closeDb, getDb } from '../../server/db/client'
import { getPgError } from '../../server/db/errors'
import { fulfillmentType, orderEvents, orderItems, orders, orderStatus, paymentMethod, paymentStatus, rateLimits } from '../../server/db/schema'
import { resetDb } from '../support/db'
import { insertRawOrder, seedMenu } from '../support/checkout-fixtures'
import { createTenant } from '../support/fixtures'

async function expectPgError(promise: Promise<unknown>, code: string, constraint?: string) {
  const error = await promise.then(() => null, (e: unknown) => e)
  expect(error, 'expected the statement to fail').not.toBeNull()
  const pg = getPgError(error)
  expect(pg.code).toBe(code)
  if (constraint) expect(pg.constraint).toBe(constraint)
}

const itemValues = (store: { id: string, orgId: string }, orderId: string, over: Partial<typeof orderItems.$inferInsert> = {}) => ({
  orgId: store.orgId,
  storeId: store.id,
  orderId,
  position: 0,
  nameSnapshot: 'Trà sữa',
  qty: 2,
  unitPriceVnd: 25_000,
  lineTotalVnd: 50_000,
  ...over,
})

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('ordering enums stay in sync with shared/enums', () => {
  it('matches the pgEnum values', () => {
    expect(fulfillmentType.enumValues).toEqual([...FULFILLMENT_TYPES])
    expect(orderStatus.enumValues).toEqual([...ORDER_STATUSES])
    expect(paymentMethod.enumValues).toEqual([...PAYMENT_METHODS])
    expect(paymentStatus.enumValues).toEqual([...PAYMENT_STATUSES])
  })
})

describe('orders constraints', () => {
  it('stores a valid order with defaults', async () => {
    const a = await createTenant('a')
    const order = await insertRawOrder(a.store)
    expect(order).toMatchObject({ latePayment: false, status: 'NEW', paymentStatus: 'UNPAID', tableId: null })
    expect(order.createdAt).toBeInstanceOf(Date)
  })

  it('keeps idempotency keys unique per store but reusable across stores', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const key = randomUUID()
    await insertRawOrder(a.store, { idempotencyKey: key })
    await insertRawOrder(b.store, { idempotencyKey: key })
    await expectPgError(insertRawOrder(a.store, { idempotencyKey: key }), '23505', 'orders_store_idem_uq')
  })

  it('keeps public codes unique per store but reusable across stores', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    await insertRawOrder(a.store, { publicCode: 'AB23CD' })
    await insertRawOrder(b.store, { publicCode: 'AB23CD' })
    await expectPgError(insertRawOrder(a.store, { publicCode: 'AB23CD' }), '23505', 'orders_store_public_code_uq')
  })

  it('keeps guest token hashes globally unique', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    await insertRawOrder(a.store, { guestTokenHash: 'same-hash' })
    await expectPgError(insertRawOrder(b.store, { guestTokenHash: 'same-hash' }), '23505', 'orders_guest_token_hash_uq')
  })

  it('rejects an org that does not own the store (composite FK)', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    await expectPgError(insertRawOrder({ id: a.store.id, orgId: b.org.id }), '23503', 'orders_store_fk')
  })

  it('rejects a table or zone that belongs to another store', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const menuA = await seedMenu(a.store)
    await expectPgError(
      insertRawOrder(b.store, { fulfillmentType: 'DINE_IN', tableId: menuA.table.id }),
      '23503',
      'orders_table_fk',
    )
    await expectPgError(
      insertRawOrder(b.store, { fulfillmentType: 'DELIVERY', deliveryZoneId: menuA.zone.id, addressSnapshot: '1 A' }),
      '23503',
      'orders_zone_fk',
    )
  })

  it('rejects totals that do not add up or are negative (23514)', async () => {
    const a = await createTenant('a')
    await expectPgError(insertRawOrder(a.store, { subtotalVnd: 50_000, deliveryFeeVnd: 15_000, totalVnd: 50_000 }), '23514', 'orders_money_check')
    await expectPgError(insertRawOrder(a.store, { subtotalVnd: -1, deliveryFeeVnd: 0, totalVnd: -1 }), '23514', 'orders_money_check')
  })
})

describe('order_items and order_events constraints', () => {
  it('rejects an item whose order belongs to another store', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const orderA = await insertRawOrder(a.store)
    await expectPgError(getDb().insert(orderItems).values(itemValues(b.store, orderA.id)), '23503', 'order_items_order_fk')
  })

  it('rejects an item whose product belongs to another store', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const menuB = await seedMenu(b.store)
    const orderA = await insertRawOrder(a.store)
    await expectPgError(
      getDb().insert(orderItems).values(itemValues(a.store, orderA.id, { productId: menuB.tea.id })),
      '23503',
      'order_items_product_fk',
    )
  })

  it('rejects quantity outside 1..50 and line totals that do not match (23514)', async () => {
    const a = await createTenant('a')
    const order = await insertRawOrder(a.store)
    await expectPgError(getDb().insert(orderItems).values(itemValues(a.store, order.id, { qty: 0, lineTotalVnd: 0 })), '23514', 'order_items_qty_check')
    await expectPgError(getDb().insert(orderItems).values(itemValues(a.store, order.id, { qty: 51, lineTotalVnd: 51 * 25_000 })), '23514', 'order_items_qty_check')
    await expectPgError(getDb().insert(orderItems).values(itemValues(a.store, order.id, { lineTotalVnd: 49_999 })), '23514', 'order_items_money_check')
  })

  it('stores the option snapshot as JSON and cascades items and events with the order', async () => {
    const a = await createTenant('a')
    const order = await insertRawOrder(a.store)
    const snapshot = [{ groupId: 'g', groupName: 'Size', valueId: 'v', valueName: 'L', priceDeltaVnd: 7_000 }]
    await getDb().insert(orderItems).values(itemValues(a.store, order.id, { optionsSnapshotJson: snapshot }))
    await getDb().insert(orderEvents).values({ orgId: a.org.id, storeId: a.store.id, orderId: order.id, eventType: 'CREATED', toState: 'NEW' })

    const [item] = await getDb().select().from(orderItems)
    expect(item!.optionsSnapshotJson).toEqual(snapshot)
    const [event] = await getDb().select().from(orderEvents)
    expect(event).toMatchObject({ eventType: 'CREATED', fromState: null, toState: 'NEW', actorUserId: null, metadata: {} })

    await getDb().delete(orders)
    expect(await getDb().select().from(orderItems)).toEqual([])
    expect(await getDb().select().from(orderEvents)).toEqual([])
  })
})

describe('rate_limits', () => {
  it('has a composite primary key on (key, window_start)', async () => {
    const windowStart = new Date('2026-10-31T10:00:00Z')
    await getDb().insert(rateLimits).values({ key: 'k', windowStart, count: 1 })
    await expectPgError(getDb().insert(rateLimits).values({ key: 'k', windowStart, count: 1 }), '23505', 'rate_limits_pk')
    await getDb().insert(rateLimits).values({ key: 'k', windowStart: new Date('2026-10-31T10:10:00Z'), count: 1 })
  })
})
```

- [ ] **Step 3: Chạy test để xác nhận thất bại**

Run: `npm run test:integration -- tests/integration/ordering-schema.test.ts`
Expected: FAIL — `'../../server/db/schema'` không export `fulfillmentType`/`orderStatus`/`rateLimits`.

- [ ] **Step 4: Viết schema `ordering.ts`**

`server/db/schema/ordering.ts` (import `shared/` bằng đường dẫn tương đối, xem Global Constraints):

```ts
import { sql } from 'drizzle-orm'
import { bigint, boolean, check, foreignKey, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { FULFILLMENT_TYPES, ORDER_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES } from '../../../shared/enums'
import type { OrderItemOptionSnapshot } from '../../../shared/types/order'
import { deliveryZones, products, storeTables } from './catalog'
import { stores, timestamps, userProfiles } from './identity'

export const fulfillmentType = pgEnum('fulfillment_type', FULFILLMENT_TYPES)
export const orderStatus = pgEnum('order_status', ORDER_STATUSES)
export const paymentMethod = pgEnum('payment_method', PAYMENT_METHODS)
export const paymentStatus = pgEnum('payment_status', PAYMENT_STATUSES)

const vnd = (name: string) => bigint(name, { mode: 'number' }).notNull()

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  storeId: uuid('store_id').notNull(),
  publicCode: text('public_code').notNull(),
  guestTokenHash: text('guest_token_hash').notNull(),
  guestTokenEncrypted: text('guest_token_encrypted').notNull(),
  fulfillmentType: fulfillmentType('fulfillment_type').notNull(),
  tableId: uuid('table_id'),
  tableLabel: text('table_label'),
  customerName: text('customer_name'),
  customerPhone: text('customer_phone'),
  deliveryZoneId: uuid('delivery_zone_id'),
  deliveryZoneName: text('delivery_zone_name'),
  addressSnapshot: text('address_snapshot'),
  notes: text('notes'),
  subtotalVnd: vnd('subtotal_vnd'),
  deliveryFeeVnd: vnd('delivery_fee_vnd'),
  totalVnd: vnd('total_vnd'),
  status: orderStatus('status').notNull(),
  paymentMethod: paymentMethod('payment_method').notNull(),
  paymentStatus: paymentStatus('payment_status').notNull(),
  idempotencyKey: uuid('idempotency_key').notNull(),
  latePayment: boolean('late_payment').notNull().default(false),
  ...timestamps,
}, t => [
  unique('orders_guest_token_hash_uq').on(t.guestTokenHash),
  unique('orders_store_idem_uq').on(t.storeId, t.idempotencyKey),
  unique('orders_store_public_code_uq').on(t.storeId, t.publicCode),
  unique('orders_store_id_id_uq').on(t.storeId, t.id),
  foreignKey({ name: 'orders_store_fk', columns: [t.orgId, t.storeId], foreignColumns: [stores.orgId, stores.id] }).onDelete('cascade'),
  foreignKey({ name: 'orders_table_fk', columns: [t.storeId, t.tableId], foreignColumns: [storeTables.storeId, storeTables.id] }),
  foreignKey({ name: 'orders_zone_fk', columns: [t.storeId, t.deliveryZoneId], foreignColumns: [deliveryZones.storeId, deliveryZones.id] }),
  check('orders_money_check', sql`${t.subtotalVnd} >= 0 and ${t.deliveryFeeVnd} >= 0 and ${t.totalVnd} = ${t.subtotalVnd} + ${t.deliveryFeeVnd}`),
  // The board index (store, status, created_at) is added by PR4's `owner_ops` migration, which owns the board query.
])

export const orderItems = pgTable('order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  storeId: uuid('store_id').notNull(),
  orderId: uuid('order_id').notNull(),
  // Nullable per PRD §6; the FK has no ON DELETE action because catalog rows are only ever soft-disabled.
  productId: uuid('product_id'),
  position: integer('position').notNull(),
  nameSnapshot: text('name_snapshot').notNull(),
  optionsSnapshotJson: jsonb('options_snapshot_json').$type<OrderItemOptionSnapshot[]>().notNull().default([]),
  qty: integer('qty').notNull(),
  unitPriceVnd: vnd('unit_price_vnd'),
  lineTotalVnd: vnd('line_total_vnd'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  unique('order_items_store_id_id_uq').on(t.storeId, t.id),
  foreignKey({ name: 'order_items_store_fk', columns: [t.orgId, t.storeId], foreignColumns: [stores.orgId, stores.id] }).onDelete('cascade'),
  foreignKey({ name: 'order_items_order_fk', columns: [t.storeId, t.orderId], foreignColumns: [orders.storeId, orders.id] }).onDelete('cascade'),
  foreignKey({ name: 'order_items_product_fk', columns: [t.storeId, t.productId], foreignColumns: [products.storeId, products.id] }),
  check('order_items_qty_check', sql`${t.qty} between 1 and 50`),
  check('order_items_money_check', sql`${t.unitPriceVnd} >= 0 and ${t.lineTotalVnd} = ${t.unitPriceVnd} * ${t.qty}`),
  index('order_items_order_idx').on(t.storeId, t.orderId, t.position),
])

export const orderEvents = pgTable('order_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  storeId: uuid('store_id').notNull(),
  orderId: uuid('order_id').notNull(),
  actorUserId: text('actor_user_id').references(() => userProfiles.userId),
  // Plain text so later PRs can add event types without a migration.
  eventType: text('event_type').notNull(),
  fromState: text('from_state'),
  toState: text('to_state'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  unique('order_events_store_id_id_uq').on(t.storeId, t.id),
  foreignKey({ name: 'order_events_store_fk', columns: [t.orgId, t.storeId], foreignColumns: [stores.orgId, stores.id] }).onDelete('cascade'),
  foreignKey({ name: 'order_events_order_fk', columns: [t.storeId, t.orderId], foreignColumns: [orders.storeId, orders.id] }).onDelete('cascade'),
  index('order_events_order_idx').on(t.storeId, t.orderId, t.createdAt),
])

// Infrastructure table, deliberately not tenant-scoped: keys are opaque "<scope>:<store>:<ip-hash>" strings.
export const rateLimits = pgTable('rate_limits', {
  key: text('key').notNull(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  count: integer('count').notNull().default(0),
}, t => [
  primaryKey({ name: 'rate_limits_pk', columns: [t.key, t.windowStart] }),
])
```

Sửa `server/db/schema/index.ts` thành:

```ts
export * from './identity'
export * from './catalog'
export * from './ordering'
```

- [ ] **Step 5: Sinh migration, kiểm tra, áp dụng lên branch `test`**

Run:

```bash
npx drizzle-kit generate --name ordering
npm run db:check
ENV_FILE=.env.test npx drizzle-kit migrate
```

Expected: đúng một file `drizzle/0002_ordering.sql` (cộng `meta`); `db:check` báo ổn; migrate không lỗi. Mở file SQL, xác nhận có `CREATE TYPE "public"."fulfillment_type"`, `"order_status"`, `"payment_method"`, `"payment_status"`, bốn `CREATE TABLE` (`orders`, `order_items`, `order_events`, `rate_limits`), `CONSTRAINT "orders_money_check" CHECK`, và `FOREIGN KEY ("store_id","table_id")`.

- [ ] **Step 6: Chạy test để xác nhận đạt**

Run: `npm run test:integration -- tests/integration/ordering-schema.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/db/schema/ordering.ts server/db/schema/index.ts drizzle tests/support/checkout-fixtures.ts tests/integration/ordering-schema.test.ts
git commit -m "feat(order): add ordering schema, migration and checkout fixtures" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Primitive của ordering — `consumeRateLimit` và `generatePublicCode`

**Files:**
- Create: `server/services/ordering/constants.ts`, `server/services/ordering/rate-limit.ts`, `server/services/ordering/public-code.ts`, `tests/integration/rate-limit.test.ts`, `tests/unit/server/public-code.test.ts`

**Interfaces:**
- Consumes: `rateLimits` (Task 3); `DbOrTx` (`server/db/client.ts`).
- Produces:
  - `consumeRateLimit(db: DbOrTx, key: string, opts: { limit: number; windowSec: number; now?: Date }): Promise<boolean>` — `true` nếu lần gọi này còn trong hạn mức. Cửa sổ cố định, căn theo bội số của `windowSec` kể từ epoch.
  - `PUBLIC_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'` (32 ký tự, không có `0 O 1 I`), `PUBLIC_CODE_LENGTH = 6`, `generatePublicCode(): string`.
  - `CHECKOUT_RATE_LIMIT = { limit: 10, windowSec: 600 }`, `MAX_PUBLIC_CODE_ATTEMPTS = 5`.

- [ ] **Step 1: Viết test thất bại**

`tests/integration/rate-limit.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { rateLimits } from '../../server/db/schema'
import { consumeRateLimit } from '../../server/services/ordering/rate-limit'
import { resetDb } from '../support/db'

const opts = { limit: 10, windowSec: 600 }
const T0 = new Date('2026-10-31T10:03:20Z')

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('consumeRateLimit', () => {
  it('lets `limit` calls through and blocks the rest of the window', async () => {
    const results: boolean[] = []
    for (let i = 0; i < 12; i++) results.push(await consumeRateLimit(getDb(), 'checkout:a', { ...opts, now: T0 }))
    expect(results.slice(0, 10)).toEqual(Array(10).fill(true))
    expect(results.slice(10)).toEqual([false, false])
  })

  it('resets in the next window', async () => {
    for (let i = 0; i < 11; i++) await consumeRateLimit(getDb(), 'checkout:a', { ...opts, now: T0 })
    const later = new Date(T0.getTime() + 600_000)
    expect(await consumeRateLimit(getDb(), 'checkout:a', { ...opts, now: later })).toBe(true)
    expect(await getDb().select().from(rateLimits)).toHaveLength(2)
  })

  it('aligns windows to multiples of windowSec since the epoch', async () => {
    await consumeRateLimit(getDb(), 'checkout:a', { ...opts, now: T0 })
    const [row] = await getDb().select().from(rateLimits)
    expect(row!.windowStart.toISOString()).toBe('2026-10-31T10:00:00.000Z')
    expect(row!.count).toBe(1)
  })

  it('keeps keys independent', async () => {
    for (let i = 0; i < 10; i++) await consumeRateLimit(getDb(), 'checkout:a', { ...opts, now: T0 })
    expect(await consumeRateLimit(getDb(), 'checkout:a', { ...opts, now: T0 })).toBe(false)
    expect(await consumeRateLimit(getDb(), 'checkout:b', { ...opts, now: T0 })).toBe(true)
  })

  it('never lets more than `limit` concurrent callers through', async () => {
    const results = await Promise.all(Array.from({ length: 15 }, () => consumeRateLimit(getDb(), 'checkout:a', { ...opts, now: T0 })))
    expect(results.filter(Boolean)).toHaveLength(10)
  })
})
```

`tests/unit/server/public-code.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { generatePublicCode, PUBLIC_CODE_ALPHABET, PUBLIC_CODE_LENGTH } from '../../../server/services/ordering/public-code'

describe('generatePublicCode', () => {
  it('uses the spec alphabet: 32 characters without 0, O, 1, I', () => {
    expect(PUBLIC_CODE_ALPHABET).toBe('23456789ABCDEFGHJKLMNPQRSTUVWXYZ')
    expect(PUBLIC_CODE_ALPHABET).toHaveLength(32)
    expect(PUBLIC_CODE_ALPHABET).not.toMatch(/[01OI]/)
  })

  it('returns 6 characters from the alphabet', () => {
    expect(PUBLIC_CODE_LENGTH).toBe(6)
    for (let i = 0; i < 2000; i++) expect(generatePublicCode()).toMatch(/^[2-9A-HJ-NP-Z]{6}$/)
  })

  it('is not constant and eventually uses every alphabet character', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 2000; i++) for (const char of generatePublicCode()) seen.add(char)
    expect(seen.size).toBe(32)
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `npx vitest run --project unit tests/unit/server/public-code.test.ts && npm run test:integration -- tests/integration/rate-limit.test.ts`
Expected: FAIL — không tìm thấy module `server/services/ordering/...`.

- [ ] **Step 3: Viết implementation**

`server/services/ordering/constants.ts`:

```ts
// Spec §5.1 step 2: 10 orders per 10 minutes per ip+store.
export const CHECKOUT_RATE_LIMIT = { limit: 10, windowSec: 600 } as const

export const MAX_PUBLIC_CODE_ATTEMPTS = 5
```

`server/services/ordering/rate-limit.ts`:

```ts
import { sql } from 'drizzle-orm'
import type { DbOrTx } from '../../db/client'
import { rateLimits } from '../../db/schema'

export interface RateLimitOptions {
  limit: number
  windowSec: number
  /** Injectable clock, for tests only. */
  now?: Date
}

/** Fixed-window counter. The upsert is atomic, so concurrent callers each get a distinct count. */
export async function consumeRateLimit(db: DbOrTx, key: string, { limit, windowSec, now = new Date() }: RateLimitOptions): Promise<boolean> {
  const windowMs = windowSec * 1000
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs)
  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({ target: [rateLimits.key, rateLimits.windowStart], set: { count: sql`${rateLimits.count} + 1` } })
    .returning({ count: rateLimits.count })
  return row!.count <= limit
}
```

`server/services/ordering/public-code.ts`:

```ts
import { randomInt } from 'node:crypto'

export const PUBLIC_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
export const PUBLIC_CODE_LENGTH = 6

export function generatePublicCode(): string {
  let code = ''
  for (let i = 0; i < PUBLIC_CODE_LENGTH; i++) code += PUBLIC_CODE_ALPHABET[randomInt(PUBLIC_CODE_ALPHABET.length)]
  return code
}
```

- [ ] **Step 4: Chạy test để xác nhận đạt**

Run: `npx vitest run --project unit tests/unit/server/public-code.test.ts && npm run test:integration -- tests/integration/rate-limit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/ordering/constants.ts server/services/ordering/rate-limit.ts server/services/ordering/public-code.ts tests/integration/rate-limit.test.ts tests/unit/server/public-code.test.ts
git commit -m "feat(order): add fixed-window rate limiter and public code generator" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: `createOrder` — giao dịch nguyên tử, tính lại giá, idempotency

**Files:**
- Create: `server/services/ordering/create-order.ts`, `tests/integration/create-order.test.ts`

**Interfaces:**
- Consumes: `orders`, `orderItems`, `orderEvents` (Task 3); `stores`, `products`, `productOptionGroups`, `productOptionValues`, `storeTables`, `deliveryZones` (PR1/PR2 schema); `validateSelection`, `priceLine`, `orderTotals`, `OptionGroupRule` (`shared/pricing.ts`, PR2); `CheckoutInput` (Task 2); `CartStaleDetails`, `CartStaleLine`, `CartStaleReason`, `CreateOrderResponse`, `OrderItemOptionSnapshot` (Task 2); `consumeRateLimit`, `generatePublicCode`, `CHECKOUT_RATE_LIMIT`, `MAX_PUBLIC_CODE_ATTEMPTS` (Task 4); `encryptSecret`, `decryptSecret` (Task 1); `generateToken`, `hashToken` (`server/utils/tokens.ts`); `AppError` (`server/utils/errors.ts`); `isUniqueViolation` (`server/db/errors.ts`); `Db`, `DbOrTx`, `Tx` (`server/db/client.ts`).
- Produces (route Task 7, PR5 mở nhánh `BANK_QR`, PR6 dùng; giữ nguyên tên):
  - `createOrder(db: Db, args: { slug: string; input: CheckoutInput; ip: string | null }, deps?: CreateOrderDeps): Promise<CreateOrderResult>`
  - `interface CreateOrderResult { response: CreateOrderResponse; replayed: boolean }`
  - `interface CreateOrderDeps { generatePublicCode?: () => string; beforeCommit?: (tx: Tx) => Promise<void> }` (seam cho test; production không truyền)
  - Lỗi: `NOT_FOUND` (store lạ/`SUSPENDED`), `RATE_LIMITED` 429, `STORE_CLOSED`, `MODE_DISABLED`, `INVALID_TABLE`, `INVALID_ZONE`, `PAYMENT_METHOD_UNAVAILABLE` (422), `CART_STALE` 409 với `details: CartStaleDetails`.
  - Hành vi cố định: đơn COD ra `status = NEW`, `paymentStatus = UNPAID`; ghi đúng một `order_events` `CREATED` (`fromState = null`, `toState = 'NEW'`, `metadata = { paymentMethod, fulfillmentType, itemCount }`, không có PII); SĐT lưu dạng `0xxxxxxxxx`.
  - Seam cho PR5: hàm nội bộ `resolvePayment(input)` là chỗ duy nhất quyết định `status`/`paymentStatus` ban đầu và nhánh `BANK_QR`.

- [ ] **Step 1: Viết integration test thất bại**

`tests/integration/create-order.test.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { count, eq } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkoutInputSchema, type CheckoutBody } from '#shared/schemas/checkout'
import { closeDb, getDb } from '../../server/db/client'
import { deliveryZones, orderEvents, orderItems, orders, productOptionValues, products, rateLimits, storeTables, stores } from '../../server/db/schema'
import { createOrder, type CreateOrderDeps } from '../../server/services/ordering/create-order'
import { AppError } from '../../server/utils/errors'
import { decryptSecret } from '../../server/utils/crypto'
import { hashToken } from '../../server/utils/tokens'
import { breadItem, deliveryBody, dineInBody, insertRawOrder, openStore, pickupBody, seedMenu, teaItem, type SeededMenu } from '../support/checkout-fixtures'
import { resetDb } from '../support/db'
import { createTenant, createStore } from '../support/fixtures'

let tenant: Awaited<ReturnType<typeof createTenant>>
let menu: SeededMenu

const place = (body: CheckoutBody, opts: { ip?: string | null, slug?: string, deps?: CreateOrderDeps } = {}) =>
  createOrder(
    getDb(),
    { slug: opts.slug ?? tenant.store.slug, input: checkoutInputSchema.parse(body), ip: opts.ip === undefined ? '203.0.113.7' : opts.ip },
    opts.deps,
  )

async function appError(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(() => null, (e: unknown) => e)
  expect(error).toBeInstanceOf(AppError)
  return error as AppError
}

const countOf = async (table: PgTable) =>
  (await getDb().select({ n: count() }).from(table))[0]!.n

beforeEach(async () => {
  await resetDb()
  tenant = await createTenant('a')
  await openStore(tenant.store.id, { deliveryEnabled: true })
  menu = await seedMenu(tenant.store)
})

afterAll(async () => {
  await closeDb()
})

describe('createOrder — happy paths', () => {
  it('creates a PICKUP COD order with snapshots, hashed + encrypted guest token and one CREATED event', async () => {
    const { response, replayed } = await place(pickupBody(menu, { note: ' ít đá ' }))

    expect(replayed).toBe(false)
    expect(response).toMatchObject({ status: 'NEW', paymentStatus: 'UNPAID', totalVnd: 70_000 })
    expect(response.publicCode).toMatch(/^[2-9A-HJ-NP-Z]{6}$/)
    expect(response.guestToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(response).not.toHaveProperty('qr')

    const [order] = await getDb().select().from(orders)
    expect(order).toMatchObject({
      storeId: tenant.store.id,
      orgId: tenant.org.id,
      fulfillmentType: 'PICKUP',
      customerName: 'Lan',
      customerPhone: '0912345678',
      notes: 'ít đá',
      subtotalVnd: 70_000,
      deliveryFeeVnd: 0,
      totalVnd: 70_000,
      status: 'NEW',
      paymentMethod: 'PAY_ON_RECEIPT',
      paymentStatus: 'UNPAID',
      latePayment: false,
      tableId: null,
      deliveryZoneId: null,
    })
    expect(order!.guestTokenHash).toBe(hashToken(response.guestToken))
    expect(order!.guestTokenEncrypted).not.toContain(response.guestToken)
    expect(decryptSecret(order!.guestTokenEncrypted)).toBe(response.guestToken)

    const items = await getDb().select().from(orderItems)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      orderId: order!.id,
      productId: menu.tea.id,
      position: 0,
      nameSnapshot: 'Trà sữa trân châu',
      qty: 2,
      unitPriceVnd: 35_000,
      lineTotalVnd: 70_000,
      optionsSnapshotJson: [{ groupId: menu.tea.size.groupId, groupName: 'Size', valueId: menu.tea.size.m.id, valueName: 'M', priceDeltaVnd: 0 }],
    })

    const events = await getDb().select().from(orderEvents)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      orderId: order!.id,
      eventType: 'CREATED',
      fromState: null,
      toState: 'NEW',
      actorUserId: null,
      metadata: { paymentMethod: 'PAY_ON_RECEIPT', fulfillmentType: 'PICKUP', itemCount: 1 },
    })
    expect(JSON.stringify(events[0]!.metadata)).not.toContain('0912345678')
  })

  it('creates a DINE_IN order bound to the table behind the token, with no customer data required', async () => {
    const { response } = await place(dineInBody(menu))
    expect(response.status).toBe('NEW')
    const [order] = await getDb().select().from(orders)
    expect(order).toMatchObject({ fulfillmentType: 'DINE_IN', tableId: menu.table.id, tableLabel: 'Bàn 05', customerName: null, customerPhone: null })
  })

  it('creates a DELIVERY order with the zone fee added and the address snapshot kept', async () => {
    const { response } = await place(deliveryBody(menu))
    expect(response.totalVnd).toBe(85_000)
    const [order] = await getDb().select().from(orders)
    expect(order).toMatchObject({
      fulfillmentType: 'DELIVERY',
      deliveryZoneId: menu.zone.id,
      deliveryZoneName: 'Quận 1',
      addressSnapshot: '12 Lê Lợi, Quận 1',
      subtotalVnd: 70_000,
      deliveryFeeVnd: 15_000,
      totalVnd: 85_000,
    })
  })

  it('recomputes prices on the server: size L + two toppings, several lines', async () => {
    const tea = teaItem(menu, {
      quantity: 1,
      optionValueIds: [menu.tea.size.l.id, menu.tea.topping.pearl.id, menu.tea.topping.jelly.id],
      expectedUnitPriceVnd: 35_000 + 7_000 + 5_000 + 5_000,
      note: 'ít ngọt',
    })
    const { response } = await place(pickupBody(menu, { items: [tea, breadItem(menu, { quantity: 3 })], expectedTotalVnd: 52_000 + 60_000 }))
    expect(response.totalVnd).toBe(112_000)

    const items = await getDb().select().from(orderItems).orderBy(orderItems.position)
    expect(items.map(item => [item.nameSnapshot, item.qty, item.unitPriceVnd, item.lineTotalVnd, item.note])).toEqual([
      ['Trà sữa trân châu', 1, 52_000, 52_000, 'ít ngọt'],
      ['Bánh mì que', 3, 20_000, 60_000, null],
    ])
    expect(items[0]!.optionsSnapshotJson.map(option => option.valueName)).toEqual(['L', 'Trân châu', 'Thạch'])
  })

  it('keeps the snapshot after the catalog changes', async () => {
    await place(pickupBody(menu))
    await getDb().update(products).set({ name: 'Tên mới', basePriceVnd: 99_000 }).where(eq(products.id, menu.tea.id))
    await getDb().update(productOptionValues).set({ name: 'Đổi tên' }).where(eq(productOptionValues.id, menu.tea.size.m.id))
    const [item] = await getDb().select().from(orderItems)
    expect(item).toMatchObject({ nameSnapshot: 'Trà sữa trân châu', unitPriceVnd: 35_000, lineTotalVnd: 70_000 })
    expect(item!.optionsSnapshotJson[0]).toMatchObject({ valueName: 'M' })
  })
})

describe('createOrder — store, mode, table, zone, payment checks', () => {
  it('404 for an unknown or suspended store', async () => {
    expect((await appError(place(pickupBody(menu), { slug: 'khong-co-quan-nay' }))).code).toBe('NOT_FOUND')
    await getDb().update(stores).set({ status: 'SUSPENDED' }).where(eq(stores.id, tenant.store.id))
    expect((await appError(place(pickupBody(menu)))).code).toBe('NOT_FOUND')
  })

  it('422 STORE_CLOSED when the store stopped accepting orders; the cart is untouched', async () => {
    await getDb().update(stores).set({ isAcceptingOrders: false }).where(eq(stores.id, tenant.store.id))
    const error = await appError(place(pickupBody(menu)))
    expect(error).toMatchObject({ code: 'STORE_CLOSED', status: 422 })
    expect(await countOf(orders)).toBe(0)
  })

  it.each([
    ['PICKUP', { pickupEnabled: false }, (m: SeededMenu) => pickupBody(m)],
    ['DINE_IN', { dineInEnabled: false }, (m: SeededMenu) => dineInBody(m)],
    ['DELIVERY', { deliveryEnabled: false }, (m: SeededMenu) => deliveryBody(m)],
  ])('422 MODE_DISABLED when %s is switched off', async (_mode, patch, makeBody) => {
    await getDb().update(stores).set(patch).where(eq(stores.id, tenant.store.id))
    expect(await appError(place(makeBody(menu)))).toMatchObject({ code: 'MODE_DISABLED', status: 422 })
  })

  it('422 INVALID_TABLE for a wrong, revoked or foreign table token', async () => {
    expect((await appError(place(dineInBody(menu, { tableToken: 'z'.repeat(43) })))).code).toBe('INVALID_TABLE')

    await getDb().update(storeTables).set({ active: false }).where(eq(storeTables.id, menu.table.id))
    expect((await appError(place(dineInBody(menu)))).code).toBe('INVALID_TABLE')

    const other = await createTenant('b')
    const otherMenu = await seedMenu(other.store)
    await getDb().update(storeTables).set({ active: true }).where(eq(storeTables.id, menu.table.id))
    expect((await appError(place(dineInBody(menu, { tableToken: otherMenu.table.token })))).code).toBe('INVALID_TABLE')
    expect(await countOf(orders)).toBe(0)
  })

  it('422 INVALID_ZONE for an unknown, inactive or foreign zone', async () => {
    expect((await appError(place(deliveryBody(menu, { deliveryZoneId: randomUUID() })))).code).toBe('INVALID_ZONE')

    await getDb().update(deliveryZones).set({ active: false }).where(eq(deliveryZones.id, menu.zone.id))
    expect((await appError(place(deliveryBody(menu)))).code).toBe('INVALID_ZONE')

    const other = await createTenant('b')
    const otherMenu = await seedMenu(other.store)
    expect((await appError(place(deliveryBody(menu, { deliveryZoneId: otherMenu.zone.id })))).code).toBe('INVALID_ZONE')
  })

  it('422 PAYMENT_METHOD_UNAVAILABLE for BANK_QR until PR5 and creates nothing', async () => {
    expect(await appError(place(pickupBody(menu, { paymentMethod: 'BANK_QR' })))).toMatchObject({ code: 'PAYMENT_METHOD_UNAVAILABLE', status: 422 })
    expect(await countOf(orders)).toBe(0)
  })
})

describe('createOrder — CART_STALE (Review Focus #7)', () => {
  const stale = async (body: CheckoutBody) => {
    const error = await appError(place(body))
    expect(error).toMatchObject({ code: 'CART_STALE', status: 409 })
    return error.details as { lines: Record<string, unknown>[], deliveryFeeVnd: number | null, totalVnd: number | null }
  }

  it('names a product that sold out and creates nothing', async () => {
    await getDb().update(products).set({ isAvailable: false }).where(eq(products.id, menu.bread.id))
    const details = await stale(pickupBody(menu, { items: [teaItem(menu, { quantity: 1 }), breadItem(menu)], expectedTotalVnd: 55_000 }))
    expect(details.lines).toEqual([{ index: 1, productId: menu.bread.id, name: 'Bánh mì que', reason: 'PRODUCT_UNAVAILABLE', currentUnitPriceVnd: null }])
    expect(await countOf(orders)).toBe(0)
  })

  it('treats a deactivated or unknown product as unavailable', async () => {
    await getDb().update(products).set({ active: false }).where(eq(products.id, menu.bread.id))
    const details = await stale(pickupBody(menu, { items: [breadItem(menu), breadItem(menu, { productId: randomUUID() })], expectedTotalVnd: 40_000 }))
    expect(details.lines.map(line => [line.index, line.reason, line.name])).toEqual([[0, 'PRODUCT_UNAVAILABLE', 'Bánh mì que'], [1, 'PRODUCT_UNAVAILABLE', null]])
  })

  it('uses the NEW price, reports it, and never the old one', async () => {
    await getDb().update(products).set({ basePriceVnd: 38_000 }).where(eq(products.id, menu.tea.id))
    const details = await stale(pickupBody(menu))
    expect(details.lines).toEqual([{ index: 0, productId: menu.tea.id, name: 'Trà sữa trân châu', reason: 'PRICE_CHANGED', currentUnitPriceVnd: 38_000 }])
    expect(await countOf(orders)).toBe(0)

    const { response } = await place(pickupBody(menu, { items: [teaItem(menu, { expectedUnitPriceVnd: 38_000 })], expectedTotalVnd: 76_000 }))
    expect(response.totalVnd).toBe(76_000)
    const [item] = await getDb().select().from(orderItems)
    expect(item!.unitPriceVnd).toBe(38_000)
  })

  it('reports a price change that comes from an option delta', async () => {
    await getDb().update(productOptionValues).set({ priceDeltaVnd: 9_000 }).where(eq(productOptionValues.id, menu.tea.size.l.id))
    const details = await stale(pickupBody(menu, {
      items: [teaItem(menu, { optionValueIds: [menu.tea.size.l.id], expectedUnitPriceVnd: 42_000 })],
      expectedTotalVnd: 84_000,
    }))
    expect(details.lines[0]).toMatchObject({ reason: 'PRICE_CHANGED', currentUnitPriceVnd: 44_000 })
  })

  it.each([
    ['an option the owner switched off', async (m: SeededMenu) => {
      await getDb().update(productOptionValues).set({ active: false }).where(eq(productOptionValues.id, m.tea.size.m.id))
      return teaItem(m)
    }],
    ['a missing required option', async (m: SeededMenu) => teaItem(m, { optionValueIds: [] })],
    ['too many toppings', async (m: SeededMenu) => teaItem(m, { optionValueIds: [m.tea.size.m.id, m.tea.topping.pearl.id, m.tea.topping.jelly.id, m.tea.size.l.id] })],
    ['an option of another product', async (m: SeededMenu) => breadItem(m, { optionValueIds: [m.tea.topping.pearl.id] })],
    ['an unknown option id', async (m: SeededMenu) => teaItem(m, { optionValueIds: [randomUUID()] })],
  ])('flags %s as OPTION_INVALID', async (_label, makeItem) => {
    const item = await makeItem(menu)
    const details = await stale(pickupBody(menu, { items: [item], expectedTotalVnd: 1 }))
    expect(details.lines).toHaveLength(1)
    expect(details.lines[0]).toMatchObject({ index: 0, reason: 'OPTION_INVALID' })
  })

  it('reports a changed delivery fee with the new total and no stale lines', async () => {
    await getDb().update(deliveryZones).set({ feeVnd: 20_000 }).where(eq(deliveryZones.id, menu.zone.id))
    const details = await stale(deliveryBody(menu))
    expect(details).toEqual({ lines: [], deliveryFeeVnd: 20_000, totalVnd: 90_000 })
  })

  it('rejects a total that does not match even when every line matches', async () => {
    const details = await stale(pickupBody(menu, { expectedTotalVnd: 1 }))
    expect(details).toEqual({ lines: [], deliveryFeeVnd: null, totalVnd: 70_000 })
  })
})

describe('createOrder — idempotency (Review Focus #8)', () => {
  it('returns the same order and the same guest token for a sequential retry, and does not spend rate limit', async () => {
    const body = pickupBody(menu)
    const first = await place(body)
    const spent = await getDb().select().from(rateLimits)
    const retry = await place(body)

    expect(retry.replayed).toBe(true)
    expect(retry.response).toEqual(first.response)
    expect(await countOf(orders)).toBe(1)
    expect(await countOf(orderEvents)).toBe(1)
    expect(await getDb().select().from(rateLimits)).toEqual(spent)
  })

  it('still replays after the store closed or the catalog changed', async () => {
    const body = pickupBody(menu)
    const first = await place(body)
    await getDb().update(stores).set({ isAcceptingOrders: false }).where(eq(stores.id, tenant.store.id))
    await getDb().update(products).set({ basePriceVnd: 1 }).where(eq(products.id, menu.tea.id))
    expect((await place(body)).response).toEqual(first.response)
  })

  it('creates exactly one order when 5 identical requests race', async () => {
    const body = pickupBody(menu)
    const results = await Promise.all(Array.from({ length: 5 }, () => place(body)))

    expect(new Set(results.map(result => result.response.guestToken)).size).toBe(1)
    expect(new Set(results.map(result => result.response.publicCode)).size).toBe(1)
    expect(results.filter(result => !result.replayed)).toHaveLength(1)
    expect(await countOf(orders)).toBe(1)
    expect(await countOf(orderItems)).toBe(1)
    expect(await countOf(orderEvents)).toBe(1)
  })

  it('scopes keys per store: the same key in another store is a different order', async () => {
    const other = await createTenant('b')
    await openStore(other.store.id)
    const otherMenu = await seedMenu(other.store)
    const key = randomUUID()
    const a = await place(pickupBody(menu, { idempotencyKey: key }))
    const b = await place(pickupBody(otherMenu, { idempotencyKey: key }), { slug: other.store.slug })
    expect(b.replayed).toBe(false)
    expect(b.response.guestToken).not.toBe(a.response.guestToken)
    expect(await countOf(orders)).toBe(2)
  })
})

describe('createOrder — rate limit', () => {
  it('allows 10 orders per ip+store per window, then 429, but still replays old keys', async () => {
    const firstBody = pickupBody(menu)
    const first = await place(firstBody)
    for (let i = 1; i < 10; i++) await place(pickupBody(menu))

    const error = await appError(place(pickupBody(menu)))
    expect(error).toMatchObject({ code: 'RATE_LIMITED', status: 429 })
    expect(await countOf(orders)).toBe(10)

    expect((await place(firstBody)).response).toEqual(first.response)
    await place(pickupBody(menu), { ip: '198.51.100.9' })
    expect(await countOf(orders)).toBe(11)
  })

  it('counts rejected carts too, so spamming invalid orders is not free', async () => {
    for (let i = 0; i < 10; i++) await appError(place(pickupBody(menu, { expectedTotalVnd: 1 })))
    expect((await appError(place(pickupBody(menu)))).code).toBe('RATE_LIMITED')
  })

  it('tracks the limit per store', async () => {
    const other = await createStore(tenant.org.id, 'b')
    await openStore(other.id)
    const otherMenu = await seedMenu(other)
    for (let i = 0; i < 10; i++) await place(pickupBody(menu))
    await place(pickupBody(otherMenu), { slug: other.slug })
  })
})

describe('createOrder — public code and atomicity', () => {
  it('retries a colliding public code and succeeds with the next one', async () => {
    await insertRawOrder(tenant.store, { publicCode: 'AAAAAA' })
    const generate = vi.fn().mockReturnValueOnce('AAAAAA').mockReturnValueOnce('AAAAAA').mockReturnValue('BBBBBB')
    const { response } = await place(pickupBody(menu), { deps: { generatePublicCode: generate } })
    expect(response.publicCode).toBe('BBBBBB')
    expect(generate).toHaveBeenCalledTimes(3)
  })

  it('gives up after 5 colliding codes and leaves nothing behind', async () => {
    await insertRawOrder(tenant.store, { publicCode: 'AAAAAA' })
    const generate = vi.fn().mockReturnValue('AAAAAA')
    await expect(place(pickupBody(menu), { deps: { generatePublicCode: generate } })).rejects.toThrow('public code')
    expect(generate).toHaveBeenCalledTimes(5)
    expect(await countOf(orders)).toBe(1)
    expect(await countOf(orderItems)).toBe(0)
  })

  it('rolls everything back when the transaction fails before commit', async () => {
    const boom = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(place(pickupBody(menu), { deps: { beforeCommit: boom } })).rejects.toThrow('boom')
    expect(await countOf(orders)).toBe(0)
    expect(await countOf(orderItems)).toBe(0)
    expect(await countOf(orderEvents)).toBe(0)
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `npm run test:integration -- tests/integration/create-order.test.ts`
Expected: FAIL — `Cannot find module '../../server/services/ordering/create-order'`.

- [ ] **Step 3: Viết `server/services/ordering/create-order.ts`**

```ts
import { createHash } from 'node:crypto'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { orderTotals, priceLine, validateSelection, type OptionGroupRule } from '#shared/pricing'
import type { CheckoutInput } from '#shared/schemas/checkout'
import type { OrderStatus, PaymentStatus } from '#shared/enums'
import type { CartStaleDetails, CartStaleLine, CartStaleReason, CreateOrderResponse, OrderItemOptionSnapshot } from '#shared/types/order'
import type { Db, DbOrTx, Tx } from '../../db/client'
import { isUniqueViolation } from '../../db/errors'
import { deliveryZones, orderEvents, orderItems, orders, productOptionGroups, productOptionValues, products, storeTables, stores } from '../../db/schema'
import { decryptSecret, encryptSecret } from '../../utils/crypto'
import { AppError } from '../../utils/errors'
import { generateToken, hashToken } from '../../utils/tokens'
import { CHECKOUT_RATE_LIMIT, MAX_PUBLIC_CODE_ATTEMPTS } from './constants'
import { generatePublicCode } from './public-code'
import { consumeRateLimit } from './rate-limit'

export interface CreateOrderResult {
  response: CreateOrderResponse
  /** True when an earlier request with the same idempotency key already created this order. */
  replayed: boolean
}

export interface CreateOrderDeps {
  generatePublicCode?: () => string
  /** Test seam: runs inside the transaction after every row is written. */
  beforeCommit?: (tx: Tx) => Promise<void>
}

type OrderRow = typeof orders.$inferSelect

interface PublicStore {
  id: string
  orgId: string
  isAcceptingOrders: boolean
  dineInEnabled: boolean
  pickupEnabled: boolean
  deliveryEnabled: boolean
}

interface Place {
  tableId: string | null
  tableLabel: string | null
  zoneId: string | null
  zoneName: string | null
  deliveryFeeVnd: number
}

interface PricedLine {
  productId: string
  name: string
  options: OrderItemOptionSnapshot[]
  quantity: number
  unitPriceVnd: number
  lineTotalVnd: number
  note: string | null
}

const MODE_FLAG = { DINE_IN: 'dineInEnabled', PICKUP: 'pickupEnabled', DELIVERY: 'deliveryEnabled' } as const

export async function createOrder(
  db: Db,
  args: { slug: string, input: CheckoutInput, ip: string | null },
  deps: CreateOrderDeps = {},
): Promise<CreateOrderResult> {
  const { input } = args
  const store = await findPublicStore(db, args.slug)

  // A retry must never be throttled, so the idempotency lookup comes before the rate limit.
  const existing = await findByIdempotencyKey(db, store.id, input.idempotencyKey)
  if (existing) return replay(existing)

  const allowed = await consumeRateLimit(db, `checkout:${store.id}:${hashIp(args.ip)}`, CHECKOUT_RATE_LIMIT)
  if (!allowed) throw new AppError('RATE_LIMITED', 'Bạn đặt quá nhanh, vui lòng thử lại sau ít phút')

  try {
    return await db.transaction(tx => placeOrder(tx, store, input, deps))
  }
  catch (err) {
    // Safety net: the advisory lock below already serialises same-key requests.
    if (isUniqueViolation(err, 'orders_store_idem_uq')) {
      const winner = await findByIdempotencyKey(db, store.id, input.idempotencyKey)
      if (winner) return replay(winner)
    }
    throw err
  }
}

async function placeOrder(tx: Tx, store: PublicStore, input: CheckoutInput, deps: CreateOrderDeps): Promise<CreateOrderResult> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`order:${store.id}:${input.idempotencyKey}`}))`)
  const existing = await findByIdempotencyKey(tx, store.id, input.idempotencyKey)
  if (existing) return replay(existing)

  assertStoreAcceptsOrders(store, input)
  const payment = resolvePayment(input)
  const place = await resolvePlace(tx, store, input)
  const lines = await priceCart(tx, store.id, input.items, place)
  const totals = orderTotals({ lineTotalsVnd: lines.map(line => line.lineTotalVnd), deliveryFeeVnd: place.deliveryFeeVnd })
  if (totals.totalVnd !== input.expectedTotalVnd) {
    const details: CartStaleDetails = { lines: [], deliveryFeeVnd: place.zoneId ? totals.deliveryFeeVnd : null, totalVnd: totals.totalVnd }
    throw new AppError('CART_STALE', 'Phí giao hoặc tổng tiền đã thay đổi, vui lòng kiểm tra lại', details)
  }

  const guestToken = generateToken()
  const makeCode = deps.generatePublicCode ?? generatePublicCode
  let order: OrderRow | undefined
  for (let attempt = 0; attempt < MAX_PUBLIC_CODE_ATTEMPTS && !order; attempt++) {
    const [row] = await tx
      .insert(orders)
      .values({
        orgId: store.orgId,
        storeId: store.id,
        publicCode: makeCode(),
        guestTokenHash: hashToken(guestToken),
        guestTokenEncrypted: encryptSecret(guestToken),
        fulfillmentType: input.fulfillmentType,
        tableId: place.tableId,
        tableLabel: place.tableLabel,
        customerName: input.customer.name,
        customerPhone: input.customer.phone,
        deliveryZoneId: place.zoneId,
        deliveryZoneName: place.zoneName,
        addressSnapshot: input.customer.address,
        notes: input.note,
        subtotalVnd: totals.subtotalVnd,
        deliveryFeeVnd: totals.deliveryFeeVnd,
        totalVnd: totals.totalVnd,
        status: payment.status,
        paymentMethod: input.paymentMethod,
        paymentStatus: payment.paymentStatus,
        idempotencyKey: input.idempotencyKey,
      })
      .onConflictDoNothing({ target: [orders.storeId, orders.publicCode] })
      .returning()
    order = row
  }
  if (!order) throw new Error(`Could not allocate a unique public code after ${MAX_PUBLIC_CODE_ATTEMPTS} attempts`)

  await tx.insert(orderItems).values(lines.map((line, position) => ({
    orgId: store.orgId,
    storeId: store.id,
    orderId: order.id,
    productId: line.productId,
    position,
    nameSnapshot: line.name,
    optionsSnapshotJson: line.options,
    qty: line.quantity,
    unitPriceVnd: line.unitPriceVnd,
    lineTotalVnd: line.lineTotalVnd,
    note: line.note,
  })))
  await tx.insert(orderEvents).values({
    orgId: store.orgId,
    storeId: store.id,
    orderId: order.id,
    eventType: 'CREATED',
    fromState: null,
    toState: order.status,
    metadata: { paymentMethod: input.paymentMethod, fulfillmentType: input.fulfillmentType, itemCount: lines.length },
  })
  await deps.beforeCommit?.(tx)

  return {
    response: { publicCode: order.publicCode, guestToken, status: order.status, paymentStatus: order.paymentStatus, totalVnd: order.totalVnd },
    replayed: false,
  }
}

async function findPublicStore(db: DbOrTx, slug: string): Promise<PublicStore> {
  const [row] = await db
    .select({
      id: stores.id,
      orgId: stores.orgId,
      isAcceptingOrders: stores.isAcceptingOrders,
      dineInEnabled: stores.dineInEnabled,
      pickupEnabled: stores.pickupEnabled,
      deliveryEnabled: stores.deliveryEnabled,
    })
    .from(stores)
    .where(and(eq(stores.slug, slug), eq(stores.status, 'ACTIVE')))
    .limit(1)
  if (!row) throw new AppError('NOT_FOUND', 'Không tìm thấy cửa hàng')
  return row
}

async function findByIdempotencyKey(db: DbOrTx, storeId: string, key: string): Promise<OrderRow | undefined> {
  const [row] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.storeId, storeId), eq(orders.idempotencyKey, key)))
    .limit(1)
  return row
}

function replay(order: OrderRow): CreateOrderResult {
  return {
    response: {
      publicCode: order.publicCode,
      guestToken: decryptSecret(order.guestTokenEncrypted),
      status: order.status,
      paymentStatus: order.paymentStatus,
      totalVnd: order.totalVnd,
    },
    replayed: true,
  }
}

function hashIp(ip: string | null): string {
  return createHash('sha256').update(ip ?? 'unknown').digest('hex').slice(0, 16)
}

function assertStoreAcceptsOrders(store: PublicStore, input: CheckoutInput): void {
  if (!store.isAcceptingOrders) throw new AppError('STORE_CLOSED', 'Quán đang tạm nghỉ, chưa nhận đơn')
  if (!store[MODE_FLAG[input.fulfillmentType]]) throw new AppError('MODE_DISABLED', 'Quán không nhận đơn theo hình thức này')
}

/** The only place that decides the initial status; PR5 adds the BANK_QR branch here. */
function resolvePayment(input: CheckoutInput): { status: OrderStatus, paymentStatus: PaymentStatus } {
  if (input.paymentMethod === 'BANK_QR') {
    throw new AppError('PAYMENT_METHOD_UNAVAILABLE', 'Quán chưa hỗ trợ thanh toán chuyển khoản')
  }
  return { status: 'NEW', paymentStatus: 'UNPAID' }
}

async function resolvePlace(tx: Tx, store: PublicStore, input: CheckoutInput): Promise<Place> {
  const none: Place = { tableId: null, tableLabel: null, zoneId: null, zoneName: null, deliveryFeeVnd: 0 }

  if (input.fulfillmentType === 'DINE_IN') {
    const [table] = input.tableToken
      ? await tx
          .select({ id: storeTables.id, displayName: storeTables.displayName })
          .from(storeTables)
          .where(and(eq(storeTables.storeId, store.id), eq(storeTables.tokenHash, hashToken(input.tableToken)), eq(storeTables.active, true)))
          .limit(1)
      : []
    if (!table) throw new AppError('INVALID_TABLE', 'Mã QR bàn không hợp lệ, vui lòng quét lại')
    return { ...none, tableId: table.id, tableLabel: table.displayName }
  }

  if (input.fulfillmentType === 'DELIVERY') {
    const [zone] = input.deliveryZoneId
      ? await tx
          .select({ id: deliveryZones.id, name: deliveryZones.name, feeVnd: deliveryZones.feeVnd })
          .from(deliveryZones)
          .where(and(eq(deliveryZones.storeId, store.id), eq(deliveryZones.id, input.deliveryZoneId), eq(deliveryZones.active, true)))
          .limit(1)
      : []
    if (!zone) throw new AppError('INVALID_ZONE', 'Khu vực giao hàng không hợp lệ')
    return { ...none, zoneId: zone.id, zoneName: zone.name, deliveryFeeVnd: zone.feeVnd }
  }

  return none
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, item: V): void {
  const list = map.get(key)
  if (list) list.push(item)
  else map.set(key, [item])
}

async function priceCart(tx: Tx, storeId: string, items: CheckoutInput['items'], place: Place): Promise<PricedLine[]> {
  const productIds = [...new Set(items.map(item => item.productId))]
  const productRows = await tx
    .select({ id: products.id, name: products.name, basePriceVnd: products.basePriceVnd, isAvailable: products.isAvailable, active: products.active })
    .from(products)
    .where(and(eq(products.storeId, storeId), inArray(products.id, productIds)))
  const groupRows = await tx
    .select({
      id: productOptionGroups.id,
      productId: productOptionGroups.productId,
      name: productOptionGroups.name,
      minSelect: productOptionGroups.minSelect,
      maxSelect: productOptionGroups.maxSelect,
      required: productOptionGroups.required,
    })
    .from(productOptionGroups)
    .where(and(eq(productOptionGroups.storeId, storeId), inArray(productOptionGroups.productId, productIds)))
    .orderBy(asc(productOptionGroups.position), asc(productOptionGroups.id))
  const valueRows = groupRows.length === 0
    ? []
    : await tx
        .select({
          id: productOptionValues.id,
          groupId: productOptionValues.groupId,
          name: productOptionValues.name,
          priceDeltaVnd: productOptionValues.priceDeltaVnd,
          active: productOptionValues.active,
        })
        .from(productOptionValues)
        .where(and(eq(productOptionValues.storeId, storeId), inArray(productOptionValues.groupId, groupRows.map(group => group.id))))
        .orderBy(asc(productOptionValues.position), asc(productOptionValues.id))

  const valuesByGroup = new Map<string, typeof valueRows>()
  for (const value of valueRows) pushTo(valuesByGroup, value.groupId, value)

  interface ProductRules {
    rules: OptionGroupRule[]
    snapshots: Map<string, OrderItemOptionSnapshot>
  }
  const rulesByProduct = new Map<string, ProductRules>()
  for (const group of groupRows) {
    const values = valuesByGroup.get(group.id) ?? []
    let entry = rulesByProduct.get(group.productId)
    if (!entry) {
      entry = { rules: [], snapshots: new Map() }
      rulesByProduct.set(group.productId, entry)
    }
    entry.rules.push({
      id: group.id,
      minSelect: group.minSelect,
      maxSelect: group.maxSelect,
      required: group.required,
      values: values.map(value => ({ id: value.id, priceDeltaVnd: value.priceDeltaVnd, active: value.active })),
    })
    for (const value of values) {
      entry.snapshots.set(value.id, { groupId: group.id, groupName: group.name, valueId: value.id, valueName: value.name, priceDeltaVnd: value.priceDeltaVnd })
    }
  }

  const productById = new Map(productRows.map(product => [product.id, product]))
  const priced: PricedLine[] = []
  const staleLines: CartStaleLine[] = []

  for (const [index, item] of items.entries()) {
    const product = productById.get(item.productId)
    const flag = (reason: CartStaleReason, currentUnitPriceVnd: number | null = null) => {
      staleLines.push({ index, productId: item.productId, name: product?.name ?? null, reason, currentUnitPriceVnd })
    }

    if (!product || !product.active || !product.isAvailable) {
      flag('PRODUCT_UNAVAILABLE')
      continue
    }
    const entry = rulesByProduct.get(product.id) ?? { rules: [], snapshots: new Map<string, OrderItemOptionSnapshot>() }
    const selection = validateSelection(entry.rules, item.optionValueIds)
    if (!selection.ok) {
      flag('OPTION_INVALID')
      continue
    }
    const options = selection.valueIds.map(id => entry.snapshots.get(id)!)
    const { unitPriceVnd, lineTotalVnd } = priceLine({
      basePriceVnd: product.basePriceVnd,
      deltasVnd: options.map(option => option.priceDeltaVnd),
      quantity: item.quantity,
    })
    if (unitPriceVnd !== item.expectedUnitPriceVnd) {
      flag('PRICE_CHANGED', unitPriceVnd)
      continue
    }
    priced.push({ productId: product.id, name: product.name, options, quantity: item.quantity, unitPriceVnd, lineTotalVnd, note: item.note })
  }

  if (staleLines.length > 0) {
    const details: CartStaleDetails = { lines: staleLines, deliveryFeeVnd: place.zoneId ? place.deliveryFeeVnd : null, totalVnd: null }
    throw new AppError('CART_STALE', 'Giỏ hàng đã thay đổi, vui lòng kiểm tra lại', details)
  }
  return priced
}
```

- [ ] **Step 4: Chạy test để xác nhận đạt**

Run: `npm run test:integration -- tests/integration/create-order.test.ts`
Expected: PASS (tất cả test trong 7 `describe`). Nếu `Promise.all` 5 request báo thiếu kết nối, kiểm tra `createOrder` không gọi `db` bên trong callback `transaction` (chỉ dùng `tx`) — Pool mặc định 10 kết nối.

- [ ] **Step 5: Commit**

```bash
git add server/services/ordering/create-order.ts tests/integration/create-order.test.ts
git commit -m "feat(order): add atomic createOrder with server-side pricing and idempotency" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: `transitions.ts` — bảng chuyển trạng thái thuần

**Files:**
- Create: `server/services/ordering/transitions.ts`, `tests/unit/server/transitions.test.ts`

**Interfaces:**
- Consumes: `FulfillmentType`, `OrderStatus`, `PaymentStatus`, `ORDER_STATUSES` (Task 2); `StoreRole` (`shared/types/identity.ts`, PR1).
- Produces (PR4 board và PR6 cron dùng; giữ nguyên tên):
  - `type ActorRole = StoreRole | 'SYSTEM'` (`StoreRole` = `'OWNER' | 'STAFF'`)
  - `nextStatuses(order: { status: OrderStatus; fulfillmentType: FulfillmentType }, actorRole: ActorRole): OrderStatus[]` — các bước **tiến** hợp lệ; không bao giờ chứa `CANCELLED` (hủy đi qua `canCancel` + endpoint riêng). `SYSTEM` chỉ có `AWAITING_PAYMENT → NEW`; staff/owner không có bước đó.
  - `canCancel(order: { status: OrderStatus; paymentStatus: PaymentStatus }, actorRole: ActorRole): boolean` — chỉ từ `AWAITING_PAYMENT | NEW | PREPARING`; owner luôn được, staff chỉ khi `paymentStatus ∈ {UNPAID, PENDING}`, `SYSTEM` chỉ hủy được `AWAITING_PAYMENT` (cron hết hạn 24 giờ của PR6).

- [ ] **Step 1: Viết unit test thất bại (kiểu bảng, theo spec §5.3)**

`tests/unit/server/transitions.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { FULFILLMENT_TYPES, ORDER_STATUSES, PAYMENT_STATUSES, type FulfillmentType, type OrderStatus, type PaymentStatus } from '#shared/enums'
import { canCancel, nextStatuses, type ActorRole } from '../../../server/services/ordering/transitions'

const ROLES: ActorRole[] = ['OWNER', 'STAFF', 'SYSTEM']

describe('nextStatuses', () => {
  it.each<[OrderStatus, FulfillmentType, ActorRole, OrderStatus[]]>([
    ['AWAITING_PAYMENT', 'PICKUP', 'SYSTEM', ['NEW']],
    ['AWAITING_PAYMENT', 'DELIVERY', 'STAFF', []],
    ['AWAITING_PAYMENT', 'DINE_IN', 'OWNER', []],
    ['NEW', 'PICKUP', 'STAFF', ['PREPARING', 'READY']],
    ['NEW', 'DELIVERY', 'OWNER', ['PREPARING', 'READY']],
    ['NEW', 'DINE_IN', 'SYSTEM', []],
    ['PREPARING', 'PICKUP', 'STAFF', ['READY']],
    ['PREPARING', 'DELIVERY', 'SYSTEM', []],
    ['READY', 'DINE_IN', 'STAFF', ['COMPLETED']],
    ['READY', 'PICKUP', 'OWNER', ['COMPLETED']],
    ['READY', 'DELIVERY', 'STAFF', ['DELIVERING']],
    ['DELIVERING', 'DELIVERY', 'STAFF', ['COMPLETED']],
    ['COMPLETED', 'PICKUP', 'OWNER', []],
    ['CANCELLED', 'DELIVERY', 'OWNER', []],
    ['COMPLETED', 'DELIVERY', 'SYSTEM', []],
  ])('%s (%s) as %s → %j', (status, fulfillmentType, role, expected) => {
    expect(nextStatuses({ status, fulfillmentType }, role)).toEqual(expected)
  })

  it('never moves backwards, never cancels, never returns to AWAITING_PAYMENT', () => {
    for (const status of ORDER_STATUSES) {
      for (const fulfillmentType of FULFILLMENT_TYPES) {
        for (const role of ROLES) {
          for (const next of nextStatuses({ status, fulfillmentType }, role)) {
            expect(next).not.toBe('CANCELLED')
            expect(next).not.toBe('AWAITING_PAYMENT')
            expect(ORDER_STATUSES.indexOf(next)).toBeGreaterThan(ORDER_STATUSES.indexOf(status))
          }
        }
      }
    }
  })

  it('only delivery orders pass through DELIVERING', () => {
    for (const fulfillmentType of ['DINE_IN', 'PICKUP'] as const) {
      expect(nextStatuses({ status: 'READY', fulfillmentType }, 'STAFF')).not.toContain('DELIVERING')
    }
  })
})

describe('canCancel', () => {
  const CANCELLABLE: OrderStatus[] = ['AWAITING_PAYMENT', 'NEW', 'PREPARING']

  it.each(CANCELLABLE.flatMap(status => PAYMENT_STATUSES.map(paymentStatus => [status, paymentStatus] as const)))(
    'owner may cancel %s / %s',
    (status, paymentStatus) => {
      expect(canCancel({ status, paymentStatus }, 'OWNER')).toBe(true)
    },
  )

  it.each(CANCELLABLE.flatMap(status => PAYMENT_STATUSES.map(paymentStatus => [status, paymentStatus] as const)))(
    'staff may cancel %s / %s only while nothing was collected',
    (status, paymentStatus) => {
      const expected: PaymentStatus[] = ['UNPAID', 'PENDING']
      expect(canCancel({ status, paymentStatus }, 'STAFF')).toBe(expected.includes(paymentStatus))
    },
  )

  it('system can only cancel an order that is still awaiting payment', () => {
    expect(canCancel({ status: 'AWAITING_PAYMENT', paymentStatus: 'PENDING' }, 'SYSTEM')).toBe(true)
    expect(canCancel({ status: 'NEW', paymentStatus: 'UNPAID' }, 'SYSTEM')).toBe(false)
  })

  it.each(['READY', 'DELIVERING', 'COMPLETED', 'CANCELLED'] as const)('nobody cancels a %s order', (status) => {
    for (const paymentStatus of PAYMENT_STATUSES) {
      for (const role of ROLES) expect(canCancel({ status, paymentStatus }, role)).toBe(false)
    }
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `npx vitest run --project unit tests/unit/server/transitions.test.ts`
Expected: FAIL — `Cannot find module '../../../server/services/ordering/transitions'`.

- [ ] **Step 3: Viết implementation**

`server/services/ordering/transitions.ts`:

```ts
import type { FulfillmentType, OrderStatus, PaymentStatus } from '#shared/enums'
import type { StoreRole } from '#shared/types/identity'

export type ActorRole = StoreRole | 'SYSTEM'

const CANCELLABLE_STATUSES: readonly OrderStatus[] = ['AWAITING_PAYMENT', 'NEW', 'PREPARING']
const STAFF_CANCEL_PAYMENT: readonly PaymentStatus[] = ['UNPAID', 'PENDING']

export function nextStatuses(order: { status: OrderStatus, fulfillmentType: FulfillmentType }, actorRole: ActorRole): OrderStatus[] {
  if (actorRole === 'SYSTEM') return order.status === 'AWAITING_PAYMENT' ? ['NEW'] : []

  switch (order.status) {
    case 'NEW':
      return ['PREPARING', 'READY']
    case 'PREPARING':
      return ['READY']
    case 'READY':
      return order.fulfillmentType === 'DELIVERY' ? ['DELIVERING'] : ['COMPLETED']
    case 'DELIVERING':
      return ['COMPLETED']
    default:
      return []
  }
}

export function canCancel(order: { status: OrderStatus, paymentStatus: PaymentStatus }, actorRole: ActorRole): boolean {
  if (!CANCELLABLE_STATUSES.includes(order.status)) return false
  if (actorRole === 'SYSTEM') return order.status === 'AWAITING_PAYMENT'
  if (actorRole === 'OWNER') return true
  return STAFF_CANCEL_PAYMENT.includes(order.paymentStatus)
}
```

- [ ] **Step 4: Chạy test để xác nhận đạt**

Run: `npx vitest run --project unit tests/unit/server/transitions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/ordering/transitions.ts tests/unit/server/transitions.test.ts
git commit -m "feat(order): add pure order status transition table" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 7: Route public — đặt đơn, theo dõi đơn, che token trong log, PII, ma trận tenant

**Files:**
- Create: `server/services/ordering/public-view.ts`, `server/utils/safe-path.ts`, `server/api/public/stores/[slug]/orders.post.ts`, `server/api/public/orders/[token].get.ts`, `tests/unit/server/safe-path.test.ts`, `tests/integration/public-view.test.ts`, `tests/api/public-ordering.test.ts`
- Modify: `server/utils/api-handler.ts`, `tests/api/tenant-isolation.test.ts`

**Interfaces:**
- Consumes: `createOrder`, `CreateOrderResult` (Task 5); `checkoutInputSchema` (Task 2); `maskPhone` (Task 2); `PublicOrderView`, `PublicOrderItem` (Task 2); `orders`, `orderItems`, `stores` (schema); `hashToken`; `AppError`; `defineApiHandler`, `parseBody`; `getDb`; test helpers `findForbiddenKeys` (`tests/support/json.ts`, PR2) và fixtures Task 3.
- Produces (client Task 10–11, PR5 thêm `qr`, PR4 không dùng trực tiếp):
  - `getPublicOrderView(db: DbOrTx, token: string): Promise<PublicOrderView>` — ném `NOT_FOUND` (`'Không tìm thấy đơn hàng'`) cho token sai hình dạng, không tồn tại hay sai chữ hoa/thường; không phân biệt các trường hợp.
  - `safePath(rawPath: string): string` — bỏ query và thay token trong `/api/public/orders/<token>`, `/o/<token>`, `/api/webhooks/sepay/<key>` bằng `[REDACTED]`.
  - `POST /api/public/stores/:slug/orders` → `201 CreateOrderResponse` (đơn mới) hoặc `200` (retry cùng `idempotencyKey`); header `Cache-Control: no-store`.
  - `GET /api/public/orders/:token` → `200 PublicOrderView`; header `Cache-Control: no-store`, `X-Robots-Tag: noindex`; token sai → `404 { code: 'NOT_FOUND' }`.

- [ ] **Step 1: Viết unit test thất bại cho `safePath`**

`tests/unit/server/safe-path.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { safePath } from '../../../server/utils/safe-path'

describe('safePath', () => {
  it.each([
    ['/api/public/orders/abc_DEF-123xyz?cache=1', '/api/public/orders/[REDACTED]'],
    ['/api/public/orders/abc_DEF-123xyz', '/api/public/orders/[REDACTED]'],
    ['/o/abc_DEF-123xyz', '/o/[REDACTED]'],
    ['/api/webhooks/sepay/endpointKey_123', '/api/webhooks/sepay/[REDACTED]'],
    ['/api/public/stores/quan-a/orders', '/api/public/stores/quan-a/orders'],
    ['/api/health?token=secret', '/api/health'],
    ['/api/stores/3f6c1a52-8d0e-4b7a-9c11-2e5d7f0a9b34', '/api/stores/3f6c1a52-8d0e-4b7a-9c11-2e5d7f0a9b34'],
  ])('%s → %s', (input, expected) => {
    expect(safePath(input)).toBe(expected)
  })
})
```

- [ ] **Step 2: Viết integration test thất bại cho `getPublicOrderView`**

`tests/integration/public-view.test.ts`:

```ts
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { checkoutInputSchema, type CheckoutBody } from '#shared/schemas/checkout'
import { closeDb, getDb } from '../../server/db/client'
import { orders } from '../../server/db/schema'
import { createOrder } from '../../server/services/ordering/create-order'
import { getPublicOrderView } from '../../server/services/ordering/public-view'
import { AppError } from '../../server/utils/errors'
import { deliveryBody, dineInBody, openStore, pickupBody, seedMenu, teaItem, type SeededMenu } from '../support/checkout-fixtures'
import { resetDb } from '../support/db'
import { createTenant } from '../support/fixtures'
import { findForbiddenKeys } from '../support/json'

let tenant: Awaited<ReturnType<typeof createTenant>>
let menu: SeededMenu

const place = (body: CheckoutBody) =>
  createOrder(getDb(), { slug: tenant.store.slug, input: checkoutInputSchema.parse(body), ip: '203.0.113.7' })

beforeEach(async () => {
  await resetDb()
  tenant = await createTenant('a')
  await openStore(tenant.store.id, { deliveryEnabled: true })
  menu = await seedMenu(tenant.store)
})

afterAll(async () => {
  await closeDb()
})

describe('getPublicOrderView', () => {
  it('returns the customer-facing view of a delivery order without internal ids or PII', async () => {
    const { response } = await place(deliveryBody(menu))
    const view = await getPublicOrderView(getDb(), response.guestToken)

    expect(view).toEqual({
      publicCode: response.publicCode,
      status: 'NEW',
      paymentStatus: 'UNPAID',
      paymentMethod: 'PAY_ON_RECEIPT',
      fulfillmentType: 'DELIVERY',
      tableLabel: null,
      deliveryZoneName: 'Quận 1',
      customerName: 'Lan',
      phoneMasked: '*******678',
      items: [{
        name: 'Trà sữa trân châu',
        quantity: 2,
        unitPriceVnd: 35_000,
        lineTotalVnd: 70_000,
        options: [{ name: 'M', priceDeltaVnd: 0 }],
        note: null,
      }],
      subtotalVnd: 70_000,
      deliveryFeeVnd: 15_000,
      totalVnd: 85_000,
      createdAt: expect.any(String),
      store: { name: tenant.store.name, slug: tenant.store.slug },
      qr: null,
    })

    expect(findForbiddenKeys(view)).toEqual([])
    const raw = JSON.stringify(view)
    for (const secret of ['0912345678', '12 Lê Lợi', tenant.org.id, tenant.store.id]) expect(raw).not.toContain(secret)
  })

  it('shows the table label for dine-in and keeps item notes verbatim', async () => {
    const { response } = await place(dineInBody(menu, { items: [teaItem(menu, { note: '<b>ít đá</b>' })] }))
    const view = await getPublicOrderView(getDb(), response.guestToken)
    expect(view).toMatchObject({ fulfillmentType: 'DINE_IN', tableLabel: 'Bàn 05', deliveryZoneName: null, customerName: null, phoneMasked: null })
    expect(view.items[0]!.note).toBe('<b>ít đá</b>')
  })

  it('follows status changes made by staff', async () => {
    const { response } = await place(pickupBody(menu))
    await getDb().update(orders).set({ status: 'PREPARING' }).where(eq(orders.publicCode, response.publicCode))
    expect((await getPublicOrderView(getDb(), response.guestToken)).status).toBe('PREPARING')
  })

  it('answers every kind of bad token with the same NOT_FOUND', async () => {
    const { response } = await place(pickupBody(menu))
    const [row] = await getDb().select().from(orders)
    const bad = ['', 'short', 'x'.repeat(43), 'a b c', '../../etc/passwd', response.guestToken.toUpperCase(), `${response.guestToken}x`, row!.guestTokenHash]
    for (const token of bad) {
      const error = await getPublicOrderView(getDb(), token).then(() => null, (e: unknown) => e)
      expect(error).toBeInstanceOf(AppError)
      expect(error).toMatchObject({ code: 'NOT_FOUND', message: 'Không tìm thấy đơn hàng' })
    }
  })
})
```

- [ ] **Step 3: Viết API test thất bại**

`tests/api/public-ordering.test.ts`:

```ts
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { fetch, setup } from '@nuxt/test-utils/e2e'
import { count, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { orders, products } from '../../server/db/schema'
import { breadItem, deliveryBody, openStore, pickupBody, seedMenu, teaItem, type SeededMenu } from '../support/checkout-fixtures'
import { resetDb } from '../support/db'
import { createTenant } from '../support/fixtures'
import { findForbiddenKeys } from '../support/json'

await setup({
  rootDir: fileURLToPath(new URL('../..', import.meta.url)),
  server: true,
  build: true,
  nuxtConfig: { typescript: { typeCheck: false } },
})

let ipSeq = 0
const nextIp = () => `198.51.100.${(ipSeq += 1)}`

async function http(method: 'GET' | 'POST', path: string, body?: unknown, ip = nextIp()) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) }
}

const post = (slug: string, body: unknown, ip?: string) => http('POST', `/api/public/stores/${slug}/orders`, body, ip)
const track = (token: string) => http('GET', `/api/public/orders/${token}`)

let tenant: Awaited<ReturnType<typeof createTenant>>
let menu: SeededMenu

beforeAll(async () => {
  await resetDb()
  tenant = await createTenant('a')
  await openStore(tenant.store.id, { deliveryEnabled: true })
  menu = await seedMenu(tenant.store)
})

afterAll(async () => {
  await closeDb()
})

describe('POST /api/public/stores/:slug/orders', () => {
  it('creates an order: 201, no-store, only the documented keys', async () => {
    const res = await post(tenant.store.slug, pickupBody(menu))
    expect(res.status).toBe(201)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(Object.keys(res.body).sort()).toEqual(['guestToken', 'paymentStatus', 'publicCode', 'status', 'totalVnd'])
    expect(res.body).toMatchObject({ status: 'NEW', paymentStatus: 'UNPAID', totalVnd: 70_000 })
    expect(findForbiddenKeys(res.body)).toEqual([])
  })

  it('retrying the same key returns 200 with the same order and token (Review Focus #8)', async () => {
    const body = pickupBody(menu)
    const first = await post(tenant.store.slug, body)
    const retry = await post(tenant.store.slug, body)
    expect(first.status).toBe(201)
    expect(retry.status).toBe(200)
    expect(retry.body).toEqual(first.body)
    const [{ n }] = await getDb().select({ n: count() }).from(orders).where(eq(orders.publicCode, first.body.publicCode))
    expect(n).toBe(1)
  })

  it.each([
    ['+84 912 345 678', 201],
    ['0912.345.678', 201],
    ['0212345678', 400],
    ['091234', 400],
  ])('phone %j → %i', async (phone, status) => {
    const res = await post(tenant.store.slug, pickupBody(menu, { customer: { name: 'Lan', phone } }))
    expect(res.status).toBe(status)
    if (status === 400) {
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'customer.phone', message: 'Số điện thoại không hợp lệ' }] })
    }
  })

  it('answers whitespace-only names with an inline error on the name field', async () => {
    const res = await post(tenant.store.slug, pickupBody(menu, { customer: { name: '   ', phone: '0912345678' } }))
    expect(res).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED', details: [{ path: 'customer.name' }] } })
  })

  it('rejects malformed JSON with 400 and an unknown store with 404', async () => {
    expect(await post(tenant.store.slug, '{"items":')).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
    expect(await post('khong-co-quan', pickupBody(menu))).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
  })

  it('409 CART_STALE names the line and carries the new price when the owner changed it', async () => {
    await getDb().update(products).set({ basePriceVnd: 39_000 }).where(eq(products.id, menu.bread.id))
    const res = await post(tenant.store.slug, pickupBody(menu, { items: [breadItem(menu)], expectedTotalVnd: 20_000 }))
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({
      code: 'CART_STALE',
      details: { lines: [{ index: 0, productId: menu.bread.id, reason: 'PRICE_CHANGED', currentUnitPriceVnd: 39_000 }], totalVnd: null },
    })
    await getDb().update(products).set({ basePriceVnd: 20_000 }).where(eq(products.id, menu.bread.id))
  })

  it('422 STORE_CLOSED for a store that is not accepting orders', async () => {
    const closed = await createTenant('closed')
    const closedMenu = await seedMenu(closed.store)
    expect(await post(closed.store.slug, pickupBody(closedMenu))).toMatchObject({ status: 422, body: { code: 'STORE_CLOSED' } })
  })

  it('429 RATE_LIMITED on the 11th new order from one ip, while other ips still work', async () => {
    const limited = await createTenant('limited')
    await openStore(limited.store.id)
    const limitedMenu = await seedMenu(limited.store)
    for (let i = 0; i < 10; i++) expect((await post(limited.store.slug, pickupBody(limitedMenu), '192.0.2.77')).status).toBe(201)
    expect(await post(limited.store.slug, pickupBody(limitedMenu), '192.0.2.77')).toMatchObject({ status: 429, body: { code: 'RATE_LIMITED' } })
    expect((await post(limited.store.slug, pickupBody(limitedMenu), '192.0.2.78')).status).toBe(201)
  })
})

describe('GET /api/public/orders/:token', () => {
  it('returns the tracking view with no-store/noindex and no PII (Review Focus #3)', async () => {
    const created = await post(tenant.store.slug, deliveryBody(menu))
    const res = await track(created.body.guestToken)

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
    expect(res.body).toMatchObject({
      publicCode: created.body.publicCode,
      status: 'NEW',
      fulfillmentType: 'DELIVERY',
      deliveryZoneName: 'Quận 1',
      customerName: 'Lan',
      phoneMasked: '*******678',
      totalVnd: 85_000,
      store: { name: tenant.store.name, slug: tenant.store.slug },
      qr: null,
    })

    expect(findForbiddenKeys(res.body)).toEqual([])
    const raw = JSON.stringify(res.body)
    for (const secret of ['0912345678', '12 Lê Lợi', tenant.org.id, tenant.store.id, 'guestToken', 'idempotency']) expect(raw).not.toContain(secret)
  })

  it('returns text exactly as typed, so the page can render it escaped', async () => {
    const note = '<img src=x onerror="window.__xss=1">'
    const created = await post(tenant.store.slug, pickupBody(menu, { items: [teaItem(menu, { note })] }))
    const res = await track(created.body.guestToken)
    expect(res.body.items[0].note).toBe(note)
  })

  it('answers a wrong token exactly like a random one (404, same body), with no-store', async () => {
    const created = await post(tenant.store.slug, pickupBody(menu))
    const random = await track(randomBytes(32).toString('base64url'))
    const lowered = await track(created.body.guestToken.toUpperCase())
    const malformed = await track('abc')
    expect(random).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
    expect(random.headers.get('cache-control')).toBe('no-store')
    expect(lowered.status).toBe(404)
    expect(lowered.body).toEqual(random.body)
    expect(malformed.body).toEqual(random.body)
  })

  it('never confuses two orders', async () => {
    const a = await post(tenant.store.slug, pickupBody(menu, { customer: { name: 'Ân', phone: '0911111111' } }))
    const b = await post(tenant.store.slug, pickupBody(menu, { customer: { name: 'Bình', phone: '0922222222' } }))
    expect((await track(a.body.guestToken)).body).toMatchObject({ customerName: 'Ân', phoneMasked: '*******111' })
    expect((await track(b.body.guestToken)).body).toMatchObject({ customerName: 'Bình', phoneMasked: '*******222' })
  })
})
```

- [ ] **Step 4: Chạy test để xác nhận thất bại**

Run: `npx vitest run --project unit tests/unit/server/safe-path.test.ts && npm run test:integration -- tests/integration/public-view.test.ts`
Expected: FAIL — thiếu module `safe-path` và `public-view`. (API test chạy ở Step 8.)

- [ ] **Step 5: Viết `safe-path.ts`, `public-view.ts`, sửa `api-handler.ts`**

`server/utils/safe-path.ts`:

```ts
// Paths whose last segment is a credential (guest token, webhook endpoint key).
const CREDENTIAL_PATHS = /^(\/(?:api\/public\/orders|o|api\/webhooks\/sepay)\/)[^/?#]+/

export function safePath(rawPath: string): string {
  return rawPath.split('?')[0]!.replace(CREDENTIAL_PATHS, '$1[REDACTED]')
}
```

Trong `server/utils/api-handler.ts`: thêm `import { safePath } from './safe-path'` và đổi `path: event.path.split('?')[0],` thành `path: safePath(event.path),`.

`server/services/ordering/public-view.ts`:

```ts
import { and, asc, eq } from 'drizzle-orm'
import type { PublicOrderView } from '#shared/types/order'
import { maskPhone } from '#shared/phone'
import type { DbOrTx } from '../../db/client'
import { orderItems, orders, stores } from '../../db/schema'
import { AppError } from '../../utils/errors'
import { hashToken } from '../../utils/tokens'

// Tokens are 32 random bytes in base64url; anything else cannot match, so skip the database.
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,64}$/

const notFound = () => new AppError('NOT_FOUND', 'Không tìm thấy đơn hàng')

export async function getPublicOrderView(db: DbOrTx, token: string): Promise<PublicOrderView> {
  if (!TOKEN_SHAPE.test(token)) throw notFound()

  const [order] = await db
    .select({
      id: orders.id,
      storeId: orders.storeId,
      publicCode: orders.publicCode,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      paymentMethod: orders.paymentMethod,
      fulfillmentType: orders.fulfillmentType,
      tableLabel: orders.tableLabel,
      deliveryZoneName: orders.deliveryZoneName,
      customerName: orders.customerName,
      customerPhone: orders.customerPhone,
      subtotalVnd: orders.subtotalVnd,
      deliveryFeeVnd: orders.deliveryFeeVnd,
      totalVnd: orders.totalVnd,
      createdAt: orders.createdAt,
      storeName: stores.name,
      storeSlug: stores.slug,
    })
    .from(orders)
    .innerJoin(stores, eq(stores.id, orders.storeId))
    .where(eq(orders.guestTokenHash, hashToken(token)))
    .limit(1)
  if (!order) throw notFound()

  const items = await db
    .select({
      name: orderItems.nameSnapshot,
      quantity: orderItems.qty,
      unitPriceVnd: orderItems.unitPriceVnd,
      lineTotalVnd: orderItems.lineTotalVnd,
      options: orderItems.optionsSnapshotJson,
      note: orderItems.note,
    })
    .from(orderItems)
    .where(and(eq(orderItems.storeId, order.storeId), eq(orderItems.orderId, order.id)))
    .orderBy(asc(orderItems.position))

  // Deliberately omitted: order id, org/store ids, full phone, address, order-level note.
  return {
    publicCode: order.publicCode,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    fulfillmentType: order.fulfillmentType,
    tableLabel: order.tableLabel,
    deliveryZoneName: order.deliveryZoneName,
    customerName: order.customerName,
    phoneMasked: maskPhone(order.customerPhone),
    items: items.map(item => ({
      name: item.name,
      quantity: item.quantity,
      unitPriceVnd: item.unitPriceVnd,
      lineTotalVnd: item.lineTotalVnd,
      options: item.options.map(option => ({ name: option.valueName, priceDeltaVnd: option.priceDeltaVnd })),
      note: item.note,
    })),
    subtotalVnd: order.subtotalVnd,
    deliveryFeeVnd: order.deliveryFeeVnd,
    totalVnd: order.totalVnd,
    createdAt: order.createdAt.toISOString(),
    store: { name: order.storeName, slug: order.storeSlug },
    qr: null,
  }
}
```

- [ ] **Step 6: Viết route handler**

`server/api/public/stores/[slug]/orders.post.ts`:

```ts
import { getRequestIP, getRouterParam, setResponseHeader, setResponseStatus } from 'h3'
import { checkoutInputSchema } from '#shared/schemas/checkout'
import { getDb } from '../../../../db/client'
import { createOrder } from '../../../../services/ordering/create-order'
import { defineApiHandler } from '../../../../utils/api-handler'
import { parseBody } from '../../../../utils/validation'

export default defineApiHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const input = await parseBody(event, checkoutInputSchema)
  // Vercel overwrites X-Forwarded-For with the real client address.
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? null
  const { response, replayed } = await createOrder(getDb(), { slug: getRouterParam(event, 'slug') ?? '', input, ip })
  setResponseStatus(event, replayed ? 200 : 201)
  return response
})
```

`server/api/public/orders/[token].get.ts`:

```ts
import { getRouterParam, setResponseHeader } from 'h3'
import { getDb } from '../../../db/client'
import { getPublicOrderView } from '../../../services/ordering/public-view'
import { defineApiHandler } from '../../../utils/api-handler'

export default defineApiHandler(async (event) => {
  // Set before any throw so even the 404 is never cached, and crawlers/links in chat apps skip it.
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'X-Robots-Tag', 'noindex')
  return getPublicOrderView(getDb(), getRouterParam(event, 'token') ?? '')
})
```

- [ ] **Step 7: Chạy unit + integration để xác nhận đạt**

Run: `npx vitest run --project unit tests/unit/server/safe-path.test.ts && npm run test:integration -- tests/integration/public-view.test.ts`
Expected: PASS.

- [ ] **Step 8: Chạy API test**

Run: `npm run test:api -- tests/api/public-ordering.test.ts`
Expected: PASS. Nếu test 429 flake do `x-forwarded-for` bị bỏ qua, kiểm tra `getRequestIP(event, { xForwardedFor: true })`.

- [ ] **Step 9: Thêm hàng ma trận tenant vào `tests/api/tenant-isolation.test.ts`**

Route public không đọc danh tính, nên các hàng của ma trận khẳng định hai điều: (1) mọi actor, kể cả ẩn danh và staff bị khoá, nhận **cùng** kết quả; (2) tài nguyên của store A (bàn, khu vực, món, option) không dùng được ở store B và không ghi gì vào B.

Sửa phần đầu file:

```ts
import { randomBytes, randomUUID } from 'node:crypto'
import { count, eq } from 'drizzle-orm'
```

```ts
import { orders, stores } from '../../server/db/schema'
```

```ts
import { deliveryBody, dineInBody, openStore, pickupBody, seedMenu, teaItem, type SeededMenu } from '../support/checkout-fixtures'
```

Đổi `ids` và thêm biến menu:

```ts
const ids = {} as { orgA: string, storeA1: string, storeA2: string, storeB: string, storeA1Slug: string, storeBSlug: string }
let menuA: SeededMenu
let menuB: SeededMenu
```

Cho `call` nhận header bổ sung (đổi chữ ký và dòng khai báo `headers`):

```ts
async function call(method: string, path: string, token?: string | null, body?: unknown, extraHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extraHeaders }
```

Trong `beforeAll`, ngay sau khi tạo `b`, thêm; và thêm `storeBSlug` vào `Object.assign(ids, …)`:

```ts
  await openStore(a.store.id, { deliveryEnabled: true })
  await openStore(b.store.id, { deliveryEnabled: true })
  menuA = await seedMenu(a.store)
  menuB = await seedMenu(b.store)
```

```ts
  Object.assign(ids, { orgA: a.org.id, storeA1: a.store.id, storeA2: storeA2.id, storeB: b.store.id, storeA1Slug: a.store.slug, storeBSlug: b.store.slug })
```

Thêm vào cuối file:

```ts
describe('public ordering routes: identity is irrelevant, stores never leak', () => {
  const callers: (Actor | 'anonymous')[] = ['anonymous', 'ownerA', 'staffA1', 'staffA2', 'disabledA1', 'ownerB']
  let ipSeq = 0
  const nextIp = () => ({ 'x-forwarded-for': `203.0.113.${(ipSeq += 1)}` })
  const placeOrder = (slug: string, body: unknown, token: string | null = null) =>
    call('POST', `/api/public/stores/${slug}/orders`, token, body, nextIp())
  const ordersIn = async (storeId: string) =>
    (await getDb().select({ n: count() }).from(orders).where(eq(orders.storeId, storeId)))[0]!.n

  it.each(callers)('%s places an order in store A1 → 201', async (caller) => {
    const res = await placeOrder(ids.storeA1Slug, pickupBody(menuA), caller === 'anonymous' ? null : tokens[caller])
    expect(res.status).toBe(201)
    expect(res.body).toHaveProperty('guestToken')
  })

  describe('tracking by token', () => {
    let tracked: { guestToken: string, publicCode: string }

    beforeAll(async () => {
      tracked = (await placeOrder(ids.storeA1Slug, deliveryBody(menuA))).body
    })

    it.each(callers)('%s reads the same public view → 200', async (caller) => {
      const res = await call('GET', `/api/public/orders/${tracked.guestToken}`, caller === 'anonymous' ? null : tokens[caller])
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ publicCode: tracked.publicCode, phoneMasked: '*******678' })
      expect(JSON.stringify(res.body)).not.toContain(ids.orgA)
      expect(JSON.stringify(res.body)).not.toContain(ids.storeA1)
    })

    it.each(callers)('%s with a wrong token → 404, identical to a random token', async (caller) => {
      const token = caller === 'anonymous' ? null : tokens[caller]
      const wrong = await call('GET', `/api/public/orders/${tracked.guestToken.toUpperCase()}`, token)
      const random = await call('GET', `/api/public/orders/${randomBytes(32).toString('base64url')}`, token)
      expect(wrong).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
      expect(wrong).toEqual(random)
    })
  })

  describe('store A resources are useless in store B', () => {
    it('a table QR token of store A → 422 INVALID_TABLE, nothing stored in B', async () => {
      const before = await ordersIn(ids.storeB)
      const res = await placeOrder(ids.storeBSlug, dineInBody(menuB, { tableToken: menuA.table.token }))
      expect(res).toMatchObject({ status: 422, body: { code: 'INVALID_TABLE' } })
      expect(await ordersIn(ids.storeB)).toBe(before)
    })

    it('a delivery zone of store A → 422 INVALID_ZONE', async () => {
      const before = await ordersIn(ids.storeB)
      const res = await placeOrder(ids.storeBSlug, deliveryBody(menuB, { deliveryZoneId: menuA.zone.id }))
      expect(res).toMatchObject({ status: 422, body: { code: 'INVALID_ZONE' } })
      expect(await ordersIn(ids.storeB)).toBe(before)
    })

    it('a product of store A → 409 CART_STALE as if it did not exist', async () => {
      const before = await ordersIn(ids.storeB)
      const res = await placeOrder(ids.storeBSlug, pickupBody(menuB, { items: [teaItem(menuA)] }))
      expect(res).toMatchObject({ status: 409, body: { code: 'CART_STALE', details: { lines: [{ index: 0, reason: 'PRODUCT_UNAVAILABLE', name: null }] } } })
      expect(await ordersIn(ids.storeB)).toBe(before)
    })

    it('option values of store A on a product of store B → 409 OPTION_INVALID', async () => {
      const res = await placeOrder(ids.storeBSlug, pickupBody(menuB, { items: [teaItem(menuB, { optionValueIds: [menuA.tea.size.m.id] })] }))
      expect(res).toMatchObject({ status: 409, body: { code: 'CART_STALE', details: { lines: [{ index: 0, reason: 'OPTION_INVALID' }] } } })
    })

    it('the same idempotency key in two stores yields two independent orders', async () => {
      const key = randomUUID()
      const a = await placeOrder(ids.storeA1Slug, pickupBody(menuA, { idempotencyKey: key }))
      const b = await placeOrder(ids.storeBSlug, pickupBody(menuB, { idempotencyKey: key }))
      expect([a.status, b.status]).toEqual([201, 201])
      expect(a.body.guestToken).not.toBe(b.body.guestToken)
    })
  })
})
```

- [ ] **Step 10: Chạy ma trận tenant và toàn bộ API test**

Run: `npm run test:api`
Expected: PASS (`health`, `public-ordering`, `tenant-isolation` và các file API của PR2).

- [ ] **Step 11: Commit**

```bash
git add server/services/ordering/public-view.ts server/utils/safe-path.ts server/utils/api-handler.ts server/api/public tests/unit/server/safe-path.test.ts tests/integration/public-view.test.ts tests/api/public-ordering.test.ts tests/api/tenant-isolation.test.ts
git commit -m "feat(order): add public checkout and guest tracking routes with PII and tenant tests" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 8: Hàm thuần phía client — uuid, giỏ hàng, payload checkout, nhãn, đơn gần đây

**Files:**
- Create: `app/utils/uuid.ts`, `app/utils/cart-storage.ts`, `app/utils/checkout-body.ts`, `app/utils/order-labels.ts`, `app/utils/recent-orders.ts`, `tests/unit/app/uuid.test.ts`, `tests/unit/app/cart-storage.test.ts`, `tests/unit/app/checkout-body.test.ts`, `tests/unit/app/order-labels.test.ts`, `tests/unit/app/recent-orders.test.ts`

**Interfaces:**
- Consumes: `MAX_LINE_QUANTITY`, `priceLine`, `selectionDeltas`, `toOptionRules`, `validateSelection` (`shared/pricing.ts`, PR2); `PublicProduct` (`shared/types/catalog.ts`, PR2); `CHECKOUT_LIMITS`, `checkoutInputSchema`, `CheckoutBody` (Task 2); `CartStaleLine`, `CartStaleReason`, `PublicOrderView` (Task 2); enums (Task 2).
- Produces (composables Task 9, UI Task 10–11 dùng; giữ nguyên tên):
  - `app/utils/uuid.ts`: `uuidv4(): string` (dùng `crypto.randomUUID`, fallback `getRandomValues` khi trang chạy trên `http://` không an toàn).
  - `app/utils/cart-storage.ts`:
    - `interface CartLine { lineId: string; productId: string; name: string; optionValueIds: string[]; optionLabels: string[]; unitPriceVnd: number; quantity: number; note: string; stale: CartStaleReason | null; currentUnitPriceVnd: number | null }`
    - `type NewCartLine = Omit<CartLine, 'lineId' | 'stale' | 'currentUnitPriceVnd'>`
    - `interface CartState { version: 1; lines: CartLine[]; pendingIdempotencyKey: string | null; pendingFingerprint: string | null; fulfillmentType: 'PICKUP' | 'DELIVERY' | null; customer: { name: string; phone: string; address: string }; deliveryZoneId: string | null; note: string }`
    - `type CartFormPatch = Partial<Pick<CartState, 'fulfillmentType' | 'customer' | 'deliveryZoneId' | 'note'>>`
    - `emptyCart()`, `isCartFull(state)`, `addLine(state, input: NewCartLine, newId: () => string)`, `setQuantity(state, lineId, quantity)`, `removeLine(state, lineId)`, `markStale(state, lines: CartStaleLine[])`, `acceptCurrentPrice(state, lineId)`, `reconcileWithMenu(state, products: PublicProduct[])`, `newLineFromProduct(product: PublicProduct, selection: { optionValueIds: string[]; quantity: number; note?: string }): NewCartLine`, `updateForm(state, patch: CartFormPatch)`, `ensureIdempotency(state, fingerprint: string, newKey: () => string): { state: CartState; key: string }`, `clearAfterSuccess(state)`, `cartCount(state)`, `cartSubtotal(state)`, `hasStaleLines(state)`, `parseStoredCart(raw: string | null): CartState`, `serializeCart(state): string`.
  - `app/utils/checkout-body.ts`: `interface CheckoutForm { customer: { name: string; phone: string; address: string }; deliveryZoneId: string | null; note: string }`, `type CheckoutPayload = Omit<CheckoutBody, 'idempotencyKey'>`, `buildCheckoutPayload(args: { lines: CartLine[]; form: CheckoutForm; fulfillmentType: FulfillmentType; tableToken: string | null; paymentMethod: PaymentMethod; deliveryFeeVnd: number }): CheckoutPayload`, `checkoutFingerprint(payload: CheckoutPayload): string`.
  - `app/utils/order-labels.ts`: `customerStatusLabel(status, fulfillmentType): string`, `customerStatusTone(status): 'success' | 'warning' | 'error' | 'info' | 'neutral'`, `orderProgressSteps(fulfillmentType): OrderStatus[]`, `customerPaymentLabel(method, status): string`, `fulfillmentSummary(view: Pick<PublicOrderView, 'fulfillmentType' | 'tableLabel' | 'deliveryZoneName'>): string`.
  - `app/utils/recent-orders.ts`: `interface RecentOrder { token: string; publicCode: string; storeSlug: string; storeName: string; totalVnd: number; createdAt: string }`, `parseRecentOrders(raw: string | null): RecentOrder[]`, `addRecentOrder(list, entry): RecentOrder[]` (mới nhất trước, bỏ trùng token, tối đa 20), `recentForStore(list, slug, nowMs, maxAgeMs = 48 * 3_600_000): RecentOrder[]`.

- [ ] **Step 1: Viết test thất bại cho `uuid`, `checkout-body`, `order-labels`, `recent-orders`**

`tests/unit/app/uuid.test.ts`:

```ts
import { webcrypto } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { uuidv4 } from '../../../app/utils/uuid'

afterEach(() => vi.unstubAllGlobals())

describe('uuidv4', () => {
  it('returns a valid v4 uuid', () => {
    expect(z.uuid().safeParse(uuidv4()).success).toBe(true)
  })

  it('still works where crypto.randomUUID is missing (http:// LAN pages)', () => {
    vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) })
    const ids = Array.from({ length: 50 }, () => uuidv4())
    for (const id of ids) expect(z.uuid().safeParse(id).success).toBe(true)
    expect(new Set(ids).size).toBe(50)
  })
})
```

`tests/unit/app/checkout-body.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { checkoutInputSchema } from '#shared/schemas/checkout'
import { buildCheckoutPayload, checkoutFingerprint, type CheckoutForm } from '../../../app/utils/checkout-body'
import type { CartLine } from '../../../app/utils/cart-storage'

const UUID = '3f6c1a52-8d0e-4b7a-9c11-2e5d7f0a9b34'
const ZONE = '6a1d2c33-5b4e-4f10-8a77-0c9e1d2b3a45'
const PRODUCT = '9b8a7c66-1d2e-4a3b-8c4d-5e6f7a8b9c01'
const OPTION = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f'

const line = (over: Partial<CartLine> = {}): CartLine => ({
  lineId: 'l1',
  productId: PRODUCT,
  name: 'Trà sữa',
  optionValueIds: [OPTION],
  optionLabels: ['M'],
  unitPriceVnd: 35_000,
  quantity: 2,
  note: '',
  stale: null,
  currentUnitPriceVnd: null,
  ...over,
})

const form = (over: Partial<CheckoutForm> = {}): CheckoutForm => ({
  customer: { name: '  Lan ', phone: '0912 345 678', address: ' 12 Lê Lợi ' },
  deliveryZoneId: ZONE,
  note: '',
  ...over,
})

const base = { lines: [line()], paymentMethod: 'PAY_ON_RECEIPT' as const, deliveryFeeVnd: 15_000 }

const accepted = (payload: object) => checkoutInputSchema.safeParse({ ...payload, idempotencyKey: UUID })

describe('buildCheckoutPayload', () => {
  it('builds a pickup payload without table, zone or address, and the server schema accepts it', () => {
    const payload = buildCheckoutPayload({ ...base, form: form(), fulfillmentType: 'PICKUP', tableToken: 'tok' })
    expect(payload).toEqual({
      fulfillmentType: 'PICKUP',
      customer: { name: 'Lan', phone: '0912 345 678' },
      items: [{ productId: PRODUCT, quantity: 2, optionValueIds: [OPTION], expectedUnitPriceVnd: 35_000 }],
      paymentMethod: 'PAY_ON_RECEIPT',
      expectedTotalVnd: 70_000,
    })
    expect(accepted(payload).success).toBe(true)
  })

  it('builds a dine-in payload with only the table token when the customer typed nothing', () => {
    const payload = buildCheckoutPayload({ ...base, form: form({ customer: { name: '', phone: '', address: '' } }), fulfillmentType: 'DINE_IN', tableToken: 'tok-123' })
    expect(payload).toMatchObject({ fulfillmentType: 'DINE_IN', tableToken: 'tok-123', customer: {} })
    expect(payload).not.toHaveProperty('deliveryZoneId')
    expect(accepted(payload).success).toBe(true)
  })

  it('builds a delivery payload: zone, address and the fee in the expected total', () => {
    const payload = buildCheckoutPayload({ ...base, form: form(), fulfillmentType: 'DELIVERY', tableToken: null })
    expect(payload).toMatchObject({
      fulfillmentType: 'DELIVERY',
      deliveryZoneId: ZONE,
      customer: { name: 'Lan', phone: '0912 345 678', address: '12 Lê Lợi' },
      expectedTotalVnd: 85_000,
    })
    expect(accepted(payload).success).toBe(true)
  })

  it('includes item and order notes only when they have text', () => {
    const withNotes = buildCheckoutPayload({ ...base, lines: [line({ note: ' ít đá ' })], form: form({ note: ' gọi trước ' }), fulfillmentType: 'PICKUP', tableToken: null })
    expect(withNotes.items![0]).toMatchObject({ note: 'ít đá' })
    expect(withNotes).toMatchObject({ note: 'gọi trước' })
    const without = buildCheckoutPayload({ ...base, form: form({ note: '   ' }), fulfillmentType: 'PICKUP', tableToken: null })
    expect(without).not.toHaveProperty('note')
    expect(without.items![0]).not.toHaveProperty('note')
  })

  it('a delivery form missing the zone is rejected by the same schema the server uses', () => {
    const payload = buildCheckoutPayload({ ...base, form: form({ deliveryZoneId: null }), fulfillmentType: 'DELIVERY', tableToken: null })
    expect(accepted(payload).success).toBe(false)
  })
})

describe('checkoutFingerprint', () => {
  const make = (over: Partial<CartLine> = {}) =>
    buildCheckoutPayload({ ...base, lines: [line(over)], form: form(), fulfillmentType: 'PICKUP', tableToken: null })

  it('is identical for identical input and different after any change', () => {
    expect(checkoutFingerprint(make())).toBe(checkoutFingerprint(make()))
    expect(checkoutFingerprint(make())).not.toBe(checkoutFingerprint(make({ quantity: 3 })))
    expect(checkoutFingerprint(make())).not.toBe(checkoutFingerprint(make({ unitPriceVnd: 36_000 })))
  })
})
```

`tests/unit/app/order-labels.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ORDER_STATUSES } from '#shared/enums'
import { customerPaymentLabel, customerStatusLabel, customerStatusTone, fulfillmentSummary, orderProgressSteps } from '../../../app/utils/order-labels'

describe('customerStatusLabel', () => {
  it.each([
    ['AWAITING_PAYMENT', 'PICKUP', 'Chờ thanh toán'],
    ['NEW', 'PICKUP', 'Đã gửi quán'],
    ['PREPARING', 'DINE_IN', 'Quán đang làm món'],
    ['READY', 'DINE_IN', 'Món đã xong'],
    ['READY', 'PICKUP', 'Sẵn sàng, mời bạn lấy món'],
    ['READY', 'DELIVERY', 'Món đã xong, chờ giao'],
    ['DELIVERING', 'DELIVERY', 'Đang giao đến bạn'],
    ['COMPLETED', 'PICKUP', 'Hoàn tất'],
    ['CANCELLED', 'DELIVERY', 'Quán đã hủy đơn'],
  ] as const)('%s (%s) → %s', (status, type, label) => {
    expect(customerStatusLabel(status, type)).toBe(label)
  })

  it('has a label and a tone for every status', () => {
    for (const status of ORDER_STATUSES) {
      expect(customerStatusLabel(status, 'PICKUP')).not.toBe('')
      expect(['success', 'warning', 'error', 'info', 'neutral']).toContain(customerStatusTone(status))
    }
  })
})

describe('orderProgressSteps', () => {
  it('skips DELIVERING for dine-in and pickup', () => {
    expect(orderProgressSteps('DINE_IN')).toEqual(['NEW', 'PREPARING', 'READY', 'COMPLETED'])
    expect(orderProgressSteps('PICKUP')).toEqual(['NEW', 'PREPARING', 'READY', 'COMPLETED'])
    expect(orderProgressSteps('DELIVERY')).toEqual(['NEW', 'PREPARING', 'READY', 'DELIVERING', 'COMPLETED'])
  })
})

describe('customerPaymentLabel', () => {
  it.each([
    ['PAY_ON_RECEIPT', 'UNPAID', 'Trả tiền khi nhận món'],
    ['PAY_ON_RECEIPT', 'PAID', 'Đã thanh toán'],
    ['BANK_QR', 'PENDING', 'Chờ chuyển khoản'],
    ['BANK_QR', 'PAID', 'Đã thanh toán'],
    ['BANK_QR', 'REVIEW_REQUIRED', 'Đang đối soát thanh toán'],
    ['BANK_QR', 'REFUND_DUE', 'Chờ hoàn tiền'],
    ['BANK_QR', 'REFUNDED', 'Đã hoàn tiền'],
  ] as const)('%s / %s → %s', (method, status, label) => {
    expect(customerPaymentLabel(method, status)).toBe(label)
  })
})

describe('fulfillmentSummary', () => {
  it('names the table, pickup or delivery zone', () => {
    expect(fulfillmentSummary({ fulfillmentType: 'DINE_IN', tableLabel: 'Bàn 05', deliveryZoneName: null })).toBe('Bàn 05')
    expect(fulfillmentSummary({ fulfillmentType: 'DINE_IN', tableLabel: null, deliveryZoneName: null })).toBe('Tại bàn')
    expect(fulfillmentSummary({ fulfillmentType: 'PICKUP', tableLabel: null, deliveryZoneName: null })).toBe('Mang đi')
    expect(fulfillmentSummary({ fulfillmentType: 'DELIVERY', tableLabel: null, deliveryZoneName: 'Quận 1' })).toBe('Giao hàng · Quận 1')
  })
})
```

`tests/unit/app/recent-orders.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { addRecentOrder, parseRecentOrders, recentForStore, type RecentOrder } from '../../../app/utils/recent-orders'

const HOUR = 3_600_000
const NOW = Date.parse('2026-10-31T12:00:00Z')

const entry = (over: Partial<RecentOrder> = {}): RecentOrder => ({
  token: 't1',
  publicCode: 'AB23CD',
  storeSlug: 'tra-sua-may',
  storeName: 'Trà sữa Mây',
  totalVnd: 70_000,
  createdAt: new Date(NOW).toISOString(),
  ...over,
})

describe('addRecentOrder', () => {
  it('puts the newest first and drops a duplicate token', () => {
    const list = addRecentOrder(addRecentOrder([], entry({ token: 'a' })), entry({ token: 'b' }))
    expect(list.map(item => item.token)).toEqual(['b', 'a'])
    expect(addRecentOrder(list, entry({ token: 'a', totalVnd: 1 })).map(item => item.token)).toEqual(['a', 'b'])
  })

  it('keeps at most 20 orders', () => {
    let list: RecentOrder[] = []
    for (let i = 0; i < 25; i++) list = addRecentOrder(list, entry({ token: `t${i}` }))
    expect(list).toHaveLength(20)
    expect(list[0]!.token).toBe('t24')
  })
})

describe('recentForStore', () => {
  it('returns only this store, only recent orders', () => {
    const list = [
      entry({ token: 'old', createdAt: new Date(NOW - 49 * HOUR).toISOString() }),
      entry({ token: 'other', storeSlug: 'quan-khac' }),
      entry({ token: 'fresh', createdAt: new Date(NOW - 2 * HOUR).toISOString() }),
    ]
    expect(recentForStore(list, 'tra-sua-may', NOW).map(item => item.token)).toEqual(['fresh'])
  })
})

describe('parseRecentOrders', () => {
  it.each([null, '', 'not json', '{"a":1}', '[{"token":1}]'])('returns [] for %j', (raw) => {
    expect(parseRecentOrders(raw)).toEqual([])
  })

  it('round-trips valid data and drops malformed entries', () => {
    const raw = JSON.stringify([entry(), { token: 5 }, entry({ token: 't2' })])
    expect(parseRecentOrders(raw).map(item => item.token)).toEqual(['t1', 't2'])
  })
})
```

- [ ] **Step 2: Viết test thất bại cho `cart-storage`**

`tests/unit/app/cart-storage.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { PublicProduct } from '#shared/types/catalog'
import {
  acceptCurrentPrice,
  addLine,
  cartCount,
  cartSubtotal,
  clearAfterSuccess,
  emptyCart,
  ensureIdempotency,
  hasStaleLines,
  isCartFull,
  markStale,
  newLineFromProduct,
  parseStoredCart,
  reconcileWithMenu,
  removeLine,
  serializeCart,
  setQuantity,
  updateForm,
  type NewCartLine,
} from '../../../app/utils/cart-storage'

const tea: PublicProduct = {
  id: 'p-tea',
  categoryId: null,
  name: 'Trà sữa',
  description: null,
  basePriceVnd: 35_000,
  isAvailable: true,
  imageUrl: null,
  optionGroups: [
    { id: 'g-size', name: 'Size', required: true, minSelect: 1, maxSelect: 1, values: [{ id: 'm', name: 'M', priceDeltaVnd: 0 }, { id: 'l', name: 'L', priceDeltaVnd: 7_000 }] },
    { id: 'g-top', name: 'Topping', required: false, minSelect: 0, maxSelect: 2, values: [{ id: 'pearl', name: 'Trân châu', priceDeltaVnd: 5_000 }] },
  ],
}
const bread: PublicProduct = { ...tea, id: 'p-bread', name: 'Bánh mì', basePriceVnd: 20_000, optionGroups: [] }

const ids = () => {
  let n = 0
  return () => `line-${++n}`
}

const teaLine = (over: Partial<NewCartLine> = {}): NewCartLine => ({
  productId: 'p-tea',
  name: 'Trà sữa',
  optionValueIds: ['m'],
  optionLabels: ['M'],
  unitPriceVnd: 35_000,
  quantity: 1,
  note: '',
  ...over,
})

describe('addLine / setQuantity / removeLine', () => {
  it('merges identical lines (same product, options in any order, same note) and sums quantity', () => {
    const newId = ids()
    let cart = addLine(emptyCart(), teaLine({ optionValueIds: ['m', 'pearl'], quantity: 2 }), newId)
    cart = addLine(cart, teaLine({ optionValueIds: ['pearl', 'm'], quantity: 3 }), newId)
    expect(cart.lines).toHaveLength(1)
    expect(cart.lines[0]!.quantity).toBe(5)
  })

  it('keeps different options or notes as separate lines', () => {
    const newId = ids()
    let cart = addLine(emptyCart(), teaLine(), newId)
    cart = addLine(cart, teaLine({ optionValueIds: ['l'] }), newId)
    cart = addLine(cart, teaLine({ note: 'ít đá' }), newId)
    expect(cart.lines).toHaveLength(3)
  })

  it('caps a line at 50 and the cart at 30 lines', () => {
    const newId = ids()
    let cart = addLine(emptyCart(), teaLine({ quantity: 40 }), newId)
    cart = addLine(cart, teaLine({ quantity: 40 }), newId)
    expect(cart.lines[0]!.quantity).toBe(50)

    let full = emptyCart()
    for (let i = 0; i < 35; i++) full = addLine(full, teaLine({ productId: `p${i}` }), newId)
    expect(full.lines).toHaveLength(30)
    expect(isCartFull(full)).toBe(true)
  })

  it('sets, clamps and removes by quantity', () => {
    const newId = ids()
    const cart = addLine(emptyCart(), teaLine({ quantity: 2 }), newId)
    expect(setQuantity(cart, 'line-1', 7).lines[0]!.quantity).toBe(7)
    expect(setQuantity(cart, 'line-1', 999).lines[0]!.quantity).toBe(50)
    expect(setQuantity(cart, 'line-1', 0).lines).toEqual([])
    expect(removeLine(cart, 'line-1').lines).toEqual([])
    expect(removeLine(cart, 'nope').lines).toHaveLength(1)
  })

  it('computes count and subtotal', () => {
    const newId = ids()
    let cart = addLine(emptyCart(), teaLine({ quantity: 2 }), newId)
    cart = addLine(cart, teaLine({ productId: 'p-bread', unitPriceVnd: 20_000, optionValueIds: [], quantity: 1 }), newId)
    expect(cartCount(cart)).toBe(3)
    expect(cartSubtotal(cart)).toBe(90_000)
  })
})

describe('newLineFromProduct', () => {
  it('prices the selection with the shared pricing rules and labels the options', () => {
    const line = newLineFromProduct(tea, { optionValueIds: ['l', 'pearl'], quantity: 2, note: '  ít ngọt ' })
    expect(line).toEqual({
      productId: 'p-tea',
      name: 'Trà sữa',
      optionValueIds: ['l', 'pearl'],
      optionLabels: ['L', 'Trân châu'],
      unitPriceVnd: 47_000,
      quantity: 2,
      note: 'ít ngọt',
    })
  })
})

describe('stale handling', () => {
  const twoLines = () => {
    const newId = ids()
    return addLine(addLine(emptyCart(), teaLine(), newId), teaLine({ productId: 'p-bread', unitPriceVnd: 20_000, optionValueIds: [] }), newId)
  }

  it('markStale applies the server verdict by index and product id only', () => {
    const cart = markStale(twoLines(), [
      { index: 1, productId: 'p-bread', name: 'Bánh mì', reason: 'PRICE_CHANGED', currentUnitPriceVnd: 22_000 },
      { index: 0, productId: 'someone-else', name: null, reason: 'PRODUCT_UNAVAILABLE', currentUnitPriceVnd: null },
    ])
    expect(cart.lines[0]!.stale).toBeNull()
    expect(cart.lines[1]).toMatchObject({ stale: 'PRICE_CHANGED', currentUnitPriceVnd: 22_000 })
    expect(hasStaleLines(cart)).toBe(true)
  })

  it('acceptCurrentPrice adopts the new price and clears the flag', () => {
    const marked = markStale(twoLines(), [{ index: 1, productId: 'p-bread', name: 'Bánh mì', reason: 'PRICE_CHANGED', currentUnitPriceVnd: 22_000 }])
    const accepted = acceptCurrentPrice(marked, marked.lines[1]!.lineId)
    expect(accepted.lines[1]).toMatchObject({ unitPriceVnd: 22_000, stale: null, currentUnitPriceVnd: null })
    expect(hasStaleLines(accepted)).toBe(false)
  })

  it('reconcileWithMenu flags unavailable, invalid-option and re-priced lines and clears healed ones', () => {
    const newId = ids()
    let cart = addLine(emptyCart(), teaLine(), newId)
    cart = addLine(cart, teaLine({ productId: 'p-bread', unitPriceVnd: 20_000, optionValueIds: [] }), newId)
    cart = addLine(cart, teaLine({ productId: 'p-gone', optionValueIds: [] }), newId)

    const soldOut = { ...bread, isAvailable: false }
    const flagged = reconcileWithMenu(cart, [tea, soldOut])
    expect(flagged.lines.map(line => line.stale)).toEqual([null, 'PRODUCT_UNAVAILABLE', 'PRODUCT_UNAVAILABLE'])

    const repriced = reconcileWithMenu(flagged, [{ ...tea, basePriceVnd: 38_000 }, bread])
    expect(repriced.lines[0]).toMatchObject({ stale: 'PRICE_CHANGED', currentUnitPriceVnd: 38_000 })
    expect(repriced.lines[1]!.stale).toBeNull()

    const optionGone = reconcileWithMenu(cart, [{ ...tea, optionGroups: [{ ...tea.optionGroups[0]!, values: [{ id: 'xl', name: 'XL', priceDeltaVnd: 9_000 }] }] }, bread])
    expect(optionGone.lines[0]!.stale).toBe('OPTION_INVALID')
  })
})

describe('idempotency key lifecycle', () => {
  it('reuses the key for an identical payload and issues a new one after any change', () => {
    let n = 0
    const newKey = () => `key-${++n}`
    const first = ensureIdempotency(emptyCart(), 'payload-A', newKey)
    const retry = ensureIdempotency(first.state, 'payload-A', newKey)
    const edited = ensureIdempotency(retry.state, 'payload-B', newKey)
    expect([first.key, retry.key, edited.key]).toEqual(['key-1', 'key-1', 'key-2'])
    expect(edited.state).toMatchObject({ pendingIdempotencyKey: 'key-2', pendingFingerprint: 'payload-B' })
  })

  it('clearAfterSuccess empties the cart and the pending key but remembers the customer and mode', () => {
    let cart = addLine(emptyCart(), teaLine(), ids())
    cart = updateForm(cart, { fulfillmentType: 'DELIVERY', customer: { name: 'Lan', phone: '0912345678', address: '12 Lê Lợi' }, deliveryZoneId: 'z1', note: 'gọi trước' })
    cart = ensureIdempotency(cart, 'p', () => 'k').state
    expect(clearAfterSuccess(cart)).toEqual({
      ...emptyCart(),
      fulfillmentType: 'DELIVERY',
      customer: { name: 'Lan', phone: '0912345678', address: '12 Lê Lợi' },
      deliveryZoneId: 'z1',
    })
  })
})

describe('parseStoredCart / serializeCart (Review Focus #5)', () => {
  it('round-trips a cart', () => {
    const cart = updateForm(addLine(emptyCart(), teaLine({ quantity: 3 }), ids()), { fulfillmentType: 'PICKUP' })
    expect(parseStoredCart(serializeCart(cart))).toEqual(cart)
  })

  it.each([
    ['null', null],
    ['empty string', ''],
    ['not json', '{oops'],
    ['wrong version', JSON.stringify({ ...emptyCart(), version: 2 })],
    ['array instead of object', '[]'],
    ['quantity out of range', JSON.stringify({ ...emptyCart(), lines: [{ ...addLine(emptyCart(), teaLine(), ids()).lines[0], quantity: 999 }] })],
    ['negative price', JSON.stringify({ ...emptyCart(), lines: [{ ...addLine(emptyCart(), teaLine(), ids()).lines[0], unitPriceVnd: -1 }] })],
    ['more than 30 lines', JSON.stringify({ ...emptyCart(), lines: Array.from({ length: 31 }, (_, i) => ({ ...addLine(emptyCart(), teaLine(), () => `l${i}`).lines[0] })) })],
    ['hand-edited customer', JSON.stringify({ ...emptyCart(), customer: { name: 1 } })],
  ])('falls back to an empty cart for %s', (_label, raw) => {
    expect(parseStoredCart(raw)).toEqual(emptyCart())
  })
})
```

- [ ] **Step 3: Chạy test để xác nhận thất bại**

Run: `npx vitest run --project unit tests/unit/app/uuid.test.ts tests/unit/app/cart-storage.test.ts tests/unit/app/checkout-body.test.ts tests/unit/app/order-labels.test.ts tests/unit/app/recent-orders.test.ts`
Expected: FAIL — `Failed to resolve import "../../../app/utils/uuid"` (và các module còn lại).

- [ ] **Step 4: Viết `uuid.ts`, `order-labels.ts`, `recent-orders.ts`**

`app/utils/uuid.ts`:

```ts
/** `crypto.randomUUID` only exists in secure contexts; phones testing over http://192.168.x.x need the fallback. */
export function uuidv4(): string {
  const c = globalThis.crypto
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  const bytes = c.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
```

`app/utils/order-labels.ts`:

```ts
import type { FulfillmentType, OrderStatus, PaymentMethod, PaymentStatus } from '#shared/enums'
import type { PublicOrderView } from '#shared/types/order'

export function customerStatusLabel(status: OrderStatus, fulfillmentType: FulfillmentType): string {
  switch (status) {
    case 'AWAITING_PAYMENT': return 'Chờ thanh toán'
    case 'NEW': return 'Đã gửi quán'
    case 'PREPARING': return 'Quán đang làm món'
    case 'READY':
      if (fulfillmentType === 'DELIVERY') return 'Món đã xong, chờ giao'
      return fulfillmentType === 'DINE_IN' ? 'Món đã xong' : 'Sẵn sàng, mời bạn lấy món'
    case 'DELIVERING': return 'Đang giao đến bạn'
    case 'COMPLETED': return 'Hoàn tất'
    case 'CANCELLED': return 'Quán đã hủy đơn'
  }
}

export function customerStatusTone(status: OrderStatus): 'success' | 'warning' | 'error' | 'info' | 'neutral' {
  switch (status) {
    case 'AWAITING_PAYMENT': return 'warning'
    case 'NEW': return 'info'
    case 'PREPARING': return 'warning'
    case 'READY': return 'success'
    case 'DELIVERING': return 'info'
    case 'COMPLETED': return 'success'
    case 'CANCELLED': return 'error'
  }
}

export function orderProgressSteps(fulfillmentType: FulfillmentType): OrderStatus[] {
  return fulfillmentType === 'DELIVERY'
    ? ['NEW', 'PREPARING', 'READY', 'DELIVERING', 'COMPLETED']
    : ['NEW', 'PREPARING', 'READY', 'COMPLETED']
}

export function customerPaymentLabel(method: PaymentMethod, status: PaymentStatus): string {
  switch (status) {
    case 'PAID': return 'Đã thanh toán'
    case 'PENDING': return 'Chờ chuyển khoản'
    case 'REVIEW_REQUIRED': return 'Đang đối soát thanh toán'
    case 'REFUND_DUE': return 'Chờ hoàn tiền'
    case 'REFUNDED': return 'Đã hoàn tiền'
    case 'UNPAID': return method === 'PAY_ON_RECEIPT' ? 'Trả tiền khi nhận món' : 'Chưa thanh toán'
  }
}

export function fulfillmentSummary(view: Pick<PublicOrderView, 'fulfillmentType' | 'tableLabel' | 'deliveryZoneName'>): string {
  if (view.fulfillmentType === 'DINE_IN') return view.tableLabel ?? 'Tại bàn'
  if (view.fulfillmentType === 'PICKUP') return 'Mang đi'
  return view.deliveryZoneName ? `Giao hàng · ${view.deliveryZoneName}` : 'Giao hàng'
}
```

`app/utils/recent-orders.ts`:

```ts
import { z } from 'zod'

export interface RecentOrder {
  token: string
  publicCode: string
  storeSlug: string
  storeName: string
  totalVnd: number
  createdAt: string
}

const MAX_RECENT = 20
const DEFAULT_MAX_AGE_MS = 48 * 3_600_000

const entrySchema = z.object({
  token: z.string().min(1).max(128),
  publicCode: z.string().min(1).max(16),
  storeSlug: z.string().min(1).max(64),
  storeName: z.string().max(200),
  totalVnd: z.number().int().nonnegative(),
  createdAt: z.string().max(40),
})

export function parseRecentOrders(raw: string | null): RecentOrder[] {
  if (!raw) return []
  try {
    const data: unknown = JSON.parse(raw)
    if (!Array.isArray(data)) return []
    return data.flatMap((item) => {
      const parsed = entrySchema.safeParse(item)
      return parsed.success ? [parsed.data] : []
    })
  }
  catch {
    return []
  }
}

export function addRecentOrder(list: RecentOrder[], entry: RecentOrder): RecentOrder[] {
  return [entry, ...list.filter(item => item.token !== entry.token)].slice(0, MAX_RECENT)
}

export function recentForStore(list: RecentOrder[], slug: string, nowMs: number, maxAgeMs = DEFAULT_MAX_AGE_MS): RecentOrder[] {
  return list.filter(item => item.storeSlug === slug && nowMs - Date.parse(item.createdAt) <= maxAgeMs)
}
```

- [ ] **Step 5: Viết `cart-storage.ts` và `checkout-body.ts`**

`app/utils/cart-storage.ts`:

```ts
import { z } from 'zod'
import { MAX_LINE_QUANTITY, priceLine, selectionDeltas, toOptionRules, validateSelection, type OptionGroupRule } from '#shared/pricing'
import { CHECKOUT_LIMITS } from '#shared/schemas/checkout'
import type { PublicProduct } from '#shared/types/catalog'
import type { CartStaleLine, CartStaleReason } from '#shared/types/order'

export interface CartLine {
  lineId: string
  productId: string
  name: string
  optionValueIds: string[]
  optionLabels: string[]
  unitPriceVnd: number
  quantity: number
  note: string
  stale: CartStaleReason | null
  currentUnitPriceVnd: number | null
}

export type NewCartLine = Omit<CartLine, 'lineId' | 'stale' | 'currentUnitPriceVnd'>

export interface CartState {
  version: 1
  lines: CartLine[]
  /** Set when the customer taps "Đặt món"; reused for retries of the same payload, dropped on success. */
  pendingIdempotencyKey: string | null
  pendingFingerprint: string | null
  /** Last non-table mode; dine-in is never remembered (it needs a valid ?t= each visit). */
  fulfillmentType: 'PICKUP' | 'DELIVERY' | null
  customer: { name: string, phone: string, address: string }
  deliveryZoneId: string | null
  note: string
}

export type CartFormPatch = Partial<Pick<CartState, 'fulfillmentType' | 'customer' | 'deliveryZoneId' | 'note'>>

const staleReason = z.enum(['PRODUCT_UNAVAILABLE', 'OPTION_INVALID', 'PRICE_CHANGED'])
const vnd = z.number().int().nonnegative()

const lineSchema = z.object({
  lineId: z.string().min(1).max(64),
  productId: z.string().min(1).max(64),
  name: z.string().max(200),
  optionValueIds: z.array(z.string().max(64)).max(30),
  optionLabels: z.array(z.string().max(200)).max(30),
  unitPriceVnd: vnd,
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
  note: z.string().max(CHECKOUT_LIMITS.maxNote),
  stale: staleReason.nullable(),
  currentUnitPriceVnd: vnd.nullable(),
})

const cartSchema = z.object({
  version: z.literal(1),
  lines: z.array(lineSchema).max(CHECKOUT_LIMITS.maxLines),
  pendingIdempotencyKey: z.string().max(64).nullable(),
  pendingFingerprint: z.string().max(60_000).nullable(),
  fulfillmentType: z.enum(['PICKUP', 'DELIVERY']).nullable(),
  customer: z.object({
    name: z.string().max(CHECKOUT_LIMITS.maxName),
    phone: z.string().max(24),
    address: z.string().max(CHECKOUT_LIMITS.maxAddress),
  }),
  deliveryZoneId: z.string().max(64).nullable(),
  note: z.string().max(CHECKOUT_LIMITS.maxNote),
})

export function emptyCart(): CartState {
  return {
    version: 1,
    lines: [],
    pendingIdempotencyKey: null,
    pendingFingerprint: null,
    fulfillmentType: null,
    customer: { name: '', phone: '', address: '' },
    deliveryZoneId: null,
    note: '',
  }
}

export function parseStoredCart(raw: string | null): CartState {
  if (!raw) return emptyCart()
  try {
    const parsed = cartSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : emptyCart()
  }
  catch {
    return emptyCart()
  }
}

export function serializeCart(state: CartState): string {
  return JSON.stringify(state)
}

const lineKey = (line: { productId: string, optionValueIds: string[], note: string }) =>
  `${line.productId}|${[...line.optionValueIds].sort().join(',')}|${line.note.trim()}`

export function isCartFull(state: CartState): boolean {
  return state.lines.length >= CHECKOUT_LIMITS.maxLines
}

export function addLine(state: CartState, input: NewCartLine, newId: () => string): CartState {
  const existing = state.lines.find(line => lineKey(line) === lineKey(input))
  if (existing) {
    return {
      ...state,
      lines: state.lines.map(line => line.lineId === existing.lineId
        ? { ...line, quantity: Math.min(line.quantity + input.quantity, MAX_LINE_QUANTITY), unitPriceVnd: input.unitPriceVnd, stale: null, currentUnitPriceVnd: null }
        : line),
    }
  }
  if (isCartFull(state)) return state
  const line: CartLine = { ...input, quantity: Math.min(input.quantity, MAX_LINE_QUANTITY), lineId: newId(), stale: null, currentUnitPriceVnd: null }
  return { ...state, lines: [...state.lines, line] }
}

export function removeLine(state: CartState, lineId: string): CartState {
  return { ...state, lines: state.lines.filter(line => line.lineId !== lineId) }
}

export function setQuantity(state: CartState, lineId: string, quantity: number): CartState {
  if (quantity <= 0) return removeLine(state, lineId)
  const next = Math.min(Math.floor(quantity), MAX_LINE_QUANTITY)
  return { ...state, lines: state.lines.map(line => (line.lineId === lineId ? { ...line, quantity: next } : line)) }
}

export function markStale(state: CartState, stale: CartStaleLine[]): CartState {
  const byIndex = new Map(stale.map(entry => [entry.index, entry]))
  return {
    ...state,
    lines: state.lines.map((line, index) => {
      const hit = byIndex.get(index)
      return hit && hit.productId === line.productId ? { ...line, stale: hit.reason, currentUnitPriceVnd: hit.currentUnitPriceVnd } : line
    }),
  }
}

export function acceptCurrentPrice(state: CartState, lineId: string): CartState {
  return {
    ...state,
    lines: state.lines.map(line => line.lineId === lineId && line.stale === 'PRICE_CHANGED' && line.currentUnitPriceVnd !== null
      ? { ...line, unitPriceVnd: line.currentUnitPriceVnd, stale: null, currentUnitPriceVnd: null }
      : line),
  }
}

function unitPrice(product: PublicProduct, rules: OptionGroupRule[], valueIds: string[]): number {
  return priceLine({ basePriceVnd: product.basePriceVnd, deltasVnd: selectionDeltas(rules, valueIds), quantity: 1 }).unitPriceVnd
}

function reconcileLine(line: CartLine, product: PublicProduct | undefined): CartLine {
  const fresh: CartLine = { ...line, stale: null, currentUnitPriceVnd: null }
  if (!product || !product.isAvailable) return { ...fresh, stale: 'PRODUCT_UNAVAILABLE' }
  const rules = toOptionRules(product.optionGroups)
  const selection = validateSelection(rules, line.optionValueIds)
  if (!selection.ok) return { ...fresh, stale: 'OPTION_INVALID' }
  const current = unitPrice(product, rules, selection.valueIds)
  return current === line.unitPriceVnd ? fresh : { ...fresh, stale: 'PRICE_CHANGED', currentUnitPriceVnd: current }
}

/** Flags lines the freshly loaded menu no longer supports; heals lines that became valid again. */
export function reconcileWithMenu(state: CartState, products: PublicProduct[]): CartState {
  const byId = new Map(products.map(product => [product.id, product]))
  return { ...state, lines: state.lines.map(line => reconcileLine(line, byId.get(line.productId))) }
}

export function newLineFromProduct(
  product: PublicProduct,
  selection: { optionValueIds: string[], quantity: number, note?: string },
): NewCartLine {
  const rules = toOptionRules(product.optionGroups)
  const names = new Map(product.optionGroups.flatMap(group => group.values.map(value => [value.id, value.name] as const)))
  return {
    productId: product.id,
    name: product.name,
    optionValueIds: selection.optionValueIds,
    optionLabels: selection.optionValueIds.map(id => names.get(id) ?? ''),
    unitPriceVnd: unitPrice(product, rules, selection.optionValueIds),
    quantity: selection.quantity,
    note: (selection.note ?? '').trim(),
  }
}

export function updateForm(state: CartState, patch: CartFormPatch): CartState {
  return { ...state, ...patch }
}

export function ensureIdempotency(state: CartState, fingerprint: string, newKey: () => string): { state: CartState, key: string } {
  if (state.pendingIdempotencyKey && state.pendingFingerprint === fingerprint) {
    return { state, key: state.pendingIdempotencyKey }
  }
  const key = newKey()
  return { state: { ...state, pendingIdempotencyKey: key, pendingFingerprint: fingerprint }, key }
}

export function clearAfterSuccess(state: CartState): CartState {
  return { ...emptyCart(), fulfillmentType: state.fulfillmentType, customer: state.customer, deliveryZoneId: state.deliveryZoneId }
}

export const cartCount = (state: CartState): number => state.lines.reduce((sum, line) => sum + line.quantity, 0)
export const cartSubtotal = (state: CartState): number => state.lines.reduce((sum, line) => sum + line.unitPriceVnd * line.quantity, 0)
export const hasStaleLines = (state: CartState): boolean => state.lines.some(line => line.stale !== null)
```

`app/utils/checkout-body.ts`:

```ts
import type { FulfillmentType, PaymentMethod } from '#shared/enums'
import type { CheckoutBody } from '#shared/schemas/checkout'
import type { CartLine } from './cart-storage'

export interface CheckoutForm {
  customer: { name: string, phone: string, address: string }
  deliveryZoneId: string | null
  note: string
}

export type CheckoutPayload = Omit<CheckoutBody, 'idempotencyKey'>

export function buildCheckoutPayload(args: {
  lines: CartLine[]
  form: CheckoutForm
  fulfillmentType: FulfillmentType
  tableToken: string | null
  paymentMethod: PaymentMethod
  deliveryFeeVnd: number
}): CheckoutPayload {
  const { lines, form, fulfillmentType } = args
  const isDelivery = fulfillmentType === 'DELIVERY'
  const subtotal = lines.reduce((sum, line) => sum + line.unitPriceVnd * line.quantity, 0)

  const customer: NonNullable<CheckoutBody['customer']> = {}
  const name = form.customer.name.trim()
  const phone = form.customer.phone.trim()
  const address = form.customer.address.trim()
  if (name) customer.name = name
  if (phone) customer.phone = phone
  if (isDelivery && address) customer.address = address

  const note = form.note.trim()
  return {
    fulfillmentType,
    ...(fulfillmentType === 'DINE_IN' && args.tableToken ? { tableToken: args.tableToken } : {}),
    customer,
    ...(isDelivery && form.deliveryZoneId ? { deliveryZoneId: form.deliveryZoneId } : {}),
    items: lines.map((line) => {
      const lineNote = line.note.trim()
      return {
        productId: line.productId,
        quantity: line.quantity,
        optionValueIds: [...line.optionValueIds],
        ...(lineNote ? { note: lineNote } : {}),
        expectedUnitPriceVnd: line.unitPriceVnd,
      }
    }),
    paymentMethod: args.paymentMethod,
    expectedTotalVnd: subtotal + (isDelivery ? args.deliveryFeeVnd : 0),
    ...(note ? { note } : {}),
  }
}

/** Same string for the same intent; any edit to the cart or form changes it, which forces a fresh idempotency key. */
export function checkoutFingerprint(payload: CheckoutPayload): string {
  return JSON.stringify(payload)
}
```

- [ ] **Step 6: Chạy test để xác nhận đạt**

Run: `npx vitest run --project unit tests/unit/app/uuid.test.ts tests/unit/app/cart-storage.test.ts tests/unit/app/checkout-body.test.ts tests/unit/app/order-labels.test.ts tests/unit/app/recent-orders.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/utils/uuid.ts app/utils/cart-storage.ts app/utils/checkout-body.ts app/utils/order-labels.ts app/utils/recent-orders.ts tests/unit/app
git commit -m "feat(order): add pure client helpers for cart, checkout payload and order labels" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 9: Composable — `useCart`, `useRecentOrders`, `useVisiblePolling`

**Files:**
- Create: `app/composables/useCart.ts`, `app/composables/useRecentOrders.ts`, `app/composables/useVisiblePolling.ts`, `tests/nuxt/app/use-cart.test.ts`, `tests/nuxt/app/visible-polling.test.ts`

**Interfaces:**
- Consumes: mọi hàm của `app/utils/cart-storage.ts`, `uuidv4`, `recent-orders.ts` (Task 8); `useState`, `onMounted`, `onBeforeUnmount`, `watch`, `computed` (Nuxt/Vue).
- Produces (UI Task 10–11 và PR2 page dùng; giữ nguyên tên):
  - `useCart(slug: string)` trả về: `ready: Ref<boolean>`, `lines: ComputedRef<CartLine[]>`, `count: ComputedRef<number>`, `subtotalVnd: ComputedRef<number>`, `hasStale: ComputedRef<boolean>`, `customer`, `fulfillmentType`, `deliveryZoneId`, `note` (computed đọc từ state), và hành động `add(line: NewCartLine): void`, `setQuantity(lineId, quantity): void`, `remove(lineId): void`, `acceptPrice(lineId): void`, `reconcile(products: PublicProduct[]): void`, `markStale(lines: CartStaleLine[]): void`, `updateForm(patch: CartFormPatch): void`, `ensureIdempotencyKey(fingerprint: string): string`, `clearAfterSuccess(): void`. State dùng chung giữa các component cùng `slug` (`useState`), lưu ở `localStorage['zeno:cart:<slug>']`, chỉ đọc sau `onMounted` (SSR-safe).
  - `useRecentOrders()` trả về `add(entry: RecentOrder): void`, `forStore(slug: string): ComputedRef<RecentOrder[]>`; lưu ở `localStorage['zeno:orders']`.
  - `useVisiblePolling(task: () => Promise<void> | void, opts: { intervalMs: number; enabled?: () => boolean }): void` — gọi `task` ngay khi mount, rồi mỗi `intervalMs` **chỉ khi tab đang hiển thị**; quay lại tab thì gọi ngay; không chạy chồng hai lần; dừng khi `enabled()` trả `false`.

- [ ] **Step 1: Viết test thất bại cho `useCart`**

`tests/nuxt/app/use-cart.test.ts`:

```ts
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { useCart } from '~/composables/useCart'
import { emptyCart, serializeCart, type NewCartLine } from '~/utils/cart-storage'

const KEY = 'zeno:cart:demo'

const tea: NewCartLine = {
  productId: 'p-tea',
  name: 'Trà sữa',
  optionValueIds: ['m'],
  optionLabels: ['M'],
  unitPriceVnd: 35_000,
  quantity: 2,
  note: '',
}

async function mountCart(slug = 'demo') {
  let cart!: ReturnType<typeof useCart>
  const wrapper = await mountSuspended(defineComponent({
    setup() {
      cart = useCart(slug)
      return () => h('p', String(cart.count.value))
    },
  }))
  return { cart, wrapper }
}

beforeEach(() => {
  localStorage.clear()
  clearNuxtState()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useCart', () => {
  it('becomes ready after mount with an empty cart', async () => {
    const { cart } = await mountCart()
    expect(cart.ready.value).toBe(true)
    expect(cart.count.value).toBe(0)
  })

  it('persists changes under zeno:cart:<slug>', async () => {
    const { cart } = await mountCart()
    cart.add(tea)
    cart.add({ ...tea, quantity: 1 })
    const stored = JSON.parse(localStorage.getItem(KEY)!)
    expect(stored.lines).toHaveLength(1)
    expect(stored.lines[0]).toMatchObject({ productId: 'p-tea', quantity: 3 })
    expect(cart.count.value).toBe(3)
    expect(cart.subtotalVnd.value).toBe(105_000)
  })

  it('restores a stored cart after a reload', async () => {
    const seeded = emptyCart()
    seeded.lines.push({ ...tea, lineId: 'l1', stale: null, currentUnitPriceVnd: null })
    localStorage.setItem(KEY, serializeCart(seeded))
    const { cart } = await mountCart()
    expect(cart.count.value).toBe(2)
  })

  it('falls back to an empty cart when storage is corrupted', async () => {
    localStorage.setItem(KEY, '{"version":1,"lines":"oops"')
    const { cart } = await mountCart()
    expect(cart.count.value).toBe(0)
    cart.add(tea)
    expect(cart.count.value).toBe(2)
  })

  it('keeps working in memory when localStorage refuses writes (Safari private mode, quota)', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    const { cart } = await mountCart()
    expect(() => cart.add(tea)).not.toThrow()
    expect(cart.count.value).toBe(2)
  })

  it('follows changes made in another tab', async () => {
    const { cart } = await mountCart()
    const other = emptyCart()
    other.lines.push({ ...tea, lineId: 'x', quantity: 4, stale: null, currentUnitPriceVnd: null })
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: serializeCart(other) }))
    expect(cart.count.value).toBe(4)
  })

  it('keeps the carts of different stores apart', async () => {
    const a = await mountCart('quan-a')
    const b = await mountCart('quan-b')
    a.cart.add(tea)
    expect(a.cart.count.value).toBe(2)
    expect(b.cart.count.value).toBe(0)
    expect(localStorage.getItem('zeno:cart:quan-b')).toBeNull()
  })

  it('reuses the idempotency key for an identical payload only, and forgets it after success', async () => {
    const { cart } = await mountCart()
    cart.add(tea)
    const first = cart.ensureIdempotencyKey('payload-A')
    expect(cart.ensureIdempotencyKey('payload-A')).toBe(first)
    expect(cart.ensureIdempotencyKey('payload-B')).not.toBe(first)
    cart.clearAfterSuccess()
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ lines: [], pendingIdempotencyKey: null })
  })

  it('remembers the customer form between visits', async () => {
    const { cart } = await mountCart()
    cart.updateForm({ fulfillmentType: 'DELIVERY', customer: { name: 'Lan', phone: '0912345678', address: '12 Lê Lợi' } })
    clearNuxtState()
    const again = await mountCart()
    expect(again.cart.customer.value).toEqual({ name: 'Lan', phone: '0912345678', address: '12 Lê Lợi' })
    expect(again.cart.fulfillmentType.value).toBe('DELIVERY')
  })
})
```

- [ ] **Step 2: Viết test thất bại cho `useVisiblePolling`**

`tests/nuxt/app/visible-polling.test.ts`:

```ts
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { useVisiblePolling } from '~/composables/useVisiblePolling'

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

async function mountPolling(task: () => Promise<void> | void, enabled?: () => boolean) {
  return mountSuspended(defineComponent({
    setup() {
      useVisiblePolling(task, { intervalMs: 4000, enabled })
      return () => h('div')
    },
  }))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useVisiblePolling', () => {
  it('runs once on mount and then every interval while the tab is visible', async () => {
    const task = vi.fn().mockResolvedValue(undefined)
    await mountPolling(task)
    expect(task).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(4000)
    expect(task).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(8000)
    expect(task).toHaveBeenCalledTimes(4)
  })

  it('pauses in a hidden tab and refreshes immediately when it becomes visible again', async () => {
    const task = vi.fn().mockResolvedValue(undefined)
    await mountPolling(task)
    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(task).toHaveBeenCalledTimes(1)
    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(0)
    expect(task).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(4000)
    expect(task).toHaveBeenCalledTimes(3)
  })

  it('never overlaps a slow request with the next tick', async () => {
    let release!: () => void
    const task = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    await mountPolling(task)
    await vi.advanceTimersByTimeAsync(12_000)
    expect(task).toHaveBeenCalledTimes(1)
    release()
    await vi.advanceTimersByTimeAsync(4000)
    expect(task).toHaveBeenCalledTimes(2)
  })

  it('stops for good once enabled() turns false', async () => {
    let on = true
    const task = vi.fn().mockResolvedValue(undefined)
    await mountPolling(task, () => on)
    on = false
    await vi.advanceTimersByTimeAsync(20_000)
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('stops when the component unmounts', async () => {
    const task = vi.fn().mockResolvedValue(undefined)
    const wrapper = await mountPolling(task)
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(task).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 3: Chạy test để xác nhận thất bại**

Run: `npx vitest run --project nuxt tests/nuxt/app/use-cart.test.ts tests/nuxt/app/visible-polling.test.ts`
Expected: FAIL — `Failed to resolve import "~/composables/useCart"`.

- [ ] **Step 4: Viết `useCart.ts`**

`app/composables/useCart.ts`:

```ts
import type { PublicProduct } from '#shared/types/catalog'
import type { CartStaleLine } from '#shared/types/order'
import {
  acceptCurrentPrice,
  addLine,
  cartCount,
  cartSubtotal,
  clearAfterSuccess,
  emptyCart,
  ensureIdempotency,
  hasStaleLines,
  markStale,
  parseStoredCart,
  reconcileWithMenu,
  removeLine,
  serializeCart,
  setQuantity,
  updateForm,
  type CartFormPatch,
  type CartState,
  type NewCartLine,
} from '../utils/cart-storage'
import { uuidv4 } from '../utils/uuid'

/** Per-store cart. Shared between components through useState; localStorage is the source of truth after mount. */
export function useCart(slug: string) {
  const storageKey = `zeno:cart:${slug}`
  const state = useState<CartState>(storageKey, emptyCart)
  const ready = useState<boolean>(`${storageKey}:ready`, () => false)

  function readStorage(): CartState {
    try {
      return parseStoredCart(localStorage.getItem(storageKey))
    }
    catch {
      return emptyCart()
    }
  }

  function commit(next: CartState) {
    state.value = next
    if (!ready.value) return
    try {
      localStorage.setItem(storageKey, serializeCart(next))
    }
    catch {
      // Private mode or quota: the cart keeps working in memory for this visit.
    }
  }

  function onStorage(event: StorageEvent) {
    if (event.key === storageKey) state.value = parseStoredCart(event.newValue)
  }

  onMounted(() => {
    if (!ready.value) {
      state.value = readStorage()
      ready.value = true
    }
    window.addEventListener('storage', onStorage)
  })
  onBeforeUnmount(() => window.removeEventListener('storage', onStorage))

  return {
    ready,
    lines: computed(() => state.value.lines),
    count: computed(() => cartCount(state.value)),
    subtotalVnd: computed(() => cartSubtotal(state.value)),
    hasStale: computed(() => hasStaleLines(state.value)),
    customer: computed(() => state.value.customer),
    fulfillmentType: computed(() => state.value.fulfillmentType),
    deliveryZoneId: computed(() => state.value.deliveryZoneId),
    note: computed(() => state.value.note),

    add: (line: NewCartLine) => commit(addLine(state.value, line, uuidv4)),
    setQuantity: (lineId: string, quantity: number) => commit(setQuantity(state.value, lineId, quantity)),
    remove: (lineId: string) => commit(removeLine(state.value, lineId)),
    acceptPrice: (lineId: string) => commit(acceptCurrentPrice(state.value, lineId)),
    reconcile: (products: PublicProduct[]) => commit(reconcileWithMenu(state.value, products)),
    markStale: (lines: CartStaleLine[]) => commit(markStale(state.value, lines)),
    updateForm: (patch: CartFormPatch) => commit(updateForm(state.value, patch)),
    ensureIdempotencyKey(fingerprint: string): string {
      const result = ensureIdempotency(state.value, fingerprint, uuidv4)
      commit(result.state)
      return result.key
    },
    clearAfterSuccess: () => commit(clearAfterSuccess(state.value)),
  }
}
```

- [ ] **Step 5: Viết `useRecentOrders.ts` và `useVisiblePolling.ts`**

`app/composables/useRecentOrders.ts`:

```ts
import { addRecentOrder, parseRecentOrders, recentForStore, type RecentOrder } from '../utils/recent-orders'

const STORAGE_KEY = 'zeno:orders'

function read(): RecentOrder[] {
  try {
    return parseRecentOrders(localStorage.getItem(STORAGE_KEY))
  }
  catch {
    return []
  }
}

/** The customer's own device is the only place that knows their tracking links, since there is no account. */
export function useRecentOrders() {
  const list = useState<RecentOrder[]>(STORAGE_KEY, () => [])
  const ready = useState<boolean>(`${STORAGE_KEY}:ready`, () => false)

  onMounted(() => {
    if (ready.value) return
    list.value = read()
    ready.value = true
  })

  return {
    add(entry: RecentOrder) {
      list.value = addRecentOrder(ready.value ? list.value : read(), entry)
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list.value))
      }
      catch {
        // Not persisting is acceptable: the order page itself is reachable from the redirect.
      }
    },
    forStore: (slug: string) => computed(() => recentForStore(list.value, slug, Date.now())),
  }
}
```

`app/composables/useVisiblePolling.ts`:

```ts
export interface VisiblePollingOptions {
  intervalMs: number
  enabled?: () => boolean
}

export function useVisiblePolling(task: () => Promise<void> | void, { intervalMs, enabled = () => true }: VisiblePollingOptions) {
  let timer: ReturnType<typeof setInterval> | undefined
  let running = false

  async function tick() {
    if (running) return
    running = true
    try {
      await task()
    }
    finally {
      running = false
    }
  }

  function stop() {
    clearInterval(timer)
    timer = undefined
  }

  function start() {
    stop()
    if (!enabled() || document.visibilityState !== 'visible') return
    timer = setInterval(() => {
      if (!enabled()) stop()
      else void tick()
    }, intervalMs)
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
      void tick()
      start()
    }
    else {
      stop()
    }
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', onVisibilityChange)
    void tick().finally(start)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    stop()
  })
  watch(() => enabled(), start)
}
```

- [ ] **Step 6: Chạy test để xác nhận đạt**

Run: `npx vitest run --project nuxt tests/nuxt/app/use-cart.test.ts tests/nuxt/app/visible-polling.test.ts`
Expected: PASS. Nếu `follows changes made in another tab` lỗi vì happy-dom thiếu `StorageEvent`, thay bằng `new Event('storage')` gán thêm `key`/`newValue` bằng `Object.assign` — chỉ sửa test, không sửa composable.

- [ ] **Step 7: Commit**

```bash
git add app/composables/useCart.ts app/composables/useRecentOrders.ts app/composables/useVisiblePolling.ts tests/nuxt/app/use-cart.test.ts tests/nuxt/app/visible-polling.test.ts
git commit -m "feat(order): add cart, recent orders and visibility polling composables" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 10: Trang theo dõi đơn `/o/[token]` (C4)

**Files:**
- Create: `app/components/order/StatusSteps.vue`, `app/pages/o/[token].vue`, `tests/nuxt/order/status-steps.test.ts`, `tests/e2e/order-tracking.spec.ts`
- Modify: `nuxt.config.ts` (`routeRules`)

**Interfaces:**
- Consumes: `GET /api/public/orders/:token` và `PublicOrderView` (Task 7, 2); `useVisiblePolling` (Task 9); `customerStatusLabel`, `customerStatusTone`, `orderProgressSteps`, `customerPaymentLabel`, `fulfillmentSummary` (Task 8); `isTerminalStatus` (Task 2); `extractApiError` (`app/utils/api-error.ts`, PR1); `formatVnd` (`shared/money.ts`); `AppEmptyState`, `AppCopyField`, `ZCard`, `ZBadge`, `ZAlert`, `ZButton`; `createTenant` (`tests/support/fixtures.ts`), `openStore`, `seedMenu`, `pickupBody`, `deliveryBody`, `teaItem` (Task 3); `expectNoHorizontalOverflow` (`tests/e2e/support/layout.ts`).
- Produces:
  - Component `OrderStatusSteps` (`app/components/order/StatusSteps.vue`): props `{ status: OrderStatus; fulfillmentType: FulfillmentType }`; mỗi bước là `<li data-state="done|current|todo">`; bước hiện tại có `aria-current="step"`.
  - Trang `/o/:token`: biến `order` (`Ref<PublicOrderView | null>`), `token` (chuỗi) và hàm `refresh()` (PR5 gắn QR/đếm ngược vào đây); `data-testid="order-public-code"` (mã đơn), `data-testid="order-status"` (nhãn trạng thái); poll 4 giây khi tab hiển thị và dừng khi đơn `COMPLETED`/`CANCELLED`; token sai → empty state "Không tìm thấy đơn hàng".
  - `routeRules['/o/**']`: `ssr: false` và header `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store`.

- [ ] **Step 1: Viết test thất bại cho `OrderStatusSteps`**

`tests/nuxt/order/status-steps.test.ts`:

```ts
import { renderSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import type { FulfillmentType, OrderStatus } from '#shared/enums'
import OrderStatusSteps from '~/components/order/StatusSteps.vue'

async function states(status: OrderStatus, fulfillmentType: FulfillmentType) {
  const { container } = await renderSuspended(OrderStatusSteps, { props: { status, fulfillmentType } })
  return [...container.querySelectorAll('li')].map(li => [li.textContent?.trim(), li.getAttribute('data-state')])
}

describe('OrderStatusSteps', () => {
  it('marks the current step and what is done before it', async () => {
    expect(await states('PREPARING', 'PICKUP')).toEqual([
      ['Đã gửi quán', 'done'],
      ['Quán đang làm món', 'current'],
      ['Sẵn sàng, mời bạn lấy món', 'todo'],
      ['Hoàn tất', 'todo'],
    ])
  })

  it('treats a skipped step as done (NEW → READY)', async () => {
    const result = await states('READY', 'DINE_IN')
    expect(result.map(([, state]) => state)).toEqual(['done', 'done', 'current', 'todo'])
  })

  it('adds the delivery step only for delivery orders', async () => {
    expect((await states('DELIVERING', 'DELIVERY')).map(([label]) => label)).toContain('Đang giao đến bạn')
    expect((await states('NEW', 'DINE_IN')).map(([label]) => label)).not.toContain('Đang giao đến bạn')
  })

  it('shows everything done when completed', async () => {
    expect((await states('COMPLETED', 'DELIVERY')).every(([, state]) => state === 'done')).toBe(true)
  })

  it('exposes the current step to assistive tech', async () => {
    const { container } = await renderSuspended(OrderStatusSteps, { props: { status: 'NEW', fulfillmentType: 'PICKUP' } })
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('Đã gửi quán')
  })
})
```

- [ ] **Step 2: Viết E2E thất bại cho trang theo dõi**

`tests/e2e/order-tracking.spec.ts`:

```ts
import { randomInt } from 'node:crypto'
import { expect, test, type APIRequestContext, type TestInfo } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { getDb } from '../../server/db/client'
import { orders } from '../../server/db/schema'
import { deliveryBody, openStore, pickupBody, seedMenu, teaItem } from '../support/checkout-fixtures'
import { createTenant } from '../support/fixtures'
import { expectNoHorizontalOverflow } from './support/layout'

async function seed(testInfo: TestInfo) {
  const tenant = await createTenant(`trk${testInfo.project.name === 'mobile-safari' ? 's' : 'c'}`)
  await openStore(tenant.store.id, { deliveryEnabled: true })
  return { store: tenant.store, menu: await seedMenu(tenant.store) }
}

// A distinct client ip per call keeps parallel specs clear of the checkout rate limit.
async function placeOrder(request: APIRequestContext, slug: string, body: unknown) {
  const res = await request.post(`/api/public/stores/${slug}/orders`, {
    data: body,
    headers: { 'x-forwarded-for': `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}` },
  })
  expect(res.status()).toBe(201)
  return (await res.json()) as { guestToken: string, publicCode: string }
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
})

test('shows code, progress, masked contact and totals, and follows status changes', async ({ page, request }, testInfo) => {
  const { store, menu } = await seed(testInfo)
  const created = await placeOrder(request, store.slug, deliveryBody(menu))

  await page.goto(`/o/${created.guestToken}`)
  await expect(page.getByTestId('order-public-code')).toHaveText(`#${created.publicCode}`)
  await expect(page.getByTestId('order-status')).toHaveText('Đã gửi quán')
  await expect(page.getByText('Giao hàng · Quận 1')).toBeVisible()
  await expect(page.getByText('Trà sữa trân châu')).toBeVisible()
  await expect(page.getByText('85.000đ').first()).toBeVisible()
  await expect(page.getByText('*******678')).toBeVisible()
  await expect(page.getByText('Trả tiền khi nhận món')).toBeVisible()
  await expect(page.getByText('0912345678')).toHaveCount(0)
  await expect(page.getByText('12 Lê Lợi')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)

  await getDb().update(orders).set({ status: 'PREPARING' }).where(eq(orders.publicCode, created.publicCode))
  await expect(page.getByTestId('order-status')).toHaveText('Quán đang làm món', { timeout: 12_000 })

  await getDb().update(orders).set({ status: 'CANCELLED' }).where(eq(orders.publicCode, created.publicCode))
  await expect(page.getByText('Quán đã hủy đơn này')).toBeVisible({ timeout: 12_000 })
  await expect(page.getByRole('list', { name: 'Tiến độ đơn hàng' })).toHaveCount(0)
})

test('renders customer text as text, and ships no-referrer + noindex headers (Review Focus #2, #3)', async ({ page, request }, testInfo) => {
  const { store, menu } = await seed(testInfo)
  const note = '<img src=x onerror="window.__xss=1">'
  const created = await placeOrder(request, store.slug, pickupBody(menu, { items: [teaItem(menu, { note })] }))

  const response = await page.goto(`/o/${created.guestToken}`)
  expect(response!.headers()['referrer-policy']).toBe('no-referrer')
  expect(response!.headers()['x-robots-tag']).toContain('noindex')
  await expect(page.getByText(note, { exact: false })).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined()
  expect(await page.locator('img[src="x"]').count()).toBe(0)
})

test('shows the copyable tracking link so the customer can save it', async ({ page, request }, testInfo) => {
  const { store, menu } = await seed(testInfo)
  const created = await placeOrder(request, store.slug, pickupBody(menu))
  await page.goto(`/o/${created.guestToken}`)
  await expect(page.getByLabel('Link theo dõi đơn')).toHaveValue(new RegExp(`/o/${created.guestToken}$`))
  await expect(page.getByRole('link', { name: 'Đặt thêm món' })).toHaveAttribute('href', `/s/${store.slug}`)
})

test('an unknown token shows a friendly empty state instead of an error page', async ({ page }) => {
  await page.goto(`/o/${'a'.repeat(43)}`)
  await expect(page.getByRole('heading', { name: 'Không tìm thấy đơn hàng' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})
```

- [ ] **Step 3: Chạy test để xác nhận thất bại**

Run: `npx vitest run --project nuxt tests/nuxt/order/status-steps.test.ts && npx playwright test tests/e2e/order-tracking.spec.ts --project=mobile-chrome`
Expected: FAIL — không resolve được `~/components/order/StatusSteps.vue`; E2E báo 404 cho `/o/<token>`.

- [ ] **Step 4: Viết `StatusSteps.vue`**

`app/components/order/StatusSteps.vue`:

```vue
<script setup lang="ts">
import type { FulfillmentType, OrderStatus } from '#shared/enums'
import { customerStatusLabel, orderProgressSteps } from '~/utils/order-labels'

const props = defineProps<{ status: OrderStatus, fulfillmentType: FulfillmentType }>()

const steps = computed(() => orderProgressSteps(props.fulfillmentType))
const currentIndex = computed(() => steps.value.indexOf(props.status))

function stateOf(index: number): 'done' | 'current' | 'todo' {
  if (props.status === 'COMPLETED' || index < currentIndex.value) return 'done'
  return index === currentIndex.value ? 'current' : 'todo'
}

const dot = {
  done: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200',
  current: 'bg-primary text-(--zeno-on-primary)',
  todo: 'bg-(--zeno-surface-inset) text-muted',
}
const icon = { done: 'i-lucide-check', current: 'i-lucide-loader', todo: 'i-lucide-circle' }
</script>

<template>
  <ol class="flex flex-col gap-1" aria-label="Tiến độ đơn hàng">
    <li
      v-for="(step, index) in steps"
      :key="step"
      class="flex min-h-11 items-center gap-3"
      :data-state="stateOf(index)"
      :aria-current="stateOf(index) === 'current' ? 'step' : undefined"
    >
      <span class="grid size-8 shrink-0 place-items-center rounded-full" :class="dot[stateOf(index)]">
        <UIcon :name="icon[stateOf(index)]" class="size-4" />
      </span>
      <span :class="stateOf(index) === 'todo' ? 'text-muted' : stateOf(index) === 'current' ? 'font-semibold text-default' : 'text-default'">
        {{ customerStatusLabel(step, fulfillmentType) }}
      </span>
    </li>
  </ol>
</template>
```

- [ ] **Step 5: Viết trang `/o/[token]`**

`app/pages/o/[token].vue`:

```vue
<script setup lang="ts">
import { isTerminalStatus } from '#shared/enums'
import { formatVnd } from '#shared/money'
import type { PublicOrderView } from '#shared/types/order'

useHead({ title: 'Theo dõi đơn hàng', meta: [{ name: 'robots', content: 'noindex, nofollow' }] })

const route = useRoute()
const token = String(route.params.token ?? '')
const origin = useRequestURL().origin

const order = ref<PublicOrderView | null>(null)
const loading = ref(true)
const notFound = ref(false)
const connectionLost = ref(false)

async function refresh() {
  try {
    order.value = await $fetch<PublicOrderView>(`/api/public/orders/${encodeURIComponent(token)}`)
    connectionLost.value = false
  }
  catch (err) {
    if (extractApiError(err).code === 'NOT_FOUND') notFound.value = true
    else connectionLost.value = true
  }
  finally {
    loading.value = false
  }
}

const finished = computed(() => (order.value ? isTerminalStatus(order.value.status) : false))
useVisiblePolling(refresh, { intervalMs: 4000, enabled: () => !notFound.value && !finished.value })
</script>

<template>
  <div class="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-5 px-4 pb-10 pt-[calc(1.25rem+env(safe-area-inset-top))]">
    <div v-if="loading" class="flex flex-col gap-4" aria-busy="true" aria-label="Đang tải đơn hàng">
      <USkeleton class="h-24 w-full rounded-md" />
      <USkeleton class="h-48 w-full rounded-md" />
      <USkeleton class="h-32 w-full rounded-md" />
    </div>

    <AppEmptyState
      v-else-if="notFound"
      icon="i-lucide-search-x"
      heading-level="h1"
      title="Không tìm thấy đơn hàng"
      description="Link có thể bị thiếu hoặc sai. Hãy mở lại link bạn đã lưu, hoặc hỏi quán."
    />

    <template v-else-if="order">
      <header class="flex flex-col gap-2">
        <p class="text-sm text-muted">
          {{ order.store.name }}
        </p>
        <h1 class="text-h2 text-default">
          Đơn <span class="font-mono" data-testid="order-public-code">#{{ order.publicCode }}</span>
        </h1>
        <div>
          <ZBadge :status="customerStatusTone(order.status)" data-testid="order-status">
            {{ customerStatusLabel(order.status, order.fulfillmentType) }}
          </ZBadge>
        </div>
      </header>

      <ZAlert v-if="connectionLost" color="warning" title="Mất kết nối" description="Đang thử lại. Trạng thái bên dưới có thể chưa mới nhất." />
      <ZAlert
        v-if="order.status === 'CANCELLED'"
        color="error"
        title="Quán đã hủy đơn này"
        description="Nếu bạn đã chuyển tiền, vui lòng liên hệ quán để được hoàn lại."
      />

      <ZCard v-if="order.status !== 'CANCELLED'" variant="elevated" padding="md">
        <OrderStatusSteps :status="order.status" :fulfillment-type="order.fulfillmentType" />
      </ZCard>

      <ZCard variant="flat" padding="md">
        <dl class="flex flex-col gap-2 text-sm">
          <div class="flex justify-between gap-4">
            <dt class="text-muted">
              Nhận món
            </dt>
            <dd class="text-end text-default">
              {{ fulfillmentSummary(order) }}
            </dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-muted">
              Thanh toán
            </dt>
            <dd class="text-end text-default">
              {{ customerPaymentLabel(order.paymentMethod, order.paymentStatus) }}
            </dd>
          </div>
          <div v-if="order.customerName || order.phoneMasked" class="flex justify-between gap-4">
            <dt class="text-muted">
              Người nhận
            </dt>
            <dd class="break-words text-end text-default">
              {{ order.customerName }}<template v-if="order.phoneMasked"> · <span class="font-mono">{{ order.phoneMasked }}</span></template>
            </dd>
          </div>
        </dl>
      </ZCard>

      <ZCard variant="flat" padding="md">
        <ul class="flex flex-col gap-3">
          <li v-for="(item, index) in order.items" :key="index" class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="break-words font-medium text-default">
                {{ item.quantity }} × {{ item.name }}
              </p>
              <p v-if="item.options.length" class="break-words text-sm text-muted">
                {{ item.options.map(option => option.name).join(' · ') }}
              </p>
              <p v-if="item.note" class="break-words text-sm text-muted">
                Ghi chú: {{ item.note }}
              </p>
            </div>
            <p class="shrink-0 font-mono text-sm text-default">
              {{ formatVnd(item.lineTotalVnd) }}
            </p>
          </li>
        </ul>
        <dl class="mt-4 flex flex-col gap-1 border-t border-default pt-3 text-sm">
          <div class="flex justify-between">
            <dt class="text-muted">
              Tạm tính
            </dt>
            <dd class="font-mono">
              {{ formatVnd(order.subtotalVnd) }}
            </dd>
          </div>
          <div v-if="order.fulfillmentType === 'DELIVERY'" class="flex justify-between">
            <dt class="text-muted">
              Phí giao
            </dt>
            <dd class="font-mono">
              {{ formatVnd(order.deliveryFeeVnd) }}
            </dd>
          </div>
          <div class="flex justify-between text-base font-semibold">
            <dt>Tổng cộng</dt>
            <dd class="font-mono">
              {{ formatVnd(order.totalVnd) }}
            </dd>
          </div>
        </dl>
      </ZCard>

      <ZCard variant="flat" padding="md">
        <AppCopyField :value="`${origin}/o/${token}`" label="Link theo dõi đơn" />
        <p class="mt-2 text-[13px] text-muted">
          Lưu link này để xem lại đơn bất cứ lúc nào. Đừng chia sẻ cho người lạ.
        </p>
      </ZCard>

      <ZButton :to="`/s/${order.store.slug}`" variant="secondary" block icon="i-lucide-plus">
        Đặt thêm món
      </ZButton>
    </template>
  </div>
</template>
```

- [ ] **Step 6: Thêm `routeRules` cho `/o/**`**

Trong `nuxt.config.ts`, thêm vào `routeRules` (cạnh `'/invite/**'`):

```ts
    '/o/**': {
      ssr: false,
      headers: {
        'Referrer-Policy': 'no-referrer',
        'X-Robots-Tag': 'noindex, nofollow',
        'Cache-Control': 'no-store',
      },
    },
```

- [ ] **Step 7: Chạy test để xác nhận đạt**

Run:

```bash
npx vitest run --project nuxt tests/nuxt/order/status-steps.test.ts
npx playwright test tests/e2e/order-tracking.spec.ts
npm run lint -- app/pages/o app/components/order
```

Expected: PASS trên cả `mobile-chrome` và `mobile-safari`; lint sạch (trang chỉ dùng `Z*`/`App*`/component `Order*`).

- [ ] **Step 8: Commit**

```bash
git add app/components/order/StatusSteps.vue app/pages/o nuxt.config.ts tests/nuxt/order tests/e2e/order-tracking.spec.ts
git commit -m "feat(order): add guest order tracking page with live status polling" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 11: Giỏ hàng + checkout sheet (C3) + nối vào trang khách `/s/[slug]`

**Files:**
- Create: `app/components/order/CartBar.vue`, `app/components/order/CheckoutSheet.vue`, `app/components/order/RecentOrders.vue`, `tests/nuxt/order/cart-bar.test.ts`, `tests/e2e/ordering.spec.ts`
- Modify: `app/pages/s/[slug].vue` (PR2 Task 17)
- Delete (giỏ tạm của PR2 Task 17, được `useCart` thay thế): `app/composables/useCartDraft.ts`, `shared/cart-draft.ts`, `app/components/menu/CartBar.vue`, `tests/unit/shared/cart-draft.test.ts`

**Interfaces:**
- Consumes: `ZSheet` (`app/components/z/Sheet.vue`, PR2 Task 13: `v-model:open`, `title`, `description?`, slot `default` và `footer`); `useCart`, `useRecentOrders` (Task 9); `newLineFromProduct`, `buildCheckoutPayload`, `checkoutFingerprint`, `CheckoutForm` (Task 8); `checkoutInputSchema` (Task 2); `uuidv4`; `CartStaleDetails`, `CreateOrderResponse`; `extractApiError`; `formatVnd`; `POST /api/public/stores/:slug/orders` (Task 7); từ PR2 Task 17: trang `app/pages/s/[slug].vue` (biến `slug`, `menu`, `error`, `refresh`, `fulfillment`, `tableToken`, `canOrder`, `cart`, hàm `onAdd`/`onSheetAdd`), `MenuProductSheet` (emit `add` với `{ valueIds, quantity }`), `MenuProductCard` (nút `+` có `aria-label="Thêm <tên>"`), `PublicMenu`, `PublicFulfillment`, `PublicProduct` (`shared/types/catalog.ts`); trang `/o/[token]` (Task 10); fixtures Task 3.
- Produces:
  - `OrderCartBar` (`app/components/order/CartBar.vue`): props `{ slug: string }`, emit `open`; ẩn khi giỏ rỗng; chữ hiển thị `Giỏ • <n> món` + tổng tiền (giữ đúng chữ của thanh giỏ PR2 để E2E PR2 không phải sửa), `data-testid="cart-bar"`, tên truy cập `Xem giỏ hàng, <n> món, <tổng>`.
  - `OrderCheckoutSheet` (`app/components/order/CheckoutSheet.vue`): `v-model:open`; props `{ slug, storeName, acceptingOrders: boolean, pickupEnabled: boolean, deliveryEnabled: boolean, deliveryZones: { id: string; name: string; feeVnd: number }[], tableToken: string | null, tableLabel: string | null }`; emit `refresh` (trang tải lại menu + fulfillment). Nhãn UI cố định cho E2E: radio `Mang đi` / `Giao hàng` / `Tại bàn · <tên bàn>`, ô `Tên của bạn`, `Số điện thoại`, `Địa chỉ chi tiết`, `Ghi chú cho quán`, combobox `Khu vực giao`, nút `Đặt món • <tổng>`, `data-testid="checkout-total"`.
  - `OrderRecentOrders` (`app/components/order/RecentOrders.vue`): props `{ slug: string }`; `nav` có tên `Đơn gần đây`.
  - Hợp đồng cho mọi nơi thêm món: `useCart(slug).add(newLineFromProduct(product, { optionValueIds, quantity, note? }))`.

- [ ] **Step 0: Đối chiếu điểm nối với PR2 Task 17**

PR2 giữ giỏ tạm bằng `useCartDraft` (`useState`, không lưu localStorage) và có thanh giỏ chỉ đọc `MenuCartBar`. Xác nhận đúng những chỗ sẽ thay:

```bash
grep -rnE "useCartDraft|cart-draft|MenuCartBar" app shared tests --include=*.ts --include=*.vue
grep -nE "const cart = useCartDraft|cart\.add\(|MenuCartBar|useFetch<PublicFulfillment>|immediate: tableToken" "app/pages/s/[slug].vue"
```

Expected: hai lần `cart.add(` (`onAdd`: `cart.add(product, [], 1)`, `onSheetAdd`: `cart.add(product, payload.valueIds, payload.quantity)`), một `MenuCartBar`, một `useFetch<PublicFulfillment>` có `immediate: tableToken !== undefined`. Nếu tên khác, đổi theo tên thật ở Step 7, không đổi thiết kế.

- [ ] **Step 1: Viết test thất bại cho `OrderCartBar`**

`tests/nuxt/order/cart-bar.test.ts`:

```ts
import { renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OrderCartBar from '~/components/order/CartBar.vue'
import { addLine, emptyCart, serializeCart } from '~/utils/cart-storage'

const KEY = 'zeno:cart:demo'

function seed(quantity: number) {
  const cart = addLine(emptyCart(), {
    productId: 'p1',
    name: 'Trà sữa',
    optionValueIds: [],
    optionLabels: [],
    unitPriceVnd: 35_000,
    quantity,
    note: '',
  }, () => 'l1')
  localStorage.setItem(KEY, serializeCart(cart))
}

beforeEach(() => {
  localStorage.clear()
  clearNuxtState()
})

describe('OrderCartBar', () => {
  it('renders nothing while the cart is empty', async () => {
    const { container } = await renderSuspended(OrderCartBar, { props: { slug: 'demo' } })
    expect(container.querySelector('[data-testid="cart-bar"]')).toBeNull()
  })

  it('shows count and total with an accessible name, and opens the sheet', async () => {
    seed(2)
    const onOpen = vi.fn()
    await renderSuspended(OrderCartBar, { props: { slug: 'demo', onOpen } })
    const button = await screen.findByRole('button', { name: 'Xem giỏ hàng, 2 món, 70.000đ' })
    expect(button.textContent).toContain('Giỏ • 2 món')
    expect(button.textContent).toContain('70.000đ')
    await fireEvent.click(button)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Viết E2E thất bại cho luồng đặt món**

`tests/e2e/ordering.spec.ts`:

```ts
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { count, eq } from 'drizzle-orm'
import { getDb } from '../../server/db/client'
import { orderItems, orders, products, stores } from '../../server/db/schema'
import { openStore, seedCartJson, seedMenu, type SeededMenu } from '../support/checkout-fixtures'
import { createTenant } from '../support/fixtures'
import { expectNoHorizontalOverflow } from './support/layout'

async function seed(testInfo: TestInfo) {
  const tenant = await createTenant(`ord${testInfo.project.name === 'mobile-safari' ? 's' : 'c'}`)
  await openStore(tenant.store.id, { deliveryEnabled: true })
  return { store: tenant.store, menu: await seedMenu(tenant.store) }
}

// Most specs seed the cart exactly as useCart persists it, so each one exercises a single checkout
// behaviour; one spec below adds products through the real PR2 menu UI.
async function openMenuWithCart(page: Page, slug: string, menu: SeededMenu, query = '') {
  await page.goto(`/s/${slug}${query}`)
  await page.evaluate(([key, value]) => localStorage.setItem(key!, value!), [`zeno:cart:${slug}`, seedCartJson(menu)])
  await page.reload()
  await expect(page.getByTestId('cart-bar')).toContainText('2 món')
}

const ordersOf = async (storeId: string) =>
  (await getDb().select({ n: count() }).from(orders).where(eq(orders.storeId, storeId)))[0]!.n

const placeButton = (page: Page) => page.getByRole('button', { name: /^Đặt món/ })

async function expectTouchTarget(locator: Locator) {
  await expect(locator).toBeVisible()
  expect((await locator.boundingBox())!.height).toBeGreaterThanOrEqual(44)
}

async function fillPickup(page: Page) {
  await page.getByLabel('Tên của bạn').fill('Lan')
  await page.getByLabel('Số điện thoại').fill('0912 345 678')
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
})

test('pickup: fill name and phone, place the order, land on tracking, cart is emptied', async ({ page }, testInfo) => {
  const { store, menu } = await seed(testInfo)
  await openMenuWithCart(page, store.slug, menu)

  await page.getByTestId('cart-bar').click()
  await expect(page.getByRole('radio', { name: 'Mang đi' })).toHaveAttribute('aria-checked', 'true')
  await fillPickup(page)
  await expect(page.getByTestId('checkout-total')).toHaveText('70.000đ')
  await expectNoHorizontalOverflow(page)
  await expectTouchTarget(placeButton(page))
  await expectTouchTarget(page.getByRole('button', { name: 'Tăng số lượng Trà sữa trân châu' }))

  await placeButton(page).click()
  await expect(page).toHaveURL(/\/o\/[\w-]{43}$/)
  await expect(page.getByTestId('order-public-code')).toBeVisible()
  await expect(page.getByTestId('order-status')).toHaveText('Đã gửi quán')

  const [row] = await getDb().select().from(orders).where(eq(orders.storeId, store.id))
  expect(row).toMatchObject({ fulfillmentType: 'PICKUP', customerPhone: '0912345678', status: 'NEW', paymentStatus: 'UNPAID', totalVnd: 70_000 })

  await page.goto(`/s/${store.slug}`)
  await expect(page.getByTestId('cart-bar')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Đơn gần đây' })).toContainText(`#${row!.publicCode}`)
})

test('dine-in via QR: no form at all, open the cart and place', async ({ page }, testInfo) => {
  const { store, menu } = await seed(testInfo)
  await openMenuWithCart(page, store.slug, menu, `?t=${menu.table.token}`)

  await page.getByTestId('cart-bar').click()
  await expect(page.getByRole('radio', { name: 'Tại bàn · Bàn 05' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByLabel('Số điện thoại')).not.toBeVisible()
  await placeButton(page).click()

  await expect(page).toHaveURL(/\/o\/[\w-]{43}$/)
  await expect(page.getByText('Bàn 05')).toBeVisible()
  const [row] = await getDb().select().from(orders).where(eq(orders.storeId, store.id))
  expect(row).toMatchObject({ fulfillmentType: 'DINE_IN', tableId: menu.table.id, customerPhone: null })
})

test('delivery: zone, address, fee in the total, address never shown back to the customer', async ({ page }, testInfo) => {
  const { store, menu } = await seed(testInfo)
  await openMenuWithCart(page, store.slug, menu)

  await page.getByTestId('cart-bar').click()
  await page.getByRole('radio', { name: 'Giao hàng' }).click()
  await fillPickup(page)
  await page.getByRole('combobox', { name: 'Khu vực giao' }).click()
  await page.getByRole('option', { name: /Quận 1/ }).click()
  await page.getByLabel('Địa chỉ chi tiết').fill('12 Lê Lợi, Quận 1')
  await expect(page.getByTestId('checkout-total')).toHaveText('85.000đ')
  await expectNoHorizontalOverflow(page)
  await placeButton(page).click()

  await expect(page).toHaveURL(/\/o\/[\w-]{43}$/)
  await expect(page.getByText('Giao hàng · Quận 1')).toBeVisible()
  await expect(page.getByText('*******678')).toBeVisible()
  await expect(page.getByText('12 Lê Lợi')).toHaveCount(0)
  const [row] = await getDb().select().from(orders).where(eq(orders.storeId, store.id))
  expect(row).toMatchObject({ fulfillmentType: 'DELIVERY', addressSnapshot: '12 Lê Lợi, Quận 1', deliveryFeeVnd: 15_000, totalVnd: 85_000 })
})

test('adds from the real menu UI (option sheet + one-tap product), then checks out', async ({ page }, testInfo) => {
  const { store } = await seed(testInfo)
  await page.goto(`/s/${store.slug}`)

  await page.getByRole('button', { name: 'Thêm Trà sữa trân châu' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Thêm • 35.000đ' }).click()
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: 'Thêm Bánh mì que' }).click()
  await expect(page.getByTestId('cart-bar')).toContainText('Giỏ • 2 món')

  await page.getByTestId('cart-bar').click()
  await fillPickup(page)
  await expect(page.getByTestId('checkout-total')).toHaveText('55.000đ')
  await placeButton(page).click()
  await expect(page).toHaveURL(/\/o\/[\w-]{43}$/)

  const items = await getDb().select().from(orderItems).orderBy(orderItems.position)
  expect(items.map(item => [item.nameSnapshot, item.qty, item.optionsSnapshotJson.map(option => option.valueName)])).toEqual([
    ['Trà sữa trân châu', 1, ['M']],
    ['Bánh mì que', 1, []],
  ])
})

test('inline validation: bad phone and empty name block the request', async ({ page }, testInfo) => {
  const { store, menu } = await seed(testInfo)
  await openMenuWithCart(page, store.slug, menu)
  await page.getByTestId('cart-bar').click()
  await page.getByLabel('Số điện thoại').fill('0212345678')
  await placeButton(page).click()

  await expect(page.getByText('Vui lòng nhập tên')).toBeVisible()
  await expect(page.getByText('Số điện thoại không hợp lệ')).toBeVisible()
  expect(await ordersOf(store.id)).toBe(0)
})

test('the cart survives a reload and edits are persisted', async ({ page }, testInfo) => {
  const { store, menu } = await seed(testInfo)
  await openMenuWithCart(page, store.slug, menu)
  await page.getByTestId('cart-bar').click()
  await page.getByRole('button', { name: 'Tăng số lượng Trà sữa trân châu' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('cart-bar')).toContainText('3 món')

  await page.reload()
  await expect(page.getByTestId('cart-bar')).toContainText('3 món')
})

test('double tap on "Đặt món" creates exactly one order (Review Focus #8)', async ({ page }, testInfo) => {
  const { store, menu } = await seed(testInfo)
  await openMenuWithCart(page, store.slug, menu)
  await page.getByTestId('cart-bar').click()
  await fillPickup(page)
  await placeButton(page).dblclick()

  await expect(page).toHaveURL(/\/o\/[\w-]{43}$/)
  expect(await ordersOf(store.id)).toBe(1)
})

test('a lost response followed by a retry yields the same single order (Review Focus #8)', async ({ page }, testInfo) => {
  const { store, menu } = await seed(testInfo)
  await openMenuWithCart(page, store.slug, menu)

  let dropped = false
  await page.route('**/api/public/stores/*/orders', async (route) => {
    if (dropped) return route.continue()
    dropped = true
    await route.fetch()
    await route.abort('failed')
  })

  await page.getByTestId('cart-bar').click()
  await fillPickup(page)
  await placeButton(page).click()
  await expect(page.getByText('Mất kết nối')).toBeVisible()
  expect(await ordersOf(store.id)).toBe(1)

  await placeButton(page).click()
  await expect(page).toHaveURL(/\/o\/[\w-]{43}$/)
  expect(await ordersOf(store.id)).toBe(1)
})

test('price changed in the meantime: server price wins, the customer confirms the new price (Review Focus #7)', async ({ page }, testInfo) => {
  const { store, menu } = await seed(testInfo)
  await openMenuWithCart(page, store.slug, menu)
  await page.getByTestId('cart-bar').click()
  await fillPickup(page)
  await getDb().update(products).set({ basePriceVnd: 38_000 }).where(eq(products.id, menu.tea.id))

  await placeButton(page).click()
  await expect(page.getByText('Một số món đã thay đổi')).toBeVisible()
  await expect(page.getByText('Giá mới 38.000đ')).toBeVisible()
  await expect(placeButton(page)).toBeDisabled()
  expect(await ordersOf(store.id)).toBe(0)

  await page.getByRole('button', { name: 'Cập nhật giá' }).click()
  await expect(page.getByTestId('checkout-total')).toHaveText('76.000đ')
  await placeButton(page).click()
  await expect(page).toHaveURL(/\/o\/[\w-]{43}$/)

  const items = await getDb().select().from(orderItems)
  expect(items.map(item => item.unitPriceVnd)).toEqual([38_000])
})

test('a sold-out product is flagged and the cart can be emptied', async ({ page }, testInfo) => {
  const { store, menu } = await seed(testInfo)
  await openMenuWithCart(page, store.slug, menu)
  await page.getByTestId('cart-bar').click()
  await fillPickup(page)
  await getDb().update(products).set({ isAvailable: false }).where(eq(products.id, menu.tea.id))

  await placeButton(page).click()
  await expect(page.getByText('Món này đã hết')).toBeVisible()
  expect(await ordersOf(store.id)).toBe(0)

  await page.getByRole('button', { name: 'Xóa Trà sữa trân châu' }).click()
  await expect(page.getByText('Giỏ hàng trống')).toBeVisible()
})

test('the store closing mid-checkout shows a clear message and keeps the cart (Review Focus #4)', async ({ page }, testInfo) => {
  const { store, menu } = await seed(testInfo)
  await openMenuWithCart(page, store.slug, menu)
  await page.getByTestId('cart-bar').click()
  await fillPickup(page)
  await getDb().update(stores).set({ isAcceptingOrders: false }).where(eq(stores.id, store.id))

  await placeButton(page).click()
  await expect(page.getByText('Quán đang tạm nghỉ').first()).toBeVisible()
  expect(await ordersOf(store.id)).toBe(0)

  await page.reload()
  await expect(page.getByTestId('cart-bar')).toContainText('2 món')
})
```

- [ ] **Step 3: Chạy test để xác nhận thất bại**

Run: `npx vitest run --project nuxt tests/nuxt/order/cart-bar.test.ts && npx playwright test tests/e2e/ordering.spec.ts --project=mobile-chrome`
Expected: FAIL — không resolve được `~/components/order/CartBar.vue`; E2E không thấy `cart-bar`.

- [ ] **Step 4: Viết `CartBar.vue` và `RecentOrders.vue`**

`app/components/order/CartBar.vue`:

```vue
<script setup lang="ts">
import { formatVnd } from '#shared/money'

const props = defineProps<{ slug: string }>()
const emit = defineEmits<{ open: [] }>()

const cart = useCart(props.slug)
</script>

<template>
  <div
    v-if="cart.ready.value && cart.count.value > 0"
    class="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2"
  >
    <ZButton
      block
      size="lg"
      icon="i-lucide-shopping-bag"
      class="pointer-events-auto mx-auto max-w-2xl justify-between"
      data-testid="cart-bar"
      :aria-label="`Xem giỏ hàng, ${cart.count.value} món, ${formatVnd(cart.subtotalVnd.value)}`"
      @click="emit('open')"
    >
      <span>Giỏ • {{ cart.count.value }} món</span>
      <span class="font-mono">{{ formatVnd(cart.subtotalVnd.value) }}</span>
    </ZButton>
  </div>
</template>
```

`app/components/order/RecentOrders.vue`:

```vue
<script setup lang="ts">
import { formatVnd } from '#shared/money'

const props = defineProps<{ slug: string }>()
const recent = useRecentOrders().forStore(props.slug)
const top = computed(() => recent.value.slice(0, 3))
</script>

<template>
  <nav v-if="top.length > 0" aria-label="Đơn gần đây" class="flex flex-col gap-2">
    <p class="text-sm font-medium text-muted">
      Đơn gần đây của bạn
    </p>
    <ul class="flex flex-col gap-2">
      <li v-for="order in top" :key="order.token">
        <NuxtLink
          :to="`/o/${order.token}`"
          class="flex min-h-11 items-center justify-between gap-3 rounded-md bg-(--zeno-surface) px-4 py-2 ring-1 ring-default"
        >
          <span class="font-mono text-sm text-default">#{{ order.publicCode }}</span>
          <span class="ms-auto font-mono text-sm text-muted">{{ formatVnd(order.totalVnd) }}</span>
          <UIcon name="i-lucide-chevron-right" class="size-4 text-muted" />
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>
```

- [ ] **Step 5: Viết `CheckoutSheet.vue`**

`app/components/order/CheckoutSheet.vue` (dùng `ZSheet` của PR2 Task 13: `v-model:open`, `title`, `description?`, slot `default` cuộn được và slot `footer`):

```vue
<script setup lang="ts">
import type { Form, FormError } from '@nuxt/ui'
import type { FulfillmentType } from '#shared/enums'
import { formatVnd } from '#shared/money'
import { checkoutInputSchema } from '#shared/schemas/checkout'
import type { CartStaleDetails, CreateOrderResponse } from '#shared/types/order'
import { buildCheckoutPayload, checkoutFingerprint, type CheckoutForm } from '~/utils/checkout-body'
import { uuidv4 } from '~/utils/uuid'

interface Zone { id: string, name: string, feeVnd: number }
interface Notice { color: 'error' | 'warning', title: string, description?: string }

const props = defineProps<{
  slug: string
  storeName: string
  acceptingOrders: boolean
  pickupEnabled: boolean
  deliveryEnabled: boolean
  deliveryZones: Zone[]
  tableToken: string | null
  tableLabel: string | null
}>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ refresh: [] }>()

const cart = useCart(props.slug)
const recent = useRecentOrders()
const formRef = useTemplateRef<Form<CheckoutForm>>('formRef')

const form = reactive<CheckoutForm>({ customer: { name: '', phone: '', address: '' }, deliveryZoneId: null, note: '' })
const mode = ref<FulfillmentType>('PICKUP')
const submitting = ref(false)
const notice = ref<Notice | null>(null)

const atTable = computed(() => !!props.tableToken && !!props.tableLabel)
const modes = computed<{ value: FulfillmentType, label: string }[]>(() => {
  if (atTable.value) return [{ value: 'DINE_IN', label: `Tại bàn · ${props.tableLabel}` }]
  return [
    ...(props.pickupEnabled ? [{ value: 'PICKUP' as const, label: 'Mang đi' }] : []),
    ...(props.deliveryEnabled ? [{ value: 'DELIVERY' as const, label: 'Giao hàng' }] : []),
  ]
})

const zone = computed(() => props.deliveryZones.find(item => item.id === form.deliveryZoneId) ?? null)
const zoneItems = computed(() => props.deliveryZones.map(item => ({ label: `${item.name} · ${formatVnd(item.feeVnd)}`, value: item.id })))
const deliveryFeeVnd = computed(() => (mode.value === 'DELIVERY' ? (zone.value?.feeVnd ?? 0) : 0))
const totalVnd = computed(() => cart.subtotalVnd.value + deliveryFeeVnd.value)
const canSubmit = computed(() => props.acceptingOrders && modes.value.length > 0 && cart.lines.value.length > 0 && !cart.hasStale.value)

function hydrateForm() {
  Object.assign(form.customer, cart.customer.value)
  form.note = cart.note.value
  const remembered = cart.deliveryZoneId.value
  form.deliveryZoneId = props.deliveryZones.some(item => item.id === remembered)
    ? remembered
    : (props.deliveryZones.length === 1 ? props.deliveryZones[0]!.id : null)
  const wanted = atTable.value ? 'DINE_IN' : cart.fulfillmentType.value
  mode.value = modes.value.find(item => item.value === wanted)?.value ?? modes.value[0]?.value ?? 'PICKUP'
}

watch(() => cart.ready.value, (ready) => {
  if (ready) hydrateForm()
}, { immediate: true })

watch(modes, () => {
  if (!modes.value.some(item => item.value === mode.value)) mode.value = modes.value[0]?.value ?? 'PICKUP'
})

watch(form, () => {
  if (!cart.ready.value) return
  cart.updateForm({ customer: { ...form.customer }, deliveryZoneId: form.deliveryZoneId, note: form.note })
}, { deep: true })

watch(mode, (value) => {
  if (cart.ready.value && value !== 'DINE_IN') cart.updateForm({ fulfillmentType: value })
})

const payload = () => buildCheckoutPayload({
  lines: cart.lines.value,
  form,
  fulfillmentType: mode.value,
  tableToken: props.tableToken,
  paymentMethod: 'PAY_ON_RECEIPT',
  deliveryFeeVnd: deliveryFeeVnd.value,
})

const FORM_FIELDS = ['customer', 'deliveryZoneId', 'tableToken', 'note']

// Same schema as the server, so inline errors and server errors always agree.
function validate(): FormError[] {
  const result = checkoutInputSchema.safeParse({ ...payload(), idempotencyKey: uuidv4() })
  if (result.success) return []
  return result.error.issues
    .filter(issue => FORM_FIELDS.includes(String(issue.path[0])))
    .map(issue => ({ name: issue.path.join('.'), message: issue.message }))
}

async function submit() {
  if (submitting.value || !canSubmit.value) return
  submitting.value = true
  notice.value = null
  const data = payload()
  // Same payload → same key, so a retry after a lost response returns the original order.
  const idempotencyKey = cart.ensureIdempotencyKey(checkoutFingerprint(data))
  try {
    const res = await $fetch<CreateOrderResponse>(`/api/public/stores/${encodeURIComponent(props.slug)}/orders`, {
      method: 'POST',
      body: { idempotencyKey, ...data },
    })
    recent.add({
      token: res.guestToken,
      publicCode: res.publicCode,
      storeSlug: props.slug,
      storeName: props.storeName,
      totalVnd: res.totalVnd,
      createdAt: new Date().toISOString(),
    })
    cart.clearAfterSuccess()
    open.value = false
    await navigateTo(`/o/${res.guestToken}`)
  }
  catch (err) {
    handleError(err)
  }
  finally {
    submitting.value = false
  }
}

function onStale(details: CartStaleDetails) {
  if (details.lines.length > 0) {
    cart.markStale(details.lines)
    notice.value = { color: 'warning', title: 'Một số món đã thay đổi', description: 'Xem các món được đánh dấu bên dưới rồi đặt lại.' }
  }
  else {
    notice.value = {
      color: 'warning',
      title: 'Phí giao hoặc tổng tiền đã thay đổi',
      description: details.totalVnd === null ? undefined : `Tổng mới: ${formatVnd(details.totalVnd)}. Bấm "Đặt món" để xác nhận.`,
    }
  }
  emit('refresh')
}

function handleError(err: unknown) {
  const error = extractApiError(err)
  if (!(err as { response?: unknown } | null)?.response) {
    notice.value = { color: 'warning', title: 'Mất kết nối', description: 'Bấm "Đặt món" lần nữa để thử lại. Đơn sẽ không bị đặt trùng.' }
    return
  }
  switch (error.code) {
    case 'CART_STALE':
      return onStale(error.details as CartStaleDetails)
    case 'VALIDATION_FAILED': {
      const issues = Array.isArray(error.details) ? (error.details as { path: string, message: string }[]) : []
      formRef.value?.setErrors(issues.map(issue => ({ name: issue.path, message: issue.message })))
      notice.value = { color: 'error', title: 'Vui lòng kiểm tra lại thông tin' }
      return
    }
    case 'STORE_CLOSED':
    case 'NOT_FOUND':
      notice.value = { color: 'warning', title: 'Quán đang tạm nghỉ', description: 'Giỏ hàng của bạn vẫn được giữ. Hãy thử lại khi quán mở cửa.' }
      return
    case 'MODE_DISABLED':
      notice.value = { color: 'warning', title: 'Quán không nhận đơn theo hình thức này lúc này', description: 'Hãy thử hình thức khác.' }
      return emit('refresh')
    case 'INVALID_TABLE':
      notice.value = { color: 'error', title: 'Mã QR bàn không còn hiệu lực', description: 'Hãy quét lại mã QR trên bàn.' }
      return emit('refresh')
    case 'INVALID_ZONE':
      notice.value = { color: 'warning', title: 'Khu vực giao hàng không còn được hỗ trợ', description: 'Hãy chọn khu vực khác.' }
      return emit('refresh')
    case 'RATE_LIMITED':
      notice.value = { color: 'warning', title: 'Bạn đặt quá nhanh', description: 'Vui lòng thử lại sau ít phút.' }
      return
    default:
      notice.value = { color: 'error', title: 'Chưa gửi được đơn', description: 'Bấm "Đặt món" để thử lại. Đơn sẽ không bị đặt trùng.' }
  }
}
</script>

<template>
  <ZSheet v-model:open="open" title="Giỏ hàng của bạn" :description="`Đặt tại ${storeName}`">
    <template #default>
      <AppEmptyState
        v-if="cart.lines.value.length === 0"
        icon="i-lucide-shopping-bag"
        title="Giỏ hàng trống"
        description="Chọn vài món từ thực đơn rồi quay lại đây nhé."
      >
        <template #actions>
          <ZButton variant="secondary" block @click="open = false">
            Xem thực đơn
          </ZButton>
        </template>
      </AppEmptyState>

      <div v-else class="flex flex-col gap-5">
        <ZAlert v-if="!acceptingOrders" color="warning" title="Quán đang tạm nghỉ" description="Giỏ hàng được giữ lại, bạn đặt món khi quán mở cửa." />
        <ZAlert v-if="notice" :color="notice.color" :title="notice.title" :description="notice.description" />

        <ul class="flex flex-col gap-3">
          <li
            v-for="line in cart.lines.value"
            :key="line.lineId"
            class="flex flex-col gap-2 rounded-md p-3 ring-1"
            :class="line.stale ? 'ring-warning' : 'ring-default'"
            :data-stale="line.stale ?? undefined"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="break-words font-medium text-default">
                  {{ line.name }}
                </p>
                <p v-if="line.optionLabels.length" class="break-words text-sm text-muted">
                  {{ line.optionLabels.join(' · ') }}
                </p>
                <p v-if="line.note" class="break-words text-sm text-muted">
                  Ghi chú: {{ line.note }}
                </p>
              </div>
              <p class="shrink-0 font-mono text-sm text-default">
                {{ formatVnd(line.unitPriceVnd * line.quantity) }}
              </p>
            </div>

            <p v-if="line.stale === 'PRODUCT_UNAVAILABLE'" class="text-sm font-medium text-error">
              Món này đã hết, vui lòng xóa khỏi giỏ
            </p>
            <p v-else-if="line.stale === 'OPTION_INVALID'" class="text-sm font-medium text-error">
              Lựa chọn của món đã thay đổi, vui lòng xóa và chọn lại
            </p>
            <div v-else-if="line.stale === 'PRICE_CHANGED'" class="flex flex-wrap items-center gap-2">
              <p class="text-sm font-medium text-error">
                Giá mới {{ formatVnd(line.currentUnitPriceVnd ?? 0) }}
              </p>
              <ZButton size="sm" variant="secondary" @click="cart.acceptPrice(line.lineId)">
                Cập nhật giá
              </ZButton>
            </div>

            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1">
                <ZButton
                  variant="secondary"
                  square
                  icon="i-lucide-minus"
                  :aria-label="`Giảm số lượng ${line.name}`"
                  @click="cart.setQuantity(line.lineId, line.quantity - 1)"
                />
                <span class="min-w-9 text-center font-mono" aria-live="polite">{{ line.quantity }}</span>
                <ZButton
                  variant="secondary"
                  square
                  icon="i-lucide-plus"
                  :disabled="line.quantity >= 50"
                  :aria-label="`Tăng số lượng ${line.name}`"
                  @click="cart.setQuantity(line.lineId, line.quantity + 1)"
                />
              </div>
              <ZButton variant="ghost" square icon="i-lucide-trash-2" :aria-label="`Xóa ${line.name}`" @click="cart.remove(line.lineId)" />
            </div>
          </li>
        </ul>

        <div v-if="modes.length === 0" class="rounded-md bg-(--zeno-surface-inset) p-3 text-sm text-muted">
          Quán chưa mở hình thức nhận món nào. Vui lòng quay lại sau.
        </div>

        <div v-else role="radiogroup" aria-label="Hình thức nhận món" class="grid gap-2" :class="modes.length > 1 ? 'grid-cols-2' : 'grid-cols-1'">
          <ZButton
            v-for="item in modes"
            :key="item.value"
            role="radio"
            :aria-checked="mode === item.value"
            :variant="mode === item.value ? 'primary' : 'secondary'"
            @click="mode = item.value"
          >
            {{ item.label }}
          </ZButton>
        </div>

        <UForm ref="formRef" :state="form" :validate="validate" class="flex flex-col gap-4" @submit="submit">
          <component :is="mode === 'DINE_IN' ? 'details' : 'div'" class="flex flex-col gap-4">
            <summary v-if="mode === 'DINE_IN'" class="flex min-h-11 cursor-pointer items-center text-sm font-medium text-primary">
              Thêm tên hoặc SĐT để quán gọi bạn (không bắt buộc)
            </summary>
            <ZFormField label="Tên của bạn" name="customer.name">
              <ZInput v-model="form.customer.name" size="lg" autocomplete="name" />
            </ZFormField>
            <ZFormField label="Số điện thoại" name="customer.phone">
              <ZInput v-model="form.customer.phone" size="lg" type="tel" inputmode="tel" autocomplete="tel" />
            </ZFormField>
          </component>

          <template v-if="mode === 'DELIVERY'">
            <ZFormField label="Khu vực giao" name="deliveryZoneId">
              <ZSelect
                aria-label="Khu vực giao"
                size="lg"
                placeholder="Chọn khu vực"
                :items="zoneItems"
                :model-value="form.deliveryZoneId ?? undefined"
                @update:model-value="form.deliveryZoneId = $event ?? null"
              />
            </ZFormField>
            <ZFormField label="Địa chỉ chi tiết" name="customer.address">
              <ZInput v-model="form.customer.address" size="lg" autocomplete="street-address" />
            </ZFormField>
          </template>

          <ZFormField label="Ghi chú cho quán" name="note" hint="Không bắt buộc">
            <ZInput v-model="form.note" size="lg" />
          </ZFormField>
        </UForm>

        <p class="flex items-center gap-2 text-sm text-muted">
          <UIcon name="i-lucide-banknote" class="size-4" />
          Thanh toán: trả tiền khi nhận món
        </p>

        <dl class="flex flex-col gap-1 text-sm">
          <div class="flex justify-between">
            <dt class="text-muted">
              Tạm tính
            </dt>
            <dd class="font-mono">
              {{ formatVnd(cart.subtotalVnd.value) }}
            </dd>
          </div>
          <div v-if="mode === 'DELIVERY'" class="flex justify-between">
            <dt class="text-muted">
              Phí giao
            </dt>
            <dd class="font-mono">
              {{ zone ? formatVnd(deliveryFeeVnd) : 'Chọn khu vực' }}
            </dd>
          </div>
          <div class="flex justify-between text-base font-semibold">
            <dt>Tổng cộng</dt>
            <dd class="font-mono" data-testid="checkout-total">
              {{ formatVnd(totalVnd) }}
            </dd>
          </div>
        </dl>
      </div>
    </template>

    <template v-if="cart.lines.value.length > 0" #footer>
      <div class="flex w-full flex-col gap-2">
        <ZButton size="lg" block :loading="submitting" :disabled="!canSubmit" @click="formRef?.submit()">
          Đặt món • {{ formatVnd(totalVnd) }}
        </ZButton>
        <p v-if="cart.hasStale.value" class="text-center text-sm text-muted">
          Xử lý các món được đánh dấu trước khi đặt.
        </p>
      </div>
    </template>
  </ZSheet>
</template>
```

- [ ] **Step 6: Chạy test component**

Run: `npx vitest run --project nuxt tests/nuxt/order/cart-bar.test.ts`
Expected: PASS.

- [ ] **Step 7: Thay giỏ tạm của PR2 bằng `useCart` và nối checkout vào trang `/s/[slug]`**

Trong `app/pages/s/[slug].vue`:

1. Import và khai báo giỏ thật:

```ts
import { newLineFromProduct } from '~/utils/cart-storage'
```

Thay `const cart = useCartDraft(slug)` bằng:

```ts
const cart = useCart(slug.value)
const checkoutOpen = ref(false)
```

2. Thay hai chỗ thêm món (`ProductSheet` đã kiểm tra lựa chọn hợp lệ trước khi cho bấm nút nên `newLineFromProduct` không cần ném lỗi):

```ts
function onAdd(product: PublicProduct) {
  if (!product.isAvailable || !canOrder.value) return
  if (product.optionGroups.length === 0) {
    cart.add(newLineFromProduct(product, { optionValueIds: [], quantity: 1 }))
    toast.add({ color: 'success', title: `Đã thêm ${product.name}` })
    return
  }
  sheetProduct.value = product
  sheetOpen.value = true
}

function onSheetAdd(payload: { valueIds: string[], quantity: number }) {
  const product = sheetProduct.value
  if (!product) return
  cart.add(newLineFromProduct(product, { optionValueIds: payload.valueIds, quantity: payload.quantity }))
  sheetOpen.value = false
  toast.add({ color: 'success', title: `Đã thêm ${product.name}` })
}
```

3. Khu vực giao nằm trong `/fulfillment`, nên API này phải được gọi **cả khi không có `?t=`** (PR2 chỉ gọi khi có `t`). Đổi khối `useFetch<PublicFulfillment>` thành (bỏ `immediate`, thêm `refresh`; `tableInvalid`/`tableLabel` của PR2 giữ nguyên):

```ts
const { data: fulfillment, refresh: refreshFulfillment } = await useFetch<PublicFulfillment>(
  () => `/api/public/stores/${encodeURIComponent(slug.value)}/fulfillment`,
  { query: { t: tableToken }, watch: false },
)
```

4. Thêm đồng bộ giỏ với menu mới tải và hàm tải lại:

```ts
// Flag cart lines the freshly loaded menu no longer supports (sold out, option removed, price changed).
watch([() => menu.value?.products, () => cart.ready.value], ([products, ready]) => {
  if (products && ready) cart.reconcile(products)
}, { immediate: true })

async function refreshAll() {
  await Promise.all([refresh(), refreshFulfillment()])
}
```

5. Trong `<template>`: thêm `<OrderRecentOrders :slug="slug" />` ngay trên ô tìm kiếm (trong khối `<template v-else-if="menu">`), và thay dòng `<MenuCartBar … />` bằng:

```vue
      <OrderCartBar :slug="slug" @open="checkoutOpen = true" />
      <OrderCheckoutSheet
        v-model:open="checkoutOpen"
        :slug="slug"
        :store-name="menu.store.name"
        :accepting-orders="canOrder"
        :pickup-enabled="menu.modes.pickup"
        :delivery-enabled="menu.modes.delivery.available"
        :delivery-zones="fulfillment?.deliveryZones ?? []"
        :table-token="fulfillment?.table ? (tableToken ?? null) : null"
        :table-label="tableLabel"
        @refresh="refreshAll"
      />
```

(Container của trang đã có `pb-28`, đủ chỗ cho thanh giỏ cố định.)

6. Xoá giỏ tạm và test của nó:

```bash
git rm app/composables/useCartDraft.ts shared/cart-draft.ts app/components/menu/CartBar.vue tests/unit/shared/cart-draft.test.ts
grep -rnE "useCartDraft|cart-draft|MenuCartBar" app shared tests || echo "no leftover draft cart"
```

Expected: in `no leftover draft cart`. E2E của PR2 (`Giỏ • 2 món`, `Giỏ • 3 món`, `106.000đ`) vẫn đúng vì `OrderCartBar` giữ chữ `Giỏ • <n> món` và hiển thị tổng ở phần tử riêng.

- [ ] **Step 8: Chạy E2E, lint, typecheck**

Run:

```bash
npx playwright test tests/e2e/ordering.spec.ts
npm run lint
npm run typecheck
```

Expected: PASS cả `mobile-chrome` và `mobile-safari` (11 test); lint và typecheck sạch; `npx playwright test tests/e2e/public-menu.spec.ts` của PR2 vẫn PASS. Nếu `getByRole('option', { name: /Quận 1/ })` không khớp, mở trace (`npx playwright show-trace`) và sửa selector trong spec theo DOM thật của `ZSelect`; không đổi nhãn UI đã nêu ở mục Produces.

- [ ] **Step 9: Commit**

```bash
git add -A app shared tests
git commit -m "feat(order): add cart bar, checkout sheet and wire ordering into the public menu" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 12: Kiểm tra toàn bộ, đồng bộ roadmap, đóng PR

**Files:**
- Modify: `docs/superpowers/plans/2026-10-31-zeno-v1-00-roadmap.md` (bảng "Plan files": PR3 → chi tiết, sẵn sàng thực thi)

**Interfaces:**
- Consumes: toàn bộ Task 1–11.
- Produces: PR `feat(order)` sẵn sàng review với CI xanh; PR4 (`orders`, `order_items`, `order_events`, `transitions.ts`, `shared/enums.ts`), PR5 (`createOrder.resolvePayment`, `encryptSecret`, `consumeRateLimit`), PR6 (`encryptSecret`/`decryptSecret`, `safePath`) dùng các tên đã chốt ở các Task trước.

- [ ] **Step 1: Chạy toàn bộ kiểm tra như CI**

Run:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:nuxt
npm run test:integration
npm run test:api
npm run db:check
npm run build
npx playwright test tests/e2e/ordering.spec.ts tests/e2e/order-tracking.spec.ts
```

Expected: tất cả xanh. Với test fail, sửa code sản phẩm, không nới test.

- [ ] **Step 2: Xác nhận không còn rò PII trong log và không còn sót giỏ tạm của PR2**

Run:

```bash
grep -rnE "useCartDraft|cart-draft" app shared tests || echo "no leftover draft cart"
grep -rn "event.path.split" server || echo "no raw path logging"
```

Expected: cả hai in thông báo `no leftover…`/`no raw path logging`.

- [ ] **Step 3: Đánh dấu plan PR3 là chi tiết trong roadmap**

Trong bảng "Plan files" của roadmap, đổi dòng PR3 thành:

```markdown
| 3 | `feat(order)` | [2026-10-31-zeno-v1-04-ordering.md](./2026-10-31-zeno-v1-04-ordering.md) | **Chi tiết, sẵn sàng thực thi** |
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-10-31-zeno-v1-00-roadmap.md
git commit -m "docs(order): mark PR3 plan as ready in roadmap" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
