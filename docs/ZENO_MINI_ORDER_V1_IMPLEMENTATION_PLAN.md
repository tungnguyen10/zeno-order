# ZENO MINI ORDER — IMPLEMENTATION PLAN V1
> Phiên bản: 1.0 | Ngày: 31/10/2026 | Trạng thái: Ready for implementation planning  
> Công nghệ: Nuxt 4 + Vue 3 + TypeScript + Nitro + Neon PostgreSQL + Drizzle ORM + Zod + Nuxt UI/Tailwind + npm + Vercel

## 0. Mục tiêu & quy ước triển khai

Xây mini web order cho trà sữa/cafe, **mobile-first, guest-first**, hỗ trợ nhiều chủ quán/cửa hàng (multi-tenant), ba kiểu nhận món và hai kiểu thanh toán.

**Nguyên tắc sản phẩm**
- Khách: mở link/QR → chọn món → xác nhận thông tin → thanh toán/gửi đơn; không phải đăng ký.
- Owner/Staff: đăng nhập → thấy đơn ngay → một nút hành động chính theo trạng thái.
- Một menu cho cả **QR tại bàn**, **mang đi** và **giao hàng**.
- Mỗi chủ (organization) có thể có nhiều store; quyền và dữ liệu phải bị giới hạn đúng phạm vi.
- **Tiền chuyển khoản vào ngân hàng của owner/store**, ZENO không giữ hoặc trung chuyển tiền.
- MVP ưu tiên **đơn hàng + xác nhận thanh toán đáng tin cậy**, chưa làm POS/kho/loyalty.
- Không được coi bấm "Đã chuyển khoản" trên frontend là đã thanh toán.

**Definition of MVP:** Một chủ quán có thể tự tạo cửa hàng/menu/bàn/QR, nhận đơn tại bàn hoặc takeaway/delivery, nhận chuyển khoản có đối soát tự động qua SePay hoặc nhận tiền trực tiếp, xem đơn và đánh dấu hoàn thành trên điện thoại. Không rò rỉ dữ liệu giữa các cửa hàng/tổ chức.

**Trước khi sửa repo** (dành cho coding agent):
1. Đọc README, package.json, file cấu hình, migrations, cấu trúc thư mục và các convention hiện có.
2. Tái sử dụng component, composable, schema, auth, CI hiện có; không khởi tạo lại nếu repo đã có.
3. Trình bày ngắn phạm vi thay đổi và migration trước khi code; chia PR nhỏ theo phase.
4. Dùng **npm** và cập nhật `package-lock.json`; không dùng pnpm.
5. Không commit `.env`, token SePay, mật khẩu, thông tin ngân hàng test thật.

## 1. Scope V1 & ngoài phạm vi

| Lĩnh vực | Trong V1 | Không làm trong V1 |
|---|---|---|
| Khách | Menu, tìm món/danh mục, option, giỏ, checkout, track order | Tài khoản khách, loyalty |
| Nhận món | QR bàn, pickup, delivery | Tích hợp đối tác ship, GPS/maps, realtime tracking shipper |
| Store | Tạo store, mở/tắt nhận đơn, link chung, QR từng bàn | Custom domain, sơ đồ bàn |
| Menu | Danh mục, món, giá, ảnh tùy chọn, size/đường/đá/topping | Kho nguyên liệu, combo phức tạp |
| Order | Board, trạng thái, lịch sử, hủy có quyền | POS, in bếp, xử lý đa chi nhánh cùng 1 order |
| Thanh toán | VietQR chuyển khoản qua SePay + trả tiền khi nhận | Thẻ tín dụng, ví điện tử, auto-refund |
| Báo cáo | Số đơn, doanh thu đã thu, đơn chờ/huỷ theo ngày/store | BI, kế toán, hóa đơn VAT |
| Nhân sự | Owner + Staff theo store | ACL quyền tùy biến chi tiết |
| SaaS | Organization/store isolation | Gói thuê bao, billing nền tảng |

**Delivery V1:** Phí theo **khu vực owner cấu hình** (`delivery_zones`: tên khu vực + phí VND + active), không tính quãng đường. Khách chọn khu vực, nhập địa chỉ chi tiết; server kiểm tra khu vực và tính phí. Nếu không có khu vực hợp lệ thì không cho checkout giao hàng. Chưa hứa ETA động.

**Đặc tả phương thức thanh toán:** "Online" trong V1 là **chuyển khoản ngân hàng bằng VietQR và nhận webhook SePay**, không phải thu tiền thẻ qua hosted checkout.

## 2. Luồng trải nghiệm khách

### 2.1. Điểm vào
- Link chung: `/s/:storeSlug` → chọn **Mang đi** hoặc **Giao hàng** (nhớ lựa chọn gần nhất trên thiết bị).
- QR tại bàn: `/s/:storeSlug?t=:tableToken` → tự chọn **Tại bàn** và hiện "Bàn 05".
- `tableToken` là token ngẫu nhiên, server tra cứu trong `store_tables`; không tin số bàn/chế độ do client tự khai.
- Nếu QR không hợp lệ/vô hiệu: thông báo dễ hiểu, không lặng lẽ gắn sang bàn khác.
- Cho phép chủ quán chọn bật/tắt takeaway/delivery và tạm đóng nhận order.

