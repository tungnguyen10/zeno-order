> **2026-11-06 implementation override (after merged PR6 #4):** The code samples below are the original proposal, not executable deployment instructions. The authoritative PR7 mapping and validation state are in `docs/superpowers/specs/2026-11-06-pr7-hardening-implementation.md` and `docs/operations.md`.
>
> PR6 uses **Neon Functions scheduled POST triggers**, not Vercel Cron, `vercel.json`, `assertCronRequest`, `CRON_SECRET` or Nuxt cron routes. PR7 uses separate `OPS_STATUS_SECRET`, actual `received_at`/`PENDING`/`REVIEW_REQUIRED` columns/statuses, per-integration health and fenced job heartbeats. Endpoint attestation is required before operational seed/reset/drill; an env branch label is not enough. Key rotation must preserve/re-encrypt all existing ciphertext and guest tokens before replacing the key. No live bank/pilot/production restore proof follows from a merge. No attribution trailer is required in this workspace.

# ZENO Mini Order V1 — PR7 Hardening: chất lượng, bảo mật, vận hành, pilot & go-live Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chứng minh bằng test và lệnh chạy được rằng V1 an toàn để mở cho một quán thật: không rò tenant/PII/secret, có giới hạn tốc độ, header bảo mật, a11y + hiệu năng mobile đạt ngưỡng, có log/alert/health, có backup-restore đã diễn tập, tách môi trường production/test, có seed + runbook pilot + rollback, và tài liệu go-live mà **mọi mục đều có lệnh `Verify:` chạy được**.

**Architecture:** Thêm một Vitest project `hardening` chạy trên **bản build production thật** (`.output/server/index.mjs`, spawn một lần trong `globalSetup`, nối vào Neon branch `test`) để mọi kiểm tra header/log/rate-limit/tenant-matrix thấy đúng thứ sẽ lên Vercel. Các rule tĩnh (route inventory, guard-before-parse, XSS/CSRF/log rule, ánh xạ Review Focus → test, định dạng go-live checklist) là unit test không cần DB. Hành vi runtime mới (header, rate limit, access log, `/api/internal/status`) nằm trong **Nitro middleware** + hàm thuần có unit test; handler của PR2–PR6 chỉ bị sửa tối thiểu khi test tìm ra lỗi thật (Task 9: IP của checkout; Task 13: handler `GET` cho cron). E2E a11y/CSP/Lighthouse chạy bằng Playwright config riêng trỏ vào bản build production; lỗi a11y/hiệu năng tìm thấy được sửa ngay trong component.

**Tech Stack:** Nuxt 4.5.2 · Nitro middleware · Vitest 5 (project `hardening`) · Playwright 1.63 · `@axe-core/playwright` 4.14.0 · `lighthouse` 13.6.0 (chạy qua Chromium của Playwright) · `jiti` 2.7.0 (chạy script TS) · Neon CLI 8.4.1 (`neon snapshots`, `neon branches`, `neon cs`) · Vercel CLI · GitHub Actions.

**Spec:** [2026-10-31-zeno-mini-order-v1-design.md](../specs/2026-10-31-zeno-mini-order-v1-design.md) (§2, §3.1–3.2, §5–6, §9–11) · PRD: [ZENO_MINI_ORDER_V1_IMPLEMENTATION_PLAN.md](../../ZENO_MINI_ORDER_V1_IMPLEMENTATION_PLAN.md) (§10 Phase 5, §11, §12, §14, §15) · Roadmap: [2026-10-31-zeno-v1-00-roadmap.md](./2026-10-31-zeno-v1-00-roadmap.md) (mục PR7) · Phụ thuộc: PR0–PR6 đã merge.

## Global Constraints

Áp dụng toàn bộ "Global Constraints" của roadmap. Điểm chạm của PR này (giá trị chép nguyên văn):

- **Package manager:** npm, commit `package-lock.json`; pin version chính xác (không `^`/`~`). Runtime Node `>=24 <25`. Deploy Vercel.
- **Import:** server dùng import tường minh và đường dẫn tương đối trong `server/`; `shared/` qua alias `#shared`. Không dùng `~/server/...`.
- **Lớp kiến trúc:** route handler mỏng (parse → guard → service). Transaction chỉ nằm trong `server/services/**`. Repository luôn nhận `{orgId, storeId}` hoặc `StoreContext`.
- **Tenant:** không có quyền → **404**; thiếu role → **403**; thiếu/sai token → **401**.
- **Secret:** mã hoá AES-256-GCM bằng `APP_ENCRYPTION_KEY`; không bao giờ trả secret ra API; không đưa vào `runtimeConfig.public`.
- **Lỗi API:** `{ code, message, details? }`, code theo spec §9.
- **Log:** qua `logger` (redact PII/secret); không log body webhook, chữ ký, SĐT, địa chỉ.
- **UI:** tiếng Việt, mobile-first 360px, Nuxt UI v4, vùng bấm ≥ 44px, có trạng thái loading/empty/error ở mọi màn.
- **Commit:** conventional commits, kèm trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.
- **Quy ước xuyên PR:** không nới test để cho xanh (test fail thì sửa code sản phẩm); mọi route protected có hàng trong ma trận tenant; route public có test không lộ PII.
- **Môi trường (đã xác minh):** DB dev/test là Neon branch **`test`**; DB production là branch mặc định **`production`** (`neon branches list` ghi `[default] production`). Dev server **phải restart** sau `neon checkout` vì Nitro giữ `process.env` cũ. Mọi suite gọi `resetDb()` sẽ **xoá sạch branch `test`**; `assertTestDatabase()` từ chối khi `NEON_BRANCH=production`.
- **Bất biến riêng của PR7:** (1) không script/test nào được ghi vào branch `production` trừ khi có cờ tường minh hai lớp (Task 2); (2) mọi mục trong `docs/go-live-checklist.md` có `Verify:` là lệnh/test chạy được (Task 16 cưỡng chế bằng test); (3) ngưỡng a11y/Lighthouse chỉ được hạ khi ghi lý do vào `docs/operations.md`.

## Review Focus

Năm tình huống spec/roadmap ngầm có nhưng chưa task nào ở PR0–PR6 kiểm tra, dễ gây hại nhất khi chạy thật (xếp theo khả năng xảy ra). Mỗi dòng có test ghim ở task sở hữu.

1. **Quán cafe dùng chung Wi-Fi: hàng chục khách cùng một IP công cộng.** Giới hạn theo IP không được chặn khách thật; tracking `/api/public/orders/:token` giới hạn theo **token**, giới hạn IP chỉ là trần rất cao. → Task 9 (`rate-limit.test.ts`: token A bị 429 sau 40 lần, token B cùng IP vẫn 404/200 không bị 429).
2. **Header bảo mật/CSP/rate limit làm hỏng luồng hợp lệ:** ảnh VietQR từ `qr.sepay.vn`, ảnh món từ storage, gọi `@neon/auth` từ trình duyệt, font tự host (CSP); 30 khách cùng Wi-Fi mở menu cùng lúc (rate limit). Không được bị chặn oan; đồng thời IP dùng để giới hạn không thể bị giả bằng `X-Forwarded-For` khi chạy ngoài Vercel (PR3 hiện tin XFF vô điều kiện). → Task 7 (CSP + test header), Task 10 (không có vi phạm CSP trên `/s`, `/o`, `/app`), Task 9 (`rate-limit.test.ts`: 30 request menu đồng thời đều 200; XFF giả vẫn bị 429 ở đơn thứ 11).
3. **Token nằm trong URL (`/o/<token>`, `/api/public/orders/<token>`, `?t=<tableToken>`, `/api/webhooks/sepay/<key>`) lọt vào access log, log lỗi hoặc cảnh báo.** Log chỉ chứa đường dẫn đã thay `:token`/`:id`, không query. → Task 4 (unit + hardening) và Task 6 (quét toàn bộ log với canary).
4. **Hệ thống vận hành im lặng khi hỏng:** cron reconcile/expire ngừng chạy (sai gói Vercel — Hobby chỉ cho cron 1 lần/ngày —, `CRON_SECRET` lệch giữa Vercel và GitHub), giao dịch kẹt `RECEIVED`, attempt quá hạn không đóng, và không ai nhận cảnh báo. `/api/internal/status` phải trả `503` kèm lý do trong các trường hợp đó, `ops-watch` phải đỏ, và mọi route cron trong `vercel.json` phải nhận `GET` (Vercel chỉ gọi GET) và từ chối khi thiếu/sai secret. → Task 13 (`status.test.ts`, `cron-contract.test.ts`, `ops-endpoints.test.ts`).
5. **Chạy nhầm seed/`resetDb`/migrate/drill vào production, để biến test (`AUTH_TEST_JWKS`, `ZENO_TEST_DB`) hoặc secret rơi vào production/bundle client.** Seed từ chối production nếu thiếu hai cờ; `check-env` bắt biến test/khoá trùng giữa hai môi trường; test quét `.output/public` tìm giá trị secret. → Task 2, Task 6, Task 15.

---

## Pre-flight: hợp đồng PR2–PR6 mà plan này dựa vào

PR2–PR6 được viết song song nên plan này chỉ dựa vào tên đã chốt trong roadmap. **Trước Task 1** chạy khối lệnh sau; mọi dòng phải in ra kết quả. Nếu một tên khác, sửa đúng **một chỗ import** trong plan này (không đổi hành vi test) và ghi vào PR description.

```bash
grep -nE "export const (categories|products|productOptionGroups|productOptionValues|storeTables|deliveryZones|orders)\b" server/db/schema/*.ts
grep -nE "export function (generateToken|hashToken)" server/utils/tokens.ts
grep -nE "export (async )?function consumeRateLimit" server/services/ordering/rate-limit.ts
grep -nE "export (async )?function createOrder\b" server/services/ordering/create-order.ts
grep -nE "export function assertCronRequest" server/utils/cron-auth.ts
grep -nE "export function (safePath|redactPath)" server/utils/safe-path.ts server/utils/redact-path.ts
grep -nE "export (async )?function (seedMenu|pickupBody|deliveryBody|dineInBody)\b" tests/support/checkout-fixtures.ts
grep -nE "export (async )?function (createPaymentSetup|createAwaitingOrder|sepayPayload|signSepayBody|bodyOf)\b" tests/support/*.ts
ls server/api/public server/api/internal server/api/webhooks 2>&1 | head -20
ls vercel.json
```

Giả định cần khớp (nếu lệch thì dừng và sửa plan trước khi code):

| Giả định | Nguồn | Dùng ở |
|---|---|---|
| Bảng Drizzle `categories`, `products`, `productOptionGroups`, `productOptionValues`, `storeTables`, `deliveryZones`, `orders` export từ `server/db/schema`; cột camelCase theo cột SQL trong roadmap (`basePriceVnd`, `isAvailable`, `active`, `position`, `minSelect`, `maxSelect`, `required`, `priceDeltaVnd`, `code`, `displayName`, `tokenHash`, `feeVnd`, `publicCode`, `guestTokenHash`, `guestTokenEncrypted`, `idempotencyKey`) | PR2/PR3 roadmap | Task 2, 5, 6, 12 |
| `stores` có `dineInEnabled`, `pickupEnabled`, `deliveryEnabled`, `isAcceptingOrders` | spec §4.3 | Task 2 |
| `generateToken(bytes = 32): string`, `hashToken(token: string): string` | PR2 Task 1 | Task 2 |
| `consumeRateLimit(db: DbOrTx, key: string, opts: { limit: number; windowSec: number; now?: Date }): Promise<boolean>` — **`true` = được phép, `false` = bị chặn** | PR3 Task 4 | Task 9 |
| `safePath(raw): string` (bỏ query, che `/api/public/orders/<token>`, `/o/<token>`, `/api/webhooks/sepay/<key>` thành `[REDACTED]`) và `redactPath(path): string` (che `/api/invitations/<token>`, `/invite/<token>`, …) | PR3 Task 7 / PR4 Task 7 | Task 4 |
| `POST /api/public/stores/:slug/orders` nhận body `{ idempotencyKey, fulfillmentType, tableToken, customer{name,phone,address}, deliveryZoneId, items[{productId, quantity, optionValueIds, note, expectedUnitPriceVnd}], paymentMethod, expectedTotalVnd, note }` (PR3 thêm hai trường `expected*` so với PRD §7) và trả `201` (đơn mới) / `200` (replay) `{ publicCode, guestToken, status, paymentStatus, totalVnd, qr? }`; `CART_STALE` có `details.lines[{ index, productId, reason: 'PRODUCT_UNAVAILABLE'\|'OPTION_INVALID'\|'PRICE_CHANGED', currentUnitPriceVnd }]`; `GET /api/public/orders/:token` trả `PublicOrderView` (`phoneMasked`, không địa chỉ) | PR3 Task 2/7 | Task 5, 6, 9, 12 |
| `PATCH /api/stores/:storeId/orders/:orderId/status` body `{ expectedStatus, nextStatus }`, 409 `STATUS_CONFLICT` (`details.currentStatus`) | PR4 Task 4 | Task 12 |
| Route cron `/api/internal/reconcile-sepay`, `/api/internal/expire-payment-attempts` nhận **GET và POST** (file không có hậu tố method) và gọi `assertCronRequest(event)` (`server/utils/cron-auth.ts`); `vercel.json` có khối `crons` | PR6 Task 6–7 | Task 3, 13 |
| Route webhook `POST /api/webhooks/sepay/:key` tự giới hạn (`allowWebhookTraffic` 600/phút/IP, `allowWebhookFailure` 20 lỗi xác thực/10 phút/IP) và log `webhook.auth_failed` (`reason`: `MISSING`/`STALE`/`MISMATCH`); `POST /api/public/orders/:token/payment-attempts` tự giới hạn 10/10 phút/đơn | PR6 Task 5 / PR5 Task 10 | Task 9, Task 16 |
| Fixture thanh toán của PR6: `createPaymentSetup({ org: { id }, store: { id, orgId } })` → `{ integration: { webhookEndpointKey }, secret, … }`, `createAwaitingOrder(setup, { amountVnd, attemptStatus?, orderStatus?, paymentStatus? })` → `{ order, attempt: { paymentCode }, guestToken }`, `sepayPayload(setup, { code, transferAmount, … })`, `bodyOf(payload): string`, `signSepayBody(raw, secret): Record<string, string>` (header `x-sepay-timestamp` + `x-sepay-signature`); file có thể tên `tests/support/webhook-fixtures.ts` hoặc `payment-fixtures.ts` — dùng tên thật, chỉ đổi dòng import ở Task 12 | PR6 Task 1/5/11 | Task 12 |
| Sau `neon checkout test` dev server đã restart | Global Constraints | mọi lệnh chạy test |

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `vitest.config.ts` (modify) | thêm project `hardening` (globalSetup + setup như `api`) |
| `tests/support/shared-auth.ts` | khoá EdDSA xuất được (`createSharedAuthKeys`/`createSharedAuth`) để worker ký token mà server production-test chấp nhận (không sửa `tests/support/auth.ts` vì PR4 đang sửa file đó) |
| `tests/hardening/global-setup.ts` | spawn `.output/server/index.mjs`, log ra `test-results/hardening-server.log`, `provide('hardening', …)` |
| `tests/support/hardening.ts` | `api()`, `hardeningAuth()`, `logSize()`, `logSince()`, `waitForLog()` |
| `tests/support/route-inventory.ts` | `discoverRoutes()`, `fileToRoute()`, `guardInfo()` — quét `server/api/**` |
| `tests/support/world.ts` | `buildWorld()`: 2 tenant + staff + menu demo + đơn thật qua HTTP |
| `tests/support/leak-scan.ts` | `findLeaks`, `findTextLeaks`, `envCanaries`, `FORBIDDEN_PUBLIC_KEYS` |
| `tests/support/review-focus-map.ts` | bảng ánh xạ Review Focus / merge-gate thanh toán / E2E PRD §11 → test |
| `tests/support/lighthouse-budget.ts` | `MOBILE_BUDGET`, `evaluateLighthouse()` |
| `tests/unit/support/*.test.ts`, `tests/unit/audit/*.test.ts`, `tests/unit/server/*.test.ts`, `tests/unit/ops/*.test.ts` | unit test thuần |
| `tests/hardening/*.test.ts` | tenant-matrix, public-leak, log-leak, bundle-secrets, security-headers, rate-limit, access-log, review-focus, cron-auth, status |
| `tests/e2e-hardening/*.spec.ts`, `playwright.hardening.config.ts` | a11y, CSP, perf, Lighthouse trên bản build production |
| `server/services/demo/demo-store.ts`, `scripts/seed-pilot.ts`, `scripts/run-ts.mjs` | seed menu/bàn/zone cho pilot + guard production |
| `server/utils/security-headers.ts`, `server/middleware/security-headers.ts` | CSP + header + cache policy |
| `server/utils/rate-limit-policies.ts`, `server/utils/client-ip.ts`, `server/middleware/traffic-rate-limit.ts` | rate limit tập trung theo bảng policy |
| `server/utils/log-path.ts`, `server/utils/access-log.ts`, `server/middleware/traffic-access-log.ts` | access log có sanitize đường dẫn |
| `server/services/ops/status.ts`, `server/api/internal/status.get.ts` | trạng thái vận hành (dùng `assertCronRequest` của PR6) |
| `scripts/audit-runtime.mjs`, `scripts/lib/audit-filter.mjs` | cổng `npm audit` có allowlist hết hạn |
| `scripts/restore-drill.mjs`, `scripts/lib/restore-compare.mjs` | diễn tập backup/restore bằng Neon snapshot |
| `scripts/check-env.mjs`, `scripts/lib/env-check.mjs`, `scripts/smoke-prod.mjs`, `scripts/lib/smoke.mjs` | kiểm tra tách môi trường + smoke sau deploy |
| `.github/workflows/ci.yml` (modify), `.github/workflows/ops-watch.yml` | CI hardening + giám sát production 15 phút |
| `docs/operations.md`, `docs/go-live-checklist.md`, `docs/pilot-runbook.md`, `docs/pilot-report.md` | tài liệu vận hành, go-live, pilot |

Lệnh thường dùng: `npm run test:hardening` (build + project `hardening`), `npm run test:e2e:hardening` (build + Playwright production), `npx vitest run --project unit <path>`.

---

### Task 1: Harness `hardening` — chạy test trên bản build production

**Files:**
- Create: `tests/hardening/global-setup.ts`, `tests/hardening/harness.test.ts`, `tests/support/hardening.ts`, `tests/support/shared-auth.ts`, `tests/unit/support/shared-auth.test.ts`
- Modify: `vitest.config.ts`, `package.json` (scripts), `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `createJwtVerifier`, `TEST_JWT_ISSUER` (`server/auth/jwt.ts`, PR1); `assertTestDatabase`, `loadEnvFileOverride` (`tests/support/test-env.ts`); `resetDb` (`tests/support/db.ts`).
- Produces:
  - `interface SharedAuthKeys { jwksJson: string; privateJwk: JWK }`; `createSharedAuthKeys(): Promise<SharedAuthKeys>`; `createSharedAuth(keys: SharedAuthKeys): Promise<{ jwksJson: string; sign(claims: { sub: string; email?: string; name?: string; emailVerified?: boolean; expiresIn?: string; issuer?: string }): Promise<string> }>`. Không sửa `tests/support/auth.ts`: PR4 Task 7 đang thêm claim `emailVerified` vào file đó, nên file mới này là bản độc lập, xuất được khoá để worker và server production-test dùng chung.
  - `interface HardeningContext { baseUrl: string; logFile: string; keys: SharedAuthKeys; cronSecret: string; appEncryptionKey: string }`
  - `api(method: string, path: string, opts?: { token?: string | null; body?: unknown; headers?: Record<string, string> }): Promise<{ status: number; headers: Headers; body: any; text: string }>`
  - `hardeningAuth(): Promise<ReturnType<typeof createSharedAuth>>`, `hardeningContext(): HardeningContext`, `logSize(): number`, `logSince(offset: number): string`, `waitForLog(predicate: (text: string) => boolean, timeoutMs?: number): Promise<string>`.
  - npm scripts `build:hardening`, `test:hardening`.

- [ ] **Step 1: Chạy khối Pre-flight ở đầu plan, xác nhận mọi giả định**

Run: các lệnh trong "Pre-flight". Expected: mỗi `grep` in ≥ 1 dòng; `ls vercel.json` in `vercel.json`. Nếu thiếu, dừng.

- [ ] **Step 2: Viết unit test thất bại cho khoá test dùng chung**

`tests/unit/support/shared-auth.test.ts`:

```ts
import { createLocalJWKSet } from 'jose'
import { describe, expect, it } from 'vitest'
import { createJwtVerifier, TEST_JWT_ISSUER } from '../../../server/auth/jwt'
import { createSharedAuth, createSharedAuthKeys } from '../../support/shared-auth'

describe('shared test auth keys', () => {
  it('signs with keys that survived a JSON round-trip (as vitest provide() does)', async () => {
    const keys = await createSharedAuthKeys()
    const signer = await createSharedAuth(JSON.parse(JSON.stringify(keys)))
    const verify = createJwtVerifier({
      jwks: createLocalJWKSet(JSON.parse(keys.jwksJson)),
      issuer: TEST_JWT_ISSUER,
    })
    const token = await signer.sign({ sub: 'user_shared', email: 'shared@example.com' })
    await expect(verify(token)).resolves.toMatchObject({ userId: 'user_shared', email: 'shared@example.com' })
  })
})
```

- [ ] **Step 3: Chạy để thấy test thất bại**

Run: `npx vitest run --project unit tests/unit/support/shared-auth.test.ts`
Expected: FAIL — cannot resolve `tests/support/shared-auth`.

- [ ] **Step 4: Tạo `tests/support/shared-auth.ts`**

```ts
import { exportJWK, generateKeyPair, importJWK, SignJWT, type JWK } from 'jose'
import { TEST_JWT_ISSUER } from '../../server/auth/jwt'

export interface SharedAuthKeys {
  jwksJson: string
  privateJwk: JWK
}

export async function createSharedAuthKeys(): Promise<SharedAuthKeys> {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true })
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'EdDSA', use: 'sig' }
  return { jwksJson: JSON.stringify({ keys: [jwk] }), privateJwk: await exportJWK(privateKey) }
}

export async function createSharedAuth(keys: SharedAuthKeys) {
  const privateKey = await importJWK(keys.privateJwk, 'EdDSA')

  async function sign(claims: {
    sub: string
    email?: string
    name?: string
    emailVerified?: boolean
    expiresIn?: string
    issuer?: string
  }) {
    const builder = new SignJWT({ email: claims.email, name: claims.name, emailVerified: claims.emailVerified })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'test-key' })
      .setIssuer(claims.issuer ?? TEST_JWT_ISSUER)
      .setIssuedAt()
      .setExpirationTime(claims.expiresIn ?? '10m')
    if (claims.sub) builder.setSubject(claims.sub)
    return builder.sign(privateKey)
  }

  return { jwksJson: keys.jwksJson, sign }
}
```

- [ ] **Step 5: Tạo helper cho worker `tests/support/hardening.ts`**

```ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { inject } from 'vitest'
import { createSharedAuth, type SharedAuthKeys } from './shared-auth'

export interface HardeningContext {
  baseUrl: string
  logFile: string
  keys: SharedAuthKeys
  cronSecret: string
  appEncryptionKey: string
}

declare module 'vitest' {
  export interface ProvidedContext {
    hardening: HardeningContext
  }
}

export interface ApiResult {
  status: number
  headers: Headers
  body: any
  text: string
}

export interface ApiOptions {
  token?: string | null
  body?: unknown
  headers?: Record<string, string>
}

export const hardeningContext = (): HardeningContext => inject('hardening')

// Fixtures that encrypt secrets run in this worker, but the production server must decrypt them: share one key.
process.env.APP_ENCRYPTION_KEY = hardeningContext().appEncryptionKey

export const hardeningAuth = () => createSharedAuth(hardeningContext().keys)

export async function api(method: string, path: string, opts: ApiOptions = {}): Promise<ApiResult> {
  const headers: Record<string, string> = { ...opts.headers }
  if (opts.token) headers.authorization = `Bearer ${opts.token}`
  let payload: string | undefined
  if (opts.body !== undefined) {
    headers['content-type'] ??= 'application/json'
    payload = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)
  }
  const res = await fetch(`${hardeningContext().baseUrl}${path}`, { method, headers, body: payload, redirect: 'manual' })
  const text = await res.text()
  let body: any = null
  try {
    body = JSON.parse(text)
  }
  catch {
    // HTML or empty body
  }
  return { status: res.status, headers: res.headers, body, text }
}

export function logSize(): number {
  const { logFile } = hardeningContext()
  return existsSync(logFile) ? statSync(logFile).size : 0
}

export function logSince(offset: number): string {
  const { logFile } = hardeningContext()
  return readFileSync(logFile).subarray(offset).toString('utf8')
}

/** Logs are flushed asynchronously by the server process, so poll instead of reading once. */
export async function waitForLog(predicate: (text: string) => boolean, timeoutMs = 5_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let text = logSince(0)
  while (!predicate(text)) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the expected server log line')
    await new Promise(resolve => setTimeout(resolve, 100))
    text = logSince(0)
  }
  return text
}
```

- [ ] **Step 6: Tạo `tests/hardening/global-setup.ts`**

```ts
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import type { TestProject } from 'vitest/node'
import type { HardeningContext } from '../support/hardening'
import { createSharedAuthKeys } from '../support/shared-auth'
import { assertTestDatabase, loadEnvFileOverride } from '../support/test-env'

const PORT = 3102
const ENTRY = '.output/server/index.mjs'
const LOG_FILE = 'test-results/hardening-server.log'

async function waitForHealth(baseUrl: string, hasExited: () => boolean): Promise<void> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (hasExited()) throw new Error(`Production server exited early; see ${LOG_FILE}`)
    try {
      const res = await fetch(`${baseUrl}/api/health`)
      if (res.ok) return
    }
    catch {
      // not listening yet
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`Production server did not become healthy in 60s; see ${LOG_FILE}`)
}

export default async function setup(project: TestProject) {
  loadEnvFileOverride('.env.test')
  assertTestDatabase()
  if (!existsSync(ENTRY)) {
    throw new Error(`Missing ${ENTRY}. Run "npm run build:hardening" (CI: "npx nuxt build") first.`)
  }
  mkdirSync('test-results', { recursive: true })

  const keys = await createSharedAuthKeys()
  const cronSecret = process.env.CRON_SECRET ?? randomBytes(32).toString('hex')
  const appEncryptionKey = process.env.APP_ENCRYPTION_KEY ?? randomBytes(32).toString('base64')
  const baseUrl = `http://127.0.0.1:${PORT}`

  const logFd = openSync(LOG_FILE, 'w')
  const child = spawn(process.execPath, [ENTRY], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(PORT),
      // AUTH_TEST_JWKS is only refused when VERCEL_ENV=production, which is never set here.
      AUTH_TEST_JWKS: keys.jwksJson,
      CRON_SECRET: cronSecret,
      APP_ENCRYPTION_KEY: appEncryptionKey,
    },
    stdio: ['ignore', logFd, logFd],
  })
  closeSync(logFd)

  let exited = false
  child.once('exit', () => {
    exited = true
  })
  try {
    await waitForHealth(baseUrl, () => exited)
  }
  catch (err) {
    child.kill('SIGTERM')
    throw err
  }

  const context: HardeningContext = { baseUrl, logFile: LOG_FILE, keys, cronSecret, appEncryptionKey }
  project.provide('hardening', context)

  return async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM')
      await new Promise(resolve => child.once('exit', resolve))
    }
  }
}
```

- [ ] **Step 7: Viết harness test thất bại**

`tests/hardening/harness.test.ts`:

```ts
import { afterAll, describe, expect, it } from 'vitest'
import { closeDb } from '../../server/db/client'
import { api, hardeningAuth, logSince } from '../support/hardening'

afterAll(async () => {
  await closeDb()
})

