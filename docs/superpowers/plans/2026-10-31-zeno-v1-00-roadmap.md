# ZENO Mini Order V1 — Implementation Roadmap (index)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each PR plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Triển khai toàn bộ ZENO Mini Order V1 theo spec qua 8 PR nối tiếp. Mỗi PR có điểm hoàn thành riêng và để lại phần mềm chạy, test được.

**Architecture:** Nuxt 4 full-stack trên Vercel, Nitro chứa mọi API. Neon Postgres + Drizzle (Pool WebSocket, có transaction thật). Neon Auth (JWT) + bảng membership của app. Neon Object Storage cho ảnh món. SePay webhook/đối soát cho VietQR.

**Tech Stack:** Nuxt 4.5.2 · Vue 3.5 · @nuxt/ui 4.12.0 · drizzle-orm 0.45.4 / drizzle-kit 0.31.11 · @neondatabase/serverless 1.2.0 · @neon/auth 0.8.2 · jose 6.2.14 · zod 4.6.5 · vitest 5 · @nuxt/test-utils 4.3.2 · Playwright 1.63.

**Spec:** [2026-10-31-zeno-mini-order-v1-design.md](../specs/2026-10-31-zeno-mini-order-v1-design.md) · PRD: [ZENO_MINI_ORDER_V1_IMPLEMENTATION_PLAN.md](../../ZENO_MINI_ORDER_V1_IMPLEMENTATION_PLAN.md)

## Plan files

| # | PR | Plan | Trạng thái |
|---|---|---|---|
| 0 | `chore(foundation)` | [2026-10-31-zeno-v1-01-foundation.md](./2026-10-31-zeno-v1-01-foundation.md) | **Chi tiết, sẵn sàng thực thi** |
| 1 | `feat(core)` | [2026-10-31-zeno-v1-02-core-auth-tenancy.md](./2026-10-31-zeno-v1-02-core-auth-tenancy.md) | **Chi tiết, sẵn sàng thực thi** |
| 2 | `feat(catalog)` | [2026-10-31-zeno-v1-03-catalog.md](./2026-10-31-zeno-v1-03-catalog.md) | **Chi tiết, sẵn sàng thực thi** |
| 3 | `feat(order)` | [2026-10-31-zeno-v1-04-ordering.md](./2026-10-31-zeno-v1-04-ordering.md) | **Hoàn tất triển khai PR3**; 60 E2E đạt, xem [kết quả](../specs/2026-11-02-pr3-ordering-implementation.md) |
| 4 | `feat(owner)` | [2026-10-31-zeno-v1-05-owner-ops.md](./2026-10-31-zeno-v1-05-owner-ops.md) | **Hoàn tất triển khai PR4**; xem [kết quả](../specs/2026-11-02-pr4-owner-ops-implementation.md) |
| 5 | `feat(payment-setup)` | [2026-10-31-zeno-v1-06-payment-setup.md](./2026-10-31-zeno-v1-06-payment-setup.md) | **Đã triển khai code (13 task)**; [kết quả](../specs/2026-11-03-pr5-payment-setup-implementation.md), draft chờ checklist ngân hàng/SePay thật |
| 6 | `feat(payment-webhook)` | [2026-10-31-zeno-v1-07-payment-webhook.md](./2026-10-31-zeno-v1-07-payment-webhook.md) | **Chi tiết (12 task)**; gate UNVERIFIED ở Task 0 |
| 7 | `test(hardening)` | [2026-10-31-zeno-v1-08-hardening.md](./2026-10-31-zeno-v1-08-hardening.md) | **Chi tiết (16 task)** |

> **Lưu ý khi thực thi:** PR2–PR7 được viết trước khi PR liền trước tồn tại, nên các điểm chèn vào code của PR trước dùng mốc + bước "Step 0 grep" để đối chiếu tên thật. Khi một PR merge, đọc lại phần Consumes của plan kế tiếp và sửa plan nếu tên thật lệch. Các plan thanh toán (PR5–PR6) còn mục UNVERIFIED về SePay phải được kiểm chứng trước khi code.

**Vì sao PR2–7 viết sau:** mỗi PR dùng interface thật của PR trước (tên hàm, kiểu, fixture, constraint name), và PR5–6 phụ thuộc tài liệu SePay phải xác minh trực tiếp (spec §13). Nếu viết code chi tiết ngay bây giờ thì phần lớn sẽ là phỏng đoán. Phần outline dưới đây đã chốt phạm vi, file, interface và test case bắt buộc. Plan chi tiết của từng PR phải tuân theo outline; muốn lệch thì cập nhật outline trước.