### 2.2. 4 màn hình/tình huống cốt lõi
**C1. Menu (1 page)**: tên store, trạng thái nhận đơn, nhãn hình thức nhận món, category chips, tìm kiếm nếu menu lớn, product cards (tên/giá/hết hàng), nút giỏ sticky.

**C2. Product options (bottom sheet)**: chỉ mở khi món có option; mặc định option hợp lệ (size M, đường/đá mặc định); topping theo lựa chọn; số lượng, ghi chú ngắn; nút "Thêm • XX.000đ". Món không option: nút `+` thêm ngay.

**C3. Cart + Checkout (bottom sheet hoặc một bước checkout ngắn)**:
- **Dine-in**: số bàn tự điền; tên/SĐT tùy chọn, không địa chỉ.
- **Takeaway**: tên người đặt + SĐT bắt buộc, không địa chỉ.
- **Delivery**: tên + SĐT + khu vực giao + địa chỉ chi tiết bắt buộc; ghi chú tùy chọn.
- Danh sách món/option/SL/tạm tính/phí giao/tổng; chọn **VietQR** hoặc **Trả khi nhận**.
- Giỏ giữ qua refresh (localStorage), bỏ qua/sửa các sản phẩm không còn bán sau khi tải lại.
- Không tạo đơn khi mới mở QR hoặc xem menu; tạo khi bấm "Đặt món" / "Tiếp tục thanh toán".

**C4. Order Result / Tracking**:
- Trả khi nhận: hiện mã đơn, "Đã gửi quán", hình thức nhận và trạng thái.
- VietQR: màn "Chờ thanh toán", QR gắn số tiền + nội dung chuyển khoản riêng, tên ngân hàng/người nhận, nút copy, lưu ảnh QR; polling status khi tab hoạt động.
- Chỉ hiện "Đã thanh toán" khi server xác nhận; sau khi thanh toán thành công hiện tiến độ món.
- Khách đóng tab vẫn mở lại được `/o/:guestToken` (token không đoán được, lưu hash server).
- Đặt thêm món = tạo đơn mới; không sửa đơn đã phát hành.

### 2.3. Quy tắc UI/UX
- Không yêu cầu account, email, địa chỉ ở phương thức không cần.
- Mobile viewport trước; desktop hiển thị menu/grid thoáng.
- Hiện validation inline, loading, empty/error state, báo rõ khi quán ngừng nhận đơn.
- Nút checkout chặn double click nhưng **chống trùng thực sự ở server**.
- Ảnh tối ưu kích thước, lazy-load, không chặn phần text/giá khi ảnh chậm.
- Không hiển thị nút "Đã thanh toán" để khách tự xác nhận.
- Khách không thể tự chuyển mode "tại bàn" nếu không có QR token hợp lệ.

## 3. UX Owner & Staff

**Onboarding lần đầu (Owner):** Sign up/Login → tạo organization/store bằng tên + slug → thêm món (tên, giá, danh mục) → tạo bàn và QR (tùy chọn) → cấu hình thanh toán (có thể để sau, vẫn bán COD) → share link.

**Màn O1 — Order Board (`/app/orders`)**: mặc định sau login; single-store thì không có store switcher. Tab `Mới`, `Đang làm`, `Sẵn sàng`, `Khác/hoàn thành`; badge chưa thanh toán; card hiển thị mã đơn, Bàn/Mang đi/Giao hàng, món + option, tổng, tên/SĐT nếu có. Nút hành động theo status. Poll 5 giây khi trang đang active; âm báo chỉ sau user interaction.

**Màn O2 — Order detail:** đầy đủ items/option, địa chỉ giao, SĐT, ghi chú, lịch sử trạng thái; thao tác đánh dấu đã thu tiền đối với COD, hủy theo quyền, các trường hợp cần đối soát. Số điện thoại nên có nút gọi trên mobile.

**Màn O3 — Menu:** danh mục, sản phẩm, giá, bật/tắt, thêm mới nhanh. Hình ảnh và option nâng cao có thể thêm sau khi món được tạo.

**Màn O4 — Settings:** tên/logo store, đóng/mở nhận đơn, các mode bật, delivery zones/phí, bàn/QR, thông tin chuyển khoản + trạng thái kết nối SePay, nhân viên (mời/thu hồi).

**Màn O5 — Báo cáo đơn giản:** theo ngày: tổng đơn, đơn hoàn tất, đơn hủy, tổng giá trị đơn, **đã thu** (phân biệt online đã xác nhận / tiền mặt staff đánh dấu), còn chưa thu; lọc store.