describe('hardening harness', () => {
  it('serves the production build and reports healthy', async () => {
    const res = await api('GET', '/api/health')
    expect(res).toMatchObject({ status: 200, body: { status: 'ok' } })
  })

  it('accepts tokens signed with the shared test key', async () => {
    const auth = await hardeningAuth()
    const token = await auth.sign({ sub: `user_harness_${Date.now()}`, email: `harness-${Date.now()}@example.com` })
    const me = await api('GET', '/api/me', { token })
    expect(me.status).toBe(200)
  })

  it('rejects the same token shape signed by a foreign key', async () => {
    const { createSharedAuth, createSharedAuthKeys } = await import('../support/shared-auth')
    const foreign = await createSharedAuth(await createSharedAuthKeys())
    const token = await foreign.sign({ sub: 'intruder', email: 'i@example.com' })
    expect((await api('GET', '/api/me', { token })).status).toBe(401)
  })

  it('writes server output to the shared log file', () => {
    expect(logSince(0).length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 8: Thêm project `hardening` vào `vitest.config.ts`**

Trước dòng `      await defineVitestProject({` chèn:

```ts
      {
        extends: true,
        test: {
          name: 'hardening',
          environment: 'node',
          include: ['tests/hardening/**/*.test.ts'],
          setupFiles: ['tests/setup/integration.ts'],
          globalSetup: ['tests/hardening/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
```

- [ ] **Step 9: Thêm scripts vào `package.json`**

Sau dòng `"test:e2e": "playwright test",` thêm:

```json
    "build:hardening": "nuxt build --dotenv .env.test",
    "test:hardening": "npm run build:hardening && vitest run --project hardening",
```

- [ ] **Step 10: Chạy unit test và harness**

Run: `npx vitest run --project unit tests/unit/support/shared-auth.test.ts && npm run test:hardening`
Expected: unit PASS; build xong; `hardening` project: 4 test PASS. Nếu `Missing .output/...` → build lỗi, đọc log build.

- [ ] **Step 11: Nối vào CI**

Trong `.github/workflows/ci.yml`, job `integration`, ngay sau dòng `      - run: npx vitest run --project api` thêm:

```yaml
      - run: npx nuxt build
      - run: npx vitest run --project hardening
      - name: Upload hardening server log
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: hardening-server-log
          path: test-results/hardening-server.log
```

(Biến `DATABASE_URL`, `NEON_AUTH_*` đã được export bởi bước "Export branch env" ở job này; `ZENO_TEST_DB`/`APP_BASE_URL` có ở `env` của job.)

- [ ] **Step 12: Commit**

```bash
git add tests/support/shared-auth.ts tests/support/hardening.ts tests/hardening tests/unit/support/shared-auth.test.ts vitest.config.ts package.json .github/workflows/ci.yml
git commit -m "test(hardening): run hardening suite against the production build

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Seed demo cho pilot + guard production

**Files:**
- Create: `server/services/demo/demo-store.ts`, `scripts/seed-pilot.ts`, `scripts/run-ts.mjs`
- Test: `tests/integration/demo-store.test.ts`, `tests/unit/server/demo-store-guard.test.ts`
- Modify: `package.json` (script + devDependency `jiti` 2.7.0)

**Interfaces:**
- Consumes: `Db` (`server/db/client.ts`); bảng `stores`, `categories`, `products`, `productOptionGroups`, `productOptionValues`, `storeTables`, `deliveryZones`; `generateToken()`, `hashToken()` (PR2); `createOrganizationWithStore(db, user: { userId, email, name }, { orgName, storeName, storeSlug })` (PR1); `findStoreAccess(db, userId, storeId)` (PR1); fixtures `createTenant` (PR1).
- Produces:
  - `assertSeedTarget(env: Record<string, string | undefined>, opts: { allowProduction: boolean }): void`
  - `class DemoStoreExistsError extends Error`
  - `interface DemoProduct { id: string; name: string; basePriceVnd: number; hasOptions: boolean; defaultOptionValueIds: string[]; defaultDeltaVnd: number }`
  - `interface DemoStoreResult { categoryIds: string[]; groupIds: string[]; products: DemoProduct[]; tables: { id: string; code: string; displayName: string; token: string }[]; zones: { id: string; name: string; feeVnd: number }[] }`
  - `seedDemoStore(db: Db, scope: { orgId: string; storeId: string }): Promise<DemoStoreResult>` — 8 món / 4 danh mục, 2 bàn `B01`,`B02`, 2 zone; bật 3 mode + nhận đơn; ném `DemoStoreExistsError` nếu store đã có món.
  - npm script `db:seed:pilot`.

- [ ] **Step 1: Xác nhận tên cột của schema catalog**

Run: `grep -nE "pgTable\(|notNull\(\)" server/db/schema/catalog.ts | head -60`
Expected: thấy các cột dùng trong code bên dưới. Nếu tên khác (vd `sortOrder` thay `position`) chỉnh đúng tên trong `demo-store.ts`; `npm run typecheck` ở Step 7 là phép kiểm.

- [ ] **Step 2: Viết unit test thất bại cho guard**

`tests/unit/server/demo-store-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { assertSeedTarget } from '../../../server/services/demo/demo-store'

describe('assertSeedTarget', () => {
  it('refuses when the branch is unknown', () => {
    expect(() => assertSeedTarget({}, { allowProduction: false })).toThrow(/NEON_BRANCH/)
  })

  it('allows any non-production branch', () => {
    expect(() => assertSeedTarget({ NEON_BRANCH: 'test' }, { allowProduction: false })).not.toThrow()
  })

  it('refuses production without the CLI flag', () => {
    expect(() => assertSeedTarget({ NEON_BRANCH: 'production', ZENO_ALLOW_PRODUCTION_SEED: '1' }, { allowProduction: false })).toThrow(/production/)
  })

  it('refuses production without the env flag', () => {
    expect(() => assertSeedTarget({ NEON_BRANCH: 'production' }, { allowProduction: true })).toThrow(/ZENO_ALLOW_PRODUCTION_SEED/)
  })

  it('allows production only with both flags', () => {
    expect(() => assertSeedTarget({ NEON_BRANCH: 'production', ZENO_ALLOW_PRODUCTION_SEED: '1' }, { allowProduction: true })).not.toThrow()
  })
})
```

- [ ] **Step 3: Viết integration test thất bại cho `seedDemoStore`**

`tests/integration/demo-store.test.ts`:

```ts
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { categories, deliveryZones, productOptionGroups, products, storeTables, stores } from '../../server/db/schema'
import { DemoStoreExistsError, seedDemoStore } from '../../server/services/demo/demo-store'
import { hashToken } from '../../server/utils/tokens'
import { resetDb } from '../support/db'
import { createTenant } from '../support/fixtures'

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('seedDemoStore', () => {
  it('creates 8 products in 4 categories, 2 tables and 2 zones, all scoped to the store', async () => {
    const a = await createTenant('seed')
    const result = await seedDemoStore(getDb(), { orgId: a.org.id, storeId: a.store.id })

    expect(result.products).toHaveLength(8)
    expect(result.categoryIds).toHaveLength(4)
    expect(result.tables.map(t => t.code)).toEqual(['B01', 'B02'])
    expect(result.zones).toHaveLength(2)

    const db = getDb()
    const rows = await db.select().from(products).where(eq(products.storeId, a.store.id))
    expect(rows).toHaveLength(8)
    expect(rows.every(r => r.orgId === a.org.id)).toBe(true)
    expect(await db.select().from(categories).where(eq(categories.storeId, a.store.id))).toHaveLength(4)
    expect(await db.select().from(deliveryZones).where(eq(deliveryZones.storeId, a.store.id))).toHaveLength(2)
  })

  it('stores only the hash of each table token', async () => {
    const a = await createTenant('seed')
    const result = await seedDemoStore(getDb(), { orgId: a.org.id, storeId: a.store.id })
    const [table] = result.tables
    const [row] = await getDb().select().from(storeTables)
      .where(and(eq(storeTables.storeId, a.store.id), eq(storeTables.code, table!.code)))
    expect(row!.tokenHash).toBe(hashToken(table!.token))
    expect(row!.tokenHash).not.toBe(table!.token)
  })

  it('gives the option product valid defaults for every required group', async () => {
    const a = await createTenant('seed')
    const result = await seedDemoStore(getDb(), { orgId: a.org.id, storeId: a.store.id })
    const withOptions = result.products.filter(p => p.hasOptions)
    expect(withOptions.length).toBeGreaterThanOrEqual(5)
    const groups = await getDb().select().from(productOptionGroups).where(eq(productOptionGroups.storeId, a.store.id))
    const requiredPerProduct = (id: string) => groups.filter(g => g.productId === id && g.required).length
    for (const product of withOptions) {
      expect(product.defaultOptionValueIds).toHaveLength(requiredPerProduct(product.id))
    }
  })

  it('turns on every fulfillment mode and order intake', async () => {
    const a = await createTenant('seed')
    await seedDemoStore(getDb(), { orgId: a.org.id, storeId: a.store.id })
    const [store] = await getDb().select().from(stores).where(eq(stores.id, a.store.id))
    expect(store).toMatchObject({ dineInEnabled: true, pickupEnabled: true, deliveryEnabled: true, isAcceptingOrders: true })
  })

  it('refuses to seed over an existing menu', async () => {
    const a = await createTenant('seed')
    await seedDemoStore(getDb(), { orgId: a.org.id, storeId: a.store.id })
    await expect(seedDemoStore(getDb(), { orgId: a.org.id, storeId: a.store.id })).rejects.toBeInstanceOf(DemoStoreExistsError)
    expect(await getDb().select().from(products).where(eq(products.storeId, a.store.id))).toHaveLength(8)
  })
})
```

- [ ] **Step 4: Chạy để thấy thất bại**

Run: `npx vitest run --project unit tests/unit/server/demo-store-guard.test.ts`
Expected: FAIL — cannot resolve `server/services/demo/demo-store`.

- [ ] **Step 5: Viết `server/services/demo/demo-store.ts`**

```ts
import { count, eq } from 'drizzle-orm'
import type { Db } from '../../db/client'
import {
  categories,
  deliveryZones,
  productOptionGroups,
  productOptionValues,
  products,
  storeTables,
  stores,
} from '../../db/schema'
import { generateToken, hashToken } from '../../utils/tokens'

export class DemoStoreExistsError extends Error {
  constructor() {
    super('Store đã có thực đơn; từ chối seed đè')
    this.name = 'DemoStoreExistsError'
  }
}

/** Production needs two independent switches so a stray `npm run` cannot write demo data into it. */
export function assertSeedTarget(env: Record<string, string | undefined>, opts: { allowProduction: boolean }): void {
  const branch = env.NEON_BRANCH
  if (!branch) throw new Error('NEON_BRANCH chưa đặt: không biết đang seed vào branch nào')
  if (branch !== 'production') return
  if (!opts.allowProduction) throw new Error('Đang trỏ vào branch production: cần cờ --production')
  if (env.ZENO_ALLOW_PRODUCTION_SEED !== '1') {
    throw new Error('Đang trỏ vào branch production: cần đặt ZENO_ALLOW_PRODUCTION_SEED=1')
  }
}

export interface DemoProduct {
  id: string
  name: string
  basePriceVnd: number
  hasOptions: boolean
  defaultOptionValueIds: string[]
  defaultDeltaVnd: number
}

export interface DemoStoreResult {
  categoryIds: string[]
  groupIds: string[]
  products: DemoProduct[]
  tables: { id: string, code: string, displayName: string, token: string }[]
  zones: { id: string, name: string, feeVnd: number }[]
}

interface ValueSpec { name: string, deltaVnd: number }
interface GroupSpec { name: string, min: number, max: number, required: boolean, values: ValueSpec[] }

const SIZE: GroupSpec = { name: 'Size', min: 1, max: 1, required: true, values: [{ name: 'M', deltaVnd: 0 }, { name: 'L', deltaVnd: 7000 }] }
const SUGAR: GroupSpec = {
  name: 'Mức đường',
  min: 1,
  max: 1,
  required: true,
  values: [{ name: '100%', deltaVnd: 0 }, { name: '70%', deltaVnd: 0 }, { name: '50%', deltaVnd: 0 }],
}
const TOPPING: GroupSpec = {
  name: 'Topping',
  min: 0,
  max: 2,
  required: false,
  values: [{ name: 'Trân châu', deltaVnd: 5000 }, { name: 'Pudding', deltaVnd: 7000 }, { name: 'Thạch dừa', deltaVnd: 5000 }],
}

const MENU: { category: string, items: { name: string, priceVnd: number, groups: GroupSpec[] }[] }[] = [
  {
    category: 'Trà sữa',
    items: [
      { name: 'Trà sữa trân châu', priceVnd: 35000, groups: [SIZE, SUGAR, TOPPING] },
      { name: 'Trà sữa matcha', priceVnd: 42000, groups: [SIZE, SUGAR, TOPPING] },
      { name: 'Hồng trà sữa', priceVnd: 32000, groups: [SIZE, SUGAR, TOPPING] },
    ],
  },
  {
    category: 'Trà trái cây',
    items: [
      { name: 'Trà đào cam sả', priceVnd: 38000, groups: [SIZE] },
      { name: 'Trà vải hoa hồng', priceVnd: 38000, groups: [SIZE] },
    ],
  },
  {
    category: 'Cà phê',
    items: [
      { name: 'Cà phê sữa đá', priceVnd: 29000, groups: [SIZE] },
      { name: 'Bạc xỉu', priceVnd: 32000, groups: [SIZE] },
    ],
  },
  { category: 'Đồ uống khác', items: [{ name: 'Nước suối', priceVnd: 12000, groups: [] }] },
]

export async function seedDemoStore(db: Db, scope: { orgId: string, storeId: string }): Promise<DemoStoreResult> {
  const { orgId, storeId } = scope
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ value: count() }).from(products).where(eq(products.storeId, storeId))
    if ((existing?.value ?? 0) > 0) throw new DemoStoreExistsError()

    const result: DemoStoreResult = { categoryIds: [], groupIds: [], products: [], tables: [], zones: [] }

    for (const [categoryIndex, entry] of MENU.entries()) {
      const [category] = await tx.insert(categories)
        .values({ orgId, storeId, name: entry.category, position: categoryIndex })
        .returning({ id: categories.id })
      result.categoryIds.push(category!.id)

      for (const [itemIndex, item] of entry.items.entries()) {
        const [product] = await tx.insert(products)
          .values({
            orgId,
            storeId,
            categoryId: category!.id,
            name: item.name,
            basePriceVnd: item.priceVnd,
            isAvailable: true,
            active: true,
            position: itemIndex,
          })
          .returning({ id: products.id })

        const defaults: string[] = []
        let defaultDeltaVnd = 0
        for (const [groupIndex, group] of item.groups.entries()) {
          const [row] = await tx.insert(productOptionGroups)
            .values({
              orgId,
              storeId,
              productId: product!.id,
              name: group.name,
              minSelect: group.min,
              maxSelect: group.max,
              required: group.required,
              position: groupIndex,
            })
            .returning({ id: productOptionGroups.id })
          result.groupIds.push(row!.id)

          for (const [valueIndex, value] of group.values.entries()) {
            const [valueRow] = await tx.insert(productOptionValues)
              .values({
                orgId,
                storeId,
                groupId: row!.id,
                name: value.name,
                priceDeltaVnd: value.deltaVnd,
                active: true,
                position: valueIndex,
              })
              .returning({ id: productOptionValues.id })
            if (group.required && valueIndex === 0) {
              defaults.push(valueRow!.id)
              defaultDeltaVnd += value.deltaVnd
            }
          }
        }

        result.products.push({
          id: product!.id,
          name: item.name,
          basePriceVnd: item.priceVnd,
          hasOptions: item.groups.length > 0,
          defaultOptionValueIds: defaults,
          defaultDeltaVnd,
        })
      }
    }

    for (const [index, code] of ['B01', 'B02'].entries()) {
      const token = generateToken()
      const displayName = `Bàn ${String(index + 1).padStart(2, '0')}`
      const [table] = await tx.insert(storeTables)
        .values({ orgId, storeId, code, displayName, tokenHash: hashToken(token), active: true })
        .returning({ id: storeTables.id })
      result.tables.push({ id: table!.id, code, displayName, token })
    }

    for (const [index, zone] of [{ name: 'Nội thành', feeVnd: 15000 }, { name: 'Ngoại thành', feeVnd: 25000 }].entries()) {
      const [row] = await tx.insert(deliveryZones)
        .values({ orgId, storeId, name: zone.name, feeVnd: zone.feeVnd, active: true, position: index })
        .returning({ id: deliveryZones.id })
      result.zones.push({ id: row!.id, ...zone })
    }

    await tx.update(stores)
      .set({ dineInEnabled: true, pickupEnabled: true, deliveryEnabled: true, isAcceptingOrders: true })
      .where(eq(stores.id, storeId))

    return result
  })
}
```

- [ ] **Step 6: Chạy unit + integration + typecheck**

Run: `npx vitest run --project unit tests/unit/server/demo-store-guard.test.ts && npm run test:integration -- demo-store && npm run typecheck`
Expected: guard 5 PASS; integration 5 PASS; typecheck sạch. Lỗi `Property 'x' does not exist` ở typecheck = tên cột khác Step 1: sửa trong `demo-store.ts`.

- [ ] **Step 7: Script CLI cho pilot**

Cài runner TS: `npm i -D -E jiti@2.7.0`. Tạo `scripts/run-ts.mjs`:

```js
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'

const [file, ...args] = process.argv.slice(2)
if (!file) {
  console.error('Usage: node scripts/run-ts.mjs <file.ts> [args]')
  process.exit(2)
}

const jiti = createJiti(import.meta.url, {
  alias: { '#shared': fileURLToPath(new URL('../shared', import.meta.url)) },
})
process.argv = [process.argv[0], resolve(file), ...args]
await jiti.import(resolve(file))
```

Tạo `scripts/seed-pilot.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs'
import { parseArgs, parseEnv } from 'node:util'
import { eq } from 'drizzle-orm'
import { closeDb, getDb } from '../server/db/client'
import { stores, userProfiles } from '../server/db/schema'
import { findStoreAccess } from '../server/repositories/membership'
import { assertSeedTarget, DemoStoreExistsError, seedDemoStore } from '../server/services/demo/demo-store'
import { createOrganizationWithStore } from '../server/services/identity/onboarding'

const envFile = process.env.ENV_FILE ?? '.env'
if (existsSync(envFile)) Object.assign(process.env, parseEnv(readFileSync(envFile, 'utf8')))

const { values } = parseArgs({
  options: {
    'owner-email': { type: 'string' },
    slug: { type: 'string' },
    'org-name': { type: 'string' },
    'store-name': { type: 'string' },
    production: { type: 'boolean', default: false },
  },
})

function fail(message: string): never {
  console.error(`✗ ${message}`)
  process.exit(1)
}

const email = values['owner-email']?.toLowerCase()
const slug = values.slug
if (!email || !slug) {
  fail('Usage: npm run db:seed:pilot -- --owner-email <email> --slug <slug> [--org-name "…" --store-name "…"] [--production]')
}

try {
  assertSeedTarget(process.env, { allowProduction: values.production })
}
catch (err) {
  fail((err as Error).message)
}

const db = getDb()
try {
  const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.email, email))
  if (!profile) fail(`Chưa có profile cho ${email}: chủ quán phải đăng ký và đăng nhập app một lần trước.`)

  let [store] = await db.select().from(stores).where(eq(stores.slug, slug))
  if (store) {
    const access = await findStoreAccess(db, profile.userId, store.id)
    if (access?.role !== 'OWNER') fail(`${email} không phải OWNER của store "${slug}"`)
  }
  else {
    await createOrganizationWithStore(
      db,
      { userId: profile.userId, email: profile.email, name: profile.displayName },
      { orgName: values['org-name'] ?? `${slug} Group`, storeName: values['store-name'] ?? slug, storeSlug: slug },
    )
    ;[store] = await db.select().from(stores).where(eq(stores.slug, slug))
  }

  const demo = await seedDemoStore(db, { orgId: store!.orgId, storeId: store!.id })
  const base = process.env.APP_BASE_URL ?? 'http://localhost:3000'
  console.log(`✓ Seed xong trên branch ${process.env.NEON_BRANCH}: ${demo.products.length} món, ${demo.tables.length} bàn, ${demo.zones.length} khu vực giao`)
  console.log(`  Link chung : ${base}/s/${slug}`)
  for (const table of demo.tables) console.log(`  ${table.displayName.padEnd(7)}: ${base}/s/${slug}?t=${table.token}`)
  console.log('  (Link bàn chỉ hiện một lần; in QR ngay từ app, hoặc regenerate trong Cài đặt → Bàn & QR.)')
}
catch (err) {
  if (err instanceof DemoStoreExistsError) fail(err.message)
  throw err
}
finally {
  await closeDb()
}
```

Thêm vào `package.json` scripts (sau `db:check`):

```json
    "db:seed:pilot": "node scripts/run-ts.mjs scripts/seed-pilot.ts",
```

- [ ] **Step 8: Kiểm chứng guard và chạy thật trên branch `test`**

Run: `NEON_BRANCH=production npm run db:seed:pilot -- --owner-email x@example.com --slug x; echo "exit=$?"`
Expected: in `✗ Đang trỏ vào branch production: cần cờ --production`, `exit=1`, **không** có truy vấn DB.

Run (cần một owner đã đăng ký trên Neon Auth branch `test`, đã đăng nhập app một lần): `npm run db:seed:pilot -- --owner-email <email-owner-test> --slug pilot-demo`
Expected: `✓ Seed xong trên branch test: 8 món, 2 bàn, 2 khu vực giao` kèm 3 link; chạy lại lần 2 in `✗ Store đã có thực đơn; từ chối seed đè`.

- [ ] **Step 9: Commit**

```bash
git add server/services/demo scripts/seed-pilot.ts scripts/run-ts.mjs tests/integration/demo-store.test.ts tests/unit/server/demo-store-guard.test.ts package.json package-lock.json
git commit -m "feat(hardening): add pilot seed script with production guard

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Kiểm kê route + rule tĩnh (guard trước parse, scope khớp guard)

**Files:**
- Create: `tests/support/route-inventory.ts`, `tests/unit/support/route-inventory.test.ts`, `tests/unit/audit/route-guards.test.ts`
- Modify: `package.json` (script `test:audit`)

**Interfaces:**
- Consumes: cấu trúc `server/api/**` (tên file Nitro: `name.method.ts`, `[param]`, `[...]`).
- Produces:
  - `type RouteKind = 'public' | 'protected' | 'webhook' | 'internal' | 'system' | 'catchall'`
  - `type GuardRole = 'OWNER' | 'STAFF' | 'USER'`
  - `interface RouteEntry { method: string; template: string; file: string; kind: RouteKind; source: string }` (`method` là `GET|POST|PUT|PATCH|DELETE|ALL`, `template` như `/api/stores/:storeId/orders/:orderId/status`)
  - `fileToRoute(relFile: string): { method: string; template: string } | null`
  - `discoverRoutes(apiDir?: string): RouteEntry[]` — nếu file chỉ là `export { default } from './x.post'` thì `source` nối thêm nội dung file được re-export.
  - `guardInfo(source: string): { role: GuardRole; index: number } | null`, `firstBodyAccessIndex(source: string): number`

- [ ] **Step 1: Viết unit test thất bại cho `fileToRoute`**

`tests/unit/support/route-inventory.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { fileToRoute, guardInfo } from '../../support/route-inventory'

describe('fileToRoute', () => {
  it.each([
    ['me.get.ts', 'GET', '/api/me'],
    ['health.get.ts', 'GET', '/api/health'],
    ['organizations/index.post.ts', 'POST', '/api/organizations'],
    ['stores/[storeId]/index.patch.ts', 'PATCH', '/api/stores/:storeId'],
    ['stores/[storeId]/orders/[orderId]/status.patch.ts', 'PATCH', '/api/stores/:storeId/orders/:orderId/status'],
    ['webhooks/sepay/[key].post.ts', 'POST', '/api/webhooks/sepay/:key'],
    ['[...].ts', 'ALL', '/api/**'],
  ])('%s → %s %s', (file, method, template) => {
    expect(fileToRoute(file)).toEqual({ method, template })
  })

  it('ignores non-ts files', () => {
    expect(fileToRoute('README.md')).toBeNull()
  })
})

describe('guardInfo', () => {
  it('prefers the strongest guard and reports where the first one is called', () => {
    const source = 'const a = await requireStoreStaff(event, id)\nconst b = await requireStoreOwner(event, id)'
    expect(guardInfo(source)).toEqual({ role: 'OWNER', index: source.indexOf('requireStoreStaff') })
  })

  it('classifies requireUser as USER and no guard as null', () => {
    expect(guardInfo('await requireUser(event)')?.role).toBe('USER')
    expect(guardInfo('return { ok: true }')).toBeNull()
  })
})
```

- [ ] **Step 2: Chạy để thấy thất bại**

Run: `npx vitest run --project unit tests/unit/support/route-inventory.test.ts`
Expected: FAIL — cannot resolve `tests/support/route-inventory`.

- [ ] **Step 3: Viết `tests/support/route-inventory.ts`**

```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

export type RouteKind = 'public' | 'protected' | 'webhook' | 'internal' | 'system' | 'catchall'
export type GuardRole = 'OWNER' | 'STAFF' | 'USER'

export interface RouteEntry {
  method: string
  template: string
  file: string
  kind: RouteKind
  source: string
}

export function fileToRoute(relFile: string): { method: string, template: string } | null {
  const parts = relFile.split(/[\\/]/)
  const last = parts.pop()!
  const match = last.match(/^(.*?)(?:\.(get|post|put|patch|delete))?\.ts$/)
  if (!match) return null
  const [, name, method] = match
  const segments = [...parts]
  if (name !== 'index') segments.push(name!)
  const mapped = segments.map((segment) => {
    if (/^\[\.\.\.(.*)\]$/.test(segment)) return '**'
    const param = segment.match(/^\[(.+)\]$/)
    return param ? `:${param[1]}` : segment
  })
  return { method: (method ?? 'ALL').toUpperCase(), template: `/api${mapped.length ? `/${mapped.join('/')}` : ''}` }
}

function classify(template: string): RouteKind {
  if (template === '/api/**') return 'catchall'
  if (template === '/api/health') return 'system'
  if (template.startsWith('/api/public/')) return 'public'
  if (template.startsWith('/api/webhooks/')) return 'webhook'
  if (template.startsWith('/api/internal/')) return 'internal'
  return 'protected'
}

const REEXPORT = /export\s*\{\s*default\s*\}\s*from\s*'(\.\/[^']+)'/

function sourceWithReexports(file: string): string {
  const source = readFileSync(file, 'utf8')
  const target = source.match(REEXPORT)?.[1]
  if (!target) return source
  const resolved = join(dirname(file), `${target}.ts`)
  return existsSync(resolved) ? `${source}\n${readFileSync(resolved, 'utf8')}` : source
}

export function discoverRoutes(apiDir = 'server/api'): RouteEntry[] {
  const routes: RouteEntry[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      const route = fileToRoute(relative(apiDir, full))
      if (!route) continue
      routes.push({ ...route, file: full.split(sep).join('/'), kind: classify(route.template), source: sourceWithReexports(full) })
    }
  }
  walk(apiDir)
  return routes.sort((a, b) => `${a.template} ${a.method}`.localeCompare(`${b.template} ${b.method}`))
}

const GUARD = /\brequire(User|StoreStaff|StoreOwner|OrgOwner)\s*\(/g
const BODY_ACCESS = /\b(parseBody|parseQuery|readBody|readRawBody|getQuery)\s*\(/

export function guardInfo(source: string): { role: GuardRole, index: number } | null {
  const matches = [...source.matchAll(GUARD)]
  if (matches.length === 0) return null
  const names = matches.map(m => m[1])
  const role: GuardRole = names.some(n => n === 'StoreOwner' || n === 'OrgOwner')
    ? 'OWNER'
    : names.includes('StoreStaff') ? 'STAFF' : 'USER'
  return { role, index: matches[0]!.index! }
}

export function firstBodyAccessIndex(source: string): number {
  return source.search(BODY_ACCESS)
}
```

- [ ] **Step 4: Chạy unit test lại**

Run: `npx vitest run --project unit tests/unit/support/route-inventory.test.ts`
Expected: PASS (11 test).

- [ ] **Step 5: Viết audit tĩnh `tests/unit/audit/route-guards.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { discoverRoutes, firstBodyAccessIndex, guardInfo } from '../../support/route-inventory'

const routes = discoverRoutes()
const ofKind = (kind: string) => routes.filter(r => r.kind === kind)

describe('route inventory', () => {
  it('finds the PR1 routes and exactly one catch-all', () => {
    const keys = routes.map(r => `${r.method} ${r.template}`)
    expect(keys).toEqual(expect.arrayContaining([
      'GET /api/me',
      'POST /api/organizations',
      'GET /api/stores/:storeId',
      'PATCH /api/stores/:storeId',
      'GET /api/health',
    ]))
    expect(ofKind('catchall')).toHaveLength(1)
  })

  it('has no route file without an explicit method suffix (except the catch-all and cron routes, which accept GET and POST)', () => {
    expect(routes.filter(r => r.method === 'ALL' && r.kind !== 'catchall' && r.kind !== 'internal').map(r => r.file)).toEqual([])
  })

  it('wraps every handler in defineApiHandler so errors keep the { code, message } shape', () => {
    const missing = routes.filter(r => r.kind !== 'catchall' && !r.source.includes('defineApiHandler')).map(r => r.file)
    expect(missing).toEqual([])
  })
})

describe('protected routes', () => {
  it.each(ofKind('protected').map(r => [`${r.method} ${r.template}`, r] as const))('%s calls a guard', (_name, route) => {
    expect(guardInfo(route.source), `${route.file} không gọi requireUser/requireStoreStaff/requireStoreOwner/requireOrgOwner`).not.toBeNull()
  })

  it.each(ofKind('protected').map(r => [`${r.method} ${r.template}`, r] as const))('%s runs the guard before reading body/query', (_name, route) => {
    const guard = guardInfo(route.source)
    const body = firstBodyAccessIndex(route.source)
    if (guard && body !== -1) {
      expect(guard.index, `${route.file}: guard phải chạy trước parseBody/parseQuery`).toBeLessThan(body)
    }
  })

  it.each(ofKind('protected').map(r => [`${r.method} ${r.template}`, r] as const))('%s uses a guard that matches its scope parameter', (_name, route) => {
    if (route.template.includes(':storeId')) {
      expect(route.source, `${route.file} có :storeId nhưng không dùng requireStoreStaff/requireStoreOwner`).toMatch(/\brequireStore(Staff|Owner)\s*\(/)
    }
    else if (route.template.includes(':orgId')) {
      expect(route.source, `${route.file} có :orgId nhưng không dùng requireOrgOwner`).toMatch(/\brequireOrgOwner\s*\(/)
    }
  })
})

describe('public, webhook and internal routes', () => {
  it.each(ofKind('public').map(r => [`${r.method} ${r.template}`, r] as const))('%s never needs a user session', (_name, route) => {
    expect(route.source).not.toMatch(/\brequire(User|StoreStaff|StoreOwner|OrgOwner)\s*\(/)
  })

  it.each(ofKind('webhook').map(r => [`${r.method} ${r.template}`, r] as const))('%s verifies the raw body', (_name, route) => {
    expect(route.source, `${route.file} phải đọc readRawBody để xác thực HMAC`).toMatch(/\breadRawBody\s*\(/)
  })

  it.each(ofKind('internal').map(r => [`${r.method} ${r.template}`, r] as const))('%s authenticates with CRON_SECRET', (_name, route) => {
    expect(route.source, `${route.file} phải xác thực cron (assertCronRequest / CRON_SECRET)`).toMatch(/assertCronRequest|CRON_SECRET/)
  })
})
```

- [ ] **Step 6: Chạy audit**

Run: `npx vitest run --project unit tests/unit/audit/route-guards.test.ts`
Expected: PASS trên code đã merge PR0–PR6. Nếu ĐỎ ở `internal … xác thực cron`, route cron đó chưa gọi `assertCronRequest` (helper của PR6, `server/utils/cron-auth.ts`) — đó là lỗ hổng thật; chỉ khi PR6 đổi tên helper mới sửa regex ở dòng `toMatch(/assertCronRequest|CRON_SECRET/)`. Mọi ĐỎ khác là **lỗi thật của route** (thiếu guard, đọc body trước guard, scope sai) → sửa route, không sửa test.

- [ ] **Step 7: Thêm script và commit**

Thêm vào `package.json` scripts: `"test:audit": "vitest run --project unit tests/unit/audit tests/unit/support tests/unit/ops",`

```bash
git add tests/support/route-inventory.ts tests/unit/support/route-inventory.test.ts tests/unit/audit/route-guards.test.ts package.json
git commit -m "test(hardening): audit every API route for guards and scope

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```


---

### Task 4: Access log có đường dẫn đã che token

**Files:**
- Create: `server/utils/access-log.ts`, `server/middleware/traffic-access-log.ts`, `tests/unit/server/access-log.test.ts`, `tests/hardening/access-log.test.ts`

**Interfaces:**
- Consumes: `safePath(raw: string): string` (`server/utils/safe-path.ts`, PR3: bỏ query, che token đơn/`/o/`/webhook key thành `[REDACTED]`), `redactPath(path: string): string` (`server/utils/redact-path.ts`, PR4: che `/api/invitations/<token>`, `/invite/<token>`), `logger` (PR0), middleware `request-id.ts` (PR0; chạy trước vì tên file xếp trước `traffic-*`).
- Produces:
  - `sanitizePath(rawPath: string): string` = `redactPath(safePath(rawPath))`
  - `shouldLogPath(rawPath: string): boolean` (bỏ asset tĩnh)
  - `buildAccessLog(input: { requestId: string | undefined; method: string; path: string; status: number; durationMs: number }): { level: 'info' | 'warn' | 'error'; msg: 'http.request'; ctx: { requestId?: string; method: string; path: string; status: number; durationMs: number } }`
  - Mỗi request không phải asset ghi đúng một dòng JSON `msg: "http.request"`; `status >= 500` → `error`, `>= 400` → `warn`, còn lại `info`. Đây là nguồn cho cảnh báo webhook `401/404` và cron `5xx` ở Task 13.

- [ ] **Step 1: Viết unit test thất bại**

`tests/unit/server/access-log.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildAccessLog, sanitizePath, shouldLogPath } from '../../../server/utils/access-log'

describe('sanitizePath', () => {
  it.each([
    '/api/public/orders/SECRETTOKEN123/payment?t=TABLETOKEN',
    '/o/SECRETTOKEN123?utm=1',
    '/api/invitations/SECRETTOKEN123/accept',
    '/invite/SECRETTOKEN123',
    '/api/webhooks/sepay/SECRETKEY123',
    '/s/quan-a?t=TABLETOKEN',
  ])('%s leaks no token and no query', (raw) => {
    const clean = sanitizePath(raw)
    expect(clean).not.toMatch(/SECRETTOKEN123|SECRETKEY123|TABLETOKEN|\?/)
  })

  it('keeps the route shape so alerts can group by path', () => {
    expect(sanitizePath('/api/health')).toBe('/api/health')
    expect(sanitizePath('/s/quan-a?t=x')).toBe('/s/quan-a')
  })
})

describe('shouldLogPath', () => {
  it.each([['/api/health', true], ['/s/quan-a', true], ['/o/abc', true], ['/_nuxt/entry.abc.js', false], ['/favicon.svg', false], ['/_fonts/x.woff2', false]])(
    '%s → %s',
    (path, expected) => {
      expect(shouldLogPath(path)).toBe(expected)
    },
  )
})

describe('buildAccessLog', () => {
  const base = { requestId: 'req-12345678', method: 'GET', path: '/api/health', durationMs: 12.6 }

  it.each([[200, 'info'], [302, 'info'], [401, 'warn'], [404, 'warn'], [429, 'warn'], [500, 'error'], [503, 'error']] as const)(
    'status %i → %s',
    (status, level) => {
      expect(buildAccessLog({ ...base, status }).level).toBe(level)
    },
  )

  it('rounds the duration and sanitizes the path', () => {
    const entry = buildAccessLog({ ...base, path: '/o/SECRETTOKEN123?x=1', status: 200 })
    expect(entry).toMatchObject({ msg: 'http.request', ctx: { requestId: 'req-12345678', method: 'GET', status: 200, durationMs: 13 } })
    expect(JSON.stringify(entry)).not.toContain('SECRETTOKEN123')
  })
})
```

- [ ] **Step 2: Chạy để thấy thất bại**

Run: `npx vitest run --project unit tests/unit/server/access-log.test.ts`
Expected: FAIL — cannot resolve `server/utils/access-log`.

- [ ] **Step 3: Viết `server/utils/access-log.ts`**

```ts
import { redactPath } from './redact-path'
import { safePath } from './safe-path'

export type AccessLogLevel = 'info' | 'warn' | 'error'

export interface AccessLogInput {
  requestId: string | undefined
  method: string
  path: string
  status: number
  durationMs: number
}

export function sanitizePath(rawPath: string): string {
  return redactPath(safePath(rawPath))
}

const STATIC_ASSET = /^\/(?:_nuxt|_fonts|_ipx|_icon|__)|\.[a-z0-9]{2,5}$/i

export function shouldLogPath(rawPath: string): boolean {
  return !STATIC_ASSET.test(rawPath.split('?')[0] ?? '')
}

export function buildAccessLog(input: AccessLogInput) {
  const level: AccessLogLevel = input.status >= 500 ? 'error' : input.status >= 400 ? 'warn' : 'info'
  return {
    level,
    msg: 'http.request' as const,
    ctx: {
      requestId: input.requestId,
      method: input.method,
      path: sanitizePath(input.path),
      status: input.status,
      durationMs: Math.round(input.durationMs),
    },
  }
}
```

- [ ] **Step 4: Viết middleware `server/middleware/traffic-access-log.ts`**

```ts
import { defineEventHandler } from 'h3'
import { buildAccessLog, shouldLogPath } from '../utils/access-log'
import { logger } from '../utils/logger'

export default defineEventHandler((event) => {
  if (!shouldLogPath(event.path)) return
  const started = performance.now()
  event.node.res.once('finish', () => {
    const entry = buildAccessLog({
      requestId: event.context.requestId,
      method: event.method,
      path: event.path,
      status: event.node.res.statusCode,
      durationMs: performance.now() - started,
    })
    logger[entry.level](entry.msg, entry.ctx)
  })
})
```

- [ ] **Step 5: Viết test hardening trên server thật**

`tests/hardening/access-log.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { api, waitForLog } from '../support/hardening'

function lineFor(text: string, requestId: string): string | undefined {
  return text.split('\n').find(line => line.includes(`"requestId":"${requestId}"`) && line.includes('"http.request"'))
}

describe('access log (production build)', () => {
  it('writes one structured line per request, carrying the request id', async () => {
    const requestId = `req-access-${Date.now()}`
    await api('GET', '/api/health', { headers: { 'x-request-id': requestId } })
    const entry = JSON.parse(lineFor(await waitForLog(text => lineFor(text, requestId) !== undefined), requestId)!)
    expect(entry).toMatchObject({ level: 'info', msg: 'http.request', method: 'GET', path: '/api/health', status: 200, requestId })
    expect(typeof entry.durationMs).toBe('number')
    expect(typeof entry.time).toBe('string')
  })

  it('never writes tokens or query strings (Review Focus 3)', async () => {
    const token = `TOKEN_${'a'.repeat(37)}`
    for (const [index, path] of [`/api/public/orders/${token}?t=TABLE_zzz`, `/o/${token}`, `/api/invitations/${token}`, `/api/webhooks/sepay/${token}`].entries()) {
      const requestId = `req-token-${Date.now()}-${index}`
      await api('GET', path, { headers: { 'x-request-id': requestId } })
      const line = lineFor(await waitForLog(text => lineFor(text, requestId) !== undefined), requestId)!
      expect(line, path).not.toContain(token)
      expect(line, path).not.toContain('TABLE_zzz')
      expect(JSON.parse(line).path).not.toContain('?')
    }
  })

  it('logs 4xx as warn so alerts can count rejected requests', async () => {
    const requestId = `req-warn-${Date.now()}`
    await api('GET', '/api/me', { headers: { 'x-request-id': requestId } })
    const entry = JSON.parse(lineFor(await waitForLog(text => lineFor(text, requestId) !== undefined), requestId)!)
    expect(entry).toMatchObject({ level: 'warn', status: 401 })
  })
})
```

- [ ] **Step 6: Chạy unit + hardening**

Run: `npx vitest run --project unit tests/unit/server/access-log.test.ts && npm run test:hardening -- access-log`
Expected: unit PASS; hardening 3 PASS. Nếu `requestId` thiếu trong dòng log → middleware chạy trước `request-id.ts`: đổi tên file thành tên xếp sau `request-id.ts` (giữ tiền tố `traffic-`).

- [ ] **Step 7: Commit**

```bash
git add server/utils/access-log.ts server/middleware/traffic-access-log.ts tests/unit/server/access-log.test.ts tests/hardening/access-log.test.ts
git commit -m "feat(hardening): add structured access log with token-safe paths

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Ma trận tenant tự sinh cho mọi route protected

**Files:**
- Create: `tests/support/canary.ts`, `tests/support/world.ts`, `tests/hardening/tenant-matrix.test.ts`
- Modify: `tests/support/route-inventory.ts` (thêm `fillTemplate`), `tests/unit/support/route-inventory.test.ts`

**Interfaces:**
- Consumes: `discoverRoutes`, `guardInfo`, `RouteEntry` (Task 3); `api`, `hardeningAuth` (Task 1); `seedDemoStore`, `DemoStoreResult` (Task 2); `createTenant`, `createStore`, `addStaff` (PR1 fixtures); `resetDb`; bảng `orders`.
- Produces:
  - `CANARY = { phone: '0987650123', address: 'Số 99 Hẻm Canary-PII-7f3a, Quận 1' }` (`tests/support/canary.ts`; dữ liệu PII cố định để mọi test và teardown quét log tìm chúng)
  - `fillTemplate(template: string, values: Record<string, string | undefined>): { path: string; resolved: boolean }` — thay `:param` bằng giá trị, tham số thiếu thành UUID ngẫu nhiên và `resolved = false`.
  - `type Actor = 'ownerA' | 'staffA1' | 'staffA2' | 'disabledA1' | 'ownerB'`
  - `interface PlacedOrder { id: string; publicCode: string; guestToken: string; requestBody: Record<string, unknown> }`
  - `interface TenantWorld { orgId: string; storeId: string; slug: string; demo: DemoStoreResult; ids: Record<string, string>; orders: { delivery: PlacedOrder; dineIn: PlacedOrder; pickup: PlacedOrder } }`
  - `interface World { tokens: Record<Actor, string>; a: TenantWorld; a2StoreId: string; b: TenantWorld }`
  - `checkoutBody(kind: 'pickup' | 'delivery' | 'dineIn', demo: DemoStoreResult, opts?: { quantity?: number }): Record<string, unknown>` (body hợp lệ theo PR3, `idempotencyKey` mới mỗi lần gọi)
  - `buildWorld(): Promise<World>` (gọi `resetDb()`).

- [ ] **Step 1: Thêm `fillTemplate` — test trước**

Thêm vào cuối `tests/unit/support/route-inventory.test.ts` (và sửa dòng import đầu file thành `import { fileToRoute, fillTemplate, guardInfo } from '../../support/route-inventory'`):

```ts
describe('fillTemplate', () => {
  it('substitutes known params and flags unresolved ones with random uuids', () => {
    const known = fillTemplate('/api/stores/:storeId/orders/:orderId', { storeId: 's1', orderId: 'o1' })
    expect(known).toEqual({ path: '/api/stores/s1/orders/o1', resolved: true })

    const partial = fillTemplate('/api/stores/:storeId/orders/:orderId', { storeId: 's1' })
    expect(partial.resolved).toBe(false)
    expect(partial.path).toMatch(/^\/api\/stores\/s1\/orders\/[0-9a-f-]{36}$/)
  })
})
```

Run: `npx vitest run --project unit tests/unit/support/route-inventory.test.ts`
Expected: FAIL — `fillTemplate is not a function`.

Thêm vào `tests/support/route-inventory.ts` (import `randomUUID` từ `node:crypto` ở đầu file):

```ts
import { randomUUID } from 'node:crypto'
```

```ts
export function fillTemplate(template: string, values: Record<string, string | undefined>): { path: string, resolved: boolean } {
  let resolved = true
  const path = template.replace(/:(\w+)/g, (_match, name: string) => {
    const value = values[name]
    if (value) return value
    resolved = false
    return randomUUID()
  })
  return { path, resolved }
}
```

Run lại: Expected PASS.

- [ ] **Step 2: Tạo `tests/support/canary.ts`**

```ts
/** Fixed PII planted in test data so any leak into a response, log line or bundle is found by value. */
export const CANARY = {
  phone: '0987650123',
  address: 'Số 99 Hẻm Canary-PII-7f3a, Quận 1',
} as const
```

- [ ] **Step 3: Tạo `tests/support/world.ts`**

```ts
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../../server/db/client'
import { orders } from '../../server/db/schema'
import { seedDemoStore, type DemoStoreResult } from '../../server/services/demo/demo-store'
import { CANARY } from './canary'
import { resetDb } from './db'
import { addStaff, createStore, createTenant } from './fixtures'
import { api, hardeningAuth } from './hardening'