## Global Constraints

- **Package manager:** npm, commit `package-lock.json`; pin version chính xác (không `^`/`~`).
- **Runtime:** Node `>=24 <25` (`.nvmrc` = 24). Deploy Vercel.
- **Import:** server dùng import tường minh (`h3`, `zod`, `drizzle-orm`) và đường dẫn tương đối trong `server/`; `shared/` qua alias `#shared`. Không dùng `~/server/...`.
- **Lớp kiến trúc:** route handler mỏng (parse → guard → service). Transaction chỉ nằm trong `server/services/**`. Repository luôn nhận `{orgId, storeId}` hoặc `StoreContext`.
- **Tenant:** mọi bảng thuộc store có `org_id`, `store_id`, composite FK `(org_id, store_id) → stores(org_id, id)`, `unique(store_id, id)`; bảng con tham chiếu `(store_id, parent_id)`. Không có quyền → **404**; thiếu role → **403**; thiếu/sai token → **401**.
- **Tiền:** VND `bigint` (mode `number`), số nguyên ≥ 0; server luôn tự tính lại; snapshot tên/option/giá vào `order_items`.
- **Kiểu dữ liệu:** id `uuid default gen_random_uuid()`; thời gian `timestamptz`; enum `pgEnum` đồng bộ `shared/`.
- **Token:** 32 byte random base64url; DB chỉ lưu `sha256` hex (`server/utils/tokens.ts`, có từ PR2).
- **Secret:** mã hoá AES-256-GCM bằng `APP_ENCRYPTION_KEY` (`server/utils/crypto.ts`, có từ PR3); không bao giờ trả secret ra API; không đưa vào `runtimeConfig.public`.
- **Lỗi API:** `{ code, message, details? }`, code theo spec §9.
- **Log:** qua `logger` (redact PII/secret); không log body webhook, chữ ký, SĐT, địa chỉ.
- **UI:** tiếng Việt, mobile-first 360px, Nuxt UI v4, vùng bấm ≥ 44px, có trạng thái loading/empty/error ở mọi màn.
- **Thời gian báo cáo:** `Asia/Ho_Chi_Minh`.
- **Commit:** conventional commits, kèm trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

## Quy ước xuyên PR (bắt buộc)

1. **Ma trận tenant:** mọi route protected mới phải thêm hàng vào `tests/api/tenant-isolation.test.ts` với ít nhất các actor `ownerA`, `staffA1`, `staffA2`, `ownerB`, kèm status mong đợi.
2. **Route public** (`/api/public/**`) phải có test khẳng định response không chứa `customerPhone`, `address`, `orgId`, secret hay token hash.
3. **Migration:** mỗi PR có thay đổi schema thì sinh đúng một file `drizzle-kit generate --name <pr>`, chạy `npm run db:check` và áp dụng lên branch `test` trước khi chạy integration test.
4. **Test DB:** integration/api test gọi `resetDb()` trong `beforeEach`/`beforeAll` và tạo dữ liệu qua `tests/support/fixtures.ts`; mở rộng fixtures thay vì insert thô trong từng test.
5. **Không nới test để cho xanh.** Test fail thì sửa code sản phẩm.
6. **Tạm ngưng organization:** Khi thêm tính năng tạm ngưng organization: `findStoreAccess`/`listAccessibleStores` phải join `organizations.status = 'ACTIVE'` và thêm test.
7. **Tạo membership:** Mọi luồng tạo membership (vd. nhận lời mời PR4) phải gọi `ensureProfile` trong cùng transaction; PR4 phải quyết định có bắt buộc email đã xác minh (claim `emailVerified`) trước khi nhận lời mời.

## Review Focus (toàn dự án)

Mỗi dòng là một input hoặc tình huống người dùng thật sẽ gặp. Đây là những chỗ spec không nói rõ nhưng hỏng là gây hại. Cột cuối ghi test nằm ở đâu.