**Đơn chờ VietQR chưa nhận tiền không xuất hiện trong queue pha chế.** Owner có thể thấy ở tab "Chờ thanh toán", nhưng không thể chuyển thành "Đã thanh toán" chỉ vì khách gửi ảnh. Trường hợp khẩn cấp cho phép owner ghi nhận thủ công sau khi đối chiếu ngân hàng, có audit + xác nhận rõ.

## 4. State machines (tách biệt)

### 4.1. Fulfillment
`DINE_IN | PICKUP | DELIVERY`

### 4.2. Order status
`AWAITING_PAYMENT -> NEW -> PREPARING -> READY -> COMPLETED`
- `READY -> DELIVERING -> COMPLETED` chỉ với `DELIVERY`.
- COD / trả khi nhận tạo `NEW` ngay, nhưng `payment_status=UNPAID`.
- VietQR tạo `AWAITING_PAYMENT`; sau webhook đối soát đúng mới `NEW`.
- Cho phép `NEW -> READY` nếu quán dùng chế độ xử lý nhanh.
- `CANCELLED` có thể từ `AWAITING_PAYMENT | NEW | PREPARING` theo quyền/điều kiện; đơn đã thu phải đánh dấu yêu cầu hoàn tiền thủ công, không tự coi tiền đã hoàn.
- Không cho trạng thái đi lùi tùy ý; check expected status để ngăn 2 nhân viên ghi đè.
- Expire payment attempt không tự suy ra rằng ngân hàng không có giao dịch; reconcile trước khi close và xử lý late payment.

### 4.3. Payment method / status
`payment_method = BANK_QR | PAY_ON_RECEIPT`

`payment_status = UNPAID | PENDING | PAID | REVIEW_REQUIRED | REFUND_DUE | REFUNDED`
- `BANK_QR` khởi đầu `PENDING`, có `payment_attempt` cùng `expires_at` mặc định 15 phút (cấu hình).
- `PAY_ON_RECEIPT` khởi đầu `UNPAID`, Owner/Staff có quyền đánh dấu đã thu với phương thức thực thu và thời điểm.
- Chuyển thiếu/thừa/sai mã/nhầm tài khoản: `REVIEW_REQUIRED`, không auto `PAID`.
- Online đã thu mà đơn bị hủy: `REFUND_DUE`; refund thủ công ngoài hệ thống V1 + bằng chứng, không tự chuyển sang `REFUNDED` nếu chưa hoàn tiền.
- Không gộp payment status vào order status.

## 5. Multi-tenant & authorization

- **Organization** đại diện một chủ/nhóm cửa hàng; **Store** là một chi nhánh.
- User có thể thuộc nhiều organizations qua `organization_members`; `store_members` cấp quyền riêng theo store.
- V1: `OWNER` toàn org; `STAFF` chỉ các store được cấp; `PLATFORM_ADMIN` (nếu cần) có bảng/allowlist quyền riêng.
- Mọi API nội bộ đọc membership tại server; route params không đại diện quyền. Scope mọi truy vấn theo `organization_id` và `store_id`; xác thực FK ràng buộc cùng tenant.
- Không lộ menu nháp, order hay thông tin giao nhận của store A cho store B.
- Public chỉ được đọc menu đã publish và tạo đơn cho store active; tracking dùng `guest_token`.
- Xem xét PostgreSQL RLS như lớp phòng vệ bổ sung; nếu triển khai, đặt tenant context **trong transaction** và kiểm thử pool connection không rò context. Authorization tại service/API là bắt buộc dù có RLS.

## 6. Database schema — kế hoạch migration

Dùng UUID nội bộ, TIMESTAMPTZ, tiền VND kiểu `BIGINT`/integer chính xác, soft delete/active cho catalog. Tất cả index và unique áp dụng theo scope.