export type Actor = 'ownerA' | 'staffA1' | 'staffA2' | 'disabledA1' | 'ownerB'

export interface PlacedOrder {
  id: string
  publicCode: string
  guestToken: string
  requestBody: Record<string, unknown>
}

export interface TenantWorld {
  orgId: string
  storeId: string
  slug: string
  demo: DemoStoreResult
  ids: Record<string, string>
  orders: { delivery: PlacedOrder, dineIn: PlacedOrder, pickup: PlacedOrder }
}

export interface World {
  tokens: Record<Actor, string>
  a: TenantWorld
  a2StoreId: string
  b: TenantWorld
}

export function checkoutBody(kind: 'pickup' | 'delivery' | 'dineIn', demo: DemoStoreResult, opts: { quantity?: number } = {}): Record<string, unknown> {
  const product = demo.products.find(p => p.hasOptions)!
  const quantity = opts.quantity ?? 2
  const unitPriceVnd = product.basePriceVnd + product.defaultDeltaVnd
  const deliveryFeeVnd = kind === 'delivery' ? demo.zones[0]!.feeVnd : 0
  const common = {
    idempotencyKey: randomUUID(),
    items: [{ productId: product.id, quantity, optionValueIds: product.defaultOptionValueIds, note: 'ít đá', expectedUnitPriceVnd: unitPriceVnd }],
    paymentMethod: 'PAY_ON_RECEIPT',
    expectedTotalVnd: unitPriceVnd * quantity + deliveryFeeVnd,
  }
  if (kind === 'dineIn') return { ...common, fulfillmentType: 'DINE_IN', tableToken: demo.tables[0]!.token }
  const customer = { name: 'Khách Canary', phone: CANARY.phone }
  if (kind === 'pickup') return { ...common, fulfillmentType: 'PICKUP', tableToken: null, customer }
  return {
    ...common,
    fulfillmentType: 'DELIVERY',
    tableToken: null,
    deliveryZoneId: demo.zones[0]!.id,
    customer: { ...customer, address: CANARY.address },
  }
}

async function placeOrder(tenant: { storeId: string, slug: string }, demo: DemoStoreResult, kind: 'pickup' | 'delivery' | 'dineIn'): Promise<PlacedOrder> {
  const requestBody = checkoutBody(kind, demo)
  const res = await api('POST', `/api/public/stores/${tenant.slug}/orders`, { body: requestBody })
  if (res.status >= 300) throw new Error(`placeOrder(${kind}) failed: ${res.status} ${res.text}`)
  const [row] = await getDb().select({ id: orders.id }).from(orders)
    .where(and(eq(orders.storeId, tenant.storeId), eq(orders.publicCode, res.body.publicCode)))
  return { id: row!.id, publicCode: res.body.publicCode, guestToken: res.body.guestToken, requestBody }
}

async function buildTenant(org: { id: string }, store: { id: string, slug: string }): Promise<TenantWorld> {
  const demo = await seedDemoStore(getDb(), { orgId: org.id, storeId: store.id })
  const placed = {
    delivery: await placeOrder({ storeId: store.id, slug: store.slug }, demo, 'delivery'),
    dineIn: await placeOrder({ storeId: store.id, slug: store.slug }, demo, 'dineIn'),
    pickup: await placeOrder({ storeId: store.id, slug: store.slug }, demo, 'pickup'),
  }
  const zoneId = demo.zones[0]!.id
  return {
    orgId: org.id,
    storeId: store.id,
    slug: store.slug,
    demo,
    orders: placed,
    ids: {
      categoryId: demo.categoryIds[0]!,
      productId: demo.products[0]!.id,
      groupId: demo.groupIds[0]!,
      optionGroupId: demo.groupIds[0]!,
      tableId: demo.tables[0]!.id,
      zoneId,
      deliveryZoneId: zoneId,
      orderId: placed.delivery.id,
    },
  }
}

export async function buildWorld(): Promise<World> {
  await resetDb()
  const auth = await hardeningAuth()
  const a = await createTenant('a1')
  const storeA2 = await createStore(a.org.id, 'a2')
  const b = await createTenant('b1')
  const staffA1 = await addStaff(a.store)
  const staffA2 = await addStaff(storeA2)
  const disabledA1 = await addStaff(a.store, { status: 'DISABLED' })
  const sign = (user: { userId: string, email: string }) => auth.sign({ sub: user.userId, email: user.email })

  return {
    tokens: {
      ownerA: await sign(a.owner),
      staffA1: await sign(staffA1),
      staffA2: await sign(staffA2),
      disabledA1: await sign(disabledA1),
      ownerB: await sign(b.owner),
    },
    a: await buildTenant(a.org, a.store),
    a2StoreId: storeA2.id,
    b: await buildTenant(b.org, b.store),
  }
}
```

- [ ] **Step 4: Viết test ma trận `tests/hardening/tenant-matrix.test.ts`**

```ts
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { api } from '../support/hardening'
import { discoverRoutes, fillTemplate, guardInfo, type RouteEntry } from '../support/route-inventory'
import { buildWorld, type Actor, type TenantWorld, type World } from '../support/world'

const PROTECTED = discoverRoutes().filter(r => r.kind === 'protected')
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const key = (r: RouteEntry) => `${r.method} ${r.template}`
const exercised = new Set<string>()
// Child-id params that buildWorld() fills with real rows; any other param becomes a random UUID.
const KNOWN_CHILD_PARAMS = new Set(['categoryId', 'productId', 'groupId', 'optionGroupId', 'tableId', 'zoneId', 'deliveryZoneId', 'orderId'])
let world: World
let before: string

type Scope = 'store' | 'org' | 'user'
const scopeOf = (template: string): Scope => template.includes(':storeId') ? 'store' : template.includes(':orgId') ? 'org' : 'user'
const valuesOf = (tenant: TenantWorld) => ({ storeId: tenant.storeId, orgId: tenant.orgId, ...tenant.ids })
const shape = (r: { status: number, body: unknown }) => ({ status: r.status, body: r.body })

function call(route: RouteEntry, path: string, actor: Actor | null) {
  return api(route.method, path, {
    token: actor ? world.tokens[actor] : null,
    body: MUTATING.has(route.method) ? {} : undefined,
  })
}

/** Digest of every table except the two that legitimately change on read (profile upsert, rate counters). */
async function snapshot(): Promise<string> {
  const db = getDb()
  const { rows } = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' and tablename not in ('rate_limits', 'user_profiles') order by tablename`,
  )
  const parts: string[] = []
  for (const { tablename } of rows) {
    const digest = await db.execute<{ digest: string }>(
      sql.raw(`select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as digest from "public"."${tablename}" t`),
    )
    parts.push(`${tablename}:${digest.rows[0]!.digest}`)
  }
  return parts.join('\n')
}

beforeAll(async () => {
  world = await buildWorld()
  before = await snapshot()
})

afterAll(async () => {
  await closeDb()
})

describe('inventory', () => {
  it('finds protected routes to exercise', () => {
    expect(PROTECTED.length).toBeGreaterThanOrEqual(5)
  })
})

describe.each(PROTECTED.map(r => [key(r), r] as const))('%s', (_name, route) => {
  const scope = scopeOf(route.template)
  const guard = guardInfo(route.source)!
  const childParams = [...route.template.matchAll(/:(\w+)/g)].map(m => m[1]!).filter(n => n !== 'storeId' && n !== 'orgId')

  it('anonymous → 401 UNAUTHENTICATED', async () => {
    exercised.add(key(route))
    const { path } = fillTemplate(route.template, valuesOf(world.a))
    const res = await call(route, path, null)
    expect(res).toMatchObject({ status: 401, body: { code: 'UNAUTHENTICATED' } })
  })

  it.skipIf(scope === 'user')('actors without access get the same 404 as a random id', async () => {
    const baseline = await call(route, fillTemplate(route.template, {}).path, 'ownerB')
    expect(baseline.status).toBe(404)
    const outsiders: Actor[] = scope === 'store' ? ['ownerB', 'staffA2', 'disabledA1'] : ['ownerB', 'staffA1', 'staffA2', 'disabledA1']
    for (const actor of outsiders) {
      const { path } = fillTemplate(route.template, valuesOf(world.a))
      const res = await call(route, path, actor)
      expect(shape(res), `${actor} on ${path}`).toEqual(shape(baseline))
    }
  })

  it.skipIf(scope !== 'store')('staff of the store is limited by the route role', async () => {
    const { path } = fillTemplate(route.template, valuesOf(world.a))
    const res = await call(route, path, 'staffA1')
    if (guard.role === 'OWNER') expect(res).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } })
    else expect([401, 403]).not.toContain(res.status)
  })

  it.skipIf(scope !== 'store' || !childParams.some(n => KNOWN_CHILD_PARAMS.has(n)))(
    'a real child id from another tenant is as invisible as a random one',
    async () => {
      const foreignChildren = (tenant: TenantWorld) => Object.fromEntries(childParams.filter(n => n in tenant.ids).map(n => [n, tenant.ids[n]!]))
      const cases: [Actor, TenantWorld, TenantWorld][] = [['ownerB', world.b, world.a], ['ownerA', world.a, world.b]]
      for (const [actor, own, other] of cases) {
        const baseline = await call(route, fillTemplate(route.template, { storeId: own.storeId }).path, actor)
        const { path } = fillTemplate(route.template, { storeId: own.storeId, ...foreignChildren(other) })
        const res = await call(route, path, actor)
        expect(shape(res), `${actor} on ${path}`).toEqual(shape(baseline))
        if (route.method === 'GET') expect(res.status).toBe(404)
      }
    },
  )

  it.skipIf(route.method !== 'GET')('the owner reaches own resources', async () => {
    const { path, resolved } = fillTemplate(route.template, valuesOf(world.a))
    const res = await call(route, path, 'ownerA')
    expect([401, 403]).not.toContain(res.status)
    if (resolved) expect(res.status, `${path} → ${JSON.stringify(res.body)}`).not.toBe(404)
  })

  it.skipIf(scope !== 'user' || route.method !== 'GET')('any signed-in actor passes authentication', async () => {
    const { path } = fillTemplate(route.template, {})
    for (const actor of Object.keys(world.tokens) as Actor[]) {
      expect((await call(route, path, actor)).status, actor).not.toBe(401)
    }
  })
})

describe('coverage and side effects', () => {
  it('exercised every protected route', () => {
    expect(PROTECTED.map(key).filter(k => !exercised.has(k))).toEqual([])
  })

  it('denial requests changed nothing in the database', async () => {
    expect(await snapshot()).toBe(before)
  })
})
```

- [ ] **Step 5: Chạy ma trận**

Run: `npm run test:hardening -- tenant-matrix`
Expected: toàn bộ PASS. Mọi ĐỎ là phát hiện thật: 
- `anonymous → 401` đỏ = route thiếu guard hoặc đọc body trước guard.
- `actors without access…` đỏ = route lộ khác biệt giữa store thật và UUID ngẫu nhiên (rò tồn tại tài nguyên) → sửa guard/service trả `404` đồng nhất.
- `denial requests changed nothing` đỏ = một request bị từ chối vẫn ghi DB → sửa route.
Không sửa test cho xanh.

- [ ] **Step 7: Commit**

```bash
git add tests/support/canary.ts tests/support/world.ts tests/support/route-inventory.ts tests/unit/support/route-inventory.test.ts tests/hardening/tenant-matrix.test.ts
git commit -m "test(hardening): generate a tenant matrix for every protected route

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: Quét rò PII/secret — response public, HTML, log, bundle

**Files:**
- Create: `tests/support/leak-scan.ts`, `tests/unit/support/leak-scan.test.ts`, `tests/hardening/public-leak.test.ts`, `tests/hardening/log-leak.test.ts`, `tests/hardening/bundle-secrets.test.ts`
- Modify: `tests/hardening/global-setup.ts` (quét log ở teardown)

**Interfaces:**
- Consumes: `discoverRoutes`, `fillTemplate` (Task 3, 5); `buildWorld`, `World`, `CANARY` (Task 5); `api`, `logSince`, `hardeningContext` (Task 1); `hashToken` (PR2).
- Produces:
  - `FORBIDDEN_PUBLIC_KEYS: RegExp` — khoá JSON không bao giờ được có trong response public (`orgId`, `phone`, `address`, `tokenHash`, `guestTokenEncrypted`, `encrypted*`, `hmacSecret`, `apiToken`, `webhookEndpointKey`, `secret*`, `userId`, …)
  - `findLeaks(value: unknown, opts: { forbiddenKeys?: RegExp; canaries: string[] }): string[]` (đi qua JSON, trả mô tả từng chỗ rò)
  - `findTextLeaks(text: string, canaries: string[]): string[]`
  - `SECRET_PATTERNS: { name: string; pattern: RegExp }[]` (JWT, connection string có mật khẩu, `Bearer …`, chữ ký `sha256=<64 hex>`), `findPatternLeaks(text: string): string[]`
  - `envCanaries(env?: NodeJS.ProcessEnv, extra?: string[]): string[]` — giá trị (≥ 8 ký tự) của `APP_ENCRYPTION_KEY`, `CRON_SECRET`, `AWS_SECRET_ACCESS_KEY`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED` và mật khẩu trong connection string.

- [ ] **Step 1: Viết unit test thất bại cho scanner (gồm ca âm tính)**

`tests/unit/support/leak-scan.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { envCanaries, findLeaks, findPatternLeaks, findTextLeaks } from '../../support/leak-scan'

describe('findLeaks', () => {
  it('finds forbidden keys at any depth', () => {
    const leaks = findLeaks({ order: { items: [{ customerPhone: 'x' }], orgId: 'o' } }, { canaries: [] })
    expect(leaks).toEqual(expect.arrayContaining([expect.stringContaining('customerPhone'), expect.stringContaining('orgId')]))
  })

  it('finds a canary value hidden inside a string or number', () => {
    const leaks = findLeaks({ note: 'gọi 0987650123 nhé', n: 987650123 }, { canaries: ['0987650123', '987650123'] })
    expect(leaks).toHaveLength(2)
  })

  it('passes a masked phone and unrelated keys', () => {
    expect(findLeaks({ phoneMasked: '*******123', store: { name: 'A', slug: 'a' } }, { canaries: ['0987650123'] })).toEqual([])
  })
})

describe('findTextLeaks / findPatternLeaks', () => {
  it('finds canaries in raw text and ignores short or empty canaries', () => {
    expect(findTextLeaks('addr=Canary-7f3a', ['Canary-7f3a', '', 'ab'])).toHaveLength(1)
  })

  it('detects JWTs, passworded connection strings, bearer tokens and HMAC signatures', () => {
    const jwt = 'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ1c2VyXzEifQ.c2lnbmF0dXJlYnl0ZXM'
    const text = `a ${jwt} b postgres://user:hunter2pw@host/db c Bearer abcdefghijklmnopqrstuvwxyz d sha256=${'a'.repeat(64)}`
    expect(findPatternLeaks(text)).toHaveLength(4)
    expect(findPatternLeaks('{"level":"info","msg":"http.request","path":"/api/health"}')).toEqual([])
  })
})

describe('envCanaries', () => {
  it('collects long secret values and the password inside a connection string', () => {
    const canaries = envCanaries({ CRON_SECRET: 'c'.repeat(40), DATABASE_URL: 'postgresql://u:pw-secret-123@h/db', APP_ENCRYPTION_KEY: 'short' })
    expect(canaries).toEqual(expect.arrayContaining(['c'.repeat(40), 'pw-secret-123']))
    expect(canaries).not.toContain('short')
  })
})
```

- [ ] **Step 2: Chạy để thấy thất bại**

Run: `npx vitest run --project unit tests/unit/support/leak-scan.test.ts`
Expected: FAIL — cannot resolve `tests/support/leak-scan`.

- [ ] **Step 3: Viết `tests/support/leak-scan.ts`**

```ts
export const FORBIDDEN_PUBLIC_KEYS = /^(orgId|org_id|customerPhone|customer_phone|phone|address|customerAddress|addressSnapshot|tokenHash|token_hash|guestTokenHash|guestTokenEncrypted|encrypted[A-Za-z]*|hmacSecret|apiToken|webhookEndpointKey|passwordHash|secret[A-Za-z]*|userId|actorUserId|createdBy|imageKey|idempotencyKey)$/i

export interface LeakOptions {
  forbiddenKeys?: RegExp
  canaries: string[]
}

const usable = (canary: string) => canary.length >= 3