| # | Input / tình huống | Hành vi mong đợi | Test nằm ở |
|---|---|---|---|
| 1 | Staff/Owner tenant A gọi resource store B bằng UUID thật | 404 y hệt UUID không tồn tại | PR1 Task 5 |
| 2 | JWT hết hạn / sai issuer / sai key / `alg` khác / thiếu `sub` | 401 | PR1 Task 2 |
| 3 | Slug có dấu, chữ hoa, trùng, dành riêng | Gợi ý slug đã chuẩn hoá; 409 `SLUG_TAKEN`; 400 nếu dành riêng | PR1 Task 3–5 |
| 4 | Bấm "Tạo cửa hàng" 2 lần / mở 2 tab | Đúng 1 org, lần 2 nhận `ORG_EXISTS` | PR1 Task 4–5 |
| 5 | DB không kết nối được | `/api/health` 503, không lộ connection string | PR0 Task 2, 4 |
| 6 | SĐT/địa chỉ/token/connection string xuất hiện trong log | Bị che `[REDACTED]` | PR0 Task 3 |
| 7 | Giá món/option đổi hoặc món hết hàng giữa lúc thêm giỏ và lúc đặt | 409 `CART_STALE` chỉ rõ dòng; không bao giờ tính giá cũ | PR3 |
| 8 | Mạng chập chờn: retry hoặc double tap "Đặt món" | Cùng một đơn, cùng `guestToken` | PR3 |
| 9 | Hai nhân viên bấm chuyển trạng thái cùng lúc | Một người thắng, người kia nhận 409 `STATUS_CONFLICT`, UI tải lại | PR4 |
| 10 | Webhook replay, gửi trùng đồng thời, tiền đến muộn sau hết hạn hoặc sau khi hủy | Đúng 1 payment; trường hợp bất thường vào review, tiền không mất dấu | PR6 |

---

## PR2 — `feat(catalog)`: menu, option, bàn/QR, khu vực giao, menu public

**Exit:** owner tạo menu (tên + giá trong ≤ 3 thao tác), bàn/QR, khu vực giao; khách mở `/s/:slug` (và `?t=`) xem menu + sheet option trên mobile. Chưa đặt đơn.

**Migration `catalog`:** `categories`, `products`, `product_option_groups`, `product_option_values`, `store_tables`, `delivery_zones`. Tất cả có `org_id, store_id`, composite FK → stores, `unique(store_id, id)`. Ngoài ra:
- `products(store_id, category_id) → categories(store_id, id)`, `base_price_vnd bigint check ≥ 0`, `is_available`, `active`, `position`, `image_key`.
- `product_option_groups(store_id, product_id) → products`, `min_select ≥ 0`, `max_select ≥ min_select`, `required`.
- `product_option_values(store_id, group_id) → groups`, `price_delta_vnd bigint check ≥ 0`.
- `store_tables(code, display_name, token_hash unique, active)`, `unique(store_id, code)`.
- `delivery_zones(name, fee_vnd ≥ 0, active, position)`.

**Tasks:**

1. **Schema + `server/utils/tokens.ts`.** `generateToken(bytes = 32): string`, `hashToken(token: string): string`. Integration test: FK chéo store bị từ chối (`23503`); check constraint giá âm (`23514`).
2. **`shared/pricing.ts` (hàm thuần).**
   - `interface OptionGroupRule { id: string; minSelect: number; maxSelect: number; required: boolean; values: { id: string; priceDeltaVnd: number; active: boolean }[] }`
   - `validateSelection(groups: OptionGroupRule[], selected: string[]): { ok: true; valueIds: string[] } | { ok: false; reason: 'REQUIRED_MISSING' | 'TOO_FEW' | 'TOO_MANY' | 'UNKNOWN_VALUE' | 'INACTIVE_VALUE' | 'DUPLICATE_VALUE'; groupId?: string }`
   - `defaultSelection(groups): string[]` (lấy giá trị đầu tiên còn active của nhóm required)
   - `priceLine({ basePriceVnd, deltasVnd: number[], quantity }): { unitPriceVnd; lineTotalVnd }` (quantity 1–50)
   - `orderTotals({ lineTotalsVnd: number[], deliveryFeeVnd }): { subtotalVnd; deliveryFeeVnd; totalVnd }`
   - Unit test: mọi nhánh reason, topping cộng tiền, nhóm không required với `min 0`, overflow an toàn (`assertVnd`).
3. **Catalog services + API (staff đọc; owner ghi).**
   - `GET/POST /api/stores/:id/categories`, `PATCH /api/stores/:id/categories/:categoryId`
   - `GET/POST /api/stores/:id/products`, `PATCH …/products/:productId`
   - `PUT …/products/:productId/options`: thay toàn bộ nhóm + giá trị trong 1 transaction
   - `POST …/products/:productId/image`: multipart, ≤ 2 MB, chỉ `image/jpeg|png|webp`; key `stores/<storeId>/products/<productId>/<token>.<ext>`; bucket `product-images`; xoá ảnh cũ sau khi commit
   - Ma trận tenant thêm các hàng: staff GET 200, staff POST/PATCH 403, tenant khác 404; `categoryId` thuộc store khác → 404.
   - **Lệch spec:** upload ảnh đi qua server thay vì presigned PUT, vì CORS của Neon Storage cho browser PUT chưa được xác minh. Ghi chú này vào spec §2 khi làm.
