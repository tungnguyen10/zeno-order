# ZENO Mini Order V1 — Design Spec

> Ngày: 2026-10-31 · Trạng thái: Approved design, chờ implementation plan
> Nguồn yêu cầu: [ZENO_MINI_ORDER_V1_IMPLEMENTATION_PLAN.md](../../ZENO_MINI_ORDER_V1_IMPLEMENTATION_PLAN.md) (gọi tắt là **PRD**).
> Spec này **không lặp lại** PRD; nó chốt các quyết định kiến trúc/triển khai và những điểm thay đổi so với PRD. Khi spec và PRD mâu thuẫn, spec thắng.

## 1. Mục tiêu & tiêu chí thành công

Mini web order mobile-first, guest-first cho quán trà sữa/cafe, multi-tenant (organization → stores), 3 fulfillment (`DINE_IN | PICKUP | DELIVERY`), 2 phương thức thanh toán (`BANK_QR` qua VietQR + webhook SePay, `PAY_ON_RECEIPT`).

Thành công = Definition of Done ở PRD §12, đặc biệt các P0 ở PRD §13:
- Không rò dữ liệu giữa org/store (kể cả đoán ID).
- Chuyển khoản đúng được xác nhận **đúng một lần**; tiền lạ/muộn không biến mất.
- Không tạo đơn trùng khi retry/double-submit.

Repo được làm mới hoàn toàn; không tái sử dụng code trong git history trước commit `9b35be8`.

## 2. Quyết định kiến trúc

| Chủ đề | Quyết định |
|---|---|
| Kiến trúc | Nuxt 4 full-stack, deploy Vercel. Nitro chứa mọi API (public, protected, webhook, internal cron). Không dùng Neon Functions ở V1. |
| Auth | **Neon Auth (Managed Better Auth)**, `auth: true` trong `neon.ts`. Client `@neon/auth`; server verify JWT (EdDSA, 15 phút) bằng `jose` + `NEON_AUTH_JWKS_URL`, issuer theo `NEON_AUTH_BASE_URL`. |
| Tenant membership | Bảng của app (`organization_members`, `store_members`), **không** dùng plugin Organization của Neon Auth (Beta, không có role theo store). |
| DB | Neon Postgres + Drizzle ORM. Runtime: `Pool` của `@neondatabase/serverless` (WebSocket) + `drizzle-orm/neon-serverless` để có interactive transaction. App dùng `DATABASE_URL` (pooled); migration dùng `DATABASE_URL_UNPOOLED` qua `drizzle-kit`. |
| UI | Nuxt UI v4 trên Tailwind v4 có sẵn. State bằng composables; Pinia chỉ dùng nếu thực sự cần (đã cài). |
| Ảnh | Neon Object Storage, bucket mới `product-images` (`access: "public_read"`), upload bằng presigned PUT. Bucket `assets` (private) giữ cho file nội bộ. |
| Cron | Vercel Cron → `/api/internal/*`, bảo vệ bằng `CRON_SECRET`. |
| RLS | Không dùng ở V1 (follow-up). Authorization tại service/API + composite FK. |
| Test | Vitest (unit + integration trên Neon branch `test`), Playwright (E2E mobile viewport), GitHub Actions CI. |
| Package manager | npm, commit `package-lock.json`. |

## 3. Kiến trúc & ranh giới module

```
app/ (pages, components, composables)  ──$fetch──▶  server/api/*  (handler mỏng: Zod parse → service → map lỗi)
                                                       ▼
                                  server/auth/         requireUser · requireOrgOwner · requireStoreStaff
                                  server/services/<domain>/   nghiệp vụ + transaction
                                                       ▼
                                  server/repositories/  Drizzle queries, luôn nhận {orgId, storeId}
                                                       ▼
                                  server/db/            schema/*.ts · client.ts
shared/   schemas (Zod dùng chung) · enums · types · pricing.ts (hàm thuần)
```