export function findLeaks(value: unknown, { forbiddenKeys = FORBIDDEN_PUBLIC_KEYS, canaries }: LeakOptions): string[] {
  const leaks: string[] = []
  const visit = (node: unknown, at: string) => {
    if (typeof node === 'string' || typeof node === 'number') {
      const text = String(node)
      for (const canary of canaries.filter(usable)) {
        if (text.includes(canary)) leaks.push(`${at}: chứa canary "${canary.slice(0, 6)}…"`)
      }
    }
    else if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${at}[${index}]`))
    }
    else if (node && typeof node === 'object') {
      for (const [name, inner] of Object.entries(node)) {
        if (forbiddenKeys.test(name)) leaks.push(`${at}.${name}: khoá bị cấm`)
        visit(inner, `${at}.${name}`)
      }
    }
  }
  visit(value, '$')
  return leaks
}

export function findTextLeaks(text: string, canaries: string[]): string[] {
  return canaries.filter(usable).filter(canary => text.includes(canary)).map(canary => `chứa canary "${canary.slice(0, 6)}…"`)
}

export const SECRET_PATTERNS: { name: string, pattern: RegExp }[] = [
  { name: 'JWT', pattern: /eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/ },
  { name: 'connection string có mật khẩu', pattern: /postgres(?:ql)?:\/\/[^\s"'/]*:[^\s"'@/]+@/i },
  { name: 'Bearer token', pattern: /\bBearer\s+[\w.-]{20,}/i },
  { name: 'chữ ký HMAC', pattern: /sha256=[0-9a-f]{64}/i },
]

export function findPatternLeaks(text: string): string[] {
  return SECRET_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ name }) => `khớp mẫu ${name}`)
}

const SECRET_ENV_NAMES = ['APP_ENCRYPTION_KEY', 'CRON_SECRET', 'AWS_SECRET_ACCESS_KEY', 'DATABASE_URL', 'DATABASE_URL_UNPOOLED']

export function envCanaries(env: Record<string, string | undefined> = process.env, extra: string[] = []): string[] {
  const values: string[] = [...extra]
  for (const name of SECRET_ENV_NAMES) {
    const value = env[name]
    if (!value || value.length < 8) continue
    values.push(value)
    if (/^postgres(ql)?:\/\//i.test(value)) {
      try {
        const { password } = new URL(value)
        if (password) values.push(decodeURIComponent(password))
      }
      catch {
        // unparseable: the whole value is already a canary
      }
    }
  }
  return [...new Set(values.filter(v => v.length >= 8))]
}
```

- [ ] **Step 4: Chạy lại unit test**

Run: `npx vitest run --project unit tests/unit/support/leak-scan.test.ts`
Expected: PASS (6 test).

- [ ] **Step 5: Viết test quét response public và HTML**

`tests/hardening/public-leak.test.ts`:

```ts
import { createHash, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { orders } from '../../server/db/schema'
import { CANARY } from '../support/canary'
import { api, hardeningContext, type ApiResult } from '../support/hardening'
import { envCanaries, findLeaks, findPatternLeaks, findTextLeaks } from '../support/leak-scan'
import { discoverRoutes, fillTemplate, type RouteEntry } from '../support/route-inventory'
import { buildWorld, checkoutBody, type World } from '../support/world'

const PUBLIC = discoverRoutes().filter(r => r.kind === 'public')
let world: World
let canaries: string[]

beforeAll(async () => {
  world = await buildWorld()
  const [row] = await getDb().select().from(orders).where(eq(orders.id, world.a.orders.delivery.id))
  const sha = (value: string) => createHash('sha256').update(value).digest('hex')
  canaries = envCanaries(
    { ...process.env, APP_ENCRYPTION_KEY: hardeningContext().appEncryptionKey, CRON_SECRET: hardeningContext().cronSecret },
    [
      CANARY.phone,
      CANARY.address,
      world.a.orgId,
      world.b.orgId,
      world.a.storeId,
      sha(world.a.orders.delivery.guestToken),
      row!.guestTokenHash,
      row!.guestTokenEncrypted ?? '',
    ],
  )
})

afterAll(async () => {
  await closeDb()
})

function valuesFor(route: RouteEntry, real: boolean): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [, name] of route.template.matchAll(/:(\w+)/g)) {
    if (!real) values[name!] = randomUUID()
    else if (/token/i.test(name!)) values[name!] = world.a.orders.delivery.guestToken
    else if (name === 'slug') values[name] = world.a.slug
  }
  return values
}

function scan(label: string, res: ApiResult) {
  const headerText = [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n')
  expect(findLeaks(res.body, { canaries }), `${label} body`).toEqual([])
  expect(findTextLeaks(res.text, canaries), `${label} text`).toEqual([])
  expect(findTextLeaks(headerText, canaries), `${label} headers`).toEqual([])
  expect(findPatternLeaks(res.text), `${label} patterns`).toEqual([])
}

describe.each(PUBLIC.map(r => [`${r.method} ${r.template}`, r] as const))('%s', (_name, route) => {
  it('does not leak PII or secrets for a real resource', async () => {
    const { path } = fillTemplate(route.template, valuesFor(route, true))
    const query = route.template.endsWith('/fulfillment') ? `?t=${world.a.demo.tables[0]!.token}` : ''
    if (route.method === 'GET') {
      const res = await api('GET', `${path}${query}`)
      expect(res.status, `${path}${query}`).toBe(200)
      scan(`${route.method} ${path}`, res)
    }
    else if (/\/orders$/.test(route.template)) {
      const res = await api(route.method, path, { body: world.a.orders.delivery.requestBody })
      expect(res.status).toBe(200)
      scan(`${route.method} ${path}`, res)
    }
  })

  it('does not leak anything in its error responses', async () => {
    const { path } = fillTemplate(route.template, valuesFor(route, false))
    const res = await api(route.method, path, { body: route.method === 'GET' ? undefined : {} })
    expect(res.status).toBeGreaterThanOrEqual(400)
    scan(`${route.method} ${path} (error)`, res)
  })
})

describe('tracking view', () => {
  it('masks the phone down to its last 3 digits and never returns an address', async () => {
    const res = await api('GET', `/api/public/orders/${world.a.orders.delivery.guestToken}`)
    expect(res.status).toBe(200)
    expect(res.body.phoneMasked).toBe(`${'*'.repeat(CANARY.phone.length - 3)}${CANARY.phone.slice(-3)}`)
    expect(res.text).not.toContain(CANARY.address)
  })

  it('answers another tenant\'s token and a random token identically', async () => {
    const other = await api('GET', `/api/public/orders/${world.b.orders.delivery.guestToken.slice(0, -1)}x`)
    const random = await api('GET', `/api/public/orders/${randomUUID().replaceAll('-', '')}`)
    expect({ status: other.status, body: other.body }).toEqual({ status: random.status, body: random.body })
  })
})

describe('public tenant isolation', () => {
  it('a table token of another store never attaches a table and reveals no table name', async () => {
    const res = await api('GET', `/api/public/stores/${world.a.slug}/fulfillment?t=${world.b.demo.tables[0]!.token}`)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ tableError: 'INVALID_TABLE', table: null })
  })

  it('the menu of store A contains nothing of store B', async () => {
    const res = await api('GET', `/api/public/stores/${world.a.slug}/menu`)
    expect(res.status).toBe(200)
    const foreign = [world.b.slug, ...world.b.demo.products.map(p => p.id), ...world.b.demo.categoryIds]
    expect(findTextLeaks(res.text, foreign)).toEqual([])
  })

  it('checkout in store A cannot use a product or zone of store B', async () => {
    const body = checkoutBody('delivery', world.b.demo) as { items: { productId: string }[], deliveryZoneId: string }
    const res = await api('POST', `/api/public/stores/${world.a.slug}/orders`, { body })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
    expect(res.text).not.toContain(world.b.orgId)
  })
})

describe('server-rendered HTML', () => {
  it.each([
    ['menu page', () => `/s/${world.a.slug}`],
    ['tracking page', () => `/o/${world.a.orders.delivery.guestToken}`],
    ['dine-in link', () => `/s/${world.a.slug}?t=${world.a.demo.tables[0]!.token}`],
  ])('%s embeds no PII or secret in its payload', async (_label, path) => {
    const res = await api('GET', path())
    expect(res.status).toBe(200)
    expect(findTextLeaks(res.text, canaries)).toEqual([])
    expect(findPatternLeaks(res.text)).toEqual([])
  })
})
```

Ghi chú: `canaries` chứa `world.a.storeId` nên response public không được có `storeId`; chi tiết đơn công khai theo PR3 không trả `storeId`. Dòng `dine-in link`: token bàn nằm trong URL của chính request nên **không** nằm trong danh sách canary (chỉ kiểm HTML không chứa dữ liệu khách).

- [ ] **Step 6: Viết test quét log và thêm quét ở teardown**

`tests/hardening/log-leak.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb } from '../../server/db/client'
import { CANARY } from '../support/canary'
import { api, hardeningContext, logSince } from '../support/hardening'
import { envCanaries, findPatternLeaks, findTextLeaks } from '../support/leak-scan'
import { buildWorld, type World } from '../support/world'

let world: World

beforeAll(async () => {
  world = await buildWorld()
  // Traffic that carries canary PII through paths most likely to be logged on failure.
  await api('POST', `/api/public/stores/${world.a.slug}/orders`, { body: `{"customer":{"phone":"${CANARY.phone}","address":"${CANARY.address}"` })
  await api('POST', `/api/public/stores/${world.a.slug}/orders`, { body: { customer: { phone: CANARY.phone, address: CANARY.address }, items: [] } })
  await api('POST', '/api/webhooks/sepay/not-a-real-key', {
    body: JSON.stringify({ content: CANARY.address, accountNumber: CANARY.phone }),
    headers: { 'x-sepay-signature': `sha256=${'0'.repeat(64)}`, 'x-sepay-timestamp': String(Math.floor(Date.now() / 1000)) },
  })
  await api('GET', `/api/public/orders/${world.a.orders.delivery.guestToken}`)
  await api('GET', `/o/${world.a.orders.delivery.guestToken}`)
  await new Promise(resolve => setTimeout(resolve, 500))
})

afterAll(async () => {
  await closeDb()
})

describe('server log (production build)', () => {
  const log = () => logSince(0)

  it('contains no PII canary, guest token, session token or secret', () => {
    const secrets = envCanaries(
      { ...process.env, APP_ENCRYPTION_KEY: hardeningContext().appEncryptionKey, CRON_SECRET: hardeningContext().cronSecret },
      [
        CANARY.phone,
        CANARY.address,
        ...Object.values(world.tokens),
        ...[world.a, world.b].flatMap(t => Object.values(t.orders).map(o => o.guestToken)),
      ],
    )
    expect(findTextLeaks(log(), secrets)).toEqual([])
    expect(findPatternLeaks(log())).toEqual([])
  })

  it('writes only well-formed JSON lines from the application logger', () => {
    const jsonLines = log().split('\n').filter(line => line.startsWith('{'))
    expect(jsonLines.length).toBeGreaterThan(0)
    for (const line of jsonLines) {
      const entry = JSON.parse(line)
      expect(entry, line).toMatchObject({ level: expect.stringMatching(/^(info|warn|error)$/), msg: expect.any(String), time: expect.any(String) })
    }
  })

  it('records the rejected requests so the alert queries have data', () => {
    expect(log()).toMatch(/"msg":"http\.request"[^\n]*"status":40[14]/)
  })
})
```

Trong `tests/hardening/global-setup.ts`, thêm `readFileSync` vào dòng `import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs'` hiện có (đừng import `node:fs` hai lần) và thêm hai import sau, để quét log ở teardown (bắt rò từ **mọi** file test của lần chạy, không phụ thuộc thứ tự):

```ts
import { CANARY } from '../support/canary'
import { envCanaries, findPatternLeaks, findTextLeaks } from '../support/leak-scan'
```

và thay hàm teardown cuối `setup` bằng:

```ts
  return async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM')
      await new Promise(resolve => child.once('exit', resolve))
    }
    const log = readFileSync(LOG_FILE, 'utf8')
    const leaks = [
      ...findTextLeaks(log, envCanaries({ ...process.env, APP_ENCRYPTION_KEY: appEncryptionKey, CRON_SECRET: cronSecret }, [CANARY.phone, CANARY.address])),
      ...findPatternLeaks(log),
    ]
    if (leaks.length > 0) throw new Error(`Server log leaked sensitive data over the whole run: ${leaks.join('; ')}`)
  }
```

- [ ] **Step 7: Viết test quét bundle client**

`tests/hardening/bundle-secrets.test.ts`:

```ts
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { api, hardeningContext } from '../support/hardening'
import { envCanaries, findPatternLeaks, findTextLeaks } from '../support/leak-scan'

const PUBLIC_DIR = '.output/public'
const TEXT_FILE = /\.(js|mjs|css|html|json|txt|webmanifest|svg|map)$/i

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

describe('client bundle (.output/public)', () => {
  it('ships no secret value, connection string or token pattern', () => {
    expect(existsSync(PUBLIC_DIR), 'cần chạy build trước').toBe(true)
    const secrets = envCanaries({ ...process.env, APP_ENCRYPTION_KEY: hardeningContext().appEncryptionKey, CRON_SECRET: hardeningContext().cronSecret })
    const problems: string[] = []
    for (const file of walk(PUBLIC_DIR).filter(f => TEXT_FILE.test(f))) {
      const text = readFileSync(file, 'utf8')
      for (const leak of [...findTextLeaks(text, secrets), ...findPatternLeaks(text)]) problems.push(`${file}: ${leak}`)
    }
    expect(problems).toEqual([])
  })

  it('exposes no secret-looking key in the rendered runtime config', async () => {
    const res = await api('GET', '/')
    const config = res.text.match(/window\.__NUXT__\.config\s*=\s*(\{[\s\S]*?\})\s*<\/script>/)?.[1]
    expect(config, 'không tìm thấy runtimeConfig trong HTML; mở GET / để xem định dạng payload').toBeDefined()
    expect(config).not.toMatch(/secret|encryption|cron|password|hmac|database|aws_/i)
  })
})
```

- [ ] **Step 8: Chạy toàn bộ quét**

Run: `npm run test:hardening -- public-leak log-leak bundle-secrets`
Expected: PASS. Đỏ ở `public-leak` = route public trả khoá/giá trị cấm → sửa DTO của route (không nới `FORBIDDEN_PUBLIC_KEYS`). Đỏ ở log = tìm dòng log chứa canary bằng `grep -n "<canary>" test-results/hardening-server.log` và sửa chỗ log đó.

- [ ] **Step 9: Commit**

```bash
git add tests/support/leak-scan.ts tests/unit/support/leak-scan.test.ts tests/hardening/public-leak.test.ts tests/hardening/log-leak.test.ts tests/hardening/bundle-secrets.test.ts tests/hardening/global-setup.ts
git commit -m "test(hardening): scan public responses, logs and bundle for PII and secrets

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 7: Header bảo mật, CSP và chính sách cache

**Files:**
- Create: `server/utils/security-headers.ts`, `server/middleware/security-headers.ts`, `tests/unit/server/security-headers.test.ts`, `tests/hardening/security-headers.test.ts`

**Interfaces:**
- Consumes: Nitro middleware; handler PR2/PR3 tự đặt `Cache-Control` cho menu (`public, max-age=30, s-maxage=60`), fulfillment và tracking (`no-store`) — middleware chạy **trước** handler nên handler ghi đè được.
- Produces:
  - `interface SecurityHeaderOptions { production: boolean; https: boolean; authOrigin?: string }`
  - `originOf(url: string | undefined): string | undefined`
  - `buildCsp(options: SecurityHeaderOptions): string`
  - `buildSecurityHeaders(path: string, options: SecurityHeaderOptions): Record<string, string>` (khoá chữ thường)
  - Hợp đồng: mọi response có `x-content-type-options: nosniff`, `x-frame-options: DENY`, `permissions-policy`, `referrer-policy`; production thêm `content-security-policy`; production+https thêm `strict-transport-security`; `/api/**`, `/o/**`, `/invite/**`, `/app/**`, `/onboarding` mặc định `cache-control: no-store` + `x-robots-tag: noindex, nofollow`; `/o/**` và `/invite/**` dùng `referrer-policy: no-referrer`.

**Quyết định và đánh đổi (ghi vào `docs/operations.md` ở Task 16):** dùng middleware thay vì `routeRules` như roadmap gợi ý, vì CSP cần `NEON_AUTH_BASE_URL` lúc chạy và middleware cho handler ghi đè `Cache-Control`. CSP giữ `'unsafe-inline'` cho `script-src`/`style-src` vì Nuxt chèn script khởi tạo và colour-mode inline; bù bằng không dùng `v-html` (Task 8) và không `unsafe-eval`. `img-src` cho phép mọi `https:` để ảnh VietQR (`qr.sepay.vn`) và ảnh món (origin của Neon Storage) không bị chặn. Header chỉ áp lên response do Nitro phục vụ; file tĩnh `/_nuxt/**` do CDN Vercel phục vụ nên không có CSP — chấp nhận được vì không chứa dữ liệu.

- [ ] **Step 1: Viết unit test thất bại**

`tests/unit/server/security-headers.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildCsp, buildSecurityHeaders, originOf } from '../../../server/utils/security-headers'

const prod = { production: true, https: true, authOrigin: 'https://auth.example.neon.tech' }

describe('originOf', () => {
  it('reduces a URL to its origin and tolerates garbage', () => {
    expect(originOf('https://auth.example.neon.tech/neondb/auth')).toBe('https://auth.example.neon.tech')
    expect(originOf('not a url')).toBeUndefined()
    expect(originOf(undefined)).toBeUndefined()
  })
})

describe('buildCsp', () => {
  it('locks everything down except what the app needs', () => {
    const csp = buildCsp(prod)
    for (const directive of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"]) {
      expect(csp).toContain(directive)
    }
    expect(csp).not.toContain('unsafe-eval')
  })

  it('lets the browser reach Neon Auth and load VietQR and product images', () => {
    const csp = buildCsp(prod)
    expect(csp).toMatch(/connect-src 'self' https:\/\/auth\.example\.neon\.tech(;|$)/)
    expect(csp).toMatch(/img-src [^;]*\bhttps:/)
    expect(csp).toMatch(/font-src [^;]*'self'/)
  })

  it('upgrades insecure requests only on https deployments', () => {
    expect(buildCsp(prod)).toContain('upgrade-insecure-requests')
    expect(buildCsp({ ...prod, https: false })).not.toContain('upgrade-insecure-requests')
  })

  it('works without an auth origin', () => {
    expect(buildCsp({ production: true, https: true })).toContain("connect-src 'self';")
  })
})

describe('buildSecurityHeaders', () => {
  it('sets the baseline headers on every path', () => {
    const headers = buildSecurityHeaders('/s/quan-a', prod)
    expect(headers).toMatchObject({
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
    })
    expect(headers['permissions-policy']).toContain('camera=()')
    expect(headers['content-security-policy']).toBeDefined()
    expect(headers['cache-control']).toBeUndefined()
  })

  it.each(['/o/abc', '/invite/abc'])('%s never leaks its URL through Referer and is not indexed', (path) => {
    expect(buildSecurityHeaders(path, prod)).toMatchObject({
      'referrer-policy': 'no-referrer',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    })
  })

  it.each(['/api/me', '/api/public/orders/x', '/app', '/app/orders', '/onboarding'])('%s defaults to no-store + noindex', (path) => {
    expect(buildSecurityHeaders(path, prod)).toMatchObject({ 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' })
  })

  it('does not treat lookalike prefixes as private areas', () => {
    expect(buildSecurityHeaders('/application', prod)['cache-control']).toBeUndefined()
    expect(buildSecurityHeaders('/order-now', prod)['cache-control']).toBeUndefined()
  })

  it('omits CSP and HSTS outside production (the Vite dev server needs inline code and websockets)', () => {
    const headers = buildSecurityHeaders('/', { production: false, https: false })
    expect(headers['content-security-policy']).toBeUndefined()
    expect(headers['strict-transport-security']).toBeUndefined()
    expect(headers['x-content-type-options']).toBe('nosniff')
  })

  it('omits HSTS on plain http even in production', () => {
    expect(buildSecurityHeaders('/', { production: true, https: false })['strict-transport-security']).toBeUndefined()
  })
})
```

- [ ] **Step 2: Chạy để thấy thất bại**

Run: `npx vitest run --project unit tests/unit/server/security-headers.test.ts`
Expected: FAIL — cannot resolve `server/utils/security-headers`.

- [ ] **Step 3: Viết `server/utils/security-headers.ts`**

```ts
export interface SecurityHeaderOptions {
  production: boolean
  https: boolean
  authOrigin?: string
}

export function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).origin
  }
  catch {
    return undefined
  }
}

export function buildCsp({ authOrigin, https }: SecurityHeaderOptions): string {
  const connect = ["'self'", authOrigin].filter((value): value is string => Boolean(value))
  const directives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ]
  if (https) directives.push('upgrade-insecure-requests')
  return directives.join('; ')
}

const inArea = (path: string, area: string) => path === area || path.startsWith(`${area}/`)
const TOKEN_AREAS = ['/o', '/invite']
const PRIVATE_AREAS = ['/api', '/app', '/onboarding', ...TOKEN_AREAS]

export function buildSecurityHeaders(path: string, options: SecurityHeaderOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'referrer-policy': TOKEN_AREAS.some(area => inArea(path, area)) ? 'no-referrer' : 'strict-origin-when-cross-origin',
  }
  if (options.production) headers['content-security-policy'] = buildCsp(options)
  if (options.production && options.https) headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains'
  if (PRIVATE_AREAS.some(area => inArea(path, area))) {
    headers['cache-control'] = 'no-store'
    headers['x-robots-tag'] = 'noindex, nofollow'
  }
  return headers
}
```

- [ ] **Step 4: Chạy unit test lại**

Run: `npx vitest run --project unit tests/unit/server/security-headers.test.ts`
Expected: PASS.

- [ ] **Step 5: Middleware `server/middleware/security-headers.ts`**

```ts
import { defineEventHandler, setResponseHeader } from 'h3'
import { buildSecurityHeaders, originOf } from '../utils/security-headers'

export default defineEventHandler((event) => {
  const headers = buildSecurityHeaders(event.path.split('?')[0] ?? '/', {
    production: process.env.NODE_ENV === 'production',
    https: process.env.APP_BASE_URL?.startsWith('https://') ?? false,
    authOrigin: originOf(process.env.NEON_AUTH_BASE_URL),
  })
  for (const [name, value] of Object.entries(headers)) setResponseHeader(event, name, value)
})
```

- [ ] **Step 6: Viết test trên server production thật**

`tests/hardening/security-headers.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb } from '../../server/db/client'
import { api } from '../support/hardening'
import { buildWorld, type World } from '../support/world'

let world: World

beforeAll(async () => {
  world = await buildWorld()
})

afterAll(async () => {
  await closeDb()
})

describe.each([
  ['an API response', () => '/api/health'],
  ['the landing page', () => '/'],
  ['the public menu page', () => `/s/${world.a.slug}`],
  ['an unknown API path', () => '/api/does-not-exist'],
])('baseline headers on %s', (_label, path) => {
  it('has the security headers, a strict CSP and no CORS or fingerprint headers', async () => {
    const res = await api('GET', path(), { headers: { origin: 'https://evil.example' } })
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('referrer-policy')).toBeTruthy()
    expect(res.headers.get('permissions-policy')).toContain('camera=()')
    const csp = res.headers.get('content-security-policy') ?? ''
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).not.toContain('unsafe-eval')
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(res.headers.get('x-powered-by')).toBeNull()
  })
})

describe('private and token pages', () => {
  it('never caches or indexes the tracking page and sends no Referer', async () => {
    const res = await api('GET', `/o/${world.a.orders.delivery.guestToken}`)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-robots-tag')).toContain('noindex')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('never caches protected API responses', async () => {
    const res = await api('GET', '/api/me')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('never caches tracking or fulfillment responses', async () => {
    const tracking = await api('GET', `/api/public/orders/${world.a.orders.delivery.guestToken}`)
    expect(tracking.headers.get('cache-control')).toContain('no-store')
    const fulfillment = await api('GET', `/api/public/stores/${world.a.slug}/fulfillment`)
    expect(fulfillment.headers.get('cache-control')).toContain('no-store')
  })
})

describe('menu caching', () => {
  it('lets the CDN cache the public menu (the route overrides the API no-store default)', async () => {
    const res = await api('GET', `/api/public/stores/${world.a.slug}/menu`)
    expect(res.status).toBe(200)
    const cacheControl = res.headers.get('cache-control') ?? ''
    expect(cacheControl).toContain('s-maxage=')
    expect(cacheControl).not.toContain('no-store')
  })
})
```

- [ ] **Step 7: Chạy hardening**

Run: `npm run test:hardening -- security-headers`
Expected: PASS. Nếu `menu caching` đỏ vì `no-store` thắng: handler PR2 đặt header bằng cách khác `setResponseHeader` (vd trả `Response`) — sửa handler dùng `setResponseHeader(event, 'cache-control', …)` thay vì đổi test.

- [ ] **Step 8: Commit**

```bash
git add server/utils/security-headers.ts server/middleware/security-headers.ts tests/unit/server/security-headers.test.ts tests/hardening/security-headers.test.ts
git commit -m "feat(hardening): add security headers, CSP and private-area cache policy

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 8: Rule tĩnh XSS/CSRF/log và cổng `npm audit` cho runtime

**Files:**
- Create: `tests/unit/audit/source-rules.test.ts`, `scripts/lib/audit-filter.mjs`, `scripts/audit-runtime.mjs`, `tests/unit/ops/audit-filter.test.ts`
- Modify: `package.json` (script `audit:runtime`, nâng `zod`), `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: mã nguồn `app/**`, `server/**`, `nuxt.config.ts`; `npm audit --omit=dev --json`.
- Produces:
  - Rule test: không `v-html`/`innerHTML`/`document.write`/`eval`/`new Function` trong `app/**` (ngoại lệ có điều kiện cho `app/utils/qr.ts` nếu file đó dùng `escapeHtml(`); không cookie/session trong `server/**` (xác thực chỉ bằng Bearer ⇒ không có bề mặt CSRF); không `logger.*` nào nhận `rawBody`, `readRawBody`, `customerPhone`, `customerAddress`, `signature`, `hmac`, `authorization`, `guestToken`; `runtimeConfig.public` không có khoá giống secret.
  - `ALLOWLIST: { name: string; reason: string; reviewBy: string }[]`
  - `evaluateAudit(report: { vulnerabilities?: Record<string, { severity: string; isDirect?: boolean; via?: unknown[]; fixAvailable?: unknown }> }, opts: { allowlist: typeof ALLOWLIST; now?: Date; failOn?: string[] }): { ok: boolean; blocking: Finding[]; allowed: Finding[]; expired: Finding[] }`
  - `npm run audit:runtime` thoát `1` khi còn lỗ hổng high/critical không có trong allowlist còn hạn.

- [ ] **Step 1: Viết rule test**

`tests/unit/audit/source-rules.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function listFiles(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? listFiles(full, ext) : ext.test(name) ? [full] : []
  })
}

const read = (file: string) => readFileSync(file, 'utf8')
const appFiles = listFiles('app', /\.(vue|ts)$/)
const serverFiles = listFiles('server', /\.ts$/)

/** Source of `logger.x(...)` calls, with balanced parentheses. */
function loggerCalls(source: string): string[] {
  const calls: string[] = []
  for (const match of source.matchAll(/logger\.(?:info|warn|error)\(/g)) {
    let depth = 1
    let index = match.index! + match[0].length
    const start = index
    while (index < source.length && depth > 0) {
      if (source[index] === '(') depth++
      else if (source[index] === ')') depth--
      index++
    }
    calls.push(source.slice(start, index - 1))
  }
  return calls
}

function balancedBlock(text: string, openIndex: number): string {
  let depth = 0
  for (let index = openIndex; index < text.length; index++) {
    if (text[index] === '{') depth++
    else if (text[index] === '}' && --depth === 0) return text.slice(openIndex, index + 1)
  }
  return text.slice(openIndex)
}

describe('XSS surface', () => {
  const RAW_HTML = /v-html|\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write|\beval\s*\(|new Function\s*\(/
  // Files allowed to write HTML must escape every interpolated value first.
  const ESCAPED_ONLY = new Set(['app/utils/qr.ts'])

  it('app code never injects raw HTML', () => {
    const offenders = appFiles.filter(file => RAW_HTML.test(read(file)) && !(ESCAPED_ONLY.has(file) && /escapeHtml\(/.test(read(file))))
    expect(offenders, 'dữ liệu người dùng (tên món, ghi chú, địa chỉ) chỉ được render bằng {{ }}').toEqual([])
  })
})

describe('CSRF surface', () => {
  it('server code never reads or writes cookies or sessions (auth is Bearer-only)', () => {
    const offenders = serverFiles.filter(file => /\b(getCookie|parseCookies|setCookie|deleteCookie|useSession|getSession)\b/.test(read(file)))
    expect(offenders).toEqual([])
  })
})

describe('logging', () => {
  const BANNED = /\b(rawBody|readRawBody|customerPhone|customerAddress|signature|hmac|authorization|guestToken)\b/i

  it('no logger call receives PII, signatures, bodies or tokens', () => {
    const offenders = serverFiles.flatMap(file => loggerCalls(read(file)).filter(call => BANNED.test(call)).map(call => `${file}: ${call.slice(0, 80)}`))
    expect(offenders).toEqual([])
  })
})

describe('runtimeConfig.public', () => {
  it('has no key that looks like a secret', () => {
    const config = read('nuxt.config.ts')
    const start = config.indexOf('{', config.indexOf('public:'))
    expect(start).toBeGreaterThan(-1)
    const keys = [...balancedBlock(config, start).matchAll(/(\w+)\s*:/g)].map(m => m[1]!)
    expect(keys.filter(key => /secret|key|token|password|hmac|cron|encryption/i.test(key))).toEqual([])
  })
})
```

- [ ] **Step 2: Chạy rule test**

Run: `npx vitest run --project unit tests/unit/audit/source-rules.test.ts`
Expected: PASS. Đỏ = vi phạm thật: thay `v-html` bằng `{{ }}`, bỏ `logger` truyền dữ liệu nhạy cảm (chỉ log id/mã), v.v.

- [ ] **Step 3: Viết test thất bại cho bộ lọc audit**

`tests/unit/ops/audit-filter.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { evaluateAudit } from '../../../scripts/lib/audit-filter.mjs'

const report = {
  vulnerabilities: {
    zod: { severity: 'high', isDirect: true, via: [{ title: 'DoS' }], fixAvailable: true },
    '@nuxt/devtools': { severity: 'high', via: [{ title: 'x' }], fixAvailable: true },
    qs: { severity: 'moderate', via: [], fixAvailable: true },
  },
}
const now = new Date('2026-11-01T00:00:00Z')

describe('evaluateAudit', () => {
  it('blocks high/critical findings that are not allow-listed and ignores lower severities', () => {
    const result = evaluateAudit(report, { allowlist: [], now })
    expect(result.blocking.map(f => f.name).sort()).toEqual(['@nuxt/devtools', 'zod'])
    expect(result.ok).toBe(false)
  })

  it('accepts allow-listed findings until their review date', () => {
    const allowlist = [
      { name: '@nuxt/devtools', reason: 'dev only', reviewBy: '2027-01-01' },
      { name: 'zod', reason: 'accepted for test', reviewBy: '2027-01-01' },
    ]
    expect(evaluateAudit(report, { allowlist, now })).toMatchObject({ ok: true, blocking: [], expired: [] })
  })

  it('fails once an allow-list entry is past its review date', () => {
    const allowlist = [
      { name: '@nuxt/devtools', reason: 'dev only', reviewBy: '2026-10-01' },
      { name: 'zod', reason: 'accepted', reviewBy: '2027-01-01' },
    ]
    const result = evaluateAudit(report, { allowlist, now })
    expect(result.ok).toBe(false)
    expect(result.expired.map(f => f.name)).toEqual(['@nuxt/devtools'])
  })

  it('treats an empty report as clean', () => {
    expect(evaluateAudit({}, { allowlist: [], now }).ok).toBe(true)
  })
})
```

- [ ] **Step 4: Chạy để thấy thất bại**

Run: `npx vitest run --project unit tests/unit/ops/audit-filter.test.ts`
Expected: FAIL — cannot resolve `scripts/lib/audit-filter.mjs`.

- [ ] **Step 5: Viết bộ lọc và script**

`scripts/lib/audit-filter.mjs`:

```js
/**
 * Findings that `npm audit --omit=dev` reports only because `nuxt` sits in "dependencies".
 * Each entry must be confirmed build/dev-only (see docs/operations.md "Dependency audit") and expires.
 */
export const ALLOWLIST = [
  { name: '@nuxt/devtools', reason: 'Chỉ chạy trong `nuxt dev`; không có trong .output', reviewBy: '2027-01-31' },
  { name: 'launch-editor', reason: 'Phụ thuộc của @nuxt/devtools/vite dev server', reviewBy: '2027-01-31' },
  { name: 'simple-git', reason: 'Phụ thuộc của @nuxt/devtools', reviewBy: '2027-01-31' },
  { name: '@simple-git/argv-parser', reason: 'Phụ thuộc của simple-git (devtools)', reviewBy: '2027-01-31' },
  { name: 'shell-quote', reason: 'Phụ thuộc của launch-editor (devtools)', reviewBy: '2027-01-31' },
  { name: '@modelcontextprotocol/server', reason: 'Phụ thuộc của @eslint/config-inspector (lint), không chạy ở production', reviewBy: '2027-01-31' },
  { name: 'vite', reason: 'Chỉ dùng lúc build/dev; Nitro output không chứa Vite', reviewBy: '2027-01-31' },
  { name: 'happy-dom', reason: 'Chỉ dùng trong test (devDependency)', reviewBy: '2027-01-31' },
]

export function evaluateAudit(report, { allowlist, now = new Date(), failOn = ['high', 'critical'] }) {
  const blocking = []
  const allowed = []
  const expired = []
  for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
    if (!failOn.includes(vuln.severity)) continue
    const finding = {
      name,
      severity: vuln.severity,
      isDirect: Boolean(vuln.isDirect),
      title: vuln.via?.find(v => typeof v === 'object')?.title ?? '',
    }
    const entry = allowlist.find(item => item.name === name)
    if (!entry) blocking.push(finding)
    else if (new Date(entry.reviewBy) < now) expired.push({ ...finding, reviewBy: entry.reviewBy })
    else allowed.push({ ...finding, reason: entry.reason })
  }
  return { ok: blocking.length === 0 && expired.length === 0, blocking, allowed, expired }
}
```

`scripts/audit-runtime.mjs`:

```js
import { spawnSync } from 'node:child_process'
import { ALLOWLIST, evaluateAudit } from './lib/audit-filter.mjs'

const run = spawnSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
let report
try {
  report = JSON.parse(run.stdout)
}
catch {
  console.error('✗ Không đọc được kết quả `npm audit`:', run.stderr || run.stdout)
  process.exit(2)
}

const result = evaluateAudit(report, { allowlist: ALLOWLIST })
for (const f of result.allowed) console.log(`  ~ ${f.severity.padEnd(8)} ${f.name} (cho phép: ${f.reason})`)
for (const f of result.expired) console.error(`  ✗ allowlist HẾT HẠN ${f.reviewBy}: ${f.name}`)
for (const f of result.blocking) console.error(`  ✗ ${f.severity.padEnd(8)} ${f.name}${f.isDirect ? ' (trực tiếp)' : ''} — ${f.title}`)
console.log(result.ok ? '✓ Không có lỗ hổng high/critical ở runtime' : '✗ Còn lỗ hổng high/critical chưa xử lý')
process.exit(result.ok ? 0 : 1)
```

Thêm vào `package.json` scripts: `"audit:runtime": "node scripts/audit-runtime.mjs",`

- [ ] **Step 6: Chạy unit test rồi chạy cổng thật để xem hiện trạng**

Run: `npx vitest run --project unit tests/unit/ops/audit-filter.test.ts && npm run audit:runtime`
Expected: unit PASS. Cổng thật có thể ĐỎ — hiện trạng đã biết (2026-11-01) còn `zod` (trực tiếp), `devalue`, `undici`, `seroval`, `node-forge`, `brace-expansion`, `source-map-js`.

- [ ] **Step 7: Xử lý từng phát hiện — sửa thật hoặc chứng minh build-only**

Chạy theo thứ tự:

```bash
npm i -E zod@4.6.7          # bản vá cùng nhánh, pin chính xác
npm audit fix               # chỉ cập nhật package-lock.json cho các bản vá trong range
npm run build
for p in devalue undici seroval node-forge brace-expansion source-map-js; do
  if [ -d ".output/server/node_modules/$p" ]; then echo "SHIPPED   $p"; else echo "build-only $p"; fi
done
npm run audit:runtime
```

Với mỗi gói còn đỏ: nếu `SHIPPED` hoặc là thư viện bị bundle vào server/client (như `devalue`, dùng cho payload Nuxt) → **phải nâng cấp** (`npm explain <gói>` để biết cha; thêm khoá `overrides` trong `package.json` với phiên bản đã vá, pin chính xác) rồi build lại. Nếu `build-only` → thêm đúng một dòng vào `ALLOWLIST` với `reason` nêu đường phụ thuộc từ `npm explain` và `reviewBy` ≤ 90 ngày. Không thêm gói `SHIPPED` vào allowlist.

Expected cuối: `npm run audit:runtime` in `✓ Không có lỗ hổng high/critical ở runtime`.

- [ ] **Step 8: Nối vào CI**

Trong `.github/workflows/ci.yml`, job `checks`, sau `- run: npm ci` thêm:

```yaml
      - run: npm run audit:runtime
```

- [ ] **Step 9: Chạy lại toàn bộ test unit, rồi commit**

Run: `npm test`
Expected: PASS (nâng `zod` không làm hỏng schema).

```bash
git add tests/unit/audit/source-rules.test.ts tests/unit/ops/audit-filter.test.ts scripts/lib/audit-filter.mjs scripts/audit-runtime.mjs package.json package-lock.json .github/workflows/ci.yml
git commit -m "test(hardening): enforce XSS/CSRF/log rules and gate runtime dependency audit

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 9: Rate limit tập trung theo bảng policy

**Files:**
- Create: `server/utils/client-ip.ts`, `server/utils/rate-limit-policies.ts`, `server/utils/rate-limit-gate.ts`, `server/middleware/traffic-rate-limit.ts`, `tests/unit/server/client-ip.test.ts`, `tests/unit/server/rate-limit-policies.test.ts`, `tests/unit/server/rate-limit-gate.test.ts`, `tests/hardening/rate-limit.test.ts`
- Modify: `server/api/public/stores/[slug]/orders.post.ts` (PR3), `tests/api/public-ordering.test.ts` (PR3)

**Interfaces:**
- Consumes: `consumeRateLimit(db: DbOrTx, key: string, opts: { limit: number; windowSec: number; now?: Date }): Promise<boolean>` (PR3; `true` = còn hạn mức); `getDb`; `logger`; `AppError`/`toApiError` (PR0); `discoverRoutes` (Task 3); `checkoutBody`, `buildWorld` (Task 5); `createTenant`, `seedDemoStore`.
- Produces:
  - `clientIp(event: H3Event): string` — chỉ tin `x-vercel-forwarded-for`/`x-forwarded-for` khi `VERCEL=1` hoặc `TRUST_FORWARDED_FOR=1`; còn lại dùng địa chỉ socket.
  - `interface RatePolicy { id: string; methods: readonly string[]; pattern: RegExp; limit: number; windowSec: number; scope: 'ip' | 'token' }`
  - `RATE_POLICIES: readonly RatePolicy[]`; `matchPolicies(method: string, path: string): { policy: RatePolicy; subject: string | null }[]`; `rateLimitKey(policy: RatePolicy, subject: string): string` (băm sha256, không lưu IP/token thô).
  - `checkRateLimits(args: { method: string; path: string; ip: string; consume: (key: string, policy: RatePolicy) => Promise<boolean>; onError?: (err: unknown, policy: RatePolicy) => void }): Promise<RatePolicy | null>` — trả policy đầu tiên bị vượt; **fail-open** khi `consume` ném lỗi.
  - Middleware trả `429` `{ code: 'RATE_LIMITED', message }` + `Retry-After`, log `rate_limit.blocked` (`warn`) và `rate_limit.unavailable` (`warn`, khi fail-open).

**Bảng policy (khoá `rate_limits.key = rl:<policy.id>:<sha256(subject)[0..32)>`):**

| id | Route | Phạm vi | Hạn mức | Lý do |
|---|---|---|---|---|
| `checkout-ip` | `POST /api/public/stores/:slug/orders` | IP | 30 / 10 phút | trần ngoài; trần trong của PR3 là 10 đơn/10 phút/IP+store |
| `tracking-token` | `GET /api/public/orders/:token[/…]` | **token** | 40 / 1 phút | poll 4 s = 15/phút/tab; token A không ảnh hưởng token B dù chung Wi-Fi quán |
| `tracking-ip` | như trên | IP | 1200 / 5 phút | trần rất cao cho NAT của quán |
| `payment-repay` | `POST /api/public/orders/:token/payment-attempts` (PR5) | **token** | 20 / 10 phút | trần ngoài; PR5 đã có trần trong 10 lượt/10 phút/đơn |
| `public-menu` | `GET /api/public/stores/:slug/{menu,fulfillment}` | IP | 300 / 1 phút | CDN cache menu nên hiếm khi chạm |
| `public-page` | `GET /s/:slug`, `GET /o/:token` | IP | 600 / 1 phút | SSR tốn tài nguyên |
| `org-create` | `POST /api/organizations` | IP | 30 / 1 giờ | liền kề đăng ký (Neon Auth tự chống brute-force đăng nhập) |
| `invitation` | `GET/POST /api/invitations/:token[/accept]` | IP | 30 / 10 phút | chống dò token lời mời |
| `webhook` | `POST /api/webhooks/sepay/:key` | IP | 600 / 1 phút | trần ngoài cùng mức với `allowWebhookTraffic` của PR6; PR6 còn giới hạn 20 lỗi xác thực/10 phút/IP trong route |
| `internal` | `* /api/internal/**` | IP | 120 / 1 phút | cron và monitor; chặn dò `CRON_SECRET` |

- [ ] **Step 1: Viết unit test thất bại cho `clientIp`**

`tests/unit/server/client-ip.test.ts`:

```ts
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clientIp } from '../../../server/utils/client-ip'

function eventWith(headers: Record<string, string>, remote = '10.1.1.1') {
  const req = new IncomingMessage(new Socket())
  Object.defineProperty(req.socket, 'remoteAddress', { value: remote })
  req.method = 'GET'
  req.url = '/'
  req.headers = headers
  return createEvent(req, new ServerResponse(req))
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('clientIp', () => {
  it('ignores forwarded headers by default so they cannot be spoofed', () => {
    expect(clientIp(eventWith({ 'x-forwarded-for': '203.0.113.9', 'x-vercel-forwarded-for': '203.0.113.10' }))).toBe('10.1.1.1')
  })

  it('prefers x-vercel-forwarded-for on Vercel', () => {
    vi.stubEnv('VERCEL', '1')
    expect(clientIp(eventWith({ 'x-vercel-forwarded-for': '203.0.113.9, 70.1.1.1', 'x-forwarded-for': '1.2.3.4' }))).toBe('203.0.113.9')
  })

  it('falls back to the first x-forwarded-for entry on Vercel', () => {
    vi.stubEnv('VERCEL', '1')
    expect(clientIp(eventWith({ 'x-forwarded-for': '203.0.113.9, 70.1.1.1' }))).toBe('203.0.113.9')
  })

  it('honours forwarded headers when a test suite opts in', () => {
    vi.stubEnv('TRUST_FORWARDED_FOR', '1')
    expect(clientIp(eventWith({ 'x-forwarded-for': '198.51.100.7' }))).toBe('198.51.100.7')
  })

  it('never throws when the address is unknown', () => {
    expect(clientIp(eventWith({}, ''))).toBeTruthy()
  })
})
```

- [ ] **Step 2: Viết unit test thất bại cho bảng policy (gồm quét route thật)**

`tests/unit/server/rate-limit-policies.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { matchPolicies, rateLimitKey, RATE_POLICIES } from '../../../server/utils/rate-limit-policies'
import { discoverRoutes } from '../../support/route-inventory'

const ids = (method: string, path: string) => matchPolicies(method, path).map(m => m.policy.id).sort()

describe('matchPolicies', () => {
  it.each([
    ['POST', '/api/public/stores/quan-a/orders', ['checkout-ip']],
    ['GET', '/api/public/orders/TOKEN123', ['tracking-ip', 'tracking-token']],
    ['GET', '/api/public/orders/TOKEN123/payment', ['tracking-ip', 'tracking-token']],
    ['POST', '/api/public/orders/TOKEN123/payment-attempts', ['payment-repay']],
    ['GET', '/api/public/stores/quan-a/menu', ['public-menu']],
    ['GET', '/api/public/stores/quan-a/fulfillment', ['public-menu']],
    ['GET', '/s/quan-a', ['public-page']],
    ['GET', '/o/TOKEN123', ['public-page']],
    ['POST', '/api/organizations', ['org-create']],
    ['GET', '/api/invitations/TOKEN123', ['invitation']],
    ['POST', '/api/invitations/TOKEN123/accept', ['invitation']],
    ['POST', '/api/webhooks/sepay/KEY123', ['webhook']],
    ['GET', '/api/internal/status', ['internal']],
    ['POST', '/api/internal/reconcile-sepay', ['internal']],
    ['GET', '/api/me', []],
    ['GET', '/_nuxt/entry.js', []],
  ])('%s %s → %j', (method, path, expected) => {
    expect(ids(method, path)).toEqual(expected)
  })

  it('keys tracking by the token segment, not the IP', () => {
    const match = matchPolicies('GET', '/api/public/orders/TOKEN123/payment').find(m => m.policy.id === 'tracking-token')
    expect(match?.subject).toBe('TOKEN123')
  })
})

describe('rateLimitKey', () => {
  it('never stores the raw subject', () => {
    const key = rateLimitKey(RATE_POLICIES[0]!, '203.0.113.9')
    expect(key).toMatch(/^rl:[a-z-]+:[0-9a-f]{32}$/)
    expect(key).not.toContain('203.0.113.9')
  })
})

describe('coverage of real routes (Review Focus: public menu, checkout, webhook, auth-adjacent)', () => {
  const sample = (template: string) => template.replace(/:\w+/g, 'x')
  // Cron routes have no method suffix (method "ALL") and are called with GET by Vercel.
  const methodOf = (route: { method: string }) => route.method === 'ALL' ? 'GET' : route.method

  it('every public, webhook and internal route is covered by at least one policy', () => {
    const uncovered = discoverRoutes()
      .filter(r => ['public', 'webhook', 'internal'].includes(r.kind))
      .filter(r => matchPolicies(methodOf(r), sample(r.template)).length === 0)
      .map(r => `${r.method} ${r.template}`)
    expect(uncovered).toEqual([])
  })

  it('auth-adjacent routes that exist are covered', () => {
    const existing = discoverRoutes().map(r => `${r.method} ${r.template}`)
    for (const key of ['POST /api/organizations', 'GET /api/invitations/:token', 'POST /api/invitations/:token/accept']) {
      if (!existing.includes(key)) continue
      const [method, template] = key.split(' ') as [string, string]
      expect(matchPolicies(method, sample(template)).length, key).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 3: Viết unit test thất bại cho cổng**

`tests/unit/server/rate-limit-gate.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { checkRateLimits } from '../../../server/utils/rate-limit-gate'

function counter(limits: Record<string, number>) {
  const seen = new Map<string, number>()
  return vi.fn(async (key: string, policy: { id: string }) => {
    const count = (seen.get(key) ?? 0) + 1
    seen.set(key, count)
    return count <= (limits[policy.id] ?? Infinity)
  })
}

const call = (consume: ReturnType<typeof counter>, path: string, ip = '10.0.0.1', method = 'GET') =>
  checkRateLimits({ method, path, ip, consume })

describe('checkRateLimits', () => {
  it('lets unmatched paths through without touching the store', async () => {
    const consume = counter({})
    expect(await call(consume, '/api/me')).toBeNull()
    expect(consume).not.toHaveBeenCalled()
  })

  it('blocks a token after its own limit but not other tokens from the same ip (shared café Wi-Fi)', async () => {
    const consume = counter({ 'tracking-token': 2 })
    expect(await call(consume, '/api/public/orders/AAA')).toBeNull()
    expect(await call(consume, '/api/public/orders/AAA')).toBeNull()
    expect((await call(consume, '/api/public/orders/AAA'))?.id).toBe('tracking-token')
    expect(await call(consume, '/api/public/orders/BBB')).toBeNull()
  })

  it('applies the ip policy independently of the token policy', async () => {
    const consume = counter({ 'tracking-ip': 1 })
    expect(await call(consume, '/api/public/orders/AAA', '10.0.0.1')).toBeNull()
    expect((await call(consume, '/api/public/orders/BBB', '10.0.0.1'))?.id).toBe('tracking-ip')
    expect(await call(consume, '/api/public/orders/CCC', '10.0.0.2')).toBeNull()
  })

  it('fails open and reports when the counter store is unavailable', async () => {
    const onError = vi.fn()
    const result = await checkRateLimits({
      method: 'POST',
      path: '/api/webhooks/sepay/KEY',
      ip: '10.0.0.1',
      consume: async () => {
        throw new Error('db down')
      },
      onError,
    })
    expect(result).toBeNull()
    expect(onError).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 4: Chạy để thấy thất bại**

Run: `npx vitest run --project unit tests/unit/server/client-ip.test.ts tests/unit/server/rate-limit-policies.test.ts tests/unit/server/rate-limit-gate.test.ts`
Expected: FAIL — không resolve được 3 module.

- [ ] **Step 5: Viết `client-ip.ts`, `rate-limit-policies.ts`, `rate-limit-gate.ts`**

`server/utils/client-ip.ts`:

```ts
import { getHeader, getRequestIP, type H3Event } from 'h3'

/**
 * Forwarded headers are client-controlled unless a proxy that overwrites them sits in front (Vercel sets VERCEL=1),
 * so they are ignored everywhere else; tests that simulate many clients opt in with TRUST_FORWARDED_FOR=1.
 */
export function clientIp(event: H3Event): string {
  const trustForwarded = process.env.VERCEL === '1' || process.env.TRUST_FORWARDED_FOR === '1'
  if (trustForwarded) {
    const vercel = getHeader(event, 'x-vercel-forwarded-for')
    if (vercel) return vercel.split(',')[0]!.trim()
  }
  return getRequestIP(event, { xForwardedFor: trustForwarded }) || 'unknown'
}
```

`server/utils/rate-limit-policies.ts`:

```ts
import { createHash } from 'node:crypto'

export interface RatePolicy {
  id: string
  methods: readonly string[]
  pattern: RegExp
  limit: number
  windowSec: number
  scope: 'ip' | 'token'
}

const ANY = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
const TRACKING = /^\/api\/public\/orders\/([^/]+)(?:\/[^/]+)?$/

export const RATE_POLICIES: readonly RatePolicy[] = [
  { id: 'checkout-ip', methods: ['POST'], pattern: /^\/api\/public\/stores\/[^/]+\/orders$/, limit: 30, windowSec: 600, scope: 'ip' },
  { id: 'tracking-token', methods: ['GET'], pattern: TRACKING, limit: 40, windowSec: 60, scope: 'token' },
  { id: 'tracking-ip', methods: ['GET'], pattern: TRACKING, limit: 1200, windowSec: 300, scope: 'ip' },
  { id: 'payment-repay', methods: ['POST'], pattern: /^\/api\/public\/orders\/([^/]+)\/payment-attempts$/, limit: 20, windowSec: 600, scope: 'token' },
  { id: 'public-menu', methods: ['GET'], pattern: /^\/api\/public\/stores\/[^/]+\/(?:menu|fulfillment)$/, limit: 300, windowSec: 60, scope: 'ip' },
  { id: 'public-page', methods: ['GET'], pattern: /^\/(?:s|o)\/[^/]+\/?$/, limit: 600, windowSec: 60, scope: 'ip' },
  { id: 'org-create', methods: ['POST'], pattern: /^\/api\/organizations$/, limit: 30, windowSec: 3600, scope: 'ip' },
  { id: 'invitation', methods: ['GET', 'POST'], pattern: /^\/api\/invitations\/[^/]+(?:\/accept)?$/, limit: 30, windowSec: 600, scope: 'ip' },
  { id: 'webhook', methods: ['POST'], pattern: /^\/api\/webhooks\/sepay\/[^/]+$/, limit: 600, windowSec: 60, scope: 'ip' },
  { id: 'internal', methods: ANY, pattern: /^\/api\/internal\//, limit: 120, windowSec: 60, scope: 'ip' },
]

export function matchPolicies(method: string, path: string): { policy: RatePolicy, subject: string | null }[] {
  const matches: { policy: RatePolicy, subject: string | null }[] = []
  for (const policy of RATE_POLICIES) {
    if (!policy.methods.includes(method.toUpperCase())) continue
    const found = policy.pattern.exec(path)
    if (!found) continue
    matches.push({ policy, subject: policy.scope === 'token' ? (found[1] ?? null) : null })
  }
  return matches
}

export function rateLimitKey(policy: RatePolicy, subject: string): string {
  return `rl:${policy.id}:${createHash('sha256').update(subject).digest('hex').slice(0, 32)}`
}
```

`server/utils/rate-limit-gate.ts`:

```ts
import { matchPolicies, rateLimitKey, type RatePolicy } from './rate-limit-policies'

export interface RateLimitArgs {
  method: string
  path: string
  ip: string
  consume: (key: string, policy: RatePolicy) => Promise<boolean>
  onError?: (err: unknown, policy: RatePolicy) => void
}

export async function checkRateLimits({ method, path, ip, consume, onError }: RateLimitArgs): Promise<RatePolicy | null> {
  for (const { policy, subject } of matchPolicies(method, path)) {
    try {
      if (!(await consume(rateLimitKey(policy, subject ?? ip), policy))) return policy
    }
    catch (err) {
      // Availability beats throttling: a broken counter store must not take the shop offline.
      onError?.(err, policy)
    }
  }
  return null
}
```

- [ ] **Step 6: Middleware `server/middleware/traffic-rate-limit.ts`**

```ts
import { defineEventHandler, setResponseHeader, setResponseStatus } from 'h3'
import { getDb } from '../db/client'
import { consumeRateLimit } from '../services/ordering/rate-limit'
import { clientIp } from '../utils/client-ip'
import { logger } from '../utils/logger'
import { checkRateLimits } from '../utils/rate-limit-gate'

export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0] ?? '/'
  const blocked = await checkRateLimits({
    method: event.method,
    path,
    ip: clientIp(event),
    consume: (key, policy) => consumeRateLimit(getDb(), key, { limit: policy.limit, windowSec: policy.windowSec }),
    onError: (err, policy) => logger.warn('rate_limit.unavailable', { requestId: event.context.requestId, policy: policy.id, err }),
  })
  if (!blocked) return
  logger.warn('rate_limit.blocked', { requestId: event.context.requestId, policy: blocked.id })
  setResponseStatus(event, 429)
  setResponseHeader(event, 'retry-after', String(blocked.windowSec))
  setResponseHeader(event, 'cache-control', 'no-store')
  return { code: 'RATE_LIMITED', message: 'Bạn thao tác quá nhanh, vui lòng thử lại sau' }
})
```

- [ ] **Step 7: Chạy unit test**

Run: `npx vitest run --project unit tests/unit/server/client-ip.test.ts tests/unit/server/rate-limit-policies.test.ts tests/unit/server/rate-limit-gate.test.ts`
Expected: PASS. Nếu `every public, webhook and internal route is covered` đỏ: route mới chưa có policy — thêm policy vào `RATE_POLICIES` (kèm dòng trong bảng ở trên).

- [ ] **Step 8: Viết test hardening trên server thật (trước khi sửa route PR3)**

`tests/hardening/rate-limit.test.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { seedDemoStore, type DemoStoreResult } from '../../server/services/demo/demo-store'
import { resetDb } from '../support/db'
import { createTenant } from '../support/fixtures'
import { api } from '../support/hardening'
import { checkoutBody } from '../support/world'

let slug: string
let demo: DemoStoreResult

beforeAll(async () => {
  await resetDb()
  const tenant = await createTenant('rl')
  slug = tenant.store.slug
  demo = await seedDemoStore(getDb(), { orgId: tenant.org.id, storeId: tenant.store.id })
})

afterAll(async () => {
  await closeDb()
})

describe('tracking (shared café Wi-Fi)', () => {
  it('limits one token to 40/minute but leaves other tokens on the same ip untouched', async () => {
    const hot = randomUUID().replaceAll('-', '')
    const other = randomUUID().replaceAll('-', '')
    for (let i = 0; i < 40; i++) expect((await api('GET', `/api/public/orders/${hot}`)).status).toBe(404)
    const blocked = await api('GET', `/api/public/orders/${hot}`)
    expect(blocked).toMatchObject({ status: 429, body: { code: 'RATE_LIMITED' } })
    expect(blocked.headers.get('retry-after')).toBe('60')
    expect((await api('GET', `/api/public/orders/${other}`)).status).toBe(404)
  })
})

describe('checkout', () => {
  it('stops the 11th order from one client even when it spoofs a different x-forwarded-for each time', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      const res = await api('POST', `/api/public/stores/${slug}/orders`, {
        body: checkoutBody('pickup', demo),
        headers: { 'x-forwarded-for': `203.0.113.${i + 1}` },
      })
      statuses.push(res.status)
    }
    expect(statuses.slice(0, 10).every(s => s === 201)).toBe(true)
    expect(statuses[10]).toBe(429)
  })
})

describe('auth-adjacent and internal routes', () => {
  it('limits organization creation attempts per ip', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 31; i++) statuses.push((await api('POST', '/api/organizations', { body: {} })).status)
    expect(statuses.slice(0, 30).every(s => s === 401)).toBe(true)
    expect(statuses[30]).toBe(429)
  })

  it('limits probes of /api/internal per ip', async () => {
    await resetDb()
    const statuses: number[] = []
    for (let i = 0; i < 121; i++) statuses.push((await api('GET', '/api/internal/probe')).status)
    expect(statuses.slice(0, 120).every(s => s === 404)).toBe(true)
    expect(statuses[120]).toBe(429)
  })
})

describe('legitimate bursts are not throttled', () => {
  it('lets 30 customers on one Wi-Fi open the menu at the same time', async () => {
    await resetDb()
    const tenant = await createTenant('burst')
    await seedDemoStore(getDb(), { orgId: tenant.org.id, storeId: tenant.store.id })
    const results = await Promise.all(
      Array.from({ length: 30 }, () => api('GET', `/api/public/stores/${tenant.store.slug}/menu`)),
    )
    expect(results.map(r => r.status)).toEqual(Array.from({ length: 30 }, () => 200))
  })
})
```

Ghi chú: test `internal` gọi `resetDb()` giữa chừng để xoá bộ đếm của các test trước; test `checkout` cần `201` cho 10 đơn đầu nên cửa hàng được seed đủ mode (Task 2). Webhook SePay đã có giới hạn trong route (PR6: `allowWebhookTraffic` 600/phút/IP, `allowWebhookFailure` 20 lỗi xác thực/10 phút/IP) nên không thêm test dồn dập ở đây.

- [ ] **Step 9: Chạy để thấy đỏ ở đúng chỗ**

Run: `npm run test:hardening -- rate-limit`
Expected: `tracking`, `org-create`, `internal`, `menu burst` PASS; `checkout … spoofs` **FAIL** (đơn thứ 11 vẫn `201`) vì route PR3 tin `x-forwarded-for` vô điều kiện.

- [ ] **Step 10: Sửa route PR3 dùng `clientIp` và cho suite PR3 chọn tin XFF**

Trong `server/api/public/stores/[slug]/orders.post.ts`: xoá `getRequestIP` khỏi import `h3`, thêm `import { clientIp } from '../../../../utils/client-ip'`, và thay hai dòng

```ts
  // Vercel overwrites X-Forwarded-For with the real client address.
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? null
```

bằng:

```ts
  const ip = clientIp(event)
```

Trong `tests/api/public-ordering.test.ts`, ngay trước `await setup({`, thêm (suite này giả lập nhiều client bằng `x-forwarded-for`):

```ts
process.env.TRUST_FORWARDED_FOR = '1'
```

Tìm suite khác cũng giả lập IP: `grep -rln "x-forwarded-for" tests/api tests/hardening` — thêm dòng env tương tự cho từng file `tests/api/*` tìm thấy (không áp dụng cho `tests/hardening/rate-limit.test.ts`).

- [ ] **Step 11: Chạy lại**

Run: `npm run test:hardening -- rate-limit && npm run test:api -- public-ordering`
Expected: hardening PASS (đơn thứ 11 nhận `429`); `public-ordering` PASS (cờ `TRUST_FORWARDED_FOR` được server do `@nuxt/test-utils` spawn kế thừa; nếu test `429 on the 11th new order … while other ips still work` đỏ, xác nhận `process.env.TRUST_FORWARDED_FOR` được đặt **trước** `await setup`).

- [ ] **Step 12: Commit**

```bash
git add server/utils/client-ip.ts server/utils/rate-limit-policies.ts server/utils/rate-limit-gate.ts server/middleware/traffic-rate-limit.ts "server/api/public/stores/[slug]/orders.post.ts" tests/unit/server/client-ip.test.ts tests/unit/server/rate-limit-policies.test.ts tests/unit/server/rate-limit-gate.test.ts tests/hardening/rate-limit.test.ts tests/api
git commit -m "feat(hardening): centralise rate limits and stop trusting spoofable client ip

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 10: A11y, focus trap, CSP và vùng bấm — Playwright trên bản build production

**Files:**
- Create: `playwright.hardening.config.ts`, `tests/e2e-hardening/support/axe.ts`, `tests/e2e-hardening/support/csp.ts`, `tests/e2e-hardening/support/touch.ts`, `tests/e2e-hardening/support/owner.ts`, `tests/e2e-hardening/a11y.spec.ts`
- Modify: `package.json` (devDependency `@axe-core/playwright` 4.14.0, script `test:e2e:hardening`)

**Interfaces:**
- Consumes: bản build `.output/server/index.mjs` (chạy bằng `webServer`); fixtures PR3 `seedMenu(store)`, `openStore(storeId, patch?)`, `pickupBody(menu, over?)`, `seedCartJson(menu, quantity?)`, `SeededMenu` (`tests/support/checkout-fixtures.ts`); `createTenant` (PR1); luồng đăng ký/onboarding UI của PR1.
- Produces:
  - `expectNoA11yViolations(page: Page, label: string, include?: string): Promise<void>` (axe tags `wcag2a, wcag2aa, wcag21a, wcag21aa`)
  - `watchCsp(page: Page): Promise<void>`, `expectNoCspViolations(page: Page): Promise<void>` (bắt sự kiện `securitypolicyviolation`)
  - `expectTouchTargets(page: Page, scopeSelector: string): Promise<void>` (mọi `button`/`[role=button|radio|checkbox|switch|tab]` đang hiển thị cao ≥ 44px)
  - `signUpOwner(page: Page, stamp: string): Promise<{ slug: string }>`
  - Config chạy 3 project (`mobile-chrome`, `mobile-safari`, `desktop-chrome`) trên cổng 3103, mọi test đặt viewport 360×740.
  - npm script `test:e2e:hardening`.

**Hợp đồng selector (đối chiếu với UI PR2/PR3 trước khi chạy; nếu UI không thoả thì sửa component — đó chính là lỗi a11y cần sửa, không đổi test):**

| Thành phần | Selector dùng |
|---|---|
| Card món có option mở sheet | `getByRole('button', { name: /Trà sữa trân châu/ })` |
| Sheet (option, checkout) | `getByRole('dialog')` có tên truy cập khác rỗng |
| Thanh giỏ | `getByTestId('cart-bar')` (PR3) |
| Chọn hình thức nhận | `getByRole('radio', { name: 'Giao hàng' })` (PR3) |
| Trạng thái đơn trên `/o/:token` | `getByTestId('order-status')` (PR3) |
| Mã đơn trên board | text khớp `/#[2-9A-HJ-NP-Z]{6}/` |

- [ ] **Step 1: Cài thư viện và trình duyệt**

Run:

```bash
npm i -D -E @axe-core/playwright@4.14.0
npx playwright install chromium webkit
```

Expected: `package.json` có `"@axe-core/playwright": "4.14.0"` (không `^`).

- [ ] **Step 2: Thêm script**

Trong `package.json` scripts, sau `test:hardening` thêm:

```json
    "test:e2e:hardening": "npm run build:hardening && playwright test -c playwright.hardening.config.ts",
```

- [ ] **Step 3: Tạo `playwright.hardening.config.ts`**

```ts
import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

if (existsSync('.env.test')) process.loadEnvFile('.env.test')

const PORT = 3103

export default defineConfig({
  testDir: 'tests/e2e-hardening',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    // "localhost" (not 127.0.0.1) because Neon Auth trusts localhost origins for sign-up.
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
  },
  projects: [
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 14'] } },
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'node .output/server/index.mjs',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // "::" listens on IPv4 and IPv6 so both 127.0.0.1 and ::1 resolve "localhost".
    env: { NODE_ENV: 'production', HOST: '::', PORT: String(PORT), APP_BASE_URL: `http://localhost:${PORT}` },
  },
})
```

- [ ] **Step 4: Tạo helper**

`tests/e2e-hardening/support/axe.ts`:

```ts
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

export async function expectNoA11yViolations(page: Page, label: string, include?: string): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
  if (include) builder = builder.include(include)
  const { violations } = await builder.analyze()
  const summary = violations.map(v => `${v.id} (${v.impact}): ${v.nodes.length} node — ${v.nodes[0]?.target.join(' ')}`)
  expect(summary, `a11y violations on ${label}`).toEqual([])
}
```

`tests/e2e-hardening/support/csp.ts`:

```ts
import { expect, type Page } from '@playwright/test'

type CspWindow = Window & { __csp?: string[] }

export async function watchCsp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const target = window as CspWindow
    target.__csp = []
    document.addEventListener('securitypolicyviolation', (event) => {
      target.__csp!.push(`${event.violatedDirective} ${event.blockedURI}`)
    })
  })
}

export async function expectNoCspViolations(page: Page): Promise<void> {
  const violations = await page.evaluate(() => (window as CspWindow).__csp ?? [])
  expect(violations, 'CSP chặn tài nguyên hợp lệ').toEqual([])
}
```

`tests/e2e-hardening/support/touch.ts`:

```ts
import { expect, type Page } from '@playwright/test'

export async function expectTouchTargets(page: Page, scopeSelector: string): Promise<void> {
  const tooSmall = await page.locator(scopeSelector).first().evaluate((root) => {
    const targets = root.querySelectorAll<HTMLElement>('button, [role="button"], [role="radio"], [role="checkbox"], [role="switch"], [role="tab"]')
    return [...targets]
      .filter(el => el.getClientRects().length > 0)
      .map(el => ({
        name: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40),
        height: Math.round(el.getBoundingClientRect().height),
      }))
      .filter(target => target.height > 0 && target.height < 44)
  })
  expect(tooSmall, `vùng bấm < 44px trong ${scopeSelector}`).toEqual([])
}
```

`tests/e2e-hardening/support/owner.ts`:

```ts
import { expect, type Page } from '@playwright/test'

const PASSWORD = 'E2e-Password-123'

export async function signUpOwner(page: Page, stamp: string): Promise<{ slug: string }> {
  const slug = `a11y-${stamp}`
  await page.goto('/signup')
  await page.getByLabel('Tên của bạn').fill('Chủ Quán A11y')
  await page.getByLabel('Email').fill(`e2e+a11y-${stamp}@example.com`)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Tạo tài khoản' }).click()
  await expect(page).toHaveURL(/\/onboarding$/)
  await page.getByLabel('Tên doanh nghiệp').fill('A11y Group')
  await page.getByLabel('Tên cửa hàng').fill('Quán A11y')
  await page.getByLabel('Đường dẫn cửa hàng').fill(slug)
  await page.getByRole('button', { name: 'Tạo cửa hàng' }).click()
  await expect(page).toHaveURL(/\/app\/orders$/)
  return { slug }
}
```

- [ ] **Step 5: Viết spec `tests/e2e-hardening/a11y.spec.ts`**

```ts
import { expect, test, type Page } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { closeDb, getDb } from '../../server/db/client'
import { stores } from '../../server/db/schema'
import { openStore, pickupBody, seedCartJson, seedMenu, type SeededMenu } from '../support/checkout-fixtures'
import { createTenant } from '../support/fixtures'
import { expectNoA11yViolations } from './support/axe'
import { expectNoCspViolations, watchCsp } from './support/csp'
import { signUpOwner } from './support/owner'
import { expectTouchTargets } from './support/touch'

const insideDialog = (page: Page) => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))

async function expectFocusTrapped(page: Page) {
  await expect.poll(() => insideDialog(page)).toBe(true)
  for (let i = 1; i <= 30; i++) {
    await page.keyboard.press('Tab')
    expect(await insideDialog(page), `Tab #${i} rời khỏi dialog`).toBe(true)
  }
  for (let i = 1; i <= 5; i++) {
    await page.keyboard.press('Shift+Tab')
    expect(await insideDialog(page), `Shift+Tab #${i} rời khỏi dialog`).toBe(true)
  }
}

async function expectEveryFieldLabelled(dialog: ReturnType<Page['getByRole']>) {
  for (const field of await dialog.locator('input, textarea, select, [role="combobox"]').all()) {
    await expect(field).toHaveAccessibleName(/\S/)
  }
}

test.describe('public ordering pages', () => {
  let slug: string
  let menu: SeededMenu

  test.beforeAll(async () => {
    const tenant = await createTenant('a11y')
    await openStore(tenant.store.id, { deliveryEnabled: true })
    menu = await seedMenu(tenant.store)
    slug = tenant.store.slug
  })

  test.afterAll(async () => {
    await closeDb()
  })

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 })
    await watchCsp(page)
  })

  test('/s/:slug has no axe or CSP violations and one-hand-sized targets', async ({ page }) => {
    await page.goto(`/s/${slug}`)
    await expect(page.getByText(menu.tea.name).first()).toBeVisible()
    await expectNoA11yViolations(page, '/s/:slug')
    await expectTouchTargets(page, 'main')
    await expectNoCspViolations(page)
  })

  test('option sheet traps focus, is labelled and gives focus back on Escape', async ({ page }) => {
    await page.goto(`/s/${slug}`)
    const trigger = page.getByRole('button', { name: new RegExp(menu.tea.name) }).first()
    await trigger.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAccessibleName(/\S/)
    await expectFocusTrapped(page)
    await expectEveryFieldLabelled(dialog)
    await expectNoA11yViolations(page, 'option sheet')
    await expectTouchTargets(page, '[role="dialog"]')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
    await expectNoCspViolations(page)
  })

  test('checkout sheet labels every field in delivery mode and traps focus', async ({ page }) => {
    await page.goto(`/s/${slug}`)
    await page.evaluate(([key, value]) => localStorage.setItem(key!, value!), [`zeno:cart:${slug}`, seedCartJson(menu)])
    await page.reload()
    await page.getByTestId('cart-bar').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAccessibleName(/\S/)
    await page.getByRole('radio', { name: 'Giao hàng' }).click()
    await expectEveryFieldLabelled(dialog)
    await expectNoA11yViolations(page, 'checkout sheet')
    await expectTouchTargets(page, '[role="dialog"]')
    await expectFocusTrapped(page)
    await expectNoCspViolations(page)
  })

  test('/o/:token has no axe or CSP violations', async ({ page, request }) => {
    const res = await request.post(`/api/public/stores/${slug}/orders`, { data: pickupBody(menu) })
    expect(res.ok()).toBe(true)
    const { guestToken } = await res.json()
    await page.goto(`/o/${guestToken}`)
    await expect(page.getByTestId('order-status')).toBeVisible()
    await expectNoA11yViolations(page, '/o/:token')
    await expectTouchTargets(page, 'main')
    await expectNoCspViolations(page)
  })

  test('the menu also passes axe at desktop width', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'chỉ chạy ở project desktop')
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`/s/${slug}`)
    await expect(page.getByText(menu.tea.name).first()).toBeVisible()
    await expectNoA11yViolations(page, '/s/:slug (desktop)')
  })
})