4. **Fulfillment settings + delivery zones + tables.**
   - `PATCH /api/stores/:id/fulfillment` (`dineInEnabled`, `pickupEnabled`, `deliveryEnabled`; phải bật ít nhất 1 mode)
   - CRUD `/api/stores/:id/delivery-zones`
   - `/api/stores/:id/tables`: create trả `qrUrl` **một lần**; `POST …/tables/:tableId/regenerate` (token cũ chết ngay); `PATCH active=false` để thu hồi
   - Test: token cũ sau regenerate → fulfillment báo `INVALID_TABLE`; bật delivery mà không có zone active → cho phép bật, nhưng menu public trả `delivery.available=false`.
5. **Public API.**
   - `GET /api/public/stores/:slug/menu` → `{ store: { name, slug, isAcceptingOrders, logoUrl }, modes, categories[], products[] (gồm optionGroups, isAvailable, imageUrl) }`. Không trả `orgId`, `active=false`. Header `Cache-Control: public, max-age=30, s-maxage=60`.
   - `GET /api/public/stores/:slug/fulfillment?t=` → `{ modes, deliveryZones[{id,name,feeVnd}], table: { displayName } | null, tableError: 'INVALID_TABLE' | null }`, header `no-store`.
   - Store `SUSPENDED`/không tồn tại → 404.
6. **Owner UI.** `/app/menu` (danh sách theo danh mục, thêm nhanh tên + giá, bật/tắt còn hàng, sheet sửa option, upload ảnh); settings thêm tab "Nhận món & khu vực giao" và "Bàn & QR" (render QR bằng `qrcode@1.5.4` sang PNG, nút tải/in); nav owner thêm "Thực đơn".
7. **Public UI C1/C2.** `/s/[slug]`: header store, chip danh mục (sticky), tìm kiếm khi > 15 món, card món (giá `formatVnd`, nhãn "Hết hàng"), sheet option (`UDrawer`) có default selection, nút "Thêm • XX.000đ". Món không có option thì bấm `+` thêm ngay. Giỏ tạm giữ trong state (lưu localStorage ở PR3). `?t=` hiện "Bàn 05" hoặc thông báo QR không hợp lệ. E2E: mở menu bằng link chung và bằng QR; QR hỏng thì không gắn bàn.

---

## PR3 — `feat(order)`: giỏ hàng, checkout COD, idempotency, tracking

**Exit:** khách đặt đơn COD end-to-end cho cả 3 fulfillment; retry/double tap không tạo trùng; khách theo dõi đơn ở `/o/:token`.

**Migration `ordering`:**
- `orders`: theo spec §4.3 + PRD §6, gồm `public_code`, `guest_token_hash` unique, `guest_token_encrypted`, `late_payment`, `unique(store_id, idempotency_key)`, `unique(store_id, public_code)`, FK `(store_id, table_id)`, `(store_id, delivery_zone_id)`.
- `order_items`, `order_events`.
- `rate_limits(key, window_start, count, PK(key, window_start))`.
- Enums: `fulfillment_type`, `order_status`, `payment_method`, `payment_status`.

**Tasks:**