Cây thư mục theo PRD §9, bổ sung:
- `server/services/`: `identity`, `catalog`, `store`, `ordering`, `payments`, `reporting`, `storage`.
- `server/utils/errors.ts`: `AppError(code, status, message, details?)` + Nitro error handler trả `{code, message, details?}`; lỗi không xác định → 500 `INTERNAL`, không lộ chi tiết DB.
- `server/utils/logger.ts`: request ID cho mọi request, redaction PII (phone, address) và secret.
- Mã nguồn thử nghiệm hiện tại `server/utils/db.ts`, `server/utils/storage.ts`, `server/api/storage.get.ts` được thay thế bởi `server/db/client.ts`, `server/services/storage`; `server/api/health.get.ts` giữ lại dạng tối giản (`SELECT 1`).

### 3.1. Luồng auth
1. Browser: `useAuth()` bọc client `@neon/auth` (sign-up/sign-in email+password, sign-out, khôi phục session). `$api` (wrapper `$fetch`) tự gắn `Authorization: Bearer <jwt>` lấy từ `.token()` cho mọi `/api/*` trừ `/api/public/*`, `/api/webhooks/*`.
2. `requireUser(event)` → verify JWT (JWKS cache in-memory), trả `{ userId, email }`. Lỗi → 401 `UNAUTHENTICATED`.
3. `requireStoreStaff(event, storeId)` / `requireOrgOwner(event, orgId)` truy vấn membership. Không có quyền với resource → **404 `NOT_FOUND`** (không phân biệt với không tồn tại). Có membership nhưng role thiếu (staff gọi API owner) → 403 `FORBIDDEN`.
4. Route middleware client `/app/**` chỉ phục vụ UX (redirect `/login`, `/onboarding` nếu chưa có org).
5. Test seam: khi `NODE_ENV=test`, `AUTH_JWKS_OVERRIDE` cho phép verify JWT ký bằng key test.

### 3.2. Env
`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL` (Neon pull), `AWS_*` (Object Storage), `APP_ENCRYPTION_KEY` (32 byte base64), `CRON_SECRET`, `APP_BASE_URL`. Không cần `NUXT_SESSION_PASSWORD`. Không đưa secret vào `runtimeConfig.public`.

## 4. Data model

Danh sách bảng theo PRD §6, với các thay đổi sau.

### 4.1. Identity
- Bỏ `users(password_hash)`. Thêm `user_profiles(user_id text PK, email, display_name, created_at)`, upsert khi gọi `GET /api/me`.
- `organization_members(org_id, user_id → user_profiles, role OWNER, status)`, `store_members(org_id, store_id, user_id, role STAFF|OWNER, status)`.
- Không FK vào schema `neon_auth` (managed).
- Thêm `store_invitations(id, org_id, store_id, email, role, token_hash, expires_at, accepted_at, created_by)`.

### 4.2. Tenant isolation ở tầng DB
- `stores`: `unique(org_id, id)`. Mọi bảng thuộc store có `(org_id, store_id)` với composite FK `→ stores(org_id, id)`.
- Bảng cha có `unique(store_id, id)`; bảng con tham chiếu bằng `(store_id, parent_id)`:
  products→categories, product_option_groups→products, product_option_values→groups, orders→store_tables, orders→delivery_zones, order_items→orders, order_events→orders, payment_attempts→orders, order_payments→orders.
- Repository bắt buộc nhận `{orgId, storeId}` và luôn đưa vào `WHERE`.

### 4.3. Thay đổi cột so với PRD
- `stores`: `is_accepting_orders`, `dine_in_enabled`, `pickup_enabled`, `delivery_enabled`, `logo_key`, `payment_ttl_minutes` (default 15) — thay `settings_json`.
- `products.image_key` (key trong bucket `product-images`) thay `image_url`.
- `orders.public_code`: 6 ký tự từ bảng chữ `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`, `unique(store_id, public_code)`.
- `orders.guest_token_encrypted` (xem §5.2), `orders.late_payment boolean default false`.
- `payment_attempts.status`: `PENDING | PAID | EXPIRED | SUPERSEDED`.
- `bank_transactions.reconciliation_status`: `RECEIVED | MATCHED | REVIEW_REQUIRED | IGNORED | RESOLVED`; thêm `provider_alt_ids text[]` cho ID từ API đối soát.
- Thêm `bank_transaction_events` (audit thao tác đối soát), `reconcile_checkpoints(integration_id PK, last_synced_at)`, `rate_limits(key, window_start, count, PK(key, window_start))`.
- `sepay_integrations`: thêm `key_version`, status `DRAFT | TESTING | ACTIVE | DISABLED`.