| Bảng | Cột/quan hệ quan trọng |
|---|---|
| `users` | id, email unique, password_hash / provider_ref, name, status |
| `organizations` | id, name, slug unique, status |
| `organization_members` | org_id, user_id, role, status, unique(org_id,user_id) |
| `stores` | id, org_id, slug unique toàn hệ thống (vì route /s/:storeSlug), name, is_accepting_orders, settings_json |
| `store_members` | org_id, store_id, user_id, role, status, unique(store_id,user_id) |
| `store_tables` | id, org_id, store_id, code, display_name, token_hash, active, unique(store_id,code) |
| `delivery_zones` | id, org_id, store_id, name, fee_vnd, active |
| `categories` | id, org_id, store_id, name, position, active |
| `products` | id, org_id, store_id, category_id, name, description, image_url, base_price_vnd, is_available, position |
| `product_option_groups` | id, org_id, store_id, product_id, name, min_select, max_select, required, position |
| `product_option_values` | id, org_id, store_id, group_id, name, price_delta_vnd, active, position |
| `orders` | id, org_id, store_id, public_code, guest_token_hash, fulfillment_type, table_id nullable, customer_name, customer_phone, delivery_zone_id, address_snapshot, notes, subtotal_vnd, delivery_fee_vnd, total_vnd, status, payment_method, payment_status, idempotency_key, created_at |
| `order_items` | id, org_id, store_id, order_id, product_id nullable, name_snapshot, options_snapshot_json, qty, unit_price_vnd, line_total_vnd |
| `order_events` | id, org_id, store_id, order_id, actor_user_id nullable, event_type, from_state, to_state, metadata, created_at |
| `store_payment_accounts` | id, org_id, store_id, bank_code, account_number, account_holder, is_active, verified_at |
| `sepay_integrations` | id, org_id, name, environment (test/live), webhook_endpoint_key, encrypted_hmac_secret, encrypted_api_token nullable, status |
| `integration_accounts` | integration_id, payment_account_id, unique(integration_id,payment_account_id) |
| `payment_attempts` | id, org_id, store_id, order_id, account_id, payment_code, expected_amount_vnd, status, expires_at, created_at |
| `bank_transactions` | id, integration_id, org_id, provider_transaction_id, bank_account_number, direction, amount_vnd, payment_code nullable, reference_code, raw_payload_json, received_at, reconciliation_status, unique(integration_id,provider_transaction_id) |
| `order_payments` | id, org_id, store_id, order_id, bank_transaction_id nullable, method, amount_vnd, recorded_by nullable, recorded_at, unique(bank_transaction_id) WHERE bank_transaction_id IS NOT NULL |

**Ràng buộc quan trọng:**
- FK composite hoặc các constraint tương đương bảo đảm product/category/order/payment trong **cùng org/store**.
- Unique `(store_id,idempotency_key)` cho checkout.
- `payment_code`: sinh ngẫu nhiên đủ entropy, không lặp trên các attempt active của cùng tài khoản (ưu tiên unique toàn hệ thống), format tương thích cấu hình mã của SePay.
- Unique `(integration_id,provider_transaction_id)` cho webhook. ID ở webhook có thể là **integer**, API đối soát v2 có UUID riêng; không giả định hai hệ ID tương đương.
- Không ghi đè items/giá quá khứ: snapshot khi tạo order.
- `customer_phone` chỉ cho phép staff cùng store xem; log và analytics phải che thông tin nhạy cảm.

**Thứ tự migrations:** identity/org/store → catalog/table/delivery → orders/events → payment config/attempts/transactions → indexes/constraints → seed thử nghiệm.

## 7. API contracts (V1)

### Public
- `GET /api/public/stores/:slug/menu` → cấu hình store công khai, products/options, các mode đang bật; không trả PII, auth secrets.
- `GET /api/public/stores/:slug/fulfillment` → mode/zone/fee hợp lệ và thông tin QR table theo token đã xác minh.
- `POST /api/public/stores/:slug/orders` body:
  ```json
  {
    "idempotencyKey": "uuid-v4-generated-once-per-submit",
    "fulfillmentType": "DELIVERY",
    "tableToken": null,
    "customer": {"name": "Lan", "phone": "09xxxxxxxx", "address": "..." },
    "deliveryZoneId": "uuid",
    "items": [
      {"productId": "uuid", "quantity": 2, "optionValueIds": ["uuid"], "note": "it da"}
    ],
    "paymentMethod": "BANK_QR"
  }
  ```
  Server validate: store active/mode, vùng giao/bàn, sản phẩm/option, giá và phí ship theo DB, giới hạn số lượng, chống spam và idempotency. Transaction tạo order + items + attempt; response trả **mã đơn, guestToken một lần, trạng thái, expectedAmount và thông tin QR** nếu online, không trả secret.
- `GET /api/public/orders/:guestToken` → order summary & trạng thái (không phơi PII nhạy cảm nếu link bị share).
- `GET /api/public/orders/:guestToken/payment` → payment status an toàn; polling 3–5s khi tab active.

### Protected
- `POST /api/auth/*`, `GET /api/me`
- `GET/POST /api/organizations`, `GET/POST /api/stores` (owner scoped)
- `GET/POST/PATCH /api/stores/:id/categories`
- `GET/POST/PATCH /api/stores/:id/products`, option endpoints
- `GET/POST/PATCH /api/stores/:id/tables`
- `GET/POST/PATCH /api/stores/:id/delivery-zones`
- `GET /api/stores/:id/orders?status=...&cursor=...`
- `PATCH /api/stores/:id/orders/:orderId/status` body `{ "expectedStatus":"NEW", "nextStatus":"PREPARING" }`
- `POST /api/stores/:id/orders/:orderId/mark-paid` (staff scoped; audit, xác minh thanh toán thực tế)
- `GET /api/stores/:id/summary?date=YYYY-MM-DD`
- `POST/PATCH /api/stores/:id/payment-settings` (owner only)
- `POST /api/stores/:id/team/invitations` (owner only)

### Provider / Internal
- `POST /api/webhooks/sepay/:endpointKey` → raw body verify HMAC & timestamp, persist idempotently, match payment.
- `POST /api/internal/reconcile-sepay` → scheduler-only secret auth; không được public.
- `POST /api/internal/expire-payment-attempts` → scheduler-only.