1. **`server/utils/crypto.ts`.** `encryptSecret(plain: string): string` (định dạng `v1.<iv>.<tag>.<ct>` base64url), `decryptSecret(blob: string): string`, key từ `APP_ENCRYPTION_KEY` (32 byte base64; sai độ dài thì throw khi khởi động). Unit test: round-trip, tamper → throw, sai key → throw. Thêm `APP_ENCRYPTION_KEY` vào `.env`, `.env.test`, Vercel và CI.
2. **`shared/schemas/checkout.ts` + `shared/phone.ts`.** `normalizeVnPhone(input): string | null` (chấp nhận `+84`/`84`/`0`, 10 số đầu `03|05|07|08|09`). Schema body theo spec §5.1 và giới hạn của nó; `superRefine` theo fulfillment. Unit test đủ nhánh.
3. **`server/services/ordering/rate-limit.ts`.** `consumeRateLimit(db, key, { limit, windowSec }): Promise<boolean>` dùng `insert … on conflict do update set count = count + 1 returning count`. Integration test: request thứ 11 bị chặn; cửa sổ mới thì reset.
4. **`server/services/ordering/create-order.ts`.** `createOrder(db, { slug, input, ip }): Promise<CreateOrderResult>` theo spec §5.1–5.2 (chưa có nhánh BANK_QR: trả 422 `PAYMENT_METHOD_UNAVAILABLE`). `generatePublicCode()` dùng alphabet trong spec, retry tối đa 5 lần khi đụng unique. Integration test:
   - 3 fulfillment; thiếu tên/SĐT; zone sai; table token sai/thu hồi
   - store đóng; mode tắt
   - `CART_STALE` khi món hết hàng / option bị tắt / giá đổi (server dùng giá mới, client nhận stale)
   - idempotency tuần tự trả cùng `guestToken`; idempotency đồng thời (`Promise.all` 5 request) chỉ tạo 1 đơn
   - rate limit; snapshot giữ nguyên sau khi sửa món
5. **`server/services/ordering/transitions.ts` (thuần).** `nextStatuses(order: { status; fulfillmentType }, actorRole): OrderStatus[]`, `canCancel(order: { status; paymentStatus }, actorRole): boolean`, theo bảng spec §5.3. Unit test kiểu bảng. PR4 dùng.
6. **Public routes.** `POST /api/public/stores/:slug/orders`, `GET /api/public/orders/:token` (`no-store`, SĐT che còn 3 số cuối, không có địa chỉ, không có `orgId`/`storeId`). Token sai → 404. Test PII.
7. **Client.** `useCart(slug)` (localStorage `zeno:cart:<slug>`, `pendingIdempotencyKey`, đánh dấu dòng stale), sheet C3 checkout có field theo fulfillment, trang `/o/[token]` (C4, poll 4 s khi tab hiển thị qua `useDocumentVisibility`), lưu danh sách đơn gần đây của khách trong localStorage. E2E: 3 luồng COD; reload giữa chừng giữ giỏ; double tap chỉ ra 1 đơn; mất mạng rồi retry.

**Điểm lệch đã chốt khi viết plan chi tiết ([04-ordering](./2026-10-31-zeno-v1-04-ordering.md)):**
- Body checkout có thêm `expectedUnitPriceVnd` (mỗi dòng) và `expectedTotalVnd` (cả đơn): server chỉ biết giá đã đổi khi khách gửi giá họ đang thấy; không có hai trường này thì `CART_STALE` vì "giá đổi" không thể phát hiện. Thêm `note` tuỳ chọn cho cả đơn (C3 có "ghi chú cho quán").
- `orders` thêm `table_label`, `delivery_zone_name` (snapshot, nullable); `order_items` dùng `qty` và `options_snapshot_json` đúng PRD §6.
- Enum dùng chung ở `shared/enums.ts` (không phải `shared/types`).
- `consumeRateLimit` nhận thêm `now?: Date` (để test cửa sổ mới); `createOrder` nhận tham số thứ ba tuỳ chọn `deps` (seam cho test: `generatePublicCode`, `beforeCommit`).
- Rate limit được tính **trong** transaction, sau advisory lock và kiểm tra replay. Preflight `CART_STALE`/422 trả kết quả lỗi để commit bộ đếm rồi ném bên ngoài; retry cùng key không tính thêm và không cần kết nối pool thứ hai.
- Polling khi tab hiển thị dùng composable tự viết `useVisiblePolling` thay cho `useDocumentVisibility` của VueUse, để không thêm dependency.
- Thêm `server/utils/safe-path.ts` để che guest token trong log đường dẫn.

---

## PR4 — `feat(owner)`: order board, trạng thái, hủy, đã thu tiền, mời nhân viên, báo cáo

**Exit:** PRD Phase 3 exit, tức phục vụ được đơn trả khi nhận end-to-end tại một cửa hàng.

**Migration `owner_ops`:** bảng `order_payments` (cần cho mark-paid; cột `bank_transaction_id` nullable, FK thêm ở PR5) và index `orders(store_id, status, created_at desc)`.

**Tasks:**