### 4.4. Token, mã, kiểu dữ liệu
- `guest_token`, `table_token`, invitation token: 32 byte random, base64url; DB lưu `sha256` hex; tra cứu theo hash.
- `webhook_endpoint_key`: 24 byte random base64url (không phải lớp bảo mật duy nhất).
- `payment_code`: `ZO` + 8 ký tự `[A-Z0-9]`, unique toàn hệ thống; xác nhận khớp cấu hình mã SePay khi implement.
- `idempotency_key`: uuid, `unique(store_id, idempotency_key)`.
- id `uuid default gen_random_uuid()`, thời gian `timestamptz`, tiền `bigint` (mode number) VND, enum `pgEnum` đồng bộ `shared/enums`.
- Catalog: soft-disable bằng `active` / `is_available`; `order_items` snapshot tên/option/giá.

### 4.5. Migrations
Bốn nhóm theo PRD: identity/org/store → catalog/table/delivery → orders/events/rate_limits → payment config/attempts/transactions. Một migration Drizzle cho mỗi PR liên quan. Script `npm run db:seed` tạo dữ liệu demo (1 org, 1 store, 8 món trà sữa có option, 2 bàn, 2 delivery zones).

## 5. Ordering

### 5.1. Checkout — `POST /api/public/stores/:slug/orders`
Body theo PRD §7. Service `ordering.createOrder`:
1. Zod: tối đa 30 dòng; qty 1–50; note ≤ 200 ký tự; tên ≤ 80; địa chỉ ≤ 300; SĐT VN chuẩn hoá `0xxxxxxxxx` (chấp nhận `+84`).
2. Rate limit `ip+store`: 10 đơn / 10 phút (bảng `rate_limits`) → 429 `RATE_LIMITED`. Request idempotent (key đã tồn tại) không bị tính.
3. Một DB transaction:
   - Idempotency: nếu `(store_id, idempotency_key)` tồn tại → trả lại response của đơn đó (xem §5.2), không tạo gì mới.
   - Store active, `is_accepting_orders`, mode bật → nếu không: 422 `STORE_CLOSED` / `MODE_DISABLED`.
   - `DINE_IN`: `tableToken` hợp lệ + bàn active, nếu không 422 `INVALID_TABLE`. `PICKUP`: tên + SĐT. `DELIVERY`: tên + SĐT + zone active + địa chỉ (422 `INVALID_ZONE`).
   - Đọc product/option theo `store_id`; validate `min_select/max_select/required`; tính tiền bằng `shared/pricing.ts`. Món không bán/option không hợp lệ → 409 `CART_STALE` với `details.lines[]`.
   - `BANK_QR` khi store chưa có payment account verified + integration ACTIVE → 422 `PAYMENT_METHOD_UNAVAILABLE`.
   - Insert `orders` (retry sinh `public_code` khi trùng), `order_items`, `order_events(CREATED)`, và `payment_attempts` nếu `BANK_QR`.
4. Response: `{ publicCode, guestToken, status, paymentStatus, totalVnd, qr? }`, `qr = { bankName, accountNumber, accountHolder, amountVnd, transferContent, imageUrl, expiresAt }`.

### 5.2. Idempotency & guestToken
Để retry trả lại cùng `guestToken`, token được lưu thêm ở `orders.guest_token_encrypted` (AES-256-GCM, `APP_ENCRYPTION_KEY`) bên cạnh `guest_token_hash`; chỉ giải mã khi trả response idempotent. Tra cứu tracking luôn bằng hash.

### 5.3. State machine — `server/services/ordering/transitions.ts`
| Từ | Sang | Actor | Điều kiện |
|---|---|---|---|
| AWAITING_PAYMENT | NEW | system | payment matched |
| NEW | PREPARING, READY | staff | — |
| PREPARING | READY | staff | — |
| READY | COMPLETED | staff | DINE_IN, PICKUP |
| READY | DELIVERING | staff | DELIVERY |
| DELIVERING | COMPLETED | staff | DELIVERY |
| AWAITING_PAYMENT, NEW, PREPARING | CANCELLED | staff nếu `payment_status ∈ {UNPAID, PENDING}`; owner mọi trường hợp | đã PAID → `payment_status = REFUND_DUE` |