**API error format:** `{ "code": "...", "message": "...", "details"?: ... }` với status 400/401/403/404/409/422/429; không lộ lỗi DB/secrets ra client.

## 8. SePay integration — triển khai thực tế

### 8.1. Onboarding chủ quán (V1: manual, đủ dùng)
1. Owner liên kết ngân hàng trong tài khoản SePay của họ.
2. Owner chọn tài khoản nhận tiền cho store (hoặc dùng chung một tài khoản ở nhiều store).
3. Cấu hình mẫu **mã thanh toán** trên SePay; đề xuất `ZO` + hậu tố chữ/số dài 10 ký tự, phải đúng quy tắc tiền tố/độ dài trong dashboard SePay.
4. Tạo webhook SePay trỏ tới endpoint integration riêng; bật **HMAC-SHA256**, lấy secret lưu mã hóa server-side; webhook chỉ nhận giao dịch liên quan (tránh filter làm mất giao dịch cần đối soát).
5. Thực hiện webhook test mode + một test giao dịch thật nhỏ, đối chiếu số tiền/tài khoản/mã, sau đó mới `integration.status=ACTIVE`.
6. Nếu SePay/token/API đối soát không khả dụng cho store thì không tự nhận đã đủ tiêu chuẩn production; owner có thể dùng COD/manual payment cho đến khi hoàn tất xác minh.

**Mỗi organization tự có SePay account.** Multi-store có thể dùng chung tài khoản nhận tiền; mapping dựa trên bank account + **payment_code duy nhất**. Không chỉ match bằng số tiền.

### 8.2. Tạo QR và tạo đơn
- Khách chọn BANK_QR → server tạo `orders(AWAITING_PAYMENT)` + `payment_attempts(PENDING)`.
- Chọn đúng `store_payment_account` đã xác minh; mã `payment_code` phát sinh riêng, format khớp SePay recognition; lưu `expected_amount_vnd`, `expires_at`.
- Tạo VietQR bao gồm **account, bank, amount, payment_code** theo tài liệu QR, tuyệt đối không nhận account/amount từ client.
- Trên mobile có copy tài khoản/nội dung, lưu ảnh QR. Khi đã có webhook confirmed → hiện PAID, chuyển order NEW.
- Không trừ tồn kho vì V1 chưa làm inventory.

### 8.3. Webhook: quy trình bắt buộc
1. HTTPS; tìm integration theo opaque `endpointKey` (không xem endpointKey là bảo mật duy nhất).
2. Lấy **raw request body**; đọc `X-SePay-Signature`, `X-SePay-Timestamp`.
3. Từ chối timestamp lệch > 300 giây; tính HMAC-SHA256 trên `${timestamp}.${rawBody}`, so sánh constant-time với chữ ký `sha256={hex}` và secret **đúng integration**.
4. Parse + validate payload: `id`, `accountNumber`, `transferType="in"`, `transferAmount` nguyên dương, `code`, `referenceCode`; đối chiếu account thuộc integration và store.
5. Ghi raw event/transaction vào DB với unique `(integration_id, provider_transaction_id)`. Duplicate hợp lệ trả success không tạo payment lần hai.
6. Match `code` với attempt; kiểm tra bank account, amount **đúng**, attempt đang hợp lệ, order chưa hủy, không đã được thu. Nếu hợp lệ: transaction cập nhật payment, order `PENDING -> PAID` và `AWAITING_PAYMENT -> NEW`, ghi order event. Cập nhật cùng một DB transaction.
7. Trường hợp không khớp hoặc tiền đến muộn: lưu giao dịch `REVIEW_REQUIRED` và tạo item trong màn đối soát, **không** tự hủy/mất dấu tiền.
8. Sau khi ghi nhận bền vững, trả **HTTP 200 + `{"success": true}`**. Nếu DB thất bại, trả lỗi để SePay retry. Không trả success trước khi commit nếu không có durable queue.
9. Không log secret, chữ ký hay PII; có alert khi nhiều webhook invalid/failed.

**Lưu ý:** `code` có thể null nếu chưa cấu hình cấu trúc mã thanh toán đúng trên SePay; không đoán match bằng số tiền hay substring tùy tiện.

### 8.4. Đối soát và xử lý bất thường
- Dùng SePay API có quyền phù hợp để cron đối soát khoảng 15–30 phút; phân trang, rate limit, từng integration/account, khoảng thời gian overlap; lưu cursor/checkpoint.
- API v2 có kiểu định danh khác webhook cũ: chuẩn hóa reference/account/time/amount, xác minh trước khi tạo payment; không nhân đôi giao dịch.
- Nếu không có API đối soát được cấp quyền: phải có quy trình manual reconciliation + cảnh báo webhook lỗi; **không hứa tự động tuyệt đối**.
- Amount thiếu/thừa, sai code/tài khoản, duplicate, refunded, order đã hủy, hết hạn hoặc webhook tới chậm đều được lưu trong bảng review.
- Owner xem tiền chuyển vào ngân hàng thật, đánh dấu xử lý thủ công; không cho Staff tự duyệt payment sai/đã online nếu không được cấp quyền.
- Payment attempt expiry 15 phút là thời hạn UI, **không** bảo đảm ngân hàng ngừng nhận tiền; mọi giao dịch đến sau vẫn cần được ghi nhận và rà soát.