1. **Board API.** `GET /api/stores/:id/orders?tab=new|doing|ready|other|awaiting_payment&cursor=`. Phân trang bằng cursor `(created_at, id)`, 30 đơn/trang; response có `serverTime` để poll lấy phần thay đổi. `GET /api/stores/:id/orders/:orderId` trả chi tiết + lịch sử event.
2. **Chuyển trạng thái.** `PATCH …/orders/:orderId/status { expectedStatus, nextStatus }` dùng `transitions.ts`, `UPDATE … WHERE status = expected`. Không có dòng nào được cập nhật thì trả 409 `STATUS_CONFLICT`. Ghi event có `actor_user_id`. Integration test: 2 request đồng thời → đúng 1 thành công (Review Focus #9).
3. **Hủy + mark-paid.**
   - `POST …/orders/:orderId/cancel { expectedStatus, reason }`: staff chỉ hủy được khi chưa thu tiền; đơn đã `PAID` thì chỉ owner, và `payment_status` chuyển `REFUND_DUE`.
   - `POST …/orders/:orderId/mark-paid { expectedPaymentStatus, method: 'CASH', note? }`: staff được phép, ghi `order_payments` và event.
   - `BANK_MANUAL` và `REFUND_DUE → REFUNDED` làm ở PR6.
4. **Mời nhân viên.**
   - `POST /api/stores/:id/team/invitations { email }` (owner): trả link `/invite/<token>` một lần, hạn 7 ngày.
   - `GET /api/stores/:id/team` liệt kê thành viên; `PATCH` để disable.
   - `GET /api/invitations/:token` (đã đăng nhập) xem thông tin lời mời; `POST /api/invitations/:token/accept`: email phải trùng với tài khoản đang đăng nhập (so sánh không phân biệt hoa thường), dùng 1 lần, đã hết hạn thì 404.
   - Trang `/invite/[token]`.
   - Ma trận tenant thêm các hàng: staff không mời được (403); owner B không mời được vào store A (404).
5. **Báo cáo.** `GET /api/stores/:id/summary?date=YYYY-MM-DD` theo spec §8; ranh giới ngày tính theo `Asia/Ho_Chi_Minh` (`(created_at at time zone 'Asia/Ho_Chi_Minh')::date`). Integration test: đơn tạo 23:30 và 00:30 giờ VN rơi đúng ngày; "đã thu" lấy từ `order_payments`, không lấy từ `total_vnd`.
6. **Owner UI.**
   - `/app/orders`: tab có badge; card có một nút hành động chính theo trạng thái; poll 5 s khi tab hiển thị; âm báo chỉ sau khi người dùng tương tác.
   - O2: slide-over chi tiết, nút `tel:`, lịch sử trạng thái.
   - `/app/reports`; tab "Nhân viên" trong settings.
   - E2E: owner và staff (2 browser context) cùng thao tác 1 đơn; khi conflict thì UI tải lại và báo cho người dùng.

---

## PR5 — `feat(payment-setup)`: tài khoản nhận tiền, SePay integration, payment attempt, VietQR

**Triển khai:** xem [PR5 implementation](../specs/2026-11-03-pr5-payment-setup-implementation.md) cho interface thực tế, xác minh và các gate kiểm thử ngân hàng/SePay thật còn chờ trước merge.

**Exit:** owner cấu hình tài khoản ngân hàng + SePay; khách chọn VietQR thì thấy QR đúng bank, số tiền và mã thanh toán; đơn ở trạng thái `AWAITING_PAYMENT` và không vào queue pha chế.

**Đã viết chi tiết:** [2026-10-31-zeno-v1-06-payment-setup.md](./2026-10-31-zeno-v1-06-payment-setup.md). Lệch so với outline: `payment_attempts` lưu bản chụp tài khoản; `store_payment_accounts` thêm `va_number`, `qr_checked_at`; `sepay_integrations` thêm `last_valid_webhook_at`, `secret_updated_at`, `activated_at`; thêm route `check`, `confirm-qr`, `activate`, các `GET` cho UI; bắt buộc VA cho BIDV/MSB/OCB/KienLongBank và `SEVQR` cho VietinBank (theo tài liệu SePay).

**Migration `payment_setup`:** `store_payment_accounts`, `sepay_integrations` (cột `encrypted_hmac_secret`, `encrypted_api_token`, `key_version`, `status`, `webhook_endpoint_key` unique), `integration_accounts`, `payment_attempts` (`payment_code` unique toàn hệ thống, `status`, `expires_at`, FK `(store_id, order_id)`). FK `order_payments.bank_transaction_id` thêm ở PR6.

**Tasks:**

1. **Payment account + integration services** (chỉ owner).
   - `POST/PATCH /api/stores/:id/payment-accounts`.
   - `POST /api/organizations/:orgId/sepay-integrations`.
   - `PUT …/:integrationId/secret { hmacSecret, apiToken? }`: chỉ ghi, mã hoá bằng `encryptSecret`.
   - `GET` chỉ trả `hasSecret`, `updatedAt` và `webhookUrl`.
   - `POST …/:integrationId/accounts` để liên kết tài khoản.
   - Test: staff gọi → 403; mọi response không chứa secret; rotate secret thì bản cũ bị ghi đè.
2. **`server/services/payments/payment-code.ts`.** `generatePaymentCode(): string` dạng `ZO` + 8 ký tự `[A-Z0-9]`, retry khi đụng unique. `buildVietQrUrl({ bankCode, accountNumber, amountVnd, paymentCode }): string` theo định dạng đã xác minh. Unit test.
3. **Bật nhánh BANK_QR trong `createOrder`.** Chọn account đã verified và integration `ACTIVE`; tạo attempt với TTL; response có `qr`. `GET /api/public/orders/:token` trả `qr` khi còn `PENDING`. `POST /api/public/orders/:token/payment-attempts` (thanh toán lại): attempt cũ chuyển `SUPERSEDED`. Test: board không thấy đơn `AWAITING_PAYMENT` ở tab `new`.
4. **UI.** Wizard SePay trong settings (owner) theo PRD §8.1, có nút copy webhook URL. C4 chờ thanh toán: QR, nút copy số tài khoản/nội dung, lưu ảnh QR, đếm ngược đến `expiresAt`, poll 4 s.

---

## PR6 — `feat(payment-webhook)`: webhook, matching, cron, đối soát

**Exit:** PRD Phase 4 exit, tức chuyển khoản đúng được xác nhận đúng **một lần**; tiền lạ hoặc chuyển muộn không biến mất.

**Migration `payment_webhook`:** `bank_transactions` (`unique(integration_id, provider_transaction_id)`, `provider_alt_ids text[]`, `reconciliation_status`), `bank_transaction_events`, `reconcile_checkpoints`, FK `order_payments.bank_transaction_id` + `unique where not null`.

**Tasks:**

1. **`server/services/payments/sepay-signature.ts`.** `verifySepaySignature({ rawBody, timestamp, signatureHeader, secret, nowSec }): 'OK' | 'MISSING' | 'STALE' | 'MISMATCH'`, so sánh bằng `timingSafeEqual`, cửa sổ thời gian 300 s. Unit test bằng vector tự ký.
2. **`server/services/payments/match-transaction.ts`.** `matchTransaction(db, bankTransactionId): Promise<MatchOutcome>` theo bảng spec §6.3, chạy trong transaction có `SELECT … FOR UPDATE`. Integration test mỗi hàng của bảng, cộng thêm late payment và đơn đã hủy.
3. **Webhook route `POST /api/webhooks/sepay/[key]`.** Dùng `readRawBody`; Tx1 upsert `bank_transactions`, Tx2 match; trả `{"success": true}` sau khi commit. Integration/API test (Review Focus #10):
   - thiếu/sai HMAC; timestamp lệch
   - replay
   - 5 request trùng nhau đồng thời (`Promise.all`) → 1 payment
   - sai tài khoản; tiền thiếu/thừa; `code` null
   - đến sau khi hết hạn; đến sau khi hủy
   - `transferType = out` → `IGNORED`
   - DB lỗi ở Tx2 → giao dịch nằm `RECEIVED` và lần reconcile sau sẽ match lại
4. **Cron.**
   - `POST /api/internal/reconcile-sepay` và `POST /api/internal/expire-payment-attempts`, xác thực `Authorization: Bearer ${CRON_SECRET}` (so sánh bằng `timingSafeEqual`).
   - SePay client được inject qua interface `SepayTransactionsClient { list({ accountNumber, from, to, cursor }) }` để test dùng bản giả.
   - `vercel.json` khai báo `crons`.
   - Test: reconcile không ghi nhận tiền hai lần với giao dịch webhook đã có; checkpoint tiến lên; đơn quá 24 h chỉ bị hủy sau khi reconcile đã chạy.
5. **Màn đối soát `/app/reconciliation` (owner) + API.**
   - Gắn giao dịch vào đơn; đánh dấu đã xử lý (`RESOLVED`); `REFUND_DUE → REFUNDED` (bắt buộc ghi chú).
   - `mark-paid` với `BANK_MANUAL` (chỉ owner, bắt buộc ghi chú).
   - Audit đầy đủ. Ma trận tenant: staff → 403.
6. **E2E.** Đặt đơn VietQR → giả lập webhook có ký HMAC → trang khách và board chuyển sang `NEW/PAID`.

---

## PR7 — `test(hardening)`: chất lượng, bảo mật, vận hành, pilot

**Exit:** PRD Phase 5 exit, tức đạt go-live checklist.

**Tasks:**

1. **E2E đầy đủ** PRD §11 trên `mobile-chrome`, `mobile-safari` và desktop; viewport 360×740 thao tác một tay.
2. **A11y:** `@axe-core/playwright` trên `/s/:slug`, C3, C4, `/app/orders`; focus trap trong sheet; label đầy đủ.
3. **Security pass:**
   - rà XSS (không dùng `v-html` với dữ liệu người dùng)
   - CSRF (API dùng Bearer, không dùng cookie session phía app)
   - rate limit checkout + tracking
   - quét authz theo ID qua ma trận tenant
   - header bảo mật trong `routeRules`: `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`
   - `npm audit --omit=dev` không còn lỗ hổng high/critical ở dependency runtime
4. **Performance:** ảnh có `width`/`height`, `loading="lazy"`; cache menu; `no-store` cho endpoint nhạy cảm; kiểm tra Lighthouse mobile trên `/s/:slug`.
5. **Vận hành:**
   - `docs/operations.md` gồm: backup/restore Neon (thử restore branch về một thời điểm), rollback migration, xoay vòng `APP_ENCRYPTION_KEY` (`key_version`), quy trình đối soát thủ công khi webhook gián đoạn.
   - Alert khi có > N webhook invalid trong 15 phút (dựa trên log).
6. **Pilot:** checklist PRD §15, ghi kết quả vào `docs/pilot-report.md`.

---

## Self-review (roadmap ↔ spec)

| Spec | PR |
|---|---|
| §2 quyết định kiến trúc, §3 module, §3.2 env | PR0 (+ `APP_ENCRYPTION_KEY` PR3, `CRON_SECRET` PR6) |
| §3.1 auth | PR1 |
| §4.1–4.2 identity + tenant FK | PR1 |
| §4.3–4.5 các bảng còn lại + seed | PR2–PR6; `npm run db:seed` làm ở PR2 (menu) và mở rộng ở PR3 |
| §5 ordering | PR3 (checkout, tracking), PR4 (board, transitions, mark-paid) |
| §6 payments | PR5 (config, attempt, QR), PR6 (webhook, reconcile, review) |
| §7 UI | PR1 (auth/onboarding/settings), PR2 (menu, C1/C2), PR3 (C3/C4), PR4 (O1/O2/O5, invite), PR5–6 (SePay, đối soát) |
| §8 reporting | PR4 |
| §9 error codes | PR0 (định nghĩa), PR1 (cập nhật spec với `ORG_EXISTS`, `SERVICE_UNAVAILABLE`) |
| §10 testing, CI | PR0 (hạ tầng), mọi PR (test riêng), PR7 (E2E đầy đủ) |
| §11 PR roadmap | file này |
| §13 điểm cần xác minh | PR1 Task 2 Step 6 (`@neon/auth`, claim JWT); PR5–6 (SePay) |

## PR4 handoff cho PR5/PR6 (2026-11-02)

Board, chi tiết, status/cancel/cash APIs, lời mời và báo cáo đã triển khai. Dùng lại `listBoard`, tab `awaiting_payment`, `newOrderIds`, `statusConflict`, `transitionOrder`, `insertOrderEvent`, `recordCashPayment` và các component đơn hàng. Hệ thống PR6 dùng transition repository trong transaction để chuyển `AWAITING_PAYMENT → NEW`; endpoint staff không cho chuyển này. `insertOrderEvent` hiện yêu cầu actor là string: PR6 nới input sang `string | null` cho system event (cột DB đã nullable).

Migration `0003_owner_ops` tạo `order_payments` với unique `order_id` và thêm index board còn thiếu trong PR3 thực tế. PR6 thêm FK và conditional unique cho `bank_transaction_id`, triển khai `BANK_MANUAL`/hoàn tiền owner-only. `/app/team` tách khỏi settings; `/reports` owner-only, `/summary` cho cả staff được cấp store. Lời mời mặc định bắt buộc email đã xác minh; PR7 phải xác minh claim JWT thật trước production. Chi tiết và bằng chứng kiểm tra ở [PR4 implementation](../specs/2026-11-02-pr4-owner-ops-implementation.md).