- Không có chuyển lùi. Khách không tự hủy ở V1.
- Mọi chuyển: `UPDATE … WHERE id=? AND store_id=? AND status=:expected` → 0 rows ⇒ 409 `STATUS_CONFLICT`. Ghi `order_events`.

### 5.4. Payment status (tách khỏi order status)
- `PAY_ON_RECEIPT` → `NEW + UNPAID`. `POST …/mark-paid { expectedPaymentStatus, method: CASH|BANK_MANUAL, note? }` → `order_payments`, `PAID`, event.
- `BANK_MANUAL` cho đơn `BANK_QR`: chỉ owner, `note` bắt buộc, audit.
- `REFUND_DUE → REFUNDED`: chỉ owner, note bằng chứng bắt buộc.

### 5.5. Board, tracking, cart
- `GET /api/stores/:id/orders?tab=new|doing|ready|other|awaiting_payment&cursor=` — poll 5s khi `document.visibilityState === 'visible'`. `AWAITING_PAYMENT` chỉ ở tab "Chờ thanh toán".
- `GET /api/public/orders/:token` — poll 4s khi visible; trả status, items, totals, fulfillment, QR (nếu còn PENDING); SĐT che còn 3 số cuối, không trả địa chỉ đầy đủ. `Cache-Control: no-store`.
- Âm báo đơn mới chỉ sau user interaction.
- `useCart` (localStorage key `zeno:cart:<storeSlug>`): items + `pendingIdempotencyKey` (sinh khi bấm đặt, giữ khi retry, xoá khi thành công). Reload menu → đánh dấu dòng stale. Nhớ mode PICKUP/DELIVERY gần nhất; DINE_IN chỉ khi có `?t=` hợp lệ (`GET /api/public/stores/:slug/fulfillment?t=`).

## 6. Payments (SePay)

### 6.1. Cấu hình (owner only)
- `store_payment_accounts`: bank code (danh sách VietQR), số TK, chủ TK; `verified_at` đặt khi integration qua bước test thành công.
- `sepay_integrations` (org): `webhook_endpoint_key`, `encrypted_hmac_secret`, `encrypted_api_token?` (AES-256-GCM, `APP_ENCRYPTION_KEY`, `key_version`). Secret write-only; API chỉ trả `hasSecret`, `updatedAt`. Rotate = ghi đè.
- `integration_accounts` nối integration ↔ accounts.
- Wizard theo PRD §8.1. `DRAFT → TESTING` khi lưu secret; `TESTING → ACTIVE` khi đã nhận ≥1 webhook hợp lệ chữ ký và owner xác nhận; đồng thời set `verified_at` cho account khớp.
- VietQR hiển thị cho store chỉ khi account verified + integration ACTIVE.

### 6.2. Payment attempt & QR
- TTL `stores.payment_ttl_minutes` (15).
- QR image: `https://qr.sepay.vn/img?acc=<acc>&bank=<bank>&amount=<amount>&des=<payment_code>` — URL dựng ở server; xác minh format với docs SePay khi implement.
- "Thanh toán lại" sau hết hạn: attempt mới (mã mới); attempt cũ `SUPERSEDED`/`EXPIRED` nhưng vẫn match được khi tiền đến muộn.

### 6.3. Webhook — `POST /api/webhooks/sepay/:endpointKey`
1. Tìm integration (status ≠ DISABLED) → không thấy: 404.
2. `readRawBody`; `X-SePay-Timestamp` lệch > 300s → 401; HMAC-SHA256 trên `${timestamp}.${rawBody}` với secret integration, so `timingSafeEqual` với `X-SePay-Signature` dạng `sha256=<hex>` → sai: 401 + counter invalid.
3. Zod payload (`id`, `accountNumber`, `transferType`, `transferAmount` nguyên dương, `code?`, `referenceCode`, `transactionDate`). `transferType ≠ "in"` → lưu `IGNORED`, 200.
4. **Tx1**: `INSERT bank_transactions … ON CONFLICT (integration_id, provider_transaction_id) DO NOTHING RETURNING id`. Duplicate → 200 `{"success": true}`.
5. **Tx2** `payments.matchTransaction(txId)` (hàm dùng chung cho webhook và reconcile): `SELECT … FOR UPDATE` attempt theo `payment_code` + order.