**Docs chính thức để coding agent đối chiếu trước khi code:**
- Webhook quick start: https://developer.sepay.vn/vi/sepay-webhooks/bat-dau-nhanh
- HMAC auth: https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc
- Payload/response/idempotency: https://developer.sepay.vn/vi/sepay-webhooks/tich-hop-webhook
- Payment code config: https://developer.sepay.vn/vi/sepay-webhooks/cau-hinh-ma-thanh-toan
- QR generation: https://developer.sepay.vn/vi/tien-ich-khac/tao-qr-code
- Reconciliation: https://developer.sepay.vn/vi/sepay-webhooks/doi-soat-giao-dich
- Test mode: https://developer.sepay.vn/vi/sepay-webhooks/bat-dau-nhanh

## 9. Kiến trúc Nuxt 4 & code organization

```text
app/
  pages/
    s/[slug].vue               # Public menu + bottom sheets
    o/[token].vue              # Guest track + QR
    login.vue
    app/index.vue              # redirect to orders
    app/orders.vue
    app/menu.vue
    app/settings.vue
    app/reports.vue
  components/
    menu/ cart/ checkout/ order/ owner/ shared/
  composables/
    useCart.ts useOrderTracking.ts useActiveStore.ts
server/
  api/
    public/stores/            # menu, checkout
    public/orders/            # guest tracking
    organizations/ stores/ orders/
    webhooks/sepay/
    internal/                 # scheduled jobs (secret protected)
  services/
    catalog/ ordering/ payments/ delivery/ reporting/
  repositories/
  auth/                       # requireUser, requireStoreRole
  db/
    schema/ client.ts
  utils/
shared/
  schemas/ enums/ types/
drizzle/
tests/
  unit/ integration/ e2e/
```

- Logic nghiệp vụ đặt trong `server/services`, không viết transaction vào Vue components hoặc route handlers.
- Zod validate ở boundary; typed server responses.
- Drizzle + Neon; xác nhận driver hỗ trợ transaction thực sự trên runtime lựa chọn. HTTP thích hợp single/non-interactive; dùng Neon WebSocket/driver hỗ trợ interactive transaction hoặc compatible PostgreSQL driver khi cần nhiều bước nguyên tử. Test trên Vercel runtime thực.
- SePay secrets/API tokens mã hóa khi lưu (app encryption key từ môi trường hoặc managed secret store); không chứa ở Nuxt public runtimeConfig.
- Migrations Drizzle chạy có kiểm soát; tách env dev/staging/prod và Neon branches.
- Cấu hình:
  `DATABASE_URL`, `NUXT_SESSION_PASSWORD`, `APP_ENCRYPTION_KEY`, `CRON_SECRET`, `APP_BASE_URL`; các credential từng SePay integration lưu bảo mật trong DB, không đặt credentials của owner ở client.
- Theo dõi lỗi API, checkout, webhook và đơn chờ thanh toán quá lâu; logs có correlation IDs và redaction.

## 10. Kế hoạch implementation theo phase (task checklist)

### Phase 0 — Audit repo & design freeze
- [ ] Kiểm tra codebase hiện có, xác định reuse/gap; không thay đổi stack đã dùng hợp lý.
- [ ] Chốt danh sách màn hình & responsive breakpoints.
- [ ] Chốt scope forms: dine-in / pickup / delivery; bật/tắt mode tại store.
- [ ] Chốt policy hủy/hoàn tiền khi đã PAID; xử lý late transfer.
- [ ] Xác minh điều kiện SePay cho từng owner: bank support, webhook HMAC, transaction API access, phí/gói.
- [ ] Viết ADR ngắn về tenant model + payment state machine.
**Exit:** Không còn quyết định kiến trúc chặn implementation.

### Phase 1 — Foundation & tenant security
- [ ] Tạo Nuxt 4, Nuxt UI, TS, Zod, Drizzle, Neon, npm lockfile (hoặc reuse repo).
- [ ] Migration `users`, `organizations`, `organization_members`, `stores`, `store_members`.
- [ ] Session auth, login/logout, tạo owner + organization + first store.
- [ ] Middleware `requireAuth`, `requireOrgOwner`, `requireStoreStaff`.
- [ ] Test isolation A/B; kiểm tra cross-tenant `GET`, `PATCH`, `DELETE`.
- [ ] CI lint/typecheck/tests/migration check.
**Exit:** Owner A không thể truy cập dữ liệu Owner B qua API, kể cả đoán ID.

