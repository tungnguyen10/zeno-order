# ZENO Mini Order V1 — PR6 Payment Webhook: SePay webhook, matching, cron, đối soát Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuyển khoản VietQR đúng được xác nhận đúng **một lần** (kể cả khi SePay gửi trùng đồng thời); tiền lạ, thiếu/thừa, đến muộn sau hết hạn hoặc sau khi hủy không bao giờ biến mất mà vào hàng đợi đối soát để chủ quán xử lý bằng 1–2 thao tác.

**Architecture:** `POST /api/webhooks/sepay/:key` xác thực (HMAC-SHA256 hoặc API Key, so sánh constant-time) trên **raw body**, ghi `bank_transactions` idempotent (unique `(integration_id, provider_transaction_id)` + advisory lock chống trùng chéo webhook/API đối soát), rồi `matchTransaction` trong một DB transaction khoá theo thứ tự cố định `bank_transactions → payment_attempts → orders` (không deadlock, đúng-một-lần nhờ `FOR UPDATE` + cập nhật có điều kiện + unique index ở DB). Vercel Cron (GET + `CRON_SECRET`) chạy hết hạn attempt và đối soát qua SePay API v2; mọi bất thường vào màn `/app/reconciliation` cho owner.

**Tech Stack:** Nuxt 4.5.2 (Nitro/h3 1.15), drizzle-orm 0.45.4 + `@neondatabase/serverless` Pool (transaction thật), zod 4.6.5, vitest 5 (unit/integration/api), @nuxt/test-utils, Playwright, Nuxt UI v4 qua primitive `Z*`, Vercel Cron.

**Spec:** [2026-10-31-zeno-mini-order-v1-design.md](../specs/2026-10-31-zeno-mini-order-v1-design.md) (§4.3, §5.4, §6.3, §6.4, §7, §9, §10, §13) · PRD: [ZENO_MINI_ORDER_V1_IMPLEMENTATION_PLAN.md](../../ZENO_MINI_ORDER_V1_IMPLEMENTATION_PLAN.md) (§4.2–4.3, §8.3–8.4, Phase 4) · Roadmap: [2026-10-31-zeno-v1-00-roadmap.md](./2026-10-31-zeno-v1-00-roadmap.md) (mục PR6, Review Focus #10) · UI: [2026-10-31-ui-foundation-design.md](../specs/2026-10-31-ui-foundation-design.md) · Phụ thuộc: PR0–PR5 đã merge.

## Global Constraints

Áp dụng "Global Constraints" và "Quy ước xuyên PR" của roadmap. Điểm chạm PR này:

- **Tenant:** không có quyền → **404**; thiếu role → **403**; thiếu/sai token → **401**. Route đối soát dùng `requireStoreOwner` (staff của store → 403, người ngoài tenant → 404). `bank_transactions` thuộc **org** (integration là cấp org); mọi truy vấn của owner luôn kèm `org_id = ctx.orgId`. FK `(matched_store_id, matched_order_id) → orders(store_id, id)` và `(org_id, matched_store_id) → stores(org_id, id)`.
- **Tiền:** VND `bigint` (mode `number`), số nguyên **> 0** cho giao dịch ngân hàng; so khớp số tiền **bằng nhau tuyệt đối** (dung sai 0, spec §6.3). Lệch bao nhiêu cũng vào review; chỉ owner được xác nhận chênh lệch khi gán.
- **Đúng một lần:** DB là lớp cuối cùng — `unique(integration_id, provider_transaction_id)`, `unique(order_payments.bank_transaction_id) where not null` (PR6 thêm) và `unique(order_payments.order_id)` (`order_payments_order_uq` của PR4: mỗi đơn đúng một khoản thu, mọi phương thức).
- **Response webhook:** đúng `HTTP 200` + body `{"success": true}` **chỉ sau khi commit**; lỗi DB → 500 để SePay gửi lại (xem Verified external facts V2). Không có queue bền nên không bao giờ trả success trước commit.
- **Log:** qua `logger`; **không** log body webhook, chữ ký, header `Authorization`, nội dung chuyển khoản, SĐT, số tài khoản đầy đủ. Lỗi DB của Drizzle chứa `params` nên route chỉ log `{ errorName, pgCode }` rồi ném `AppError('INTERNAL')`.
- **Secret:** secret HMAC/API key và API token SePay chỉ giải mã trong request qua `loadIntegrationSecrets` của PR5 (đường duy nhất), không vào log/response.
- **Cron:** Vercel Cron gọi **HTTP GET** kèm `Authorization: Bearer $CRON_SECRET` (V11) → route `/api/internal/*` nhận GET và POST, so sánh constant-time. Lệch roadmap (roadmap ghi POST) vì Vercel chỉ gọi GET.
- **Import/lớp:** route mỏng (parse → guard → service); transaction chỉ trong `server/services/**`; import tường minh + đường dẫn tương đối trong `server/`; file schema dùng import tương đối tới `shared/` (drizzle-kit không resolve alias `#shared`).
- **Migration:** đúng một file `npx drizzle-kit generate --name payment_webhook`, rồi `npm run db:check`, rồi áp lên branch `test` trước khi chạy integration test.
- **UI:** tiếng Việt, mobile-first 360px, chỉ dùng `Z*` trong `pages/**` và `layouts/**`, vùng bấm ≥ 44px, có loading/empty/error ở mọi màn.
- **Commit:** conventional commits + trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

## Verified external facts (spec §13)

Đã đọc trực tiếp ngày 2026-11-01. Nguồn đổi → cập nhật bảng này **trước** khi sửa code.

| # | Sự kiện | Nguồn |
|---|---|---|
| V1 | Webhook là HTTP **POST**, mặc định `application/json`. Payload: `id` (integer, "không đổi qua mọi lần retry và replay, dùng làm khóa chống trùng"), `gateway`, `transactionDate` (`YYYY-MM-DD HH:mm:ss`, **giờ Việt Nam**), `accountNumber`, `subAccount` (có thể `""`; VA chính thức hoặc mã TKP), `code` (string hoặc **`null`**), `content`, `transferType` (`in`/`out`), `description` (có thể rỗng), `transferAmount` (integer, luôn dương), `accumulated` (có thể 0), `referenceCode` (có thể rỗng). | https://developer.sepay.vn/vi/sepay-webhooks/tich-hop-webhook |
| V2 | Hợp đồng phản hồi: thành công **chỉ khi** HTTP `200`/`201` **và** body JSON đúng `{"success": true}` **và** xong trong 30 s. Sai bất kỳ điều kiện nào (kể cả `200` + body khác) = thất bại → vào hàng đợi retry. | cùng trang; https://docs.sepay.vn/tich-hop-webhooks.html |
| V3 | Retry khi lỗi kết nối hoặc status ngoài 2xx (nếu bật "Tự động gửi lại"): lịch Fibonacci, 8 lần gửi (1 + 7 retry) trong ~33 phút; webhook cũ hơn 5 giờ không được quét retry. Trang docs.sepay.vn tóm tắt "tối đa 7 lần, tối đa 5 giờ" (không khớp tuyệt đối). **Plan không dựa vào con số nào**: cron đối soát là lưới an toàn. | https://developer.sepay.vn/vi/sepay-webhooks/xu-ly-loi |
| V4 | 4 kiểu xác thực: không / **API Key** / **HMAC-SHA256** (khuyến nghị) / OAuth 2.0. API Key: header `Authorization: Apikey <key>`, server so sánh. HMAC: header `X-SePay-Signature: sha256=<hex>` và `X-SePay-Timestamp: <unix giây>`; chuỗi ký `{timestamp}.{raw_body}`; HMAC-SHA256 với secret; chống replay ±300 s; **bắt buộc dùng raw body**. Secret/API key chỉ hiện đầy đủ một lần khi tạo. | https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc ; https://developer.sepay.vn/vi/dia-chi-ip (xác nhận `Authorization: Apikey YOUR_API_KEY`) |
| V5 | Chống trùng dựa trên `id`; trùng đến từ retry tự động, **gửi lại thủ công (kể cả log đã thành công)** và nhiều webhook trỏ cùng endpoint. Khuyến nghị cột `UNIQUE` + insert-ignore, an toàn khi hai webhook đến đồng thời. | tich-hop-webhook |
| V6 | `code` do SePay bóc tách từ `content` theo "Cấu trúc mã thanh toán" cấp **công ty**: tiền tố 2–5 ký tự (không phân biệt hoa/thường, lưu hoa), hậu tố min–max 1–30 ký tự, loại số hoặc số+chữ; mẫu đầu tiên khớp thắng; `null` khi không khớp hoặc khi tắt nhận diện. | https://developer.sepay.vn/vi/sepay-webhooks/cau-hinh-ma-thanh-toan |
| V7 | Tài khoản có **VA chính thức** hoặc **TKP**; trường `subAccount` chứa VA/TKP. → khi so tài khoản phải chấp nhận `accountNumber` **hoặc** `subAccount`. | https://developer.sepay.vn/vi/sepay-webhooks/tai-khoan-ngan-hang |
| V8 | URL webhook phải HTTPS; SePay gửi từ danh sách IP công khai (lọc IP là tuỳ chọn, plan **không** dựa vào IP). | https://developer.sepay.vn/vi/dia-chi-ip |
| V9 | API giao dịch **v2**: `GET https://userapi.sepay.vn/v2/transactions`; tham số `transaction_date_from`, `transaction_date_to` (`YYYY-MM-DD HH:mm:ss`), `transfer_type` (`in`/`out`), `transaction_date_sort` (`asc`/`desc`), `page`, `per_page` (mặc định 20, **tối đa 100**), `timestamp_format=iso8601` (trả `2026-03-18T09:00:00+07:00`), `since_id`. Response `{ status, data[], meta.pagination{ total, per_page, current_page, last_page, has_more } }`; mỗi giao dịch có `id` (**UUID**, khác `id` integer của webhook), `transaction_date`, `account_number`, `va` (nullable), `amount_in`, `amount_out`, `transaction_content`, `reference_number`, `code`, `bank_brand_name`, `bank_account_id` (UUID), `va_id`, `webhook_success`, `transfer_type`; tiền luôn integer. Rate limit **3 request/giây/IP** (kiểm tra trước xác thực), vượt → `429` + `Retry-After`; `401` khi token sai (`error_code: unauthorized`). API v1 (`my.sepay.vn/userapi`) đã ngừng phát triển, 2 req/s. Token tạo ở **Test mode** chỉ dùng được trên `https://userapi-sandbox.sepay.vn` (trang `…/v2/bat-dau-nhanh`). | https://developer.sepay.vn/vi/sepay-api/v2/giao-dich/danh-sach ; .../v2/xac-thuc ; .../v1/api-giao-dich |
| V10 | Ví dụ đối soát chính thức dedupe theo `reference_number`, đặt `UNIQUE(sepay_id)` và lưu trường `va` của v2 vào cột `sub_account`. | https://developer.sepay.vn/vi/sepay-webhooks/doi-soat-giao-dich |
| V11 | Vercel Cron gọi **HTTP GET** vào production deployment, UA `vercel-cron/1.0`, header `x-vercel-cron-schedule`; nếu có env `CRON_SECRET` thì gửi `Authorization: Bearer <CRON_SECRET>`; múi giờ UTC; **Hobby chỉ chạy tối đa 1 lần/ngày, Pro tới 1 lần/phút**. | https://vercel.com/docs/cron-jobs ; .../manage-cron-jobs ; .../usage-and-pricing |

**UNVERIFIED (có gate ở Task 0, kết quả ghi vào mô tả PR):**

| # | Điều chưa xác minh được | Rủi ro nếu sai | Gate |
|---|---|---|---|
| U1 | Tiền tố scheme của `Authorization` cho API v2 (output công cụ đọc docs bị che; gần như chắc là `Bearer`). | Reconcile 401. | G2 |
| U2 | `reference_number` của v2 có bằng `referenceCode` của webhook cho cùng giao dịch không. | Dedupe chéo hỏng → giao dịch thứ hai vào review `ORDER_ALREADY_PAID` (an toàn, không double-credit). | G3 |
| U3 | SePay có ký lại (timestamp mới) khi retry/replay thủ công không. Nếu giữ timestamp cũ, retry sau > 300 s bị `STALE`. | Webhook retry bị 401; reconcile vẫn nhặt được. | G4 |
| U4 | Với VA: số khách chuyển vào nằm ở `accountNumber` hay `subAccount`. | Code đã chấp nhận cả hai. | G5 |
| U5 | "Gửi thử"/Test mode có ký giống thật không, và `id` của payload thử có đúng là `0` như PR5 (F6) ghi không. | Plan coi `id = 0` là ping (không lưu giao dịch, chỉ ghi `last_valid_webhook_at`); nếu id thử khác, ping sẽ thành giao dịch `UNKNOWN_CODE` trong review (không mất gì, chỉ gây nhiễu). | G5 |
| U6 | Gói Vercel của dự án có là **Pro** (cron 5/15 phút) không. | Hobby: deploy lỗi nếu cron > 1 lần/ngày. | G1 |

## Review Focus

Những tình huống thật sẽ gặp mà spec không nói rõ. Mỗi dòng có test ở task ghi bên phải.

1. **Cùng một giao dịch gửi trùng đồng thời / replay thủ công từ dashboard SePay** → đúng 1 `order_payments`, mọi request đều nhận `{"success": true}`. → Task 3 (`recordBankTransaction` ×5), Task 4 (`matchTransaction` ×5), Task 5 (HTTP ×5).
2. **Khách chuyển khoản hai lần cùng mã (hai giao dịch khác `id`)** → lần đầu xác nhận, lần sau vào review `ORDER_ALREADY_PAID`, tiền không mất. → Task 4.
3. **Tiền đến sau khi attempt hết hạn / sau khi đơn bị hủy (kể cả hủy tự động sau 24 h)** → hết hạn: vẫn xác nhận, `late_payment = true`; đã hủy: review `ORDER_CANCELLED` + `payment_status = REFUND_DUE`. → Task 4, Task 6.
4. **Webhook mất hoặc Tx2 lỗi sau khi Tx1 đã commit; đối soát API gặp lại giao dịch đã có (id UUID ≠ id integer)** → giao dịch `RECEIVED` được match lại; không ghi nhận tiền lần hai. → Task 5, Task 7.
5. **Owner bấm "Gán vào đơn" hai lần / hai owner cùng lúc / gán vào đơn của org khác** → một thành công, còn lại 409 `STATUS_CONFLICT` hoặc 404; không có `order_payments` thứ hai. → Task 8.

---

## Interfaces dùng từ PR trước (Consumes) — đã đối chiếu với plan PR3/PR4/PR5 (cùng thư mục), được khoá bằng Task 0

| PR | Tên (giữ nguyên) | Dùng để |
|---|---|---|
| PR0/PR1 | `getDb()`, `Db`, `Tx`, `DbOrTx` (`server/db/client.ts`); `defineApiHandler`, `AppError`, `logger`, `parseBody`, `parseQuery`, `parseWith`; `requireStoreOwner(event, storeId): Promise<StoreContext>` (`StoreContext = { orgId, storeId, role, userId }`), `requireOrgOwner`; `getPgError`, `isUniqueViolation`; bảng `organizations`, `stores`; `tests/support/{db,fixtures}.ts` (`resetDb`, `createTenant`, `addStaff`, `createStore`) | nền |
| PR2 | `generateToken(bytes = 32)`, `hashToken(token)` (`server/utils/tokens.ts`) | token khách trong fixture |
| PR3 | `server/db/schema/ordering.ts`: `orders` (`id, orgId, storeId, publicCode, status, paymentMethod, paymentStatus, totalVnd, latePayment, createdAt, updatedAt…`, unique `orders_store_id_id_uq`), `orderEvents` (`eventType` là **text**, `actorUserId` FK `user_profiles`), `rateLimits`; pgEnum `order_status`, `payment_status`; `consumeRateLimit(db: DbOrTx, key, { limit, windowSec, now? }): Promise<boolean>` (`true` = còn hạn mức); `encryptSecret`/`decryptSecret`; `tests/support/checkout-fixtures.ts` → `insertRawOrder(store, over?)` | ghi trạng thái đơn, rate limit, fixture đơn |
| PR4 | `server/db/schema/owner-ops.ts`: `orderPayments` (`id, orgId, storeId, orderId, bankTransactionId` nullable **chưa FK**, `method` pgEnum `order_payment_method` = `CASH \| SEPAY \| BANK_MANUAL`, `amountVnd, note, recordedBy, recordedAt`; **`order_payments_order_uq` = mỗi đơn đúng một khoản thu**); route `POST /api/stores/:storeId/orders/:orderId/mark-paid` (`requireStoreStaff` + `markPaidSchema { expectedPaymentStatus, method: 'CASH', note? }`); hủy đơn `PAID` ⇒ `REFUND_DUE`; `app/utils/order-view.ts` (`describeEvent`, `formatDateTime`); `app/layouts/owner.vue` (`allNavItems` + `ownerOnly`) | ghi khoản thu, mở rộng `BANK_MANUAL`, UI |
| PR5 | `server/db/schema/payment-setup.ts`: `storePaymentAccounts` (`vaNumber`, `qrCheckedAt`, `verifiedAt`), `sepayIntegrations` (`environment` `test\|live`, `encryptedHmacSecret`, `encryptedApiToken`, `webhookEndpointKey`, `status`, **`lastValidWebhookAt` do PR6 ghi**; unique mở `(org, environment)`), `integrationAccounts` (PK `(integrationId, paymentAccountId)`), `paymentAttempts` (**bản chụp** `bankCode, accountNumber, vaNumber, accountHolder`, `paymentCode`, `transferContent`, `expectedAmountVnd`, `status` `PENDING\|PAID\|EXPIRED\|SUPERSEDED`, `expiresAt`; unique một `PENDING` mỗi đơn); `findIntegrationByEndpointKey`, `loadIntegrationSecrets` (`server/services/payments/integration-secrets.ts`); `PAYMENT_TEST_CODE = 'ZOTEST0000'` (`payment-code.ts`); fixtures `createPaymentAccount`, `createIntegration`, `linkAccount`, `setupBankQr` (`tests/support/payment-fixtures.ts`) | cấu hình, attempt, secret, mã thử |

Tên cột TypeScript (camelCase) theo các plan trên và PRD §6; Task 0 kiểm tra tồn tại bằng test thật. Nếu code thật của PR trước lệch plan, **sửa bảng này và search/replace trong plan** trước khi tiếp tục.

## File Structure

| File | Trách nhiệm |
|---|---|
| `shared/payments.ts` | enum dùng chung (`BANK_TX_STATUSES`, `REVIEW_REASONS`, `RESOLUTIONS`), nhãn tiếng Việt |
| `shared/schemas/reconciliation.ts` | zod input: gán, xử lý, hoàn tiền, `BANK_MANUAL` |
| `shared/types/reconciliation.ts` | DTO cho UI (`ReviewItem`, `OrderBrief`, `ReconciliationSummary`) |
| `server/db/schema/payment-webhook.ts` | `bank_transactions`, `bank_transaction_events`, `reconcile_checkpoints`, `sepay_webhook_auth` |
| `server/db/schema/owner-ops.ts` (modify, PR4) | FK + unique partial cho `order_payments.bank_transaction_id` |
| `app/utils/order-view.ts` (modify, PR4) | `describeEvent` biết event thanh toán của PR6 |
| `server/services/payments/types.ts` | `BankTransactionInput`, `RecordResult`, `MatchOutcome` |
| `server/services/payments/sepay-signature.ts` | `verifySepaySignature`, `verifySepayApiKey` |
| `server/services/payments/sepay-payload.ts` | zod payload, `parseSepayTransactionDate`, `extractPaymentCode`, `toBankTransactionInput` |
| `server/services/payments/record-bank-transaction.ts` | ghi idempotent + dedupe chéo nguồn |
| `server/services/payments/lock-order-graph.ts` | khoá `attempts → order` theo thứ tự chuẩn |
| `server/services/payments/confirm-payment.ts` | đường ghi nhận thu tiền duy nhất (webhook, gán tay, BANK_MANUAL) |
| `server/services/payments/match-transaction.ts` | `matchTransaction` theo bảng spec §6.3 |
| `server/services/payments/webhook-auth.ts`, `webhook-traffic.ts`, `webhook-auth-settings.ts`, `process-sepay-webhook.ts` | xác thực theo mode, rate limit, cài đặt mode + `last_valid_webhook_at`, pipeline xử lý |
| `server/api/webhooks/sepay/[key].post.ts` | route webhook |
| `server/api/organizations/[orgId]/sepay-integrations/[integrationId]/webhook-auth-mode.put.ts` | owner chọn HMAC/API Key |
| `server/utils/cron-auth.ts`, `server/api/internal/*.ts`, `vercel.json` | cron + bảo vệ |
| `server/services/payments/expire-payment-attempts.ts` | hết hạn attempt + hủy đơn quá 24 h có điều kiện |
| `server/services/payments/sepay-client.ts`, `reconcile-sepay.ts` | client API v2 + job đối soát |
| `server/services/payments/review-queue.ts`, `manual-payments.ts` | hàng đợi review, gán, xử lý, hoàn tiền, quá hạn, `BANK_MANUAL` |
| `server/api/stores/[storeId]/reconciliation/**`, `.../orders/[orderId]/refunded.post.ts` | API owner |
| `app/pages/app/reconciliation.vue`, `app/composables/useReconciliation.ts`, `app/components/app/Reconciliation*.vue` | UI owner |
| `tests/support/webhook-fixtures.ts` | fixture tích hợp (dựa trên fixture PR5), đơn/attempt, payload, chữ ký |

---

### Task 0: Preflight — kiểm tra interface PR3–PR5 và gate xác minh SePay

**Files:**
- Test: `tests/integration/payment-contracts.test.ts`

**Interfaces:**
- Consumes: toàn bộ bảng "Interfaces dùng từ PR trước".
- Produces: bằng chứng (test xanh) rằng tên cột/enum/`consumeRateLimit` đúng như các task sau giả định; kết quả G1–G5 ghi vào mô tả PR.

- [ ] **Step 1: Viết contract test**

`tests/integration/payment-contracts.test.ts`:

```ts
import { getTableColumns, sql, type Table } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import {
  integrationAccounts, orderEvents, orderPayments, orders, paymentAttempts, sepayIntegrations, storePaymentAccounts,
} from '../../server/db/schema'
import { consumeRateLimit } from '../../server/services/ordering/rate-limit'
import { findIntegrationByEndpointKey, loadIntegrationSecrets } from '../../server/services/payments/integration-secrets'
import { PAYMENT_TEST_CODE } from '../../server/services/payments/payment-code'
import { decryptSecret, encryptSecret } from '../../server/utils/crypto'
import { resetDb } from '../support/db'
import { insertRawOrder } from '../support/checkout-fixtures'
import { createIntegration, linkAccount, setupBankQr } from '../support/payment-fixtures'
import { createTenant } from '../support/fixtures'

const REQUIRED_COLUMNS: [string, Table, string[]][] = [
  ['orders', orders, ['id', 'orgId', 'storeId', 'publicCode', 'status', 'paymentStatus', 'totalVnd', 'latePayment', 'createdAt']],
  ['orderEvents', orderEvents, ['orgId', 'storeId', 'orderId', 'actorUserId', 'eventType', 'fromState', 'toState', 'metadata']],
  ['orderPayments', orderPayments, ['id', 'orgId', 'storeId', 'orderId', 'bankTransactionId', 'method', 'amountVnd', 'note', 'recordedBy', 'recordedAt']],
  ['paymentAttempts', paymentAttempts, ['id', 'orgId', 'storeId', 'orderId', 'accountId', 'bankCode', 'accountNumber', 'vaNumber', 'accountHolder', 'paymentCode', 'transferContent', 'expectedAmountVnd', 'status', 'expiresAt', 'createdAt']],
  ['storePaymentAccounts', storePaymentAccounts, ['id', 'orgId', 'storeId', 'bankCode', 'accountNumber', 'vaNumber', 'accountHolder', 'isActive', 'qrCheckedAt', 'verifiedAt']],
  ['sepayIntegrations', sepayIntegrations, ['id', 'orgId', 'name', 'environment', 'webhookEndpointKey', 'encryptedHmacSecret', 'encryptedApiToken', 'keyVersion', 'status', 'lastValidWebhookAt']],
  ['integrationAccounts', integrationAccounts, ['integrationId', 'paymentAccountId']],
]

const db = () => getDb()

async function enumLabels(typeName: string): Promise<string[]> {
  const { rows } = await db().execute<{ label: string }>(
    sql`select e.enumlabel as label from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = ${typeName}`,
  )
  return rows.map(row => row.label)
}

async function columnKind(table: string, column: string): Promise<{ dataType: string, udtName: string }> {
  const { rows } = await db().execute<{ data_type: string, udt_name: string }>(
    sql`select data_type, udt_name from information_schema.columns where table_schema = 'public' and table_name = ${table} and column_name = ${column}`,
  )
  return { dataType: rows[0]!.data_type, udtName: rows[0]!.udt_name }
}

beforeEach(async () => {
  await resetDb()
})
afterAll(async () => {
  await closeDb()
})

describe('PR6 contracts with PR3–PR5', () => {
  it.each(REQUIRED_COLUMNS)('%s exposes the columns PR6 reads/writes', (_name, table, columns) => {
    expect(Object.keys(getTableColumns(table))).toEqual(expect.arrayContaining(columns))
  })

  it('order_status and payment_status contain the values PR6 writes', async () => {
    expect(await enumLabels('order_status')).toEqual(expect.arrayContaining(['AWAITING_PAYMENT', 'NEW', 'CANCELLED']))
    expect(await enumLabels('payment_status')).toEqual(
      expect.arrayContaining(['UNPAID', 'PENDING', 'PAID', 'REVIEW_REQUIRED', 'REFUND_DUE', 'REFUNDED']),
    )
  })

  it('order_payments.method accepts SEPAY, CASH and BANK_MANUAL', async () => {
    const kind = await columnKind('order_payments', 'method')
    if (kind.dataType !== 'USER-DEFINED') return
    expect(await enumLabels(kind.udtName)).toEqual(expect.arrayContaining(['SEPAY', 'CASH', 'BANK_MANUAL']))
  })

  it('order_events.event_type is free text (PR6 adds new event types without ALTER TYPE)', async () => {
    expect((await columnKind('order_events', 'event_type')).dataType).not.toBe('USER-DEFINED')
  })

  it('consumeRateLimit returns true while under the limit and false once exceeded', async () => {
    const options = { limit: 2, windowSec: 60 }
    expect(await consumeRateLimit(db(), 'contract:k', options)).toBe(true)
    expect(await consumeRateLimit(db(), 'contract:k', options)).toBe(true)
    expect(await consumeRateLimit(db(), 'contract:k', options)).toBe(false)
  })

  it('encryptSecret/decryptSecret round-trip', () => {
    expect(decryptSecret(encryptSecret('whsec_abc'))).toBe('whsec_abc')
  })

  it('PAYMENT_TEST_CODE is the ZO-code PR5 uses for the account QR check', () => {
    expect(PAYMENT_TEST_CODE).toMatch(/^ZO[A-Z0-9]{8}$/)
  })

  it('PR5 integration helpers resolve a webhook endpoint key and decrypt its secrets', async () => {
    const tenant = await createTenant('contract')
    const { integration } = await setupBankQr(tenant.store)
    expect(await findIntegrationByEndpointKey(db(), integration.webhookEndpointKey)).toMatchObject({ id: integration.id, orgId: tenant.org.id })
    expect(await findIntegrationByEndpointKey(db(), 'x'.repeat(32))).toBeNull()
    expect(await loadIntegrationSecrets(db(), integration.id)).toMatchObject({ hmacSecret: expect.any(String) })
  })

  it('PR3/PR5 fixtures build the rows PR6 fixtures rely on', async () => {
    const tenant = await createTenant('fixtures')
    const order = await insertRawOrder(tenant.store, { paymentMethod: 'BANK_QR', status: 'AWAITING_PAYMENT', paymentStatus: 'PENDING' })
    expect(order.status).toBe('AWAITING_PAYMENT')
    const extra = await createIntegration(tenant.org, { environment: 'test' })
    expect(extra.environment).toBe('test')
    expect(typeof linkAccount).toBe('function')
  })
})
```

- [ ] **Step 2: Chạy test**

Run: `npm run test:integration -- tests/integration/payment-contracts.test.ts`
Expected: PASS toàn bộ. Nếu FAIL: dòng lỗi chỉ đúng cột/enum lệch. Sửa **bảng Consumes và mọi chỗ dùng tên đó trong plan này**, không sửa test cho xanh. Đặc biệt:
- `order_payments.method` là enum thiếu `SEPAY`/`BANK_MANUAL`: thêm giá trị vào enum trong schema PR4 (sẽ nằm chung migration Task 1).
- `consumeRateLimit` trả ngược nghĩa (`true` = bị chặn): đảo điều kiện trong `webhook-traffic.ts` (Task 5), không đảo test.

- [ ] **Step 3: Gate G1 (Vercel plan) — thủ công**

Mở Vercel → Settings → Billing, xác nhận project ở gói **Pro** (cron `*/5` và `*/15` chỉ deploy được trên Pro, V11). Nếu là Hobby: không merge `vercel.json` ở Task 6 như dưới đây; đổi cả hai schedule thành `0 3 * * *` (một lần/ngày) và ghi rõ trong PR rằng hết hạn attempt/đối soát chạy chậm — tính đúng đắn của tiền **không** phụ thuộc cron (webhook vẫn match tức thời, attempt hết hạn vẫn match được khi tiền đến muộn).

- [ ] **Step 4: Gate G2–G5 (SePay Test mode) — thủ công, không commit token**

Trên my.sepay.vn bật **Test mode** → API Access → tạo token sandbox; tạo một webhook trỏ về tunnel tới `npm run dev` (hoặc preview) với HMAC-SHA256. Chạy và ghi kết quả vào mô tả PR:

```bash
export SEPAY_SANDBOX_TOKEN=<token-sandbox>   # chỉ trong shell, KHÔNG ghi vào file
curl -s -H "Authorization: Bearer $SEPAY_SANDBOX_TOKEN" \
  "https://userapi-sandbox.sepay.vn/v2/transactions?per_page=2&timestamp_format=iso8601" | head -c 1500
```

| Gate | Câu hỏi | Cách kiểm | Nếu kết quả khác giả định |
|---|---|---|---|
| G2 | `Bearer` có được chấp nhận? (PR5 gọi gate này là "U1 — PR6 Task 4"; ở plan này là Task 0 → Task 7) | lệnh `curl` trên trả `status: success` | đổi hằng `AUTH_SCHEME` trong `sepay-client.ts` (Task 7) và ghi vào spec §13 |
| G3 | `reference_number` (v2) == `referenceCode` (webhook) cho cùng giao dịch? | bấm "Gửi thử" / tạo giao dịch mô phỏng, so hai trường | nếu khác: `findCrossSourceTwin` (Task 3) so `(account, amount, transactionDate đến phút)` thay vì `reference`; ghi lại trong PR |
| G4 | Gửi lại một log cũ > 5 phút từ "Nhật ký webhooks": header `X-SePay-Timestamp` là thời điểm gửi lại hay giữ nguyên thời điểm ký ban đầu? | xem header request tại server dev | nếu giữ nguyên: **không** nới `SIGNATURE_TOLERANCE_SEC` (giữ 300 s theo docs V4), chấp nhận retry muộn bị 401 và dựa vào cron đối soát; ghi kết quả vào PR |
| G5 | VA: `accountNumber` hay `subAccount` là số khách chuyển vào? "Gửi thử" có ký? | gửi thử với tài khoản VA | code đã chấp nhận cả hai; chỉ cập nhật hướng dẫn wizard PR5 |

Không có sandbox/credentials: đánh dấu G2–G5 "chưa chạy" trong PR và **không bật** integration `ACTIVE` ở production cho tới khi đã chạy (PRD §8.1 bước 5).

- [ ] **Step 5: Commit**

```bash
git add tests/integration/payment-contracts.test.ts
git commit -m "test(payment-webhook): add PR3-PR5 contract checks for payment matching

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 1: Schema `payment_webhook` + migration + fixtures

**Files:**
- Create: `shared/payments.ts`, `server/db/schema/payment-webhook.ts`, `server/services/payments/types.ts`, `tests/support/webhook-fixtures.ts`, `drizzle/00NN_payment_webhook.sql` (generated)
- Modify: `server/db/schema/index.ts`, `server/db/schema/owner-ops.ts` (file schema của PR4 chứa `orderPayments`; xác nhận tên file bằng `grep -l "order_payments" server/db/schema/*.ts`)
- Test: `tests/unit/shared/payments.test.ts`, `tests/integration/payment-webhook-schema.test.ts`

**Interfaces:**
- Consumes: `organizations`, `stores` (PR1); `orders`, `orderEvents`, `insertRawOrder` (PR3); `orderPayments` (PR4); `sepayIntegrations`, `storePaymentAccounts`, `integrationAccounts`, `paymentAttempts`, fixtures `createPaymentAccount`/`createIntegration`/`linkAccount` (PR5); `encryptSecret`, `generateToken`, `hashToken`; `createTenant`.
- Produces:
  - `shared/payments.ts`: `BANK_TX_STATUSES`, `BANK_TX_SOURCES`, `BANK_TX_DIRECTIONS`, `REVIEW_REASONS`, `RESOLUTIONS`, `BANK_TX_ACTIONS`, types `BankTxStatus`, `ReviewReason`, `Resolution`, `BankTxAction`, `REVIEW_REASON_LABEL`, `RESOLUTION_LABEL`.
  - Bảng Drizzle `bankTransactions`, `bankTransactionEvents`, `reconcileCheckpoints`, `sepayWebhookAuth`; enum `reconciliationStatus`, `bankTxSource`, `bankTxDirection`, `bankTxReviewReason`, `bankTxResolution`.
  - Constraint names: `bank_transactions_integration_provider_uq`, `bank_transactions_amount_positive`, `bank_transactions_match_pair`, `bank_transactions_order_fk`, `bank_transactions_store_fk`, `order_payments_bank_tx_fk`, `order_payments_bank_tx_uq` (cùng `order_payments_order_uq` có sẵn của PR4).
  - Fixtures (`tests/support/webhook-fixtures.ts`): `createPaymentSetup(tenant, opts?)` (`opts.reuse` cho store thứ hai cùng org), `createAttempt`, `createAwaitingOrder` (trả `{ order, attempt, guestToken }`), `bankTxInput`, `sepayPayload`, `signSepayBody`, `bodyOf`.

- [ ] **Step 1: Viết unit test thất bại cho `shared/payments.ts`**

`tests/unit/shared/payments.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  BANK_TX_STATUSES, RESOLUTIONS, RESOLUTION_LABEL, REVIEW_REASONS, REVIEW_REASON_LABEL,
} from '#shared/payments'

describe('shared/payments', () => {
  it('has a Vietnamese label for every review reason and resolution', () => {
    for (const reason of REVIEW_REASONS) expect(REVIEW_REASON_LABEL[reason].length).toBeGreaterThan(5)
    for (const resolution of RESOLUTIONS) expect(RESOLUTION_LABEL[resolution].length).toBeGreaterThan(3)
  })

  it('keeps the status list in sync with spec §4.3', () => {
    expect([...BANK_TX_STATUSES]).toEqual(['RECEIVED', 'MATCHED', 'REVIEW_REQUIRED', 'IGNORED', 'RESOLVED'])
  })
})
```

- [ ] **Step 2: Chạy, thấy FAIL**

Run: `npm run test:unit -- tests/unit/shared/payments.test.ts`
Expected: FAIL (`Failed to resolve import "#shared/payments"`).

- [ ] **Step 3: Tạo `shared/payments.ts`**

```ts
export const BANK_TX_STATUSES = ['RECEIVED', 'MATCHED', 'REVIEW_REQUIRED', 'IGNORED', 'RESOLVED'] as const
export type BankTxStatus = (typeof BANK_TX_STATUSES)[number]

export const BANK_TX_SOURCES = ['WEBHOOK', 'RECONCILE'] as const
export type BankTxSource = (typeof BANK_TX_SOURCES)[number]

export const BANK_TX_DIRECTIONS = ['IN', 'OUT'] as const
export type BankTxDirection = (typeof BANK_TX_DIRECTIONS)[number]

export const REVIEW_REASONS = [
  'NO_CODE',
  'UNKNOWN_CODE',
  'ACCOUNT_MISMATCH',
  'AMOUNT_UNDER',
  'AMOUNT_OVER',
  'ORDER_CANCELLED',
  'ORDER_ALREADY_PAID',
  'ORDER_NOT_PAYABLE',
] as const
export type ReviewReason = (typeof REVIEW_REASONS)[number]

export const RESOLUTIONS = ['REFUNDED_OUTSIDE', 'NOT_ORDER', 'DUPLICATE', 'OTHER'] as const
export type Resolution = (typeof RESOLUTIONS)[number]

export const BANK_TX_ACTIONS = ['RECEIVED', 'ALIAS_ADDED', 'MATCHED', 'REVIEW_REQUIRED', 'ASSIGNED', 'RESOLVED', 'IGNORED'] as const
export type BankTxAction = (typeof BANK_TX_ACTIONS)[number]

export const REVIEW_REASON_LABEL: Record<ReviewReason, string> = {
  NO_CODE: 'Không thấy mã thanh toán trong nội dung chuyển khoản',
  UNKNOWN_CODE: 'Mã thanh toán không thuộc đơn nào của quán',
  ACCOUNT_MISMATCH: 'Tiền vào tài khoản khác với tài khoản của đơn',
  AMOUNT_UNDER: 'Khách chuyển thiếu tiền',
  AMOUNT_OVER: 'Khách chuyển thừa tiền',
  ORDER_CANCELLED: 'Đơn đã hủy nhưng khách vẫn chuyển tiền',
  ORDER_ALREADY_PAID: 'Đơn đã được thanh toán, đây là khoản chuyển thêm',
  ORDER_NOT_PAYABLE: 'Đơn không còn ở trạng thái chờ thanh toán',
}

export const RESOLUTION_LABEL: Record<Resolution, string> = {
  REFUNDED_OUTSIDE: 'Đã hoàn tiền cho khách',
  NOT_ORDER: 'Không phải tiền của đơn',
  DUPLICATE: 'Giao dịch trùng',
  OTHER: 'Khác',
}
```

- [ ] **Step 4: Chạy, thấy PASS**

Run: `npm run test:unit -- tests/unit/shared/payments.test.ts`
Expected: PASS.

- [ ] **Step 5: Tạo schema `server/db/schema/payment-webhook.ts`**

```ts
import { sql } from 'drizzle-orm'
import { bigint, check, foreignKey, index, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import {
  BANK_TX_ACTIONS, BANK_TX_DIRECTIONS, BANK_TX_SOURCES, BANK_TX_STATUSES, RESOLUTIONS, REVIEW_REASONS,
} from '../../../shared/payments'
import { organizations, stores } from './identity'
import { orders } from './ordering'
import { sepayIntegrations } from './payment-setup'

export const reconciliationStatus = pgEnum('reconciliation_status', BANK_TX_STATUSES)
export const bankTxSource = pgEnum('bank_tx_source', BANK_TX_SOURCES)
export const bankTxDirection = pgEnum('bank_tx_direction', BANK_TX_DIRECTIONS)
export const bankTxReviewReason = pgEnum('bank_tx_review_reason', REVIEW_REASONS)
export const bankTxResolution = pgEnum('bank_tx_resolution', RESOLUTIONS)
export const bankTxAction = pgEnum('bank_tx_action', BANK_TX_ACTIONS)
export const webhookAuthMode = pgEnum('webhook_auth_mode', ['HMAC', 'APIKEY'])

export const bankTransactions = pgTable('bank_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  integrationId: uuid('integration_id').notNull().references(() => sepayIntegrations.id),
  providerTransactionId: text('provider_transaction_id').notNull(),
  providerAltIds: text('provider_alt_ids').array().notNull().default(sql`'{}'::text[]`),
  source: bankTxSource('source').notNull(),
  direction: bankTxDirection('direction').notNull(),
  bankAccountNumber: text('bank_account_number').notNull(),
  subAccount: text('sub_account'),
  amountVnd: bigint('amount_vnd', { mode: 'number' }).notNull(),
  paymentCode: text('payment_code'),
  content: text('content'),
  referenceCode: text('reference_code'),
  transactionDate: timestamp('transaction_date', { withTimezone: true }).notNull(),
  rawPayloadJson: jsonb('raw_payload_json').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  reconciliationStatus: reconciliationStatus('reconciliation_status').notNull().default('RECEIVED'),
  reviewReason: bankTxReviewReason('review_reason'),
  matchedStoreId: uuid('matched_store_id'),
  matchedOrderId: uuid('matched_order_id'),
  resolution: bankTxResolution('resolution'),
  resolutionNote: text('resolution_note'),
  resolvedBy: text('resolved_by'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, t => [
  unique('bank_transactions_integration_provider_uq').on(t.integrationId, t.providerTransactionId),
  check('bank_transactions_amount_positive', sql`${t.amountVnd} > 0`),
  check('bank_transactions_match_pair', sql`(${t.matchedStoreId} is null) = (${t.matchedOrderId} is null)`),
  foreignKey({ name: 'bank_transactions_order_fk', columns: [t.matchedStoreId, t.matchedOrderId], foreignColumns: [orders.storeId, orders.id] }),
  foreignKey({ name: 'bank_transactions_store_fk', columns: [t.orgId, t.matchedStoreId], foreignColumns: [stores.orgId, stores.id] }),
  index('bank_transactions_queue_idx').on(t.orgId, t.reconciliationStatus, t.receivedAt),
  index('bank_transactions_payment_code_idx').on(t.paymentCode),
  index('bank_transactions_twin_idx').on(t.integrationId, t.referenceCode, t.amountVnd),
  index('bank_transactions_alt_ids_idx').using('gin', t.providerAltIds),
  index('bank_transactions_matched_order_idx').on(t.matchedOrderId),
])

export const bankTransactionEvents = pgTable('bank_transaction_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  bankTransactionId: uuid('bank_transaction_id').notNull().references(() => bankTransactions.id, { onDelete: 'cascade' }),
  action: bankTxAction('action').notNull(),
  fromStatus: reconciliationStatus('from_status'),
  toStatus: reconciliationStatus('to_status'),
  orderId: uuid('order_id'),
  actorUserId: text('actor_user_id'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index('bank_transaction_events_tx_idx').on(t.bankTransactionId, t.createdAt),
])

export const reconcileCheckpoints = pgTable('reconcile_checkpoints', {
  integrationId: uuid('integration_id').primaryKey().references(() => sepayIntegrations.id, { onDelete: 'cascade' }),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastError: text('last_error'),
})

export const sepayWebhookAuth = pgTable('sepay_webhook_auth', {
  integrationId: uuid('integration_id').primaryKey().references(() => sepayIntegrations.id, { onDelete: 'cascade' }),
  mode: webhookAuthMode('mode').notNull().default('HMAC'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
})
```

`server/db/schema/index.ts` thêm một dòng cuối: `export * from './payment-webhook'`.

Nếu Task 0 cho thấy tên file PR3/PR5 khác `./ordering` / `./payment-setup`, sửa hai import đầu file.

- [ ] **Step 6: Sửa `orderPayments` (PR4) để có FK và unique index**

PR4 đã để sẵn `bankTransactionId: uuid('bank_transaction_id')` (không FK) và `order_payments_order_uq`. Trong `server/db/schema/owner-ops.ts`:
- thêm `import { bankTransactions } from './payment-webhook'` và (nếu chưa có) `uniqueIndex` từ `drizzle-orm/pg-core`, `sql` từ `drizzle-orm`
- đổi cột thành `bankTransactionId: uuid('bank_transaction_id').references(() => bankTransactions.id)`
- thêm vào mảng constraint (tham số thứ ba của `pgTable`):

```ts
  uniqueIndex('order_payments_bank_tx_uq').on(t.bankTransactionId).where(sql`${t.bankTransactionId} is not null`),
```

(`order_payments_order_uq` của PR4 đã bảo đảm một khoản thu cho mỗi đơn; không thêm ràng buộc thứ hai.) Enum `order_payment_method` của PR4 đã có `SEPAY` và `BANK_MANUAL`.

- [ ] **Step 7: Sinh migration và kiểm tra**

Run:

```bash
npx drizzle-kit generate --name payment_webhook
npm run db:check
ENV_FILE=.env.test npx drizzle-kit migrate
```

Expected: đúng **một** file mới `drizzle/00NN_payment_webhook.sql` chứa `CREATE TABLE "bank_transactions"`, `"bank_transaction_events"`, `"reconcile_checkpoints"`, `"sepay_webhook_auth"`, các `CREATE TYPE`, `ALTER TABLE "order_payments" ADD CONSTRAINT ... FOREIGN KEY ("bank_transaction_id")` và một `CREATE UNIQUE INDEX "order_payments_bank_tx_uq" ... WHERE`. `db:check` không lỗi. Mở file SQL, xác nhận không có `DROP` ngoài ý muốn.

- [ ] **Step 8: Tạo `types.ts` và fixtures `tests/support/webhook-fixtures.ts`**

`server/services/payments/types.ts` (các task sau dùng lại):

```ts
import type { BankTxSource, BankTxStatus, ReviewReason } from '#shared/payments'

export interface BankTransactionInput {
  orgId: string
  integrationId: string
  providerTransactionId: string
  source: BankTxSource
  direction: 'IN' | 'OUT'
  bankAccountNumber: string
  subAccount: string | null
  amountVnd: number
  paymentCode: string | null
  content: string | null
  referenceCode: string | null
  transactionDate: Date
  rawPayload: unknown
}

export interface RecordResult {
  id: string
  created: boolean
  status: BankTxStatus
}

export type MatchOutcome =
  | { kind: 'MATCHED', orderId: string, late: boolean }
  | { kind: 'REVIEW', reason: ReviewReason, orderId: string | null }
  | { kind: 'IGNORED' }
  | { kind: 'SKIPPED', status: BankTxStatus }
```

`tests/support/webhook-fixtures.ts` (tên khác `payment-fixtures.ts` của PR5 để không đè; file này **dùng lại** `createPaymentAccount`, `createIntegration`, `linkAccount` của PR5 và `insertRawOrder` của PR3):

```ts
import { createHmac, randomUUID } from 'node:crypto'
import { getDb } from '../../server/db/client'
import { paymentAttempts, sepayWebhookAuth } from '../../server/db/schema'
import type { BankTransactionInput } from '../../server/services/payments/types'
import { encryptSecret } from '../../server/utils/crypto'
import { generateToken, hashToken } from '../../server/utils/tokens'
import { insertRawOrder } from './checkout-fixtures'
import { createIntegration, createPaymentAccount, linkAccount } from './payment-fixtures'

export interface Tenantish {
  org: { id: string }
  store: { id: string, orgId: string }
}

export interface PaymentSetup {
  orgId: string
  storeId: string
  integration: { id: string, webhookEndpointKey: string, environment: 'test' | 'live' }
  account: { id: string, accountNumber: string, vaNumber: string | null, bankCode: string, accountHolder: string }
  secret: string
  authMode: 'HMAC' | 'APIKEY'
}

const randomAccountNumber = () => String(1_000_000_000 + Math.floor(Math.random() * 9_000_000_000))
const randomCode = () => `ZO${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`

/**
 * One verified account for the store, linked to an integration. PR5 allows a single open integration per
 * (org, environment), so a second store of the same org passes `reuse`, and a test that needs two integrations
 * in one org uses `environment: 'test'` for the second.
 */
export async function createPaymentSetup(
  tenant: Tenantish,
  opts: {
    authMode?: 'HMAC' | 'APIKEY'
    secret?: string
    apiToken?: string | null
    accountNumber?: string
    vaNumber?: string | null
    status?: 'TESTING' | 'ACTIVE' | 'DISABLED'
    environment?: 'test' | 'live'
    reuse?: PaymentSetup
  } = {},
): Promise<PaymentSetup> {
  const now = new Date()
  const account = await createPaymentAccount(tenant.store, {
    accountNumber: opts.accountNumber ?? randomAccountNumber(),
    vaNumber: opts.vaNumber ?? null,
    qrCheckedAt: now,
    verifiedAt: now,
  })

  let integration: PaymentSetup['integration']
  let secret: string
  let authMode: PaymentSetup['authMode']
  if (opts.reuse) {
    integration = opts.reuse.integration
    secret = opts.reuse.secret
    authMode = opts.reuse.authMode
  }
  else {
    secret = opts.secret ?? `secret-${randomUUID()}`
    authMode = opts.authMode ?? 'HMAC'
    const row = await createIntegration(tenant.org, {
      environment: opts.environment ?? 'live',
      status: opts.status ?? 'ACTIVE',
      encryptedHmacSecret: encryptSecret(secret),
      encryptedApiToken: opts.apiToken ? encryptSecret(opts.apiToken) : null,
      secretUpdatedAt: now,
    })
    integration = { id: row.id, webhookEndpointKey: row.webhookEndpointKey, environment: row.environment }
    if (authMode === 'APIKEY') await getDb().insert(sepayWebhookAuth).values({ integrationId: row.id, mode: 'APIKEY' })
  }
  await linkAccount(tenant.org.id, integration.id, account.id)

  return {
    orgId: tenant.org.id,
    storeId: tenant.store.id,
    integration,
    account: {
      id: account.id,
      accountNumber: account.accountNumber,
      vaNumber: account.vaNumber,
      bankCode: account.bankCode,
      accountHolder: account.accountHolder,
    },
    secret,
    authMode,
  }
}

/** A payment attempt with the bank snapshot PR5 stores on every attempt. */
export async function createAttempt(
  setup: PaymentSetup,
  orderId: string,
  opts: { amountVnd?: number, status?: 'PENDING' | 'EXPIRED' | 'SUPERSEDED' | 'PAID', expiresAt?: Date, paymentCode?: string } = {},
) {
  const code = opts.paymentCode ?? randomCode()
  const [attempt] = await getDb().insert(paymentAttempts).values({
    orgId: setup.orgId,
    storeId: setup.storeId,
    orderId,
    accountId: setup.account.id,
    bankCode: setup.account.bankCode,
    accountNumber: setup.account.accountNumber,
    vaNumber: setup.account.vaNumber,
    accountHolder: setup.account.accountHolder,
    paymentCode: code,
    transferContent: code,
    expectedAmountVnd: opts.amountVnd ?? 55_000,
    status: opts.status ?? 'PENDING',
    expiresAt: opts.expiresAt ?? new Date(Date.now() + 15 * 60_000),
  }).returning()
  return attempt!
}

export async function createAwaitingOrder(
  setup: PaymentSetup,
  opts: {
    amountVnd?: number
    attemptStatus?: 'PENDING' | 'EXPIRED' | 'SUPERSEDED'
    expiresAt?: Date
    createdAt?: Date
    paymentCode?: string
    orderStatus?: 'AWAITING_PAYMENT' | 'NEW' | 'CANCELLED'
    paymentStatus?: 'PENDING' | 'PAID' | 'UNPAID' | 'REVIEW_REQUIRED' | 'REFUND_DUE'
  } = {},
) {
  const amountVnd = opts.amountVnd ?? 55_000
  const guestToken = generateToken()
  const order = await insertRawOrder({ id: setup.storeId, orgId: setup.orgId }, {
    guestTokenHash: hashToken(guestToken),
    guestTokenEncrypted: encryptSecret(guestToken),
    subtotalVnd: amountVnd,
    deliveryFeeVnd: 0,
    totalVnd: amountVnd,
    status: opts.orderStatus ?? 'AWAITING_PAYMENT',
    paymentMethod: 'BANK_QR',
    paymentStatus: opts.paymentStatus ?? 'PENDING',
    ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
  })
  const attempt = await createAttempt(setup, order.id, {
    amountVnd,
    status: opts.attemptStatus,
    expiresAt: opts.expiresAt,
    paymentCode: opts.paymentCode,
  })
  return { order, attempt, guestToken }
}

export function bankTxInput(setup: PaymentSetup, overrides: Partial<BankTransactionInput> = {}): BankTransactionInput {
  return {
    orgId: setup.orgId,
    integrationId: setup.integration.id,
    providerTransactionId: String(Math.floor(Math.random() * 1_000_000_000) + 1),
    source: 'WEBHOOK',
    direction: 'IN',
    bankAccountNumber: setup.account.accountNumber,
    subAccount: null,
    amountVnd: 55_000,
    paymentCode: null,
    content: 'thanh toan',
    referenceCode: `FT${randomUUID().slice(0, 10)}`,
    transactionDate: new Date(),
    rawPayload: { fixture: true },
    ...overrides,
  }
}

export function sepayPayload(setup: PaymentSetup, overrides: Record<string, unknown> = {}) {
  return {
    id: Math.floor(Math.random() * 1_000_000_000) + 1,
    gateway: 'Vietcombank',
    transactionDate: '2026-11-01 10:15:00',
    accountNumber: setup.account.accountNumber,
    subAccount: '',
    code: null as string | null,
    content: 'thanh toan don hang',
    transferType: 'in',
    description: '',
    transferAmount: 55_000,
    accumulated: 0,
    referenceCode: `FT${randomUUID().slice(0, 10)}`,
    ...overrides,
  }
}

export const bodyOf = (payload: unknown): string => JSON.stringify(payload)

export function signSepayBody(rawBody: string, secret: string, timestampSec = Math.floor(Date.now() / 1000)) {
  const hex = createHmac('sha256', secret).update(`${timestampSec}.${rawBody}`).digest('hex')
  return { 'x-sepay-signature': `sha256=${hex}`, 'x-sepay-timestamp': String(timestampSec) }
}
```

Nếu `insertRawOrder` hoặc `createIntegration` của PR3/PR5 đã đổi chữ ký, sửa **chỗ gọi trong file này**, không sửa các test dùng nó. Nếu `orders`/`payment_attempts` có cột NOT NULL mới không có default, thêm giá trị hợp lệ vào `insertRawOrder`/`createAttempt`, đừng nới schema.

- [ ] **Step 9: Viết integration test cho schema**

`tests/integration/payment-webhook-schema.test.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { getPgError } from '../../server/db/errors'
import { bankTransactions, orderPayments } from '../../server/db/schema'
import { resetDb } from '../support/db'
import { bankTxInput, createAwaitingOrder, createPaymentSetup } from '../support/webhook-fixtures'
import { createTenant } from '../support/fixtures'

const db = () => getDb()

async function insertTx(setup: Awaited<ReturnType<typeof createPaymentSetup>>, overrides: Record<string, unknown> = {}) {
  const input = bankTxInput(setup)
  const [row] = await db().insert(bankTransactions).values({
    orgId: input.orgId,
    integrationId: input.integrationId,
    providerTransactionId: input.providerTransactionId,
    source: input.source,
    direction: input.direction,
    bankAccountNumber: input.bankAccountNumber,
    amountVnd: input.amountVnd,
    transactionDate: input.transactionDate,
    rawPayloadJson: input.rawPayload,
    ...overrides,
  }).returning()
  return row!
}

async function expectPg(promise: Promise<unknown>, code: string, constraint?: string) {
  const err = await promise.then(() => null, (e: unknown) => e)
  expect(err, 'expected the statement to fail').not.toBeNull()
  expect(getPgError(err)).toMatchObject({ code, ...(constraint ? { constraint } : {}) })
}

beforeEach(async () => {
  await resetDb()
})
afterAll(async () => {
  await closeDb()
})

describe('bank_transactions', () => {
  it('rejects a second row with the same (integration, provider id)', async () => {
    const setup = await createPaymentSetup(await createTenant('a'))
    await insertTx(setup, { providerTransactionId: '777' })
    await expectPg(insertTx(setup, { providerTransactionId: '777' }), '23505', 'bank_transactions_integration_provider_uq')
  })

  it('allows the same provider id under a different integration', async () => {
    const one = await createPaymentSetup(await createTenant('a'))
    const two = await createPaymentSetup(await createTenant('b'))
    await insertTx(one, { providerTransactionId: '777' })
    await expect(insertTx(two, { providerTransactionId: '777' })).resolves.toBeTruthy()
  })

  it('rejects zero or negative amounts', async () => {
    const setup = await createPaymentSetup(await createTenant('a'))
    await expectPg(insertTx(setup, { amountVnd: 0 }), '23514', 'bank_transactions_amount_positive')
  })

  it('requires matched store and order to be set together', async () => {
    const tenant = await createTenant('a')
    const setup = await createPaymentSetup(tenant)
    await expectPg(insertTx(setup, { matchedStoreId: tenant.store.id }), '23514', 'bank_transactions_match_pair')
  })

  it('rejects a matched order from another store/tenant', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const setupA = await createPaymentSetup(a)
    const setupB = await createPaymentSetup(b)
    const { order } = await createAwaitingOrder(setupB)
    await expectPg(
      insertTx(setupA, { matchedStoreId: b.store.id, matchedOrderId: order.id }),
      '23503',
      'bank_transactions_store_fk',
    )
  })
})

describe('order_payments bank linkage', () => {
  async function pay(setup: Awaited<ReturnType<typeof createPaymentSetup>>, orderId: string, bankTransactionId: string | null) {
    return db().insert(orderPayments).values({
      orgId: setup.orgId,
      storeId: setup.storeId,
      orderId,
      bankTransactionId,
      method: bankTransactionId ? 'SEPAY' : 'BANK_MANUAL',
      amountVnd: 55_000,
    })
  }

  it('rejects an unknown bank_transaction_id', async () => {
    const setup = await createPaymentSetup(await createTenant('a'))
    const { order } = await createAwaitingOrder(setup)
    await expectPg(pay(setup, order.id, randomUUID()), '23503')
  })

  it('rejects the same bank transaction credited twice', async () => {
    const setup = await createPaymentSetup(await createTenant('a'))
    const one = await createAwaitingOrder(setup)
    const two = await createAwaitingOrder(setup)
    const tx = await insertTx(setup)
    await pay(setup, one.order.id, tx.id)
    await expectPg(pay(setup, two.order.id, tx.id), '23505', 'order_payments_bank_tx_uq')
  })

  it('rejects a second payment on the same order, whatever the method (PR4 order_payments_order_uq)', async () => {
    const setup = await createPaymentSetup(await createTenant('a'))
    const { order } = await createAwaitingOrder(setup)
    const first = await insertTx(setup)
    const second = await insertTx(setup)
    await pay(setup, order.id, first.id)
    await expectPg(pay(setup, order.id, second.id), '23505', 'order_payments_order_uq')
    await expectPg(pay(setup, order.id, null), '23505', 'order_payments_order_uq')
  })

  it('still allows a payment without a bank transaction (manual)', async () => {
    const setup = await createPaymentSetup(await createTenant('a'))
    const { order } = await createAwaitingOrder(setup)
    await pay(setup, order.id, null)
    expect(await db().select().from(orderPayments).where(eq(orderPayments.orderId, order.id))).toHaveLength(1)
  })
})
```

- [ ] **Step 10: Chạy test schema**

Run: `npm run test:integration -- tests/integration/payment-webhook-schema.test.ts`
Expected: PASS (migrate đã chạy ở Step 7; script `test:integration` còn tự migrate lại).

- [ ] **Step 11: Commit**

```bash
git add shared/payments.ts server/db/schema server/services/payments/types.ts drizzle tests/support/webhook-fixtures.ts tests/unit/shared/payments.test.ts tests/integration/payment-webhook-schema.test.ts
git commit -m "feat(payment-webhook): add bank transaction schema, FK and unique guards

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Xác thực webhook và parse payload (hàm thuần)

**Files:**
- Create: `server/services/payments/sepay-signature.ts`, `server/services/payments/sepay-payload.ts`
- Test: `tests/unit/server/sepay-signature.test.ts`, `tests/unit/server/sepay-payload.test.ts`

**Interfaces:**
- Consumes: `generatePaymentCode(): string` (PR5, `server/services/payments/payment-code.ts`) chỉ trong test để khoá định dạng mã; `BankTransactionInput` (Task 1).
- Produces:
  - `verifySepaySignature(input: { rawBody: string, timestamp: string | undefined, signatureHeader: string | undefined, secret: string, nowSec: number }): 'OK' | 'MISSING' | 'STALE' | 'MISMATCH'`; `SIGNATURE_TOLERANCE_SEC = 300`.
  - `verifySepayApiKey(input: { authorizationHeader: string | undefined, apiKey: string }): 'OK' | 'MISSING' | 'MISMATCH'`.
  - `sepayWebhookPayloadSchema` (zod), `type SepayWebhookPayload`, `parseSepayTransactionDate(value: string): Date`, `extractPaymentCode(code: string | null | undefined, content: string | null | undefined): string | null`, `toBankTransactionInput(integration: { id: string, orgId: string }, payload: SepayWebhookPayload): BankTransactionInput`.

- [ ] **Step 1: Viết test thất bại cho chữ ký và API key**

`tests/unit/server/sepay-signature.test.ts`:

```ts
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SIGNATURE_TOLERANCE_SEC, verifySepayApiKey, verifySepaySignature } from '../../../server/services/payments/sepay-signature'

const SECRET = 'whsec_unit_test_secret'
const NOW = 1_800_000_000
const BODY = '{"id":92704,"transferAmount":5000000,"content":"ZOABCD1234 chuyển tiền"}'

function sign(body: string, timestamp: number, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`
}

function verify(overrides: Partial<Parameters<typeof verifySepaySignature>[0]> = {}) {
  return verifySepaySignature({
    rawBody: BODY,
    timestamp: String(NOW),
    signatureHeader: sign(BODY, NOW),
    secret: SECRET,
    nowSec: NOW,
    ...overrides,
  })
}

describe('verifySepaySignature', () => {
  it('accepts a correctly signed raw body (non-ASCII included)', () => {
    expect(verify()).toBe('OK')
  })

  it('accepts uppercase hex and a timestamp at the edge of the window', () => {
    expect(verify({ signatureHeader: sign(BODY, NOW).toUpperCase().replace('SHA256=', 'sha256=') })).toBe('OK')
    expect(verify({ timestamp: String(NOW - SIGNATURE_TOLERANCE_SEC), signatureHeader: sign(BODY, NOW - SIGNATURE_TOLERANCE_SEC) })).toBe('OK')
  })

  it('reports MISSING when either header is absent or empty', () => {
    expect(verify({ timestamp: undefined })).toBe('MISSING')
    expect(verify({ signatureHeader: undefined })).toBe('MISSING')
    expect(verify({ signatureHeader: '' })).toBe('MISSING')
  })

  it('reports STALE outside ±300 s, in both directions, and for non-numeric timestamps', () => {
    const past = NOW - SIGNATURE_TOLERANCE_SEC - 1
    const future = NOW + SIGNATURE_TOLERANCE_SEC + 1
    expect(verify({ timestamp: String(past), signatureHeader: sign(BODY, past) })).toBe('STALE')
    expect(verify({ timestamp: String(future), signatureHeader: sign(BODY, future) })).toBe('STALE')
    expect(verify({ timestamp: 'abc' })).toBe('STALE')
  })

  it('reports MISMATCH when the body, secret, prefix or timestamp differ', () => {
    expect(verify({ rawBody: `${BODY} ` })).toBe('MISMATCH')
    expect(verify({ rawBody: JSON.stringify(JSON.parse(BODY), null, 1) })).toBe('MISMATCH')
    expect(verify({ secret: 'other' })).toBe('MISMATCH')
    expect(verify({ signatureHeader: sign(BODY, NOW).slice('sha256='.length) })).toBe('MISMATCH')
    expect(verify({ signatureHeader: sign(BODY, NOW - 1) })).toBe('MISMATCH')
    expect(verify({ signatureHeader: 'sha256=00' })).toBe('MISMATCH')
  })

  it('never accepts an empty secret', () => {
    expect(verify({ secret: '', signatureHeader: sign(BODY, NOW, '') })).toBe('MISMATCH')
  })
})

describe('verifySepayApiKey', () => {
  it('accepts "Apikey <key>"', () => {
    expect(verifySepayApiKey({ authorizationHeader: 'Apikey k-123', apiKey: 'k-123' })).toBe('OK')
  })

  it('reports MISSING without a header', () => {
    expect(verifySepayApiKey({ authorizationHeader: undefined, apiKey: 'k-123' })).toBe('MISSING')
    expect(verifySepayApiKey({ authorizationHeader: '', apiKey: 'k-123' })).toBe('MISSING')
  })

  it('reports MISMATCH for another scheme, key, or an empty configured key', () => {
    expect(verifySepayApiKey({ authorizationHeader: 'Bearer k-123', apiKey: 'k-123' })).toBe('MISMATCH')
    expect(verifySepayApiKey({ authorizationHeader: 'Apikey k-124', apiKey: 'k-123' })).toBe('MISMATCH')
    expect(verifySepayApiKey({ authorizationHeader: 'Apikey k-1234', apiKey: 'k-123' })).toBe('MISMATCH')
    expect(verifySepayApiKey({ authorizationHeader: 'Apikey ', apiKey: '' })).toBe('MISMATCH')
  })
})
```

- [ ] **Step 2: Chạy, thấy FAIL**

Run: `npm run test:unit -- tests/unit/server/sepay-signature.test.ts`
Expected: FAIL (`Failed to resolve import ".../sepay-signature"`).

- [ ] **Step 3: Cài đặt `sepay-signature.ts`**

```ts
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export type SignatureResult = 'OK' | 'MISSING' | 'STALE' | 'MISMATCH'
export type ApiKeyResult = 'OK' | 'MISSING' | 'MISMATCH'

export const SIGNATURE_TOLERANCE_SEC = 300
const API_KEY_PREFIX = 'Apikey '

// Hashing both sides first gives timingSafeEqual equal-length inputs, so length is not leaked either.
function constantTimeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest()
  const right = createHash('sha256').update(b).digest()
  return timingSafeEqual(left, right)
}

export function verifySepaySignature(input: {
  rawBody: string
  timestamp: string | undefined
  signatureHeader: string | undefined
  secret: string
  nowSec: number
}): SignatureResult {
  const { rawBody, timestamp, signatureHeader, secret, nowSec } = input
  if (!timestamp || !signatureHeader) return 'MISSING'
  if (!/^\d{1,12}$/.test(timestamp)) return 'STALE'
  if (Math.abs(nowSec - Number(timestamp)) > SIGNATURE_TOLERANCE_SEC) return 'STALE'
  if (!secret) return 'MISMATCH'
  const expected = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`
  return constantTimeEqual(expected, signatureHeader.trim().toLowerCase()) ? 'OK' : 'MISMATCH'
}

export function verifySepayApiKey(input: { authorizationHeader: string | undefined, apiKey: string }): ApiKeyResult {
  const { authorizationHeader, apiKey } = input
  if (!authorizationHeader) return 'MISSING'
  if (!apiKey || !authorizationHeader.startsWith(API_KEY_PREFIX)) return 'MISMATCH'
  return constantTimeEqual(authorizationHeader.slice(API_KEY_PREFIX.length), apiKey) ? 'OK' : 'MISMATCH'
}
```

- [ ] **Step 4: Chạy, thấy PASS**

Run: `npm run test:unit -- tests/unit/server/sepay-signature.test.ts`
Expected: PASS.

- [ ] **Step 5: Viết test thất bại cho payload và trích mã**

`tests/unit/server/sepay-payload.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { generatePaymentCode } from '../../../server/services/payments/payment-code'
import {
  extractPaymentCode, parseSepayTransactionDate, sepayWebhookPayloadSchema, toBankTransactionInput,
} from '../../../server/services/payments/sepay-payload'

const DOC_SAMPLE = {
  id: 92704,
  gateway: 'Vietcombank',
  transactionDate: '2024-07-02 11:08:33',
  accountNumber: '1017588888',
  subAccount: '',
  code: 'SEVN63DC8E5C',
  content: 'SEVN63DC8E5C chuyen tien',
  transferType: 'in',
  description: 'NGUYEN VAN A chuyen tien',
  transferAmount: 5000000,
  accumulated: 105000000,
  referenceCode: 'FT24012345678',
}

describe('sepayWebhookPayloadSchema', () => {
  it('accepts the documented sample and stringifies the id', () => {
    const parsed = sepayWebhookPayloadSchema.parse(DOC_SAMPLE)
    expect(parsed.id).toBe('92704')
    expect(parsed.transferAmount).toBe(5_000_000)
  })

  it('accepts the test-ping id 0', () => {
    expect(sepayWebhookPayloadSchema.parse({ ...DOC_SAMPLE, id: 0 }).id).toBe('0')
  })

  it('accepts code null, empty subAccount/referenceCode/description and unknown extra fields', () => {
    const parsed = sepayWebhookPayloadSchema.parse({ ...DOC_SAMPLE, code: null, subAccount: null, referenceCode: '', description: '', extra: 1 })
    expect(parsed.code).toBeNull()
    expect(parsed).toHaveProperty('extra', 1)
  })

  it.each([
    ['zero amount', { transferAmount: 0 }],
    ['negative amount', { transferAmount: -1 }],
    ['fractional amount', { transferAmount: 1000.5 }],
    ['string amount', { transferAmount: '5000' }],
    ['unknown transferType', { transferType: 'x' }],
    ['negative id', { id: -1 }],
    ['missing id', { id: undefined }],
    ['non-numeric id', { id: 'abc' }],
    ['empty account', { accountNumber: '' }],
    ['malformed date', { transactionDate: '02/07/2024' }],
    ['impossible date', { transactionDate: '2024-13-45 99:99:99' }],
  ])('rejects %s', (_name, patch) => {
    expect(sepayWebhookPayloadSchema.safeParse({ ...DOC_SAMPLE, ...patch }).success).toBe(false)
  })
})

describe('parseSepayTransactionDate', () => {
  it('reads the timestamp as Vietnam time (UTC+7)', () => {
    expect(parseSepayTransactionDate('2024-07-02 11:08:33').toISOString()).toBe('2024-07-02T04:08:33.000Z')
  })
})

describe('extractPaymentCode', () => {
  it('prefers the code field and uppercases it', () => {
    expect(extractPaymentCode('zo1a2b3c4d', 'whatever')).toBe('ZO1A2B3C4D')
  })

  it('falls back to the transfer content when SePay sent code null', () => {
    expect(extractPaymentCode(null, 'NGUYEN VAN A chuyen tien zo1a2b3c4d cam on')).toBe('ZO1A2B3C4D')
  })

  it('keeps the first 10 characters when SePay captured a longer suffix', () => {
    expect(extractPaymentCode('ZO1A2B3C4DEF', null)).toBe('ZO1A2B3C4D')
  })

  it('returns null when nothing looks like a ZO code (no guessing by amount or substring)', () => {
    expect(extractPaymentCode(null, 'chuyen tien an trua')).toBeNull()
    expect(extractPaymentCode('SEVN63DC8E5C', 'SEVN63DC8E5C chuyen tien')).toBeNull()
    expect(extractPaymentCode('', '')).toBeNull()
    expect(extractPaymentCode(undefined, undefined)).toBeNull()
    expect(extractPaymentCode(null, 'ZO12345')).toBeNull()
  })

  it('recognises every code PR5 can generate', () => {
    for (let i = 0; i < 200; i++) {
      const code = generatePaymentCode()
      expect(extractPaymentCode(null, `thanh toan ${code.toLowerCase()}`)).toBe(code)
    }
  })
})

describe('toBankTransactionInput', () => {
  const integration = { id: 'int-1', orgId: 'org-1' }

  it('maps an incoming transfer', () => {
    const input = toBankTransactionInput(integration, sepayWebhookPayloadSchema.parse({ ...DOC_SAMPLE, code: null, content: 'ZO1A2B3C4D' }))
    expect(input).toMatchObject({
      orgId: 'org-1',
      integrationId: 'int-1',
      providerTransactionId: '92704',
      source: 'WEBHOOK',
      direction: 'IN',
      bankAccountNumber: '1017588888',
      subAccount: null,
      amountVnd: 5_000_000,
      paymentCode: 'ZO1A2B3C4D',
      referenceCode: 'FT24012345678',
    })
    expect(input.transactionDate.toISOString()).toBe('2024-07-02T04:08:33.000Z')
  })

  it('maps outgoing transfers to OUT and empty strings to null', () => {
    const input = toBankTransactionInput(integration, sepayWebhookPayloadSchema.parse({ ...DOC_SAMPLE, transferType: 'out', referenceCode: '', subAccount: '' }))
    expect(input.direction).toBe('OUT')
    expect(input.referenceCode).toBeNull()
    expect(input.subAccount).toBeNull()
  })
})
```

- [ ] **Step 6: Chạy, thấy FAIL**

Run: `npm run test:unit -- tests/unit/server/sepay-payload.test.ts`
Expected: FAIL (`Failed to resolve import ".../sepay-payload"`).

- [ ] **Step 7: Cài đặt `sepay-payload.ts`**

```ts
import { z } from 'zod'
import type { BankTransactionInput } from './types'

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

// SePay documents transactionDate as Vietnam local time without an offset.
export function parseSepayTransactionDate(value: string): Date {
  return new Date(`${value.replace(' ', 'T')}+07:00`)
}

const nullableText = z.string().nullish().transform(value => value ?? null)

export const sepayWebhookPayloadSchema = z.looseObject({
  // SePay's "Gửi thử" ping carries id 0; real transaction ids are positive.
  id: z.union([z.number().int().nonnegative(), z.string().regex(/^\d{1,18}$/)]).transform(value => String(value)),
  gateway: nullableText,
  transactionDate: z.string().regex(DATE_SHAPE).refine(value => !Number.isNaN(parseSepayTransactionDate(value).getTime())),
  accountNumber: z.string().trim().min(1).max(64),
  subAccount: nullableText,
  code: nullableText,
  content: z.string().nullish().transform(value => value ?? ''),
  transferType: z.enum(['in', 'out']),
  description: nullableText,
  transferAmount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  accumulated: z.number().nullish(),
  referenceCode: nullableText,
})

export type SepayWebhookPayload = z.output<typeof sepayWebhookPayloadSchema>

// Same alphabet/length PR5's generatePaymentCode() emits: "ZO" + 8 of [A-Z0-9].
const PAYMENT_CODE = /ZO[A-Z0-9]{8}/

export function extractPaymentCode(code: string | null | undefined, content: string | null | undefined): string | null {
  for (const source of [code, content]) {
    if (!source) continue
    const match = PAYMENT_CODE.exec(source.toUpperCase())
    if (match) return match[0]
  }
  return null
}

const emptyToNull = (value: string | null | undefined): string | null => (value ? value : null)

export function toBankTransactionInput(
  integration: { id: string, orgId: string },
  payload: SepayWebhookPayload,
): BankTransactionInput {
  return {
    orgId: integration.orgId,
    integrationId: integration.id,
    providerTransactionId: payload.id,
    source: 'WEBHOOK',
    direction: payload.transferType === 'in' ? 'IN' : 'OUT',
    bankAccountNumber: payload.accountNumber,
    subAccount: emptyToNull(payload.subAccount),
    amountVnd: payload.transferAmount,
    paymentCode: extractPaymentCode(payload.code, payload.content),
    content: emptyToNull(payload.content),
    referenceCode: emptyToNull(payload.referenceCode),
    transactionDate: parseSepayTransactionDate(payload.transactionDate),
    rawPayload: payload,
  }
}
```

- [ ] **Step 8: Chạy, thấy PASS**

Run: `npm run test:unit -- tests/unit/server/sepay-signature.test.ts tests/unit/server/sepay-payload.test.ts`
Expected: PASS cả hai file.

- [ ] **Step 9: Commit**

```bash
git add server/services/payments/sepay-signature.ts server/services/payments/sepay-payload.ts tests/unit/server/sepay-signature.test.ts tests/unit/server/sepay-payload.test.ts
git commit -m "feat(payment-webhook): add SePay signature, API key and payload parsing

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Ghi `bank_transactions` idempotent + dedupe chéo webhook/API

**Files:**
- Create: `server/services/payments/record-bank-transaction.ts`
- Test: `tests/integration/record-bank-transaction.test.ts`

**Interfaces:**
- Consumes: `bankTransactions`, `bankTransactionEvents` (Task 1); `BankTransactionInput`, `RecordResult` (Task 1 `types.ts`); `Db` (PR0); fixtures Task 1.
- Produces: `recordBankTransaction(db: Db, input: BankTransactionInput): Promise<RecordResult>`. Bảo đảm: cùng `(integration, provider id hoặc alias)` → không tạo hàng mới; một giao dịch ngân hàng thật được webhook và API đối soát cùng báo (id integer vs UUID) chỉ có **một** hàng, id còn lại nằm trong `provider_alt_ids`; hai giao dịch thật cùng nguồn **không bao giờ** bị gộp (không mất tiền).

- [ ] **Step 1: Viết test thất bại**

`tests/integration/record-bank-transaction.test.ts`:

```ts
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { bankTransactionEvents, bankTransactions } from '../../server/db/schema'
import { recordBankTransaction } from '../../server/services/payments/record-bank-transaction'
import { createTenant } from '../support/fixtures'
import { bankTxInput, createPaymentSetup, type PaymentSetup } from '../support/webhook-fixtures'
import { resetDb } from '../support/db'

const db = () => getDb()
const rows = (setup: PaymentSetup) => db().select().from(bankTransactions).where(eq(bankTransactions.integrationId, setup.integration.id))

let setup: PaymentSetup

beforeEach(async () => {
  await resetDb()
  setup = await createPaymentSetup(await createTenant('a'))
})
afterAll(async () => {
  await closeDb()
})

describe('recordBankTransaction', () => {
  it('creates a RECEIVED row and an audit event', async () => {
    const result = await recordBankTransaction(db(), bankTxInput(setup, { providerTransactionId: '1', paymentCode: 'ZOABCDEFGH' }))
    expect(result).toMatchObject({ created: true, status: 'RECEIVED' })
    const [row] = await rows(setup)
    expect(row).toMatchObject({ providerTransactionId: '1', paymentCode: 'ZOABCDEFGH', source: 'WEBHOOK', orgId: setup.orgId })
    const events = await db().select().from(bankTransactionEvents).where(eq(bankTransactionEvents.bankTransactionId, row!.id))
    expect(events.map(e => e.action)).toEqual(['RECEIVED'])
  })

  it('stores outgoing transfers as IGNORED', async () => {
    const result = await recordBankTransaction(db(), bankTxInput(setup, { direction: 'OUT' }))
    expect(result.status).toBe('IGNORED')
  })

  it('replay of the same provider id returns the existing row', async () => {
    const input = bankTxInput(setup, { providerTransactionId: '42' })
    const first = await recordBankTransaction(db(), input)
    const again = await recordBankTransaction(db(), input)
    expect(again).toEqual({ id: first.id, created: false, status: 'RECEIVED' })
    expect(await rows(setup)).toHaveLength(1)
  })

  it('five concurrent deliveries of one transaction create exactly one row', async () => {
    const input = bankTxInput(setup, { providerTransactionId: '9001' })
    const results = await Promise.all(Array.from({ length: 5 }, () => recordBankTransaction(db(), input)))
    expect(results.filter(r => r.created)).toHaveLength(1)
    expect(new Set(results.map(r => r.id)).size).toBe(1)
    expect(await rows(setup)).toHaveLength(1)
  })

  it('merges a reconcile (UUID) report into the webhook row and remembers the alias', async () => {
    const webhook = bankTxInput(setup, { providerTransactionId: '123', referenceCode: 'FT111', amountVnd: 70_000 })
    const first = await recordBankTransaction(db(), webhook)
    const reconcile = { ...webhook, source: 'RECONCILE' as const, providerTransactionId: 'uuid-aaaa' }
    const second = await recordBankTransaction(db(), reconcile)
    expect(second).toMatchObject({ id: first.id, created: false })
    const [row] = await rows(setup)
    expect(row!.providerAltIds).toEqual(['uuid-aaaa'])
    expect(await recordBankTransaction(db(), reconcile)).toMatchObject({ id: first.id, created: false })
    expect(await rows(setup)).toHaveLength(1)
  })

  it('merges in the other direction too (reconcile first, webhook later)', async () => {
    const reconcile = bankTxInput(setup, { source: 'RECONCILE', providerTransactionId: 'uuid-bbbb', referenceCode: 'FT222' })
    const first = await recordBankTransaction(db(), reconcile)
    const webhook = { ...reconcile, source: 'WEBHOOK' as const, providerTransactionId: '555' }
    expect(await recordBankTransaction(db(), webhook)).toMatchObject({ id: first.id, created: false })
    const [row] = await rows(setup)
    expect(row!.providerAltIds).toEqual(['555'])
    expect(await recordBankTransaction(db(), webhook)).toMatchObject({ id: first.id, created: false })
  })

  it('never merges two webhook transactions that merely look alike (money must not vanish)', async () => {
    const base = bankTxInput(setup, { referenceCode: 'FT333', amountVnd: 50_000 })
    const one = await recordBankTransaction(db(), { ...base, providerTransactionId: '1' })
    const two = await recordBankTransaction(db(), { ...base, providerTransactionId: '2' })
    expect(one.id).not.toBe(two.id)
    expect(await rows(setup)).toHaveLength(2)
  })

  it('pairs look-alike webhook and reconcile transactions one-to-one', async () => {
    const base = bankTxInput(setup, { referenceCode: 'FT444', amountVnd: 50_000 })
    const w1 = await recordBankTransaction(db(), { ...base, providerTransactionId: '1' })
    const w2 = await recordBankTransaction(db(), { ...base, providerTransactionId: '2' })
    const r1 = await recordBankTransaction(db(), { ...base, source: 'RECONCILE', providerTransactionId: 'uuid-1' })
    const r2 = await recordBankTransaction(db(), { ...base, source: 'RECONCILE', providerTransactionId: 'uuid-2' })
    expect(r1.created || r2.created).toBe(false)
    expect(new Set([r1.id, r2.id])).toEqual(new Set([w1.id, w2.id]))
    expect(await rows(setup)).toHaveLength(2)
  })

  it('creates a separate row when a reconcile report differs in amount or account', async () => {
    const base = bankTxInput(setup, { providerTransactionId: '1', referenceCode: 'FT555', amountVnd: 50_000 })
    await recordBankTransaction(db(), base)
    const differentAmount = await recordBankTransaction(db(), { ...base, source: 'RECONCILE', providerTransactionId: 'u1', amountVnd: 60_000 })
    const differentAccount = await recordBankTransaction(db(), { ...base, source: 'RECONCILE', providerTransactionId: 'u2', bankAccountNumber: '999' })
    expect(differentAmount.created).toBe(true)
    expect(differentAccount.created).toBe(true)
  })

  it('without a reference code, twins must share the exact transaction instant', async () => {
    const at = new Date('2026-11-01T03:15:00.000Z')
    const base = bankTxInput(setup, { providerTransactionId: '1', referenceCode: null, transactionDate: at })
    const first = await recordBankTransaction(db(), base)
    const same = await recordBankTransaction(db(), { ...base, source: 'RECONCILE', providerTransactionId: 'u1' })
    const later = await recordBankTransaction(db(), { ...base, source: 'RECONCILE', providerTransactionId: 'u2', transactionDate: new Date(at.getTime() + 60_000) })
    expect(same).toMatchObject({ id: first.id, created: false })
    expect(later.created).toBe(true)
  })

  it('a webhook and a reconcile report racing for the same transaction yield one row', async () => {
    const webhook = bankTxInput(setup, { providerTransactionId: '31337', referenceCode: 'FT666' })
    const reconcile = { ...webhook, source: 'RECONCILE' as const, providerTransactionId: 'uuid-race' }
    const results = await Promise.all([
      recordBankTransaction(db(), webhook),
      recordBankTransaction(db(), reconcile),
      recordBankTransaction(db(), webhook),
      recordBankTransaction(db(), reconcile),
    ])
    expect(results.filter(r => r.created)).toHaveLength(1)
    expect(await rows(setup)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Chạy, thấy FAIL**

Run: `npm run test:integration -- tests/integration/record-bank-transaction.test.ts`
Expected: FAIL (`Failed to resolve import ".../record-bank-transaction"`).

- [ ] **Step 3: Cài đặt `record-bank-transaction.ts`**

```ts
import { and, asc, eq, isNull, ne, or, sql } from 'drizzle-orm'
import type { Db, Tx } from '../../db/client'
import { bankTransactionEvents, bankTransactions } from '../../db/schema'
import type { BankTransactionInput, RecordResult } from './types'

// Webhook and reconcile report the same bank transaction under different ids, so the lock key is derived
// from the transaction's own facts. Both paths therefore serialise per transaction.
function lockKey(input: BankTransactionInput): string {
  const tail = input.referenceCode ?? input.transactionDate.toISOString()
  return `${input.integrationId}|${input.bankAccountNumber}|${input.amountVnd}|${tail}`
}

async function findSameProviderId(tx: Tx, input: BankTransactionInput) {
  const [row] = await tx
    .select({ id: bankTransactions.id, status: bankTransactions.reconciliationStatus })
    .from(bankTransactions)
    .where(and(
      eq(bankTransactions.integrationId, input.integrationId),
      or(
        eq(bankTransactions.providerTransactionId, input.providerTransactionId),
        sql`${bankTransactions.providerAltIds} @> ARRAY[${input.providerTransactionId}]::text[]`,
      ),
    ))
    .limit(1)
  return row ?? null
}

// A twin is the same bank transaction reported by the other source. Same-source rows are never fuzzy-merged:
// their provider id is authoritative, and merging two real transfers would lose money.
async function findCrossSourceTwin(tx: Tx, input: BankTransactionInput) {
  const [row] = await tx
    .select({ id: bankTransactions.id, status: bankTransactions.reconciliationStatus })
    .from(bankTransactions)
    .where(and(
      eq(bankTransactions.integrationId, input.integrationId),
      eq(bankTransactions.bankAccountNumber, input.bankAccountNumber),
      eq(bankTransactions.amountVnd, input.amountVnd),
      eq(bankTransactions.direction, input.direction),
      ne(bankTransactions.source, input.source),
      sql`cardinality(${bankTransactions.providerAltIds}) = 0`,
      input.referenceCode
        ? eq(bankTransactions.referenceCode, input.referenceCode)
        : and(isNull(bankTransactions.referenceCode), eq(bankTransactions.transactionDate, input.transactionDate)),
    ))
    .orderBy(asc(bankTransactions.receivedAt), asc(bankTransactions.id))
    .limit(1)
  return row ?? null
}

export async function recordBankTransaction(db: Db, input: BankTransactionInput): Promise<RecordResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey(input)}, 0))`)

    const same = await findSameProviderId(tx, input)
    if (same) return { id: same.id, created: false, status: same.status }

    const twin = await findCrossSourceTwin(tx, input)
    if (twin) {
      await tx.update(bankTransactions)
        .set({ providerAltIds: sql`array_append(${bankTransactions.providerAltIds}, ${input.providerTransactionId})` })
        .where(eq(bankTransactions.id, twin.id))
      await tx.insert(bankTransactionEvents).values({
        orgId: input.orgId,
        bankTransactionId: twin.id,
        action: 'ALIAS_ADDED',
        metadata: { source: input.source },
      })
      return { id: twin.id, created: false, status: twin.status }
    }

    const status = input.direction === 'OUT' ? 'IGNORED' : 'RECEIVED'
    const [row] = await tx.insert(bankTransactions).values({
      orgId: input.orgId,
      integrationId: input.integrationId,
      providerTransactionId: input.providerTransactionId,
      source: input.source,
      direction: input.direction,
      bankAccountNumber: input.bankAccountNumber,
      subAccount: input.subAccount,
      amountVnd: input.amountVnd,
      paymentCode: input.paymentCode,
      content: input.content,
      referenceCode: input.referenceCode,
      transactionDate: input.transactionDate,
      rawPayloadJson: input.rawPayload,
      reconciliationStatus: status,
    })
      .onConflictDoNothing({ target: [bankTransactions.integrationId, bankTransactions.providerTransactionId] })
      .returning({ id: bankTransactions.id, status: bankTransactions.reconciliationStatus })

    if (!row) {
      const existing = await findSameProviderId(tx, input)
      return { id: existing!.id, created: false, status: existing!.status }
    }
    await tx.insert(bankTransactionEvents).values({
      orgId: input.orgId,
      bankTransactionId: row.id,
      action: status === 'IGNORED' ? 'IGNORED' : 'RECEIVED',
      toStatus: status,
      metadata: { source: input.source },
    })
    return { id: row.id, created: true, status: row.status }
  })
}
```

- [ ] **Step 4: Chạy, thấy PASS**

Run: `npm run test:integration -- tests/integration/record-bank-transaction.test.ts`
Expected: PASS 11 test. Nếu Gate G3 (Task 0) cho thấy `reference_number` ≠ `referenceCode`, đổi `findCrossSourceTwin` để so `transactionDate` đến phút thay vì `referenceCode`, và cập nhật hai test "reference" tương ứng; ghi lý do vào PR.

- [ ] **Step 5: Commit**

```bash
git add server/services/payments/record-bank-transaction.ts tests/integration/record-bank-transaction.test.ts
git commit -m "feat(payment-webhook): record bank transactions idempotently with cross-source dedupe

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: `matchTransaction` — xác nhận đúng một lần, mọi bất thường vào review

**Files:**
- Create: `server/services/payments/lock-order-graph.ts`, `server/services/payments/confirm-payment.ts`, `server/services/payments/match-transaction.ts`
- Test: `tests/integration/match-transaction.test.ts`

**Interfaces:**
- Consumes: `bankTransactions`, `bankTransactionEvents` (Task 1); `orders`, `orderEvents`, `orderPayments`, `paymentAttempts`, `storePaymentAccounts`, `integrationAccounts`; `recordBankTransaction` (Task 3); `MatchOutcome` (Task 1); `AppError`; fixtures.
- Produces:
  - `lockOrderGraph(tx: Tx, scope: { orgId: string, storeId: string, orderId: string }): Promise<{ attempts: PaymentAttemptRow[], order: OrderRow | null }>` — khoá mọi attempt của đơn (theo `id`) rồi mới khoá đơn. **Mọi** đường code ghi nhận tiền phải đi qua hàm này (thứ tự khoá chuẩn: `bank_transactions → payment_attempts → orders`).
  - `confirmOrderPayment(tx: Tx, args: ConfirmArgs): Promise<void>` với `ConfirmArgs = { order: { id, orgId, storeId }, method: 'SEPAY' | 'BANK_MANUAL', amountVnd: number, bankTransactionId: string | null, paymentCodeAttemptId: string | null, actorUserId: string | null, late: boolean, eventType: 'PAYMENT_CONFIRMED' | 'PAYMENT_ASSIGNED' | 'PAYMENT_MANUAL_BANK', note: string | null, metadata: Record<string, unknown> }`; ném `Error` (rollback) nếu đơn không còn `AWAITING_PAYMENT` + `PENDING|REVIEW_REQUIRED`.
  - `matchTransaction(db: Db, bankTransactionId: string): Promise<MatchOutcome>` — idempotent: giao dịch không còn `RECEIVED` trả `{ kind: 'SKIPPED', status }`.
  - Bảng quyết định (kiểm tra theo thứ tự này): `direction OUT` → IGNORED · không có mã → `NO_CODE` · mã không thuộc attempt của **cùng org** → `UNKNOWN_CODE` · mã `PAYMENT_TEST_CODE` (giao dịch thử của PR5) → tự `RESOLVED/NOT_ORDER`, không vào review · tài khoản nhận không khớp bản chụp trên attempt (`accountNumber` hoặc `vaNumber`) hoặc tài khoản không còn liên kết integration → `ACCOUNT_MISMATCH` (+ đơn `REVIEW_REQUIRED`) · đơn `CANCELLED` → `ORDER_CANCELLED` (+ đơn `REFUND_DUE`) · đơn đã `PAID` → `ORDER_ALREADY_PAID` · đơn không `AWAITING_PAYMENT`/payment không `PENDING|REVIEW_REQUIRED` → `ORDER_NOT_PAYABLE` · tiền ≠ `expected_amount_vnd` → `AMOUNT_UNDER`/`AMOUNT_OVER` (+ đơn `REVIEW_REQUIRED`) · còn lại → xác nhận (`late = attempt.status ≠ PENDING`).

- [ ] **Step 1: Viết test thất bại (bảng quyết định + đồng thời)**

`tests/integration/match-transaction.test.ts`:

```ts
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { bankTransactions, integrationAccounts, orderEvents, orderPayments, orders, paymentAttempts, storePaymentAccounts } from '../../server/db/schema'
import { matchTransaction } from '../../server/services/payments/match-transaction'
import { PAYMENT_TEST_CODE } from '../../server/services/payments/payment-code'
import { recordBankTransaction } from '../../server/services/payments/record-bank-transaction'
import { createTenant } from '../support/fixtures'
import { bankTxInput, createAttempt, createAwaitingOrder, createPaymentSetup, type PaymentSetup } from '../support/webhook-fixtures'
import { resetDb } from '../support/db'

const db = () => getDb()

let setup: PaymentSetup

async function receive(overrides: Parameters<typeof bankTxInput>[1] = {}) {
  const result = await recordBankTransaction(db(), bankTxInput(setup, overrides))
  return result.id
}

async function state(orderId: string, txId?: string) {
  const [order] = await db().select().from(orders).where(eq(orders.id, orderId))
  const payments = await db().select().from(orderPayments).where(eq(orderPayments.orderId, orderId))
  const attempts = await db().select().from(paymentAttempts).where(eq(paymentAttempts.orderId, orderId))
  const [tx] = txId ? await db().select().from(bankTransactions).where(eq(bankTransactions.id, txId)) : []
  return { order: order!, payments, attempts, tx }
}

beforeEach(async () => {
  await resetDb()
  setup = await createPaymentSetup(await createTenant('a'))
})
afterAll(async () => {
  await closeDb()
})

describe('matchTransaction — happy path', () => {
  it('confirms an exact transfer once: order NEW/PAID, one SEPAY payment, attempt PAID', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { amountVnd: 55_000 })
    const txId = await receive({ paymentCode: attempt.paymentCode, amountVnd: 55_000 })

    expect(await matchTransaction(db(), txId)).toEqual({ kind: 'MATCHED', orderId: order.id, late: false })

    const s = await state(order.id, txId)
    expect(s.order).toMatchObject({ status: 'NEW', paymentStatus: 'PAID', latePayment: false })
    expect(s.payments).toHaveLength(1)
    expect(s.payments[0]).toMatchObject({ method: 'SEPAY', amountVnd: 55_000, bankTransactionId: txId, recordedBy: null })
    expect(s.attempts[0]!.status).toBe('PAID')
    expect(s.tx).toMatchObject({ reconciliationStatus: 'MATCHED', matchedOrderId: order.id, reviewReason: null })
    const events = await db().select().from(orderEvents).where(eq(orderEvents.orderId, order.id))
    expect(events.map(e => e.eventType)).toContain('PAYMENT_CONFIRMED')
  })

  it('supersedes the sibling PENDING attempt of a re-pay flow', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { attemptStatus: 'EXPIRED' })
    await createAttempt(setup, order.id, { paymentCode: 'ZOSIBLING01', status: 'PENDING' })
    const txId = await receive({ paymentCode: attempt.paymentCode })
    expect(await matchTransaction(db(), txId)).toMatchObject({ kind: 'MATCHED', late: true })
    const s = await state(order.id)
    expect(s.attempts.find(a => a.paymentCode === 'ZOSIBLING01')!.status).toBe('SUPERSEDED')
  })

  it('accepts the VA number in either accountNumber or subAccount (gate G5 leaves it open)', async () => {
    const va = await createPaymentSetup(await createTenant('v'), { vaNumber: 'VA00112233' })
    const one = await createAwaitingOrder(va)
    const two = await createAwaitingOrder(va)
    const asSub = await recordBankTransaction(db(), bankTxInput(va, { paymentCode: one.attempt.paymentCode, bankAccountNumber: 'MAIN-ACCOUNT', subAccount: 'VA00112233' }))
    const asMain = await recordBankTransaction(db(), bankTxInput(va, { paymentCode: two.attempt.paymentCode, bankAccountNumber: 'VA00112233' }))
    expect(await matchTransaction(db(), asSub.id)).toMatchObject({ kind: 'MATCHED', orderId: one.order.id })
    expect(await matchTransaction(db(), asMain.id)).toMatchObject({ kind: 'MATCHED', orderId: two.order.id })
  })

  it('matches against the account snapshotted on the attempt, not the store account as edited later', async () => {
    const first = await createAwaitingOrder(setup)
    const second = await createAwaitingOrder(setup)
    const oldNumber = setup.account.accountNumber
    await db().update(storePaymentAccounts).set({ accountNumber: '5555555555' }).where(eq(storePaymentAccounts.id, setup.account.id))
    const toOld = await receive({ paymentCode: first.attempt.paymentCode, bankAccountNumber: oldNumber })
    const toNew = await receive({ paymentCode: second.attempt.paymentCode, bankAccountNumber: '5555555555' })
    expect(await matchTransaction(db(), toOld)).toMatchObject({ kind: 'MATCHED', orderId: first.order.id })
    expect(await matchTransaction(db(), toNew)).toEqual({ kind: 'REVIEW', reason: 'ACCOUNT_MISMATCH', orderId: second.order.id })
  })

  it('an account that is no longer linked to the integration is ACCOUNT_MISMATCH', async () => {
    const { order, attempt } = await createAwaitingOrder(setup)
    await db().delete(integrationAccounts).where(eq(integrationAccounts.paymentAccountId, setup.account.id))
    const txId = await receive({ paymentCode: attempt.paymentCode })
    expect(await matchTransaction(db(), txId)).toEqual({ kind: 'REVIEW', reason: 'ACCOUNT_MISMATCH', orderId: order.id })
  })

  it('the owner\'s own QR-check transfer (PAYMENT_TEST_CODE) resolves itself and never pollutes the review queue', async () => {
    const txId = await receive({ paymentCode: PAYMENT_TEST_CODE, amountVnd: 2_000 })
    expect(await matchTransaction(db(), txId)).toEqual({ kind: 'IGNORED' })
    const [row] = await db().select().from(bankTransactions).where(eq(bankTransactions.id, txId))
    expect(row).toMatchObject({ reconciliationStatus: 'RESOLVED', resolution: 'NOT_ORDER' })
  })

  it('is idempotent: matching again is SKIPPED and changes nothing', async () => {
    const { order, attempt } = await createAwaitingOrder(setup)
    const txId = await receive({ paymentCode: attempt.paymentCode })
    await matchTransaction(db(), txId)
    expect(await matchTransaction(db(), txId)).toEqual({ kind: 'SKIPPED', status: 'MATCHED' })
    expect((await state(order.id)).payments).toHaveLength(1)
  })
})

describe('matchTransaction — late, cancelled, duplicate', () => {
  it.each(['EXPIRED', 'SUPERSEDED'] as const)('confirms money that arrives after the attempt is %s and flags late_payment', async (attemptStatus) => {
    const { order, attempt } = await createAwaitingOrder(setup, { attemptStatus })
    const txId = await receive({ paymentCode: attempt.paymentCode })
    expect(await matchTransaction(db(), txId)).toEqual({ kind: 'MATCHED', orderId: order.id, late: true })
    expect((await state(order.id)).order).toMatchObject({ status: 'NEW', paymentStatus: 'PAID', latePayment: true })
  })

  it('sends money for a cancelled order to review and marks the order REFUND_DUE (no payment row)', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { orderStatus: 'CANCELLED', paymentStatus: 'UNPAID', attemptStatus: 'EXPIRED' })
    const txId = await receive({ paymentCode: attempt.paymentCode })
    expect(await matchTransaction(db(), txId)).toEqual({ kind: 'REVIEW', reason: 'ORDER_CANCELLED', orderId: order.id })
    const s = await state(order.id, txId)
    expect(s.order).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUND_DUE' })
    expect(s.payments).toHaveLength(0)
    expect(s.tx).toMatchObject({ reconciliationStatus: 'REVIEW_REQUIRED', reviewReason: 'ORDER_CANCELLED', matchedOrderId: order.id })
  })

  it('sends a second transfer for an already PAID order to review; exactly one payment stays', async () => {
    const { order, attempt } = await createAwaitingOrder(setup)
    const first = await receive({ paymentCode: attempt.paymentCode })
    const second = await receive({ paymentCode: attempt.paymentCode })
    expect(await matchTransaction(db(), first)).toMatchObject({ kind: 'MATCHED' })
    expect(await matchTransaction(db(), second)).toEqual({ kind: 'REVIEW', reason: 'ORDER_ALREADY_PAID', orderId: order.id })
    const s = await state(order.id, second)
    expect(s.payments).toHaveLength(1)
    expect(s.order.paymentStatus).toBe('PAID')
    expect(s.tx).toMatchObject({ reconciliationStatus: 'REVIEW_REQUIRED', reviewReason: 'ORDER_ALREADY_PAID' })
  })
})

describe('matchTransaction — mismatches never auto-pay', () => {
  it.each([
    ['AMOUNT_UNDER', 54_999],
    ['AMOUNT_OVER', 55_001],
  ] as const)('%s → review, order keeps AWAITING_PAYMENT and becomes REVIEW_REQUIRED', async (reason, amountVnd) => {
    const { order, attempt } = await createAwaitingOrder(setup, { amountVnd: 55_000 })
    const txId = await receive({ paymentCode: attempt.paymentCode, amountVnd })
    expect(await matchTransaction(db(), txId)).toEqual({ kind: 'REVIEW', reason, orderId: order.id })
    const s = await state(order.id)
    expect(s.order).toMatchObject({ status: 'AWAITING_PAYMENT', paymentStatus: 'REVIEW_REQUIRED' })
    expect(s.payments).toHaveLength(0)
  })

  it('wrong receiving account → ACCOUNT_MISMATCH and the order is flagged', async () => {
    const { order, attempt } = await createAwaitingOrder(setup)
    const txId = await receive({ paymentCode: attempt.paymentCode, bankAccountNumber: '000111222' })
    expect(await matchTransaction(db(), txId)).toEqual({ kind: 'REVIEW', reason: 'ACCOUNT_MISMATCH', orderId: order.id })
    expect((await state(order.id)).order.paymentStatus).toBe('REVIEW_REQUIRED')
  })

  it('no code → NO_CODE; unknown code → UNKNOWN_CODE; neither touches an order', async () => {
    const { order } = await createAwaitingOrder(setup)
    const noCode = await receive({ paymentCode: null })
    const unknown = await receive({ paymentCode: 'ZOUNKNOWN1' })
    expect(await matchTransaction(db(), noCode)).toEqual({ kind: 'REVIEW', reason: 'NO_CODE', orderId: null })
    expect(await matchTransaction(db(), unknown)).toEqual({ kind: 'REVIEW', reason: 'UNKNOWN_CODE', orderId: null })
    expect((await state(order.id)).order).toMatchObject({ status: 'AWAITING_PAYMENT', paymentStatus: 'PENDING' })
  })

  it('a code that belongs to another organisation is UNKNOWN_CODE and never credits that org', async () => {
    const other = await createPaymentSetup(await createTenant('b'))
    const foreign = await createAwaitingOrder(other)
    const txId = await receive({ paymentCode: foreign.attempt.paymentCode })
    expect(await matchTransaction(db(), txId)).toEqual({ kind: 'REVIEW', reason: 'UNKNOWN_CODE', orderId: null })
    expect((await state(foreign.order.id)).order).toMatchObject({ status: 'AWAITING_PAYMENT', paymentStatus: 'PENDING' })
  })

  it('an order that is no longer waiting for payment → ORDER_NOT_PAYABLE', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { orderStatus: 'NEW', paymentStatus: 'UNPAID' })
    const txId = await receive({ paymentCode: attempt.paymentCode })
    expect(await matchTransaction(db(), txId)).toEqual({ kind: 'REVIEW', reason: 'ORDER_NOT_PAYABLE', orderId: order.id })
  })

  it('outgoing transfers are IGNORED at ingestion and SKIPPED by the matcher', async () => {
    const txId = await receive({ direction: 'OUT', paymentCode: 'ZOABCDEFGH' })
    expect(await matchTransaction(db(), txId)).toEqual({ kind: 'SKIPPED', status: 'IGNORED' })
  })
})

describe('matchTransaction — concurrency (Review Focus #1, #2)', () => {
  it('five concurrent matches of the same transaction produce exactly one payment', async () => {
    const { order, attempt } = await createAwaitingOrder(setup)
    const txId = await receive({ paymentCode: attempt.paymentCode })
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => matchTransaction(db(), txId)))
    expect(outcomes.filter(o => o.kind === 'MATCHED')).toHaveLength(1)
    expect(outcomes.filter(o => o.kind === 'SKIPPED')).toHaveLength(4)
    expect((await state(order.id)).payments).toHaveLength(1)
  })

  it('two different transactions for the same code: one confirms, the other goes to review', async () => {
    const { order, attempt } = await createAwaitingOrder(setup)
    const a = await receive({ paymentCode: attempt.paymentCode })
    const b = await receive({ paymentCode: attempt.paymentCode })
    const outcomes = await Promise.all([matchTransaction(db(), a), matchTransaction(db(), b)])
    expect(outcomes.filter(o => o.kind === 'MATCHED')).toHaveLength(1)
    expect(outcomes.filter(o => o.kind === 'REVIEW' && o.reason === 'ORDER_ALREADY_PAID')).toHaveLength(1)
    const s = await state(order.id)
    expect(s.payments).toHaveLength(1)
    const reviewed = await db().select().from(bankTransactions).where(and(eq(bankTransactions.orgId, setup.orgId), eq(bankTransactions.reconciliationStatus, 'REVIEW_REQUIRED')))
    expect(reviewed).toHaveLength(1)
  })

  it('a burst across several orders (each paid twice) never deadlocks and pays each order once', async () => {
    const orderIds: string[] = []
    const txIds: string[] = []
    for (let i = 0; i < 3; i++) {
      const { order, attempt } = await createAwaitingOrder(setup)
      orderIds.push(order.id)
      for (let j = 0; j < 3; j++) txIds.push(await receive({ paymentCode: attempt.paymentCode }))
    }
    const outcomes = await Promise.all(txIds.map(id => matchTransaction(db(), id)))
    expect(outcomes.filter(o => o.kind === 'MATCHED')).toHaveLength(3)
    expect(outcomes.filter(o => o.kind === 'REVIEW')).toHaveLength(6)
    for (const orderId of orderIds) expect((await state(orderId)).payments).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Chạy, thấy FAIL**

Run: `npm run test:integration -- tests/integration/match-transaction.test.ts`
Expected: FAIL (`Failed to resolve import ".../match-transaction"`).

- [ ] **Step 3: Cài đặt `lock-order-graph.ts`**

```ts
import { and, asc, eq } from 'drizzle-orm'
import type { Tx } from '../../db/client'
import { orders, paymentAttempts } from '../../db/schema'

export type PaymentAttemptRow = typeof paymentAttempts.$inferSelect
export type OrderRow = typeof orders.$inferSelect

// One canonical lock order (attempts by id, then the order) keeps webhook matching, owner assignment and
// manual confirmation from deadlocking when they touch the same order at once.
export async function lockOrderGraph(
  tx: Tx,
  scope: { orgId: string, storeId: string, orderId: string },
): Promise<{ attempts: PaymentAttemptRow[], order: OrderRow | null }> {
  const attempts = await tx.select().from(paymentAttempts)
    .where(and(
      eq(paymentAttempts.orgId, scope.orgId),
      eq(paymentAttempts.storeId, scope.storeId),
      eq(paymentAttempts.orderId, scope.orderId),
    ))
    .orderBy(asc(paymentAttempts.id))
    .for('update')
  const [order] = await tx.select().from(orders)
    .where(and(eq(orders.orgId, scope.orgId), eq(orders.storeId, scope.storeId), eq(orders.id, scope.orderId)))
    .for('update')
  return { attempts, order: order ?? null }
}
```

- [ ] **Step 4: Cài đặt `confirm-payment.ts`**

```ts
import { and, eq, inArray, ne } from 'drizzle-orm'
import type { Tx } from '../../db/client'
import { orderEvents, orderPayments, orders, paymentAttempts } from '../../db/schema'

export interface ConfirmArgs {
  order: { id: string, orgId: string, storeId: string }
  method: 'SEPAY' | 'BANK_MANUAL'
  amountVnd: number
  bankTransactionId: string | null
  paymentCodeAttemptId: string | null
  actorUserId: string | null
  late: boolean
  eventType: 'PAYMENT_CONFIRMED' | 'PAYMENT_ASSIGNED' | 'PAYMENT_MANUAL_BANK'
  note: string | null
  metadata: Record<string, unknown>
}

// The only place that turns an AWAITING_PAYMENT order into NEW/PAID. Callers must already hold lockOrderGraph().
export async function confirmOrderPayment(tx: Tx, args: ConfirmArgs): Promise<void> {
  const { order } = args
  const updated = await tx.update(orders)
    .set({ status: 'NEW', paymentStatus: 'PAID', latePayment: args.late })
    .where(and(
      eq(orders.id, order.id),
      eq(orders.orgId, order.orgId),
      eq(orders.storeId, order.storeId),
      eq(orders.status, 'AWAITING_PAYMENT'),
      inArray(orders.paymentStatus, ['PENDING', 'REVIEW_REQUIRED']),
    ))
    .returning({ id: orders.id })
  if (updated.length !== 1) throw new Error('Order is not payable at confirmation time')

  await tx.insert(orderPayments).values({
    orgId: order.orgId,
    storeId: order.storeId,
    orderId: order.id,
    bankTransactionId: args.bankTransactionId,
    method: args.method,
    amountVnd: args.amountVnd,
    recordedBy: args.actorUserId,
    note: args.note,
  })

  if (args.paymentCodeAttemptId) {
    await tx.update(paymentAttempts).set({ status: 'PAID' }).where(eq(paymentAttempts.id, args.paymentCodeAttemptId))
  }
  await tx.update(paymentAttempts).set({ status: 'SUPERSEDED' }).where(and(
    eq(paymentAttempts.orderId, order.id),
    eq(paymentAttempts.status, 'PENDING'),
    args.paymentCodeAttemptId ? ne(paymentAttempts.id, args.paymentCodeAttemptId) : undefined,
  ))

  await tx.insert(orderEvents).values({
    orgId: order.orgId,
    storeId: order.storeId,
    orderId: order.id,
    actorUserId: args.actorUserId,
    eventType: args.eventType,
    fromState: 'AWAITING_PAYMENT',
    toState: 'NEW',
    metadata: { ...args.metadata, method: args.method, amountVnd: args.amountVnd, late: args.late },
  })
}
```

- [ ] **Step 5: Cài đặt `match-transaction.ts`**

```ts
import { and, eq } from 'drizzle-orm'
import type { ReviewReason } from '#shared/payments'
import type { Db, Tx } from '../../db/client'
import {
  bankTransactionEvents, bankTransactions, integrationAccounts, orderEvents, orders, paymentAttempts,
} from '../../db/schema'
import { AppError } from '../../utils/errors'
import { confirmOrderPayment } from './confirm-payment'
import { lockOrderGraph, type OrderRow, type PaymentAttemptRow } from './lock-order-graph'
import { PAYMENT_TEST_CODE } from './payment-code'
import type { MatchOutcome } from './types'

type BankTxRow = typeof bankTransactions.$inferSelect

// Money must reach the account PR5 snapshotted on the attempt (so editing the store account later never
// misdirects an old QR), and that account must still be linked to the integration the webhook arrived on.
// `accountNumber` or `subAccount` may carry the VA number (gate G5), so either side may match either number.
async function accountMatches(tx: Tx, bt: BankTxRow, attempt: PaymentAttemptRow): Promise<boolean> {
  const [linked] = await tx.select({ paymentAccountId: integrationAccounts.paymentAccountId })
    .from(integrationAccounts)
    .where(and(eq(integrationAccounts.integrationId, bt.integrationId), eq(integrationAccounts.paymentAccountId, attempt.accountId)))
    .limit(1)
  if (!linked) return false
  const expected = [attempt.accountNumber, attempt.vaNumber].filter((value): value is string => !!value)
  const received = [bt.bankAccountNumber, bt.subAccount].filter((value): value is string => !!value)
  return received.some(number => expected.includes(number))
}

async function markTestTransfer(tx: Tx, bt: BankTxRow): Promise<MatchOutcome> {
  await tx.update(bankTransactions).set({
    reconciliationStatus: 'RESOLVED',
    resolution: 'NOT_ORDER',
    resolutionNote: 'Giao dịch thử khi kiểm tra tài khoản',
    resolvedAt: new Date(),
  }).where(eq(bankTransactions.id, bt.id))
  await tx.insert(bankTransactionEvents).values({
    orgId: bt.orgId,
    bankTransactionId: bt.id,
    action: 'RESOLVED',
    fromStatus: 'RECEIVED',
    toStatus: 'RESOLVED',
    metadata: { reason: 'TEST_TRANSFER' },
  })
  return { kind: 'IGNORED' }
}

async function flagOrderForReview(tx: Tx, order: OrderRow): Promise<void> {
  await tx.update(orders).set({ paymentStatus: 'REVIEW_REQUIRED' })
    .where(and(eq(orders.id, order.id), eq(orders.paymentStatus, 'PENDING')))
}

async function markReview(tx: Tx, bt: BankTxRow, reason: ReviewReason, order: OrderRow | null): Promise<MatchOutcome> {
  await tx.update(bankTransactions).set({
    reconciliationStatus: 'REVIEW_REQUIRED',
    reviewReason: reason,
    matchedStoreId: order?.storeId ?? null,
    matchedOrderId: order?.id ?? null,
  }).where(eq(bankTransactions.id, bt.id))
  await tx.insert(bankTransactionEvents).values({
    orgId: bt.orgId,
    bankTransactionId: bt.id,
    action: 'REVIEW_REQUIRED',
    fromStatus: 'RECEIVED',
    toStatus: 'REVIEW_REQUIRED',
    orderId: order?.id ?? null,
    metadata: { reason },
  })
  if (order) {
    await tx.insert(orderEvents).values({
      orgId: order.orgId,
      storeId: order.storeId,
      orderId: order.id,
      actorUserId: null,
      eventType: 'PAYMENT_REVIEW_REQUIRED',
      metadata: { bankTransactionId: bt.id, reason, amountVnd: bt.amountVnd },
    })
  }
  return { kind: 'REVIEW', reason, orderId: order?.id ?? null }
}

export async function matchTransaction(db: Db, bankTransactionId: string): Promise<MatchOutcome> {
  return db.transaction(async (tx) => {
    const [bt] = await tx.select().from(bankTransactions).where(eq(bankTransactions.id, bankTransactionId)).for('update')
    if (!bt) throw new AppError('NOT_FOUND', 'Không tìm thấy giao dịch')
    if (bt.reconciliationStatus !== 'RECEIVED') return { kind: 'SKIPPED', status: bt.reconciliationStatus }
    if (bt.direction === 'OUT') {
      await tx.update(bankTransactions).set({ reconciliationStatus: 'IGNORED' }).where(eq(bankTransactions.id, bt.id))
      return { kind: 'IGNORED' }
    }
    if (!bt.paymentCode) return markReview(tx, bt, 'NO_CODE', null)
    if (bt.paymentCode === PAYMENT_TEST_CODE) return markTestTransfer(tx, bt)

    // Unlocked read only to learn which order owns the code; the org filter keeps tenants apart.
    const [hint] = await tx.select({ id: paymentAttempts.id, storeId: paymentAttempts.storeId, orderId: paymentAttempts.orderId })
      .from(paymentAttempts)
      .where(and(eq(paymentAttempts.paymentCode, bt.paymentCode), eq(paymentAttempts.orgId, bt.orgId)))
      .limit(1)
    if (!hint) return markReview(tx, bt, 'UNKNOWN_CODE', null)

    const { attempts, order } = await lockOrderGraph(tx, { orgId: bt.orgId, storeId: hint.storeId, orderId: hint.orderId })
    const attempt = attempts.find(a => a.id === hint.id)
    if (!order || !attempt) return markReview(tx, bt, 'UNKNOWN_CODE', null)

    if (!(await accountMatches(tx, bt, attempt))) {
      await flagOrderForReview(tx, order)
      return markReview(tx, bt, 'ACCOUNT_MISMATCH', order)
    }
    if (order.status === 'CANCELLED') {
      await tx.update(orders).set({ paymentStatus: 'REFUND_DUE' }).where(eq(orders.id, order.id))
      return markReview(tx, bt, 'ORDER_CANCELLED', order)
    }
    if (order.paymentStatus === 'PAID') return markReview(tx, bt, 'ORDER_ALREADY_PAID', order)
    if (
      order.status !== 'AWAITING_PAYMENT'
      || !['PENDING', 'REVIEW_REQUIRED'].includes(order.paymentStatus)
      || attempt.status === 'PAID'
    ) {
      return markReview(tx, bt, 'ORDER_NOT_PAYABLE', order)
    }
    if (bt.amountVnd !== attempt.expectedAmountVnd) {
      await flagOrderForReview(tx, order)
      return markReview(tx, bt, bt.amountVnd < attempt.expectedAmountVnd ? 'AMOUNT_UNDER' : 'AMOUNT_OVER', order)
    }

    const late = attempt.status !== 'PENDING'
    await confirmOrderPayment(tx, {
      order,
      method: 'SEPAY',
      amountVnd: bt.amountVnd,
      bankTransactionId: bt.id,
      paymentCodeAttemptId: attempt.id,
      actorUserId: null,
      late,
      eventType: 'PAYMENT_CONFIRMED',
      note: null,
      metadata: { bankTransactionId: bt.id, source: bt.source },
    })
    await tx.update(bankTransactions).set({
      reconciliationStatus: 'MATCHED',
      reviewReason: null,
      matchedStoreId: order.storeId,
      matchedOrderId: order.id,
    }).where(eq(bankTransactions.id, bt.id))
    await tx.insert(bankTransactionEvents).values({
      orgId: bt.orgId,
      bankTransactionId: bt.id,
      action: 'MATCHED',
      fromStatus: 'RECEIVED',
      toStatus: 'MATCHED',
      orderId: order.id,
      metadata: { late },
    })
    return { kind: 'MATCHED', orderId: order.id, late }
  })
}
```

- [ ] **Step 6: Chạy, thấy PASS**

Run: `npm run test:integration -- tests/integration/match-transaction.test.ts`
Expected: PASS toàn bộ (bao gồm 3 test đồng thời). Nếu test "burst" báo `deadlock detected` (`40P01`), nghĩa là có đường khoá sai thứ tự — sửa code, không giảm test.

- [ ] **Step 7: Commit**

```bash
git add server/services/payments/lock-order-graph.ts server/services/payments/confirm-payment.ts server/services/payments/match-transaction.ts tests/integration/match-transaction.test.ts
git commit -m "feat(payment-webhook): match bank transactions exactly once with review routing

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 5: Route webhook SePay (auth, raw body, idempotent, rate limit, log an toàn)

**Files:**
- Create: `server/services/payments/webhook-auth.ts`, `server/services/payments/webhook-traffic.ts`, `server/services/payments/webhook-auth-settings.ts`, `server/services/payments/process-sepay-webhook.ts`, `server/api/webhooks/sepay/[key].post.ts`, `server/api/organizations/[orgId]/sepay-integrations/[integrationId]/webhook-auth-mode.put.ts`
- Modify: `nuxt.config.ts` (routeRules `no-store` cho `/api/webhooks/**` và `/api/internal/**`)
- Test: `tests/unit/server/webhook-auth.test.ts`, `tests/integration/process-sepay-webhook.test.ts`, `tests/api/payment-webhook.test.ts`

**Interfaces:**
- Consumes: `verifySepaySignature`, `verifySepayApiKey`, `sepayWebhookPayloadSchema`, `toBankTransactionInput` (Task 2); `recordBankTransaction` (Task 3); `matchTransaction` (Task 4); `sepayWebhookAuth` (Task 1); từ PR5 (`server/services/payments/integration-secrets.ts`): `findIntegrationByEndpointKey(db, endpointKey): Promise<{ id, orgId, environment, status } | null>` (bỏ qua `DISABLED`, key sai định dạng trả `null` mà không chạm DB) và `loadIntegrationSecrets(db, integrationId): Promise<{ hmacSecret: string | null, apiToken: string | null } | null>` (**đường duy nhất giải mã secret**); cột `sepayIntegrations.lastValidWebhookAt` (PR5 để PR6 ghi); `consumeRateLimit(db, key, { limit, windowSec, now? }): Promise<boolean>` (PR3, `true` = còn hạn mức); `getPgError` (PR1); `requireOrgOwner`, `defineApiHandler`, `AppError`, `logger`, `parseBody`, `parseWith`.
- Produces:
  - `authenticateWebhook(input: { mode: 'HMAC' | 'APIKEY', secret: string, headers: { authorization?: string, signature?: string, timestamp?: string }, rawBody: string, nowSec: number }): 'OK' | 'MISSING' | 'STALE' | 'MISMATCH'`.
  - `allowWebhookTraffic(db: Db, ip: string, options?: { limit: number, windowSec: number }): Promise<boolean>`; `allowWebhookFailure(db: Db, ip: string, options?): Promise<boolean>` (mặc định 600/phút/IP và 20 lỗi xác thực/10 phút/IP).
  - `processSepayWebhook(db: Db, input: { integration: { id: string, orgId: string }, payload: SepayWebhookPayload }, deps?: { match: (db: Db, id: string) => Promise<MatchOutcome> }): Promise<{ transactionId: string, created: boolean, outcome: MatchOutcome | null }>`; `runWebhookProcessing` (cùng tham số) bọc lỗi thành `AppError('INTERNAL')` đã lọc log.
  - `getWebhookAuthMode(db: DbOrTx, integrationId: string): Promise<'HMAC' | 'APIKEY'>` (mặc định `HMAC`); `setWebhookAuthMode(db: Db, orgId: string, integrationId: string, mode: 'HMAC' | 'APIKEY'): Promise<void>` (404 nếu integration không thuộc org); `touchVerifiedWebhook(db: Db, integrationId: string): Promise<void>` — đặt `sepay_integrations.last_valid_webhook_at = now()` (tối đa 1 lần/phút); `activateIntegration` của PR5 đọc cột này để cho phép `TESTING → ACTIVE`.
  - HTTP: `POST /api/webhooks/sepay/:key` → `200 {"success": true}` | `401` | `404` | `400` | `429` | `500`; `PUT /api/organizations/:orgId/sepay-integrations/:integrationId/webhook-auth-mode { mode }` (owner).
  - Quy ước: V1 của PR5 chỉ hướng dẫn HMAC; API Key là chế độ phụ do owner bật qua endpoint trên. Khi `mode = 'APIKEY'`, `encrypted_hmac_secret` lưu **API key** (nhập qua `PUT …/secret { hmacSecret }` của PR5).
  - "Gửi thử" của SePay: payload có `id = 0` (U5, PR5 F6 — chưa tự xác minh) được xác thực, ghi `last_valid_webhook_at`, trả `{"success": true}` và **không** lưu thành giao dịch (id thật của SePay luôn dương).

- [ ] **Step 1: Viết test thất bại cho `authenticateWebhook`**

`tests/unit/server/webhook-auth.test.ts`:

```ts
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { authenticateWebhook } from '../../../server/services/payments/webhook-auth'

const NOW = 1_800_000_000
const BODY = '{"id":1}'
const sig = (secret: string, ts = NOW) => `sha256=${createHmac('sha256', secret).update(`${ts}.${BODY}`).digest('hex')}`

describe('authenticateWebhook', () => {
  it('HMAC mode accepts a valid signature and ignores the Authorization header', () => {
    expect(authenticateWebhook({
      mode: 'HMAC', secret: 's', rawBody: BODY, nowSec: NOW,
      headers: { signature: sig('s'), timestamp: String(NOW), authorization: 'Apikey whatever' },
    })).toBe('OK')
  })

  it('HMAC mode rejects an API-key-only request as MISSING', () => {
    expect(authenticateWebhook({ mode: 'HMAC', secret: 's', rawBody: BODY, nowSec: NOW, headers: { authorization: 'Apikey s' } })).toBe('MISSING')
  })

  it('APIKEY mode accepts "Apikey <key>" and ignores any signature headers', () => {
    expect(authenticateWebhook({
      mode: 'APIKEY', secret: 'k', rawBody: BODY, nowSec: NOW,
      headers: { authorization: 'Apikey k', signature: 'sha256=bad', timestamp: '1' },
    })).toBe('OK')
  })

  it('APIKEY mode rejects a validly signed request without Authorization (no downgrade confusion)', () => {
    expect(authenticateWebhook({
      mode: 'APIKEY', secret: 'k', rawBody: BODY, nowSec: NOW,
      headers: { signature: sig('k'), timestamp: String(NOW) },
    })).toBe('MISSING')
  })

  it('APIKEY mode rejects a wrong key', () => {
    expect(authenticateWebhook({ mode: 'APIKEY', secret: 'k', rawBody: BODY, nowSec: NOW, headers: { authorization: 'Apikey nope' } })).toBe('MISMATCH')
  })
})
```

- [ ] **Step 2: Chạy, thấy FAIL**

Run: `npm run test:unit -- tests/unit/server/webhook-auth.test.ts`
Expected: FAIL (`Failed to resolve import ".../webhook-auth"`).

- [ ] **Step 3: Cài đặt `webhook-auth.ts`**

```ts
import { verifySepayApiKey, verifySepaySignature } from './sepay-signature'

export type WebhookAuthResult = 'OK' | 'MISSING' | 'STALE' | 'MISMATCH'

// The integration's configured mode decides the only accepted scheme; a request cannot pick a weaker one.
export function authenticateWebhook(input: {
  mode: 'HMAC' | 'APIKEY'
  secret: string
  headers: { authorization?: string, signature?: string, timestamp?: string }
  rawBody: string
  nowSec: number
}): WebhookAuthResult {
  if (input.mode === 'APIKEY') {
    return verifySepayApiKey({ authorizationHeader: input.headers.authorization, apiKey: input.secret })
  }
  return verifySepaySignature({
    rawBody: input.rawBody,
    timestamp: input.headers.timestamp,
    signatureHeader: input.headers.signature,
    secret: input.secret,
    nowSec: input.nowSec,
  })
}
```

- [ ] **Step 4: Chạy, thấy PASS**

Run: `npm run test:unit -- tests/unit/server/webhook-auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Viết integration test thất bại cho pipeline, rate limit, log, auth-mode**

`tests/integration/process-sepay-webhook.test.ts`:

```ts
import { and, eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { bankTransactions, orderPayments, sepayIntegrations } from '../../server/db/schema'
import { processSepayWebhook, runWebhookProcessing } from '../../server/services/payments/process-sepay-webhook'
import { sepayWebhookPayloadSchema } from '../../server/services/payments/sepay-payload'
import { allowWebhookFailure, allowWebhookTraffic } from '../../server/services/payments/webhook-traffic'
import { getWebhookAuthMode, setWebhookAuthMode, touchVerifiedWebhook } from '../../server/services/payments/webhook-auth-settings'
import { AppError } from '../../server/utils/errors'
import { createTenant } from '../support/fixtures'
import { createAwaitingOrder, createPaymentSetup, sepayPayload, type PaymentSetup } from '../support/webhook-fixtures'
import { resetDb } from '../support/db'

const db = () => getDb()

let setup: PaymentSetup
const integration = () => ({ id: setup.integration.id, orgId: setup.orgId })
const parse = (payload: unknown) => sepayWebhookPayloadSchema.parse(payload)
const payments = (orderId: string) => db().select().from(orderPayments).where(eq(orderPayments.orderId, orderId))

beforeEach(async () => {
  await resetDb()
  setup = await createPaymentSetup(await createTenant('a'))
})
afterEach(() => {
  vi.restoreAllMocks()
})
afterAll(async () => {
  await closeDb()
})

describe('processSepayWebhook', () => {
  it('records and confirms a correct transfer', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { amountVnd: 55_000 })
    const payload = parse(sepayPayload(setup, { code: attempt.paymentCode, transferAmount: 55_000 }))
    const result = await processSepayWebhook(db(), { integration: integration(), payload })
    expect(result).toMatchObject({ created: true, outcome: { kind: 'MATCHED', orderId: order.id } })
    expect(await payments(order.id)).toHaveLength(1)
  })

  it('replaying a processed webhook is a no-op that still succeeds', async () => {
    const { order, attempt } = await createAwaitingOrder(setup)
    const payload = parse(sepayPayload(setup, { code: attempt.paymentCode }))
    await processSepayWebhook(db(), { integration: integration(), payload })
    const replay = await processSepayWebhook(db(), { integration: integration(), payload })
    expect(replay).toMatchObject({ created: false, outcome: null })
    expect(await payments(order.id)).toHaveLength(1)
  })

  it('five concurrent deliveries of the same transfer confirm exactly once', async () => {
    const { order, attempt } = await createAwaitingOrder(setup)
    const payload = parse(sepayPayload(setup, { code: attempt.paymentCode }))
    const results = await Promise.all(Array.from({ length: 5 }, () => processSepayWebhook(db(), { integration: integration(), payload })))
    expect(results.filter(r => r.outcome?.kind === 'MATCHED')).toHaveLength(1)
    expect(await payments(order.id)).toHaveLength(1)
    expect(await db().select().from(bankTransactions).where(eq(bankTransactions.integrationId, setup.integration.id))).toHaveLength(1)
  })

  it('stores an outgoing transfer as IGNORED without matching', async () => {
    const payload = parse(sepayPayload(setup, { transferType: 'out' }))
    const result = await processSepayWebhook(db(), { integration: integration(), payload })
    expect(result.outcome).toBeNull()
    const [row] = await db().select().from(bankTransactions).where(eq(bankTransactions.integrationId, setup.integration.id))
    expect(row!.reconciliationStatus).toBe('IGNORED')
  })

  it('keeps unknown money visible: code null and unknown code both land in REVIEW_REQUIRED', async () => {
    await processSepayWebhook(db(), { integration: integration(), payload: parse(sepayPayload(setup, { code: null, content: 'ck' })) })
    await processSepayWebhook(db(), { integration: integration(), payload: parse(sepayPayload(setup, { code: 'ZOUNKNOWN1' })) })
    const rows = await db().select().from(bankTransactions).where(and(eq(bankTransactions.integrationId, setup.integration.id), eq(bankTransactions.reconciliationStatus, 'REVIEW_REQUIRED')))
    expect(rows.map(r => r.reviewReason).sort()).toEqual(['NO_CODE', 'UNKNOWN_CODE'])
  })
})

describe('Tx2 failure (Review Focus #4)', () => {
  it('leaves the transaction RECEIVED, surfaces an error, and a SePay retry then confirms exactly once', async () => {
    const { order, attempt } = await createAwaitingOrder(setup)
    const payload = parse(sepayPayload(setup, { code: attempt.paymentCode }))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const failing = { match: async () => { throw new Error('connection terminated') } }
    await expect(runWebhookProcessing(db(), { integration: integration(), payload }, failing)).rejects.toMatchObject({ code: 'INTERNAL' })

    const [stuck] = await db().select().from(bankTransactions).where(eq(bankTransactions.integrationId, setup.integration.id))
    expect(stuck!.reconciliationStatus).toBe('RECEIVED')
    expect(await payments(order.id)).toHaveLength(0)

    const retry = await runWebhookProcessing(db(), { integration: integration(), payload })
    expect(retry.outcome).toMatchObject({ kind: 'MATCHED', orderId: order.id })
    expect(await payments(order.id)).toHaveLength(1)
  })

  it('never writes the payload, transfer content, phone or driver params to logs', async () => {
    const payload = parse(sepayPayload(setup, {
      code: null,
      content: 'NGUYEN VAN A 0912345678 chuyen tien',
      description: 'secret-description',
    }))
    const lines: string[] = []
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => { lines.push(String(line)) })
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => { lines.push(String(line)) })

    const failing = { match: async () => { throw new Error('Failed query: update ... params: 0912345678,NGUYEN VAN A,secret-description') } }
    await expect(runWebhookProcessing(db(), { integration: integration(), payload }, failing)).rejects.toBeInstanceOf(AppError)

    const output = lines.join('\n')
    expect(output).toContain('webhook.processing_failed')
    for (const forbidden of ['0912345678', 'NGUYEN VAN A', 'secret-description', 'Failed query']) {
      expect(output).not.toContain(forbidden)
    }
  })
})

describe('rate limiting', () => {
  it('allows traffic up to the limit per IP and then refuses', async () => {
    const options = { limit: 3, windowSec: 60 }
    expect(await allowWebhookTraffic(db(), '1.1.1.1', options)).toBe(true)
    expect(await allowWebhookTraffic(db(), '1.1.1.1', options)).toBe(true)
    expect(await allowWebhookTraffic(db(), '1.1.1.1', options)).toBe(true)
    expect(await allowWebhookTraffic(db(), '1.1.1.1', options)).toBe(false)
    expect(await allowWebhookTraffic(db(), '2.2.2.2', options)).toBe(true)
  })

  it('throttles repeated authentication failures separately from normal traffic', async () => {
    const options = { limit: 2, windowSec: 600 }
    expect(await allowWebhookFailure(db(), '3.3.3.3', options)).toBe(true)
    expect(await allowWebhookFailure(db(), '3.3.3.3', options)).toBe(true)
    expect(await allowWebhookFailure(db(), '3.3.3.3', options)).toBe(false)
    expect(await allowWebhookTraffic(db(), '3.3.3.3', { limit: 5, windowSec: 60 })).toBe(true)
  })
})

describe('auth mode and last valid webhook', () => {
  it('defaults to HMAC and switches to APIKEY for the owning organisation only', async () => {
    expect(await getWebhookAuthMode(db(), setup.integration.id)).toBe('HMAC')
    await setWebhookAuthMode(db(), setup.orgId, setup.integration.id, 'APIKEY')
    expect(await getWebhookAuthMode(db(), setup.integration.id)).toBe('APIKEY')
    const other = await createTenant('c')
    await expect(setWebhookAuthMode(db(), other.org.id, setup.integration.id, 'HMAC')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(setWebhookAuthMode(db(), setup.orgId, 'not-a-uuid', 'HMAC')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await getWebhookAuthMode(db(), setup.integration.id)).toBe('APIKEY')
  })

  it('touchVerifiedWebhook sets last_valid_webhook_at once a minute', async () => {
    const read = async () => (await db().select().from(sepayIntegrations).where(eq(sepayIntegrations.id, setup.integration.id)))[0]!.lastValidWebhookAt
    expect(await read()).toBeNull()
    await touchVerifiedWebhook(db(), setup.integration.id)
    const first = await read()
    expect(first).toBeInstanceOf(Date)
    await touchVerifiedWebhook(db(), setup.integration.id)
    expect(await read()).toEqual(first)
  })
})
```

- [ ] **Step 6: Chạy, thấy FAIL**

Run: `npm run test:integration -- tests/integration/process-sepay-webhook.test.ts`
Expected: FAIL (import không resolve).

- [ ] **Step 7: Cài đặt traffic và settings**

`server/services/payments/webhook-traffic.ts`:

```ts
import type { Db } from '../../db/client'
import { consumeRateLimit } from '../ordering/rate-limit'

export interface RateOptions { limit: number, windowSec: number }

const TRAFFIC: RateOptions = { limit: 600, windowSec: 60 }
const FAILURES: RateOptions = { limit: 20, windowSec: 600 }

export function allowWebhookTraffic(db: Db, ip: string, options: RateOptions = TRAFFIC): Promise<boolean> {
  return consumeRateLimit(db, `webhook:${ip}`, options)
}

export function allowWebhookFailure(db: Db, ip: string, options: RateOptions = FAILURES): Promise<boolean> {
  return consumeRateLimit(db, `webhook-fail:${ip}`, options)
}
```

`server/services/payments/webhook-auth-settings.ts`:

```ts
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Db, DbOrTx } from '../../db/client'
import { sepayIntegrations, sepayWebhookAuth } from '../../db/schema'
import { AppError } from '../../utils/errors'

export async function getWebhookAuthMode(db: DbOrTx, integrationId: string): Promise<'HMAC' | 'APIKEY'> {
  const [row] = await db.select({ mode: sepayWebhookAuth.mode }).from(sepayWebhookAuth).where(eq(sepayWebhookAuth.integrationId, integrationId))
  return row?.mode ?? 'HMAC'
}

export async function setWebhookAuthMode(db: Db, orgId: string, integrationId: string, mode: 'HMAC' | 'APIKEY'): Promise<void> {
  if (!z.uuid().safeParse(integrationId).success) throw new AppError('NOT_FOUND', 'Không tìm thấy')
  const [owned] = await db.select({ id: sepayIntegrations.id }).from(sepayIntegrations)
    .where(and(eq(sepayIntegrations.id, integrationId), eq(sepayIntegrations.orgId, orgId)))
  if (!owned) throw new AppError('NOT_FOUND', 'Không tìm thấy')
  await db.insert(sepayWebhookAuth).values({ integrationId, mode })
    .onConflictDoUpdate({ target: sepayWebhookAuth.integrationId, set: { mode } })
}

// PR5's activateIntegration needs one verified delivery before TESTING can become ACTIVE.
// Throttled to one write a minute: a busy store would otherwise write on every webhook.
export async function touchVerifiedWebhook(db: Db, integrationId: string): Promise<void> {
  await db.update(sepayIntegrations).set({ lastValidWebhookAt: new Date() }).where(and(
    eq(sepayIntegrations.id, integrationId),
    sql`(${sepayIntegrations.lastValidWebhookAt} is null or ${sepayIntegrations.lastValidWebhookAt} < now() - interval '1 minute')`,
  ))
}
```

- [ ] **Step 8: Cài đặt `process-sepay-webhook.ts`**

```ts
import type { Db } from '../../db/client'
import { getPgError } from '../../db/errors'
import { AppError } from '../../utils/errors'
import { logger } from '../../utils/logger'
import { matchTransaction } from './match-transaction'
import { recordBankTransaction } from './record-bank-transaction'
import { toBankTransactionInput, type SepayWebhookPayload } from './sepay-payload'
import type { MatchOutcome } from './types'

export interface WebhookProcessingInput {
  integration: { id: string, orgId: string }
  payload: SepayWebhookPayload
}

export interface WebhookProcessingDeps {
  match: (db: Db, bankTransactionId: string) => Promise<MatchOutcome>
}

export interface WebhookProcessingResult {
  transactionId: string
  created: boolean
  outcome: MatchOutcome | null
}

// Tx1 persists, Tx2 matches. A duplicate whose first delivery stopped after Tx1 (status RECEIVED) is matched here,
// so a SePay retry heals a half-processed transaction.
export async function processSepayWebhook(
  db: Db,
  input: WebhookProcessingInput,
  deps: WebhookProcessingDeps = { match: matchTransaction },
): Promise<WebhookProcessingResult> {
  const record = await recordBankTransaction(db, toBankTransactionInput(input.integration, input.payload))
  if (record.status !== 'RECEIVED') return { transactionId: record.id, created: record.created, outcome: null }
  const outcome = await deps.match(db, record.id)
  return { transactionId: record.id, created: record.created, outcome }
}

// Drizzle errors embed query params (transfer content, phone numbers); only the error class and pg code are logged.
export async function runWebhookProcessing(
  db: Db,
  input: WebhookProcessingInput,
  deps: WebhookProcessingDeps = { match: matchTransaction },
): Promise<WebhookProcessingResult> {
  let stage: 'record' | 'match' = 'record'
  try {
    const result = await processSepayWebhook(db, input, {
      match: (innerDb, id) => {
        stage = 'match'
        return deps.match(innerDb, id)
      },
    })
    logger.info('webhook.processed', {
      integrationId: input.integration.id,
      transactionId: result.transactionId,
      created: result.created,
      outcome: result.outcome?.kind ?? 'NOT_MATCHED_AGAIN',
      reason: result.outcome?.kind === 'REVIEW' ? result.outcome.reason : undefined,
    })
    return result
  }
  catch (err) {
    logger.error('webhook.processing_failed', {
      integrationId: input.integration.id,
      stage,
      errorName: err instanceof Error ? err.name : 'unknown',
      pgCode: getPgError(err).code,
    })
    throw new AppError('INTERNAL', 'Không xử lý được webhook')
  }
}
```

- [ ] **Step 9: Chạy integration test, thấy PASS**

Run: `npm run test:integration -- tests/integration/process-sepay-webhook.test.ts`
Expected: PASS. (Nếu test log fail vì `logger.info` ghi `reason: undefined`: `redact` giữ `undefined`, `JSON.stringify` bỏ qua — không phải lỗi.)

- [ ] **Step 10: Tạo route webhook**

`server/api/webhooks/sepay/[key].post.ts`:

```ts
import { getHeader, getRequestIP, getRouterParam, readRawBody } from 'h3'
import { getDb, type Db } from '../../../db/client'
import { loadIntegrationSecrets, findIntegrationByEndpointKey } from '../../../services/payments/integration-secrets'
import { runWebhookProcessing } from '../../../services/payments/process-sepay-webhook'
import { sepayWebhookPayloadSchema } from '../../../services/payments/sepay-payload'
import { authenticateWebhook } from '../../../services/payments/webhook-auth'
import { getWebhookAuthMode, touchVerifiedWebhook } from '../../../services/payments/webhook-auth-settings'
import { allowWebhookFailure, allowWebhookTraffic } from '../../../services/payments/webhook-traffic'
import { defineApiHandler } from '../../../utils/api-handler'
import { AppError } from '../../../utils/errors'
import { logger } from '../../../utils/logger'
import { parseWith } from '../../../utils/validation'

const MAX_BODY_BYTES = 64 * 1024

// Failed attempts are throttled per IP so the endpoint key and credentials cannot be brute-forced.
async function reject(db: Db, ip: string, error: AppError): Promise<never> {
  if (!(await allowWebhookFailure(db, ip))) throw new AppError('RATE_LIMITED', 'Quá nhiều yêu cầu')
  throw error
}

export default defineApiHandler(async (event) => {
  const db = getDb()
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  if (!(await allowWebhookTraffic(db, ip))) throw new AppError('RATE_LIMITED', 'Quá nhiều yêu cầu')

  const integration = await findIntegrationByEndpointKey(db, getRouterParam(event, 'key') ?? '')
  const secrets = integration ? await loadIntegrationSecrets(db, integration.id) : null
  if (!integration || !secrets?.hmacSecret) return reject(db, ip, new AppError('NOT_FOUND', 'Không tìm thấy'))

  const rawBody = (await readRawBody(event, 'utf8')) ?? ''
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) throw new AppError('VALIDATION_FAILED', 'Yêu cầu quá lớn')

  const mode = await getWebhookAuthMode(db, integration.id)
  const auth = authenticateWebhook({
    mode,
    secret: secrets.hmacSecret,
    rawBody,
    nowSec: Math.floor(Date.now() / 1000),
    headers: {
      authorization: getHeader(event, 'authorization'),
      signature: getHeader(event, 'x-sepay-signature'),
      timestamp: getHeader(event, 'x-sepay-timestamp'),
    },
  })
  if (auth !== 'OK') {
    logger.warn('webhook.auth_failed', { integrationId: integration.id, mode, reason: auth })
    return reject(db, ip, new AppError('UNAUTHENTICATED', 'Xác thực webhook thất bại'))
  }

  let json: unknown
  try {
    json = JSON.parse(rawBody)
  }
  catch {
    throw new AppError('VALIDATION_FAILED', 'Body JSON không hợp lệ')
  }
  const payload = parseWith(sepayWebhookPayloadSchema, json)

  await touchVerifiedWebhook(db, integration.id).catch(() => {
    logger.warn('webhook.touch_failed', { integrationId: integration.id })
  })

  // SePay's "Gửi thử" ping uses id 0 (U5); real transaction ids are positive, so nothing is stored for it.
  if (payload.id === '0') {
    logger.info('webhook.test_ping', { integrationId: integration.id })
    return { success: true }
  }

  await runWebhookProcessing(db, { integration: { id: integration.id, orgId: integration.orgId }, payload })
  return { success: true }
})
```

`server/api/organizations/[orgId]/sepay-integrations/[integrationId]/webhook-auth-mode.put.ts`:

```ts
import { getRouterParam } from 'h3'
import { z } from 'zod'
import { requireOrgOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { setWebhookAuthMode } from '../../../../../services/payments/webhook-auth-settings'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { parseBody } from '../../../../../utils/validation'

const bodySchema = z.object({ mode: z.enum(['HMAC', 'APIKEY']) })

export default defineApiHandler(async (event) => {
  const ctx = await requireOrgOwner(event, getRouterParam(event, 'orgId'))
  const { mode } = await parseBody(event, bodySchema)
  await setWebhookAuthMode(getDb(), ctx.orgId, getRouterParam(event, 'integrationId') ?? '', mode)
  return { mode }
})
```

Sửa `nuxt.config.ts`, thêm vào `routeRules`:

```ts
    '/api/webhooks/**': { headers: { 'cache-control': 'no-store' } },
    '/api/internal/**': { headers: { 'cache-control': 'no-store' } },
```

- [ ] **Step 11: Viết API test HTTP thất bại**

`tests/api/payment-webhook.test.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { fetch, setup } from '@nuxt/test-utils/e2e'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { bankTransactions, orderPayments, orders, sepayIntegrations } from '../../server/db/schema'
import { createStore, createTenant } from '../support/fixtures'
import {
  bodyOf, createAwaitingOrder, createPaymentSetup, sepayPayload, signSepayBody, type PaymentSetup,
} from '../support/webhook-fixtures'
import { resetDb } from '../support/db'

await setup({
  rootDir: fileURLToPath(new URL('../..', import.meta.url)),
  server: true,
  build: true,
  nuxtConfig: { typescript: { typeCheck: false } },
})

const db = () => getDb()

let hmac: PaymentSetup
let apikey: PaymentSetup

async function post(key: string, rawBody: string, headers: Record<string, string> = {}) {
  const res = await fetch(`/api/webhooks/sepay/${key}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: rawBody,
  })
  const text = await res.text()
  return { status: res.status, text, json: text ? JSON.parse(text) : null }
}

function signed(setupOf: PaymentSetup, payload: unknown, timestampSec?: number) {
  const raw = bodyOf(payload)
  return { raw, headers: signSepayBody(raw, setupOf.secret, timestampSec) }
}

const txCount = async () => (await db().select().from(bankTransactions)).length
const paymentsOf = (orderId: string) => db().select().from(orderPayments).where(eq(orderPayments.orderId, orderId))
const orderOf = async (id: string) => (await db().select().from(orders).where(eq(orders.id, id)))[0]!

beforeEach(async () => {
  await resetDb()
  const tenant = await createTenant('a')
  hmac = await createPaymentSetup(tenant, { secret: 'hmac-secret-for-tests' })
  // PR5 allows one active account per store and one open integration per (org, environment).
  const second = await createStore(tenant.org.id, 'k')
  apikey = await createPaymentSetup({ org: tenant.org, store: second }, { authMode: 'APIKEY', secret: 'apikey-for-tests', environment: 'test' })
})
afterAll(async () => {
  await closeDb()
})

describe('authentication', () => {
  it('rejects missing headers, a wrong secret, a tampered body and a stale timestamp — and stores nothing', async () => {
    const { attempt } = await createAwaitingOrder(hmac)
    const payload = sepayPayload(hmac, { code: attempt.paymentCode })
    const { raw, headers } = signed(hmac, payload)

    expect((await post(hmac.integration.webhookEndpointKey, raw)).status).toBe(401)
    expect((await post(hmac.integration.webhookEndpointKey, raw, { ...headers, 'x-sepay-signature': 'sha256=deadbeef' })).status).toBe(401)
    expect((await post(hmac.integration.webhookEndpointKey, `${raw} `, headers)).status).toBe(401)
    const old = signed(hmac, payload, Math.floor(Date.now() / 1000) - 600)
    expect((await post(hmac.integration.webhookEndpointKey, old.raw, old.headers)).status).toBe(401)
    expect(await txCount()).toBe(0)
  })

  it('returns 404 for an unknown endpoint key and for a DISABLED integration', async () => {
    const payload = sepayPayload(hmac)
    const { raw, headers } = signed(hmac, payload)
    expect(await post('does-not-exist', raw, headers)).toMatchObject({ status: 404, json: { code: 'NOT_FOUND' } })
    const disabled = await createPaymentSetup(await createTenant('d'), { status: 'DISABLED' })
    const signedDisabled = signed(disabled, payload)
    expect((await post(disabled.integration.webhookEndpointKey, signedDisabled.raw, signedDisabled.headers)).status).toBe(404)
  })

  it('API Key mode accepts "Apikey <key>" and rejects wrong keys, signature-only and Bearer', async () => {
    const payload = sepayPayload(apikey)
    const raw = bodyOf(payload)
    const key = apikey.integration.webhookEndpointKey
    expect((await post(key, raw, { authorization: `Apikey ${apikey.secret}` })).status).toBe(200)
    expect((await post(key, raw, { authorization: 'Apikey wrong' })).status).toBe(401)
    expect((await post(key, raw, { authorization: `Bearer ${apikey.secret}` })).status).toBe(401)
    expect((await post(key, raw, signSepayBody(raw, apikey.secret))).status).toBe(401)
  })

  it('HMAC mode ignores an Apikey header', async () => {
    const raw = bodyOf(sepayPayload(hmac))
    expect((await post(hmac.integration.webhookEndpointKey, raw, { authorization: `Apikey ${hmac.secret}` })).status).toBe(401)
  })
})

describe('contract with SePay', () => {
  it('answers 200 with exactly {"success": true} after the payment is committed', async () => {
    const { order, attempt } = await createAwaitingOrder(hmac, { amountVnd: 55_000 })
    const { raw, headers } = signed(hmac, sepayPayload(hmac, { code: attempt.paymentCode, transferAmount: 55_000 }))
    const res = await post(hmac.integration.webhookEndpointKey, raw, headers)
    expect(res).toMatchObject({ status: 200, json: { success: true } })
    expect(Object.keys(res.json)).toEqual(['success'])
    expect(await orderOf(order.id)).toMatchObject({ status: 'NEW', paymentStatus: 'PAID' })
    expect(await paymentsOf(order.id)).toHaveLength(1)
  })

  it('answers SePay\'s test ping (id 0) with success, records the valid webhook and stores no transaction', async () => {
    const { raw, headers } = signed(hmac, sepayPayload(hmac, { id: 0 }))
    expect(await post(hmac.integration.webhookEndpointKey, raw, headers)).toMatchObject({ status: 200, json: { success: true } })
    expect(await txCount()).toBe(0)
    const [row] = await db().select().from(sepayIntegrations).where(eq(sepayIntegrations.id, hmac.integration.id))
    expect(row!.lastValidWebhookAt).toBeInstanceOf(Date)
  })

  it('treats a replay of the same signed request as success without a second payment', async () => {
    const { order, attempt } = await createAwaitingOrder(hmac)
    const { raw, headers } = signed(hmac, sepayPayload(hmac, { code: attempt.paymentCode }))
    expect((await post(hmac.integration.webhookEndpointKey, raw, headers)).status).toBe(200)
    expect((await post(hmac.integration.webhookEndpointKey, raw, headers)).json).toEqual({ success: true })
    expect(await paymentsOf(order.id)).toHaveLength(1)
    expect(await txCount()).toBe(1)
  })

  it('five identical requests in parallel all succeed and confirm exactly once (Review Focus #1)', async () => {
    const { order, attempt } = await createAwaitingOrder(hmac)
    const { raw, headers } = signed(hmac, sepayPayload(hmac, { code: attempt.paymentCode }))
    const results = await Promise.all(Array.from({ length: 5 }, () => post(hmac.integration.webhookEndpointKey, raw, headers)))
    expect(results.map(r => r.status)).toEqual([200, 200, 200, 200, 200])
    expect(await paymentsOf(order.id)).toHaveLength(1)
    expect(await txCount()).toBe(1)
  })

  it('two different transfers with the same code in parallel: one payment, one review (Review Focus #2)', async () => {
    const { order, attempt } = await createAwaitingOrder(hmac)
    const one = signed(hmac, sepayPayload(hmac, { code: attempt.paymentCode }))
    const two = signed(hmac, sepayPayload(hmac, { code: attempt.paymentCode }))
    const results = await Promise.all([
      post(hmac.integration.webhookEndpointKey, one.raw, one.headers),
      post(hmac.integration.webhookEndpointKey, two.raw, two.headers),
    ])
    expect(results.map(r => r.status)).toEqual([200, 200])
    expect(await paymentsOf(order.id)).toHaveLength(1)
    const reviews = (await db().select().from(bankTransactions)).filter(t => t.reconciliationStatus === 'REVIEW_REQUIRED')
    expect(reviews).toHaveLength(1)
    expect(reviews[0]!.reviewReason).toBe('ORDER_ALREADY_PAID')
  })

  it('rejects malformed JSON, invalid payloads and oversized bodies with 400 and stores nothing', async () => {
    const key = hmac.integration.webhookEndpointKey
    const bad = signed(hmac, sepayPayload(hmac, { transferAmount: -5 }))
    expect((await post(key, bad.raw, bad.headers)).status).toBe(400)
    const notJson = '{not json'
    expect((await post(key, notJson, signSepayBody(notJson, hmac.secret))).status).toBe(400)
    const huge = JSON.stringify({ filler: 'x'.repeat(70 * 1024) })
    expect((await post(key, huge, signSepayBody(huge, hmac.secret))).status).toBe(400)
    expect(await txCount()).toBe(0)
  })
})

describe('money that must never disappear (Review Focus #3)', () => {
  it('stores outgoing transfers as IGNORED', async () => {
    const { raw, headers } = signed(hmac, sepayPayload(hmac, { transferType: 'out' }))
    expect((await post(hmac.integration.webhookEndpointKey, raw, headers)).status).toBe(200)
    expect((await db().select().from(bankTransactions))[0]!.reconciliationStatus).toBe('IGNORED')
  })

  it.each([
    ['unknown code', { code: 'ZOUNKNOWN1' }, 'UNKNOWN_CODE'],
    ['null code with no code in the content', { code: null, content: 'chuyen tien' }, 'NO_CODE'],
  ])('%s → 200 and REVIEW_REQUIRED', async (_name, patch, reason) => {
    const { raw, headers } = signed(hmac, sepayPayload(hmac, patch))
    expect((await post(hmac.integration.webhookEndpointKey, raw, headers)).status).toBe(200)
    expect((await db().select().from(bankTransactions))[0]).toMatchObject({ reconciliationStatus: 'REVIEW_REQUIRED', reviewReason: reason })
  })

  it('code null but present in the transfer content is still matched', async () => {
    const { order, attempt } = await createAwaitingOrder(hmac)
    const { raw, headers } = signed(hmac, sepayPayload(hmac, { code: null, content: `ck ${attempt.paymentCode.toLowerCase()} cam on` }))
    expect((await post(hmac.integration.webhookEndpointKey, raw, headers)).status).toBe(200)
    expect(await orderOf(order.id)).toMatchObject({ paymentStatus: 'PAID' })
  })

  it('wrong or short amounts never confirm the order', async () => {
    const { order, attempt } = await createAwaitingOrder(hmac, { amountVnd: 55_000 })
    const { raw, headers } = signed(hmac, sepayPayload(hmac, { code: attempt.paymentCode, transferAmount: 50_000 }))
    expect((await post(hmac.integration.webhookEndpointKey, raw, headers)).status).toBe(200)
    expect(await orderOf(order.id)).toMatchObject({ status: 'AWAITING_PAYMENT', paymentStatus: 'REVIEW_REQUIRED' })
    expect(await paymentsOf(order.id)).toHaveLength(0)
  })

  it('transfer after the attempt expired is accepted and flagged late', async () => {
    const { order, attempt } = await createAwaitingOrder(hmac, { attemptStatus: 'EXPIRED' })
    const { raw, headers } = signed(hmac, sepayPayload(hmac, { code: attempt.paymentCode }))
    expect((await post(hmac.integration.webhookEndpointKey, raw, headers)).status).toBe(200)
    expect(await orderOf(order.id)).toMatchObject({ status: 'NEW', paymentStatus: 'PAID', latePayment: true })
  })

  it('transfer after the order was cancelled → order REFUND_DUE and the transaction waits for review', async () => {
    const { order, attempt } = await createAwaitingOrder(hmac, { orderStatus: 'CANCELLED', paymentStatus: 'UNPAID', attemptStatus: 'EXPIRED' })
    const { raw, headers } = signed(hmac, sepayPayload(hmac, { code: attempt.paymentCode }))
    expect((await post(hmac.integration.webhookEndpointKey, raw, headers)).status).toBe(200)
    expect(await orderOf(order.id)).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUND_DUE' })
    expect((await db().select().from(bankTransactions))[0]).toMatchObject({ reconciliationStatus: 'REVIEW_REQUIRED', reviewReason: 'ORDER_CANCELLED' })
  })
})
```

- [ ] **Step 12: Chạy API test**

Run: `npm run test:api -- tests/api/payment-webhook.test.ts`
Expected: PASS (build Nuxt mất vài phút lần đầu). Test "rate limit 429" nằm ở integration (Step 5) vì cần hàng trăm request; không lặp lại ở HTTP.

- [ ] **Step 13: Chạy lại toàn bộ suite thanh toán + lint/typecheck**

Run: `npm run test:unit && npm run test:integration && npm run lint && npm run typecheck`
Expected: xanh.

- [ ] **Step 14: Commit**

```bash
git add server/services/payments server/api/webhooks server/api/organizations nuxt.config.ts tests/unit/server/webhook-auth.test.ts tests/integration/process-sepay-webhook.test.ts tests/api/payment-webhook.test.ts
git commit -m "feat(payment-webhook): add SePay webhook route with idempotent processing

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: Cron hết hạn attempt và hủy đơn quá hạn (có điều kiện đối soát)

**Files:**
- Create: `server/utils/cron-auth.ts`, `server/services/payments/expire-payment-attempts.ts`, `server/api/internal/expire-payment-attempts.ts`, `vercel.json`
- Modify: `.github/workflows/ci.yml` (env `CRON_SECRET`), `.env.test` (thêm `CRON_SECRET`, không commit)
- Test: `tests/unit/server/cron-auth.test.ts`, `tests/unit/server/vercel-crons.test.ts`, `tests/integration/expire-payment-attempts.test.ts`, `tests/api/internal-cron.test.ts`

**Interfaces:**
- Consumes: `paymentAttempts`, `orders`, `orderEvents`, `reconcileCheckpoints`, `bankTransactions`, `sepayIntegrations`, `integrationAccounts` (Task 1/PR3/PR5); `matchTransaction`, `recordBankTransaction` (test); `AppError`, `logger`.
- Produces:
  - `verifyCronSecret(authorizationHeader: string | undefined, secret: string | undefined): boolean` (hằng thời gian; secret < 16 ký tự → luôn `false`); `assertCronRequest(event: H3Event): void` (chỉ GET/POST, ném 401 `UNAUTHENTICATED`).
  - `expirePaymentAttempts(db: Db, now: Date): Promise<{ expiredAttempts: number, cancelledOrders: number }>`; `cancelStaleAwaitingOrders(db: Db, now: Date): Promise<number>`; `cancelOrderIfStillUnpaid(db: Db, order: { id: string, orgId: string, storeId: string }): Promise<boolean>` (cập nhật có điều kiện, trọng tài giữa hủy và match).
  - Quy tắc hủy (spec §6.4 + quyết định cho integration không có API token): đơn `AWAITING_PAYMENT` + payment `PENDING` + tạo > 24 h + **không còn attempt PENDING** + **không có giao dịch `RECEIVED` mang mã của đơn** + mọi integration của tài khoản nhận tiền đều có API token **và** `reconcile_checkpoints.last_synced_at` **sau** `expires_at` của attempt cuối. Không có API đối soát → **không bao giờ tự hủy**, chủ quán hủy tay (PRD §8.4: "không hứa tự động tuyệt đối").
  - `GET|POST /api/internal/expire-payment-attempts` → `200 { expiredAttempts, cancelledOrders }`; `vercel.json` khai báo cron.

- [ ] **Step 1: Viết unit test thất bại cho `cron-auth` và `vercel.json`**

`tests/unit/server/cron-auth.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { verifyCronSecret } from '../../../server/utils/cron-auth'

const SECRET = 'cron-secret-0123456789'

describe('verifyCronSecret', () => {
  it('accepts exactly "Bearer <secret>" (what Vercel Cron sends)', () => {
    expect(verifyCronSecret(`Bearer ${SECRET}`, SECRET)).toBe(true)
  })

  it.each([
    ['missing header', undefined],
    ['empty header', ''],
    ['no scheme', SECRET],
    ['wrong scheme', `Basic ${SECRET}`],
    ['wrong secret', 'Bearer nope-nope-nope-nope'],
    ['secret with trailing space', `Bearer ${SECRET} `],
  ])('rejects %s', (_name, header) => {
    expect(verifyCronSecret(header, SECRET)).toBe(false)
  })

  it('rejects everything when the secret is unset or too short', () => {
    expect(verifyCronSecret('Bearer ', undefined)).toBe(false)
    expect(verifyCronSecret('Bearer short', 'short')).toBe(false)
    expect(verifyCronSecret('Bearer ', '')).toBe(false)
  })
})
```

`tests/unit/server/vercel-crons.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons: { path: string, schedule: string }[] }

describe('vercel.json crons', () => {
  it('declares the expiry and reconcile jobs', () => {
    expect(config.crons.map(c => c.path).sort()).toEqual([
      '/api/internal/expire-payment-attempts',
      '/api/internal/reconcile-sepay',
    ])
  })

  it.each(config.crons)('$path points at an existing route and a 5-field schedule', ({ path, schedule }) => {
    expect(existsSync(`server${path}.ts`)).toBe(true)
    expect(schedule.trim().split(/\s+/)).toHaveLength(5)
  })
})
```

- [ ] **Step 2: Chạy, thấy FAIL**

Run: `npm run test:unit -- tests/unit/server/cron-auth.test.ts tests/unit/server/vercel-crons.test.ts`
Expected: FAIL (không resolve `cron-auth`; không đọc được `vercel.json`).

- [ ] **Step 3: Cài đặt `cron-auth.ts` và `vercel.json`**

`server/utils/cron-auth.ts`:

```ts
import { createHash, timingSafeEqual } from 'node:crypto'
import { createError, getHeader, type H3Event } from 'h3'
import { AppError } from './errors'
import { logger } from './logger'

const MIN_SECRET_LENGTH = 16
const digest = (value: string) => createHash('sha256').update(value).digest()

export function verifyCronSecret(authorizationHeader: string | undefined, secret: string | undefined): boolean {
  if (!secret || secret.length < MIN_SECRET_LENGTH) return false
  return timingSafeEqual(digest(authorizationHeader ?? ''), digest(`Bearer ${secret}`))
}

// Vercel Cron issues GET; POST stays allowed for manual runs. Any other method is a 405 (mapped to 404 by the API handler).
export function assertCronRequest(event: H3Event): void {
  if (event.method !== 'GET' && event.method !== 'POST') throw createError({ statusCode: 405 })
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < MIN_SECRET_LENGTH) logger.error('cron.secret_not_configured')
  if (!verifyCronSecret(getHeader(event, 'authorization'), secret)) {
    throw new AppError('UNAUTHENTICATED', 'Không được phép')
  }
}
```

`vercel.json` (tạo ở gốc repo; Hobby xem Task 0 Step 3):

```json
{
  "crons": [
    { "path": "/api/internal/expire-payment-attempts", "schedule": "*/5 * * * *" },
    { "path": "/api/internal/reconcile-sepay", "schedule": "*/15 * * * *" }
  ]
}
```

(Test `vercel-crons` sẽ vẫn FAIL ở case `reconcile-sepay` cho tới Task 7 — đó là chủ ý; chạy lại ở Task 7 Step 9.)

- [ ] **Step 4: Chạy `cron-auth`, thấy PASS**

Run: `npm run test:unit -- tests/unit/server/cron-auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Viết integration test thất bại cho hết hạn + hủy có điều kiện**

`tests/integration/expire-payment-attempts.test.ts`:

```ts
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { orderEvents, orderPayments, orders, paymentAttempts, reconcileCheckpoints } from '../../server/db/schema'
import { cancelOrderIfStillUnpaid, expirePaymentAttempts } from '../../server/services/payments/expire-payment-attempts'
import { matchTransaction } from '../../server/services/payments/match-transaction'
import { recordBankTransaction } from '../../server/services/payments/record-bank-transaction'
import { createTenant } from '../support/fixtures'
import { bankTxInput, createAwaitingOrder, createPaymentSetup, type PaymentSetup } from '../support/webhook-fixtures'
import { resetDb } from '../support/db'

const db = () => getDb()
const NOW = new Date('2026-11-01T12:00:00.000Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000)

let setup: PaymentSetup

async function setCheckpoint(integrationId: string, lastSyncedAt: Date | null) {
  await db().insert(reconcileCheckpoints).values({ integrationId, lastSyncedAt })
}

async function orderRow(id: string) {
  return (await db().select().from(orders).where(eq(orders.id, id)))[0]!
}

async function oldOrder(opts: Parameters<typeof createAwaitingOrder>[1] = {}) {
  return createAwaitingOrder(setup, { createdAt: hoursAgo(30), attemptStatus: 'EXPIRED', expiresAt: hoursAgo(29), ...opts })
}

beforeEach(async () => {
  await resetDb()
  setup = await createPaymentSetup(await createTenant('a'), { apiToken: 'sepay-token' })
})
afterAll(async () => {
  await closeDb()
})

describe('expiring attempts', () => {
  it('expires only PENDING attempts whose time has passed and leaves the order alone', async () => {
    const past = await createAwaitingOrder(setup, { expiresAt: hoursAgo(1) })
    const future = await createAwaitingOrder(setup, { expiresAt: new Date(NOW.getTime() + 600_000) })
    const result = await expirePaymentAttempts(db(), NOW)
    expect(result.expiredAttempts).toBe(1)
    expect((await db().select().from(paymentAttempts).where(eq(paymentAttempts.id, past.attempt.id)))[0]!.status).toBe('EXPIRED')
    expect((await db().select().from(paymentAttempts).where(eq(paymentAttempts.id, future.attempt.id)))[0]!.status).toBe('PENDING')
    expect(await orderRow(past.order.id)).toMatchObject({ status: 'AWAITING_PAYMENT', paymentStatus: 'PENDING' })
  })

  it('is idempotent', async () => {
    await createAwaitingOrder(setup, { expiresAt: hoursAgo(1) })
    await expirePaymentAttempts(db(), NOW)
    expect(await expirePaymentAttempts(db(), NOW)).toEqual({ expiredAttempts: 0, cancelledOrders: 0 })
  })
})

describe('auto-cancel after 24 h needs a reconcile that ran after the last expiry', () => {
  it('cancels when the checkpoint is later than the last attempt expiry', async () => {
    const { order } = await oldOrder()
    await setCheckpoint(setup.integration.id, hoursAgo(2))
    expect(await expirePaymentAttempts(db(), NOW)).toMatchObject({ cancelledOrders: 1 })
    expect(await orderRow(order.id)).toMatchObject({ status: 'CANCELLED', paymentStatus: 'UNPAID' })
    const events = await db().select().from(orderEvents).where(eq(orderEvents.orderId, order.id))
    expect(events.find(e => e.eventType === 'AUTO_CANCELLED_UNPAID')).toMatchObject({ fromState: 'AWAITING_PAYMENT', toState: 'CANCELLED', actorUserId: null })
  })

  it.each([
    ['no reconcile has ever run', async () => {}],
    ['the last reconcile finished before the attempt expired', async () => setCheckpoint(setup.integration.id, hoursAgo(31))],
    ['the checkpoint row exists but never synced', async () => setCheckpoint(setup.integration.id, null)],
  ])('does not cancel when %s', async (_name, arrange) => {
    const { order } = await oldOrder()
    await arrange()
    expect(await expirePaymentAttempts(db(), NOW)).toMatchObject({ cancelledOrders: 0 })
    expect(await orderRow(order.id)).toMatchObject({ status: 'AWAITING_PAYMENT', paymentStatus: 'PENDING' })
  })

  it('never cancels automatically when the integration has no API token (manual reconciliation only)', async () => {
    const noApi = await createPaymentSetup(await createTenant('b'))
    const { order } = await createAwaitingOrder(noApi, { createdAt: hoursAgo(30), attemptStatus: 'EXPIRED', expiresAt: hoursAgo(29) })
    await setCheckpoint(noApi.integration.id, hoursAgo(2))
    await expirePaymentAttempts(db(), NOW)
    expect(await orderRow(order.id)).toMatchObject({ status: 'AWAITING_PAYMENT' })
  })

  it('does not cancel orders younger than 24 h, orders under review, or orders with a live attempt', async () => {
    await setCheckpoint(setup.integration.id, hoursAgo(2))
    const young = await createAwaitingOrder(setup, { createdAt: hoursAgo(5), attemptStatus: 'EXPIRED', expiresAt: hoursAgo(4) })
    const review = await oldOrder({ paymentStatus: 'REVIEW_REQUIRED' })
    const live = await createAwaitingOrder(setup, { createdAt: hoursAgo(30), expiresAt: new Date(NOW.getTime() + 600_000) })
    await expirePaymentAttempts(db(), NOW)
    for (const id of [young.order.id, review.order.id, live.order.id]) expect((await orderRow(id)).status).toBe('AWAITING_PAYMENT')
  })

  it('does not cancel while a RECEIVED transaction carrying the order code is still waiting to be matched', async () => {
    const { order, attempt } = await oldOrder()
    await setCheckpoint(setup.integration.id, hoursAgo(2))
    await recordBankTransaction(db(), bankTxInput(setup, { paymentCode: attempt.paymentCode }))
    await expirePaymentAttempts(db(), NOW)
    expect((await orderRow(order.id)).status).toBe('AWAITING_PAYMENT')
  })
})

describe('late money after an automatic cancel (Review Focus #3)', () => {
  it('is never lost: the order becomes REFUND_DUE and the transfer waits in review', async () => {
    const { order, attempt } = await oldOrder()
    await setCheckpoint(setup.integration.id, hoursAgo(2))
    await expirePaymentAttempts(db(), NOW)

    const received = await recordBankTransaction(db(), bankTxInput(setup, { paymentCode: attempt.paymentCode }))
    expect(await matchTransaction(db(), received.id)).toEqual({ kind: 'REVIEW', reason: 'ORDER_CANCELLED', orderId: order.id })
    expect(await orderRow(order.id)).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUND_DUE' })
  })

  it('cancel never overrides a payment that committed first', async () => {
    const { order, attempt } = await oldOrder()
    const received = await recordBankTransaction(db(), bankTxInput(setup, { paymentCode: attempt.paymentCode }))
    await matchTransaction(db(), received.id)
    expect(await cancelOrderIfStillUnpaid(db(), { id: order.id, orgId: setup.orgId, storeId: setup.storeId })).toBe(false)
    expect(await orderRow(order.id)).toMatchObject({ status: 'NEW', paymentStatus: 'PAID' })
  })

  it('cancel racing with a match keeps the invariant: paid once, or cancelled with the money in review', async () => {
    const { order, attempt } = await oldOrder()
    const received = await recordBankTransaction(db(), bankTxInput(setup, { paymentCode: attempt.paymentCode }))
    const target = { id: order.id, orgId: setup.orgId, storeId: setup.storeId }

    const [cancelled, outcome] = await Promise.all([cancelOrderIfStillUnpaid(db(), target), matchTransaction(db(), received.id)])

    const payments = await db().select().from(orderPayments).where(eq(orderPayments.orderId, order.id))
    const final = await orderRow(order.id)
    if (cancelled) {
      expect(payments).toHaveLength(0)
      expect(outcome).toEqual({ kind: 'REVIEW', reason: 'ORDER_CANCELLED', orderId: order.id })
      expect(final).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUND_DUE' })
    }
    else {
      expect(outcome).toMatchObject({ kind: 'MATCHED' })
      expect(payments).toHaveLength(1)
      expect(final).toMatchObject({ status: 'NEW', paymentStatus: 'PAID' })
    }
  })
})
```

- [ ] **Step 6: Chạy, thấy FAIL**

Run: `npm run test:integration -- tests/integration/expire-payment-attempts.test.ts`
Expected: FAIL (import không resolve).

- [ ] **Step 7: Cài đặt `expire-payment-attempts.ts`**

```ts
import { and, eq, lte, sql } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { orderEvents, orders, paymentAttempts } from '../../db/schema'

const STALE_AFTER_MS = 24 * 60 * 60 * 1000
const BATCH = 200

interface StaleOrderRow extends Record<string, unknown> {
  id: string
  org_id: string
  store_id: string
}

// Auto-cancel only when a reconcile has provably looked at the bank after the last attempt expired (spec §6.4).
// Integrations without an API token can never prove that, so those orders are left for the owner to cancel.
export async function cancelStaleAwaitingOrders(db: Db, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS).toISOString()
  const { rows } = await db.execute<StaleOrderRow>(sql`
    select o.id, o.org_id, o.store_id
    from orders o
    where o.status = 'AWAITING_PAYMENT'
      and o.payment_status = 'PENDING'
      and o.created_at < ${cutoff}::timestamptz
      and exists (
        select 1 from payment_attempts a
        join integration_accounts ia on ia.payment_account_id = a.account_id
        where a.order_id = o.id
      )
      and not exists (select 1 from payment_attempts a where a.order_id = o.id and a.status = 'PENDING')
      and not exists (
        select 1
        from bank_transactions b
        join payment_attempts a on a.payment_code = b.payment_code
        where a.order_id = o.id and b.reconciliation_status = 'RECEIVED'
      )
      and not exists (
        select 1
        from payment_attempts a
        join integration_accounts ia on ia.payment_account_id = a.account_id
        join sepay_integrations i on i.id = ia.integration_id
        left join reconcile_checkpoints c on c.integration_id = i.id
        where a.order_id = o.id
          and (
            i.encrypted_api_token is null
            or c.last_synced_at is null
            or c.last_synced_at <= (select max(x.expires_at) from payment_attempts x where x.order_id = o.id)
          )
      )
    order by o.created_at
    limit ${BATCH}`)

  let cancelled = 0
  for (const row of rows) {
    if (await cancelOrderIfStillUnpaid(db, { id: row.id, orgId: row.org_id, storeId: row.store_id })) cancelled++
  }
  return cancelled
}

// The conditional UPDATE is the arbiter against a concurrent match: whoever commits first wins, the other sees 0 rows
// (a match that loses sends the money to review and marks the order REFUND_DUE).
export async function cancelOrderIfStillUnpaid(db: Db, order: { id: string, orgId: string, storeId: string }): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx.update(orders)
      .set({ status: 'CANCELLED', paymentStatus: 'UNPAID' })
      .where(and(eq(orders.id, order.id), eq(orders.status, 'AWAITING_PAYMENT'), eq(orders.paymentStatus, 'PENDING')))
      .returning({ id: orders.id })
    if (updated.length === 0) return false
    await tx.insert(orderEvents).values({
      orgId: order.orgId,
      storeId: order.storeId,
      orderId: order.id,
      actorUserId: null,
      eventType: 'AUTO_CANCELLED_UNPAID',
      fromState: 'AWAITING_PAYMENT',
      toState: 'CANCELLED',
      metadata: { reason: 'PAYMENT_TIMEOUT' },
    })
    return true
  })
}

export async function expirePaymentAttempts(db: Db, now: Date): Promise<{ expiredAttempts: number, cancelledOrders: number }> {
  const expired = await db.update(paymentAttempts)
    .set({ status: 'EXPIRED' })
    .where(and(eq(paymentAttempts.status, 'PENDING'), lte(paymentAttempts.expiresAt, now)))
    .returning({ id: paymentAttempts.id })
  const cancelledOrders = await cancelStaleAwaitingOrders(db, now)
  return { expiredAttempts: expired.length, cancelledOrders }
}
```

- [ ] **Step 8: Tạo route cron**

`server/api/internal/expire-payment-attempts.ts`:

```ts
import { getDb } from '../../db/client'
import { expirePaymentAttempts } from '../../services/payments/expire-payment-attempts'
import { defineApiHandler } from '../../utils/api-handler'
import { assertCronRequest } from '../../utils/cron-auth'
import { logger } from '../../utils/logger'

export default defineApiHandler(async (event) => {
  assertCronRequest(event)
  const result = await expirePaymentAttempts(getDb(), new Date())
  logger.info('cron.expire_payment_attempts', result)
  return result
})
```

- [ ] **Step 9: Cấu hình `CRON_SECRET` cho test và CI**

Thêm một dòng vào `.env.test` (file bị `.gitignore`, mỗi dev tự thêm): `CRON_SECRET=test-cron-secret-0123456789abcdef`

`.github/workflows/ci.yml`, job `integration`, khối `env:` hiện là:

```yaml
    env:
      ZENO_TEST_DB: '1'
      APP_BASE_URL: http://localhost:3100
```

đổi thành:

```yaml
    env:
      ZENO_TEST_DB: '1'
      APP_BASE_URL: http://localhost:3100
      CRON_SECRET: ci-cron-secret-0123456789abcdef
```

Thêm biến `CRON_SECRET` (chuỗi ngẫu nhiên ≥ 32 ký tự, ví dụ `openssl rand -base64 32`) vào Vercel (Production + Preview). Vercel sẽ tự gửi `Authorization: Bearer <CRON_SECRET>` khi gọi cron (V11).

- [ ] **Step 10: Viết API test cho bảo vệ cron**

`tests/api/internal-cron.test.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { fetch, setup } from '@nuxt/test-utils/e2e'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../../server/db/client'
import { resetDb } from '../support/db'

await setup({
  rootDir: fileURLToPath(new URL('../..', import.meta.url)),
  server: true,
  build: true,
  nuxtConfig: { typescript: { typeCheck: false } },
})

const SECRET = process.env.CRON_SECRET!
const PATHS = ['/api/internal/expire-payment-attempts']

beforeEach(async () => {
  await resetDb()
})
afterAll(async () => {
  await closeDb()
})

describe('internal cron routes', () => {
  it('has CRON_SECRET configured for the test run', () => {
    expect(SECRET?.length).toBeGreaterThanOrEqual(16)
  })

  it.each(PATHS)('%s rejects missing and wrong credentials with 401', async (path) => {
    expect((await fetch(path)).status).toBe(401)
    expect((await fetch(path, { headers: { authorization: 'Bearer wrong-wrong-wrong-wrong' } })).status).toBe(401)
    expect((await fetch(path, { headers: { authorization: SECRET } })).status).toBe(401)
    expect((await fetch(path, { method: 'POST' })).status).toBe(401)
  })

  it.each(PATHS)('%s runs for GET (Vercel Cron) and POST with the right secret', async (path) => {
    const headers = { authorization: `Bearer ${SECRET}` }
    const get = await fetch(path, { headers })
    expect(get.status).toBe(200)
    expect(await get.json()).toMatchObject({ expiredAttempts: 0, cancelledOrders: 0 })
    expect((await fetch(path, { method: 'POST', headers })).status).toBe(200)
  })

  it.each(PATHS)('%s refuses other methods', async (path) => {
    const res = await fetch(path, { method: 'PUT', headers: { authorization: `Bearer ${SECRET}` } })
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 11: Chạy toàn bộ test của task**

Run: `npm run test:unit -- tests/unit/server/cron-auth.test.ts && npm run test:integration -- tests/integration/expire-payment-attempts.test.ts && npm run test:api -- tests/api/internal-cron.test.ts`
Expected: PASS (`vercel-crons.test.ts` chờ Task 7).

- [ ] **Step 12: Commit**

```bash
git add server/utils/cron-auth.ts server/services/payments/expire-payment-attempts.ts server/api/internal/expire-payment-attempts.ts vercel.json .github/workflows/ci.yml tests/unit/server/cron-auth.test.ts tests/unit/server/vercel-crons.test.ts tests/integration/expire-payment-attempts.test.ts tests/api/internal-cron.test.ts
git commit -m "feat(payment-webhook): add protected cron to expire attempts and cancel stale orders

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 7: Đối soát qua SePay API v2 (client, job, route)

**Files:**
- Create: `server/services/payments/sepay-client.ts`, `server/services/payments/reconcile-sepay.ts`, `server/api/internal/reconcile-sepay.ts`
- Modify: `tests/api/internal-cron.test.ts`
- Test: `tests/unit/server/sepay-client.test.ts`, `tests/integration/reconcile-sepay.test.ts`

**Interfaces:**
- Consumes: `recordBankTransaction` (Task 3), `matchTransaction` (Task 4), `extractPaymentCode`, `parseSepayTransactionDate` (Task 2), `assertCronRequest` (Task 6), `reconcileCheckpoints`, `sepayIntegrations` (`environment`), `integrationAccounts`, `storePaymentAccounts`, `bankTransactions` (Task 1/PR5), `loadIntegrationSecrets(db, integrationId): Promise<{ hmacSecret, apiToken } | null>` (PR5, đường duy nhất giải mã), `SepayEnvironment = 'test' | 'live'` (`#shared/payment`, PR5), `logger`.
- Produces:
  - `interface SepayApiTransaction { id: string, accountNumber: string, va: string | null, amountIn: number, amountOut: number, content: string | null, referenceNumber: string | null, code: string | null, transactionDate: Date, transferType: 'in' | 'out', raw: unknown }`.
  - `interface SepayTransactionsClient { list(args: { accountNumber: string, from: Date, to: Date, cursor?: string }): Promise<{ items: SepayApiTransaction[], nextCursor: string | null }> }` (đúng roadmap; `cursor` là số trang dạng chuỗi).
  - `class SepayApiError extends Error { kind: 'UNAUTHORIZED' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'BAD_RESPONSE' | 'TOO_MANY_PAGES', retryAfterSec?: number }`; `createSepayHttpClient(apiToken: string, opts?: { baseUrl?: string, fetchImpl?: typeof fetch }): SepayTransactionsClient`; `sepayApiBaseUrl(environment: 'test' | 'live'): string` (`live` → `https://userapi.sepay.vn`, `test` → `https://userapi-sandbox.sepay.vn`, V9); `formatSepayDate(date: Date): string`; hằng `AUTH_SCHEME = 'Bearer'` (U1/G2).
  - `reconcileSepay(db: Db, deps: { createClient: (apiToken: string, environment: 'test' | 'live') => SepayTransactionsClient, now: () => Date, sleep: (ms: number) => Promise<void>, match?: (db: Db, id: string) => Promise<MatchOutcome> }): Promise<{ rematched: number, imported: number, duplicates: number, integrations: { id: string, ok: boolean, error?: string }[] }>`; hằng `RECONCILE_OVERLAP_MS = 30 * 60_000`, `RECONCILE_SETTLE_MS = 2 * 60_000`.
  - Hành vi: (1) match lại mọi `bank_transactions` còn `RECEIVED` quá 30 s; (2) mỗi integration `TESTING|ACTIVE` có API token: lấy giao dịch tiền vào trong `[checkpoint − 30 phút, now − 2 phút]` cho từng tài khoản liên kết, phân trang 100, nghỉ 400 ms giữa các trang (rate limit 3 req/s, V9); (3) chỉ khi **toàn bộ** thành công mới đẩy `last_synced_at = now − 2 phút`; lỗi → ghi `last_error`, **không** đẩy checkpoint, các integration khác vẫn chạy.
  - `GET|POST /api/internal/reconcile-sepay` → `200` với summary trên.

- [ ] **Step 1: Viết unit test thất bại cho client HTTP**

`tests/unit/server/sepay-client.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createSepayHttpClient, formatSepayDate, sepayApiBaseUrl, SepayApiError } from '../../../server/services/payments/sepay-client'

const item = (over: Record<string, unknown> = {}) => ({
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  transaction_date: '2026-03-18T09:00:00+07:00',
  account_number: '19028745631',
  va: null,
  amount_in: 500000,
  amount_out: 0,
  accumulated: 1500000,
  transaction_content: 'ZO1A2B3C4D chuyen tien',
  reference_number: 'FT26069ABC',
  code: 'ZO1A2B3C4D',
  bank_brand_name: 'ACB',
  transfer_type: 'in',
  ...over,
})

function page(data: unknown[], hasMore = false, current = 1) {
  return { status: 'success', data, meta: { pagination: { total: data.length, per_page: 100, current_page: current, last_page: current, has_more: hasMore } } }
}

function fakeFetch(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: URL, init: RequestInit }[] = []
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push({ url, init: init ?? {} })
    return handler(url, init ?? {})
  }) as typeof fetch
  return { impl, calls }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

const WINDOW = { accountNumber: '19028745631', from: new Date('2026-11-01T02:00:00.000Z'), to: new Date('2026-11-01T03:00:00.000Z') }

describe('formatSepayDate', () => {
  it('formats in Vietnam time (UTC+7) as YYYY-MM-DD HH:mm:ss', () => {
    expect(formatSepayDate(new Date('2026-11-01T02:00:00.000Z'))).toBe('2026-11-01 09:00:00')
    expect(formatSepayDate(new Date('2026-11-01T18:30:05.000Z'))).toBe('2026-11-02 01:30:05')
  })
})

describe('sepayApiBaseUrl', () => {
  it('sends Test-mode integrations to the sandbox host (their tokens only work there)', () => {
    expect(sepayApiBaseUrl('live')).toBe('https://userapi.sepay.vn')
    expect(sepayApiBaseUrl('test')).toBe('https://userapi-sandbox.sepay.vn')
  })
})

describe('createSepayHttpClient', () => {
  it('requests incoming transactions of the window, oldest first, with the documented parameters', async () => {
    const { impl, calls } = fakeFetch(() => json(page([item()])))
    const client = createSepayHttpClient('tok-123', { fetchImpl: impl })
    await client.list(WINDOW)

    const { url, init } = calls[0]!
    expect(url.origin + url.pathname).toBe('https://userapi.sepay.vn/v2/transactions')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      transaction_date_from: '2026-11-01 09:00:00',
      transaction_date_to: '2026-11-01 10:00:00',
      transfer_type: 'in',
      transaction_date_sort: 'asc',
      per_page: '100',
      page: '1',
      timestamp_format: 'iso8601',
    })
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok-123')
  })

  it('maps rows, keeps the raw row, and returns the next page cursor while has_more', async () => {
    const { impl } = fakeFetch(() => json(page([item()], true, 2)))
    const result = await createSepayHttpClient('t', { fetchImpl: impl }).list({ ...WINDOW, cursor: '2' })
    expect(result.nextCursor).toBe('3')
    expect(result.items[0]).toMatchObject({
      id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      accountNumber: '19028745631',
      va: null,
      amountIn: 500000,
      referenceNumber: 'FT26069ABC',
      code: 'ZO1A2B3C4D',
      transferType: 'in',
    })
    expect(result.items[0]!.transactionDate.toISOString()).toBe('2026-03-18T02:00:00.000Z')
    expect(result.items[0]!.raw).toMatchObject({ bank_brand_name: 'ACB' })
  })

  it('returns nextCursor null on the last page', async () => {
    const { impl } = fakeFetch(() => json(page([item()], false)))
    expect((await createSepayHttpClient('t', { fetchImpl: impl }).list(WINDOW)).nextCursor).toBeNull()
  })

  it('keeps only rows of the requested account (account_number or VA) and tolerates plain-format dates', async () => {
    const rows = [
      item({ id: 'u1' }),
      item({ id: 'u2', account_number: 'OTHER' }),
      item({ id: 'u3', account_number: 'MAIN', va: '19028745631', transaction_date: '2026-03-18 09:00:00' }),
    ]
    const { impl } = fakeFetch(() => json(page(rows)))
    const { items } = await createSepayHttpClient('t', { fetchImpl: impl }).list(WINDOW)
    expect(items.map(i => i.id)).toEqual(['u1', 'u3'])
    expect(items[1]!.transactionDate.toISOString()).toBe('2026-03-18T02:00:00.000Z')
  })

  it.each([
    [401, 'UNAUTHORIZED'],
    [429, 'RATE_LIMITED'],
    [500, 'UNAVAILABLE'],
    [503, 'UNAVAILABLE'],
    [418, 'BAD_RESPONSE'],
  ] as const)('maps HTTP %i to %s', async (status, kind) => {
    const { impl } = fakeFetch(() => json({ status: 'error' }, status, { 'retry-after': '2' }))
    await expect(createSepayHttpClient('t', { fetchImpl: impl }).list(WINDOW)).rejects.toMatchObject({ kind })
  })

  it('exposes Retry-After on 429', async () => {
    const { impl } = fakeFetch(() => json({}, 429, { 'retry-after': '2' }))
    await expect(createSepayHttpClient('t', { fetchImpl: impl }).list(WINDOW)).rejects.toMatchObject({ retryAfterSec: 2 })
  })

  it('maps network failures and malformed bodies', async () => {
    const down = createSepayHttpClient('t', { fetchImpl: (async () => { throw new TypeError('fetch failed') }) as typeof fetch })
    await expect(down.list(WINDOW)).rejects.toMatchObject({ kind: 'UNAVAILABLE' })
    const garbage = fakeFetch(() => json({ nope: true }))
    await expect(createSepayHttpClient('t', { fetchImpl: garbage.impl }).list(WINDOW)).rejects.toBeInstanceOf(SepayApiError)
  })

  it('never puts the token in an error message', async () => {
    const { impl } = fakeFetch(() => json({}, 401))
    const err = await createSepayHttpClient('super-secret-token', { fetchImpl: impl }).list(WINDOW).catch((e: Error) => e)
    expect((err as Error).message).not.toContain('super-secret-token')
  })
})
```

- [ ] **Step 2: Chạy, thấy FAIL**

Run: `npm run test:unit -- tests/unit/server/sepay-client.test.ts`
Expected: FAIL (không resolve `sepay-client`).

- [ ] **Step 3: Cài đặt `sepay-client.ts`**

```ts
import { z } from 'zod'
import { parseSepayTransactionDate } from './sepay-payload'

export interface SepayApiTransaction {
  id: string
  accountNumber: string
  va: string | null
  amountIn: number
  amountOut: number
  content: string | null
  referenceNumber: string | null
  code: string | null
  transactionDate: Date
  transferType: 'in' | 'out'
  raw: unknown
}

export interface SepayTransactionsClient {
  list(args: { accountNumber: string, from: Date, to: Date, cursor?: string }): Promise<{ items: SepayApiTransaction[], nextCursor: string | null }>
}

export type SepayApiErrorKind = 'UNAUTHORIZED' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'BAD_RESPONSE' | 'TOO_MANY_PAGES'

export class SepayApiError extends Error {
  constructor(public readonly kind: SepayApiErrorKind, public readonly retryAfterSec?: number) {
    super(`SePay API ${kind}`)
    this.name = 'SepayApiError'
  }
}

export const SEPAY_API_BASE_URL = 'https://userapi.sepay.vn'
export const SEPAY_SANDBOX_API_BASE_URL = 'https://userapi-sandbox.sepay.vn'
// Docs show the scheme masked; Bearer is expected and confirmed by gate G2 (Task 0).
export const AUTH_SCHEME = 'Bearer'
const PAGE_SIZE = 100
const REQUEST_TIMEOUT_MS = 15_000

export function sepayApiBaseUrl(environment: 'test' | 'live'): string {
  return environment === 'test' ? SEPAY_SANDBOX_API_BASE_URL : SEPAY_API_BASE_URL
}

export function formatSepayDate(date: Date): string {
  return new Date(date.getTime() + 7 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ')
}

function parseApiDate(value: string): Date {
  const date = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? parseSepayTransactionDate(value) : new Date(value)
  if (Number.isNaN(date.getTime())) throw new SepayApiError('BAD_RESPONSE')
  return date
}

const rowSchema = z.looseObject({
  id: z.string().min(1),
  transaction_date: z.string(),
  account_number: z.string(),
  va: z.string().nullish(),
  amount_in: z.coerce.number(),
  amount_out: z.coerce.number(),
  transaction_content: z.string().nullish(),
  reference_number: z.string().nullish(),
  code: z.string().nullish(),
  transfer_type: z.enum(['in', 'out']),
})

const pageSchema = z.object({
  data: z.array(rowSchema),
  meta: z.object({ pagination: z.object({ has_more: z.boolean(), current_page: z.number().int() }) }),
})

export function createSepayHttpClient(
  apiToken: string,
  opts: { baseUrl?: string, fetchImpl?: typeof fetch } = {},
): SepayTransactionsClient {
  const baseUrl = opts.baseUrl ?? SEPAY_API_BASE_URL
  const fetchImpl = opts.fetchImpl ?? fetch

  return {
    async list({ accountNumber, from, to, cursor }) {
      const page = cursor ? Number(cursor) : 1
      const url = new URL('/v2/transactions', baseUrl)
      url.search = new URLSearchParams({
        transaction_date_from: formatSepayDate(from),
        transaction_date_to: formatSepayDate(to),
        transfer_type: 'in',
        transaction_date_sort: 'asc',
        per_page: String(PAGE_SIZE),
        page: String(page),
        timestamp_format: 'iso8601',
      }).toString()

      let res: Response
      try {
        res = await fetchImpl(url, {
          headers: { authorization: `${AUTH_SCHEME} ${apiToken}`, 'content-type': 'application/json' },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
      }
      catch {
        throw new SepayApiError('UNAVAILABLE')
      }
      if (res.status === 401) throw new SepayApiError('UNAUTHORIZED')
      if (res.status === 429) throw new SepayApiError('RATE_LIMITED', Number(res.headers.get('retry-after')) || undefined)
      if (res.status >= 500) throw new SepayApiError('UNAVAILABLE')
      if (!res.ok) throw new SepayApiError('BAD_RESPONSE')

      const parsed = pageSchema.safeParse(await res.json().catch(() => null))
      if (!parsed.success) throw new SepayApiError('BAD_RESPONSE')

      const items = parsed.data.data
        .filter(row => row.account_number === accountNumber || row.va === accountNumber)
        .map((row): SepayApiTransaction => ({
          id: row.id,
          accountNumber: row.account_number,
          va: row.va ?? null,
          amountIn: row.amount_in,
          amountOut: row.amount_out,
          content: row.transaction_content ?? null,
          referenceNumber: row.reference_number ?? null,
          code: row.code ?? null,
          transactionDate: parseApiDate(row.transaction_date),
          transferType: row.transfer_type,
          raw: row,
        }))
      return { items, nextCursor: parsed.data.meta.pagination.has_more ? String(page + 1) : null }
    },
  }
}
```

- [ ] **Step 4: Chạy, thấy PASS**

Run: `npm run test:unit -- tests/unit/server/sepay-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Viết integration test thất bại cho job đối soát**

`tests/integration/reconcile-sepay.test.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { bankTransactions, orderPayments, orders, reconcileCheckpoints } from '../../server/db/schema'
import { processSepayWebhook } from '../../server/services/payments/process-sepay-webhook'
import { reconcileSepay, RECONCILE_OVERLAP_MS, RECONCILE_SETTLE_MS } from '../../server/services/payments/reconcile-sepay'
import { recordBankTransaction } from '../../server/services/payments/record-bank-transaction'
import { sepayWebhookPayloadSchema } from '../../server/services/payments/sepay-payload'
import { SepayApiError, type SepayApiTransaction, type SepayTransactionsClient } from '../../server/services/payments/sepay-client'
import { createTenant } from '../support/fixtures'
import { bankTxInput, createAwaitingOrder, createPaymentSetup, sepayPayload, type PaymentSetup } from '../support/webhook-fixtures'
import { resetDb } from '../support/db'

const db = () => getDb()
const NOW = new Date('2026-11-01T12:00:00.000Z')
const noSleep = async () => {}

let setup: PaymentSetup

function apiTx(over: Partial<SepayApiTransaction> = {}): SepayApiTransaction {
  return {
    id: randomUUID(),
    accountNumber: setup.account.accountNumber,
    va: null,
    amountIn: 55_000,
    amountOut: 0,
    content: 'thanh toan',
    referenceNumber: `FT${randomUUID().slice(0, 10)}`,
    code: null,
    transactionDate: new Date('2026-11-01T11:30:00.000Z'),
    transferType: 'in',
    raw: { fixture: true },
    ...over,
  }
}

function fakeClient(items: SepayApiTransaction[], opts: { pageSize?: number, fail?: SepayApiError, endless?: boolean } = {}) {
  const calls: Parameters<SepayTransactionsClient['list']>[0][] = []
  const client: SepayTransactionsClient = {
    async list(args) {
      calls.push(args)
      if (opts.fail) throw opts.fail
      const size = opts.pageSize ?? 100
      const start = args.cursor ? Number(args.cursor) : 0
      const slice = items.slice(start, start + size)
      const more = opts.endless || start + size < items.length
      return { items: slice, nextCursor: more ? String(start + size) : null }
    },
  }
  return { client, calls }
}

const run = (client: SepayTransactionsClient, extra: Partial<Parameters<typeof reconcileSepay>[1]> = {}) =>
  reconcileSepay(db(), { createClient: () => client, now: () => NOW, sleep: noSleep, ...extra })

const bankRows = () => db().select().from(bankTransactions).where(eq(bankTransactions.integrationId, setup.integration.id))
const paymentsOf = (orderId: string) => db().select().from(orderPayments).where(eq(orderPayments.orderId, orderId))
const checkpoint = async () => (await db().select().from(reconcileCheckpoints).where(eq(reconcileCheckpoints.integrationId, setup.integration.id)))[0]

beforeEach(async () => {
  await resetDb()
  setup = await createPaymentSetup(await createTenant('a'), { apiToken: 'sepay-token' })
})
afterAll(async () => {
  await closeDb()
})

describe('recovering a lost webhook (Review Focus #4)', () => {
  it('imports the missing transfer and confirms the order', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { amountVnd: 55_000 })
    const { client } = fakeClient([apiTx({ code: attempt.paymentCode })])
    const summary = await run(client)
    expect(summary).toMatchObject({ imported: 1, duplicates: 0, integrations: [{ id: setup.integration.id, ok: true }] })
    expect(await paymentsOf(order.id)).toHaveLength(1)
    expect((await bankRows())[0]).toMatchObject({ source: 'RECONCILE', reconciliationStatus: 'MATCHED' })
  })

  it('finds the order code in the content when the API row has code null', async () => {
    const { order, attempt } = await createAwaitingOrder(setup)
    await run(fakeClient([apiTx({ code: null, content: `ck ${attempt.paymentCode}` })]).client)
    expect(await paymentsOf(order.id)).toHaveLength(1)
  })

  it('does not credit a transfer the webhook already delivered (UUID id vs integer id)', async () => {
    const { order, attempt } = await createAwaitingOrder(setup)
    const payload = sepayWebhookPayloadSchema.parse(sepayPayload(setup, { id: 4242, code: attempt.paymentCode, referenceCode: 'FT-SAME', transactionDate: '2026-11-01 18:30:00' }))
    await processSepayWebhook(db(), { integration: { id: setup.integration.id, orgId: setup.orgId }, payload })

    const row = apiTx({ code: attempt.paymentCode, referenceNumber: 'FT-SAME', transactionDate: new Date('2026-11-01T11:30:00.000Z') })
    const summary = await run(fakeClient([row]).client)

    expect(summary).toMatchObject({ imported: 0, duplicates: 1 })
    expect(await paymentsOf(order.id)).toHaveLength(1)
    const rows = await bankRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.providerAltIds).toEqual([row.id])
  })

  it('is idempotent across runs and a later webhook replay is still a no-op', async () => {
    const { order, attempt } = await createAwaitingOrder(setup)
    const row = apiTx({ code: attempt.paymentCode, referenceNumber: 'FT-LATE' })
    const { client } = fakeClient([row])
    await run(client)
    await run(client)
    expect(await paymentsOf(order.id)).toHaveLength(1)

    const replay = sepayWebhookPayloadSchema.parse(sepayPayload(setup, { id: 99, code: attempt.paymentCode, referenceCode: 'FT-LATE', transactionDate: '2026-11-01 18:30:00' }))
    const result = await processSepayWebhook(db(), { integration: { id: setup.integration.id, orgId: setup.orgId }, payload: replay })
    expect(result.created).toBe(false)
    expect(await paymentsOf(order.id)).toHaveLength(1)
    expect(await bankRows()).toHaveLength(1)
  })

  it('matches again a transaction stuck in RECEIVED after a failed Tx2', async () => {
    const { order, attempt } = await createAwaitingOrder(setup)
    const stuck = await recordBankTransaction(db(), bankTxInput(setup, { paymentCode: attempt.paymentCode }))
    await db().update(bankTransactions).set({ receivedAt: new Date(NOW.getTime() - 5 * 60_000) }).where(eq(bankTransactions.id, stuck.id))
    const summary = await run(fakeClient([]).client)
    expect(summary.rematched).toBe(1)
    expect(await paymentsOf(order.id)).toHaveLength(1)
  })

  it('leaves very fresh RECEIVED rows to the webhook that is still processing them', async () => {
    const { attempt } = await createAwaitingOrder(setup)
    await recordBankTransaction(db(), bankTxInput(setup, { paymentCode: attempt.paymentCode }))
    expect((await run(fakeClient([]).client)).rematched).toBe(0)
  })
})

describe('what gets imported', () => {
  it('skips outgoing rows and zero amounts', async () => {
    const { client } = fakeClient([apiTx({ transferType: 'out', amountIn: 0, amountOut: 10_000 }), apiTx({ amountIn: 0 }), apiTx()])
    expect(await run(client)).toMatchObject({ imported: 1 })
    expect(await bankRows()).toHaveLength(1)
  })

  it('unknown or code-less transfers are stored for review, not dropped', async () => {
    await run(fakeClient([apiTx({ code: null, content: 'ck' }), apiTx({ code: 'ZOUNKNOWN1' })]).client)
    const rows = await bankRows()
    expect(rows.map(r => r.reviewReason).sort()).toEqual(['NO_CODE', 'UNKNOWN_CODE'])
  })

  it('ignores DISABLED integrations and integrations without an API token', async () => {
    await createPaymentSetup(await createTenant('b'))
    await createPaymentSetup(await createTenant('c'), { apiToken: 'x', status: 'DISABLED' })
    const createClient = vi.fn(() => fakeClient([]).client)
    const summary = await reconcileSepay(db(), { createClient, now: () => NOW, sleep: noSleep })
    expect(summary.integrations.map(i => i.id)).toEqual([setup.integration.id])
    expect(createClient).toHaveBeenCalledTimes(1)
    expect(createClient).toHaveBeenCalledWith('sepay-token', 'live')
  })

  it('pages through results and pauses between pages', async () => {
    const sleep = vi.fn(async () => {})
    const { client, calls } = fakeClient([apiTx(), apiTx(), apiTx()], { pageSize: 1 })
    expect(await run(client, { sleep })).toMatchObject({ imported: 3 })
    expect(calls.map(c => c.cursor)).toEqual([undefined, '1', '2'])
    expect(sleep).toHaveBeenCalledTimes(2)
  })
})

describe('checkpoint', () => {
  it('advances to now − settle after a successful run and uses a 30-minute overlap next time', async () => {
    const first = fakeClient([])
    await run(first.client)
    const settled = new Date(NOW.getTime() - RECONCILE_SETTLE_MS)
    expect((await checkpoint())!.lastSyncedAt).toEqual(settled)
    expect(first.calls[0]!.to).toEqual(settled)
    expect(first.calls[0]!.from).toEqual(new Date(NOW.getTime() - 24 * 3_600_000 - RECONCILE_OVERLAP_MS))

    const later = new Date(NOW.getTime() + 15 * 60_000)
    const second = fakeClient([])
    await run(second.client, { now: () => later })
    expect(second.calls[0]!.from).toEqual(new Date(settled.getTime() - RECONCILE_OVERLAP_MS))
  })

  it('does not advance on failure, records the error, and still processes other integrations', async () => {
    const good = await createPaymentSetup(await createTenant('g'), { apiToken: 'tok-good' })
    await db().insert(reconcileCheckpoints).values({ integrationId: setup.integration.id, lastSyncedAt: new Date('2026-11-01T10:00:00.000Z') })

    const failing = fakeClient([], { fail: new SepayApiError('RATE_LIMITED', 2) })
    const ok = fakeClient([])
    const summary = await reconcileSepay(db(), {
      createClient: token => (token === 'sepay-token' ? failing.client : ok.client),
      now: () => NOW,
      sleep: noSleep,
    })

    expect(summary.integrations.find(i => i.id === setup.integration.id)).toEqual({ id: setup.integration.id, ok: false, error: 'RATE_LIMITED' })
    expect(summary.integrations.find(i => i.id === good.integration.id)).toEqual({ id: good.integration.id, ok: true })
    const row = (await checkpoint())!
    expect(row.lastSyncedAt).toEqual(new Date('2026-11-01T10:00:00.000Z'))
    expect(row.lastError).toBe('RATE_LIMITED')
  })

  it('treats a runaway pagination as a failure instead of looping forever', async () => {
    const { client } = fakeClient([apiTx()], { endless: true })
    const summary = await run(client)
    expect(summary.integrations[0]).toMatchObject({ ok: false, error: 'TOO_MANY_PAGES' })
    expect(await checkpoint()).toMatchObject({ lastError: 'TOO_MANY_PAGES' })
  })

  it('late money found by reconcile for an auto-cancelled order goes to review, not to the void', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { orderStatus: 'CANCELLED', paymentStatus: 'UNPAID', attemptStatus: 'EXPIRED' })
    await run(fakeClient([apiTx({ code: attempt.paymentCode })]).client)
    expect((await db().select().from(orders).where(eq(orders.id, order.id)))[0]).toMatchObject({ paymentStatus: 'REFUND_DUE' })
    expect((await bankRows())[0]).toMatchObject({ reconciliationStatus: 'REVIEW_REQUIRED', reviewReason: 'ORDER_CANCELLED' })
  })
})
```

- [ ] **Step 6: Chạy, thấy FAIL**

Run: `npm run test:integration -- tests/integration/reconcile-sepay.test.ts`
Expected: FAIL (không resolve `reconcile-sepay`).

- [ ] **Step 7: Cài đặt `reconcile-sepay.ts`**

```ts
import { and, asc, eq, inArray, isNotNull, lt } from 'drizzle-orm'
import type { Db } from '../../db/client'
import {
  bankTransactions, integrationAccounts, reconcileCheckpoints, sepayIntegrations, storePaymentAccounts,
} from '../../db/schema'
import { logger } from '../../utils/logger'
import { loadIntegrationSecrets } from './integration-secrets'
import { matchTransaction } from './match-transaction'
import { recordBankTransaction } from './record-bank-transaction'
import { extractPaymentCode } from './sepay-payload'
import { SepayApiError, type SepayTransactionsClient } from './sepay-client'
import type { MatchOutcome } from './types'

export const RECONCILE_OVERLAP_MS = 30 * 60_000
export const RECONCILE_SETTLE_MS = 2 * 60_000
const FIRST_RUN_LOOKBACK_MS = 24 * 3_600_000
const REMATCH_AFTER_MS = 30_000
const REMATCH_BATCH = 200
const MAX_PAGES_PER_ACCOUNT = 20
const PAGE_PAUSE_MS = 400

export interface ReconcileDeps {
  createClient: (apiToken: string, environment: 'test' | 'live') => SepayTransactionsClient
  now: () => Date
  sleep: (ms: number) => Promise<void>
  match?: (db: Db, bankTransactionId: string) => Promise<MatchOutcome>
}

export interface ReconcileSummary {
  rematched: number
  imported: number
  duplicates: number
  integrations: { id: string, ok: boolean, error?: string }[]
}

type Matcher = NonNullable<ReconcileDeps['match']>
interface IntegrationRow { id: string, orgId: string, environment: 'test' | 'live' }

async function rematchPending(db: Db, now: Date, match: Matcher): Promise<number> {
  const pending = await db.select({ id: bankTransactions.id }).from(bankTransactions)
    .where(and(
      eq(bankTransactions.reconciliationStatus, 'RECEIVED'),
      lt(bankTransactions.receivedAt, new Date(now.getTime() - REMATCH_AFTER_MS)),
    ))
    .orderBy(asc(bankTransactions.receivedAt))
    .limit(REMATCH_BATCH)
  let done = 0
  for (const { id } of pending) {
    try {
      await match(db, id)
      done++
    }
    catch {
      logger.error('reconcile.rematch_failed', { transactionId: id })
    }
  }
  return done
}

async function reconcileIntegration(db: Db, deps: ReconcileDeps, match: Matcher, integration: IntegrationRow) {
  const now = deps.now()
  const to = new Date(now.getTime() - RECONCILE_SETTLE_MS)
  const [checkpoint] = await db.select().from(reconcileCheckpoints).where(eq(reconcileCheckpoints.integrationId, integration.id))
  const base = checkpoint?.lastSyncedAt?.getTime() ?? now.getTime() - FIRST_RUN_LOOKBACK_MS
  const from = new Date(base - RECONCILE_OVERLAP_MS)

  const accounts = await db.selectDistinct({ accountNumber: storePaymentAccounts.accountNumber })
    .from(integrationAccounts)
    .innerJoin(storePaymentAccounts, eq(storePaymentAccounts.id, integrationAccounts.paymentAccountId))
    .where(eq(integrationAccounts.integrationId, integration.id))

  const secrets = await loadIntegrationSecrets(db, integration.id)
  if (!secrets?.apiToken) throw new SepayApiError('UNAUTHORIZED')
  const client = deps.createClient(secrets.apiToken, integration.environment)
  let imported = 0
  let duplicates = 0

  for (const { accountNumber } of accounts) {
    let cursor: string | undefined
    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES_PER_ACCOUNT) throw new SepayApiError('TOO_MANY_PAGES')
      const result = await client.list({ accountNumber, from, to, cursor })
      for (const item of result.items) {
        if (item.transferType !== 'in' || item.amountIn <= 0) continue
        const record = await recordBankTransaction(db, {
          orgId: integration.orgId,
          integrationId: integration.id,
          providerTransactionId: item.id,
          source: 'RECONCILE',
          direction: 'IN',
          bankAccountNumber: item.accountNumber,
          subAccount: item.va,
          amountVnd: item.amountIn,
          paymentCode: extractPaymentCode(item.code, item.content),
          content: item.content,
          referenceCode: item.referenceNumber || null,
          transactionDate: item.transactionDate,
          rawPayload: item.raw,
        })
        if (record.created) imported++
        else duplicates++
        if (record.status === 'RECEIVED') await match(db, record.id)
      }
      if (!result.nextCursor) break
      cursor = result.nextCursor
      await deps.sleep(PAGE_PAUSE_MS)
    }
  }

  await db.insert(reconcileCheckpoints)
    .values({ integrationId: integration.id, lastSyncedAt: to, lastRunAt: now, lastError: null })
    .onConflictDoUpdate({ target: reconcileCheckpoints.integrationId, set: { lastSyncedAt: to, lastRunAt: now, lastError: null } })
  return { imported, duplicates }
}

async function recordFailure(db: Db, integrationId: string, kind: string, now: Date): Promise<void> {
  await db.insert(reconcileCheckpoints)
    .values({ integrationId, lastRunAt: now, lastError: kind })
    .onConflictDoUpdate({ target: reconcileCheckpoints.integrationId, set: { lastRunAt: now, lastError: kind } })
}

export async function reconcileSepay(db: Db, deps: ReconcileDeps): Promise<ReconcileSummary> {
  const match = deps.match ?? matchTransaction
  const summary: ReconcileSummary = { rematched: 0, imported: 0, duplicates: 0, integrations: [] }
  summary.rematched = await rematchPending(db, deps.now(), match)

  const integrations = await db
    .select({ id: sepayIntegrations.id, orgId: sepayIntegrations.orgId, environment: sepayIntegrations.environment })
    .from(sepayIntegrations)
    .where(and(inArray(sepayIntegrations.status, ['TESTING', 'ACTIVE']), isNotNull(sepayIntegrations.encryptedApiToken)))

  for (const integration of integrations) {
    try {
      const counts = await reconcileIntegration(db, deps, match, integration)
      summary.imported += counts.imported
      summary.duplicates += counts.duplicates
      summary.integrations.push({ id: integration.id, ok: true })
    }
    catch (err) {
      const kind = err instanceof SepayApiError ? err.kind : 'UNEXPECTED'
      logger.error('reconcile.integration_failed', { integrationId: integration.id, kind })
      await recordFailure(db, integration.id, kind, deps.now())
      summary.integrations.push({ id: integration.id, ok: false, error: kind })
    }
  }
  return summary
}
```

- [ ] **Step 8: Tạo route**

`server/api/internal/reconcile-sepay.ts`:

```ts
import { getDb } from '../../db/client'
import { reconcileSepay } from '../../services/payments/reconcile-sepay'
import { createSepayHttpClient, sepayApiBaseUrl } from '../../services/payments/sepay-client'
import { defineApiHandler } from '../../utils/api-handler'
import { assertCronRequest } from '../../utils/cron-auth'
import { logger } from '../../utils/logger'

export default defineApiHandler(async (event) => {
  assertCronRequest(event)
  const summary = await reconcileSepay(getDb(), {
    createClient: (token, environment) => createSepayHttpClient(token, { baseUrl: sepayApiBaseUrl(environment) }),
    now: () => new Date(),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  })
  logger.info('cron.reconcile_sepay', {
    rematched: summary.rematched,
    imported: summary.imported,
    duplicates: summary.duplicates,
    failedIntegrations: summary.integrations.filter(i => !i.ok).length,
  })
  return summary
})
```

Cập nhật `tests/api/internal-cron.test.ts` (Task 6): đổi `PATHS` và kỳ vọng theo route:

```ts
const EXPECTED: Record<string, Record<string, unknown>> = {
  '/api/internal/expire-payment-attempts': { expiredAttempts: 0, cancelledOrders: 0 },
  '/api/internal/reconcile-sepay': { rematched: 0, imported: 0, duplicates: 0, integrations: [] },
}
const PATHS = Object.keys(EXPECTED)
```

và trong test `runs for GET (Vercel Cron) and POST` thay `toMatchObject({ expiredAttempts: 0, cancelledOrders: 0 })` bằng `toMatchObject(EXPECTED[path]!)`.

- [ ] **Step 9: Chạy các test của task**

Run: `npm run test:unit -- tests/unit/server/sepay-client.test.ts tests/unit/server/vercel-crons.test.ts && npm run test:integration -- tests/integration/reconcile-sepay.test.ts && npm run test:api -- tests/api/internal-cron.test.ts`
Expected: PASS (`vercel-crons.test.ts` giờ xanh vì cả hai route đã tồn tại).

- [ ] **Step 10: Commit**

```bash
git add server/services/payments/sepay-client.ts server/services/payments/reconcile-sepay.ts server/api/internal/reconcile-sepay.ts tests/unit/server/sepay-client.test.ts tests/integration/reconcile-sepay.test.ts tests/api/internal-cron.test.ts
git commit -m "feat(payment-webhook): reconcile missed SePay transactions without double credit

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 8: Hàng đợi review — liệt kê, gán vào đơn, bỏ qua/hoàn (API owner + ma trận tenant)

**Files:**
- Create: `shared/schemas/reconciliation.ts`, `shared/types/reconciliation.ts`, `server/services/payments/review-queue.ts`, `server/api/stores/[storeId]/reconciliation/index.get.ts`, `server/api/stores/[storeId]/reconciliation/[txId]/assign.post.ts`, `server/api/stores/[storeId]/reconciliation/[txId]/resolve.post.ts`
- Modify: `tests/api/tenant-isolation.test.ts`
- Test: `tests/unit/shared/reconciliation-schemas.test.ts`, `tests/integration/review-queue.test.ts`

**Interfaces:**
- Consumes: `lockOrderGraph`, `confirmOrderPayment` (Task 4); `bankTransactions`, `bankTransactionEvents` (Task 1); `orders`, `orderEvents`, `orderPayments`; `requireStoreOwner` (PR1) → `StoreContext { orgId, storeId, role, userId }`; `AppError`; `parseBody`, `parseQuery`.
- Produces:
  - `shared/schemas/reconciliation.ts`: `reviewListQuerySchema` (`{ status: 'REVIEW_REQUIRED' | 'RESOLVED' }`, mặc định `REVIEW_REQUIRED`), `assignInputSchema` (`{ orderId: uuid, acceptAmountDifference: boolean = false }`), `resolveInputSchema` (`{ resolution: Resolution, note?: string }`, `OTHER` bắt buộc note ≥ 3 ký tự), `noteInputSchema` (`{ note: string 3–300 }`), `bankManualInputSchema` (`{ method: 'BANK_MANUAL', expectedPaymentStatus: 'PENDING' | 'REVIEW_REQUIRED', note }`).
  - `shared/types/reconciliation.ts`: `OrderBrief`, `ReviewItem`, `RefundDueOrder`, `OverdueOrder`, `ReconciliationSummary`.
  - `listReviewItems(db: Db, ctx: { orgId: string }, status: 'REVIEW_REQUIRED' | 'RESOLVED'): Promise<ReviewItem[]>` (REVIEW tối đa 100, RESOLVED 30 mới nhất; mỗi item có `suggestedOrders` ≤ 3: đơn đã khớp mã + đơn `AWAITING_PAYMENT` cùng org có `totalVnd` đúng bằng số tiền).
  - `assignTransactionToOrder(db: Db, ctx: { orgId: string, userId: string }, input: { transactionId: string, orderId: string, acceptAmountDifference: boolean }): Promise<{ orderId: string }>` — 404 nếu giao dịch/đơn không thuộc org; 409 `STATUS_CONFLICT` nếu giao dịch không còn `REVIEW_REQUIRED` hoặc đơn không còn chờ thanh toán; 400 `VALIDATION_FAILED` với `details: { reason: 'AMOUNT_MISMATCH', expectedVnd, receivedVnd }` nếu lệch tiền mà chưa `acceptAmountDifference`.
  - `resolveTransaction(db: Db, ctx: { orgId: string, userId: string }, input: { transactionId: string, resolution: Resolution, note?: string }): Promise<void>` — `REFUNDED_OUTSIDE` trên giao dịch `ORDER_CANCELLED` đóng luôn `REFUND_DUE → REFUNDED`; các lý do khác trả đơn về `PENDING` (đơn đang `REVIEW_REQUIRED` không còn giao dịch review nào) hoặc `UNPAID` (đơn hủy chưa có khoản thu).
  - HTTP (owner của store; staff → 403; ngoài tenant → 404): `GET /api/stores/:storeId/reconciliation?status=`, `POST /api/stores/:storeId/reconciliation/:txId/assign`, `POST /api/stores/:storeId/reconciliation/:txId/resolve`.

- [ ] **Step 1: Viết unit test thất bại cho schema**

`tests/unit/shared/reconciliation-schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  assignInputSchema, bankManualInputSchema, noteInputSchema, resolveInputSchema, reviewListQuerySchema,
} from '#shared/schemas/reconciliation'

const UUID = '3f1c6c3e-7a57-4a1e-9d57-0d8f7d0d1b11'

describe('reconciliation schemas', () => {
  it('defaults the list status and the amount-difference flag', () => {
    expect(reviewListQuerySchema.parse({})).toEqual({ status: 'REVIEW_REQUIRED' })
    expect(assignInputSchema.parse({ orderId: UUID })).toEqual({ orderId: UUID, acceptAmountDifference: false })
  })

  it('rejects a non-uuid order id and unknown statuses', () => {
    expect(assignInputSchema.safeParse({ orderId: 'abc' }).success).toBe(false)
    expect(reviewListQuerySchema.safeParse({ status: 'MATCHED' }).success).toBe(false)
  })

  it('requires a real note only for the OTHER resolution', () => {
    expect(resolveInputSchema.safeParse({ resolution: 'DUPLICATE' }).success).toBe(true)
    expect(resolveInputSchema.safeParse({ resolution: 'OTHER' }).success).toBe(false)
    expect(resolveInputSchema.safeParse({ resolution: 'OTHER', note: 'ab' }).success).toBe(false)
    expect(resolveInputSchema.safeParse({ resolution: 'OTHER', note: 'Khách hoàn qua Momo' }).success).toBe(true)
    expect(resolveInputSchema.safeParse({ resolution: 'NOPE' }).success).toBe(false)
  })

  it('trims notes and enforces 3–300 characters for refunds / manual bank payments', () => {
    expect(noteInputSchema.parse({ note: '  đã CK lại  ' })).toEqual({ note: 'đã CK lại' })
    expect(noteInputSchema.safeParse({ note: '  a ' }).success).toBe(false)
    expect(noteInputSchema.safeParse({ note: 'x'.repeat(301) }).success).toBe(false)
  })

  it('bank-manual input needs the method literal, an expected status and a note', () => {
    expect(bankManualInputSchema.safeParse({ method: 'BANK_MANUAL', expectedPaymentStatus: 'PENDING', note: 'Đã thấy tiền trong app' }).success).toBe(true)
    expect(bankManualInputSchema.safeParse({ method: 'CASH', expectedPaymentStatus: 'PENDING', note: 'abc' }).success).toBe(false)
    expect(bankManualInputSchema.safeParse({ method: 'BANK_MANUAL', expectedPaymentStatus: 'PAID', note: 'abc' }).success).toBe(false)
    expect(bankManualInputSchema.safeParse({ method: 'BANK_MANUAL', expectedPaymentStatus: 'PENDING' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Chạy, thấy FAIL**

Run: `npm run test:unit -- tests/unit/shared/reconciliation-schemas.test.ts`
Expected: FAIL (không resolve `#shared/schemas/reconciliation`).

- [ ] **Step 3: Tạo schema và type dùng chung**

`shared/schemas/reconciliation.ts`:

```ts
import { z } from 'zod'
import { RESOLUTIONS } from '../payments'

const note = z.string().trim().min(3, 'Cần ghi chú (ít nhất 3 ký tự)').max(300, 'Ghi chú tối đa 300 ký tự')

export const reviewListQuerySchema = z.object({
  status: z.enum(['REVIEW_REQUIRED', 'RESOLVED']).default('REVIEW_REQUIRED'),
})

export const assignInputSchema = z.object({
  orderId: z.uuid(),
  acceptAmountDifference: z.boolean().default(false),
})

export const resolveInputSchema = z.object({
  resolution: z.enum(RESOLUTIONS),
  note: z.string().trim().max(300, 'Ghi chú tối đa 300 ký tự').optional(),
}).refine(value => value.resolution !== 'OTHER' || (value.note?.length ?? 0) >= 3, {
  path: ['note'],
  message: 'Cần ghi chú khi chọn "Khác"',
})

export const noteInputSchema = z.object({ note })

export const bankManualInputSchema = z.object({
  method: z.literal('BANK_MANUAL'),
  expectedPaymentStatus: z.enum(['PENDING', 'REVIEW_REQUIRED']),
  note,
})
```

`shared/types/reconciliation.ts`:

```ts
import type { BankTxStatus, Resolution, ReviewReason } from '../payments'

export interface OrderBrief {
  id: string
  storeId: string
  publicCode: string
  status: string
  paymentStatus: string
  totalVnd: number
}

export interface ReviewItem {
  id: string
  status: BankTxStatus
  reason: ReviewReason | null
  amountVnd: number
  accountLast4: string
  content: string | null
  referenceCode: string | null
  source: 'WEBHOOK' | 'RECONCILE'
  transactionDate: string
  receivedAt: string
  resolution: Resolution | null
  matchedOrder: OrderBrief | null
  suggestedOrders: OrderBrief[]
}

export interface RefundDueOrder {
  id: string
  publicCode: string
  totalVnd: number
  heldVnd: number
  createdAt: string
}

export interface OverdueOrder {
  id: string
  publicCode: string
  totalVnd: number
  paymentStatus: 'PENDING' | 'REVIEW_REQUIRED'
  createdAt: string
}

export interface ReconciliationSummary {
  reviewCount: number
  refundDueCount: number
  overdueCount: number
}
```

- [ ] **Step 4: Chạy schema test, thấy PASS**

Run: `npm run test:unit -- tests/unit/shared/reconciliation-schemas.test.ts`
Expected: PASS.

- [ ] **Step 5: Viết integration test thất bại cho hàng đợi**

`tests/integration/review-queue.test.ts`:

```ts
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { bankTransactionEvents, bankTransactions, orderPayments, orders, paymentAttempts } from '../../server/db/schema'
import { matchTransaction } from '../../server/services/payments/match-transaction'
import { recordBankTransaction } from '../../server/services/payments/record-bank-transaction'
import { assignTransactionToOrder, listReviewItems, resolveTransaction } from '../../server/services/payments/review-queue'
import { createTenant } from '../support/fixtures'
import { bankTxInput, createAwaitingOrder, createPaymentSetup, type PaymentSetup } from '../support/webhook-fixtures'
import { resetDb } from '../support/db'

const db = () => getDb()

let tenant: Awaited<ReturnType<typeof createTenant>>
let setup: PaymentSetup
let ctx: { orgId: string, userId: string }

async function review(overrides: Parameters<typeof bankTxInput>[1] = {}) {
  const { id } = await recordBankTransaction(db(), bankTxInput(setup, overrides))
  await matchTransaction(db(), id)
  return id
}
const txRow = async (id: string) => (await db().select().from(bankTransactions).where(eq(bankTransactions.id, id)))[0]!
const orderRow = async (id: string) => (await db().select().from(orders).where(eq(orders.id, id)))[0]!
const paymentsOf = (orderId: string) => db().select().from(orderPayments).where(eq(orderPayments.orderId, orderId))

beforeEach(async () => {
  await resetDb()
  tenant = await createTenant('a')
  setup = await createPaymentSetup(tenant)
  ctx = { orgId: setup.orgId, userId: tenant.owner.userId }
})
afterAll(async () => {
  await closeDb()
})

describe('listReviewItems', () => {
  it('lists REVIEW_REQUIRED items with a one-tap suggestion for an exact-amount unpaid order', async () => {
    const { order } = await createAwaitingOrder(setup, { amountVnd: 70_000 })
    const other = await createAwaitingOrder(setup, { amountVnd: 99_000 })
    const txId = await review({ paymentCode: null, amountVnd: 70_000, content: 'ck tra sua' })

    const items = await listReviewItems(db(), ctx, 'REVIEW_REQUIRED')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: txId, status: 'REVIEW_REQUIRED', reason: 'NO_CODE', amountVnd: 70_000, content: 'ck tra sua',
      accountLast4: setup.account.accountNumber.slice(-4),
    })
    expect(items[0]!.suggestedOrders.map(o => o.id)).toEqual([order.id])
    expect(items[0]!.suggestedOrders.map(o => o.id)).not.toContain(other.order.id)
  })

  it('suggests the matched order first when the amount was wrong, and exposes it as matchedOrder', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { amountVnd: 55_000 })
    await review({ paymentCode: attempt.paymentCode, amountVnd: 50_000 })
    const [item] = await listReviewItems(db(), ctx, 'REVIEW_REQUIRED')
    expect(item).toMatchObject({ reason: 'AMOUNT_UNDER', matchedOrder: { id: order.id, publicCode: order.publicCode } })
    expect(item!.suggestedOrders[0]!.id).toBe(order.id)
  })

  it('never shows another organisation\'s transactions or orders', async () => {
    const other = await createPaymentSetup(await createTenant('b'))
    await createAwaitingOrder(other, { amountVnd: 70_000 })
    const { id } = await recordBankTransaction(db(), bankTxInput(other, { amountVnd: 70_000 }))
    await matchTransaction(db(), id)
    await review({ paymentCode: null, amountVnd: 70_000 })
    const items = await listReviewItems(db(), ctx, 'REVIEW_REQUIRED')
    expect(items).toHaveLength(1)
    expect(items[0]!.suggestedOrders).toHaveLength(0)
  })

  it('does not list matched or ignored transactions; resolved ones appear under RESOLVED', async () => {
    const { attempt } = await createAwaitingOrder(setup)
    const matched = await recordBankTransaction(db(), bankTxInput(setup, { paymentCode: attempt.paymentCode }))
    await matchTransaction(db(), matched.id)
    await recordBankTransaction(db(), bankTxInput(setup, { direction: 'OUT' }))
    const resolvedId = await review({ paymentCode: null })
    await resolveTransaction(db(), ctx, { transactionId: resolvedId, resolution: 'NOT_ORDER' })
    expect(await listReviewItems(db(), ctx, 'REVIEW_REQUIRED')).toHaveLength(0)
    expect((await listReviewItems(db(), ctx, 'RESOLVED')).map(i => i.id)).toEqual([resolvedId])
  })
})

describe('assignTransactionToOrder', () => {
  it('assigns an exact-amount transfer in one call: order NEW/PAID, one SEPAY payment by the owner, tx MATCHED', async () => {
    const { order } = await createAwaitingOrder(setup, { amountVnd: 70_000, attemptStatus: 'EXPIRED' })
    const txId = await review({ paymentCode: null, amountVnd: 70_000 })
    expect(await assignTransactionToOrder(db(), ctx, { transactionId: txId, orderId: order.id, acceptAmountDifference: false })).toEqual({ orderId: order.id })

    expect(await orderRow(order.id)).toMatchObject({ status: 'NEW', paymentStatus: 'PAID', latePayment: true })
    const payments = await paymentsOf(order.id)
    expect(payments).toHaveLength(1)
    expect(payments[0]).toMatchObject({ method: 'SEPAY', bankTransactionId: txId, amountVnd: 70_000, recordedBy: ctx.userId })
    expect(await txRow(txId)).toMatchObject({ reconciliationStatus: 'MATCHED', matchedOrderId: order.id, resolvedBy: ctx.userId })
    const events = await db().select().from(bankTransactionEvents).where(eq(bankTransactionEvents.bankTransactionId, txId))
    expect(events.map(e => e.action)).toContain('ASSIGNED')
  })

  it('refuses a different amount until the owner accepts the difference, then records the real amount', async () => {
    const { order } = await createAwaitingOrder(setup, { amountVnd: 55_000 })
    const txId = await review({ paymentCode: null, amountVnd: 60_000 })
    await expect(assignTransactionToOrder(db(), ctx, { transactionId: txId, orderId: order.id, acceptAmountDifference: false }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'AMOUNT_MISMATCH', expectedVnd: 55_000, receivedVnd: 60_000 } })
    expect((await orderRow(order.id)).paymentStatus).toBe('PENDING')

    await assignTransactionToOrder(db(), ctx, { transactionId: txId, orderId: order.id, acceptAmountDifference: true })
    expect((await paymentsOf(order.id))[0]!.amountVnd).toBe(60_000)
  })

  it('releases the review flag on the order the transfer was first matched to', async () => {
    const wrong = await createAwaitingOrder(setup, { amountVnd: 55_000 })
    const target = await createAwaitingOrder(setup, { amountVnd: 50_000 })
    const txId = await review({ paymentCode: wrong.attempt.paymentCode, amountVnd: 50_000 })
    expect((await orderRow(wrong.order.id)).paymentStatus).toBe('REVIEW_REQUIRED')

    await assignTransactionToOrder(db(), ctx, { transactionId: txId, orderId: target.order.id, acceptAmountDifference: false })
    expect((await orderRow(wrong.order.id)).paymentStatus).toBe('PENDING')
    expect((await orderRow(target.order.id)).paymentStatus).toBe('PAID')
    expect((await db().select().from(paymentAttempts).where(eq(paymentAttempts.id, wrong.attempt.id)))[0]!.status).toBe('PENDING')
  })

  it('double tap: the second call gets STATUS_CONFLICT and nothing is credited twice (Review Focus #5)', async () => {
    const { order } = await createAwaitingOrder(setup, { amountVnd: 70_000 })
    const txId = await review({ paymentCode: null, amountVnd: 70_000 })
    const input = { transactionId: txId, orderId: order.id, acceptAmountDifference: false }
    const results = await Promise.allSettled([
      assignTransactionToOrder(db(), ctx, input),
      assignTransactionToOrder(db(), ctx, input),
      assignTransactionToOrder(db(), ctx, input),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    for (const r of results.filter(r => r.status === 'rejected')) expect((r as PromiseRejectedResult).reason).toMatchObject({ code: 'STATUS_CONFLICT' })
    expect(await paymentsOf(order.id)).toHaveLength(1)
  })

  it('two transfers racing for one order: one wins, the other gets STATUS_CONFLICT and stays in review', async () => {
    const { order } = await createAwaitingOrder(setup, { amountVnd: 70_000 })
    const a = await review({ paymentCode: null, amountVnd: 70_000 })
    const b = await review({ paymentCode: null, amountVnd: 70_000 })
    const results = await Promise.allSettled([
      assignTransactionToOrder(db(), ctx, { transactionId: a, orderId: order.id, acceptAmountDifference: false }),
      assignTransactionToOrder(db(), ctx, { transactionId: b, orderId: order.id, acceptAmountDifference: false }),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(await paymentsOf(order.id)).toHaveLength(1)
    const stillReview = [await txRow(a), await txRow(b)].filter(t => t.reconciliationStatus === 'REVIEW_REQUIRED')
    expect(stillReview).toHaveLength(1)
  })

  it('assign racing with the webhook matcher on the same order never double-pays', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { amountVnd: 70_000 })
    const manual = await review({ paymentCode: null, amountVnd: 70_000 })
    const incoming = await recordBankTransaction(db(), bankTxInput(setup, { paymentCode: attempt.paymentCode, amountVnd: 70_000 }))
    await Promise.allSettled([
      assignTransactionToOrder(db(), ctx, { transactionId: manual, orderId: order.id, acceptAmountDifference: false }),
      matchTransaction(db(), incoming.id),
    ])
    expect(await paymentsOf(order.id)).toHaveLength(1)
  })

  it('returns 404 for an order or transaction outside the organisation and never touches them', async () => {
    const otherSetup = await createPaymentSetup(await createTenant('b'))
    const foreign = await createAwaitingOrder(otherSetup, { amountVnd: 70_000 })
    const txId = await review({ paymentCode: null, amountVnd: 70_000 })
    await expect(assignTransactionToOrder(db(), ctx, { transactionId: txId, orderId: foreign.order.id, acceptAmountDifference: false }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect((await orderRow(foreign.order.id)).paymentStatus).toBe('PENDING')

    const foreignTx = await recordBankTransaction(db(), bankTxInput(otherSetup))
    await matchTransaction(db(), foreignTx.id)
    const { order } = await createAwaitingOrder(setup, { amountVnd: 55_000 })
    await expect(assignTransactionToOrder(db(), ctx, { transactionId: foreignTx.id, orderId: order.id, acceptAmountDifference: false }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(assignTransactionToOrder(db(), ctx, { transactionId: 'nope', orderId: order.id, acceptAmountDifference: false }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('refuses an order that is no longer waiting for payment', async () => {
    const { order } = await createAwaitingOrder(setup, { orderStatus: 'CANCELLED', paymentStatus: 'UNPAID' })
    const txId = await review({ paymentCode: null })
    await expect(assignTransactionToOrder(db(), ctx, { transactionId: txId, orderId: order.id, acceptAmountDifference: true }))
      .rejects.toMatchObject({ code: 'STATUS_CONFLICT' })
  })
})

describe('resolveTransaction', () => {
  it('marks the transfer RESOLVED with who/when/why and an audit event', async () => {
    const txId = await review({ paymentCode: null })
    await resolveTransaction(db(), ctx, { transactionId: txId, resolution: 'OTHER', note: 'Khách chuyển nhầm, đã trả lại' })
    expect(await txRow(txId)).toMatchObject({ reconciliationStatus: 'RESOLVED', resolution: 'OTHER', resolutionNote: 'Khách chuyển nhầm, đã trả lại', resolvedBy: ctx.userId })
    const events = await db().select().from(bankTransactionEvents).where(eq(bankTransactionEvents.bankTransactionId, txId))
    expect(events.map(e => e.action)).toContain('RESOLVED')
  })

  it('a second resolve (double tap) gets STATUS_CONFLICT', async () => {
    const txId = await review({ paymentCode: null })
    await resolveTransaction(db(), ctx, { transactionId: txId, resolution: 'NOT_ORDER' })
    await expect(resolveTransaction(db(), ctx, { transactionId: txId, resolution: 'NOT_ORDER' })).rejects.toMatchObject({ code: 'STATUS_CONFLICT' })
  })

  it('REFUNDED_OUTSIDE on money for a cancelled order closes the refund too (REFUND_DUE → REFUNDED)', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { orderStatus: 'CANCELLED', paymentStatus: 'UNPAID', attemptStatus: 'EXPIRED' })
    const txId = await review({ paymentCode: attempt.paymentCode })
    expect((await orderRow(order.id)).paymentStatus).toBe('REFUND_DUE')
    await resolveTransaction(db(), ctx, { transactionId: txId, resolution: 'REFUNDED_OUTSIDE' })
    expect((await orderRow(order.id)).paymentStatus).toBe('REFUNDED')
  })

  it('any other resolution for a cancelled, never-paid order returns it to UNPAID', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { orderStatus: 'CANCELLED', paymentStatus: 'UNPAID', attemptStatus: 'EXPIRED' })
    const txId = await review({ paymentCode: attempt.paymentCode })
    await resolveTransaction(db(), ctx, { transactionId: txId, resolution: 'NOT_ORDER' })
    expect((await orderRow(order.id)).paymentStatus).toBe('UNPAID')
  })

  it('a duplicate transfer on a PAID order is resolved without touching the order', async () => {
    const { order, attempt } = await createAwaitingOrder(setup)
    const first = await recordBankTransaction(db(), bankTxInput(setup, { paymentCode: attempt.paymentCode }))
    await matchTransaction(db(), first.id)
    const dupId = await review({ paymentCode: attempt.paymentCode })
    await resolveTransaction(db(), ctx, { transactionId: dupId, resolution: 'REFUNDED_OUTSIDE' })
    expect((await orderRow(order.id)).paymentStatus).toBe('PAID')
  })

  it('returns an order flagged by an under-payment to PENDING once its last review item is resolved', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { amountVnd: 55_000 })
    const txId = await review({ paymentCode: attempt.paymentCode, amountVnd: 40_000 })
    expect((await orderRow(order.id)).paymentStatus).toBe('REVIEW_REQUIRED')
    await resolveTransaction(db(), ctx, { transactionId: txId, resolution: 'REFUNDED_OUTSIDE' })
    expect((await orderRow(order.id)).paymentStatus).toBe('PENDING')
  })

  it('keeps REVIEW_REQUIRED while another review item still points at the order', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { amountVnd: 55_000 })
    const one = await review({ paymentCode: attempt.paymentCode, amountVnd: 40_000 })
    await review({ paymentCode: attempt.paymentCode, amountVnd: 41_000 })
    await resolveTransaction(db(), ctx, { transactionId: one, resolution: 'REFUNDED_OUTSIDE' })
    expect((await orderRow(order.id)).paymentStatus).toBe('REVIEW_REQUIRED')
  })

  it('cannot resolve another organisation\'s transaction', async () => {
    const otherSetup = await createPaymentSetup(await createTenant('b'))
    const foreign = await recordBankTransaction(db(), bankTxInput(otherSetup))
    await matchTransaction(db(), foreign.id)
    await expect(resolveTransaction(db(), ctx, { transactionId: foreign.id, resolution: 'NOT_ORDER' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect((await txRow(foreign.id)).reconciliationStatus).toBe('REVIEW_REQUIRED')
  })
})
```

- [ ] **Step 6: Chạy, thấy FAIL**

Run: `npm run test:integration -- tests/integration/review-queue.test.ts`
Expected: FAIL (không resolve `review-queue`).

- [ ] **Step 7: Cài đặt `review-queue.ts`**

```ts
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Resolution } from '#shared/payments'
import type { OrderBrief, ReviewItem } from '#shared/types/reconciliation'
import type { Db, Tx } from '../../db/client'
import { bankTransactionEvents, bankTransactions, orderEvents, orderPayments, orders } from '../../db/schema'
import { AppError } from '../../utils/errors'
import { confirmOrderPayment } from './confirm-payment'
import { lockOrderGraph } from './lock-order-graph'

const PAYABLE_STATUSES = ['PENDING', 'REVIEW_REQUIRED']
const uuid = z.uuid()

const notFound = () => new AppError('NOT_FOUND', 'Không tìm thấy')

const briefColumns = {
  id: orders.id,
  storeId: orders.storeId,
  publicCode: orders.publicCode,
  status: orders.status,
  paymentStatus: orders.paymentStatus,
  totalVnd: orders.totalVnd,
}

const isPayable = (order: OrderBrief) => order.status === 'AWAITING_PAYMENT' && PAYABLE_STATUSES.includes(order.paymentStatus)

export async function listReviewItems(
  db: Db,
  ctx: { orgId: string },
  status: 'REVIEW_REQUIRED' | 'RESOLVED',
): Promise<ReviewItem[]> {
  const rows = await db.select().from(bankTransactions)
    .where(and(eq(bankTransactions.orgId, ctx.orgId), eq(bankTransactions.reconciliationStatus, status)))
    .orderBy(desc(bankTransactions.receivedAt))
    .limit(status === 'REVIEW_REQUIRED' ? 100 : 30)
  if (rows.length === 0) return []

  const matchedIds = [...new Set(rows.flatMap(row => (row.matchedOrderId ? [row.matchedOrderId] : [])))]
  const matched = matchedIds.length === 0
    ? []
    : await db.select(briefColumns).from(orders).where(and(eq(orders.orgId, ctx.orgId), inArray(orders.id, matchedIds)))
  const matchedById = new Map(matched.map(order => [order.id, order as OrderBrief]))

  const candidates: OrderBrief[] = status === 'REVIEW_REQUIRED'
    ? await db.select(briefColumns).from(orders)
      .where(and(
        eq(orders.orgId, ctx.orgId),
        eq(orders.status, 'AWAITING_PAYMENT'),
        inArray(orders.paymentStatus, PAYABLE_STATUSES as ('PENDING' | 'REVIEW_REQUIRED')[]),
      ))
      .orderBy(desc(orders.createdAt))
      .limit(200)
    : []

  return rows.map((row) => {
    const matchedOrder = row.matchedOrderId ? (matchedById.get(row.matchedOrderId) ?? null) : null
    const suggestions: OrderBrief[] = []
    if (matchedOrder && isPayable(matchedOrder)) suggestions.push(matchedOrder)
    for (const order of candidates) {
      if (order.totalVnd === row.amountVnd && !suggestions.some(s => s.id === order.id)) suggestions.push(order)
    }
    return {
      id: row.id,
      status: row.reconciliationStatus,
      reason: row.reviewReason,
      amountVnd: row.amountVnd,
      accountLast4: row.bankAccountNumber.slice(-4),
      content: row.content,
      referenceCode: row.referenceCode,
      source: row.source,
      transactionDate: row.transactionDate.toISOString(),
      receivedAt: row.receivedAt.toISOString(),
      resolution: row.resolution,
      matchedOrder,
      suggestedOrders: suggestions.slice(0, 3),
    }
  })
}

async function lockTransaction(tx: Tx, orgId: string, transactionId: string) {
  if (!uuid.safeParse(transactionId).success) throw notFound()
  const [bt] = await tx.select().from(bankTransactions)
    .where(and(eq(bankTransactions.id, transactionId), eq(bankTransactions.orgId, orgId)))
    .for('update')
  if (!bt) throw notFound()
  return bt
}

// Returns an order that was flagged only because of review items to PENDING once none remain.
async function releaseReviewFlag(tx: Tx, orgId: string, orderId: string): Promise<void> {
  await tx.update(orders).set({ paymentStatus: 'PENDING' }).where(and(
    eq(orders.id, orderId),
    eq(orders.orgId, orgId),
    eq(orders.paymentStatus, 'REVIEW_REQUIRED'),
    sql`not exists (select 1 from bank_transactions b where b.matched_order_id = ${orderId} and b.reconciliation_status = 'REVIEW_REQUIRED')`,
  ))
}

export async function assignTransactionToOrder(
  db: Db,
  ctx: { orgId: string, userId: string },
  input: { transactionId: string, orderId: string, acceptAmountDifference: boolean },
): Promise<{ orderId: string }> {
  return db.transaction(async (tx) => {
    const bt = await lockTransaction(tx, ctx.orgId, input.transactionId)
    if (bt.reconciliationStatus !== 'REVIEW_REQUIRED') throw new AppError('STATUS_CONFLICT', 'Giao dịch đã được xử lý')
    if (!uuid.safeParse(input.orderId).success) throw notFound()

    const [target] = await tx.select({ storeId: orders.storeId }).from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.orgId, ctx.orgId)))
    if (!target) throw notFound()

    const { attempts, order } = await lockOrderGraph(tx, { orgId: ctx.orgId, storeId: target.storeId, orderId: input.orderId })
    if (!order) throw notFound()
    if (order.status !== 'AWAITING_PAYMENT' || !PAYABLE_STATUSES.includes(order.paymentStatus)) {
      throw new AppError('STATUS_CONFLICT', 'Đơn không còn chờ thanh toán')
    }
    if (bt.amountVnd !== order.totalVnd && !input.acceptAmountDifference) {
      throw new AppError('VALIDATION_FAILED', 'Số tiền chuyển khác với giá trị đơn', {
        reason: 'AMOUNT_MISMATCH',
        expectedVnd: order.totalVnd,
        receivedVnd: bt.amountVnd,
      })
    }

    const codeAttempt = attempts.find(a => a.paymentCode === bt.paymentCode && a.status !== 'PAID') ?? null
    await confirmOrderPayment(tx, {
      order,
      method: 'SEPAY',
      amountVnd: bt.amountVnd,
      bankTransactionId: bt.id,
      paymentCodeAttemptId: codeAttempt?.id ?? null,
      actorUserId: ctx.userId,
      late: !attempts.some(a => a.status === 'PENDING'),
      eventType: 'PAYMENT_ASSIGNED',
      note: null,
      metadata: { bankTransactionId: bt.id, amountDifferenceAccepted: bt.amountVnd !== order.totalVnd },
    })
    await tx.update(bankTransactions).set({
      reconciliationStatus: 'MATCHED',
      reviewReason: null,
      matchedStoreId: order.storeId,
      matchedOrderId: order.id,
      resolvedBy: ctx.userId,
      resolvedAt: new Date(),
    }).where(eq(bankTransactions.id, bt.id))
    await tx.insert(bankTransactionEvents).values({
      orgId: ctx.orgId,
      bankTransactionId: bt.id,
      action: 'ASSIGNED',
      fromStatus: 'REVIEW_REQUIRED',
      toStatus: 'MATCHED',
      orderId: order.id,
      actorUserId: ctx.userId,
      metadata: { amountDifferenceAccepted: bt.amountVnd !== order.totalVnd },
    })
    if (bt.matchedOrderId && bt.matchedOrderId !== order.id) await releaseReviewFlag(tx, ctx.orgId, bt.matchedOrderId)
    return { orderId: order.id }
  })
}

export async function resolveTransaction(
  db: Db,
  ctx: { orgId: string, userId: string },
  input: { transactionId: string, resolution: Resolution, note?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const bt = await lockTransaction(tx, ctx.orgId, input.transactionId)
    if (bt.reconciliationStatus !== 'REVIEW_REQUIRED') throw new AppError('STATUS_CONFLICT', 'Giao dịch đã được xử lý')

    await tx.update(bankTransactions).set({
      reconciliationStatus: 'RESOLVED',
      resolution: input.resolution,
      resolutionNote: input.note ?? null,
      resolvedBy: ctx.userId,
      resolvedAt: new Date(),
    }).where(eq(bankTransactions.id, bt.id))
    await tx.insert(bankTransactionEvents).values({
      orgId: ctx.orgId,
      bankTransactionId: bt.id,
      action: 'RESOLVED',
      fromStatus: 'REVIEW_REQUIRED',
      toStatus: 'RESOLVED',
      orderId: bt.matchedOrderId,
      actorUserId: ctx.userId,
      metadata: { resolution: input.resolution },
    })

    if (!bt.matchedOrderId || !bt.matchedStoreId) return
    const { order } = await lockOrderGraph(tx, { orgId: ctx.orgId, storeId: bt.matchedStoreId, orderId: bt.matchedOrderId })
    if (!order) return

    if (bt.reviewReason === 'ORDER_CANCELLED' && order.paymentStatus === 'REFUND_DUE') {
      const [alreadyCollected] = await tx.select({ id: orderPayments.id }).from(orderPayments).where(eq(orderPayments.orderId, order.id)).limit(1)
      const refunded = input.resolution === 'REFUNDED_OUTSIDE'
      if (refunded || !alreadyCollected) {
        await tx.update(orders).set({ paymentStatus: refunded ? 'REFUNDED' : 'UNPAID' }).where(eq(orders.id, order.id))
        await tx.insert(orderEvents).values({
          orgId: order.orgId,
          storeId: order.storeId,
          orderId: order.id,
          actorUserId: ctx.userId,
          eventType: refunded ? 'PAYMENT_REFUNDED' : 'PAYMENT_REVIEW_DISMISSED',
          metadata: { bankTransactionId: bt.id, resolution: input.resolution },
        })
      }
      return
    }
    await releaseReviewFlag(tx, ctx.orgId, order.id)
  })
}
```

- [ ] **Step 8: Chạy, thấy PASS**

Run: `npm run test:integration -- tests/integration/review-queue.test.ts`
Expected: PASS toàn bộ.

- [ ] **Step 9: Tạo 3 route**

`server/api/stores/[storeId]/reconciliation/index.get.ts`:

```ts
import { getRouterParam } from 'h3'
import { reviewListQuerySchema } from '#shared/schemas/reconciliation'
import { requireStoreOwner } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { listReviewItems } from '../../../../services/payments/review-queue'
import { defineApiHandler } from '../../../../utils/api-handler'
import { parseQuery } from '../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const { status } = parseQuery(event, reviewListQuerySchema)
  return { items: await listReviewItems(getDb(), { orgId: ctx.orgId }, status) }
})
```

`server/api/stores/[storeId]/reconciliation/[txId]/assign.post.ts`:

```ts
import { getRouterParam } from 'h3'
import { assignInputSchema } from '#shared/schemas/reconciliation'
import { requireStoreOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { assignTransactionToOrder } from '../../../../../services/payments/review-queue'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { parseBody } from '../../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const input = await parseBody(event, assignInputSchema)
  return assignTransactionToOrder(getDb(), ctx, { transactionId: getRouterParam(event, 'txId') ?? '', ...input })
})
```

`server/api/stores/[storeId]/reconciliation/[txId]/resolve.post.ts`:

```ts
import { getRouterParam, setResponseStatus } from 'h3'
import { resolveInputSchema } from '#shared/schemas/reconciliation'
import { requireStoreOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { resolveTransaction } from '../../../../../services/payments/review-queue'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { parseBody } from '../../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const input = await parseBody(event, resolveInputSchema)
  await resolveTransaction(getDb(), ctx, { transactionId: getRouterParam(event, 'txId') ?? '', ...input })
  setResponseStatus(event, 200)
  return { ok: true }
})
```

- [ ] **Step 10: Thêm hàng vào ma trận tenant**

Trong `tests/api/tenant-isolation.test.ts`:

1. Đảm bảo file đã import các tên sau (các dòng import đã bị PR2–PR5 sửa, nên **thêm vào** import hiện có thay vì chép lại): `bankTransactions`, `orders`, `stores` từ `'../../server/db/schema'`; `matchTransaction` từ `'../../server/services/payments/match-transaction'`; `recordBankTransaction` từ `'../../server/services/payments/record-bank-transaction'`; `bankTxInput`, `createAwaitingOrder`, `createPaymentSetup`, `type PaymentSetup` từ `'../support/webhook-fixtures'`.

2. Thêm vào **cuối file** khối sau (dùng lại `call`, `tokens`, `ids`, `errorCodes`, `Actor` của file):

```ts
let setupA: PaymentSetup
let setupB: PaymentSetup

beforeAll(async () => {
  const [storeB] = await getDb().select({ orgId: stores.orgId }).from(stores).where(eq(stores.id, ids.storeB))
  setupA = await createPaymentSetup({ org: { id: ids.orgA }, store: { id: ids.storeA1, orgId: ids.orgA } })
  setupB = await createPaymentSetup({ org: { id: storeB!.orgId }, store: { id: ids.storeB, orgId: storeB!.orgId } })
})

describe('reconciliation (PR6)', () => {
  async function reviewTx(setup: PaymentSetup, amountVnd = 70_000) {
    const { id } = await recordBankTransaction(getDb(), bankTxInput(setup, { paymentCode: null, amountVnd }))
    await matchTransaction(getDb(), id)
    return id
  }
  const txStatus = async (id: string) =>
    (await getDb().select().from(bankTransactions).where(eq(bankTransactions.id, id)))[0]!.reconciliationStatus

  it.each<[Actor, number]>([
    ['ownerA', 200],
    ['staffA1', 403],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
  ])('GET review queue: %s → %i', async (actor, status) => {
    const res = await call('GET', `/api/stores/${ids.storeA1}/reconciliation`, tokens[actor])
    expect(res.status).toBe(status)
    if (status !== 200) expect(res.body).toMatchObject({ code: errorCodes[status] })
  })

  it('shows only the caller\'s organisation, with no raw payload or tenant ids', async () => {
    const mine = await reviewTx(setupA)
    const theirs = await reviewTx(setupB)
    const a = await call('GET', `/api/stores/${ids.storeA1}/reconciliation`, tokens.ownerA)
    const b = await call('GET', `/api/stores/${ids.storeB}/reconciliation`, tokens.ownerB)
    expect(a.body.items.map((i: { id: string }) => i.id)).toContain(mine)
    expect(a.body.items.map((i: { id: string }) => i.id)).not.toContain(theirs)
    expect(b.body.items.map((i: { id: string }) => i.id)).toContain(theirs)
    expect(b.body.items.map((i: { id: string }) => i.id)).not.toContain(mine)
    const serialized = JSON.stringify(a.body)
    for (const leak of ['rawPayload', 'orgId', 'integrationId', setupA.account.accountNumber]) expect(serialized).not.toContain(leak)
  })

  it.each<[Actor, number]>([
    ['staffA1', 403],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
    ['ownerA', 200],
  ])('POST resolve: %s → %i', async (actor, status) => {
    const txId = await reviewTx(setupA)
    const res = await call('POST', `/api/stores/${ids.storeA1}/reconciliation/${txId}/resolve`, tokens[actor], { resolution: 'NOT_ORDER' })
    expect(res.status).toBe(status)
    expect(await txStatus(txId)).toBe(status === 200 ? 'RESOLVED' : 'REVIEW_REQUIRED')
  })

  it('owner B cannot resolve or assign tenant A\'s transaction through their own store route', async () => {
    const txId = await reviewTx(setupA)
    const { order } = await createAwaitingOrder(setupB, { amountVnd: 70_000 })
    const resolve = await call('POST', `/api/stores/${ids.storeB}/reconciliation/${txId}/resolve`, tokens.ownerB, { resolution: 'NOT_ORDER' })
    const assign = await call('POST', `/api/stores/${ids.storeB}/reconciliation/${txId}/assign`, tokens.ownerB, { orderId: order.id })
    expect(resolve).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
    expect(assign).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
    expect(await txStatus(txId)).toBe('REVIEW_REQUIRED')
  })

  it('owner A cannot assign their transfer to an order of tenant B (404, order untouched)', async () => {
    const txId = await reviewTx(setupA)
    const { order } = await createAwaitingOrder(setupB, { amountVnd: 70_000 })
    const res = await call('POST', `/api/stores/${ids.storeA1}/reconciliation/${txId}/assign`, tokens.ownerA, { orderId: order.id })
    expect(res).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
    const [row] = await getDb().select().from(orders).where(eq(orders.id, order.id))
    expect(row!.paymentStatus).toBe('PENDING')
    expect(await txStatus(txId)).toBe('REVIEW_REQUIRED')
  })

  it.each<[Actor, number]>([
    ['staffA1', 403],
    ['staffA2', 404],
    ['ownerB', 404],
    ['ownerA', 200],
  ])('POST assign: %s → %i, and a repeat gets 409', async (actor, status) => {
    const txId = await reviewTx(setupA)
    const { order } = await createAwaitingOrder(setupA, { amountVnd: 70_000 })
    const path = `/api/stores/${ids.storeA1}/reconciliation/${txId}/assign`
    const res = await call('POST', path, tokens[actor], { orderId: order.id })
    expect(res.status).toBe(status)
    if (status === 200) {
      expect(await call('POST', path, tokens.ownerA, { orderId: order.id })).toMatchObject({ status: 409, body: { code: 'STATUS_CONFLICT' } })
    }
  })

  it('validates bodies (400) before touching anything', async () => {
    const txId = await reviewTx(setupA)
    const res = await call('POST', `/api/stores/${ids.storeA1}/reconciliation/${txId}/resolve`, tokens.ownerA, { resolution: 'OTHER' })
    expect(res).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
    expect(await txStatus(txId)).toBe('REVIEW_REQUIRED')
  })
})
```

- [ ] **Step 11: Chạy ma trận**

Run: `npm run test:api -- tests/api/tenant-isolation.test.ts`
Expected: PASS (các hàng cũ của PR1–PR5 vẫn xanh).

- [ ] **Step 12: Commit**

```bash
git add shared/schemas/reconciliation.ts shared/types/reconciliation.ts server/services/payments/review-queue.ts server/api/stores tests/unit/shared/reconciliation-schemas.test.ts tests/integration/review-queue.test.ts tests/api/tenant-isolation.test.ts
git commit -m "feat(payment-webhook): add owner review queue with assign and resolve

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 9: Hoàn tiền, đơn quá hạn, xác nhận `BANK_MANUAL`, tóm tắt (service + API + ma trận tenant)

**Files:**
- Create: `server/services/payments/manual-payments.ts`, `server/api/stores/[storeId]/reconciliation/summary.get.ts`, `server/api/stores/[storeId]/reconciliation/refunds.get.ts`, `server/api/stores/[storeId]/reconciliation/overdue.get.ts`, `server/api/stores/[storeId]/orders/[orderId]/refunded.post.ts`
- Modify: `server/api/stores/[storeId]/orders/[orderId]/mark-paid.post.ts` (route của PR4), `tests/api/tenant-isolation.test.ts`
- Test: `tests/integration/manual-payments.test.ts`

**Interfaces:**
- Consumes: `lockOrderGraph`, `confirmOrderPayment` (Task 4); `noteInputSchema`, `bankManualInputSchema` và các DTO (Task 8); `requireStoreOwner` → `StoreContext { orgId, storeId, userId }`; route `mark-paid` của PR4 (nhánh `CASH` giữ nguyên).
- Produces:
  - `listRefundDueOrders(db: Db, scope: { orgId: string, storeId: string }): Promise<RefundDueOrder[]>` (`heldVnd` = tổng `order_payments` + giao dịch review `ORDER_CANCELLED` của đơn).
  - `markOrderRefunded(db: Db, ctx: { orgId: string, storeId: string, userId: string }, input: { orderId: string, note: string }): Promise<void>` — `REFUND_DUE → REFUNDED` (409 `STATUS_CONFLICT` nếu không còn `REFUND_DUE`; 404 nếu đơn không thuộc store); đồng thời đóng các giao dịch review `ORDER_CANCELLED` của đơn thành `RESOLVED/REFUNDED_OUTSIDE`.
  - `listOverdueOrders(db: Db, scope): Promise<OverdueOrder[]>` — đơn `AWAITING_PAYMENT`, đã có attempt nhưng không còn attempt `PENDING`.
  - `markOrderPaidBankManual(db: Db, ctx: { orgId: string, storeId: string, userId: string }, input: { orderId: string, expectedPaymentStatus: 'PENDING' | 'REVIEW_REQUIRED', note: string }): Promise<{ orderId: string }>` — `order_payments(method = 'BANK_MANUAL', bank_transaction_id = null)`, đơn `NEW/PAID`; 409 nếu `payment_status` khác `expectedPaymentStatus`.
  - `getReconciliationSummary(db: Db, scope): Promise<ReconciliationSummary>`.
  - HTTP (owner của store): `GET …/reconciliation/summary | refunds | overdue`; `POST /api/stores/:storeId/orders/:orderId/refunded { note }`; `POST /api/stores/:storeId/orders/:orderId/mark-paid { method: 'BANK_MANUAL', expectedPaymentStatus, note }` (staff → 403 dù staff được `CASH`).

- [ ] **Step 1: Viết integration test thất bại**

`tests/integration/manual-payments.test.ts`:

```ts
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { bankTransactions, orderEvents, orderPayments, orders, paymentAttempts } from '../../server/db/schema'
import {
  getReconciliationSummary, listOverdueOrders, listRefundDueOrders, markOrderPaidBankManual, markOrderRefunded,
} from '../../server/services/payments/manual-payments'
import { matchTransaction } from '../../server/services/payments/match-transaction'
import { recordBankTransaction } from '../../server/services/payments/record-bank-transaction'
import { createStore, createTenant } from '../support/fixtures'
import { bankTxInput, createAttempt, createAwaitingOrder, createPaymentSetup, type PaymentSetup } from '../support/webhook-fixtures'
import { resetDb } from '../support/db'

const db = () => getDb()

let tenant: Awaited<ReturnType<typeof createTenant>>
let setup: PaymentSetup
let ctx: { orgId: string, storeId: string, userId: string }

const orderRow = async (id: string) => (await db().select().from(orders).where(eq(orders.id, id)))[0]!
const paymentsOf = (orderId: string) => db().select().from(orderPayments).where(eq(orderPayments.orderId, orderId))

async function refundDueOrder(amountVnd = 55_000) {
  const made = await createAwaitingOrder(setup, { amountVnd, orderStatus: 'CANCELLED', paymentStatus: 'REFUND_DUE', attemptStatus: 'EXPIRED' })
  await db().insert(orderPayments).values({
    orgId: setup.orgId, storeId: setup.storeId, orderId: made.order.id, method: 'SEPAY', amountVnd,
  })
  return made
}

beforeEach(async () => {
  await resetDb()
  tenant = await createTenant('a')
  setup = await createPaymentSetup(tenant)
  ctx = { orgId: setup.orgId, storeId: setup.storeId, userId: tenant.owner.userId }
})
afterAll(async () => {
  await closeDb()
})

describe('listRefundDueOrders / markOrderRefunded', () => {
  it('lists REFUND_DUE orders of the store with the amount held', async () => {
    const paid = await refundDueOrder(55_000)
    const lateTx = await createAwaitingOrder(setup, { amountVnd: 40_000, orderStatus: 'CANCELLED', paymentStatus: 'UNPAID', attemptStatus: 'EXPIRED' })
    const received = await recordBankTransaction(db(), bankTxInput(setup, { paymentCode: lateTx.attempt.paymentCode, amountVnd: 40_000 }))
    await matchTransaction(db(), received.id)

    const items = await listRefundDueOrders(db(), ctx)
    expect(items.map(i => [i.id, i.heldVnd]).sort()).toEqual([[paid.order.id, 55_000], [lateTx.order.id, 40_000]].sort())
  })

  it('does not list orders of another store in the same organisation', async () => {
    const other = await createStore(setup.orgId, 'a2')
    const otherSetup = await createPaymentSetup({ org: { id: setup.orgId }, store: { id: other.id, orgId: setup.orgId } }, { reuse: setup })
    await createAwaitingOrder(otherSetup, { orderStatus: 'CANCELLED', paymentStatus: 'REFUND_DUE' })
    expect(await listRefundDueOrders(db(), ctx)).toHaveLength(0)
  })

  it('marks the order REFUNDED with an audit event carrying the note, and resolves the linked review item', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { orderStatus: 'CANCELLED', paymentStatus: 'UNPAID', attemptStatus: 'EXPIRED' })
    const received = await recordBankTransaction(db(), bankTxInput(setup, { paymentCode: attempt.paymentCode }))
    await matchTransaction(db(), received.id)

    await markOrderRefunded(db(), ctx, { orderId: order.id, note: 'Đã chuyển khoản hoàn lại 10:30' })

    expect((await orderRow(order.id)).paymentStatus).toBe('REFUNDED')
    const events = await db().select().from(orderEvents).where(eq(orderEvents.orderId, order.id))
    expect(events.find(e => e.eventType === 'PAYMENT_REFUNDED')).toMatchObject({ actorUserId: ctx.userId, metadata: { note: 'Đã chuyển khoản hoàn lại 10:30' } })
    const [tx] = await db().select().from(bankTransactions).where(eq(bankTransactions.id, received.id))
    expect(tx).toMatchObject({ reconciliationStatus: 'RESOLVED', resolution: 'REFUNDED_OUTSIDE' })
  })

  it('refuses an order that is not REFUND_DUE and a double tap gets STATUS_CONFLICT', async () => {
    const { order } = await refundDueOrder()
    const results = await Promise.allSettled([
      markOrderRefunded(db(), ctx, { orderId: order.id, note: 'Đã hoàn tiền' }),
      markOrderRefunded(db(), ctx, { orderId: order.id, note: 'Đã hoàn tiền' }),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'STATUS_CONFLICT' })

    const paid = await createAwaitingOrder(setup, { orderStatus: 'NEW', paymentStatus: 'PAID' })
    await expect(markOrderRefunded(db(), ctx, { orderId: paid.order.id, note: 'Đã hoàn tiền' })).rejects.toMatchObject({ code: 'STATUS_CONFLICT' })
  })

  it('returns 404 for unknown ids and for orders of another store', async () => {
    const other = await createStore(setup.orgId, 'a2')
    const otherSetup = await createPaymentSetup({ org: { id: setup.orgId }, store: { id: other.id, orgId: setup.orgId } }, { reuse: setup })
    const foreign = await createAwaitingOrder(otherSetup, { orderStatus: 'CANCELLED', paymentStatus: 'REFUND_DUE' })
    await expect(markOrderRefunded(db(), ctx, { orderId: foreign.order.id, note: 'Đã hoàn tiền' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(markOrderRefunded(db(), ctx, { orderId: 'nope', note: 'Đã hoàn tiền' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect((await orderRow(foreign.order.id)).paymentStatus).toBe('REFUND_DUE')
  })
})

describe('listOverdueOrders', () => {
  it('lists unpaid orders whose every attempt has ended, not those with a live QR', async () => {
    const overdue = await createAwaitingOrder(setup, { attemptStatus: 'EXPIRED' })
    await createAwaitingOrder(setup, { attemptStatus: 'PENDING' })
    await createAwaitingOrder(setup, { attemptStatus: 'EXPIRED', orderStatus: 'CANCELLED', paymentStatus: 'UNPAID' })
    const items = await listOverdueOrders(db(), ctx)
    expect(items.map(i => i.id)).toEqual([overdue.order.id])
    expect(items[0]).toMatchObject({ publicCode: overdue.order.publicCode, totalVnd: 55_000, paymentStatus: 'PENDING' })
  })
})

describe('markOrderPaidBankManual', () => {
  it('confirms the order with a BANK_MANUAL payment, audits the note and supersedes live attempts', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { amountVnd: 70_000, attemptStatus: 'EXPIRED' })
    await createAttempt(setup, order.id, { amountVnd: 70_000, paymentCode: 'ZOLIVE0001', status: 'PENDING' })
    await markOrderPaidBankManual(db(), ctx, { orderId: order.id, expectedPaymentStatus: 'PENDING', note: 'Thấy tiền trong app VCB' })

    expect(await orderRow(order.id)).toMatchObject({ status: 'NEW', paymentStatus: 'PAID' })
    const payments = await paymentsOf(order.id)
    expect(payments).toHaveLength(1)
    expect(payments[0]).toMatchObject({ method: 'BANK_MANUAL', bankTransactionId: null, amountVnd: 70_000, recordedBy: ctx.userId, note: 'Thấy tiền trong app VCB' })
    const events = await db().select().from(orderEvents).where(eq(orderEvents.orderId, order.id))
    expect(events.find(e => e.eventType === 'PAYMENT_MANUAL_BANK')).toMatchObject({ metadata: { note: 'Thấy tiền trong app VCB' } })
    const attempts = await db().select().from(paymentAttempts).where(eq(paymentAttempts.orderId, order.id))
    expect(attempts.find(a => a.paymentCode === 'ZOLIVE0001')!.status).toBe('SUPERSEDED')
    expect(attempts.find(a => a.id === attempt.id)!.status).toBe('EXPIRED')
  })

  it('a stale expectation or an already paid order gets STATUS_CONFLICT and nothing is recorded', async () => {
    const reviewing = await createAwaitingOrder(setup, { paymentStatus: 'REVIEW_REQUIRED' })
    await expect(markOrderPaidBankManual(db(), ctx, { orderId: reviewing.order.id, expectedPaymentStatus: 'PENDING', note: 'abc' })).rejects.toMatchObject({ code: 'STATUS_CONFLICT' })
    const paid = await createAwaitingOrder(setup, { orderStatus: 'NEW', paymentStatus: 'PAID' })
    await expect(markOrderPaidBankManual(db(), ctx, { orderId: paid.order.id, expectedPaymentStatus: 'PENDING', note: 'abc' })).rejects.toMatchObject({ code: 'STATUS_CONFLICT' })
    expect(await paymentsOf(reviewing.order.id)).toHaveLength(0)
  })

  it('two concurrent confirmations record one payment', async () => {
    const { order } = await createAwaitingOrder(setup)
    const input = { orderId: order.id, expectedPaymentStatus: 'PENDING' as const, note: 'Đã thấy tiền' }
    const results = await Promise.allSettled([markOrderPaidBankManual(db(), ctx, input), markOrderPaidBankManual(db(), ctx, input)])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(await paymentsOf(order.id)).toHaveLength(1)
  })

  it('a webhook for the same order afterwards is kept as a duplicate for review, never a second payment', async () => {
    const { order, attempt } = await createAwaitingOrder(setup)
    await markOrderPaidBankManual(db(), ctx, { orderId: order.id, expectedPaymentStatus: 'PENDING', note: 'Đã thấy tiền' })
    const received = await recordBankTransaction(db(), bankTxInput(setup, { paymentCode: attempt.paymentCode }))
    expect(await matchTransaction(db(), received.id)).toEqual({ kind: 'REVIEW', reason: 'ORDER_ALREADY_PAID', orderId: order.id })
    expect(await paymentsOf(order.id)).toHaveLength(1)
  })

  it('404 for another store\'s order', async () => {
    const other = await createStore(setup.orgId, 'a2')
    const otherSetup = await createPaymentSetup({ org: { id: setup.orgId }, store: { id: other.id, orgId: setup.orgId } }, { reuse: setup })
    const foreign = await createAwaitingOrder(otherSetup)
    await expect(markOrderPaidBankManual(db(), ctx, { orderId: foreign.order.id, expectedPaymentStatus: 'PENDING', note: 'abc' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('getReconciliationSummary', () => {
  it('counts review items (org-wide), refunds and overdue orders (store)', async () => {
    const rx = await recordBankTransaction(db(), bankTxInput(setup, { paymentCode: null }))
    await matchTransaction(db(), rx.id)
    await refundDueOrder()
    await createAwaitingOrder(setup, { attemptStatus: 'EXPIRED' })
    expect(await getReconciliationSummary(db(), ctx)).toEqual({ reviewCount: 1, refundDueCount: 1, overdueCount: 1 })
  })
})
```

- [ ] **Step 2: Chạy, thấy FAIL**

Run: `npm run test:integration -- tests/integration/manual-payments.test.ts`
Expected: FAIL (không resolve `manual-payments`).

- [ ] **Step 3: Cài đặt `manual-payments.ts`**

```ts
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { OverdueOrder, ReconciliationSummary, RefundDueOrder } from '#shared/types/reconciliation'
import type { Db } from '../../db/client'
import { bankTransactionEvents, bankTransactions, orderEvents, orderPayments, orders } from '../../db/schema'
import { AppError } from '../../utils/errors'
import { confirmOrderPayment } from './confirm-payment'
import { lockOrderGraph } from './lock-order-graph'

export interface StoreScope { orgId: string, storeId: string }
export interface ActorScope extends StoreScope { userId: string }

const uuid = z.uuid()
const notFound = () => new AppError('NOT_FOUND', 'Không tìm thấy')

const overdueWhere = (scope: StoreScope) => and(
  eq(orders.orgId, scope.orgId),
  eq(orders.storeId, scope.storeId),
  eq(orders.status, 'AWAITING_PAYMENT'),
  inArray(orders.paymentStatus, ['PENDING', 'REVIEW_REQUIRED']),
  sql`exists (select 1 from payment_attempts a where a.order_id = ${orders.id})`,
  sql`not exists (select 1 from payment_attempts a where a.order_id = ${orders.id} and a.status = 'PENDING')`,
)

export async function listRefundDueOrders(db: Db, scope: StoreScope): Promise<RefundDueOrder[]> {
  const rows = await db.select({
    id: orders.id,
    publicCode: orders.publicCode,
    totalVnd: orders.totalVnd,
    createdAt: orders.createdAt,
  }).from(orders)
    .where(and(eq(orders.orgId, scope.orgId), eq(orders.storeId, scope.storeId), eq(orders.paymentStatus, 'REFUND_DUE')))
    .orderBy(desc(orders.createdAt))
    .limit(100)
  if (rows.length === 0) return []
  const ids = rows.map(row => row.id)

  const collected = await db.select({ orderId: orderPayments.orderId, total: sql<number>`coalesce(sum(${orderPayments.amountVnd}), 0)::int` })
    .from(orderPayments).where(inArray(orderPayments.orderId, ids)).groupBy(orderPayments.orderId)
  const waiting = await db.select({ orderId: bankTransactions.matchedOrderId, total: sql<number>`coalesce(sum(${bankTransactions.amountVnd}), 0)::int` })
    .from(bankTransactions)
    .where(and(
      eq(bankTransactions.orgId, scope.orgId),
      inArray(bankTransactions.matchedOrderId, ids),
      eq(bankTransactions.reconciliationStatus, 'REVIEW_REQUIRED'),
      eq(bankTransactions.reviewReason, 'ORDER_CANCELLED'),
    ))
    .groupBy(bankTransactions.matchedOrderId)

  const held = new Map<string, number>()
  for (const row of collected) held.set(row.orderId, (held.get(row.orderId) ?? 0) + row.total)
  for (const row of waiting) if (row.orderId) held.set(row.orderId, (held.get(row.orderId) ?? 0) + row.total)

  return rows.map(row => ({
    id: row.id,
    publicCode: row.publicCode,
    totalVnd: row.totalVnd,
    heldVnd: held.get(row.id) ?? 0,
    createdAt: row.createdAt.toISOString(),
  }))
}

// Lock order matches the matcher (bank transaction rows, then attempts, then the order) so a refund never
// deadlocks with a transfer being matched to the same order.
export async function markOrderRefunded(db: Db, ctx: ActorScope, input: { orderId: string, note: string }): Promise<void> {
  if (!uuid.safeParse(input.orderId).success) throw notFound()
  await db.transaction(async (tx) => {
    const linked = await tx.update(bankTransactions).set({
      reconciliationStatus: 'RESOLVED',
      resolution: 'REFUNDED_OUTSIDE',
      resolutionNote: input.note,
      resolvedBy: ctx.userId,
      resolvedAt: new Date(),
    }).where(and(
      eq(bankTransactions.orgId, ctx.orgId),
      eq(bankTransactions.matchedOrderId, input.orderId),
      eq(bankTransactions.reconciliationStatus, 'REVIEW_REQUIRED'),
      eq(bankTransactions.reviewReason, 'ORDER_CANCELLED'),
    )).returning({ id: bankTransactions.id })

    const { order } = await lockOrderGraph(tx, { orgId: ctx.orgId, storeId: ctx.storeId, orderId: input.orderId })
    if (!order) throw notFound()
    if (order.paymentStatus !== 'REFUND_DUE') throw new AppError('STATUS_CONFLICT', 'Đơn không ở trạng thái cần hoàn tiền')

    await tx.update(orders).set({ paymentStatus: 'REFUNDED' }).where(eq(orders.id, order.id))
    await tx.insert(orderEvents).values({
      orgId: order.orgId,
      storeId: order.storeId,
      orderId: order.id,
      actorUserId: ctx.userId,
      eventType: 'PAYMENT_REFUNDED',
      metadata: { note: input.note },
    })
    for (const { id } of linked) {
      await tx.insert(bankTransactionEvents).values({
        orgId: ctx.orgId,
        bankTransactionId: id,
        action: 'RESOLVED',
        fromStatus: 'REVIEW_REQUIRED',
        toStatus: 'RESOLVED',
        orderId: order.id,
        actorUserId: ctx.userId,
        metadata: { resolution: 'REFUNDED_OUTSIDE' },
      })
    }
  })
}

export async function listOverdueOrders(db: Db, scope: StoreScope): Promise<OverdueOrder[]> {
  const rows = await db.select({
    id: orders.id,
    publicCode: orders.publicCode,
    totalVnd: orders.totalVnd,
    paymentStatus: orders.paymentStatus,
    createdAt: orders.createdAt,
  }).from(orders).where(overdueWhere(scope)).orderBy(asc(orders.createdAt)).limit(100)
  return rows.map(row => ({
    id: row.id,
    publicCode: row.publicCode,
    totalVnd: row.totalVnd,
    paymentStatus: row.paymentStatus as OverdueOrder['paymentStatus'],
    createdAt: row.createdAt.toISOString(),
  }))
}

export async function markOrderPaidBankManual(
  db: Db,
  ctx: ActorScope,
  input: { orderId: string, expectedPaymentStatus: 'PENDING' | 'REVIEW_REQUIRED', note: string },
): Promise<{ orderId: string }> {
  if (!uuid.safeParse(input.orderId).success) throw notFound()
  return db.transaction(async (tx) => {
    const { attempts, order } = await lockOrderGraph(tx, { orgId: ctx.orgId, storeId: ctx.storeId, orderId: input.orderId })
    if (!order) throw notFound()
    if (order.status !== 'AWAITING_PAYMENT' || order.paymentStatus !== input.expectedPaymentStatus) {
      throw new AppError('STATUS_CONFLICT', 'Trạng thái thanh toán của đơn đã thay đổi')
    }
    await confirmOrderPayment(tx, {
      order,
      method: 'BANK_MANUAL',
      amountVnd: order.totalVnd,
      bankTransactionId: null,
      paymentCodeAttemptId: null,
      actorUserId: ctx.userId,
      late: !attempts.some(a => a.status === 'PENDING'),
      eventType: 'PAYMENT_MANUAL_BANK',
      note: input.note,
      metadata: { note: input.note },
    })
    return { orderId: order.id }
  })
}

export async function getReconciliationSummary(db: Db, scope: StoreScope): Promise<ReconciliationSummary> {
  const [review] = await db.select({ n: sql<number>`count(*)::int` }).from(bankTransactions)
    .where(and(eq(bankTransactions.orgId, scope.orgId), eq(bankTransactions.reconciliationStatus, 'REVIEW_REQUIRED')))
  const [refund] = await db.select({ n: sql<number>`count(*)::int` }).from(orders)
    .where(and(eq(orders.orgId, scope.orgId), eq(orders.storeId, scope.storeId), eq(orders.paymentStatus, 'REFUND_DUE')))
  const [overdue] = await db.select({ n: sql<number>`count(*)::int` }).from(orders).where(overdueWhere(scope))
  return { reviewCount: review!.n, refundDueCount: refund!.n, overdueCount: overdue!.n }
}
```

- [ ] **Step 4: Chạy, thấy PASS**

Run: `npm run test:integration -- tests/integration/manual-payments.test.ts`
Expected: PASS.

- [ ] **Step 5: Tạo các route**

`server/api/stores/[storeId]/reconciliation/summary.get.ts`:

```ts
import { getRouterParam } from 'h3'
import { requireStoreOwner } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { getReconciliationSummary } from '../../../../services/payments/manual-payments'
import { defineApiHandler } from '../../../../utils/api-handler'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  return getReconciliationSummary(getDb(), ctx)
})
```

`server/api/stores/[storeId]/reconciliation/refunds.get.ts`:

```ts
import { getRouterParam } from 'h3'
import { requireStoreOwner } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { listRefundDueOrders } from '../../../../services/payments/manual-payments'
import { defineApiHandler } from '../../../../utils/api-handler'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  return { items: await listRefundDueOrders(getDb(), ctx) }
})
```

`server/api/stores/[storeId]/reconciliation/overdue.get.ts`:

```ts
import { getRouterParam } from 'h3'
import { requireStoreOwner } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { listOverdueOrders } from '../../../../services/payments/manual-payments'
import { defineApiHandler } from '../../../../utils/api-handler'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  return { items: await listOverdueOrders(getDb(), ctx) }
})
```

`server/api/stores/[storeId]/orders/[orderId]/refunded.post.ts`:

```ts
import { getRouterParam } from 'h3'
import { noteInputSchema } from '#shared/schemas/reconciliation'
import { requireStoreOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { markOrderRefunded } from '../../../../../services/payments/manual-payments'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { parseBody } from '../../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const { note } = await parseBody(event, noteInputSchema)
  await markOrderRefunded(getDb(), ctx, { orderId: getRouterParam(event, 'orderId') ?? '', note })
  return { ok: true }
})
```

- [ ] **Step 6: Mở rộng route `mark-paid` của PR4 cho `BANK_MANUAL`**

Mở `server/api/stores/[storeId]/orders/[orderId]/mark-paid.post.ts`. Thêm các import còn thiếu (`readBody` từ `h3` nếu chưa có, `bankManualInputSchema`, `requireStoreOwner`, `markOrderPaidBankManual`, `parseWith`) rồi chèn **ngay đầu** thân handler (trước logic `CASH` của PR4; `readBody` của h3 được cache nên PR4 vẫn đọc lại được body):

```ts
  const peek = await readBody(event).catch(() => null)
  if (peek && typeof peek === 'object' && (peek as { method?: unknown }).method === 'BANK_MANUAL') {
    const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
    const input = parseWith(bankManualInputSchema, peek)
    return markOrderPaidBankManual(getDb(), ctx, {
      orderId: getRouterParam(event, 'orderId') ?? '',
      expectedPaymentStatus: input.expectedPaymentStatus,
      note: input.note,
    })
  }
```

PR4 dùng `requireStoreStaff` rồi `parseBody(event, markPaidSchema)` với `method: 'CASH'`, nên nhánh `BANK_MANUAL` **phải** nằm trước hai dòng đó; nhánh `CASH` giữ nguyên hành vi (staff vẫn được phép) và `markPaidSchema` không đổi.

- [ ] **Step 7: Thêm hàng ma trận tenant**

Thêm vào **cuối** `tests/api/tenant-isolation.test.ts` (dùng `call`, `tokens`, `ids`, `errorCodes`, `Actor`, các import đã thêm ở Task 8):

```ts
describe('reconciliation extras (PR6)', () => {
  let setupA2: PaymentSetup

  const orderOf = async (id: string) => (await getDb().select().from(orders).where(eq(orders.id, id)))[0]!

  beforeAll(async () => {
    // Second store of tenant A: shares A's single open SePay integration (PR5 allows one per environment).
    setupA2 = await createPaymentSetup({ org: { id: ids.orgA }, store: { id: ids.storeA2, orgId: ids.orgA } }, { reuse: setupA })
  })

  it.each(['summary', 'refunds', 'overdue'])('GET reconciliation/%s: only the store owner (403 staff, 404 outsiders)', async (leaf) => {
    const expected: [Actor, number][] = [['ownerA', 200], ['staffA1', 403], ['staffA2', 404], ['disabledA1', 404], ['ownerB', 404]]
    for (const [actor, status] of expected) {
      const res = await call('GET', `/api/stores/${ids.storeA1}/reconciliation/${leaf}`, tokens[actor])
      expect(res.status, `${leaf} as ${actor}`).toBe(status)
    }
  })

  it.each<[Actor, number]>([
    ['staffA1', 403],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
    ['ownerA', 200],
  ])('POST orders/:id/refunded: %s → %i', async (actor, status) => {
    const { order } = await createAwaitingOrder(setupA, { orderStatus: 'CANCELLED', paymentStatus: 'REFUND_DUE', attemptStatus: 'EXPIRED' })
    const res = await call('POST', `/api/stores/${ids.storeA1}/orders/${order.id}/refunded`, tokens[actor], { note: 'Đã hoàn tiền' })
    expect(res.status).toBe(status)
    expect((await orderOf(order.id)).paymentStatus).toBe(status === 200 ? 'REFUNDED' : 'REFUND_DUE')
  })

  it('refunded requires a note (400) and cannot reach an order of another store in the same org (404)', async () => {
    const mine = await createAwaitingOrder(setupA, { orderStatus: 'CANCELLED', paymentStatus: 'REFUND_DUE' })
    const sibling = await createAwaitingOrder(setupA2, { orderStatus: 'CANCELLED', paymentStatus: 'REFUND_DUE' })
    expect(await call('POST', `/api/stores/${ids.storeA1}/orders/${mine.order.id}/refunded`, tokens.ownerA, {}))
      .toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
    expect(await call('POST', `/api/stores/${ids.storeA1}/orders/${sibling.order.id}/refunded`, tokens.ownerA, { note: 'Đã hoàn tiền' }))
      .toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
    expect((await orderOf(sibling.order.id)).paymentStatus).toBe('REFUND_DUE')
  })

  it.each<[Actor, number]>([
    ['staffA1', 403],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
    ['ownerA', 200],
  ])('POST orders/:id/mark-paid BANK_MANUAL: %s → %i (staff may only record CASH)', async (actor, status) => {
    const { order } = await createAwaitingOrder(setupA, { attemptStatus: 'EXPIRED' })
    const body = { method: 'BANK_MANUAL', expectedPaymentStatus: 'PENDING', note: 'Đã thấy tiền trong app' }
    const res = await call('POST', `/api/stores/${ids.storeA1}/orders/${order.id}/mark-paid`, tokens[actor], body)
    expect(res.status).toBe(status)
    expect((await orderOf(order.id)).paymentStatus).toBe(status === 200 ? 'PAID' : 'PENDING')
    if (status === 200) {
      expect(await call('POST', `/api/stores/${ids.storeA1}/orders/${order.id}/mark-paid`, tokens.ownerA, body))
        .toMatchObject({ status: 409, body: { code: 'STATUS_CONFLICT' } })
    }
  })

  it('BANK_MANUAL needs a note and a valid expected status (400) and never touches tenant B\'s order', async () => {
    const mine = await createAwaitingOrder(setupA, { attemptStatus: 'EXPIRED' })
    const theirs = await createAwaitingOrder(setupB, { attemptStatus: 'EXPIRED' })
    expect(await call('POST', `/api/stores/${ids.storeA1}/orders/${mine.order.id}/mark-paid`, tokens.ownerA, { method: 'BANK_MANUAL', expectedPaymentStatus: 'PENDING' }))
      .toMatchObject({ status: 400 })
    expect(await call('POST', `/api/stores/${ids.storeA1}/orders/${theirs.order.id}/mark-paid`, tokens.ownerA, { method: 'BANK_MANUAL', expectedPaymentStatus: 'PENDING', note: 'abc' }))
      .toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
    expect((await orderOf(theirs.order.id)).paymentStatus).toBe('PENDING')
  })
})
```

- [ ] **Step 8: Chạy**

Run: `npm run test:api -- tests/api/tenant-isolation.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/services/payments/manual-payments.ts server/api/stores tests/integration/manual-payments.test.ts tests/api/tenant-isolation.test.ts
git commit -m "feat(payment-webhook): add refund, overdue and manual bank confirmation

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 10: UI chủ quán `/app/reconciliation` (một chạm "Gán vào đơn", "Hoàn/bỏ qua")

**Files:**
- Create: `app/utils/reconciliation.ts`, `app/composables/useReconciliation.ts`, `app/components/app/ReconciliationReviewCard.vue`, `app/components/app/ReconciliationOrderCard.vue`, `app/pages/app/reconciliation.vue`
- Modify: `app/layouts/owner.vue` (mục điều hướng "Đối soát" + badge), `app/utils/order-view.ts` (`describeEvent` cho event thanh toán của PR6), `tests/unit/app/order-view.test.ts`
- Test: `tests/unit/app/reconciliation-utils.test.ts`, `tests/nuxt/app/reconciliation-review-card.test.ts`, `tests/nuxt/app/reconciliation-order-card.test.ts`

**Interfaces:**
- Consumes: API Task 8–9 (`/api/stores/:id/reconciliation…`, `…/orders/:orderId/refunded`, `…/orders/:orderId/mark-paid`); `useApi`, `useActiveStore` (`activeStore.role`), `extractApiError`, `describeEvent`, `formatDateTime` (PR4, `app/utils/order-view.ts`), `allNavItems`/`navItems` có cờ `ownerOnly` (PR4, `app/layouts/owner.vue`), `AppPageHeader`, `AppEmptyState`, `ZButton`, `ZCard`, `ZAlert`, `ZBadge`, `ZInput`, `ZFormField`; `formatVnd` (`#shared/money`); DTO/enum ở `#shared/payments`, `#shared/types/reconciliation`.
- Produces:
  - `compareAmount(receivedVnd: number, expectedVnd: number): { kind: 'EXACT' } | { kind: 'UNDER' | 'OVER', diffVnd: number }`; `reasonStatus(reason: ReviewReason | null): 'warning' | 'error' | 'info'`. Giờ hiển thị dùng lại `formatDateTime(iso)` của PR4 (`app/utils/order-view.ts`, giờ `Asia/Ho_Chi_Minh`) — không định nghĩa lại để tránh trùng tên auto-import.
  - `useReconciliation()` (các hàm gọi API ở trên); `useReconciliationBadge(): { count: Ref<number>, isOwner: ComputedRef<boolean>, refresh: () => Promise<void> }`.
  - `<AppReconciliationReviewCard :item :busy @assign="(orderId, acceptAmountDifference)" @resolve="(resolution, note)">` và `<AppReconciliationOrderCard kind="refund|overdue" :order :busy @confirm="(note)">`.
  - Trang `/app/reconciliation` (owner): 4 tab "Cần xử lý", "Hoàn tiền", "Quá hạn", "Đã xử lý"; loading/empty/error; poll 15 s khi tab hiển thị.
  - **Số thao tác:** giao dịch có đơn gợi ý khớp tiền → **1 chạm** "Gán vào đơn #CODE"; lệch tiền → 2 chạm (chạm lần hai là xác nhận chênh lệch); "Hoàn/bỏ qua" → mở 4 lựa chọn, **1 chạm** chọn lý do (riêng "Khác" cần ghi chú).

- [ ] **Step 1: Viết unit test thất bại cho helper**

`tests/unit/app/reconciliation-utils.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { compareAmount, reasonStatus } from '../../../app/utils/reconciliation'

describe('compareAmount', () => {
  it('reports an exact match, under- and over-payment with the absolute difference', () => {
    expect(compareAmount(55_000, 55_000)).toEqual({ kind: 'EXACT' })
    expect(compareAmount(50_000, 55_000)).toEqual({ kind: 'UNDER', diffVnd: 5_000 })
    expect(compareAmount(60_000, 55_000)).toEqual({ kind: 'OVER', diffVnd: 5_000 })
  })
})

describe('reasonStatus', () => {
  it('uses error for money that probably must be returned, warning for amount issues, info otherwise', () => {
    expect(reasonStatus('ORDER_CANCELLED')).toBe('error')
    expect(reasonStatus('ORDER_ALREADY_PAID')).toBe('error')
    expect(reasonStatus('AMOUNT_UNDER')).toBe('warning')
    expect(reasonStatus('AMOUNT_OVER')).toBe('warning')
    expect(reasonStatus('NO_CODE')).toBe('info')
    expect(reasonStatus(null)).toBe('info')
  })
})
```

- [ ] **Step 2: Chạy, thấy FAIL**

Run: `npm run test:unit -- tests/unit/app/reconciliation-utils.test.ts`
Expected: FAIL (không resolve `app/utils/reconciliation`).

- [ ] **Step 3: Cài đặt `app/utils/reconciliation.ts`**

```ts
import type { ReviewReason } from '#shared/payments'

export type AmountComparison = { kind: 'EXACT' } | { kind: 'UNDER' | 'OVER', diffVnd: number }

export function compareAmount(receivedVnd: number, expectedVnd: number): AmountComparison {
  if (receivedVnd === expectedVnd) return { kind: 'EXACT' }
  return receivedVnd < expectedVnd
    ? { kind: 'UNDER', diffVnd: expectedVnd - receivedVnd }
    : { kind: 'OVER', diffVnd: receivedVnd - expectedVnd }
}

export function reasonStatus(reason: ReviewReason | null): 'warning' | 'error' | 'info' {
  if (reason === 'ORDER_CANCELLED' || reason === 'ORDER_ALREADY_PAID') return 'error'
  if (reason === 'AMOUNT_UNDER' || reason === 'AMOUNT_OVER') return 'warning'
  return 'info'
}
```

- [ ] **Step 4: Chạy, thấy PASS**

Run: `npm run test:unit -- tests/unit/app/reconciliation-utils.test.ts`
Expected: PASS.

- [ ] **Step 5: Viết test component thất bại**

`tests/nuxt/app/reconciliation-review-card.test.ts`:

```ts
import { renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import type { ReviewItem } from '#shared/types/reconciliation'
import AppReconciliationReviewCard from '~/components/app/ReconciliationReviewCard.vue'

const order = (over: Record<string, unknown> = {}) => ({
  id: 'order-1', storeId: 's1', publicCode: 'AB12CD', status: 'AWAITING_PAYMENT', paymentStatus: 'PENDING', totalVnd: 70_000, ...over,
})

function item(over: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: 'tx-1',
    status: 'REVIEW_REQUIRED',
    reason: 'NO_CODE',
    amountVnd: 70_000,
    accountLast4: '1234',
    content: 'ck tra sua',
    referenceCode: 'FT1',
    source: 'WEBHOOK',
    transactionDate: '2026-11-01T11:30:00.000Z',
    receivedAt: '2026-11-01T11:30:05.000Z',
    resolution: null,
    matchedOrder: null,
    suggestedOrders: [order()],
    ...over,
  }
}

function render(props: Record<string, unknown>) {
  const onAssign = vi.fn()
  const onResolve = vi.fn()
  return { onAssign, onResolve, done: renderSuspended(AppReconciliationReviewCard, { props: { onAssign, onResolve, ...props } }) }
}

describe('AppReconciliationReviewCard', () => {
  it('shows amount, reason, transfer content and masked account', async () => {
    await render({ item: item() }).done
    expect(screen.getByText('70.000đ')).toBeTruthy()
    expect(screen.getByText('Không thấy mã thanh toán trong nội dung chuyển khoản')).toBeTruthy()
    expect(screen.getByText('ck tra sua')).toBeTruthy()
    expect(screen.getByText(/1234/)).toBeTruthy()
  })

  it('assigns to the exact-amount order with a single tap', async () => {
    const { onAssign, done } = render({ item: item() })
    await done
    await fireEvent.click(screen.getByRole('button', { name: 'Gán vào đơn #AB12CD' }))
    expect(onAssign).toHaveBeenCalledTimes(1)
    expect(onAssign).toHaveBeenCalledWith('order-1', false)
  })

  it('needs a second tap to accept an amount difference, and says how much', async () => {
    const { onAssign, done } = render({ item: item({ amountVnd: 60_000, reason: 'AMOUNT_UNDER', matchedOrder: order({ totalVnd: 70_000 }), suggestedOrders: [order({ totalVnd: 70_000 })] }) })
    await done
    await fireEvent.click(screen.getByRole('button', { name: /Gán vào đơn #AB12CD/ }))
    expect(onAssign).not.toHaveBeenCalled()
    const confirm = screen.getByRole('button', { name: /Xác nhận nhận thiếu 10\.000đ/ })
    await fireEvent.click(confirm)
    expect(onAssign).toHaveBeenCalledWith('order-1', true)
  })

  it('offers no assign button when no order matches, but still lets the owner resolve', async () => {
    const { onResolve, done } = render({ item: item({ suggestedOrders: [] }) })
    await done
    expect(screen.queryByRole('button', { name: /Gán vào đơn/ })).toBeNull()
    expect(screen.getByText(/Chưa thấy đơn nào khớp/)).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Hoàn/bỏ qua' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Đã hoàn tiền cho khách' }))
    expect(onResolve).toHaveBeenCalledWith('REFUNDED_OUTSIDE', undefined)
  })

  it('"Khác" asks for a note of at least 3 characters before resolving', async () => {
    const { onResolve, done } = render({ item: item({ suggestedOrders: [] }) })
    await done
    await fireEvent.click(screen.getByRole('button', { name: 'Hoàn/bỏ qua' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Khác' }))
    const confirm = screen.getByRole('button', { name: 'Xác nhận' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    await fireEvent.update(screen.getByLabelText('Ghi chú'), 'Khách chuyển nhầm')
    expect(confirm.disabled).toBe(false)
    await fireEvent.click(confirm)
    expect(onResolve).toHaveBeenCalledWith('OTHER', 'Khách chuyển nhầm')
  })

  it('disables every action while busy', async () => {
    await render({ item: item(), busy: true }).done
    expect((screen.getByRole('button', { name: /Gán vào đơn/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Hoàn/bỏ qua' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows read-only history for resolved items (no actions)', async () => {
    await render({ item: item({ status: 'RESOLVED', resolution: 'DUPLICATE', suggestedOrders: [] }) }).done
    expect(screen.getByText('Giao dịch trùng')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Hoàn/bỏ qua' })).toBeNull()
  })
})
```

`tests/nuxt/app/reconciliation-order-card.test.ts`:

```ts
import { renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import AppReconciliationOrderCard from '~/components/app/ReconciliationOrderCard.vue'

const order = { id: 'o1', publicCode: 'ZZ99XY', totalVnd: 55_000, heldVnd: 55_000 }

function render(props: Record<string, unknown>) {
  const onConfirm = vi.fn()
  return { onConfirm, done: renderSuspended(AppReconciliationOrderCard, { props: { order, onConfirm, ...props } }) }
}

describe('AppReconciliationOrderCard', () => {
  it('refund: shows the amount to return and confirms with a prefilled editable note', async () => {
    const { onConfirm, done } = render({ kind: 'refund' })
    await done
    expect(screen.getByText('#ZZ99XY')).toBeTruthy()
    expect(screen.getByText(/Cần hoàn 55\.000đ/)).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Đã hoàn tiền' }))
    expect((screen.getByLabelText('Ghi chú') as HTMLInputElement).value).toBe('Đã hoàn tiền qua chuyển khoản')
    await fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }))
    expect(onConfirm).toHaveBeenCalledWith('Đã hoàn tiền qua chuyển khoản')
  })

  it('overdue: manual bank confirmation needs a note and cannot be confirmed empty', async () => {
    const { onConfirm, done } = render({ kind: 'overdue', order: { ...order, heldVnd: undefined } })
    await done
    await fireEvent.click(screen.getByRole('button', { name: 'Đã nhận tiền thủ công' }))
    await fireEvent.update(screen.getByLabelText('Ghi chú'), ' ')
    expect((screen.getByRole('button', { name: 'Xác nhận' }) as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.update(screen.getByLabelText('Ghi chú'), 'Thấy tiền trong app VCB')
    await fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }))
    expect(onConfirm).toHaveBeenCalledWith('Thấy tiền trong app VCB')
  })

  it('can be cancelled without emitting', async () => {
    const { onConfirm, done } = render({ kind: 'refund' })
    await done
    await fireEvent.click(screen.getByRole('button', { name: 'Đã hoàn tiền' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Hủy' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Ghi chú')).toBeNull()
  })
})
```

- [ ] **Step 6: Chạy, thấy FAIL**

Run: `npm run test:nuxt -- tests/nuxt/app/reconciliation-review-card.test.ts tests/nuxt/app/reconciliation-order-card.test.ts`
Expected: FAIL (không resolve component).

- [ ] **Step 7: Cài đặt `ReconciliationReviewCard.vue`**

```vue
<script setup lang="ts">
import { formatVnd } from '#shared/money'
import { RESOLUTIONS, RESOLUTION_LABEL, REVIEW_REASON_LABEL, type Resolution } from '#shared/payments'
import type { ReviewItem } from '#shared/types/reconciliation'

const props = defineProps<{ item: ReviewItem, busy?: boolean }>()
const emit = defineEmits<{
  assign: [orderId: string, acceptAmountDifference: boolean]
  resolve: [resolution: Resolution, note: string | undefined]
}>()

const quickResolutions = RESOLUTIONS.filter(r => r !== 'OTHER')
const isOpen = computed(() => props.item.status === 'REVIEW_REQUIRED')
const suggestion = computed(() => props.item.suggestedOrders[0] ?? null)
const comparison = computed(() => (suggestion.value ? compareAmount(props.item.amountVnd, suggestion.value.totalVnd) : null))

const armed = ref(false)
const choosing = ref(false)
const writingNote = ref(false)
const note = ref('')

const assignLabel = computed(() => {
  const code = suggestion.value?.publicCode
  const diff = comparison.value
  if (!diff || diff.kind === 'EXACT') return `Gán vào đơn #${code}`
  const word = diff.kind === 'UNDER' ? 'thiếu' : 'thừa'
  return armed.value ? `Xác nhận nhận ${word} ${formatVnd(diff.diffVnd)}` : `Gán vào đơn #${code} (${word} ${formatVnd(diff.diffVnd)})`
})

function assign() {
  if (!suggestion.value) return
  if (comparison.value && comparison.value.kind !== 'EXACT' && !armed.value) {
    armed.value = true
    return
  }
  emit('assign', suggestion.value.id, armed.value)
}

function resolveWith(resolution: Resolution) {
  emit('resolve', resolution, undefined)
}

function confirmOther() {
  emit('resolve', 'OTHER', note.value.trim())
}
</script>

<template>
  <ZCard variant="raised" padding="md">
    <div class="flex flex-col gap-3">
      <div class="flex items-start justify-between gap-3">
        <p class="font-mono text-xl font-medium text-default">
          {{ formatVnd(item.amountVnd) }}
        </p>
        <ZBadge v-if="item.status === 'RESOLVED' && item.resolution" status="success" size="sm">
          {{ RESOLUTION_LABEL[item.resolution] }}
        </ZBadge>
      </div>

      <p v-if="item.reason" class="text-sm font-medium" :class="{ 'text-error': reasonStatus(item.reason) === 'error', 'text-warning': reasonStatus(item.reason) === 'warning' }">
        {{ REVIEW_REASON_LABEL[item.reason] }}
      </p>

      <dl class="grid gap-1 text-sm text-muted">
        <div v-if="item.content" class="flex gap-2">
          <dt class="shrink-0">
            Nội dung:
          </dt>
          <dd class="min-w-0 break-words text-default">
            {{ item.content }}
          </dd>
        </div>
        <div class="flex gap-2">
          <dt class="shrink-0">
            Tài khoản nhận:
          </dt>
          <dd class="font-mono text-default">
            ••••{{ item.accountLast4 }} · {{ formatDateTime(item.transactionDate) }}
          </dd>
        </div>
        <div v-if="item.matchedOrder" class="flex gap-2">
          <dt class="shrink-0">
            Mã trên giao dịch thuộc:
          </dt>
          <dd class="font-mono text-default">
            #{{ item.matchedOrder.publicCode }} ({{ formatVnd(item.matchedOrder.totalVnd) }})
          </dd>
        </div>
      </dl>

      <template v-if="isOpen">
        <ZButton v-if="suggestion" size="lg" block :variant="armed ? 'destructive' : 'primary'" :disabled="busy" :loading="busy" @click="assign">
          {{ assignLabel }}
        </ZButton>
        <ZAlert v-else color="info" description="Chưa thấy đơn nào khớp số tiền này. Kiểm tra lại với khách hoặc chọn Hoàn/bỏ qua." />

        <ZButton v-if="!choosing" variant="secondary" block :disabled="busy" @click="choosing = true">
          Hoàn/bỏ qua
        </ZButton>
        <div v-else class="flex flex-col gap-2">
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <ZButton v-for="resolution in quickResolutions" :key="resolution" variant="secondary" :disabled="busy" @click="resolveWith(resolution)">
              {{ RESOLUTION_LABEL[resolution] }}
            </ZButton>
            <ZButton variant="secondary" :disabled="busy" @click="writingNote = true">
              {{ RESOLUTION_LABEL.OTHER }}
            </ZButton>
          </div>
          <div v-if="writingNote" class="flex flex-col gap-2">
            <ZFormField label="Ghi chú">
              <ZInput v-model="note" placeholder="Ví dụ: khách chuyển nhầm, đã trả lại" />
            </ZFormField>
            <ZButton :disabled="busy || note.trim().length < 3" @click="confirmOther">
              Xác nhận
            </ZButton>
          </div>
        </div>
      </template>
    </div>
  </ZCard>
</template>
```

- [ ] **Step 8: Cài đặt `ReconciliationOrderCard.vue`**

```vue
<script setup lang="ts">
import { formatVnd } from '#shared/money'

const props = defineProps<{
  kind: 'refund' | 'overdue'
  order: { id: string, publicCode: string, totalVnd: number, heldVnd?: number }
  busy?: boolean
}>()
const emit = defineEmits<{ confirm: [note: string] }>()

const copy = {
  refund: { action: 'Đã hoàn tiền', note: 'Đã hoàn tiền qua chuyển khoản' },
  overdue: { action: 'Đã nhận tiền thủ công', note: 'Đã thấy tiền trong tài khoản ngân hàng' },
} as const

const open = ref(false)
const note = ref('')

function start() {
  note.value = copy[props.kind].note
  open.value = true
}

function confirm() {
  emit('confirm', note.value.trim())
}
</script>

<template>
  <ZCard variant="raised" padding="md">
    <div class="flex flex-col gap-3">
      <div class="flex items-start justify-between gap-3">
        <p class="font-mono text-lg font-medium text-default">
          #{{ order.publicCode }}
        </p>
        <p class="font-mono text-default">
          {{ formatVnd(order.totalVnd) }}
        </p>
      </div>
      <p v-if="kind === 'refund'" class="text-sm font-medium text-error">
        Cần hoàn {{ formatVnd(order.heldVnd ?? order.totalVnd) }} cho khách
      </p>
      <p v-else class="text-sm text-muted">
        Mã QR đã hết hạn, chưa thấy tiền về. Nếu bạn đã thấy tiền trong app ngân hàng, hãy xác nhận thủ công.
      </p>

      <ZButton v-if="!open" :variant="kind === 'refund' ? 'primary' : 'secondary'" block :disabled="busy" @click="start">
        {{ copy[kind].action }}
      </ZButton>
      <div v-else class="flex flex-col gap-2">
        <ZFormField label="Ghi chú">
          <ZInput v-model="note" />
        </ZFormField>
        <div class="flex gap-2">
          <ZButton class="flex-1" :disabled="busy || note.trim().length < 3" :loading="busy" @click="confirm">
            Xác nhận
          </ZButton>
          <ZButton variant="ghost" :disabled="busy" @click="open = false">
            Hủy
          </ZButton>
        </div>
      </div>
    </div>
  </ZCard>
</template>
```

- [ ] **Step 9: Chạy test component, thấy PASS**

Run: `npm run test:nuxt -- tests/nuxt/app/reconciliation-review-card.test.ts tests/nuxt/app/reconciliation-order-card.test.ts`
Expected: PASS. (Nếu `getByLabelText('Ghi chú')` không khớp do `UFormField` không gắn `for`, xem `copy-field.test.ts` — cùng pattern `ZFormField` + `ZInput` đang chạy.)

- [ ] **Step 10: Composable**

`app/composables/useReconciliation.ts`:

```ts
import type { Resolution } from '#shared/payments'
import type { OverdueOrder, ReconciliationSummary, RefundDueOrder, ReviewItem } from '#shared/types/reconciliation'

export function useReconciliation() {
  const api = useApi()
  const { activeStore } = useActiveStore()

  function base(): string {
    if (!activeStore.value) throw new Error('Chưa chọn cửa hàng')
    return `/api/stores/${activeStore.value.id}`
  }

  return {
    summary: () => api<ReconciliationSummary>(`${base()}/reconciliation/summary`),
    listReview: (status: 'REVIEW_REQUIRED' | 'RESOLVED') =>
      api<{ items: ReviewItem[] }>(`${base()}/reconciliation`, { query: { status } }),
    listRefunds: () => api<{ items: RefundDueOrder[] }>(`${base()}/reconciliation/refunds`),
    listOverdue: () => api<{ items: OverdueOrder[] }>(`${base()}/reconciliation/overdue`),
    assign: (transactionId: string, orderId: string, acceptAmountDifference: boolean) =>
      api(`${base()}/reconciliation/${transactionId}/assign`, { method: 'POST', body: { orderId, acceptAmountDifference } }),
    resolve: (transactionId: string, resolution: Resolution, note?: string) =>
      api(`${base()}/reconciliation/${transactionId}/resolve`, { method: 'POST', body: { resolution, note } }),
    markRefunded: (orderId: string, note: string) =>
      api(`${base()}/orders/${orderId}/refunded`, { method: 'POST', body: { note } }),
    markPaidManually: (orderId: string, expectedPaymentStatus: OverdueOrder['paymentStatus'], note: string) =>
      api(`${base()}/orders/${orderId}/mark-paid`, { method: 'POST', body: { method: 'BANK_MANUAL', expectedPaymentStatus, note } }),
  }
}

export function useReconciliationBadge() {
  const { activeStore } = useActiveStore()
  const reconciliation = useReconciliation()
  const count = useState<number>('reconciliation:badge', () => 0)
  const isOwner = computed(() => activeStore.value?.role === 'OWNER')

  async function refresh(): Promise<void> {
    if (!isOwner.value) {
      count.value = 0
      return
    }
    try {
      const summary = await reconciliation.summary()
      count.value = summary.reviewCount + summary.refundDueCount
    }
    catch {
      // The badge is best-effort; the page itself reports errors.
    }
  }

  return { count, isOwner, refresh }
}
```

- [ ] **Step 11: Trang `/app/reconciliation`**

`app/pages/app/reconciliation.vue`:

```vue
<script setup lang="ts">
import type { Resolution } from '#shared/payments'
import type { OverdueOrder, RefundDueOrder, ReviewItem } from '#shared/types/reconciliation'

definePageMeta({ layout: 'owner', middleware: ['auth', 'has-store'] })
useHead({ title: 'Đối soát' })

type Tab = 'review' | 'refund' | 'overdue' | 'resolved'

const { activeStore } = useActiveStore()
const reconciliation = useReconciliation()
const badge = useReconciliationBadge()
const toast = useToast()

const isOwner = computed(() => activeStore.value?.role === 'OWNER')
const tab = ref<Tab>('review')
const loading = ref(true)
const errorMessage = ref('')
const busyId = ref<string | null>(null)
const review = ref<ReviewItem[]>([])
const resolved = ref<ReviewItem[]>([])
const refunds = ref<RefundDueOrder[]>([])
const overdue = ref<OverdueOrder[]>([])

const tabs = computed(() => [
  { key: 'review' as const, label: 'Cần xử lý', count: review.value.length },
  { key: 'refund' as const, label: 'Hoàn tiền', count: refunds.value.length },
  { key: 'overdue' as const, label: 'Quá hạn', count: overdue.value.length },
  { key: 'resolved' as const, label: 'Đã xử lý', count: 0 },
])

async function load() {
  if (!isOwner.value) return
  try {
    const [a, b, c, d] = await Promise.all([
      reconciliation.listReview('REVIEW_REQUIRED'),
      reconciliation.listRefunds(),
      reconciliation.listOverdue(),
      tab.value === 'resolved' ? reconciliation.listReview('RESOLVED') : Promise.resolve({ items: resolved.value }),
    ])
    review.value = a.items
    refunds.value = b.items
    overdue.value = c.items
    resolved.value = d.items
    errorMessage.value = ''
    void badge.refresh()
  }
  catch (err) {
    errorMessage.value = extractApiError(err).message
  }
  finally {
    loading.value = false
  }
}

async function run(id: string, action: () => Promise<unknown>, success: string) {
  busyId.value = id
  try {
    await action()
    toast.add({ title: success, color: 'success' })
  }
  catch (err) {
    const error = extractApiError(err)
    const message = error.code === 'STATUS_CONFLICT' ? 'Mục này vừa được xử lý ở nơi khác, đã tải lại danh sách' : error.message
    toast.add({ title: message, color: 'error' })
  }
  finally {
    busyId.value = null
    await load()
  }
}

const assign = (item: ReviewItem, orderId: string, accept: boolean) =>
  run(item.id, () => reconciliation.assign(item.id, orderId, accept), 'Đã gán vào đơn')
const resolve = (item: ReviewItem, resolution: Resolution, note: string | undefined) =>
  run(item.id, () => reconciliation.resolve(item.id, resolution, note), 'Đã đánh dấu xử lý')
const refund = (order: RefundDueOrder, note: string) =>
  run(order.id, () => reconciliation.markRefunded(order.id, note), 'Đã ghi nhận hoàn tiền')
const payManually = (order: OverdueOrder, note: string) =>
  run(order.id, () => reconciliation.markPaidManually(order.id, order.paymentStatus, note), 'Đã xác nhận thu tiền')

async function select(next: Tab) {
  tab.value = next
  if (next === 'resolved') await load()
}

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void load()
  timer = setInterval(() => {
    if (document.visibilityState === 'visible' && busyId.value === null) void load()
  }, 15_000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div class="flex flex-col gap-5">
    <AppPageHeader title="Đối soát" description="Tiền đã vào tài khoản nhưng chưa khớp đơn, và các khoản cần hoàn." />

    <ZAlert v-if="!isOwner" color="warning" title="Chỉ chủ quán xem được mục này" />

    <template v-else>
      <div role="tablist" aria-label="Nhóm đối soát" class="flex gap-2 overflow-x-auto pb-1">
        <ZButton
          v-for="t in tabs"
          :key="t.key"
          role="tab"
          size="sm"
          :aria-selected="tab === t.key"
          :variant="tab === t.key ? 'primary' : 'secondary'"
          @click="select(t.key)"
        >
          {{ t.label }}<span v-if="t.count" class="ms-1 font-mono">({{ t.count }})</span>
        </ZButton>
      </div>

      <ZAlert v-if="errorMessage" color="error" title="Không tải được danh sách" :description="errorMessage">
        <template #actions>
          <ZButton variant="secondary" size="sm" @click="load">
            Thử lại
          </ZButton>
        </template>
      </ZAlert>
      <p v-else-if="loading" role="status" class="text-muted">
        Đang tải…
      </p>

      <template v-else>
        <section v-if="tab === 'review'" class="flex flex-col gap-3" aria-label="Giao dịch cần xử lý">
          <AppEmptyState v-if="review.length === 0" icon="i-lucide-circle-check" title="Không có giao dịch nào cần xử lý" description="Tiền khách chuyển khớp đơn sẽ tự được xác nhận." />
          <AppReconciliationReviewCard
            v-for="item in review"
            :key="item.id"
            :item="item"
            :busy="busyId === item.id"
            @assign="(orderId, accept) => assign(item, orderId, accept)"
            @resolve="(resolution, note) => resolve(item, resolution, note)"
          />
        </section>

        <section v-else-if="tab === 'refund'" class="flex flex-col gap-3" aria-label="Đơn cần hoàn tiền">
          <AppEmptyState v-if="refunds.length === 0" icon="i-lucide-hand-coins" title="Không có khoản nào cần hoàn" />
          <AppReconciliationOrderCard v-for="order in refunds" :key="order.id" kind="refund" :order="order" :busy="busyId === order.id" @confirm="note => refund(order, note)" />
        </section>

        <section v-else-if="tab === 'overdue'" class="flex flex-col gap-3" aria-label="Đơn quá hạn thanh toán">
          <AppEmptyState v-if="overdue.length === 0" icon="i-lucide-clock" title="Không có đơn nào quá hạn" description="Đơn chờ chuyển khoản mà mã QR đã hết hạn sẽ hiện ở đây." />
          <AppReconciliationOrderCard v-for="order in overdue" :key="order.id" kind="overdue" :order="order" :busy="busyId === order.id" @confirm="note => payManually(order, note)" />
        </section>

        <section v-else class="flex flex-col gap-3" aria-label="Đã xử lý">
          <AppEmptyState v-if="resolved.length === 0" icon="i-lucide-history" title="Chưa có giao dịch nào được xử lý" />
          <AppReconciliationReviewCard v-for="item in resolved" :key="item.id" :item="item" />
        </section>
      </template>
    </template>
  </div>
</template>
```

- [ ] **Step 12: Thêm mục "Đối soát" vào layout owner và mô tả event thanh toán trong lịch sử đơn**

`app/layouts/owner.vue` (PR4 đã đổi thành `allNavItems` + `navItems = computed(filter ownerOnly)`):

1. Thêm một phần tử vào mảng `allNavItems`, ngay trước mục "Cài đặt", giữ nguyên mọi phần tử khác:

```ts
  { label: 'Đối soát', to: '/app/reconciliation', icon: 'i-lucide-banknote', ownerOnly: true },
```

2. Thêm kiểu `badge` và poll số cần xử lý. Đổi khai báo kiểu của `allNavItems` thành `{ label: string, to: string, icon: string, ownerOnly?: boolean }[]` (không đổi) và thêm bên dưới `navItems`:

```ts
const { count: reconciliationCount, refresh: refreshBadge } = useReconciliationBadge()
const badgeFor = (to: string): number => (to === '/app/reconciliation' ? reconciliationCount.value : 0)

let badgeTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void refreshBadge()
  badgeTimer = setInterval(() => {
    if (document.visibilityState === 'visible') void refreshBadge()
  }, 60_000)
})
onBeforeUnmount(() => clearInterval(badgeTimer))
```

3. Trong **cả hai** khối `<NuxtLink v-for="item in navItems">` (sidebar và bottom nav), ngay sau `{{ item.label }}` thêm:

```vue
<span
  v-if="badgeFor(item.to) > 0"
  class="ms-auto min-w-6 rounded-full bg-error px-1.5 text-center font-mono text-xs font-semibold text-white"
  :aria-label="`${badgeFor(item.to)} mục cần xử lý`"
>{{ badgeFor(item.to) }}</span>
```

(bottom nav tối đa 5 mục theo PR4: owner có thêm "Đối soát" thì bỏ icon của mục ít dùng nhất khỏi bottom nav hoặc để thanh cuộn ngang; quyết định theo thiết kế PR4, ghi vào mô tả PR.)

`app/utils/order-view.ts`: thêm hằng và nhánh sau vào `describeEvent` (PR4 hiện chỉ biết `CANCELLED`, `PAYMENT_RECORDED`, `CREATED`), ngay trước dòng `return event.toState ? …`:

```ts
const PAYMENT_EVENT_LABELS: Record<string, string> = {
  PAYMENT_CONFIRMED: 'Đã nhận chuyển khoản',
  PAYMENT_ASSIGNED: 'Chủ quán gán khoản chuyển khoản vào đơn',
  PAYMENT_MANUAL_BANK: 'Chủ quán xác nhận đã nhận chuyển khoản',
  PAYMENT_REVIEW_REQUIRED: 'Có khoản chuyển khoản cần đối soát',
  PAYMENT_REVIEW_DISMISSED: 'Đã xử lý khoản chuyển khoản không khớp',
  PAYMENT_REFUNDED: 'Đã hoàn tiền cho khách',
  AUTO_CANCELLED_UNPAID: 'Tự hủy vì quá hạn thanh toán',
}
```

```ts
  const paymentLabel = PAYMENT_EVENT_LABELS[event.eventType]
  if (paymentLabel) return paymentLabel
```

Thêm vào `describe('describeEvent', …)` của `tests/unit/app/order-view.test.ts`:

```ts
  it('describes the payment events written by PR6', () => {
    expect(describeEvent(event({ eventType: 'PAYMENT_CONFIRMED', fromState: 'AWAITING_PAYMENT', toState: 'NEW' }))).toBe('Đã nhận chuyển khoản')
    expect(describeEvent(event({ eventType: 'PAYMENT_REVIEW_REQUIRED' }))).toBe('Có khoản chuyển khoản cần đối soát')
    expect(describeEvent(event({ eventType: 'AUTO_CANCELLED_UNPAID', toState: 'CANCELLED' }))).toBe('Tự hủy vì quá hạn thanh toán')
  })
```

- [ ] **Step 13: Lint, typecheck, build**

Run: `npm run lint && npm run typecheck && npm run test:nuxt`
Expected: xanh. (ESLint cấm `UButton`… trong `pages/**`, trang trên chỉ dùng `Z*`.)

- [ ] **Step 14: Commit**

```bash
git add app tests/unit/app tests/nuxt/app/reconciliation-review-card.test.ts tests/nuxt/app/reconciliation-order-card.test.ts
git commit -m "feat(payment-webhook): add owner reconciliation screen with one-tap assign

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 11: E2E, xác minh cuối và checklist vận hành

**Files:**
- Create: `tests/e2e/payment-webhook.spec.ts`
- Test: toàn bộ suite

**Interfaces:**
- Consumes: Task 1 fixtures (`createPaymentSetup`, `createAwaitingOrder` → `{ order, attempt, guestToken }`, `sepayPayload`, `bodyOf`, `signSepayBody`); luồng đăng ký/onboarding đã có (nhãn `Tên của bạn`, `Email`, `Mật khẩu`, `Tạo tài khoản`, `Tên doanh nghiệp`, `Tên cửa hàng`, `Đường dẫn cửa hàng`, `Tạo cửa hàng`); route `GET /api/public/orders/:token` (PR3: trả `status`); `/app/reconciliation` (Task 10).
- Produces: bằng chứng E2E cho PRD Phase 4 exit.

- [ ] **Step 1: Viết E2E**

`tests/e2e/payment-webhook.spec.ts`:

```ts
import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { closeDb, getDb } from '../../server/db/client'
import { orderPayments, orders, stores } from '../../server/db/schema'
import { matchTransaction } from '../../server/services/payments/match-transaction'
import { recordBankTransaction } from '../../server/services/payments/record-bank-transaction'
import { bankTxInput, bodyOf, createAwaitingOrder, createPaymentSetup, sepayPayload, signSepayBody, type PaymentSetup } from '../support/webhook-fixtures'
import { expectNoHorizontalOverflow } from './support/layout'

const PASSWORD = 'E2e-Password-123'
const db = () => getDb()

test.afterAll(async () => {
  await closeDb()
})

async function signUpAndOnboard(page: Page, testInfo: TestInfo) {
  const stamp = `${Date.now().toString(36)}${testInfo.project.name === 'mobile-safari' ? 's' : 'c'}pw`
  const slug = `e2e-${stamp}`
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto('/signup')
  await page.getByLabel('Tên của bạn').fill('Chủ Quán Thanh Toán')
  await page.getByLabel('Email').fill(`e2e+${stamp}@example.com`)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Tạo tài khoản' }).click()
  await expect(page).toHaveURL(/\/onboarding$/)
  await page.getByLabel('Tên doanh nghiệp').fill('Thanh Toán Group')
  await page.getByLabel('Tên cửa hàng').fill('Quán Chuyển Khoản')
  await page.getByLabel('Đường dẫn cửa hàng').fill(slug)
  await page.getByRole('button', { name: 'Tạo cửa hàng' }).click()
  await expect(page).toHaveURL(/\/app\/orders$/)
  const [store] = await db().select().from(stores).where(eq(stores.slug, slug))
  return createPaymentSetup({ org: { id: store!.orgId }, store: { id: store!.id, orgId: store!.orgId } })
}

async function sendWebhook(request: APIRequestContext, setup: PaymentSetup, payload: unknown) {
  const raw = bodyOf(payload)
  return request.post(`/api/webhooks/sepay/${setup.integration.webhookEndpointKey}`, {
    data: raw,
    headers: { 'content-type': 'application/json', ...signSepayBody(raw, setup.secret) },
  })
}

const orderRow = async (id: string) => (await db().select().from(orders).where(eq(orders.id, id)))[0]!

test('a correct signed transfer confirms the order exactly once, even when delivered repeatedly', async ({ page, request }, testInfo) => {
  const setup = await signUpAndOnboard(page, testInfo)
  const { order, attempt, guestToken } = await createAwaitingOrder(setup, { amountVnd: 55_000 })

  const tracking = await request.get(`/api/public/orders/${guestToken}`)
  expect((await tracking.json()).status).toBe('AWAITING_PAYMENT')

  const payload = sepayPayload(setup, { code: attempt.paymentCode, transferAmount: 55_000 })
  const responses = await Promise.all([1, 2, 3].map(() => sendWebhook(request, setup, payload)))
  for (const res of responses) {
    expect(res.status()).toBe(200)
    expect(await res.json()).toEqual({ success: true })
  }

  await expect.poll(async () => (await (await request.get(`/api/public/orders/${guestToken}`)).json()).status).toBe('NEW')
  expect(await orderRow(order.id)).toMatchObject({ status: 'NEW', paymentStatus: 'PAID' })
  expect(await db().select().from(orderPayments).where(eq(orderPayments.orderId, order.id))).toHaveLength(1)

  const tampered = await request.post(`/api/webhooks/sepay/${setup.integration.webhookEndpointKey}`, {
    data: bodyOf(payload),
    headers: { 'content-type': 'application/json', 'x-sepay-timestamp': String(Math.floor(Date.now() / 1000)), 'x-sepay-signature': 'sha256=00' },
  })
  expect(tampered.status()).toBe(401)
})

test('owner resolves unmatched money and a refund from the reconciliation screen on a phone', async ({ page, request }, testInfo) => {
  const setup = await signUpAndOnboard(page, testInfo)
  const awaiting = await createAwaitingOrder(setup, { amountVnd: 70_000, attemptStatus: 'EXPIRED' })
  const cancelled = await createAwaitingOrder(setup, { amountVnd: 40_000, orderStatus: 'CANCELLED', paymentStatus: 'UNPAID', attemptStatus: 'EXPIRED' })

  // Customer forgot the code: money for the awaiting order arrives with no payment code.
  const noCode = await sendWebhook(request, setup, sepayPayload(setup, { code: null, content: 'ck tra sua', transferAmount: 70_000 }))
  expect(noCode.status()).toBe(200)
  // Money arrives for an order that was already cancelled.
  const late = await recordBankTransaction(db(), bankTxInput(setup, { paymentCode: cancelled.attempt.paymentCode, amountVnd: 40_000 }))
  await matchTransaction(db(), late.id)

  await page.getByRole('link', { name: /Đối soát/ }).click()
  await expect(page).toHaveURL(/\/app\/reconciliation$/)
  await expectNoHorizontalOverflow(page)

  const assign = page.getByRole('button', { name: `Gán vào đơn #${awaiting.order.publicCode}` })
  await expect(assign).toBeVisible()
  expect((await assign.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await assign.dblclick()
  await expect(page.getByText('Đã gán vào đơn')).toBeVisible()
  await expect.poll(async () => (await orderRow(awaiting.order.id)).paymentStatus).toBe('PAID')
  expect(await db().select().from(orderPayments).where(eq(orderPayments.orderId, awaiting.order.id))).toHaveLength(1)

  await page.getByRole('tab', { name: /Hoàn tiền/ }).click()
  await expect(page.getByText(/Cần hoàn 40\.000đ/)).toBeVisible()
  await page.getByRole('button', { name: 'Đã hoàn tiền' }).click()
  await page.getByRole('button', { name: 'Xác nhận' }).click()
  await expect.poll(async () => (await orderRow(cancelled.order.id)).paymentStatus).toBe('REFUNDED')
  await expectNoHorizontalOverflow(page)
})
```

- [ ] **Step 2: Chạy E2E**

Run: `npm run test:e2e -- tests/e2e/payment-webhook.spec.ts`
Expected: PASS trên `mobile-chrome` và `mobile-safari`. Nếu bước `getByRole('link', { name: /Đối soát/ })` không thấy, kiểm tra Task 10 Step 12 (mục nav chỉ hiện cho owner).

- [ ] **Step 3: Chạy toàn bộ kiểm tra**

Run:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:nuxt
npm run db:check
npm run test:integration
npm run test:api
npm run test:e2e
npm run build
```

Expected: tất cả xanh. Kiểm tra thủ công: `git status` không có file lạ; `drizzle/` chỉ thêm đúng một migration `payment_webhook`.

- [ ] **Step 4: Checklist trước khi bật production (ghi vào mô tả PR, không merge nếu thiếu)**

- [ ] G1–G5 (Task 0) đã chạy và kết quả ghi lại; U1–U6 không còn "chưa chạy".
- [ ] Vercel: gói **Pro**, đã đặt `CRON_SECRET` (≥ 32 ký tự), `APP_ENCRYPTION_KEY`; tab Cron của dự án thấy 2 job (`*/5` và `*/15`).
- [ ] Webhook trên my.sepay.vn: URL `https://<domain>/api/webhooks/sepay/<endpointKey>`, kiểu xác thực HMAC-SHA256 (hoặc API Key + `PUT …/webhook-auth-mode`), **Content-Type JSON**, bật "Tự động gửi lại khi server trả lỗi", sự kiện "Có tiền vào", **không** lọc theo mã thanh toán (để tiền không khớp vẫn về hàng đợi).
- [ ] "Cấu trúc mã thanh toán" của công ty SePay: tiền tố `ZO`, hậu tố 8, loại "Số và chữ" (khớp `generatePaymentCode`).
- [ ] Gửi thử từ SePay → thấy `200 {"success": true}` và một dòng `bank_transactions`; xem log: có `webhook.processed`, **không** có nội dung chuyển khoản/chữ ký.
- [ ] Alert log (PR7): nhiều `webhook.auth_failed` hoặc `webhook.processing_failed` trong 15 phút; `reconcile.integration_failed`.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/payment-webhook.spec.ts
git commit -m "test(payment-webhook): add e2e for signed webhook and reconciliation screen

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Self-review (spec ↔ plan)

| Yêu cầu | Task |
|---|---|
| Spec §6.3 bước 2: raw body, HMAC, timestamp ±300 s, `timingSafeEqual`; API Key `Authorization: Apikey` (V4) | Task 2, 5 |
| §6.3 bước 3–4: Zod payload, `transferType ≠ in` → `IGNORED`, Tx1 insert idempotent theo `(integration_id, provider_transaction_id)` | Task 2, 3, 5 |
| §6.3 bước 5 bảng quyết định (đúng số tiền/tài khoản/attempt, late, cancelled/paid, mismatch) | Task 4 |
| §6.3 bước 6: success sau commit, lỗi DB → 500, Tx2 lỗi → `RECEIVED` được match lại; không log body/chữ ký/PII | Task 5 (`runWebhookProcessing`), Task 7 (`rematchPending`) |
| Đúng-một-lần dưới đồng thời (Review Focus #1, #2) | Task 3, 4, 5 (Promise.all ở 3 tầng) + unique index Task 1 |
| §6.4 expire attempt 5 phút, hủy đơn > 24 h chỉ sau reconcile | Task 6 |
| §6.4 reconcile 15 phút, dedupe `provider_transaction_id` rồi `(integration, reference, amount, account)`, `provider_alt_ids`, checkpoint, không double-credit | Task 3, 7 |
| §6.4 màn `/app/reconciliation`: gán, `RESOLVED`, hoàn tiền; audit | Task 8, 9, 10 |
| §5.4 `BANK_MANUAL` (owner + ghi chú), `REFUND_DUE → REFUNDED` (owner + ghi chú) | Task 9 |
| Rate limit webhook; log an toàn | Task 5 |
| Ma trận tenant (owner/staff/ngoài tenant) cho mọi route mới | Task 8, 9 |
| `CRON_SECRET`, Vercel Cron (GET), `vercel.json` | Task 6, 7 |
| §13 xác minh SePay (payload, HMAC, API v2, mã thanh toán) | mục "Verified external facts" + Task 0 |
| Review Focus #1–#5 | xem bảng đầu plan, mỗi dòng có test |

**Lệch so với roadmap/spec (đã ghi trong plan):**
1. Cron nhận **GET** (và POST), không chỉ POST: Vercel Cron chỉ gọi GET (V11).
2. Thêm API Key làm chế độ xác thực thứ hai (`sepay_webhook_auth.mode`), vì SePay hỗ trợ và yêu cầu của PR; mặc định vẫn HMAC.
3. `extractPaymentCode` đọc thêm `content` khi `code = null` (chỉ nhận đúng mẫu `ZO` + 8 ký tự, vẫn khớp tuyệt đối số tiền + tài khoản + org); `code` và `content` đều không có mẫu → `NO_CODE` như spec.
4. Integration không có API token **không** tự hủy đơn sau 24 h (không chứng minh được đã đối soát); owner hủy tay hoặc xác nhận `BANK_MANUAL`.
5. Đơn đã hủy mà tiền về: đặt `REFUND_DUE` nhưng **không** tạo `order_payments` (chưa thu hợp lệ); "đã thu" trong báo cáo không đếm khoản này cho tới khi owner xử lý.
6. E2E kiểm trang khách bằng API công khai (`status`) thay vì văn bản UI, vì copy C4 thuộc PR3.
7. Review queue theo **org** (giao dịch lạ không có store), hoàn tiền/quá hạn theo **store**; route đều dưới `/api/stores/:storeId/…` để staff nhận 403.
8. Ma trận tenant yêu cầu 403 cho staff: dùng `requireStoreOwner` thay vì `requireOrgOwner` (org-owner-guard trả 404 cho staff).
9. Khớp tài khoản nhận tiền theo **bản chụp trên attempt** (`accountNumber`/`vaNumber` của PR5) và theo cả `accountNumber` lẫn `subAccount` của webhook, thay vì đọc `store_payment_accounts` hiện tại (chủ quán có thể đã đổi số).
10. `confirmOrderPayment` tự `UPDATE` có điều kiện thay vì gọi `transitionOrder` của PR4, vì phải đặt `status`, `payment_status` và `late_payment` trong cùng một câu lệnh; vẫn là cập nhật có điều kiện `WHERE status = 'AWAITING_PAYMENT'` giống tinh thần PR4.
11. `order_payments_order_uq` của PR4 (một khoản thu/đơn) được dùng làm lưới an toàn cuối thay vì thêm ràng buộc thứ hai; PR6 chỉ thêm FK + `unique(bank_transaction_id) where not null`.
12. Ghi `sepay_integrations.last_valid_webhook_at` (PR5 để dành cho PR6) bằng `touchVerifiedWebhook`; "Gửi thử" (`id = 0`, chưa xác minh — U5) chỉ ghi cột này, không lưu giao dịch; giao dịch chứa `PAYMENT_TEST_CODE` của PR5 tự `RESOLVED/NOT_ORDER`.
13. Fixture PR6 nằm ở `tests/support/webhook-fixtures.ts` (không đè `payment-fixtures.ts` của PR5) và dùng lại fixture của PR3/PR5; `describeEvent` của PR4 được mở rộng cho các event thanh toán mới.
14. Integration test dùng `sepayIntegrations` của đúng một tổ chức một môi trường (ràng buộc PR5), nên store thứ hai cùng org dùng `reuse`, và test cần hai integration trong một org dùng `environment: 'test'` + store khác.