test('/app/orders has no axe or CSP violations and labelled controls', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await watchCsp(page)
  const stamp = `${Date.now().toString(36)}${testInfo.project.name.slice(0, 1)}`
  const { slug } = await signUpOwner(page, stamp)

  const [store] = await getDb().select().from(stores).where(eq(stores.slug, slug))
  await openStore(store!.id, { deliveryEnabled: true })
  const menu = await seedMenu(store!)
  expect((await request.post(`/api/public/stores/${slug}/orders`, { data: pickupBody(menu) })).ok()).toBe(true)

  await page.goto('/app/orders')
  await expect(page.getByText(/#[2-9A-HJ-NP-Z]{6}/).first()).toBeVisible()
  await expectNoA11yViolations(page, '/app/orders')
  await expectTouchTargets(page, 'main')
  await expectNoCspViolations(page)
  await closeDb()
})
```

- [ ] **Step 6: Chạy**

Run: `npm run test:e2e:hardening -- a11y`
Expected: 3 project × 5–6 test PASS. Mỗi ĐỎ là một lỗi sản phẩm cần sửa trong component (không vô hiệu hoá rule axe, không giảm tag): `color-contrast` → chỉnh token màu trong `app/assets/css/main.css`; `label`/`button-name` → thêm `aria-label`/`<label>`; `Tab #n rời khỏi dialog` → bọc sheet bằng focus trap của Nuxt UI/Reka (`UDrawer` đã có; kiểm tra `ZSheet`); `CSP chặn` → sửa nguồn tài nguyên hoặc nới đúng một directive trong `buildCsp` kèm test ở Task 7.

- [ ] **Step 7: Commit**

```bash
git add playwright.hardening.config.ts tests/e2e-hardening package.json package-lock.json app
git commit -m "test(hardening): add axe, focus-trap, touch-target and CSP e2e on the production build

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 11: Hiệu năng — ảnh, JS, cache menu và ngân sách Lighthouse mobile

**Files:**
- Create: `tests/support/lighthouse-budget.ts`, `tests/unit/support/lighthouse-budget.test.ts`, `tests/e2e-hardening/perf.spec.ts`, `tests/e2e-hardening/lighthouse.spec.ts`
- Modify: `package.json` (devDependency `lighthouse` 13.6.0)

**Interfaces:**
- Consumes: `playwright.hardening.config.ts`, `seedMenu`, `openStore`, `createTenant`, bảng `products` (cột `imageKey`).
- Produces:
  - `MOBILE_BUDGET = { scores: { performance: 0.8, accessibility: 0.95, 'best-practices': 0.9 }, lcpMs: 3000, cls: 0.1, tbtMs: 300, totalBytes: 1_500_000 }`
  - `interface LhrLike { categories: Record<string, { score: number | null }>; audits: Record<string, { numericValue?: number }> }`
  - `evaluateLighthouse(lhr: LhrLike, budget?: typeof MOBILE_BUDGET): string[]` — danh sách vi phạm (rỗng = đạt).
  - Ngân sách JS `JS_BUDGET_BYTES = 450_000` (byte truyền, nén) cho `/s/:slug`.

- [ ] **Step 1: Cài Lighthouse**

Run: `npm i -D -E lighthouse@13.6.0`
Expected: `package.json` có `"lighthouse": "13.6.0"`.

- [ ] **Step 2: Viết unit test thất bại cho bộ đánh giá ngân sách**

`tests/unit/support/lighthouse-budget.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { evaluateLighthouse, MOBILE_BUDGET, type LhrLike } from '../../support/lighthouse-budget'

const good: LhrLike = {
  categories: { performance: { score: 0.92 }, accessibility: { score: 1 }, 'best-practices': { score: 1 } },
  audits: {
    'largest-contentful-paint': { numericValue: 2100 },
    'cumulative-layout-shift': { numericValue: 0.01 },
    'total-blocking-time': { numericValue: 80 },
    'total-byte-weight': { numericValue: 700_000 },
  },
}

describe('evaluateLighthouse', () => {
  it('passes a report inside the budget', () => {
    expect(evaluateLighthouse(good)).toEqual([])
  })

  it('names every metric that is over budget', () => {
    const bad: LhrLike = {
      categories: { performance: { score: 0.5 }, accessibility: { score: 0.9 }, 'best-practices': { score: 1 } },
      audits: {
        'largest-contentful-paint': { numericValue: 4200 },
        'cumulative-layout-shift': { numericValue: 0.4 },
        'total-blocking-time': { numericValue: 900 },
        'total-byte-weight': { numericValue: 2_000_000 },
      },
    }
    const problems = evaluateLighthouse(bad)
    expect(problems).toHaveLength(6)
    expect(problems.join('\n')).toMatch(/performance.*0\.5/)
    expect(problems.join('\n')).toMatch(/LCP.*4200/)
  })

  it('fails when a score or metric is missing instead of passing silently', () => {
    expect(evaluateLighthouse({ categories: {}, audits: {} }, MOBILE_BUDGET).length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 3: Chạy để thấy thất bại**

Run: `npx vitest run --project unit tests/unit/support/lighthouse-budget.test.ts`
Expected: FAIL — cannot resolve `tests/support/lighthouse-budget`.

- [ ] **Step 4: Viết `tests/support/lighthouse-budget.ts`**

```ts
export const MOBILE_BUDGET = {
  scores: { performance: 0.8, accessibility: 0.95, 'best-practices': 0.9 },
  lcpMs: 3000,
  cls: 0.1,
  tbtMs: 300,
  totalBytes: 1_500_000,
} as const

export interface LhrLike {
  categories: Record<string, { score: number | null }>
  audits: Record<string, { numericValue?: number }>
}

export function evaluateLighthouse(lhr: LhrLike, budget: typeof MOBILE_BUDGET = MOBILE_BUDGET): string[] {
  const problems: string[] = []
  for (const [name, min] of Object.entries(budget.scores)) {
    const score = lhr.categories[name]?.score
    if (score == null) problems.push(`${name}: không có điểm`)
    else if (score < min) problems.push(`${name}: ${score} < ${min}`)
  }
  const metric = (id: string, label: string, max: number) => {
    const value = lhr.audits[id]?.numericValue
    if (value == null) problems.push(`${label}: không có số liệu`)
    else if (value > max) problems.push(`${label}: ${Math.round(value * 1000) / 1000} > ${max}`)
  }
  metric('largest-contentful-paint', 'LCP (ms)', budget.lcpMs)
  metric('cumulative-layout-shift', 'CLS', budget.cls)
  metric('total-blocking-time', 'TBT (ms)', budget.tbtMs)
  metric('total-byte-weight', 'Tổng byte', budget.totalBytes)
  return problems
}
```

- [ ] **Step 5: Chạy lại unit test**

Run: `npx vitest run --project unit tests/unit/support/lighthouse-budget.test.ts`
Expected: PASS (3 test).

- [ ] **Step 6: Viết spec hiệu năng trình duyệt**

`tests/e2e-hardening/perf.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { eq, inArray } from 'drizzle-orm'
import { closeDb, getDb } from '../../server/db/client'
import { products } from '../../server/db/schema'
import { openStore, seedMenu, type SeededMenu } from '../support/checkout-fixtures'
import { createTenant } from '../support/fixtures'

const JS_BUDGET_BYTES = 450_000
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

let slug: string
let menu: SeededMenu

test.beforeAll(async () => {
  const tenant = await createTenant('perf')
  await openStore(tenant.store.id, { deliveryEnabled: true })
  menu = await seedMenu(tenant.store)
  slug = tenant.store.slug
  await getDb().update(products).set({ imageKey: `stores/${tenant.store.id}/products/test/perf.png` })
    .where(inArray(products.id, [menu.tea.id, menu.bread.id]))
})

test.afterAll(async () => {
  await getDb().update(products).set({ imageKey: null }).where(eq(products.id, menu.tea.id))
  await closeDb()
})

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  // Product images live on another origin; answer them locally so the test is offline-safe.
  await page.route(url => url.hostname !== 'localhost' && /\.(png|jpe?g|webp)(\?|$)/i.test(url.pathname), route =>
    route.fulfill({ contentType: 'image/png', body: PNG_1X1 }))
})

test('every menu image has intrinsic size, alt text and lazy loading below the fold', async ({ page }) => {
  await page.goto(`/s/${slug}`)
  await expect(page.getByText(menu.tea.name).first()).toBeVisible()
  const images = await page.locator('main img').evaluateAll(list => list.map(img => ({
    src: img.getAttribute('src'),
    width: Number(img.getAttribute('width')),
    height: Number(img.getAttribute('height')),
    alt: img.getAttribute('alt'),
    loading: img.getAttribute('loading'),
    top: img.getBoundingClientRect().top,
  })))
  expect(images.length, 'seed phải tạo ít nhất một ảnh món').toBeGreaterThan(0)
  for (const image of images) {
    expect(image.width > 0 && image.height > 0, `${image.src}: thiếu width/height (gây layout shift)`).toBe(true)
    expect(image.alt, `${image.src}: thiếu thuộc tính alt`).not.toBeNull()
    if (image.top > 740) expect(image.loading, `${image.src}: ảnh dưới màn hình đầu phải lazy`).toBe('lazy')
  }
})

test('the menu page ships a small amount of JavaScript', async ({ page }) => {
  const sizes: Promise<number>[] = []
  page.on('requestfinished', (request) => {
    if (request.resourceType() === 'script') sizes.push(request.sizes().then(s => s.responseBodySize))
  })
  await page.goto(`/s/${slug}`, { waitUntil: 'networkidle' })
  const total = (await Promise.all(sizes)).reduce((sum, size) => sum + size, 0)
  expect(total, `JS truyền ${total} byte; nếu vượt, tách sheet bằng defineAsyncComponent/lazy hydration`).toBeLessThan(JS_BUDGET_BYTES)
})

test('the public menu API is cacheable by the CDN while tracking is not', async ({ request }) => {
  const menuRes = await request.get(`/api/public/stores/${slug}/menu`)
  expect(menuRes.headers()['cache-control']).toContain('s-maxage=')
  const trackRes = await request.get(`/api/public/orders/${'x'.repeat(43)}`)
  expect(trackRes.headers()['cache-control']).toContain('no-store')
})
```

- [ ] **Step 7: Viết spec Lighthouse**

`tests/e2e-hardening/lighthouse.spec.ts`:

```ts
import { chromium, expect, test } from '@playwright/test'
import { closeDb } from '../../server/db/client'
import { openStore, seedMenu } from '../support/checkout-fixtures'
import { createTenant } from '../support/fixtures'
import { evaluateLighthouse, type LhrLike } from '../support/lighthouse-budget'

const DEBUG_PORT = 9223

test.afterAll(async () => {
  await closeDb()
})

test('Lighthouse mobile budget on /s/:slug', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chrome', 'Lighthouse chạy một lần, trên Chromium')
  test.setTimeout(180_000)

  const tenant = await createTenant('lh')
  await openStore(tenant.store.id, { deliveryEnabled: true })
  await seedMenu(tenant.store)
  const baseURL = String(testInfo.project.use.baseURL)

  const browser = await chromium.launch({ args: [`--remote-debugging-port=${DEBUG_PORT}`] })
  try {
    const { default: lighthouse } = await import('lighthouse')
    const result = await lighthouse(`${baseURL}/s/${tenant.store.slug}`, {
      port: DEBUG_PORT,
      output: 'json',
      logLevel: 'error',
      onlyCategories: ['performance', 'accessibility', 'best-practices'],
    })
    expect(result, 'Lighthouse không trả kết quả').toBeDefined()
    await testInfo.attach('lighthouse.json', { body: JSON.stringify(result!.lhr), contentType: 'application/json' })
    expect(evaluateLighthouse(result!.lhr as unknown as LhrLike)).toEqual([])
  }
  finally {
    await browser.close()
  }
})
```

- [ ] **Step 8: Chạy và xử lý**

Run: `npm run test:e2e:hardening -- perf lighthouse`
Expected: PASS. Cách xử lý khi đỏ (theo thứ tự ưu tiên): (1) ảnh thiếu `width`/`height`/`loading="lazy"` → sửa `ProductCard`; (2) JS quá ngân sách → tải sheet/checkout bằng `defineAsyncComponent` hoặc `<LazyXxx>` của Nuxt, bỏ icon/tải font thừa; (3) LCP/CLS → ưu tiên tải ảnh/header đầu, đặt kích thước cố định cho khung ảnh; (4) chỉ khi đã tối ưu mà vẫn vượt ngân sách mới được hạ ngưỡng trong `MOBILE_BUDGET`, kèm đoạn giải thích số đo thực tế trong `docs/operations.md` mục "Performance budget".

- [ ] **Step 9: Commit**

```bash
git add tests/support/lighthouse-budget.ts tests/unit/support/lighthouse-budget.test.ts tests/e2e-hardening/perf.spec.ts tests/e2e-hardening/lighthouse.spec.ts package.json package-lock.json app
git commit -m "test(hardening): enforce image, JS and Lighthouse mobile budgets on /s/:slug

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 12: Kiểm toán Review Focus + merge-gate thanh toán + E2E ba project, kèm test bù

**Files:**
- Create: `tests/support/review-focus-map.ts`, `tests/unit/audit/review-focus.test.ts`, `tests/hardening/review-focus.test.ts`
- Modify: `playwright.config.ts` (thêm project `desktop-chrome`)

**Interfaces:**
- Consumes: mọi file test của PR0–PR6 (đọc nội dung bằng `fs`); `buildWorld`, `checkoutBody`, `World` (Task 5); bảng `orders`, `products`; `api` (Task 1).
- Produces:
  - `interface TestRef { path: RegExp; content: RegExp }` — khớp khi **có ít nhất một** file test có đường dẫn khớp `path` và nội dung khớp `content`.
  - `interface FocusRow { id: string; summary: string; owner: string; refs: TestRef[] }`
  - `REVIEW_FOCUS: FocusRow[]` (10 dòng của roadmap), `PAYMENT_MERGE_GATE: FocusRow[]` (PRD §14: HMAC thiếu/sai, replay, sai account, trùng payment, tiền đến muộn), `PRD_E2E: FocusRow[]` (luồng E2E PRD §11).
  - Test unit duyệt từng dòng; test hardening bù cho Review Focus #7, #8, #9, #10 bằng HTTP thật trên bản build production (#10 dùng fixture thanh toán của PR6).
  - Project Playwright `desktop-chrome` trong `playwright.config.ts`.

- [ ] **Step 1: Thêm project desktop vào Playwright dev config**

Trong `playwright.config.ts`, sau dòng `{ name: 'mobile-safari', use: { ...devices['iPhone 14'] } },` thêm:

```ts
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
```

- [ ] **Step 2: Viết bảng ánh xạ `tests/support/review-focus-map.ts`**

```ts
export interface TestRef {
  path: RegExp
  content: RegExp
}

export interface FocusRow {
  id: string
  summary: string
  owner: string
  refs: TestRef[]
}

const ref = (path: RegExp, content: RegExp): TestRef => ({ path, content })

/** Roadmap "Review Focus (toàn dự án)". Rows 7–9 also need the PR7 black-box backstop in tests/hardening. */
export const REVIEW_FOCUS: FocusRow[] = [
  {
    id: 'RF-1',
    summary: 'Tenant A gọi resource store B bằng UUID thật → 404 y hệt UUID không tồn tại',
    owner: 'PR1 + PR7',
    refs: [
      ref(/tests\/api\/tenant-isolation\.test\.ts$/, /treats another tenant's real store exactly like a random id/),
      ref(/tests\/hardening\/tenant-matrix\.test\.ts$/, /actors without access get the same 404 as a random id/),
    ],
  },
  {
    id: 'RF-2',
    summary: 'JWT hết hạn / sai issuer / sai key / alg khác / thiếu sub → 401',
    owner: 'PR1',
    refs: [
      ref(/tests\/unit\/server\/auth\/jwt\.test\.ts$/, /rejects an expired token/),
      ref(/tests\/unit\/server\/auth\/jwt\.test\.ts$/, /rejects a token from another issuer/),
      ref(/tests\/unit\/server\/auth\/jwt\.test\.ts$/, /rejects a token signed by an unknown key/),
      ref(/tests\/unit\/server\/auth\/jwt\.test\.ts$/, /rejects HS256 tokens/),
      ref(/tests\/unit\/server\/auth\/jwt\.test\.ts$/, /rejects a token without sub/),
    ],
  },
  {
    id: 'RF-3',
    summary: 'Slug có dấu/hoa/trùng/dành riêng',
    owner: 'PR1',
    refs: [
      ref(/tests\/unit\/shared\/identity-schemas\.test\.ts$/, /describe\('slugSchema'/),
      ref(/tests\/api\/tenant-isolation\.test\.ts$/, /returns SLUG_TAKEN for an existing slug/),
      ref(/tests\/api\/tenant-isolation\.test\.ts$/, /rejects slug %s with 400/),
    ],
  },
  {
    id: 'RF-4',
    summary: 'Bấm "Tạo cửa hàng" 2 lần / 2 tab → đúng 1 org, lần 2 ORG_EXISTS',
    owner: 'PR1',
    refs: [
      ref(/tests\/integration\/identity-service\.test\.ts$/, /creates exactly one org on concurrent double submit/),
      ref(/tests\/api\/tenant-isolation\.test\.ts$/, /creates once, then ORG_EXISTS/),
    ],
  },
  {
    id: 'RF-5',
    summary: 'DB không kết nối được → /api/health 503, không lộ connection string',
    owner: 'PR0',
    refs: [ref(/tests\/unit\/server\/health\.test\.ts$/, /returns 503 SERVICE_UNAVAILABLE without leaking connection details/)],
  },
  {
    id: 'RF-6',
    summary: 'SĐT/địa chỉ/token/connection string trong log bị che',
    owner: 'PR0 + PR7',
    refs: [
      ref(/tests\/unit\/server\/logger\.test\.ts$/, /masks sensitive keys at any depth/),
      ref(/tests\/unit\/server\/logger\.test\.ts$/, /masks postgres connection strings/),
      ref(/tests\/hardening\/log-leak\.test\.ts$/, /contains no PII canary, guest token, session token or secret/),
    ],
  },
  {
    id: 'RF-7',
    summary: 'Giá/option đổi hoặc món hết hàng giữa lúc thêm giỏ và lúc đặt → 409 CART_STALE, không tính giá cũ',
    owner: 'PR3 + PR7',
    refs: [
      ref(/tests\/integration\/create-order\.test\.ts$/, /uses the NEW price, reports it, and never the old one/),
      ref(/tests\/integration\/create-order\.test\.ts$/, /names a product that sold out and creates nothing/),
      ref(/tests\/hardening\/review-focus\.test\.ts$/, /CART_STALE for a sold-out product/),
      ref(/tests\/hardening\/review-focus\.test\.ts$/, /never charges the old price/),
    ],
  },
  {
    id: 'RF-8',
    summary: 'Retry/double tap "Đặt món" → cùng một đơn, cùng guestToken',
    owner: 'PR3 + PR7',
    refs: [
      ref(/tests\/integration\/create-order\.test\.ts$/, /creates exactly one order when 5 identical requests race/),
      ref(/tests\/e2e\/ordering\.spec\.ts$/, /double tap/),
      ref(/tests\/hardening\/review-focus\.test\.ts$/, /five concurrent submits/),
    ],
  },
  {
    id: 'RF-9',
    summary: 'Hai nhân viên đổi trạng thái cùng lúc → một thắng, một 409 STATUS_CONFLICT',
    owner: 'PR4 + PR7',
    refs: [
      ref(/tests\/integration\/order-status\.test\.ts$/, /exactly one wins, the other gets STATUS_CONFLICT/),
      ref(/tests\/hardening\/review-focus\.test\.ts$/, /two staff moving the same order at once/),
    ],
  },
  {
    id: 'RF-10',
    summary: 'Webhook replay / trùng đồng thời / tiền đến muộn → đúng 1 payment, bất thường vào review',
    owner: 'PR6',
    refs: [
      ref(/tests\/(api|integration)\/.*webhook.*\.test\.ts$/, /replay/i),
      ref(/tests\/(api|integration)\/.*webhook.*\.test\.ts$/, /Promise\.all/),
      ref(/tests\/(api|integration)\/.*(webhook|match).*\.test\.ts$/, /late|muộn|expired/i),
      ref(/tests\/hardening\/review-focus\.test\.ts$/, /five concurrent signed deliveries/),
    ],
  },
]

/** PRD §14: payment PRs may not merge without these. */
export const PAYMENT_MERGE_GATE: FocusRow[] = [
  {
    id: 'PAY-HMAC',
    summary: 'HMAC thiếu, sai hoặc timestamp lệch bị từ chối',
    owner: 'PR6',
    refs: [
      ref(/tests\/unit\/.*sepay-signature.*\.test\.ts$/, /MISSING/),
      ref(/tests\/unit\/.*sepay-signature.*\.test\.ts$/, /MISMATCH/),
      ref(/tests\/unit\/.*sepay-signature.*\.test\.ts$/, /STALE/),
    ],
  },
  { id: 'PAY-REPLAY', summary: 'Webhook replay không sinh payment thứ hai', owner: 'PR6', refs: [ref(/tests\/(api|integration)\/.*webhook.*\.test\.ts$/, /replay/i)] },
  { id: 'PAY-ACCOUNT', summary: 'Sai tài khoản → REVIEW_REQUIRED', owner: 'PR6', refs: [ref(/tests\/(api|integration)\/.*(webhook|match).*\.test\.ts$/, /account/i), ref(/tests\/(api|integration)\/.*(webhook|match).*\.test\.ts$/, /REVIEW_REQUIRED/)] },
  { id: 'PAY-DUPLICATE', summary: 'Trùng đồng thời không sinh payment thứ hai', owner: 'PR6', refs: [ref(/tests\/(api|integration)\/.*webhook.*\.test\.ts$/, /Promise\.all/)] },
  { id: 'PAY-LATE', summary: 'Tiền đến muộn sau hết hạn/hủy không biến mất', owner: 'PR6', refs: [ref(/tests\/(api|integration)\/.*(webhook|match).*\.test\.ts$/, /late|muộn/i)] },
]

/** PRD §11 end-to-end flows that must exist as Playwright specs. */
export const PRD_E2E: FocusRow[] = [
  { id: 'E2E-DINE-IN', summary: 'Quét QR bàn → đặt không cần nhập tên/địa chỉ', owner: 'PR3', refs: [ref(/tests\/e2e\/.*\.spec\.ts$/, /dine-in via QR/i)] },
  { id: 'E2E-PICKUP', summary: 'Link chung → pickup cần tên + SĐT', owner: 'PR3', refs: [ref(/tests\/e2e\/.*\.spec\.ts$/, /pickup:/i)] },
  { id: 'E2E-DELIVERY', summary: 'Delivery chọn zone + địa chỉ, phí đúng', owner: 'PR3', refs: [ref(/tests\/e2e\/.*\.spec\.ts$/, /delivery:/i)] },
  { id: 'E2E-DOUBLE-TAP', summary: 'Double tap không tạo trùng đơn', owner: 'PR3', refs: [ref(/tests\/e2e\/.*\.spec\.ts$/, /double tap/i)] },
  { id: 'E2E-CONFLICT', summary: 'Owner và staff cùng thao tác một đơn → UI tải lại và báo', owner: 'PR4', refs: [ref(/tests\/e2e\/.*\.spec\.ts$/, /STATUS_CONFLICT|conflict|người khác cập nhật/i)] },
  { id: 'E2E-VIETQR', summary: 'Đặt VietQR → webhook giả lập ký HMAC → đơn chuyển NEW/PAID', owner: 'PR6', refs: [ref(/tests\/e2e\/.*\.spec\.ts$/, /VietQR|BANK_QR/i)] },
]
```

- [ ] **Step 3: Viết audit unit test**

`tests/unit/audit/review-focus.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PAYMENT_MERGE_GATE, PRD_E2E, REVIEW_FOCUS } from '../../support/review-focus-map'

function listTests(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return listTests(full)
    return /\.(test|spec)\.ts$/.test(name) ? [full.split('\\').join('/')] : []
  })
}

const files = listTests('tests').map(path => ({ path, text: readFileSync(path, 'utf8') }))
const missingFor = (refs: { path: RegExp, content: RegExp }[]) =>
  refs.filter(r => !files.some(f => r.path.test(f.path) && r.content.test(f.text))).map(r => `${r.path} ∋ ${r.content}`)

describe.each([
  ['Review Focus', REVIEW_FOCUS],
  ['payment merge gate (PRD §14)', PAYMENT_MERGE_GATE],
  ['PRD §11 e2e flows', PRD_E2E],
])('%s', (_group, rows) => {
  it.each(rows.map(row => [`${row.id}: ${row.summary}`, row] as const))('%s has its tests', (_name, row) => {
    expect(missingFor(row.refs), `Thiếu test cho ${row.id} (chủ sở hữu ${row.owner}). Viết test còn thiếu theo phong cách PR đó rồi chạy xanh; không nới regex.`).toEqual([])
  })
})

describe('Playwright coverage', () => {
  it('runs the dev e2e suite on mobile Chrome, mobile Safari and desktop', () => {
    const config = readFileSync('playwright.config.ts', 'utf8')
    for (const project of ['mobile-chrome', 'mobile-safari', 'desktop-chrome']) {
      expect(config, project).toContain(`name: '${project}'`)
    }
  })

  it('runs the hardening suite on the same three projects', () => {
    const config = readFileSync('playwright.hardening.config.ts', 'utf8')
    for (const project of ['mobile-chrome', 'mobile-safari', 'desktop-chrome']) {
      expect(config, project).toContain(`name: '${project}'`)
    }
  })
})
```

- [ ] **Step 4: Chạy audit và ghi nhận khoảng trống**

Run: `npx vitest run --project unit tests/unit/audit/review-focus.test.ts`
Expected: các dòng RF-7/8/9/10 ĐỎ ở ref `tests/hardening/review-focus.test.ts` (file chưa tồn tại) — Step 5 bổ sung; các dòng còn lại phụ thuộc test thật của PR1–PR6 và phải xanh. Với dòng đỏ thuộc PR3–PR6 (vd `PAY-*`, `E2E-VIETQR`): **viết test còn thiếu** trong PR7 theo đúng phong cách của PR đó (cùng fixtures, cùng thư mục) rồi chạy lại; không sửa regex để lách.

- [ ] **Step 5: Viết test bù HTTP cho Review Focus #7, #8, #9, #10**

`tests/hardening/review-focus.test.ts`:

```ts
import { and, count, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { orderPayments, orders, products } from '../../server/db/schema'
import { api } from '../support/hardening'
import { bodyOf, createAwaitingOrder, createPaymentSetup, sepayPayload, signSepayBody, type PaymentSetup } from '../support/webhook-fixtures'
import { buildWorld, checkoutBody, type World } from '../support/world'

let world: World
let url: string
let payment: PaymentSetup

const orderCount = async (storeId: string) =>
  (await getDb().select({ n: count() }).from(orders).where(eq(orders.storeId, storeId)))[0]!.n

beforeAll(async () => {
  world = await buildWorld()
  url = `/api/public/stores/${world.a.slug}/orders`
  payment = await createPaymentSetup({ org: { id: world.a.orgId }, store: { id: world.a.storeId, orgId: world.a.orgId } })
})

afterAll(async () => {
  await closeDb()
})

describe('Review Focus 7: giá hoặc món đổi giữa lúc thêm giỏ và lúc đặt', () => {
  it('409 CART_STALE for a sold-out product, naming the line and creating no order', async () => {
    const product = world.a.demo.products.find(p => p.hasOptions)!
    const before = await orderCount(world.a.storeId)
    await getDb().update(products).set({ isAvailable: false }).where(eq(products.id, product.id))
    try {
      const res = await api('POST', url, { body: checkoutBody('pickup', world.a.demo) })
      expect(res).toMatchObject({ status: 409, body: { code: 'CART_STALE' } })
      expect(res.body.details.lines[0]).toMatchObject({ productId: product.id, reason: 'PRODUCT_UNAVAILABLE' })
      expect(await orderCount(world.a.storeId)).toBe(before)
    }
    finally {
      await getDb().update(products).set({ isAvailable: true }).where(eq(products.id, product.id))
    }
  })

  it('reports the new price and never charges the old price', async () => {
    const product = world.a.demo.products.find(p => p.hasOptions)!
    const before = await orderCount(world.a.storeId)
    const staleBody = checkoutBody('pickup', world.a.demo)
    await getDb().update(products).set({ basePriceVnd: product.basePriceVnd + 5_000 }).where(eq(products.id, product.id))
    try {
      const newUnit = product.basePriceVnd + 5_000 + product.defaultDeltaVnd
      const stale = await api('POST', url, { body: staleBody })
      expect(stale).toMatchObject({ status: 409, body: { code: 'CART_STALE' } })
      expect(stale.body.details.lines[0]).toMatchObject({ reason: 'PRICE_CHANGED', currentUnitPriceVnd: newUnit })
      expect(await orderCount(world.a.storeId)).toBe(before)

      const fresh = checkoutBody('pickup', world.a.demo) as { items: { expectedUnitPriceVnd: number }[], expectedTotalVnd: number }
      fresh.items[0]!.expectedUnitPriceVnd = newUnit
      fresh.expectedTotalVnd = newUnit * 2
      const ok = await api('POST', url, { body: fresh })
      expect(ok.status).toBe(201)
      expect(ok.body.totalVnd).toBe(newUnit * 2)
    }
    finally {
      await getDb().update(products).set({ basePriceVnd: product.basePriceVnd }).where(eq(products.id, product.id))
    }
  })
})

describe('Review Focus 8: retry và double tap', () => {
  it('five concurrent submits with one idempotencyKey create one order and one guest token', async () => {
    const body = checkoutBody('pickup', world.a.demo)
    const results = await Promise.all(Array.from({ length: 5 }, () => api('POST', url, { body })))
    expect(results.map(r => r.status).every(s => s === 200 || s === 201)).toBe(true)
    expect(new Set(results.map(r => r.body.guestToken)).size).toBe(1)
    expect(new Set(results.map(r => r.body.publicCode)).size).toBe(1)
    const rows = await getDb().select({ id: orders.id }).from(orders)
      .where(and(eq(orders.storeId, world.a.storeId), eq(orders.idempotencyKey, body.idempotencyKey as string)))
    expect(rows).toHaveLength(1)
  })

  it('a later retry after success still returns the same order', async () => {
    const body = checkoutBody('pickup', world.a.demo)
    const first = await api('POST', url, { body })
    const retry = await api('POST', url, { body })
    expect(first.status).toBe(201)
    expect(retry.status).toBe(200)
    expect(retry.body).toMatchObject({ publicCode: first.body.publicCode, guestToken: first.body.guestToken })
  })

  it('the same key in another store is a different order', async () => {
    const body = checkoutBody('pickup', world.a.demo)
    const first = await api('POST', url, { body })
    const other = await api('POST', `/api/public/stores/${world.b.slug}/orders`, {
      body: { ...checkoutBody('pickup', world.b.demo), idempotencyKey: body.idempotencyKey },
    })
    expect(first.status).toBe(201)
    expect(other.status).toBe(201)
    expect(other.body.guestToken).not.toBe(first.body.guestToken)
  })
})

describe('Review Focus 10: webhook replay, trùng đồng thời, tiền đến muộn', () => {
  const deliver = (payload: unknown, headers?: Record<string, string>) => {
    const raw = bodyOf(payload)
    return api('POST', `/api/webhooks/sepay/${payment.integration.webhookEndpointKey}`, {
      body: raw,
      headers: headers ?? signSepayBody(raw, payment.secret),
    })
  }
  const paymentsOf = async (orderId: string) => getDb().select().from(orderPayments).where(eq(orderPayments.orderId, orderId))

  it('five concurrent signed deliveries and a later replay confirm the order exactly once', async () => {
    const { order, attempt } = await createAwaitingOrder(payment, { amountVnd: 55_000 })
    const payload = sepayPayload(payment, { code: attempt.paymentCode, transferAmount: 55_000 })
    const results = await Promise.all(Array.from({ length: 5 }, () => deliver(payload)))
    for (const res of results) expect(res).toMatchObject({ status: 200, body: { success: true } })
    expect(await paymentsOf(order.id)).toHaveLength(1)

    expect(await deliver(payload)).toMatchObject({ status: 200, body: { success: true } })
    expect(await paymentsOf(order.id)).toHaveLength(1)
    const [row] = await getDb().select({ status: orders.status, paymentStatus: orders.paymentStatus }).from(orders).where(eq(orders.id, order.id))
    expect(row).toEqual({ status: 'NEW', paymentStatus: 'PAID' })
  })

  it('a transfer that arrives after the attempt expired is still confirmed and flagged late', async () => {
    const { order, attempt } = await createAwaitingOrder(payment, { amountVnd: 42_000, attemptStatus: 'EXPIRED' })
    const res = await deliver(sepayPayload(payment, { code: attempt.paymentCode, transferAmount: 42_000 }))
    expect(res.status).toBe(200)
    const [row] = await getDb().select({ latePayment: orders.latePayment, paymentStatus: orders.paymentStatus }).from(orders).where(eq(orders.id, order.id))
    expect(row).toEqual({ latePayment: true, paymentStatus: 'PAID' })
    expect(await paymentsOf(order.id)).toHaveLength(1)
  })

  it('a tampered signature is rejected and records no money', async () => {
    const { order, attempt } = await createAwaitingOrder(payment, { amountVnd: 30_000 })
    const payload = sepayPayload(payment, { code: attempt.paymentCode, transferAmount: 30_000 })
    const forged = await deliver(payload, { 'x-sepay-timestamp': String(Math.floor(Date.now() / 1000)), 'x-sepay-signature': `sha256=${'0'.repeat(64)}` })
    expect(forged.status).toBe(401)
    expect(await paymentsOf(order.id)).toHaveLength(0)
  })
})

describe('Review Focus 9: hai nhân viên bấm cùng lúc', () => {
  it('two staff moving the same order at once: one wins, the other gets STATUS_CONFLICT', async () => {
    const orderId = world.a.orders.pickup.id
    const path = `/api/stores/${world.a.storeId}/orders/${orderId}/status`
    const [first, second] = await Promise.all([
      api('PATCH', path, { token: world.tokens.ownerA, body: { expectedStatus: 'NEW', nextStatus: 'PREPARING' } }),
      api('PATCH', path, { token: world.tokens.staffA1, body: { expectedStatus: 'NEW', nextStatus: 'READY' } }),
    ])
    expect([first.status, second.status].sort()).toEqual([200, 409])
    const loser = first.status === 409 ? first : second
    expect(loser.body).toMatchObject({ code: 'STATUS_CONFLICT' })
    const winnerTarget = first.status === 200 ? 'PREPARING' : 'READY'
    const [row] = await getDb().select({ status: orders.status }).from(orders).where(eq(orders.id, orderId))
    expect(row!.status).toBe(winnerTarget)
  })

  it('a stale expectedStatus is a conflict, not a silent overwrite', async () => {
    const orderId = world.a.orders.dineIn.id
    const path = `/api/stores/${world.a.storeId}/orders/${orderId}/status`
    expect((await api('PATCH', path, { token: world.tokens.ownerA, body: { expectedStatus: 'NEW', nextStatus: 'PREPARING' } })).status).toBe(200)
    const stale = await api('PATCH', path, { token: world.tokens.staffA1, body: { expectedStatus: 'NEW', nextStatus: 'READY' } })
    expect(stale).toMatchObject({ status: 409, body: { code: 'STATUS_CONFLICT' } })
  })
})
```

- [ ] **Step 6: Chạy**

Run: `npm run test:hardening -- review-focus && npx vitest run --project unit tests/unit/audit/review-focus.test.ts`
Expected: hardening PASS (11 test); audit PASS cho mọi dòng đã có test PR1–PR6. Dòng nào còn đỏ là khoảng trống thật phải lấp (Step 4).

- [ ] **Step 7: Chạy toàn bộ E2E của PR0–PR6 trên cả ba project**

Run: `npm run test:e2e`
Expected: PASS ở `mobile-chrome`, `mobile-safari` **và** `desktop-chrome` (viewport do từng spec đặt là 360×740). Lỗi chỉ xảy ra ở `desktop-chrome` là lỗi thật của spec (vd giả định cảm ứng/UA di động) hoặc của UI ở màn rộng: sửa spec cho đúng thao tác hoặc sửa UI; không bỏ project, không `test.skip` để lách.

- [ ] **Step 8: Commit**

```bash
git add tests/support/review-focus-map.ts tests/unit/audit/review-focus.test.ts tests/hardening/review-focus.test.ts playwright.config.ts
git commit -m "test(hardening): audit review-focus coverage and add black-box backstops

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 13: Vận hành runtime — trạng thái hệ thống, hợp đồng cron (GET), giám sát 15 phút

**Files:**
- Create: `server/services/ops/status.ts`, `server/api/internal/status.get.ts`, `tests/unit/ops/status.test.ts`, `tests/unit/audit/cron-contract.test.ts`, `tests/hardening/ops-endpoints.test.ts`, `.github/workflows/ops-watch.yml`
- Modify: không sửa route cron của PR6 (đã nhận GET và POST); chỉ thêm nếu `cron-contract` phát hiện thiếu.

**Interfaces:**
- Consumes: `assertCronRequest(event: H3Event): void` (`server/utils/cron-auth.ts`, PR6: chỉ cho `GET`/`POST`, `401 UNAUTHENTICATED` khi thiếu/sai `Authorization: Bearer <CRON_SECRET>`, so sánh constant-time, `CRON_SECRET` ≥ 16 ký tự); `defineApiHandler`, `AppError` (PR0); `getDb`, `Db`; `vercel.json` (`crons`, PR6); route `/api/internal/reconcile-sepay` và `/api/internal/expire-payment-attempts` (PR6, file không có hậu tố method nên nhận mọi method mà `assertCronRequest` cho phép); bảng tuỳ chọn `sepay_integrations`, `reconcile_checkpoints`, `bank_transactions`, `payment_attempts` (PR5/PR6; truy vấn chỉ chạy khi `to_regclass` thấy bảng).
- Produces:
  - `interface StatusInputs { dbLatencyMs: number; migrationsApplied: number; activeIntegrations: number; lastReconcileAgeMinutes: number | null; staleReceivedTransactions: number; stalePendingAttempts: number }`
  - `evaluateStatus(input: StatusInputs, now?: Date): OpsStatus` với `OpsStatus = { ok: boolean; problems: string[]; checkedAt: string; db: { latencyMs: number }; migrations: { applied: number }; payments: { activeIntegrations: number; lastReconcileAgeMinutes: number | null; staleReceivedTransactions: number; stalePendingAttempts: number } }`
  - `collectStatusInputs(db: Db): Promise<StatusInputs>`
  - `GET /api/internal/status` (Bearer `CRON_SECRET`) → `200 OpsStatus` hoặc `503 OpsStatus` khi `ok = false`; `Cache-Control: no-store`.
  - Hợp đồng cron: mọi `path` trong `vercel.json.crons` có route nhận `GET` (file `.get.ts` hoặc không có hậu tố method) và dùng `assertCronRequest`, vì **Vercel Cron luôn gọi bằng GET** kèm `Authorization: Bearer $CRON_SECRET` (PR6 đã làm; test này giữ nguyên hợp đồng khi có người thêm cron mới).

**Ngưỡng `ok = false`:** DB phản hồi > 2000 ms; có `bank_transactions` ở `RECEIVED` quá 15 phút (match chưa chạy); có `payment_attempts` `PENDING` quá hạn > 15 phút (cron expire không chạy); có integration `ACTIVE` mà reconcile chưa chạy hoặc đã > 45 phút.

- [ ] **Step 1: Xác nhận helper cron của PR6**

Run: `grep -n "export function assertCronRequest" server/utils/cron-auth.ts && cat vercel.json`
Expected: in dòng khai báo `assertCronRequest`; `vercel.json` có hai cron (`expire-payment-attempts`, `reconcile-sepay`). Nếu helper tên khác, dùng đúng tên đó ở Step 6 và ở regex của `tests/unit/audit/route-guards.test.ts` (Task 3).

- [ ] **Step 2: Viết unit test thất bại cho `evaluateStatus`**

`tests/unit/ops/status.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { evaluateStatus, type StatusInputs } from '../../../server/services/ops/status'

const healthy: StatusInputs = {
  dbLatencyMs: 40,
  migrationsApplied: 4,
  activeIntegrations: 1,
  lastReconcileAgeMinutes: 10,
  staleReceivedTransactions: 0,
  stalePendingAttempts: 0,
}
const now = new Date('2026-11-01T00:00:00Z')

describe('evaluateStatus', () => {
  it('is ok when everything is fresh', () => {
    expect(evaluateStatus(healthy, now)).toMatchObject({ ok: true, problems: [], checkedAt: '2026-11-01T00:00:00.000Z' })
  })

  it.each([
    ['slow database', { dbLatencyMs: 2500 }, /DB/],
    ['transactions stuck in RECEIVED', { staleReceivedTransactions: 2 }, /RECEIVED/],
    ['expired attempts never closed', { stalePendingAttempts: 1 }, /expire/i],
    ['reconcile never ran with an active integration', { lastReconcileAgeMinutes: null }, /reconcile/i],
    ['reconcile stalled for an hour', { lastReconcileAgeMinutes: 60 }, /reconcile/i],
  ] as const)('is not ok for %s', (_label, patch, message) => {
    const result = evaluateStatus({ ...healthy, ...patch }, now)
    expect(result.ok).toBe(false)
    expect(result.problems.join(' ')).toMatch(message)
  })

  it('does not demand reconcile when no integration is active', () => {
    expect(evaluateStatus({ ...healthy, activeIntegrations: 0, lastReconcileAgeMinutes: null }, now).ok).toBe(true)
  })
})
```

- [ ] **Step 3: Chạy để thấy thất bại**

Run: `npx vitest run --project unit tests/unit/ops/status.test.ts`
Expected: FAIL — không resolve `server/services/ops/status`.

- [ ] **Step 4: Xác nhận audit route/guard nhận ra route cron của PR6**

Run: `npx vitest run --project unit tests/unit/audit/route-guards.test.ts`
Expected: PASS — các route `server/api/internal/*.ts` của PR6 chứa `assertCronRequest` (regex ở Task 3 đã gồm tên này). Đỏ ở `internal … authenticates` nghĩa là route cron nào đó chưa gọi helper xác thực: đó là lỗ hổng thật, sửa route.

- [ ] **Step 5: Viết `server/services/ops/status.ts`**

```ts
import { sql, type SQL } from 'drizzle-orm'
import type { Db } from '../../db/client'

export interface StatusInputs {
  dbLatencyMs: number
  migrationsApplied: number
  activeIntegrations: number
  lastReconcileAgeMinutes: number | null
  staleReceivedTransactions: number
  stalePendingAttempts: number
}

export interface OpsStatus {
  ok: boolean
  problems: string[]
  checkedAt: string
  db: { latencyMs: number }
  migrations: { applied: number }
  payments: {
    activeIntegrations: number
    lastReconcileAgeMinutes: number | null
    staleReceivedTransactions: number
    stalePendingAttempts: number
  }
}

export const STATUS_THRESHOLDS = { dbLatencyMs: 2000, reconcileStaleMinutes: 45, staleMinutes: 15 } as const

export function evaluateStatus(input: StatusInputs, now = new Date()): OpsStatus {
  const problems: string[] = []
  if (input.dbLatencyMs > STATUS_THRESHOLDS.dbLatencyMs) problems.push(`DB chậm: ${input.dbLatencyMs} ms`)
  if (input.staleReceivedTransactions > 0) {
    problems.push(`${input.staleReceivedTransactions} giao dịch ngân hàng ở RECEIVED quá ${STATUS_THRESHOLDS.staleMinutes} phút (match chưa chạy)`)
  }
  if (input.stalePendingAttempts > 0) {
    problems.push(`${input.stalePendingAttempts} payment attempt quá hạn chưa chuyển EXPIRED (cron expire không chạy?)`)
  }
  if (input.activeIntegrations > 0
    && (input.lastReconcileAgeMinutes === null || input.lastReconcileAgeMinutes > STATUS_THRESHOLDS.reconcileStaleMinutes)) {
    problems.push(`Reconcile chưa chạy trong ${STATUS_THRESHOLDS.reconcileStaleMinutes} phút (lần cuối: ${input.lastReconcileAgeMinutes ?? 'chưa bao giờ'})`)
  }
  return {
    ok: problems.length === 0,
    problems,
    checkedAt: now.toISOString(),
    db: { latencyMs: input.dbLatencyMs },
    migrations: { applied: input.migrationsApplied },
    payments: {
      activeIntegrations: input.activeIntegrations,
      lastReconcileAgeMinutes: input.lastReconcileAgeMinutes,
      staleReceivedTransactions: input.staleReceivedTransactions,
      stalePendingAttempts: input.stalePendingAttempts,
    },
  }
}

async function scalar(db: Db, query: SQL): Promise<number> {
  const { rows } = await db.execute<{ n: string | number | null }>(query)
  return Number(rows[0]?.n ?? 0)
}

async function tableExists(db: Db, name: string): Promise<boolean> {
  const { rows } = await db.execute<{ present: boolean }>(sql`select to_regclass(${`public.${name}`}) is not null as present`)
  return rows[0]?.present === true
}

export async function collectStatusInputs(db: Db): Promise<StatusInputs> {
  const started = performance.now()
  await db.execute(sql`select 1`)
  const dbLatencyMs = Math.round(performance.now() - started)

  const inputs: StatusInputs = {
    dbLatencyMs,
    migrationsApplied: await scalar(db, sql`select count(*)::int as n from drizzle.__drizzle_migrations`),
    activeIntegrations: 0,
    lastReconcileAgeMinutes: null,
    staleReceivedTransactions: 0,
    stalePendingAttempts: 0,
  }
  if (await tableExists(db, 'sepay_integrations')) {
    inputs.activeIntegrations = await scalar(db, sql`select count(*)::int as n from sepay_integrations where status = 'ACTIVE'`)
  }
  if (await tableExists(db, 'reconcile_checkpoints')) {
    const { rows } = await db.execute<{ n: string | number | null }>(sql`select extract(epoch from (now() - max(last_synced_at))) / 60 as n from reconcile_checkpoints`)
    const age = rows[0]?.n
    inputs.lastReconcileAgeMinutes = age === null || age === undefined ? null : Math.round(Number(age))
  }
  if (await tableExists(db, 'bank_transactions')) {
    inputs.staleReceivedTransactions = await scalar(db, sql`select count(*)::int as n from bank_transactions where reconciliation_status = 'RECEIVED' and created_at < now() - interval '15 minutes'`)
  }
  if (await tableExists(db, 'payment_attempts')) {
    inputs.stalePendingAttempts = await scalar(db, sql`select count(*)::int as n from payment_attempts where status = 'PENDING' and expires_at < now() - interval '15 minutes'`)
  }
  return inputs
}
```

- [ ] **Step 6: Viết route `server/api/internal/status.get.ts`**

```ts
import { setResponseHeader, setResponseStatus } from 'h3'
import { getDb } from '../../db/client'
import { collectStatusInputs, evaluateStatus } from '../../services/ops/status'
import { defineApiHandler } from '../../utils/api-handler'
import { assertCronRequest } from '../../utils/cron-auth'

export default defineApiHandler(async (event) => {
  assertCronRequest(event)
  setResponseHeader(event, 'cache-control', 'no-store')
  const status = evaluateStatus(await collectStatusInputs(getDb()))
  if (!status.ok) setResponseStatus(event, 503)
  return status
})
```

- [ ] **Step 7: Chạy unit test**

Run: `npx vitest run --project unit tests/unit/ops/status.test.ts tests/unit/audit/route-guards.test.ts`
Expected: PASS.

- [ ] **Step 8: Viết test hợp đồng cron**

`tests/unit/audit/cron-contract.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { discoverRoutes } from '../../support/route-inventory'

interface Cron { path: string, schedule: string }

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons?: Cron[] }
const crons = vercel.crons ?? []
const routes = discoverRoutes()

describe('vercel.json crons (Vercel Cron always calls GET with Authorization: Bearer $CRON_SECRET)', () => {
  it('declares the reconcile and expire jobs', () => {
    expect(crons.map(c => c.path)).toEqual(expect.arrayContaining(['/api/internal/reconcile-sepay', '/api/internal/expire-payment-attempts']))
  })

  it.each(crons.map(c => [c.path, c] as const))('%s has a route that accepts GET', (path) => {
    const route = routes.find(r => r.template === path && (r.method === 'GET' || r.method === 'ALL'))
    expect(route, `không có route nhận GET cho ${path}: tạo server${path}.get.ts chứa \`export { default } from './${path.split('/').pop()}.post'\``).toBeDefined()
  })

  it.each(crons.map(c => [c.path, c] as const))('%s authenticates every request with assertCronRequest', (path) => {
    const route = routes.find(r => r.template === path && (r.method === 'GET' || r.method === 'ALL'))
    expect(route?.source).toMatch(/assertCronRequest|CRON_SECRET/)
  })

  it.each(crons.map(c => [c.path, c] as const))('%s has a valid 5-field cron schedule', (_path, cron) => {
    expect(cron.schedule.trim().split(/\s+/)).toHaveLength(5)
  })
})
```

Run: `npx vitest run --project unit tests/unit/audit/cron-contract.test.ts`
Expected: PASS với route PR6 (file `server/api/internal/<tên>.ts` không có hậu tố method ⇒ `ALL`). Đỏ ở "accepts GET" nghĩa là có người đổi route cron thành chỉ-`POST`: Vercel sẽ không bao giờ chạy được cron đó — thêm file `.get.ts` chứa `export { default } from './<tên>.post'` (inventory đi theo re-export để kiểm xác thực).

- [ ] **Step 9: Viết test hardening cho endpoint vận hành**

`tests/hardening/ops-endpoints.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb } from '../../server/db/client'
import { resetDb } from '../support/db'
import { api, hardeningContext } from '../support/hardening'
import { findPatternLeaks, findTextLeaks } from '../support/leak-scan'