### Phase 2 — Store/menu/QR
- [ ] CRUD categories/products, hiển thị trạng thái món.
- [ ] Product options group/values và tính giá chính xác.
- [ ] Store mode settings + delivery zones.
- [ ] Store tables + QR links với token không đoán được; regenerate/revoke QR.
- [ ] Public menu API + responsive menu UI + ảnh lazy.
- [ ] Owner tạo menu bằng tên + giá trong ít thao tác.
**Exit:** Có thể phát hành menu và QR để khách truy cập được, chưa cần đặt đơn.

### Phase 3 — Checkout & order board (PAY_ON_RECEIPT trước)
- [ ] Cart localStorage, bottom sheets options/checkout.
- [ ] Checkout validation theo fulfillment; server tính lại total.
- [ ] `orders`, `order_items`, `order_events`, guestToken.
- [ ] API create order atomic + idempotency key.
- [ ] Order Board, detail, status transitions, cancel & mark-paid manual.
- [ ] Public order tracking; polling khi active.
- [ ] Test 3 luồng dine-in, pickup, delivery + race, double submit.
**Exit:** Có thể phục vụ đơn trả khi nhận end-to-end tại một cửa hàng.

### Phase 4 — SePay & payment correctness
- [ ] Payment account + SePay integration admin UI (owner only).
- [ ] Encrypt secret/token at rest, rotate/revoke configuration.
- [ ] `payment_attempts`, `bank_transactions`, `order_payments`.
- [ ] Mã thanh toán SePay-compatible; tạo ảnh VietQR từ đúng bank/amount/code.
- [ ] Trang QR chờ thanh toán + tracking/polling.
- [ ] Webhook raw-body HMAC + timestamp + account/code/amount validation.
- [ ] DB dedupe/atomic matching; không thêm đơn vào queue trước PAID.
- [ ] Xử lý unmatched/overpaid/underpaid/expired/late/cancelled.
- [ ] SePay Test Mode simulated transfer + test giao dịch thật trước production.
- [ ] Cron reconciliation và trang kiểm tra giao dịch cần xử lý; bảo vệ cron.
**Exit:** Chuyển khoản đúng xác nhận đúng **một lần**; tiền lạ/chuyển muộn không biến mất.

### Phase 5 — Polish, QA & launch
- [ ] Owner settings, report theo ngày (giá trị đơn vs tiền đã thu).
- [ ] Trạng thái loading, empty, offline, error và lỗi QR invalid.
- [ ] Kiểm thử trên Android Chrome, iPhone Safari, desktop.
- [ ] A11y: keyboard/focus trong bottom sheet, target nút, nhãn inputs.
- [ ] Performance: responsive images, hạn chế JS, cache menu, no-cache sensitive endpoints.
- [ ] Security scan: XSS, CSRF, brute-force, rate limit public checkout, authorization by ID.
- [ ] Monitoring/alerts, backup/restore Neon, migrations rollback, legal/privacy policy.
- [ ] Pilot tại **1 quán**, 1 bàn QR, 1 đơn pickup và 1 đơn delivery + hai hình thức thanh toán.
- [ ] Sau pilot chạy thử 2 org / 2 store để xác nhận multi-tenant.
**Exit:** Go-live checklist đạt, owner và staff sử dụng được không cần hướng dẫn dài.

## 11. Bộ test cases bắt buộc

### UX
- [ ] Scan QR bàn đúng → không cần nhập tên/địa chỉ → order gắn đúng bàn.
- [ ] Link chung → pickup → tên + SĐT bắt buộc; không có ô địa chỉ.
- [ ] Delivery → chọn zone + nhập địa chỉ → phí ship server đúng.
- [ ] Product option mặc định & custom lựa chọn; topping cộng tiền đúng.
- [ ] Món hết hàng hoặc đổi giá ngay trước checkout → báo chính xác, không charge giá cũ.
- [ ] Mất mạng/refresh/back/duplicate click không tạo trùng đơn.
- [ ] Owner có một store không gặp bước chọn store; nhiều store có switcher.

### Permission/security
- [ ] Owner A / Staff A không xem sửa được Store B qua API.
- [ ] Staff không sửa payment integration, không xem token/secret.
- [ ] Public tracking token khác không đọc được đơn.
- [ ] Invalid table token không tự gắn bàn khác.
- [ ] Không lộ PII trong logs/analytics hoặc response public.

### Payment
- [ ] COD tạo `NEW+UNPAID`; Staff đánh dấu PAID sau khi thu thực tế.
- [ ] BankQR tạo `AWAITING_PAYMENT+PENDING`, chưa hiện queue bếp.
- [ ] HMAC thiếu/sai và timestamp lệch bị từ chối.
- [ ] Webhook đúng account+code+amount+direction = in → PAID đúng một lần.
- [ ] Webhook replay/concurrent duplicate không sinh payment thứ hai.
- [ ] Tiền thiếu/thừa, khác tài khoản, code null/sai → REVIEW_REQUIRED.
- [ ] Payment đến sau expire hoặc sau cancel → review, không mất dấu.
- [ ] API SePay down / mất webhook → reconciliation bổ sung, không double credit.
- [ ] Thanh toán online xong nhưng khách đóng trang vẫn cập nhật board.
- [ ] Đơn đã PAID rồi hủy → refund due + xử lý thủ công với audit.