| Điều kiện | Kết quả |
|---|---|
| Account thuộc integration và attempt, amount **bằng** expected, order `AWAITING_PAYMENT`, attempt `PENDING` | `order_payments` (unique bank_transaction_id), payment `PAID`, order `NEW`, attempt `PAID`, tx `MATCHED`, event |
| Như trên nhưng attempt `EXPIRED`/`SUPERSEDED` | Như trên + `orders.late_payment = true` |
| Order `CANCELLED` hoặc đã `PAID` | tx `REVIEW_REQUIRED`; nếu cancelled-đã-thu thì payment `REFUND_DUE` |
| Amount lệch, account sai, `code` null/không khớp | tx `REVIEW_REQUIRED`; nếu tìm được order: payment `REVIEW_REQUIRED`, order giữ nguyên |

6. Trả `{"success": true}` **sau commit**; lỗi DB → 500 để SePay retry. Nếu Tx1 commit mà Tx2 lỗi, giao dịch ở `RECEIVED` và được reconcile job match lại. Không log body/chữ ký/PII.

### 6.4. Reconciliation & expiry
- `POST /api/internal/reconcile-sepay` (Vercel Cron 15 phút, `Authorization: Bearer CRON_SECRET`):
  - Match lại mọi `bank_transactions` còn `RECEIVED`.
  - Mỗi integration có API token: gọi API giao dịch SePay trong cửa sổ `[checkpoint − 30 phút, now]`, phân trang, chuẩn hoá. Dedupe theo `provider_transaction_id`, rồi theo `(integration, reference_code, amount, account)`; trùng → append `provider_alt_ids`. Bản ghi mới → `matchTransaction`. Cập nhật `reconcile_checkpoints`. Xác minh field API v2 khi implement.
- `POST /api/internal/expire-payment-attempts` (5 phút): attempt quá hạn → `EXPIRED`. Không hủy đơn. Đơn `AWAITING_PAYMENT` > 24h → `CANCELLED` chỉ khi reconcile gần nhất của integration đã chạy sau thời điểm attempt hết hạn.
- Màn `/app/reconciliation` (owner): list `REVIEW_REQUIRED`; actions: gắn vào order (amount khớp, hoặc owner xác nhận chênh lệch + note), đánh dấu xử lý ngoài hệ thống (`RESOLVED`), đánh dấu đã hoàn tiền. Audit vào `bank_transaction_events` / `order_events`.

## 7. UI

Nuxt UI v4, mobile-first (360px), tiếng Việt.

| Route | Nội dung |
|---|---|
| `/s/[slug]` | C1 menu + C2 options sheet + C3 cart/checkout sheet |
| `/o/[token]` | C4 chờ thanh toán (QR, copy, lưu ảnh) / tiến độ / "Đặt thêm" |
| `/login`, `/signup` | Neon Auth email+password |
| `/onboarding` | tạo org + store (tên, slug) |
| `/invite/[token]` | nhận lời mời staff |
| `/app/orders` | O1 board + O2 chi tiết (slide-over), nút gọi `tel:` |
| `/app/menu` | O3 danh mục/món/option/ảnh |
| `/app/settings` | O4 tabs: Cửa hàng · Nhận món & khu vực giao · Bàn & QR (in/tải PNG, regenerate/revoke) · Thanh toán & SePay (owner) · Nhân viên (owner) |
| `/app/reconciliation` | đối soát (owner) |
| `/app/reports` | O5 |

- `useActiveStore`: store switcher khi >1 store, lưu cookie; ẩn khi 1 store.
- Loading/empty/error ở mọi màn; bottom sheet focus trap; label đầy đủ; target ≥ 44px; ảnh `loading="lazy"` có kích thước cố định.
- Mời staff: owner nhập email + store → hiển thị link `/invite/<token>` (hết hạn 7 ngày) để tự gửi; người nhận đăng nhập bằng email trùng khớp → thêm `store_members`. Không gửi email ở V1.