const crons = (JSON.parse(readFileSync('vercel.json', 'utf8')).crons ?? []) as { path: string }[]
const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` })

beforeAll(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe.each([...crons.map(c => c.path), '/api/internal/status'])('GET %s', (path) => {
  it('rejects a missing or wrong secret', async () => {
    expect((await api('GET', path)).status).toBe(401)
    expect((await api('GET', path, { headers: bearer('x'.repeat(40)) })).status).toBe(401)
  })
})

describe('GET /api/internal/status', () => {
  it('reports ok on a freshly reset database and leaks nothing', async () => {
    const res = await api('GET', '/api/internal/status', { headers: bearer(hardeningContext().cronSecret) })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, problems: [] })
    expect(res.body.migrations.applied).toBeGreaterThan(0)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(findTextLeaks(res.text, [hardeningContext().cronSecret, hardeningContext().appEncryptionKey])).toEqual([])
    expect(findPatternLeaks(res.text)).toEqual([])
  })
})
```

- [ ] **Step 10: Giám sát độc lập với Vercel — `.github/workflows/ops-watch.yml`**

```yaml
name: Ops watch

on:
  schedule:
    - cron: '*/15 * * * *'
  workflow_dispatch:

permissions:
  contents: read

jobs:
  status:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    env:
      APP_BASE_URL: ${{ vars.PRODUCTION_URL }}
      CRON_SECRET: ${{ secrets.PRODUCTION_CRON_SECRET }}
    steps:
      - name: Health
        run: curl -fsS --max-time 20 "${APP_BASE_URL}/api/health"
      - name: Operational status (reconcile, expire, stuck transactions)
        run: |
          set -euo pipefail
          code=$(curl -sS -o status.json -w '%{http_code}' --max-time 20 \
            -H "Authorization: Bearer ${CRON_SECRET}" "${APP_BASE_URL}/api/internal/status")
          cat status.json
          test "${code}" = "200"
```

Workflow thất bại sẽ gửi email "Run failed" cho người kích hoạt/watcher repo — đó là kênh cảnh báo thứ hai, không phụ thuộc gói Vercel. Thêm biến `PRODUCTION_URL` (Settings → Variables) và secret `PRODUCTION_CRON_SECRET` (cùng giá trị `CRON_SECRET` của Vercel Production).

- [ ] **Step 11: Chạy hardening và commit**

Run: `npm run test:hardening -- ops-endpoints`
Expected: PASS.

```bash
git add server/services/ops server/api/internal/status.get.ts tests/unit/ops/status.test.ts tests/unit/audit/cron-contract.test.ts tests/hardening/ops-endpoints.test.ts .github/workflows/ops-watch.yml
git commit -m "feat(hardening): add ops status endpoint, GET cron contract and 15-minute watch

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 14: Diễn tập backup/restore bằng Neon snapshot

**Files:**
- Create: `scripts/lib/restore-compare.mjs`, `scripts/restore-drill.mjs`, `tests/unit/ops/restore-compare.test.ts`
- Modify: `package.json` (script `ops:restore-drill`)

**Interfaces:**
- Consumes: Neon CLI 8.4.1 (`neon snapshots create|restore|delete`, `neon branches delete`, `neon connection-string`; đã xác minh bằng `--help`), `@neondatabase/serverless` `Pool`.
- Produces:
  - `APPEND_ONLY_TABLES: string[]` — bảng chỉ tăng (bỏ `rate_limits` và bảng có xoá/ghi đè như option).
  - `compareRestore(args: { before: Record<string, number>; after: Record<string, number>; restored: Record<string, number>; migrations: { before: number; restored: number } }): { ok: boolean; problems: string[] }` — mỗi bảng phải thoả `before ≤ restored ≤ after` (snapshot chụp giữa hai lần đếm) và số migration bằng nhau.
  - `node scripts/restore-drill.mjs <branch> [--dry-run]`: đếm → `neon snapshots create` → đếm → `neon snapshots restore` (**không** finalize, tạo branch kiểm tra `restore-drill-<stamp>`) → đếm trên branch đó → so sánh → luôn dọn branch + snapshot → in `DRILL OK` hoặc danh sách lỗi (exit 1) và ghi `test-results/restore-drill-<stamp>.json`.

- [ ] **Step 1: Viết unit test thất bại**

`tests/unit/ops/restore-compare.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { compareRestore } from '../../../scripts/lib/restore-compare.mjs'

const base = {
  before: { orders: 10, order_payments: 4 },
  after: { orders: 11, order_payments: 4 },
  migrations: { before: 5, restored: 5 },
}