## 12. Definition of Done / Acceptance

**Functional:** chủ quán đăng nhập, tạo store/menu/QR, khách order bằng cả ba fulfillment types; COD hoạt động; SePay VietQR tự xác nhận đơn đúng theo giao dịch thật; báo cáo ngày không nhầm doanh thu "đơn đặt" với "tiền đã thu".

**Security:** auth+scopes backend, không rò tenant, secret mã hóa, webhook HMAC/timestamp, unique transaction IDs, rate limit và basic observability.

**Quality:** test unit giá/phí/option/payment matching; integration auth/DB/webhooks; E2E các luồng; thao tác một tay trên màn mobile ~360px; retry/offline không tạo trùng.

**Production:** HTTPS, môi trường riêng, backup/restore đã kiểm chứng, quy trình đối soát khi webhook gián đoạn, báo lỗi khi failed reconciliation, xác minh tài khoản ngân hàng trước bật thanh toán.

## 13. Ưu tiên và rủi ro

| Mức | Vấn đề | Hành động |
|---|---|---|
| P0 | Thanh toán nhầm store/nhầm order | Match `integration + bank_account + payment_code + amount`; transaction |
| P0 | Giả mạo webhook | HMAC raw body + timestamp + HTTPS, verify account |
| P0 | Trùng đơn/trùng giao dịch | Idempotency checkout + unique bank tx |
| P0 | Rò multi-tenant | Server authorization + FK scoped + tests |
| P1 | Tiền chuyển muộn/missing webhook | Reconciliation + review queue |
| P1 | Không giao được địa chỉ | Delivery zones rõ ràng; owner quyết định trước pha chế |
| P1 | Gián đoạn mạng trên mobile | Giữ giỏ/tracking; thông báo trạng thái thật |
| P2 | Thông báo realtime tức thì | Polling đầu tiên; WebSocket/push sau |
| P2 | Tùy biến nâng cao | Chỉ khi pilot thực sự cần |

## 14. Phân chia PR gợi ý

1. `feat(core): auth org store roles`
2. `feat(catalog): menu options tables delivery-zones`
3. `feat(order): guest cart checkout order-state`
4. `feat(owner): order board manual-payment reports`
5. `feat(payment): sepay setup vietqr attempts`
6. `feat(payment): webhook reconciliation review-queue`
7. `test(hardening): cross-tenant payment E2E and launch`

Không merge PR thanh toán khi chưa có tests về HMAC, replay, sai account, duplicate payment và late transfer.

## 15. Checklist chạy pilot

- [ ] Owner tạo store và một bộ menu trà sữa 5–10 món.
- [ ] Tạo Bàn 01/Bàn 02 và in QR riêng; test đổi bàn không bị nhầm.
- [ ] Test pickup không địa chỉ; delivery đúng khu vực và phí.
- [ ] Test order COD, staff chuyển trạng thái và xác nhận tiền.
- [ ] Test SePay sandbox trước; sau đó một giao dịch tiền thật nhỏ.
- [ ] Xác minh tiền về **ngân hàng owner**, không phải ZENO.
- [ ] Đối chiếu `bank_transactions` ↔ payment attempt ↔ order.
- [ ] Test refresh, duplicate webhook, late transfer, mất mạng.
- [ ] Test một owner khác hoàn toàn không thấy dữ liệu pilot.
- [ ] Ghi nhận 5 vấn đề UX hàng đầu, chỉ sửa vấn đề cản trở ordering thực tế trước khi mở rộng.

---

## 16. Sources / kỹ thuật tham chiếu

- SePay webhooks quickstart: https://developer.sepay.vn/vi/sepay-webhooks/bat-dau-nhanh
- SePay webhook HMAC: https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc
- SePay integration/payload: https://developer.sepay.vn/vi/sepay-webhooks/tich-hop-webhook
- SePay payment code format: https://developer.sepay.vn/vi/sepay-webhooks/cau-hinh-ma-thanh-toan
- SePay VietQR: https://developer.sepay.vn/vi/tien-ich-khac/tao-qr-code
- SePay reconciliation: https://developer.sepay.vn/vi/sepay-webhooks/doi-soat-giao-dich
- Drizzle + Neon: https://orm.drizzle.team/docs/connect-neon
- Nuxt documentation: https://nuxt.com/docs/4.x

> Ghi chú: chính sách gói SePay, quyền API, bank support và các tài liệu tích hợp có thể thay đổi; xác minh trên tài khoản thật trước khi nhận thanh toán production. Đây là **implementation plan**, chưa phải báo cáo đã triển khai tính năng.