## 8. Reporting
`GET /api/stores/:id/summary?date=YYYY-MM-DD` theo ngày `Asia/Ho_Chi_Minh`: tổng đơn, hoàn tất, hủy, tổng giá trị đơn (không tính CANCELLED), **đã thu** tách `SEPAY` / `CASH` / `BANK_MANUAL` (từ `order_payments`), còn chưa thu. Owner lọc theo store; staff chỉ store được cấp.

## 9. Error codes
`VALIDATION_FAILED` 400 · `UNAUTHENTICATED` 401 · `FORBIDDEN` 403 · `NOT_FOUND` 404 · `STATUS_CONFLICT`, `CART_STALE`, `SLUG_TAKEN` 409 · `STORE_CLOSED`, `MODE_DISABLED`, `INVALID_TABLE`, `INVALID_ZONE`, `PAYMENT_METHOD_UNAVAILABLE` 422 · `RATE_LIMITED` 429 · `INTERNAL` 500.

## 10. Testing
- **Unit**: pricing/phí giao, option validation, transitions, matching decision table, HMAC verify, AES-GCM encrypt/decrypt, phone normalize, public_code/payment_code generators.
- **Integration** (Vitest + `@nuxt/test-utils` server, Neon branch `test` reset trước mỗi run): ma trận authz mọi protected route (Owner A, Staff A, Staff A' khác store, Owner B × resource Store A/B); checkout (3 fulfillment, idempotency, concurrent duplicate submit, CART_STALE, rate limit); webhook (HMAC thiếu/sai, timestamp lệch, replay, concurrent duplicate bằng `Promise.all`, sai account, thiếu/thừa tiền, code null, late after expire, after cancel); reconcile với SePay client fake (không double credit); status conflict.
- **E2E** (Playwright, viewport 360×740): khách 3 fulfillment COD; owner chuyển trạng thái + mark-paid; VietQR với webhook giả lập ký HMAC; refresh/double click không trùng đơn; cross-tenant UI.
- **CI** (GitHub Actions): `npm run lint`, `npm run typecheck`, unit, integration (Neon branch tạm cho mỗi PR, xoá sau khi chạy), `drizzle-kit check`, `npm run build`.

## 11. Lộ trình PR

| # | PR | Nội dung | Exit |
|---|---|---|---|
| 0 | `chore(foundation)` | Nuxt UI, Drizzle + Pool client, cấu trúc thư mục, AppError, logger, Vitest/Playwright, CI, `neon.ts` (`auth: true`, bucket `product-images`), thay util test Neon | CI xanh, `/api/health` OK |
| 1 | `feat(core)` | Neon Auth UI, user_profiles, org/store/members, onboarding, guards, ma trận cross-tenant | PRD Phase 1 exit |
| 2 | `feat(catalog)` | categories/products/options/ảnh, tables/QR, delivery zones, store settings, public menu API + C1/C2 | PRD Phase 2 exit |
| 3 | `feat(order)` | cart, checkout COD, idempotency, rate limit, C3/C4 tracking | khách đặt COD end-to-end |
| 4 | `feat(owner)` | board, detail, transitions, cancel, mark-paid, invitations, reports | PRD Phase 3 exit |
| 5 | `feat(payment-setup)` | payment accounts, SePay integration (encrypt, wizard), attempts, QR | QR đúng bank/amount/code |
| 6 | `feat(payment-webhook)` | webhook, matching, cron reconcile/expire, review queue + đủ test thanh toán | PRD Phase 4 exit |
| 7 | `test(hardening)` | E2E, a11y, security pass, backup/restore doc, pilot checklist | PRD Phase 5 exit |

PR 5–6 không merge khi chưa có test HMAC, replay, sai account, duplicate payment, late transfer.

## 12. Ngoài phạm vi V1
RLS, gửi email (mời staff, thông báo), WebSocket/push, PWA, Neon Functions, mọi mục "Không làm" ở PRD §1.

## 13. Điểm cần xác minh khi implement
- Định dạng mã thanh toán SePay (`ZO` + 8) khớp cấu hình prefix/độ dài.
- URL/tham số QR `qr.sepay.vn`.
- Header/format chữ ký webhook HMAC và field payload hiện hành.
- Field/định danh của API giao dịch SePay v2 cho reconcile.
- API `@neon/auth` cho Nuxt/Vue (client không phụ thuộc React) và cách lấy JWT.