describe('compareRestore', () => {
  it('accepts a restore taken between the two counts', () => {
    expect(compareRestore({ ...base, restored: { orders: 11, order_payments: 4 } })).toEqual({ ok: true, problems: [] })
    expect(compareRestore({ ...base, restored: { orders: 10, order_payments: 4 } }).ok).toBe(true)
  })

  it('flags lost rows', () => {
    const result = compareRestore({ ...base, restored: { orders: 9, order_payments: 4 } })
    expect(result.ok).toBe(false)
    expect(result.problems[0]).toMatch(/orders.*mất dữ liệu/)
  })

  it('flags rows that never existed in the source', () => {
    expect(compareRestore({ ...base, restored: { orders: 12, order_payments: 4 } }).problems[0]).toMatch(/orders.*vượt/)
  })

  it('flags a missing table and a migration mismatch', () => {
    const result = compareRestore({ ...base, restored: { orders: 10 }, migrations: { before: 5, restored: 4 } })
    expect(result.problems).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Chạy để thấy thất bại**

Run: `npx vitest run --project unit tests/unit/ops/restore-compare.test.ts`
Expected: FAIL — cannot resolve `scripts/lib/restore-compare.mjs`.

- [ ] **Step 3: Viết `scripts/lib/restore-compare.mjs`**

```js
export const APPEND_ONLY_TABLES = [
  'user_profiles',
  'organizations',
  'stores',
  'orders',
  'order_items',
  'order_events',
  'order_payments',
  'payment_attempts',
  'bank_transactions',
  'bank_transaction_events',
]

export function compareRestore({ before, after, restored, migrations }) {
  const problems = []
  for (const table of Object.keys(before)) {
    if (!(table in restored)) {
      problems.push(`${table}: thiếu trong bản restore`)
      continue
    }
    if (restored[table] < before[table]) problems.push(`${table}: restore ${restored[table]} < trước snapshot ${before[table]} (mất dữ liệu)`)
    if (restored[table] > after[table]) problems.push(`${table}: restore ${restored[table]} vượt sau snapshot ${after[table]}`)
  }
  if (migrations.restored !== migrations.before) {
    problems.push(`migration: restore ${migrations.restored} ≠ nguồn ${migrations.before}`)
  }
  return { ok: problems.length === 0, problems }
}
```

- [ ] **Step 4: Chạy unit test**

Run: `npx vitest run --project unit tests/unit/ops/restore-compare.test.ts`
Expected: PASS (4 test).

- [ ] **Step 5: Viết `scripts/restore-drill.mjs`**

```js
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { Pool } from '@neondatabase/serverless'
import { APPEND_ONLY_TABLES, compareRestore } from './lib/restore-compare.mjs'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const source = args.find(a => !a.startsWith('--')) ?? 'production'
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const snapshotName = `drill-${stamp}`
const restoredBranch = `restore-drill-${stamp}`
const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString()

function neon(...cliArgs) {
  if (dryRun) {
    console.log(`  $ neon ${cliArgs.join(' ')}`)
    return ''
  }
  return execFileSync('neon', cliArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
}

async function counts(branch) {
  if (dryRun) return { tables: Object.fromEntries(APPEND_ONLY_TABLES.map(t => [t, 0])), migrations: 0 }
  // The connection string is read into memory only; it is never printed.
  const pool = new Pool({ connectionString: neon('connection-string', branch).trim() })
  try {
    const { rows } = await pool.query(
      `select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1)`,
      [APPEND_ONLY_TABLES],
    )
    const tables = {}
    for (const { table_name: name } of rows) {
      tables[name] = (await pool.query(`select count(*)::int as n from public."${name}"`)).rows[0].n
    }
    const migrations = (await pool.query('select count(*)::int as n from drizzle.__drizzle_migrations')).rows[0].n
    return { tables, migrations }
  }
  finally {
    await pool.end()
  }
}

console.log(`Restore drill: nguồn=${source} snapshot=${snapshotName} nhánh kiểm tra=${restoredBranch}${dryRun ? ' (dry-run)' : ''}`)
let outcome = { ok: false, problems: ['drill chưa hoàn tất'] }
try {
  const before = await counts(source)
  neon('snapshots', 'create', '--branch', source, '--name', snapshotName, '--expires-at', expiresAt)
  const after = await counts(source)
  // Not finalized on purpose: production keeps serving; the restore lands in a separate branch for inspection.
  neon('snapshots', 'restore', snapshotName, '--name', restoredBranch)
  const restored = await counts(restoredBranch)
  outcome = compareRestore({
    before: before.tables,
    after: after.tables,
    restored: restored.tables,
    migrations: { before: before.migrations, restored: restored.migrations },
  })
  mkdirSync('test-results', { recursive: true })
  writeFileSync(`test-results/restore-drill-${stamp}.json`, JSON.stringify({ source, before, after, restored, outcome }, null, 2))
}
catch (err) {
  outcome = { ok: false, problems: [`drill lỗi: ${err.message}`] }
}
finally {
  for (const cleanup of [['branches', 'delete', restoredBranch], ['snapshots', 'delete', snapshotName]]) {
    try {
      neon(...cleanup)
    }
    catch (err) {
      console.error(`⚠ Dọn thất bại (${cleanup.join(' ')}): ${err.message} — xoá tay để tránh tốn phí`)
    }
  }
}

if (outcome.ok) console.log(`DRILL OK ${new Date().toISOString()} source=${source}`)
else {
  for (const problem of outcome.problems) console.error(`✗ ${problem}`)
  process.exit(1)
}
```

Thêm vào `package.json` scripts: `"ops:restore-drill": "node scripts/restore-drill.mjs",`

- [ ] **Step 6: Xác minh lệnh bằng dry-run (không chạm Neon)**

Run: `node scripts/restore-drill.mjs production --dry-run`
Expected: in đúng 4 dòng lệnh — `$ neon snapshots create --branch production --name drill-… --expires-at …`, `$ neon snapshots restore drill-… --name restore-drill-…`, `$ neon branches delete restore-drill-…`, `$ neon snapshots delete drill-…` — rồi `DRILL OK …` (dry-run bỏ qua bước đếm nên không kết nối DB).

- [ ] **Step 7: Diễn tập thật trên branch `test` trước, rồi production**

Run: `node scripts/restore-drill.mjs test`
Expected: `DRILL OK …`; `neon branches list` không còn `restore-drill-*`; `neon snapshots list` không còn `drill-*`. Nếu `neon connection-string restore-drill-…` lỗi vì branch khôi phục chưa có compute: chạy `neon branches add-compute restore-drill-<stamp>` rồi lặp lại (ghi cách xử lý vào `docs/operations.md` mục "Backup và restore").

Production chỉ chạy ở mục go-live GL-25: `node scripts/restore-drill.mjs production` (snapshot hết hạn sau 24 giờ và được xoá ngay trong `finally`).

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/restore-compare.mjs scripts/restore-drill.mjs tests/unit/ops/restore-compare.test.ts package.json
git commit -m "feat(hardening): add Neon snapshot restore drill

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 15: Tách môi trường — kiểm tra biến, CI không clone dữ liệu production, smoke sau deploy

**Files:**
- Create: `scripts/lib/env-check.mjs`, `scripts/check-env.mjs`, `scripts/lib/smoke.mjs`, `scripts/smoke-prod.mjs`, `tests/unit/ops/env-check.test.ts`, `tests/unit/ops/smoke.test.ts`
- Modify: `package.json` (scripts `check:env`, `smoke:prod`), `.github/workflows/ci.yml` (`branch_type: schema-only`)

**Interfaces:**
- Consumes: file env dạng dotenv (`vercel env pull`), `fetch` toàn cục.
- Produces:
  - `validateEnv(args: { target: 'production' | 'preview' | 'test'; env: Record<string, string | undefined>; other?: Record<string, string | undefined> }): string[]` — danh sách vấn đề (không bao giờ chứa giá trị secret).
  - `checkSecurityHeaders(headers: Headers, opts: { https: boolean }): string[]`
  - `runSmoke(args: { baseUrl: string; slug?: string; cronSecret?: string; fetchImpl?: typeof fetch }): Promise<string[]>`
  - CLI: `npm run check:env -- --file <env> --target <t> [--compare <env>]`, `npm run smoke:prod -- <baseUrl> [--slug <slug>]` (đọc `CRON_SECRET` từ môi trường nếu có).

**Quy tắc `validateEnv`:**
- Mọi target: có đủ `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL`, `APP_ENCRYPTION_KEY`, `CRON_SECRET`, `APP_BASE_URL`, `AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`; `APP_ENCRYPTION_KEY` là base64 của đúng 32 byte; `CRON_SECRET` ≥ 32 ký tự; không có khoá `SEPAY_*` (khoá SePay nằm mã hoá trong DB theo từng integration).
- `production`: không có `ZENO_TEST_DB`, `AUTH_TEST_JWKS`; `NEON_BRANCH` vắng hoặc `production`; `APP_BASE_URL` là `https://` không có `/` cuối và không phải `localhost`; `DATABASE_URL` là pooled (`-pooler`), `DATABASE_URL_UNPOOLED` thì không.
- `preview`: không có `AUTH_TEST_JWKS`; `NEON_BRANCH` (nếu có) ≠ `production`; `APP_BASE_URL` https.
- `test`: `ZENO_TEST_DB=1`; `NEON_BRANCH` có và ≠ `production`.
- `other` (so sánh hai môi trường): `APP_ENCRYPTION_KEY`, `CRON_SECRET` phải khác; `DATABASE_URL`/`DATABASE_URL_UNPOOLED` phải trỏ DB khác (so host đã bỏ `-pooler` + tên DB); `NEON_AUTH_BASE_URL` phải khác.

- [ ] **Step 1: Viết unit test thất bại cho `validateEnv`**

`tests/unit/ops/env-check.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { validateEnv } from '../../../scripts/lib/env-check.mjs'

const key = Buffer.alloc(32, 7).toString('base64')
const production = {
  DATABASE_URL: 'postgresql://u:p@ep-prod-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
  DATABASE_URL_UNPOOLED: 'postgresql://u:p@ep-prod.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
  NEON_AUTH_BASE_URL: 'https://ep-prod.neonauth.ap-southeast-1.aws.neon.tech/neondb/auth',
  NEON_AUTH_JWKS_URL: 'https://ep-prod.neonauth.ap-southeast-1.aws.neon.tech/neondb/auth/.well-known/jwks.json',
  APP_ENCRYPTION_KEY: key,
  CRON_SECRET: 'p'.repeat(48),
  APP_BASE_URL: 'https://order.example.vn',
  AWS_ENDPOINT_URL_S3: 'https://s3.example.neon.tech',
  AWS_ACCESS_KEY_ID: 'AKIA-PROD',
  AWS_SECRET_ACCESS_KEY: 'secret-prod',
  AWS_REGION: 'auto',
}
const test = {
  ...production,
  DATABASE_URL: 'postgresql://u:p@ep-test-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
  DATABASE_URL_UNPOOLED: 'postgresql://u:p@ep-test.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
  NEON_AUTH_BASE_URL: 'https://ep-test.neonauth.ap-southeast-1.aws.neon.tech/neondb/auth',
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  CRON_SECRET: 't'.repeat(48),
  APP_BASE_URL: 'http://localhost:3100',
  ZENO_TEST_DB: '1',
  NEON_BRANCH: 'test',
}

const run = (target: 'production' | 'preview' | 'test', env: Record<string, string | undefined>, other?: Record<string, string | undefined>) =>
  validateEnv({ target, env, other })

describe('validateEnv', () => {
  it('accepts a correct production and test pair', () => {
    expect(run('production', production, test)).toEqual([])
    expect(run('test', test, production)).toEqual([])
  })

  it('rejects test-only switches and a non-production branch in production', () => {
    const problems = run('production', { ...production, ZENO_TEST_DB: '1', AUTH_TEST_JWKS: '{}', NEON_BRANCH: 'test' })
    expect(problems.join('\n')).toMatch(/ZENO_TEST_DB/)
    expect(problems.join('\n')).toMatch(/AUTH_TEST_JWKS/)
    expect(problems.join('\n')).toMatch(/NEON_BRANCH/)
  })

  it.each([
    ['http scheme', 'http://order.example.vn'],
    ['trailing slash', 'https://order.example.vn/'],
    ['localhost', 'https://localhost:3000'],
  ])('rejects APP_BASE_URL with %s in production', (_label, value) => {
    expect(run('production', { ...production, APP_BASE_URL: value }).join('\n')).toMatch(/APP_BASE_URL/)
  })

  it('requires a pooled runtime URL and an unpooled migration URL', () => {
    const problems = run('production', { ...production, DATABASE_URL: production.DATABASE_URL_UNPOOLED, DATABASE_URL_UNPOOLED: production.DATABASE_URL })
    expect(problems.join('\n')).toMatch(/DATABASE_URL .*pooled/)
    expect(problems.join('\n')).toMatch(/DATABASE_URL_UNPOOLED .*không được/)
  })

  it('validates the encryption key and cron secret strength', () => {
    const problems = run('production', { ...production, APP_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64'), CRON_SECRET: 'short' })
    expect(problems.join('\n')).toMatch(/APP_ENCRYPTION_KEY/)
    expect(problems.join('\n')).toMatch(/CRON_SECRET/)
  })

  it('reports missing variables and SEPAY_* keys', () => {
    const { AWS_REGION, ...rest } = production
    void AWS_REGION
    const problems = run('production', { ...rest, SEPAY_HMAC_SECRET: 'x' })
    expect(problems.join('\n')).toMatch(/thiếu AWS_REGION/)
    expect(problems.join('\n')).toMatch(/SEPAY_HMAC_SECRET/)
  })

  it('detects secrets and databases shared between two environments without printing values', () => {
    const shared = { ...test, APP_ENCRYPTION_KEY: production.APP_ENCRYPTION_KEY, CRON_SECRET: production.CRON_SECRET, DATABASE_URL: production.DATABASE_URL, DATABASE_URL_UNPOOLED: production.DATABASE_URL_UNPOOLED, NEON_AUTH_BASE_URL: production.NEON_AUTH_BASE_URL }
    const problems = run('test', shared, production)
    expect(problems.join('\n')).toMatch(/APP_ENCRYPTION_KEY .*trùng/)
    expect(problems.join('\n')).toMatch(/CRON_SECRET .*trùng/)
    expect(problems.join('\n')).toMatch(/DATABASE_URL .*cùng/)
    expect(problems.join('\n')).toMatch(/NEON_AUTH_BASE_URL .*trùng/)
    expect(problems.join('\n')).not.toContain(production.APP_ENCRYPTION_KEY)
    expect(problems.join('\n')).not.toContain(production.CRON_SECRET)
  })

  it('requires the test switch on the test environment and forbids test jwks in preview', () => {
    expect(run('test', { ...test, ZENO_TEST_DB: undefined }).join('\n')).toMatch(/ZENO_TEST_DB/)
    expect(run('test', { ...test, NEON_BRANCH: 'production' }).join('\n')).toMatch(/NEON_BRANCH/)
    expect(run('preview', { ...test, ZENO_TEST_DB: undefined, APP_BASE_URL: 'https://pr-1.example.vn', AUTH_TEST_JWKS: '{}' }).join('\n')).toMatch(/AUTH_TEST_JWKS/)
  })
})
```

- [ ] **Step 2: Chạy để thấy thất bại**

Run: `npx vitest run --project unit tests/unit/ops/env-check.test.ts`
Expected: FAIL — cannot resolve `scripts/lib/env-check.mjs`.

- [ ] **Step 3: Viết `scripts/lib/env-check.mjs`**

```js
const REQUIRED = [
  'DATABASE_URL',
  'DATABASE_URL_UNPOOLED',
  'NEON_AUTH_BASE_URL',
  'NEON_AUTH_JWKS_URL',
  'APP_ENCRYPTION_KEY',
  'CRON_SECRET',
  'APP_BASE_URL',
  'AWS_ENDPOINT_URL_S3',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_REGION',
]

function parseUrl(value) {
  try {
    return new URL(value)
  }
  catch {
    return null
  }
}

/** Host without "-pooler" plus database name: two URLs with the same identity hit the same database. */
function dbIdentity(value) {
  const url = parseUrl(value)
  return url ? `${url.hostname.replace('-pooler', '')}${url.pathname}` : null
}

export function validateEnv({ target, env, other }) {
  const problems = []
  const has = name => Boolean(env[name])

  for (const name of REQUIRED) if (!has(name)) problems.push(`thiếu ${name}`)
  for (const name of Object.keys(env)) {
    if (/^SEPAY_/i.test(name)) problems.push(`${name}: khoá SePay phải nằm mã hoá trong DB (sepay_integrations), không nằm trong env`)
  }

  if (has('APP_ENCRYPTION_KEY') && Buffer.from(env.APP_ENCRYPTION_KEY, 'base64').length !== 32) {
    problems.push('APP_ENCRYPTION_KEY phải là base64 của đúng 32 byte (openssl rand -base64 32)')
  }
  if (has('CRON_SECRET') && env.CRON_SECRET.length < 32) problems.push('CRON_SECRET phải dài ≥ 32 ký tự (openssl rand -hex 32)')

  if (target === 'production') {
    for (const name of ['ZENO_TEST_DB', 'AUTH_TEST_JWKS']) if (has(name)) problems.push(`${name} không được đặt ở production`)
    if (has('NEON_BRANCH') && env.NEON_BRANCH !== 'production') problems.push(`NEON_BRANCH phải là production (đang là ${env.NEON_BRANCH})`)
  }
  if (target === 'preview') {
    if (has('AUTH_TEST_JWKS')) problems.push('AUTH_TEST_JWKS không được đặt ở preview')
    if (has('NEON_BRANCH') && env.NEON_BRANCH === 'production') problems.push('NEON_BRANCH không được là production ở preview')
  }
  if (target === 'test') {
    if (env.ZENO_TEST_DB !== '1') problems.push('ZENO_TEST_DB phải bằng 1 ở môi trường test')
    if (!has('NEON_BRANCH') || env.NEON_BRANCH === 'production') problems.push('NEON_BRANCH phải có và không được là production ở môi trường test')
  }

  if ((target === 'production' || target === 'preview') && has('APP_BASE_URL')) {
    const url = parseUrl(env.APP_BASE_URL)
    if (!url || url.protocol !== 'https:') problems.push('APP_BASE_URL phải là https://')
    else if (env.APP_BASE_URL.endsWith('/')) problems.push('APP_BASE_URL không được có dấu / ở cuối')
    else if (target === 'production' && /^(localhost|127\.|\[?::1)/.test(url.hostname)) problems.push('APP_BASE_URL không được là localhost ở production')
  }
  if (target === 'production') {
    if (has('DATABASE_URL') && !/-pooler/.test(env.DATABASE_URL)) problems.push('DATABASE_URL production phải là connection pooled (-pooler)')
    if (has('DATABASE_URL_UNPOOLED') && /-pooler/.test(env.DATABASE_URL_UNPOOLED)) problems.push('DATABASE_URL_UNPOOLED không được là connection pooled')
  }

  if (other) {
    for (const name of ['APP_ENCRYPTION_KEY', 'CRON_SECRET', 'NEON_AUTH_BASE_URL']) {
      if (has(name) && env[name] === other[name]) problems.push(`${name} trùng giữa hai môi trường`)
    }
    for (const name of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED']) {
      const mine = has(name) ? dbIdentity(env[name]) : null
      if (mine && mine === dbIdentity(other[name] ?? '')) problems.push(`${name} trỏ cùng một database ở cả hai môi trường`)
    }
  }
  return problems
}
```

- [ ] **Step 4: Viết `scripts/check-env.mjs`**

```js
import { readFileSync } from 'node:fs'
import { parseArgs, parseEnv } from 'node:util'
import { validateEnv } from './lib/env-check.mjs'

const { values } = parseArgs({ options: { file: { type: 'string' }, target: { type: 'string' }, compare: { type: 'string' } } })
if (!values.file || !['production', 'preview', 'test'].includes(values.target ?? '')) {
  console.error('Usage: npm run check:env -- --file <env-file> --target production|preview|test [--compare <env-file>]')
  process.exit(2)
}

const load = file => parseEnv(readFileSync(file, 'utf8'))
const problems = validateEnv({
  target: values.target,
  env: load(values.file),
  other: values.compare ? load(values.compare) : undefined,
})
if (problems.length === 0) {
  console.log(`✓ ${values.file} hợp lệ cho ${values.target}`)
}
else {
  for (const problem of problems) console.error(`✗ ${problem}`)
  process.exit(1)
}
```

- [ ] **Step 5: Viết unit test thất bại cho smoke**

`tests/unit/ops/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { checkSecurityHeaders, runSmoke } from '../../../scripts/lib/smoke.mjs'

const goodHeaders = () => new Headers({
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
  'strict-transport-security': 'max-age=31536000',
})

describe('checkSecurityHeaders', () => {
  it('accepts the expected headers', () => {
    expect(checkSecurityHeaders(goodHeaders(), { https: true })).toEqual([])
  })

  it('reports every missing header, and HSTS only over https', () => {
    const empty = new Headers()
    expect(checkSecurityHeaders(empty, { https: true })).toHaveLength(4)
    expect(checkSecurityHeaders(empty, { https: false })).toHaveLength(3)
  })
})

function fakeFetch(routes: Record<string, () => Response>) {
  return async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const key = `${url.pathname}`
    const handler = routes[key]
    return handler ? handler() : new Response('{}', { status: 404 })
  }
}

const json = (body: unknown, init: ResponseInit = {}) => () => new Response(JSON.stringify(body), { status: 200, ...init, headers: { 'content-type': 'application/json', ...Object.fromEntries(goodHeaders()), ...(init.headers as Record<string, string>) } })
const status = (code: number) => () => new Response('{}', { status: code, headers: Object.fromEntries(goodHeaders()) })

describe('runSmoke', () => {
  const healthy = {
    '/api/health': json({ status: 'ok' }),
    '/': () => new Response('<html></html>', { status: 200, headers: Object.fromEntries(goodHeaders()) }),
    '/api/me': status(401),
    '/api/internal/status': status(401),
    '/api/public/stores/demo/menu': json({ store: { name: 'Demo' } }, { headers: { 'cache-control': 'public, max-age=30, s-maxage=60' } }),
    '/api/public/stores/__not-a-store__/menu': status(404),
  }

  it('passes a healthy deployment', async () => {
    expect(await runSmoke({ baseUrl: 'https://order.example.vn', slug: 'demo', fetchImpl: fakeFetch(healthy) as typeof fetch })).toEqual([])
  })

  it('flags a public status endpoint and a menu that leaks orgId', async () => {
    const leaky = {
      ...healthy,
      '/api/internal/status': json({ ok: true }),
      '/api/public/stores/demo/menu': json({ orgId: 'x' }, { headers: { 'cache-control': 'public, s-maxage=60' } }),
    }
    const problems = await runSmoke({ baseUrl: 'https://order.example.vn', slug: 'demo', fetchImpl: fakeFetch(leaky) as typeof fetch })
    expect(problems.join('\n')).toMatch(/internal\/status.*401/)
    expect(problems.join('\n')).toMatch(/orgId/)
  })

  it('checks the authenticated status when a cron secret is given', async () => {
    const withSecret = {
      ...healthy,
      '/api/internal/status': () => new Response(JSON.stringify({ ok: false, problems: ['x'] }), { status: 503, headers: Object.fromEntries(goodHeaders()) }),
    }
    const problems = await runSmoke({ baseUrl: 'https://order.example.vn', cronSecret: 'c'.repeat(40), fetchImpl: fakeFetch(withSecret) as typeof fetch })
    expect(problems.join('\n')).toMatch(/status.*503/)
  })
})
```

Ghi chú: `runSmoke` gọi `/api/internal/status` hai lần khi có `cronSecret` (không secret → mong `401`, có secret → mong `200`); `fakeFetch` của test cuối trả `503` cho cả hai lần nên sinh hai vấn đề, và kỳ vọng chỉ cần có vấn đề chứa `status` và `503`.

- [ ] **Step 6: Chạy để thấy thất bại**

Run: `npx vitest run --project unit tests/unit/ops/smoke.test.ts tests/unit/ops/env-check.test.ts`
Expected: smoke FAIL (không resolve `scripts/lib/smoke.mjs`); env-check FAIL tới khi Step 3 xong — chạy lại sau Step 7 để thấy cả hai PASS.

- [ ] **Step 7: Viết `scripts/lib/smoke.mjs` và `scripts/smoke-prod.mjs`**

`scripts/lib/smoke.mjs`:

```js
export function checkSecurityHeaders(headers, { https }) {
  const problems = []
  if (headers.get('x-content-type-options') !== 'nosniff') problems.push('thiếu X-Content-Type-Options: nosniff')
  if (headers.get('x-frame-options') !== 'DENY') problems.push('thiếu X-Frame-Options: DENY')
  if (!(headers.get('content-security-policy') ?? '').includes("frame-ancestors 'none'")) problems.push("thiếu Content-Security-Policy có frame-ancestors 'none'")
  if (https && !headers.get('strict-transport-security')) problems.push('thiếu Strict-Transport-Security')
  return problems
}

export async function runSmoke({ baseUrl, slug, cronSecret, fetchImpl = fetch }) {
  const problems = []
  const https = baseUrl.startsWith('https://')
  const get = (path, headers) => fetchImpl(`${baseUrl}${path}`, { headers, redirect: 'manual' })
  const expectStatus = async (path, expected, headers) => {
    const res = await get(path, headers)
    if (res.status !== expected) problems.push(`GET ${path}: mong ${expected}, nhận ${res.status}`)
    return res
  }

  const health = await expectStatus('/api/health', 200)
  if (health.ok && (await health.json().catch(() => null))?.status !== 'ok') problems.push('GET /api/health: body không phải { status: "ok" }')

  const home = await expectStatus('/', 200)
  for (const problem of checkSecurityHeaders(home.headers, { https })) problems.push(`GET /: ${problem}`)

  await expectStatus('/api/me', 401)
  await expectStatus('/api/internal/status', 401)
  if (cronSecret) await expectStatus('/api/internal/status', 200, { authorization: `Bearer ${cronSecret}` })

  if (slug) {
    const menu = await expectStatus(`/api/public/stores/${slug}/menu`, 200)
    if (!(menu.headers.get('cache-control') ?? '').includes('s-maxage=')) problems.push('menu: thiếu Cache-Control s-maxage (CDN không cache được)')
    if (/orgId|customerPhone|tokenHash/.test(await menu.text())) problems.push('menu: response chứa orgId/customerPhone/tokenHash')
    await expectStatus('/api/public/stores/__not-a-store__/menu', 404)
  }
  return problems
}
```

`scripts/smoke-prod.mjs`:

```js
import { parseArgs } from 'node:util'
import { runSmoke } from './lib/smoke.mjs'

const { values, positionals } = parseArgs({ allowPositionals: true, options: { slug: { type: 'string' } } })
const baseUrl = positionals[0]?.replace(/\/$/, '')
if (!baseUrl) {
  console.error('Usage: npm run smoke:prod -- <baseUrl> [--slug <store-slug>]   (CRON_SECRET trong env để kiểm /api/internal/status)')
  process.exit(2)
}

const problems = await runSmoke({ baseUrl, slug: values.slug, cronSecret: process.env.CRON_SECRET })
if (problems.length === 0) console.log(`✓ Smoke OK: ${baseUrl}`)
else {
  for (const problem of problems) console.error(`✗ ${problem}`)
  process.exit(1)
}
```

Thêm vào `package.json` scripts:

```json
    "check:env": "node scripts/check-env.mjs",
    "smoke:prod": "node scripts/smoke-prod.mjs",
```

- [ ] **Step 8: Chạy unit test**

Run: `npx vitest run --project unit tests/unit/ops/env-check.test.ts tests/unit/ops/smoke.test.ts`
Expected: PASS.

- [ ] **Step 9: Chạy kiểm tra thật trên env local**

Run: `npm run check:env -- --file .env.test --target test`
Expected: `✓ .env.test hợp lệ cho test` (nếu thiếu biến PR3/PR6 như `APP_ENCRYPTION_KEY`, `CRON_SECRET`: thêm vào `.env.test` giá trị riêng của test — **khác** production).

- [ ] **Step 10: CI không clone dữ liệu khách của production**

Trong `.github/workflows/ci.yml`, step `neondatabase/create-branch-action@v6`, thêm dưới `parent_branch: production`:

```yaml
          branch_type: schema-only
```

Mục đích: branch CI chỉ có schema (test luôn `resetDb()` và tự tạo dữ liệu), nên không bao giờ chứa SĐT/địa chỉ khách thật. Push và xác nhận job `integration` vẫn xanh (nếu `neon env pull` không trả `NEON_AUTH_*` cho branch schema-only thì ghi lại và báo — không quay về clone dữ liệu).

- [ ] **Step 11: Commit**

```bash
git add scripts/lib/env-check.mjs scripts/check-env.mjs scripts/lib/smoke.mjs scripts/smoke-prod.mjs tests/unit/ops/env-check.test.ts tests/unit/ops/smoke.test.ts package.json .github/workflows/ci.yml
git commit -m "feat(hardening): validate environment separation and add post-deploy smoke

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 16: Tài liệu vận hành, go-live checklist, runbook pilot và rollback

**Files:**
- Create: `docs/operations.md`, `docs/go-live-checklist.md`, `docs/pilot-runbook.md`, `docs/pilot-report.md`, `tests/unit/audit/go-live-checklist.test.ts`, `app/pages/privacy.vue`
- Modify: `app/pages/s/[slug].vue` (liên kết chân trang), `tests/e2e-hardening/a11y.spec.ts` (test chính sách quyền riêng tư)

**Interfaces:**
- Consumes: mọi script/test của Task 1–15 (checklist chỉ được trỏ tới thứ đã tồn tại); `expectNoA11yViolations`, `expectNoCspViolations`, `watchCsp` (Task 10).
- Produces:
  - `docs/go-live-checklist.md`: 38 mục `GL-01`…`GL-38`, mỗi mục một dòng `- [ ] **GL-NN** <mô tả> — Verify: \`<lệnh>\` — Expect: <kết quả>`.
  - `docs/operations.md`: có đủ các mục `## Môi trường`, `## Biến môi trường và secret`, `## Deploy và migration`, `## Backup và restore`, `## Rollback`, `## Đối soát thủ công khi webhook gián đoạn`, `## Giám sát và cảnh báo`, `## Sự cố`, `## Performance budget`, `## Dependency audit`, `## Quyết định bảo mật`.
  - `docs/pilot-runbook.md`: có `## Kill switch` và `## Rollback`; `docs/pilot-report.md`: bảng `P-01`…`P-10` theo PRD §15.
  - Test cưỡng chế: mọi mục có `Verify` + `Expect`, đánh số liên tục, chỉ trỏ tới npm script và file có thật.

- [ ] **Step 1: Viết test thất bại cho định dạng tài liệu**

`tests/unit/audit/go-live-checklist.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')
const checklist = read('docs/go-live-checklist.md')
const items = checklist.split('\n').filter(line => /^- \[[ x]\] /.test(line))
const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>

describe('docs/go-live-checklist.md', () => {
  it('has the full set of items', () => {
    expect(items.length).toBeGreaterThanOrEqual(38)
  })

  it('numbers items GL-01… without gaps or duplicates', () => {
    const ids = items.map(line => line.match(/\*\*(GL-\d{2})\*\*/)?.[1])
    expect(ids).toEqual(items.map((_, index) => `GL-${String(index + 1).padStart(2, '0')}`))
  })

  it.each(items.map(line => [line.slice(6, 44), line] as const))('%s… has a Verify command and an Expect', (_label, line) => {
    expect(line).toMatch(/ — Verify: `[^`]+`/)
    expect(line).toMatch(/ — Expect: \S/)
  })

  it('only references npm scripts that exist', () => {
    const missing = new Set<string>()
    for (const [, name] of checklist.matchAll(/\bnpm (?:run )?([\w:.-]+)/g)) {
      if (!(name! in scripts)) missing.add(name!)
    }
    expect([...missing]).toEqual([])
  })

  it('only references repository files that exist', () => {
    const missing = new Set<string>()
    for (const [path] of checklist.matchAll(/(?:scripts|tests|docs|server|\.github)\/[\w./-]+\.(?:mjs|ts|md|yml|json)/g)) {
      if (!existsSync(path)) missing.add(path)
    }
    expect([...missing]).toEqual([])
  })
})

describe('docs/operations.md', () => {
  const operations = read('docs/operations.md')

  it.each([
    'Môi trường',
    'Biến môi trường và secret',
    'Deploy và migration',
    'Backup và restore',
    'Rollback',
    'Đối soát thủ công khi webhook gián đoạn',
    'Giám sát và cảnh báo',
    'Sự cố',
    'Performance budget',
    'Dependency audit',
    'Quyết định bảo mật',
  ])('has the section "%s"', (heading) => {
    expect(operations).toContain(`\n## ${heading}\n`)
  })
})

describe('pilot documents', () => {
  it('runbook has a kill switch and a rollback plan', () => {
    const runbook = read('docs/pilot-runbook.md')
    expect(runbook).toContain('\n## Kill switch\n')
    expect(runbook).toContain('\n## Rollback\n')
  })

  it('report lists the ten PRD §15 pilot checks', () => {
    const report = read('docs/pilot-report.md')
    for (let n = 1; n <= 10; n++) expect(report).toContain(`| P-${String(n).padStart(2, '0')} |`)
  })

  it('the ops watch workflow exists', () => {
    expect(existsSync('.github/workflows/ops-watch.yml')).toBe(true)
  })
})
```

- [ ] **Step 2: Chạy để thấy thất bại**

Run: `npx vitest run --project unit tests/unit/audit/go-live-checklist.test.ts`
Expected: FAIL — `ENOENT docs/go-live-checklist.md`.

- [ ] **Step 3: Viết `docs/operations.md`**

````markdown
# ZENO Order — Vận hành

Tài liệu cho người trực. Mọi lệnh chạy từ thư mục gốc repo. Không dán secret vào chat/issue; log và `check:env` không bao giờ in giá trị secret.

## Môi trường

| Môi trường | Vercel | Neon DB | Neon Auth | Ghi chú |
|---|---|---|---|---|
| Production | Production | branch **`production`** (mặc định) | production | dữ liệu thật; chỉ migrate sau khi test xanh |
| Preview | Preview | branch riêng, **không bao giờ** trỏ `production` | branch riêng | kiểm bằng `npm run check:env -- --target preview` |
| Test/dev | local | branch **`test`** (`.env.test`) | branch `test` | `resetDb()` **xoá sạch** branch này; `assertTestDatabase()` từ chối `NEON_BRANCH=production` |
| CI | GitHub Actions | `ci-<run_id>` `schema-only`, tự xoá sau ≤ 2 giờ | — | không chứa dữ liệu khách |

Sau `neon checkout <branch>` **phải restart dev server** (Nitro giữ `process.env` cũ). Kiểm branch hiện tại: `neon branches list` (dòng `[current]`).

## Biến môi trường và secret

| Biến | Production | Test | Sinh/đặt thế nào |
|---|---|---|---|
| `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` | branch `production` | branch `test` | `neon cs production --pooled` / `neon cs production` |
| `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL` | auth production | auth `test` | `neon env pull --branch production --file <file>` |
| `APP_ENCRYPTION_KEY` | khác test | khác production | `openssl rand -base64 32` (đúng 32 byte) |
| `CRON_SECRET` | khác test | khác production | `openssl rand -hex 32` |
| `APP_BASE_URL` | `https://<domain>` không có `/` cuối | `http://localhost:3100` | dùng để dựng link QR bàn và VietQR |
| `AWS_*` (Object Storage) | bucket production | bucket test | `neon env pull` |
| `ZENO_TEST_DB`, `AUTH_TEST_JWKS` | **không được có** | `ZENO_TEST_DB=1` | chỉ test |
| Khoá SePay (HMAC, API token) | **không nằm trong env** | — | owner nhập trong app, lưu mã hoá trong `sepay_integrations` |

Đặt biến trên Vercel: `vercel env add <NAME> production` (và `preview` với giá trị **khác**). Kiểm: `vercel env pull .env.vercel.production --environment=production --yes && npm run check:env -- --file .env.vercel.production --target production --compare .env.test`; xoá file sau khi dùng (`rm .env.vercel.*`, đã được `.gitignore`).

**Xoay vòng `CRON_SECRET`:** (1) sinh khoá mới; (2) `vercel env add CRON_SECRET production` rồi redeploy; (3) cập nhật secret GitHub `PRODUCTION_CRON_SECRET`; (4) `curl -fsS -H "Authorization: Bearer $CRON_SECRET" "$APP_BASE_URL/api/internal/status"` phải `200`.

**Xoay vòng `APP_ENCRYPTION_KEY`** (V1 không có script mã hoá lại; thực hiện trong khung giờ vắng khách): (1) `neon snapshots create --branch production --name pre-rotate-<ngày>`; (2) sinh khoá mới, đặt trên Vercel, redeploy; (3) từng owner nhập lại HMAC secret/API token trong Cài đặt → Thanh toán & SePay (tăng `key_version`); (4) trong lúc chờ webhook sẽ lỗi và reconcile báo lỗi — đây là hành vi mong đợi, SePay gửi lại; (5) xác nhận bằng "Gửi thử" của SePay và `/api/internal/status` trả `ok: true`; (6) mã hoá `guest_token_encrypted` cũ không giải mã được nữa — chỉ ảnh hưởng retry idempotent của đơn đã tạo trước đó, không ảnh hưởng tracking (tra bằng hash).

## Deploy và migration

Nguyên tắc **expand/contract**: migration chỉ thêm (cột nullable/bảng/index) để bản app cũ vẫn chạy; xoá/đổi tên làm ở PR sau khi không còn code cũ dùng.

1. Trên branch `test`: `ENV_FILE=.env.test npx drizzle-kit migrate` rồi `npm run test:integration && npm run test:api && npm run test:hardening`.
2. **Snapshot trước khi chạm production:** `neon snapshots create --branch production --name pre-<tên-migration> --expires-at <+14 ngày RFC3339>`.
3. Lấy env production vào file tạm và migrate: `neon env pull --branch production --file .env.production && ENV_FILE=.env.production npx drizzle-kit migrate && rm .env.production`.
4. Deploy: merge vào `main` (Vercel tự deploy) hoặc `vercel deploy --prod`.
5. Sau deploy: `npm run smoke:prod -- https://<domain-production> --slug <pilot-slug>` (có `CRON_SECRET` trong env để kiểm `/api/internal/status`).

Gói Vercel: cron mỗi 15 phút (`reconcile-sepay`) và 5 phút (`expire-payment-attempts`) cần **Pro**; gói Hobby chỉ cho cron tối đa 1 lần/ngày và deploy sẽ bị từ chối. Nếu buộc phải ở Hobby, gọi cron từ GitHub Actions (`schedule`) bằng `curl -X POST -H "Authorization: Bearer $CRON_SECRET" "$APP_BASE_URL/api/internal/reconcile-sepay"` — route POST gốc của PR6 vẫn hoạt động.

## Backup và restore

- **Lịch snapshot tự động:** `neon snapshots schedule set --branch production --frequency daily --hour 3 --retention 604800` (mỗi ngày 03:00, giữ 7 ngày); xem lại bằng `neon snapshots schedule get --branch production`.
- **Diễn tập (bắt buộc trước go-live, lặp lại hằng quý):** `npm run ops:restore-drill -- production` — chụp snapshot, khôi phục sang branch kiểm tra **không finalize**, đếm bảng chỉ-tăng và số migration, so với nguồn, rồi dọn. Kết quả `DRILL OK <thời điểm>` dán vào `docs/pilot-report.md`. Thử trước trên `test` bằng `npm run ops:restore-drill -- test`.
- **Chỉ xem dữ liệu quá khứ (không ghi):** `neon cs production@<RFC3339>` rồi `neon psql production@<RFC3339> -- -tAc "select count(*) from orders"`.
- **Khôi phục tại chỗ về một thời điểm** (chỉ branch gốc; luôn giữ bản cũ): `neon branches restore production ^self@<RFC3339> --preserve-under-name production_pre_restore_<ngày>`.
- **Khôi phục từ snapshot rồi hoán đổi:** `neon snapshots restore <tên> --name recovered` (kiểm tra branch `recovered`), rồi `neon snapshots finalize recovered`.
- **Hệ quả cần biết:** khôi phục production cũng đưa **Neon Auth** (tài khoản, phiên) và mọi **đơn tạo sau thời điểm đó** về quá khứ. Đơn/thanh toán bị mất nằm ở branch được giữ lại: xuất bằng `neon psql production_pre_restore_<ngày> -- -tAc "select public_code, total_vnd, created_at from orders where created_at > '<RFC3339>'"` và báo cửa hàng. Sau restore: `npm run smoke:prod -- <url>`, chạy reconcile (xem mục dưới) để SePay bù giao dịch, rồi đối chiếu `bank_transactions`.
- Nếu `neon cs restore-drill-…` lỗi vì branch khôi phục chưa có compute: `neon branches add-compute restore-drill-<stamp>`.

## Rollback

| Lớp | Cách rollback | Lệnh |
|---|---|---|
| Ứng dụng | quay về deployment trước, giữ nguyên DB (migration expand/contract tương thích ngược) | `vercel rollback <deployment-url-trước> --yes`, rồi `npm run smoke:prod -- <url>` |
| Migration | **không có down-migration**; sửa tiến bằng migration mới. Chỉ khi dữ liệu hỏng mới restore (mục trên) | `neon snapshots restore pre-<tên-migration> --name recovered` |
| Nhận đơn | tắt từng cửa hàng ngay (kill switch) | Cài đặt → "Tạm nghỉ", hoặc `neon psql production -- -c "update stores set is_accepting_orders = false where slug = '<slug>'"` |
| Thanh toán online | tắt tích hợp SePay: webhook trả 404, SePay gửi lại; tiền vẫn nằm ở ngân hàng owner, đối soát sau | `neon psql production -- -c "update sepay_integrations set status = 'DISABLED' where id = '<id>'"` |

## Đối soát thủ công khi webhook gián đoạn

1. **Phát hiện:** `ops-watch` đỏ, hoặc `/api/internal/status` trả `503` với `RECEIVED`/`reconcile` trong `problems`.
2. **Chạy reconcile ngay:** `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" "$APP_BASE_URL/api/internal/reconcile-sepay"` (và `…/expire-payment-attempts`). Reconcile match lại mọi giao dịch `RECEIVED` và kéo giao dịch mới từ API SePay nếu integration có API token.
3. **Xem hàng đợi:** `neon psql production -- -tAc "select reconciliation_status, count(*) from bank_transactions group by 1"`; owner vào `/app/reconciliation` xử lý `REVIEW_REQUIRED`.
4. **Không có API token / SePay API lỗi:** xuất giao dịch từ dashboard SePay, đối chiếu theo `payment_code` + số tiền; với đơn đã nhận tiền thật, owner dùng "Đã thu (chuyển khoản thủ công)" (bắt buộc ghi chú, có audit). Không bao giờ sửa `order_payments` bằng SQL tay.
5. **Tiền chuyển muộn / sau khi huỷ:** hệ thống đã đặt `late_payment` hoặc `REFUND_DUE`; owner hoàn tiền ngoài hệ thống rồi bấm "Đã hoàn tiền" kèm ghi chú bằng chứng.

## Giám sát và cảnh báo

| Lớp | Công cụ | Tần suất | Báo khi |
|---|---|---|---|
| Còn sống | monitor ngoài (UptimeRobot/Better Stack) gọi `GET <url>/api/health` | 1 phút | không `200` 2 lần liên tiếp |
| Vận hành | `.github/workflows/ops-watch.yml` gọi `/api/internal/status` | 15 phút | không `200` ⇒ job đỏ ⇒ email GitHub |
| Log (Vercel Log Drain hoặc Observability Alerts) | truy vấn bên dưới | 15 phút | vượt ngưỡng |

Mẫu truy vấn log (mọi dòng là JSON; `path` đã che token):

| Cảnh báo | Điều kiện | Ngưỡng | Ý nghĩa |
|---|---|---|---|
| Webhook xác thực thất bại | `msg="webhook.auth_failed"` (trường `reason`: `MISSING`/`STALE`/`MISMATCH`) | > 5 / 15 phút | giả mạo hoặc lệch secret/chế độ xác thực |
| Webhook dò key | `msg="http.request"` `path="/api/webhooks/sepay/[REDACTED]"` `status=404` | > 20 / 15 phút | endpoint key sai/đang bị dò |
| Webhook xử lý lỗi | `msg="webhook.processing_failed"` hoặc `msg="webhook.secret_unreadable"` | ≥ 1 | DB lỗi sau khi đã xác thực / khoá mã hoá sai (xem xoay `APP_ENCRYPTION_KEY`) |
| Cron lỗi | `msg="reconcile.integration_failed"`, `msg="reconcile.rematch_failed"` hoặc `msg="api.unhandled"` với `path` bắt đầu `/api/internal/` | ≥ 1 | reconcile/expire thất bại |
| Cron im lặng (dead-man) | **không** có `msg="cron.reconcile_sepay"` nào trong 45 phút khi có integration `ACTIVE` | 1 lần | cron không chạy (sai gói Vercel, secret lệch); `/api/internal/status` cũng báo |
| Lỗi 5xx | `level="error"` | ≥ 1 / 5 phút | lỗi ứng dụng (`requestId` để truy vết) |
| Bị giới hạn tốc độ | `msg="rate_limit.blocked"` | > 50 / 15 phút | tấn công hoặc chính sách quá chặt (xem policy) |
| Bộ đếm rate limit hỏng | `msg="rate_limit.unavailable"` | ≥ 1 | DB lỗi; hệ thống đang fail-open |

Truy vết một sự cố: lấy `requestId` từ khách (header `x-request-id`) hoặc từ dòng `api.unhandled`, rồi tìm mọi dòng có cùng `requestId`.

## Sự cố

| Triệu chứng | Làm ngay | Sau đó |
|---|---|---|
| `/api/health` 503 | `neon branches get production`; kiểm compute/Neon status; không restart bừa | xác nhận `smoke:prod`; ghi nguyên nhân |
| Đơn không vào board | `/api/internal/status`; `vercel logs <deployment-url>` tìm `api.unhandled` | rollback ứng dụng nếu do deploy mới |
| Khách chuyển tiền nhưng đơn chưa PAID | chạy reconcile (mục trên); xem `/app/reconciliation` | tìm nguyên nhân trong `bank_transactions` |
| Nghi rò dữ liệu giữa cửa hàng | **kill switch toàn bộ** (`update stores set is_accepting_orders = false`); giữ log | `npm run test:hardening -- tenant-matrix public-leak`; xoay secret liên quan; báo owner |
| Lộ secret | xoay secret tương ứng (mục Biến môi trường) | rà `git log -S` và log; bật audit |

## Performance budget

`MOBILE_BUDGET` trong `tests/support/lighthouse-budget.ts`: Lighthouse mobile trên `/s/:slug` — performance ≥ 0.8, accessibility ≥ 0.95, best-practices ≥ 0.9, LCP ≤ 3000 ms, CLS ≤ 0.1, TBT ≤ 300 ms, tổng byte ≤ 1.5 MB; JS truyền ≤ 450 KB (`tests/e2e-hardening/perf.spec.ts`). Chỉ hạ ngưỡng sau khi tối ưu mà vẫn vượt; ghi bên dưới ngày, số đo thực tế và lý do.

_Chưa có ngoại lệ._

## Dependency audit

`npm run audit:runtime` chạy `npm audit --omit=dev` và chỉ báo lỗi cho lỗ hổng `high`/`critical` **không** nằm trong `ALLOWLIST` (`scripts/lib/audit-filter.mjs`). Vì `nuxt` nằm trong `dependencies`, npm báo cả các gói chỉ chạy lúc build/dev (`@nuxt/devtools`, `vite`, …). Mỗi mục allowlist phải kèm lý do, có hạn `reviewBy` (≤ 90 ngày) và đã kiểm bằng `npm explain <gói>` + `ls .output/server/node_modules/<gói>` (không có ⇒ build-only). Gói có trong `.output` hoặc bị bundle vào client/server (vd `devalue`, `zod`) phải được nâng cấp, không allowlist.

## Quyết định bảo mật

- **Header bằng middleware, không `routeRules`:** CSP cần `NEON_AUTH_BASE_URL` lúc chạy và handler phải ghi đè được `Cache-Control` (menu public cache CDN). File tĩnh `/_nuxt/**` do CDN phục vụ nên không có CSP.
- **CSP giữ `'unsafe-inline'` cho script/style** vì Nuxt chèn script khởi tạo và colour-mode; bù bằng không `v-html`/`eval` (test tĩnh `source-rules`), không `unsafe-eval`. `img-src` cho `https:` để ảnh VietQR và ảnh món không bị chặn. Cải tiến sau V1: nonce.
- **Không có CSRF:** API xác thực bằng `Authorization: Bearer`, server không đọc/ghi cookie (test tĩnh cấm `getCookie/setCookie/useSession`).
- **Rate limit theo bảng policy** (`server/utils/rate-limit-policies.ts`): tracking giới hạn theo **token** vì khách cùng Wi-Fi quán dùng chung IP; trần IP rất cao. IP lấy từ `x-vercel-forwarded-for` chỉ khi `VERCEL=1` (hoặc `TRUST_FORWARDED_FOR=1` trong test); ngoài ra dùng địa chỉ socket nên không giả được bằng `X-Forwarded-For`. Bộ đếm lỗi thì **fail-open** (ưu tiên cửa hàng còn bán hàng), có log `rate_limit.unavailable`. Mỗi lượt xem trang `/s/:slug`, `/o/:token` chạy không qua CDN tốn thêm một lệnh upsert bộ đếm; nếu Lighthouse/TTFB báo vượt ngân sách vì việc này, nâng `public-page` lên giới hạn theo phút lớn hơn hoặc bỏ policy đó (chỉ giữ policy API) và ghi vào mục Performance budget.
- **Log không chứa PII/token:** `logger` che khoá nhạy cảm; access log dùng đường dẫn đã che token và bỏ query; test quét log bằng canary ở mỗi lần chạy `test:hardening` (kể cả ở teardown toàn phiên).
- **Hạn chế đã biết (V1):** không có script mã hoá lại khi xoay `APP_ENCRYPTION_KEY`; không có RLS (chống rò tenant dựa vào guard + composite FK + ma trận test); cảnh báo log cần Vercel Log Drain/Observability hoặc công cụ ngoài.
````

- [ ] **Step 4: Viết `docs/go-live-checklist.md`**

````markdown
# Go-live checklist (PRD Phase 5 exit)

Quy ước: đánh `[x]` chỉ khi **đã chạy** lệnh `Verify` và thấy đúng `Expect`; dán kết quả/ngày vào `docs/pilot-report.md`. Thay `<…>` bằng giá trị thật. `$APP_BASE_URL` = `https://<domain-production>`, `$CRON_SECRET` = secret production (không ghi vào tài liệu).

## A. Chất lượng

- [ ] **GL-01** Lint, typecheck, unit và nuxt xanh — Verify: `npm run lint && npm run typecheck && npm test` — Expect: exit 0
- [ ] **GL-02** Integration và API xanh trên branch `test` — Verify: `npm run test:integration && npm run test:api` — Expect: mọi test PASS
- [ ] **GL-03** Hardening trên bản build production xanh — Verify: `npm run test:hardening` — Expect: mọi test PASS, teardown không báo "Server log leaked"
- [ ] **GL-04** Audit tĩnh (route/guard, Review Focus, rule XSS/CSRF/log, tài liệu) — Verify: `npm run test:audit` — Expect: mọi test PASS
- [ ] **GL-05** E2E trên mobile-chrome, mobile-safari, desktop-chrome — Verify: `npm run test:e2e` — Expect: mọi test PASS ở 3 project
- [ ] **GL-06** A11y, focus trap, CSP, ảnh, JS và Lighthouse mobile đạt ngưỡng — Verify: `npm run test:e2e:hardening` — Expect: mọi test PASS ở 3 project
- [ ] **GL-07** Migration khớp schema — Verify: `npx drizzle-kit check` — Expect: `Everything's fine`
- [ ] **GL-08** CI xanh trên `main` — Verify: `gh run list --branch main --limit 1 --json conclusion --jq '.[0].conclusion'` — Expect: `success`

## B. Bảo mật

- [ ] **GL-09** Không còn lỗ hổng high/critical ở runtime — Verify: `npm run audit:runtime` — Expect: `✓ Không có lỗ hổng high/critical ở runtime`
- [ ] **GL-10** Ma trận tenant cho mọi route protected — Verify: `npx vitest run --project hardening tests/hardening/tenant-matrix.test.ts` — Expect: PASS, gồm "exercised every protected route" và "denial requests changed nothing"
- [ ] **GL-11** Không rò PII/secret ở response public, HTML, log, bundle — Verify: `npx vitest run --project hardening tests/hardening/public-leak.test.ts tests/hardening/log-leak.test.ts tests/hardening/bundle-secrets.test.ts` — Expect: PASS
- [ ] **GL-12** Header bảo mật, CSP, cache và rate limit — Verify: `npx vitest run --project hardening tests/hardening/security-headers.test.ts tests/hardening/rate-limit.test.ts` — Expect: PASS
- [ ] **GL-13** Mỗi dòng Review Focus và merge-gate thanh toán có test — Verify: `npx vitest run --project unit tests/unit/audit/review-focus.test.ts` — Expect: PASS (RF-1…RF-10, PAY-*, E2E-*)
- [ ] **GL-14** Test webhook: HMAC, replay, trùng đồng thời, sai account, tiền muộn — Verify: `npm run test:integration -- webhook && npm run test:api -- webhook` — Expect: PASS
- [ ] **GL-15** Neon Auth production không cho kết nối localhost — Verify: `neon neon-auth domain allow-localhost get --branch production` — Expect: trạng thái disabled/restricted
- [ ] **GL-16** Domain production nằm trong trusted domains của Neon Auth — Verify: `neon neon-auth domain list --branch production` — Expect: có `https://<domain-production>`

## C. Môi trường

- [ ] **GL-17** Biến production hợp lệ và khác test — Verify: `vercel env pull .env.vercel.production --environment=production --yes && npm run check:env -- --file .env.vercel.production --target production --compare .env.test` — Expect: `✓ … hợp lệ cho production`
- [ ] **GL-18** Preview tách khỏi production — Verify: `vercel env pull .env.vercel.preview --environment=preview --yes && npm run check:env -- --file .env.vercel.preview --target preview --compare .env.vercel.production` — Expect: `✓ … hợp lệ cho preview`
- [ ] **GL-19** Branch mặc định là `production` — Verify: `neon branches list | grep -F "[default] production"` — Expect: in đúng một dòng
- [ ] **GL-20** CI không clone dữ liệu khách của production — Verify: `grep -n "branch_type: schema-only" .github/workflows/ci.yml` — Expect: có đúng một dòng
- [ ] **GL-21** Khoá SePay đã mã hoá trong DB, không nằm trong env — Verify: `neon psql production -- -tAc "select count(*) from sepay_integrations where status = 'ACTIVE' and encrypted_hmac_secret is null"` — Expect: `0`
- [ ] **GL-22** Mọi cron trong `vercel.json` có handler GET được bảo vệ — Verify: `npx vitest run --project unit tests/unit/audit/cron-contract.test.ts` — Expect: PASS (gói Vercel Pro nếu có cron < 1 lần/ngày)
- [ ] **GL-23** `/api/internal/status` production trả ok — Verify: `curl -fsS -H "Authorization: Bearer $CRON_SECRET" "$APP_BASE_URL/api/internal/status"` — Expect: HTTP 200, `"ok":true`
- [ ] **GL-24** Smoke production: health, header, 401, menu cache — Verify: `npm run smoke:prod -- $APP_BASE_URL --slug <pilot-slug>` — Expect: `✓ Smoke OK`

## D. Dữ liệu và vận hành

- [ ] **GL-25** Snapshot tự động bật cho production — Verify: `neon snapshots schedule get --branch production` — Expect: có lịch daily (đặt bằng `neon snapshots schedule set --branch production --frequency daily --hour 3 --retention 604800`)
- [ ] **GL-26** Đã diễn tập restore trên production — Verify: `npm run ops:restore-drill -- production` — Expect: `DRILL OK` và không còn `restore-drill-*` trong `neon branches list`
- [ ] **GL-27** Giám sát 15 phút chạy được — Verify: `gh workflow run ops-watch.yml` — Expect: run mới thành `success` trong tab Actions (`gh run list --workflow ops-watch.yml --limit 1`)
- [ ] **GL-28** Đã diễn tập rollback ứng dụng — Verify: `vercel rollback <deployment-url-trước> --yes` — Expect: `npm run smoke:prod -- $APP_BASE_URL` vẫn `✓ Smoke OK`; sau đó promote lại bản mới
- [ ] **GL-29** Kill switch chặn đơn mới — Verify: `npm run test:integration -- create-order -t "STORE_CLOSED"` — Expect: PASS; thử tay: tạm nghỉ cửa hàng rồi đặt đơn ⇒ 422 `STORE_CLOSED`
- [ ] **GL-30** Tài liệu vận hành đủ mục — Verify: `npm run test:audit` — Expect: PASS (`docs/operations.md`, runbook, report)

## E. Thanh toán

- [ ] **GL-31** Giao dịch thật nhỏ qua SePay đã được match — Verify: `neon psql production -- -tAc "select reconciliation_status, count(*) from bank_transactions group by 1"` — Expect: có `MATCHED` ≥ 1 và không có `RECEIVED`
- [ ] **GL-32** Không còn giao dịch chờ xử lý — Verify: `neon psql production -- -tAc "select count(*) from bank_transactions where reconciliation_status = 'REVIEW_REQUIRED'"` — Expect: `0` (hoặc đã `RESOLVED` kèm ghi chú)
- [ ] **GL-33** Tiền về tài khoản ngân hàng của owner (không phải ZENO) — Verify: `grep -E "^\| P-06 \| ✅" docs/pilot-report.md` — Expect: có dòng kèm bằng chứng sao kê

## F. Pilot

- [ ] **GL-34** Diễn tập seed trên branch `test` — Verify: `npm run db:seed:pilot -- --owner-email <owner-test> --slug pilot-rehearsal` — Expect: `✓ Seed xong trên branch test: 8 món, 2 bàn, 2 khu vực giao`
- [ ] **GL-35** QR bàn đúng gắn đúng bàn, QR hỏng không gắn bàn — Verify: `curl -fsS "$APP_BASE_URL/api/public/stores/<pilot-slug>/fulfillment?t=<token-bàn-01>"` — Expect: `table.displayName` = `Bàn 01`; với `?t=hong` ⇒ `"tableError":"INVALID_TABLE"`
- [ ] **GL-36** Owner thứ hai không thấy dữ liệu pilot — Verify: `grep -E "^\| P-09 \| ✅" docs/pilot-report.md` — Expect: có dòng; `npx vitest run --project hardening tests/hardening/tenant-matrix.test.ts` cũng PASS
- [ ] **GL-37** Báo cáo pilot đủ 10 mục và 5 vấn đề UX — Verify: `grep -c "^| P-" docs/pilot-report.md` — Expect: `10`, không còn `⬜`

## G. Pháp lý

- [ ] **GL-38** Có trang chính sách quyền riêng tư công khai, truy cập được và liên kết từ trang khách — Verify: `npm run test:e2e:hardening -- a11y -g "privacy policy"` — Expect: PASS ở 3 project (`/privacy` không vi phạm axe/CSP, link nằm ở chân trang `/s/:slug`)
````

- [ ] **Step 5: Viết `docs/pilot-runbook.md`**

````markdown
# Runbook pilot — 1 quán, 2 hình thức thanh toán

Mục tiêu (PRD §15): chạy thật một quán, 1 bàn QR, 1 đơn pickup, 1 đơn delivery, COD và VietQR; xác nhận tiền về **tài khoản của owner**; sau đó thử 2 org/2 store. Mỗi bước có lệnh hoặc màn hình để kiểm; ghi kết quả vào `docs/pilot-report.md` (ID `P-01`…`P-10`).

## Vai trò

| Vai trò | Việc |
|---|---|
| Owner quán pilot | tạo menu, in QR, bấm "Đã thu", nhận tiền |
| Nhân viên | dùng `/app/orders` trên điện thoại, không hướng dẫn dài |
| Người trực kỹ thuật | theo dõi `ops-watch`, log, xử lý theo `docs/operations.md` |
| Khách thử | 2–3 người quen, thiết bị Android + iPhone |

## T-7 ngày — chuẩn bị

1. Hoàn tất `docs/go-live-checklist.md` mục A–D (GL-01…GL-30) và GL-38 (chính sách quyền riêng tư).
2. Diễn tập trên branch `test`: `npm run db:seed:pilot -- --owner-email <owner-test> --slug pilot-rehearsal` rồi đặt đơn qua link in ra; xác nhận 3 hình thức nhận món chạy.
3. Owner đăng ký tài khoản trên production, đăng nhập một lần (tạo profile), tạo cửa hàng bằng onboarding.
4. Nhập menu 5–10 món (UI `/app/menu`) **hoặc** seed: `NEON_BRANCH` phải là `production` nên cần hai cờ: `ZENO_ALLOW_PRODUCTION_SEED=1 npm run db:seed:pilot -- --owner-email <email-owner> --slug <slug> --production` (chỉ khi owner đồng ý dùng menu mẫu; sau đó sửa tên/giá trong app).

## Ngày pilot — kiểm từng mục

| ID | Việc | Cách kiểm | Kết quả mong đợi |
|---|---|---|---|
| P-01 | Owner tạo store + menu 5–10 món | `/app/menu` | món hiện ở `/s/<slug>`; `npm run smoke:prod -- $APP_BASE_URL --slug <slug>` ✓ |
| P-02 | Tạo Bàn 01/Bàn 02, in QR riêng, đổi bàn không nhầm | quét QR từng bàn; `curl -fsS "$APP_BASE_URL/api/public/stores/<slug>/fulfillment?t=<token>"` | đúng `Bàn 01`/`Bàn 02`; token cũ sau "Tạo lại QR" ⇒ `INVALID_TABLE` |
| P-03 | Pickup không địa chỉ; delivery đúng khu vực và phí | đặt 1 đơn mỗi loại | pickup không có ô địa chỉ; delivery cộng đúng phí zone |
| P-04 | COD: staff chuyển trạng thái, xác nhận tiền | board → NEW → PREPARING → READY → COMPLETED, "Đã thu" | một `order_payments`, báo cáo ngày "đã thu" tăng |
| P-05 | SePay sandbox, sau đó giao dịch thật nhỏ | wizard SePay → "Gửi thử"; chuyển khoản số tiền nhỏ vào QR | đơn sang `NEW + PAID` tự động; `bank_transactions` `MATCHED` |
| P-06 | Tiền về **ngân hàng owner** | sao kê ngân hàng của owner | có khoản tiền khớp; chụp màn hình đính vào báo cáo |
| P-07 | Đối chiếu `bank_transactions` ↔ attempt ↔ đơn | SQL bên dưới | mỗi giao dịch `MATCHED` có đúng một đơn, số tiền khớp |
| P-08 | Refresh, webhook trùng, tiền muộn, mất mạng | tải lại trang `/o/<token>`; SePay "Gửi lại"; bật chế độ máy bay giữa lúc đặt | không trùng đơn/payment; tiền muộn vào review |
| P-09 | Owner khác hoàn toàn không thấy dữ liệu pilot | đăng ký owner thứ hai; `npx vitest run --project hardening tests/hardening/tenant-matrix.test.ts` | owner 2 thấy danh sách rỗng, URL đơn của pilot ⇒ 404 |
| P-10 | Ghi 5 vấn đề UX hàng đầu | quan sát nhân viên + khách | chỉ sửa vấn đề cản trở đặt món thật |

SQL cho P-07 (điều chỉnh tên cột nếu schema PR5/PR6 khác — kiểm bằng `neon psql production -- -c "\d payment_attempts"`):

```bash
neon psql production -- -c "select o.public_code, o.status, o.payment_status, pa.payment_code, pa.status as attempt, bt.provider_transaction_id, bt.reconciliation_status from orders o join payment_attempts pa on pa.order_id = o.id left join order_payments op on op.order_id = o.id left join bank_transactions bt on bt.id = op.bank_transaction_id order by o.created_at desc limit 20"
```

## Trong khi pilot

- Mở sẵn: `gh run list --workflow ops-watch.yml --limit 3`, `vercel logs <deployment-url>` và `/api/internal/status`.
- Ngưỡng dừng (xem bảng Rollback): bất kỳ trường hợp nào làm khách mất tiền mà đơn không PAID, trùng đơn/payment, hoặc dữ liệu hiện sai cửa hàng.

## Kill switch

| Mục đích | Cách làm | Hiệu lực |
|---|---|---|
| Ngừng nhận đơn của một quán | owner: Cài đặt → "Tạm nghỉ"; hoặc `neon psql production -- -c "update stores set is_accepting_orders = false where slug = '<slug>'"` | khách thấy "tạm nghỉ"; đặt đơn ⇒ 422 `STORE_CLOSED` (menu public cache ≤ 60 giây) |
| Ngừng nhận VietQR, vẫn bán COD | `neon psql production -- -c "update sepay_integrations set status = 'DISABLED' where id = '<id>'"` | webhook trả 404, SePay gửi lại; tiền ở ngân hàng owner, đối soát sau (`operations.md`) |
| Ngừng cả hệ thống | `vercel rollback <deployment-url-trước> --yes` (ứng dụng), hoặc kill switch từng quán | xem Rollback |

## Rollback

| Tình huống | Hành động | Kiểm |
|---|---|---|
| Lỗi sau deploy | `vercel rollback <deployment-url-trước> --yes` | `npm run smoke:prod -- $APP_BASE_URL` ✓ |
| Sai thanh toán/đối soát | kill switch VietQR; xử lý từng giao dịch ở `/app/reconciliation`; không sửa DB tay | `bank_transactions` không còn `RECEIVED`/`REVIEW_REQUIRED` chưa xử lý |
| Nghi rò dữ liệu | kill switch mọi quán; giữ log; `npm run test:hardening -- tenant-matrix public-leak` | báo owner; xoay secret nếu cần |
| Hỏng dữ liệu | **forward-fix** trước; chỉ restore khi buộc: `neon branches restore production ^self@<RFC3339> --preserve-under-name production_pre_restore_<ngày>` | `npm run smoke:prod`, reconcile, đối chiếu đơn mất (xem `operations.md`) |

Sau rollback: ghi sự cố vào `docs/pilot-report.md` (mục Sự cố), sửa gốc rễ và thêm test hồi quy **trước** khi mở lại.

## Sau pilot — 2 org / 2 store

1. Tạo org thứ hai (đăng ký owner mới → onboarding) trên production hoặc preview riêng.
2. `npx vitest run --project hardening tests/hardening/tenant-matrix.test.ts` xanh, và kiểm tay: owner 2 mở URL đơn/QR của quán 1 ⇒ 404.
3. Chốt P-09 trong báo cáo.

## Tiêu chí kết thúc

Cả `GL-31`…`GL-37` đã đánh `[x]`, `docs/pilot-report.md` đủ 10 mục + 5 vấn đề UX, nhân viên dùng được không cần hướng dẫn dài (ghi nhận P-10).
````

- [ ] **Step 6: Viết `docs/pilot-report.md`**

````markdown
# Báo cáo pilot

- Quán: …  · Slug: …  · Ngày pilot: …  · Người trực: …
- Branch/commit/deployment: …
- Kết quả diễn tập restore (`npm run ops:restore-drill -- production`): `DRILL OK …`

Trạng thái: `⬜` chưa làm · `✅` đạt (kèm bằng chứng) · `❌` lỗi (kèm mô tả ở mục Sự cố).

## Kiểm tra theo PRD §15

| ID | Hạng mục | Trạng thái | Bằng chứng (lệnh/ảnh/đường dẫn) |
|---|---|---|---|
| P-01 | Owner tạo store và menu 5–10 món | ⬜ | |
| P-02 | Bàn 01/02 có QR riêng, đổi bàn không nhầm | ⬜ | |
| P-03 | Pickup không địa chỉ; delivery đúng khu vực và phí | ⬜ | |
| P-04 | COD: staff chuyển trạng thái và xác nhận tiền | ⬜ | |
| P-05 | SePay sandbox, sau đó giao dịch thật nhỏ | ⬜ | |
| P-06 | Tiền về ngân hàng owner, không phải ZENO | ⬜ | |
| P-07 | Đối chiếu `bank_transactions` ↔ attempt ↔ đơn | ⬜ | |
| P-08 | Refresh, webhook trùng, tiền muộn, mất mạng | ⬜ | |
| P-09 | Owner khác không thấy dữ liệu pilot | ⬜ | |
| P-10 | 5 vấn đề UX hàng đầu đã ghi nhận | ⬜ | |

## 5 vấn đề UX hàng đầu

| # | Vấn đề | Cản trở đặt món thật? | Quyết định (sửa ngay / sau) |
|---|---|---|---|
| 1 | | | |
| 2 | | | |
| 3 | | | |
| 4 | | | |
| 5 | | | |

## Sự cố

| Thời điểm | Mô tả | Nguyên nhân gốc | Hành động | Test hồi quy |
|---|---|---|---|---|

## Quyết định mở rộng

- [ ] Mở rộng sang quán thứ hai · [ ] Cần sửa trước khi mở rộng: …
````

- [ ] **Step 7: Trang chính sách quyền riêng tư (PRD Phase 5 "legal/privacy policy") — test trước**

Thêm vào `tests/e2e-hardening/a11y.spec.ts`, bên trong `test.describe('public ordering pages', …)` (sau test `/o/:token`):

```ts
  test('the privacy policy is public, accessible and linked from the menu', async ({ page }) => {
    await page.goto(`/s/${slug}`)
    await page.getByRole('link', { name: 'Chính sách quyền riêng tư' }).click()
    await expect(page).toHaveURL(/\/privacy$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Chính sách quyền riêng tư' })).toBeVisible()
    await expectNoA11yViolations(page, '/privacy')
    await expectNoCspViolations(page)
  })
```

Run: `npm run test:e2e:hardening -- a11y -g "privacy policy"`
Expected: FAIL — không tìm thấy link "Chính sách quyền riêng tư".

Tạo `app/pages/privacy.vue`:

```vue
<script setup lang="ts">
useHead({ title: 'Chính sách quyền riêng tư' })
</script>

<template>
  <article class="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-8 leading-relaxed">
    <h1 class="text-2xl font-semibold">
      Chính sách quyền riêng tư
    </h1>
    <p>Cập nhật lần cuối: 01/11/2026. Trang này giải thích ZENO Order thu thập và dùng dữ liệu gì khi bạn đặt món.</p>

    <h2 class="text-lg font-semibold">
      Dữ liệu được thu thập
    </h2>
    <p>
      Nội dung đơn (món, tuỳ chọn, ghi chú), hình thức nhận món và mã bàn. Với mang đi hoặc giao hàng: tên và số điện thoại; riêng giao hàng thêm địa chỉ giao. Khách không cần tạo tài khoản và ZENO không thu thập mật khẩu của khách.
    </p>

    <h2 class="text-lg font-semibold">
      Mục đích sử dụng
    </h2>
    <p>Chỉ để quán chuẩn bị, giao và thu tiền cho đơn của bạn, và để đối soát thanh toán. ZENO không bán dữ liệu và không dùng cho quảng cáo.</p>

    <h2 class="text-lg font-semibold">
      Ai xem được dữ liệu
    </h2>
    <p>
      Chủ quán và nhân viên của quán bạn đặt món. Người khác chỉ thấy trạng thái đơn khi có đường dẫn theo dõi của bạn; số điện thoại trên trang đó được che còn 3 số cuối và địa chỉ không hiển thị. Đừng chia sẻ đường dẫn theo dõi đơn.
    </p>

    <h2 class="text-lg font-semibold">
      Thanh toán
    </h2>
    <p>
      Chuyển khoản đi thẳng vào tài khoản ngân hàng của quán; ZENO không giữ tiền của bạn. Giao dịch ngân hàng được SePay xử lý theo chính sách của SePay.
    </p>

    <h2 class="text-lg font-semibold">
      Bảo mật
    </h2>
    <p>Dữ liệu được truyền qua HTTPS và được tách riêng theo từng quán; mỗi quán chỉ truy cập được dữ liệu của mình.</p>

    <h2 class="text-lg font-semibold">
      Quyền của bạn
    </h2>
    <p>Bạn có thể yêu cầu xem, sửa hoặc xoá thông tin đơn của mình bằng cách liên hệ trực tiếp quán nơi bạn đặt món; quán sẽ chuyển yêu cầu tới ZENO khi cần.</p>
  </article>
</template>
```

Thêm liên kết vào chân trang khách: trong `app/pages/s/[slug].vue`, ngay trước thẻ đóng của phần tử gốc trong `<template>`, thêm:

```vue
    <footer class="px-4 pb-24 pt-6 text-center text-sm">
      <NuxtLink to="/privacy" class="underline">
        Chính sách quyền riêng tư
      </NuxtLink>
    </footer>
```

(`pb-24` chừa chỗ cho thanh giỏ cố định ở đáy để link không bị che.)

Run: `npm run test:e2e:hardening -- a11y -g "privacy policy"`
Expected: PASS ở 3 project.

- [ ] **Step 8: Chạy test tài liệu**

Run: `npx vitest run --project unit tests/unit/audit/go-live-checklist.test.ts`
Expected: PASS. Đỏ ở "only references npm scripts that exist" = checklist trỏ tới script chưa có → thêm script đúng tên ở task tương ứng hoặc sửa checklist; đỏ ở "repository files" = đường dẫn gõ sai.

- [ ] **Step 9: Chạy toàn bộ suite hardening và audit lần cuối**

Run: `npm run test:audit && npm run test:hardening && npm run test:e2e:hardening && npm test`
Expected: tất cả PASS.

- [ ] **Step 10: Commit**

```bash
git add docs/operations.md docs/go-live-checklist.md docs/pilot-runbook.md docs/pilot-report.md tests/unit/audit/go-live-checklist.test.ts app/pages/privacy.vue "app/pages/s/[slug].vue" tests/e2e-hardening/a11y.spec.ts
git commit -m "docs(hardening): add operations guide, go-live checklist, pilot runbook and report

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## PR7 Exit Checklist (PRD Phase 5 exit)

- [ ] `npm run test:audit`, `npm run test:hardening`, `npm run test:e2e:hardening`, `npm run test:e2e`, `npm test`, `npm run test:integration`, `npm run test:api` đều xanh; CI xanh trên PR `test(hardening)`.
- [ ] Mọi hàng Review Focus của roadmap (RF-1…RF-10) và merge-gate thanh toán (PAY-*) có test được ánh xạ trong `tests/support/review-focus-map.ts`; không có hàng nào bị nới regex để lách.
- [ ] `docs/go-live-checklist.md` 38 mục; GL-01…GL-30 và GL-38 đã `[x]` trước pilot, GL-31…GL-37 `[x]` sau pilot.
- [ ] Cập nhật roadmap: ghi các điểm lệch của PR7 vào outline mục `PR7` (middleware thay vì `routeRules`; project `hardening` + Playwright production; `npm run test:audit`; cổng `audit:runtime` có allowlist; `TRUST_FORWARDED_FOR`; `clientIp`; handler GET cho cron; CI `schema-only`).
- [ ] Thêm vào spec §10 và §3.2 các biến/cờ mới: `TRUST_FORWARDED_FOR`, `PRODUCTION_URL` (biến GitHub), `PRODUCTION_CRON_SECRET` (secret GitHub), `ZENO_ALLOW_PRODUCTION_SEED`.


