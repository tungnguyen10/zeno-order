# ZENO Mini Order V1 — PR5 Payment Setup: Tài khoản nhận tiền, SePay, Payment Attempt, VietQR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chủ quán cấu hình tài khoản ngân hàng + kết nối SePay trong vài thao tác; khách chọn VietQR thì thấy mã QR đúng ngân hàng, số tiền và mã thanh toán, đơn ở `AWAITING_PAYMENT` và **không** vào hàng đợi pha chế; hết hạn thì tạo lại mã mà không mất dấu mã cũ.

**Architecture:** Cấu hình thanh toán là dữ liệu của tenant (`store_payment_accounts` theo store, `sepay_integrations` theo org, nối bằng `integration_accounts`). Secret SePay chỉ ghi, mã hoá AES-256-GCM bằng `encryptSecret` (PR3) và không có đường nào trả ra API; chỉ `loadIntegrationSecrets` (cho PR6) giải mã. Mỗi lần khách trả tiền là một `payment_attempts` mang **bản chụp** ngân hàng/số tài khoản/nội dung chuyển khoản nên đổi cấu hình sau đó không làm đổi QR cũ; `payment_code` unique toàn hệ thống và không bao giờ bị tái sử dụng, nhờ vậy PR6 vẫn đối khớp được tiền đến muộn. VietQR là hàm thuần dựng URL ảnh của SePay, đã kiểm chứng với tài liệu và bằng request thật (mục "Verified external facts").

**Tech Stack:** Nuxt 4.5.2, Nuxt UI 4.12.0 (qua `Z*` primitives), drizzle-orm 0.45.4 / drizzle-kit 0.31.11, zod 4.6.5, Node `crypto`, vitest 5 + `@nuxt/test-utils`, Playwright 1.63. **Không thêm dependency mới** (ảnh QR do SePay render, chỉ cần thẻ `<img>`).

**Spec:** [2026-10-31-zeno-mini-order-v1-design.md](../specs/2026-10-31-zeno-mini-order-v1-design.md) (§4.3, §4.4, §5.1–5.4, §6.1, §6.2, §9, §10, §13) · PRD: [ZENO_MINI_ORDER_V1_IMPLEMENTATION_PLAN.md](../../ZENO_MINI_ORDER_V1_IMPLEMENTATION_PLAN.md) (§6, §8.1, §8.2) · UI: [2026-10-31-ui-foundation-design.md](../specs/2026-10-31-ui-foundation-design.md) · Roadmap: [2026-10-31-zeno-v1-00-roadmap.md](./2026-10-31-zeno-v1-00-roadmap.md) (mục PR5) · Style tham chiếu: [PR1](./2026-10-31-zeno-v1-02-core-auth-tenancy.md) · PR2: [catalog](./2026-10-31-zeno-v1-03-catalog.md) · PR3: [ordering](./2026-10-31-zeno-v1-04-ordering.md) · PR4: [owner-ops](./2026-10-31-zeno-v1-05-owner-ops.md) · Phụ thuộc: PR0–PR4 đã merge.

## Global Constraints

Áp dụng "Global Constraints" và "Quy ước xuyên PR" của roadmap, copy nguyên văn các dòng PR này chạm tới:
- **Package manager:** npm, commit `package-lock.json`; pin version chính xác (không `^`/`~`). PR này **không thêm dependency mới**.
- **Runtime:** Node `>=24 <25`. Deploy Vercel.
- **Import:** server dùng import tường minh (`h3`, `zod`, `drizzle-orm`) và đường dẫn tương đối trong `server/`; `shared/` qua alias `#shared`. Không dùng `~/server/...`. Riêng `server/db/schema/**` import `shared/` bằng đường dẫn tương đối vì `drizzle-kit` không biết alias Nuxt.
- **Lớp kiến trúc:** route handler mỏng (parse → guard → service). Transaction chỉ nằm trong `server/services/**`. Repository luôn nhận `{orgId, storeId}` hoặc `StoreContext`.
- **Tenant:** mọi bảng thuộc store có `org_id`, `store_id`, composite FK `(org_id, store_id) → stores(org_id, id)`, `unique(store_id, id)`; bảng con tham chiếu `(store_id, parent_id)`. Không có quyền → **404**; thiếu role → **403**; thiếu/sai token → **401**. `sepay_integrations` thuộc org (không thuộc store): FK `org_id → organizations(id)`, bảng nối `integration_accounts` dùng composite FK `(org_id, …)` để không nối chéo org.
- **Tiền:** VND `bigint` (mode `number`), số nguyên ≥ 0; server luôn tự tính lại. Số tiền trong QR luôn lấy từ `orders.total_vnd` ở server, không nhận từ client.
- **Kiểu dữ liệu:** id `uuid default gen_random_uuid()`; thời gian `timestamptz`; enum `pgEnum` đồng bộ `shared/`.
- **Token:** 32 byte random base64url; DB chỉ lưu `sha256` hex (`server/utils/tokens.ts`, có từ PR2). `webhook_endpoint_key`: 24 byte random base64url (spec §4.4).
- **Secret:** mã hoá AES-256-GCM bằng `APP_ENCRYPTION_KEY` (`server/utils/crypto.ts`, có từ PR3); không bao giờ trả secret ra API; không đưa vào `runtimeConfig.public`.
- **Lỗi API:** `{ code, message, details? }`, code theo spec §9. **Không thêm mã lỗi mới** trong PR này (dùng `STATUS_CONFLICT`, `PAYMENT_METHOD_UNAVAILABLE`, `VALIDATION_FAILED`, `NOT_FOUND`, `RATE_LIMITED`).
- **Log:** qua `logger` (redact PII/secret); không log body webhook, chữ ký, SĐT, địa chỉ; không để guest token hay `webhook_endpoint_key` lọt vào log đường dẫn (Task 4).
- **UI:** tiếng Việt, mobile-first 360px, Nuxt UI v4, vùng bấm ≥ 44px, có trạng thái loading/empty/error ở mọi màn. `pages/` và `layouts/` chỉ dùng `Z*` (ESLint enforce); Nuxt UI trực tiếp chỉ trong `app/components/**`.
- **Route public:** `/api/public/**` không cần token, response không chứa `orgId`, `storeId`, `customerPhone`, `address`, secret hay token hash; mọi route public có test quét khoá JSON.
- **Migration:** đúng một file `drizzle-kit generate --name payment_setup`, `npm run db:check`, áp dụng lên branch `test` trước khi chạy integration test.
- **Ma trận tenant:** mọi route protected mới có hàng trong `tests/api/tenant-isolation.test.ts` (Task 9).
- **Commit:** conventional commits `feat(payment-setup): …`, kèm trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

## Review Focus

PR này không sở hữu mục nào trong bảng Review Focus của roadmap (#10 thuộc PR6) nhưng chuẩn bị nền cho nó. Năm tình huống thật mà spec không nói rõ, hỏng là mất tiền hoặc lộ secret:

1. **Ngân hàng bắt buộc dùng tài khoản ảo (VA) hoặc chuỗi `SEVQR`** (OCB, KienLongBank, MSB, BIDV phải qua VA; VietinBank cá nhân/hộ kinh doanh phải có `SEVQR` trong nội dung) → nhập thiếu VA bị chặn ngay ở form/API (400 `VALIDATION_FAILED`, `path = vaNumber`); nội dung chuyển khoản của VietinBank luôn là `SEVQR ZOxxxxxxxx` và ảnh QR mang đúng chuỗi đó, không bao giờ tạo QR mà ngân hàng sẽ không đẩy về SePay. → Task 1, 2, 5.
2. **Khách bấm "Tạo mã mới" hai lần hoặc mở đơn ở hai tab** → đúng **một** attempt `PENDING` mỗi đơn (ràng buộc DB `payment_attempts_one_pending_uq`); lần thứ hai nhận lại đúng QR đang hiệu lực (200, không tạo thêm); gọi dồn dập bị `RATE_LIMITED`. → Task 3, 7, 10.
3. **Khách chuyển khoản sau khi mã hết hạn, hoặc quét lại ảnh QR cũ đã lưu trong thư viện ảnh** → mã cũ **không bị xoá, không bị tái sử dụng** (`payment_code` unique toàn hệ thống, attempt cũ chuyển `SUPERSEDED`, bản chụp ngân hàng/số tiền giữ nguyên) để PR6 vẫn khớp được và đánh dấu `late_payment`. → Task 3, 7, 10.
4. **Chủ quán đổi số tài khoản/ngân hàng khi đang có đơn chờ thanh toán** → QR của đơn đang chờ giữ nguyên tài khoản cũ (bản chụp), đơn mới bị chặn (`PAYMENT_METHOD_UNAVAILABLE`) cho tới khi tài khoản mới được kiểm tra lại, không bao giờ tự chuyển tiền sang tài khoản chưa kiểm tra. → Task 5, 7.
5. **Secret SePay bị dán thừa khoảng trắng/xuống dòng/dán nhầm URL, rồi lộ qua phản hồi lỗi, log, hoặc header `Referer` khi trình duyệt tải ảnh QR** → secret được `trim`, từ chối khoảng trắng bên trong; thông báo lỗi validate không lặp lại giá trị; `GET`/`PUT` chỉ trả `hasSecret`; logger che key `hmacSecret`/`apiToken`/`endpointKey` và đường dẫn `/api/webhooks/sepay/<key>`, `/api/public/orders/<token>`; thẻ `<img>` QR có `referrerpolicy="no-referrer"` để host ảnh không thấy guest token. → Task 1, 4, 6, 9, 12.

---

## Verified external facts (spec §13 — không đoán)

Kiểm tra ngày **2026-11-01** bằng đọc tài liệu chính thức và gọi thật các endpoint công khai (không cần tài khoản). Mọi dòng "Verified" dưới đây là nguồn cho hằng số trong code; dòng **UNVERIFIED** có task chặn (gate) riêng, không được coi là đã đúng.

| # | Điều cần biết | Trạng thái | Sự thật đã xác minh / hành động | Nguồn |
|---|---|---|---|---|
| F1 | URL ảnh QR | **Verified** | `https://vietqr.app/img?acc=<SO_TK>&bank=<NGAN_HANG>&amount=<SO_TIEN>&des=<NOI_DUNG>&template=<TEMPLATE>&download=<bool>` (cũng có `showinfo`, `fullacc`, `holder`, `store`). `acc`, `bank` bắt buộc; `amount` integer VND; `template` ∈ {rỗng, `compact`, `qronly`, `standee`}. Gọi thật: `https://qr.sepay.vn/img?...` và `https://vietqr.app/img?...` đều trả `200 image/png`. **Quyết định:** dùng `vietqr.app/img` (URL nhúng trong tài liệu); spec §6.2 ghi `qr.sepay.vn/img` → cập nhật ở Task 13. | https://developer.sepay.vn/vi/tien-ich-khac/tao-qr-code |
| F2 | Giá trị `bank` | **Verified** | Nhận `short_name`, `alias`, `code` hoặc `bin` trong `banks.json`. Gọi thật: `bank=970436` và `bank=VCB` cho cùng ảnh PNG (2258 byte), `bank=ICB` 200 PNG. **Ngân hàng lạ trả `200 text/html`** (không phải 4xx) → server phải tự kiểm tra danh sách trước khi dựng URL. **Quyết định:** truyền `bin` (không mơ hồ). | https://vietqr.app/banks.json · cùng trang F1 |
| F3 | Danh sách ngân hàng | **Verified** (phần `supported` UNVERIFIED, xem U5) | `banks.json` có 54 ngân hàng, mỗi mục `{name, code, bin, short_name, alias?, supported}`; 23 mục `supported: true` → `shared/banks.ts`. Bin đã chốt: VCB `970436`, ICB `970415`, MB `970422`, ACB `970416`, VPB `970432`, TPB `970423`, MSB `970426`, BIDV `970418`, OCB `970448`, KLB `970452`, … | https://vietqr.app/banks.json |
| F4 | Quy tắc theo ngân hàng | **Verified** | **VietinBank** cá nhân/hộ kinh doanh: `des` phải chứa `SEVQR`, thiếu thì SePay không nhận thông báo giao dịch. **OCB, KienLongBank, MSB**: bắt buộc VA. **BIDV**: trang QR nói bắt buộc với cá nhân/hộ KD, tuỳ chọn với doanh nghiệp; trang tài khoản ngân hàng nói "không có tài khoản chính, phải qua VA" → **chọn an toàn: BIDV bắt buộc VA**. VA chính thức: `acc` = số VA, `des` tự do. VA theo nội dung (TKP): `acc` = số tài khoản gốc, `des` = `TKP`+mã VA+nội dung → **không hỗ trợ ở V1**. | https://developer.sepay.vn/vi/tien-ich-khac/tao-qr-code · https://developer.sepay.vn/vi/sepay-webhooks/tai-khoan-ngan-hang |
| F5 | Quy tắc mã thanh toán | **Verified** | Cấu hình ở my.sepay.vn → Cấu hình công ty → Cấu hình chung → Cấu trúc mã thanh toán. Mỗi mẫu: tiền tố **2–5 ký tự** (tự đổi sang chữ hoa), độ dài hậu tố tối thiểu/tối đa **1–30**, loại ký tự **"Số nguyên"** hoặc **"Số và chữ" (0-9, A-Z)**. SePay quét nội dung chuyển khoản tìm `<tiền tố><n ký tự>` (n trong khoảng min–max), tiền tố **không phân biệt hoa/thường**, gắn vào `code` và dừng; không khớp → `code = null`. Ví dụ `dh999999 thanh toan` → `DH999999`. Cấu hình Live và Test mode tách biệt. **Suy ra:** `ZO` + 8 ký tự `[A-Z0-9]` khớp mẫu {tiền tố `ZO`, hậu tố 8–8, "Số và chữ"}. | https://developer.sepay.vn/vi/sepay-webhooks/cau-hinh-ma-thanh-toan |
| F6 | Payload webhook | **Verified** | `id` (integer, không đổi qua retry/replay), `gateway`, `transactionDate` (`YYYY-MM-DD HH:mm:ss`, giờ VN), `accountNumber`, `subAccount` (VA, có thể rỗng), `code` (có thể `null`, phân biệt với `""`), `content`, `transferType` (`in`/`out`), `description`, `transferAmount` (integer dương), `accumulated`, `referenceCode`. Phản hồi thành công = HTTP 200/201 + body **đúng** `{"success": true}` trong 30 s; retry 8 lần kiểu Fibonacci (~33 phút). "Gửi thử" dùng `id` mock (thường `0`). | https://developer.sepay.vn/vi/sepay-webhooks/tich-hop-webhook · https://developer.sepay.vn/vi/sepay-webhooks/xu-ly-loi · https://developer.sepay.vn/vi/sepay-webhooks/tao-webhook |
| F7 | Xác thực webhook | **Verified** | 4 cách: không xác thực, **API Key** (header `Authorization: Apikey <key>`), **HMAC-SHA256** (khuyến nghị), OAuth 2.0. HMAC: header `X-SePay-Signature: sha256=<hex>` và `X-SePay-Timestamp` (Unix giây); chuỗi ký `{timestamp}.{raw_body}`; cửa sổ ±300 s trong code mẫu. Secret/API key **chỉ hiện đầy đủ một lần** (sau đó chỉ thấy 4 ký tự cuối). **Quyết định:** V1 dùng HMAC-SHA256; wizard nhắc dán Secret ngay. | https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc |
| F7b | Ngân hàng SePay hỗ trợ webhook | **Verified** (có mâu thuẫn, xem U3) | Bảng: ACB, BIDV (VA bắt buộc), MBBank, MSB (VA bắt buộc), KienlongBank (VA bắt buộc), OCB (VA bắt buộc), Sacombank, TPBank, VietinBank, VPBank. | https://developer.sepay.vn/vi/sepay-webhooks/tai-khoan-ngan-hang |
| F8 | API đối soát | **Verified một phần** | `GET https://userapi.sepay.vn/v2/transactions?transaction_date_from&transaction_date_to&per_page` (mẫu `per_page=100`); mỗi giao dịch có `id`, `bank_brand_name`, `transaction_date`, `account_number`, `va`, `amount_in`, `amount_out`, `accumulated`, `code`, `transaction_content`, `reference_number`. Token tạo ở Company Settings → API Access (web search, trích https://developer.sepay.vn/en/sepay-api/v2/bat-dau-nhanh). **Scheme của header `Authorization` bị công cụ đọc trang che nên UNVERIFIED (U1).** PR5 chỉ lưu `encrypted_api_token`; PR6 Task 4 phải xác minh trước khi gọi. | https://developer.sepay.vn/vi/sepay-webhooks/doi-soat-giao-dich |
| F9 | Tải ảnh QR | **Verified** | Thêm `download=true` → response `200`, `content-disposition: attachment; filename="<acc>-<bin>.png"`. Ảnh `vietqr.app/img` **không** có header CORS → hiển thị bằng `<img>` và lưu bằng link `download=true`, không `fetch()` từ trình duyệt. | gọi thật 2026-11-01 |
| F10 | Quicklink VietQR (`img.vietqr.io`) | **Verified, không dùng** | `https://img.vietqr.io/image/<BANK_ID>-<ACCOUNT_NO>-<TEMPLATE>.svg?amount&addInfo&accountName`; số tài khoản chữ/số tối đa **19** ký tự; số tiền dương tối đa **13** chữ số; nội dung tối đa **50** ký tự, không ký tự đặc biệt; giới hạn 10 QR/10 giây/IP; `.png` hiện chuyển hướng `301` sang `.svg`; trang có thông báo "Tháng 10/2026 thay đổi API Generate, Quicklink". Dùng làm **ràng buộc chung** cho `buildVietQrUrl` (≤19 ký tự tài khoản, ≤13 chữ số tiền, `des` ≤50 ký tự `[A-Z0-9 ]`), không dùng host này. | https://www.vietqr.io/qr-dong |
| U1 | Scheme header `Authorization` của `userapi.sepay.vn/v2` | **UNVERIFIED** | Kết quả đọc trang bị che; nghi là `Bearer`. **Gate:** PR6 Task 4 phải đọc https://developer.sepay.vn/en/sepay-api/v2/bat-dau-nhanh và gọi thử bằng token thật trước khi viết client. PR5 không gọi API này. | — |
| U2 | `accountNumber` trong webhook của ngân hàng VA (BIDV/MSB/KLB/OCB) là số tài khoản gốc hay số VA | **UNVERIFIED** | Payload mô tả `accountNumber` = số tài khoản ngân hàng, `subAccount` = VA. **Gate:** PR6 phải kiểm bằng Test mode/giao dịch thật; PR5 lưu **cả hai** (`account_number` gốc và `va_number`) trong bản chụp attempt để PR6 khớp theo cái nào đúng. Manual gate ở Task 13. | — |
| U3 | SePay có hỗ trợ webhook cho Vietcombank, Techcombank… không | **UNVERIFIED** | Bảng F7b không có VCB/TCB nhưng ví dụ cấu hình trong cùng trang lại dùng VCB và TCB. **Quyết định:** không chặn; `sepayWebhook: false` chỉ sinh cảnh báo "hãy kiểm tra trên my.sepay.vn". | — |
| U4 | `SEVQR` có bắt buộc với VietinBank **doanh nghiệp** không | **UNVERIFIED** | Tài liệu chỉ nói cá nhân/hộ KD. **Quyết định:** luôn thêm `SEVQR` cho VietinBank (vô hại với đối khớp theo mã). | — |
| U5 | Ý nghĩa `supported` trong `banks.json` | **UNVERIFIED** | Giả định "ngân hàng sinh được VietQR". **Quyết định:** chỉ đưa mục `supported: true` vào danh sách chọn. | — |
| U6 | "Số và chữ" có khớp mã chỉ toàn chữ hoặc chỉ toàn số không | **UNVERIFIED** | Giả định mọi tổ hợp `[0-9A-Z]` đều khớp. **Gate:** Task 13 manual: mô phỏng trong Test mode nội dung `ZOABCDEFGH`, `ZO12345678`, `ZOAB12CD34`, `SEVQR ZOAB12CD34` và xác nhận `code` trong log webhook. | — |
| U7 | Ảnh `template=qronly` quét được và hiện đúng tên chủ tài khoản trên app ngân hàng thật | **UNVERIFIED** | Gate thủ công ở Task 13. | — |

---

## Điểm nối với PR2/PR3/PR4 (đối chiếu trước khi bắt đầu)

PR2–PR4 được lập kế hoạch song song; một số file plan có thể chưa đủ task. Plan này dựa vào **tên trong roadmap** và phần đã viết trong plan PR2/PR3/PR4. Mọi tên dưới đây phải khớp trước Task 1. Nếu lệch, sửa **đúng** các dòng `import`/ánh xạ cột ở cột "Điểm sửa nếu lệch", không đổi thiết kế.

| Tên (Consumes) | Nguồn | Giả định cụ thể | Điểm sửa nếu lệch |
|---|---|---|---|
| `encryptSecret(plain): string`, `decryptSecret(blob): string` | `server/utils/crypto.ts` (PR3 Task 1) | định dạng `v1.<iv>.<tag>.<ct>`; ném `Invalid encrypted secret` khi hỏng | import trong `integrations.ts`, `integration-secrets.ts`, `payment-fixtures.ts` |
| `generateToken(bytes = 32)`, `hashToken(token)` | `server/utils/tokens.ts` (PR2 Task 1) | base64url; sha256 hex | cùng các file trên + `attempts.ts` |
| `orders`, `orderEvents` | `server/db/schema/ordering.ts` (PR3 Task 3) | cột `orders.{id, orgId, storeId, status, paymentMethod, paymentStatus, totalVnd, guestTokenHash, latePayment}`; unique `orders_store_id_id_uq (store_id, id)` | `server/db/schema/payment-setup.ts` (FK), `attempts.ts` |
| Enum `orderStatus`, `paymentStatus`, `paymentMethod` | PR3: `shared/enums.ts` | `ORDER_STATUSES` có `AWAITING_PAYMENT`; `PAYMENT_STATUSES` = `UNPAID, PENDING, PAID, REVIEW_REQUIRED, REFUND_DUE, REFUNDED`; `PAYMENT_METHODS` = `BANK_QR, PAY_ON_RECEIPT` | `attempts.ts` |
| `PaymentQr` | `shared/types/order.ts` (PR3 Task 2) | `{ bankName, accountNumber, accountHolder, amountVnd, transferContent, imageUrl, expiresAt }` — **PR5 điền** | `attempts.ts` (`toPaymentQr`) |
| `createOrder(db, { slug, input, ip }, deps?)`, `CreateOrderResult` | `server/services/ordering/create-order.ts` (PR3) | nhánh `BANK_QR` hiện ném `PAYMENT_METHOD_UNAVAILABLE`; idempotent replay dựng lại response từ dòng đơn | Task 8 (3 điểm chèn, mô tả bằng mốc, không phụ thuộc tên biến ngoài `tx`, `store`, `order`) |
| `getPublicOrderView(db, token)` | `server/services/ordering/public-view.ts` (PR3) | trả `PublicOrderView` với `qr: null` | Task 8 |
| `consumeRateLimit(db, key, { limit, windowSec }): Promise<boolean>` | `server/services/ordering/rate-limit.ts` (PR3) | `true` = còn trong hạn mức, `false` = bị chặn | route Task 10 |
| `insertRawOrder(store, over?)`, `seedMenu(store)`, `openStore(storeId, patch?)`, `pickupBody(menu, over?)`, `TEA_PRICE`, kiểu `SeededMenu` | `tests/support/checkout-fixtures.ts` (PR3 Task 3) | đã viết trong plan PR3 | test Task 3, 7, 8, 10, 13 |
| `nextStatuses(order, actorRole)` | `server/services/ordering/transitions.ts` (PR3) | `AWAITING_PAYMENT` không có bước tiếp theo cho staff | Task 8 (chỉ test hành vi qua HTTP, không gọi trực tiếp) |
| Board `GET /api/stores/:storeId/orders?tab=` → `BoardResponse { orders[{id,…}], counts, … }` | PR4 Task 3 | tab `new` không bao giờ có `AWAITING_PAYMENT`; có tab `awaiting_payment` | Task 8 |
| `PATCH /api/stores/:storeId/orders/:orderId/status` | PR4 Task 4 | không cho nhân viên chuyển `AWAITING_PAYMENT` đi tiếp | Task 8 |
| `requireUuidParam(event, name): string` | `server/utils/ids.ts` (PR2 Task 6) — PR4 có bản `server/utils/params.ts` | sai UUID → `NOT_FOUND` | import trong các route Task 5, 6 |
| `call(method, path, token?, body?)`, `findForbiddenKeys(value)` | `tests/support/http.ts`, `tests/support/json.ts` (PR2) | `findForbiddenKeys` cấm `orgId`, `storeId`, `customerPhone`, `address`, `secret`, `hmacSecret`, `apiToken`, `tokenHash`… | test Task 8–10 |
| `createTenant(label)`, `addStaff(store, opts?)` | `tests/support/fixtures.ts` (PR1) | `createTenant` → `{ owner, org, store }` | mọi test |
| `requireStoreOwner`, `requireOrgOwner`, `StoreContext`, `defineApiHandler`, `parseBody`, `parseWith`, `AppError`, `getDb`, `Db`, `DbOrTx`, `getPgError`, `isUniqueViolation`, `redact`, `logger`, `assertVnd`, `formatVnd`, `extractApiError`, `useApi`, `useActiveStore`, `AppCopyField`, `Z*` | PR0/PR1 + UI foundation | như code hiện có trong repo | — |
| Settings dạng tab (`ZTabs`) | `app/pages/app/settings.vue` (PR2) | PR2 chuyển settings sang tab, mỗi tab là component trong `app/components/settings/` | Task 11 Step 8 |
| `app/pages/o/[token].vue` | PR3 Task 9 | có biến dữ liệu đơn `order` (kiểu `PublicOrderView`), hàm `refresh`, `token` | Task 12 Step 4 |

- [ ] **Step 0: Đối chiếu tên trước khi viết code**

Run:

```bash
grep -nE "export (async )?function (encryptSecret|decryptSecret)\b" server/utils/crypto.ts
grep -nE "export function (generateToken|hashToken)\b" server/utils/tokens.ts
grep -nE "export const (orders|orderEvents|rateLimits)\b" server/db/schema/ordering.ts
grep -nE "orders_store_id_id_uq" server/db/schema/ordering.ts
grep -nE "export (async )?function consumeRateLimit\b" server/services/ordering/rate-limit.ts
grep -nE "export (interface|type) (PaymentQr|CreateOrderResponse|PublicOrderView)\b" shared/types/order.ts
grep -nE "export (async )?function (insertRawOrder|seedMenu|openStore|pickupBody)\b" tests/support/checkout-fixtures.ts
grep -nE "export (async )?function call\b" tests/support/http.ts
grep -nE "export function findForbiddenKeys\b" tests/support/json.ts
grep -rnE "export function requireUuidParam\b" server/utils
ls drizzle/*.sql
```

Expected: mỗi lệnh `grep` in ít nhất một dòng; `ls` liệt kê `0000_identity.sql`, `0001_catalog.sql`, `0002_ordering.sql`, `0003_owner_ops.sql`. Thiếu tên nào thì dừng, sửa plan này theo tên thật rồi mới tiếp tục. Ghi lại nơi đã lệch vào mô tả PR.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `shared/banks.ts` | `VIETQR_BANKS`, `findBank`, `ACCOUNT_NUMBER_PATTERN`, `normalizeAccountNumber` (danh sách 23 ngân hàng, chính sách VA, cờ SePay webhook) |
| `shared/payment.ts` | `SEPAY_ENVIRONMENTS`, `SEPAY_INTEGRATION_STATUSES`, `PAYMENT_ATTEMPT_STATUSES`, `PAYMENT_PREVIEW_AMOUNT_VND` |
| `shared/schemas/payment.ts` | `paymentAccountInputSchema`, `paymentAccountPatchSchema`, `createIntegrationInputSchema`, `sepaySecretInputSchema`, `linkAccountInputSchema` |
| `shared/types/payment.ts` | `PaymentAccountDto`, `PaymentAccountCheck`, `SepayIntegrationDto` |
| `server/services/payments/payment-code.ts` | `generatePaymentCode`, `buildTransferContent`, `buildVietQrUrl`, hằng số mã/QR |
| `server/services/payments/constants.ts` | `PAYMENT_SECRET_KEY_VERSION`, `MAX_PAYMENT_CODE_ATTEMPTS`, `REPAY_RATE_LIMIT` |
| `server/db/schema/payment-setup.ts` | enum + `storePaymentAccounts`, `sepayIntegrations`, `integrationAccounts`, `paymentAttempts` |
| `drizzle/0004_payment_setup.sql` (generated) | migration |
| `server/utils/logger.ts` (modify) | che `endpointKey`, đường dẫn webhook và đường dẫn token đơn |
| `server/utils/env.ts` (modify) | `getAppBaseUrl` |
| `server/services/payments/accounts.ts` | service tài khoản nhận tiền: tạo/sửa/kiểm tra/xác nhận QR |
| `server/services/payments/integrations.ts` | service SePay integration: tạo, lưu secret, liên kết tài khoản, kích hoạt |
| `server/services/payments/integration-secrets.ts` | `loadIntegrationSecrets`, `findIntegrationByEndpointKey` (cho PR6) |
| `server/services/payments/attempts.ts` | `findBankQrReceiver`, `requireBankQrReceiver`, `createPaymentAttempt`, `getActiveQrForOrder`, `createReplacementAttempt`, `findOrderRefByGuestToken` |
| `server/services/ordering/create-order.ts`, `public-view.ts` (modify) | bật nhánh `BANK_QR`; `qr` trong `GET /api/public/orders/:token` |
| `server/api/stores/[storeId]/payment-accounts/**`, `server/api/organizations/[orgId]/sepay-integrations/**`, `server/api/public/orders/[token]/payment-attempts.post.ts` | route handler mỏng |
| `app/utils/countdown.ts`, `app/utils/payment-readiness.ts` | hàm thuần phía client |
| `app/composables/usePaymentSetup.ts` | state + hành động wizard thanh toán |
| `app/components/settings/{PaymentTab,PaymentAccountCard,SepayCard}.vue` | UI owner |
| `app/components/order/PaymentPanel.vue`, `app/pages/o/[token].vue` (modify) | UI khách C4 chờ thanh toán |
| `tests/support/payment-fixtures.ts`, `tests/support/leaks.ts` | fixture thanh toán + công cụ bắt rò secret |
| `tests/unit/**`, `tests/integration/**`, `tests/api/payment-setup-api.test.ts`, `tests/api/tenant-isolation.test.ts` (modify), `tests/nuxt/**`, `tests/e2e/payment-setup.spec.ts` | test theo từng task |
| `docs/superpowers/specs/2026-10-31-zeno-mini-order-v1-design.md` (modify) | §6.2, §13 theo sự thật đã xác minh |

---

### Task 1: Danh sách ngân hàng + schema zod + kiểu DTO (hàm thuần, dùng chung client/server)

**Files:**
- Create: `shared/banks.ts`, `shared/payment.ts`, `shared/schemas/payment.ts`, `shared/types/payment.ts`, `tests/unit/shared/banks.test.ts`, `tests/unit/shared/payment-schemas.test.ts`

**Interfaces:**
- Consumes: `zod` (đã có).
- Produces (mọi task sau dùng; giữ nguyên tên):
  - `#shared/banks`: `type VaPolicy = 'REQUIRED' | 'OPTIONAL'`; `interface VietQrBank { code: string; bin: string; shortName: string; vaPolicy: VaPolicy; sepayWebhook: boolean }`; `VIETQR_BANKS: readonly VietQrBank[]`; `findBank(code: string): VietQrBank | undefined` (không phân biệt hoa/thường, trim); `ACCOUNT_NUMBER_PATTERN: RegExp` (`/^[A-Z0-9]{6,19}$/`); `normalizeAccountNumber(input: string): string` (bỏ khoảng trắng, `.`, `-`, viết hoa).
  - `#shared/payment`: `SEPAY_ENVIRONMENTS = ['test','live']`, `SEPAY_INTEGRATION_STATUSES = ['DRAFT','TESTING','ACTIVE','DISABLED']`, `PAYMENT_ATTEMPT_STATUSES = ['PENDING','PAID','EXPIRED','SUPERSEDED']` (đều `as const`) + kiểu `SepayEnvironment`, `SepayIntegrationStatus`, `PaymentAttemptStatus`; `PAYMENT_PREVIEW_AMOUNT_VND = 2000`.
  - `#shared/schemas/payment`:
    - `paymentAccountInputSchema` → output `{ bankCode: string; accountNumber: string; accountHolder: string; vaNumber: string | null }` (đã chuẩn hoá: `bankCode` viết hoa, số tài khoản chuẩn hoá; thiếu VA với ngân hàng bắt buộc → issue `path ['vaNumber']`); `type PaymentAccountInput`.
    - `paymentAccountPatchSchema` (`bankCode?`, `accountNumber?`, `accountHolder?`, `vaNumber?: string | null`; ít nhất 1 trường); `type PaymentAccountPatch`.
    - `createIntegrationInputSchema` (`name` mặc định `'SePay'`, `environment` mặc định `'live'`); `type CreateIntegrationInput`.
    - `sepaySecretInputSchema` (`hmacSecret` 8–200 ký tự không khoảng trắng, `apiToken?` 8–500 ký tự không khoảng trắng); `type SepaySecretInput`.
    - `linkAccountInputSchema` (`paymentAccountId: uuid`).
  - `#shared/types/payment`: `PaymentAccountDto`, `PaymentAccountField`, `PaymentAccountIssue`, `PaymentAccountPreview`, `PaymentAccountCheck`, `SepayIntegrationDto` (định nghĩa ở Step 5).

- [ ] **Step 1: Xác minh lại sự thật bên ngoài trước khi chốt hằng số (gate F1–F4)**

Run:

```bash
curl -s -o /dev/null -w "vietqr.app bin  : %{http_code} %{content_type}\n" "https://vietqr.app/img?acc=9988776655&bank=970436&amount=100000&des=ZOABCD1234&template=qronly"
curl -s -o /dev/null -w "vietqr.app code : %{http_code} %{content_type}\n" "https://vietqr.app/img?acc=9988776655&bank=VCB&amount=100000&des=ZOABCD1234&template=qronly"
curl -s -o /dev/null -w "unknown bank    : %{http_code} %{content_type}\n" "https://vietqr.app/img?acc=9988776655&bank=XXX&amount=100000&des=A"
curl -s -o /dev/null -D - "https://vietqr.app/img?acc=9988776655&bank=970436&amount=1000&des=A&download=true" | grep -i "^content-disposition"
curl -s https://vietqr.app/banks.json | python3 -c "
import json,sys
d=json.load(sys.stdin)['data']
want={'VCB':'970436','ICB':'970415','MB':'970422','ACB':'970416','VPB':'970432','TPB':'970423','MSB':'970426','BIDV':'970418','OCB':'970448','KLB':'970452','STB':'970403','TCB':'970407'}
got={b['code']:b['bin'] for b in d if b['supported']}
print('supported count:', len(got))
print('bins match     :', all(got.get(k)==v for k,v in want.items()))"
```

Expected: hai dòng đầu `200 image/png`; dòng `unknown bank` là `200 text/html` (xác nhận F2: phải tự kiểm tra danh sách); dòng `content-disposition` chứa `attachment`; `supported count: 23` và `bins match     : True`. Nếu khác, **dừng** và cập nhật bảng "Verified external facts" + `shared/banks.ts` trước khi viết tiếp (không đoán).

- [ ] **Step 2: Viết unit test thất bại cho `shared/banks.ts`**

`tests/unit/shared/banks.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ACCOUNT_NUMBER_PATTERN, findBank, normalizeAccountNumber, VIETQR_BANKS } from '#shared/banks'

describe('VIETQR_BANKS', () => {
  it('has unique codes and unique 6-digit bins', () => {
    expect(new Set(VIETQR_BANKS.map(b => b.code)).size).toBe(VIETQR_BANKS.length)
    expect(new Set(VIETQR_BANKS.map(b => b.bin)).size).toBe(VIETQR_BANKS.length)
    for (const bank of VIETQR_BANKS) expect(bank.bin).toMatch(/^\d{6}$/)
  })

  it('lists the 23 banks marked supported in banks.json', () => {
    expect(VIETQR_BANKS).toHaveLength(23)
  })

  it('requires a VA only for BIDV, KLB, MSB and OCB (SePay docs)', () => {
    expect(VIETQR_BANKS.filter(b => b.vaPolicy === 'REQUIRED').map(b => b.code).sort()).toEqual(['BIDV', 'KLB', 'MSB', 'OCB'])
  })

  it('flags exactly the ten banks SePay documents for webhooks', () => {
    expect(VIETQR_BANKS.filter(b => b.sepayWebhook).map(b => b.code).sort())
      .toEqual(['ACB', 'BIDV', 'ICB', 'KLB', 'MB', 'MSB', 'OCB', 'STB', 'TPB', 'VPB'])
  })

  it('pins the bins verified against banks.json on 2026-11-01', () => {
    expect(findBank('VCB')).toMatchObject({ bin: '970436', shortName: 'Vietcombank' })
    expect(findBank('ICB')).toMatchObject({ bin: '970415', shortName: 'VietinBank' })
    expect(findBank('MSB')?.bin).toBe('970426')
    expect(findBank('BIDV')?.bin).toBe('970418')
    expect(findBank('OCB')?.bin).toBe('970448')
    expect(findBank('KLB')?.bin).toBe('970452')
    expect(findBank('TCB')?.bin).toBe('970407')
  })
})

describe('findBank', () => {
  it('is case-insensitive and trims', () => {
    expect(findBank(' vcb ')?.code).toBe('VCB')
  })

  it('returns undefined for unknown or empty codes', () => {
    expect(findBank('XXX')).toBeUndefined()
    expect(findBank('')).toBeUndefined()
  })
})

describe('normalizeAccountNumber', () => {
  it('drops spaces, dots and dashes and upper-cases', () => {
    expect(normalizeAccountNumber(' 9988-776 655 ')).toBe('9988776655')
    expect(normalizeAccountNumber('vqrq1234.5678')).toBe('VQRQ12345678')
  })
})

describe('ACCOUNT_NUMBER_PATTERN', () => {
  it.each(['123456', '9988776655', 'VQRQ12345678', '1234567890123456789'])('accepts %s', (value) => {
    expect(ACCOUNT_NUMBER_PATTERN.test(value)).toBe(true)
  })

  it.each(['12345', '12345678901234567890', '99 88', 'abc123', '12345&6', ''])('rejects %j', (value) => {
    expect(ACCOUNT_NUMBER_PATTERN.test(value)).toBe(false)
  })
})
```

- [ ] **Step 3: Viết unit test thất bại cho schema**

`tests/unit/shared/payment-schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  createIntegrationInputSchema,
  linkAccountInputSchema,
  paymentAccountInputSchema,
  paymentAccountPatchSchema,
  sepaySecretInputSchema,
} from '#shared/schemas/payment'

const valid = { bankCode: 'vcb', accountNumber: '9988 776655', accountHolder: ' Nguyen Van A ' }

describe('paymentAccountInputSchema', () => {
  it('normalises bank code, account number and holder', () => {
    expect(paymentAccountInputSchema.parse(valid)).toEqual({
      bankCode: 'VCB',
      accountNumber: '9988776655',
      accountHolder: 'Nguyen Van A',
      vaNumber: null,
    })
  })

  it('rejects an unknown bank with an issue on bankCode', () => {
    const result = paymentAccountInputSchema.safeParse({ ...valid, bankCode: 'XXX' })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map(i => i.path[0])).toContain('bankCode')
  })

  it.each(['MSB', 'BIDV', 'OCB', 'KLB'])('requires a VA number for %s', (bankCode) => {
    const result = paymentAccountInputSchema.safeParse({ ...valid, bankCode })
    expect(result.success).toBe(false)
    const issue = result.error?.issues.find(i => i.path[0] === 'vaNumber')
    expect(issue?.message).toContain(bankCode === 'KLB' ? 'KienLongBank' : bankCode)
  })

  it('accepts a VA for a VA-only bank and normalises it', () => {
    expect(paymentAccountInputSchema.parse({ ...valid, bankCode: 'OCB', vaNumber: ' vqrq-1234 5678 ' }).vaNumber).toBe('VQRQ12345678')
  })

  it('turns an empty or blank VA into null for banks that do not need one', () => {
    expect(paymentAccountInputSchema.parse({ ...valid, vaNumber: '' }).vaNumber).toBeNull()
    expect(paymentAccountInputSchema.parse({ ...valid, vaNumber: '   ' }).vaNumber).toBeNull()
  })

  it.each(['123', '12345678901234567890', '99&88776655'])('rejects account number %j', (accountNumber) => {
    const result = paymentAccountInputSchema.safeParse({ ...valid, accountNumber })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map(i => i.path[0])).toContain('accountNumber')
  })

  it('rejects a too-short holder name', () => {
    expect(paymentAccountInputSchema.safeParse({ ...valid, accountHolder: 'A' }).success).toBe(false)
  })
})

describe('paymentAccountPatchSchema', () => {
  it('requires at least one field', () => {
    expect(paymentAccountPatchSchema.safeParse({}).success).toBe(false)
  })

  it('allows clearing the VA with null', () => {
    expect(paymentAccountPatchSchema.parse({ vaNumber: null })).toEqual({ vaNumber: null })
  })
})

describe('createIntegrationInputSchema', () => {
  it('defaults to a live SePay integration', () => {
    expect(createIntegrationInputSchema.parse({})).toEqual({ name: 'SePay', environment: 'live' })
  })

  it('rejects an unknown environment', () => {
    expect(createIntegrationInputSchema.safeParse({ environment: 'prod' }).success).toBe(false)
  })
})

describe('sepaySecretInputSchema', () => {
  it('trims the secret and keeps the optional API token', () => {
    expect(sepaySecretInputSchema.parse({ hmacSecret: '  whsec_0123456789\n', apiToken: ' tok_0123456789 ' }))
      .toEqual({ hmacSecret: 'whsec_0123456789', apiToken: 'tok_0123456789' })
  })

  it('treats the API token as optional', () => {
    expect(sepaySecretInputSchema.parse({ hmacSecret: 'whsec_0123456789' })).toEqual({ hmacSecret: 'whsec_0123456789' })
  })

  it('rejects whitespace inside the secret (e.g. a pasted sentence or URL with spaces)', () => {
    expect(sepaySecretInputSchema.safeParse({ hmacSecret: 'abc def 12345678' }).success).toBe(false)
  })

  it('rejects secrets shorter than 8 or longer than 200 characters', () => {
    expect(sepaySecretInputSchema.safeParse({ hmacSecret: 'short' }).success).toBe(false)
    expect(sepaySecretInputSchema.safeParse({ hmacSecret: 'x'.repeat(201) }).success).toBe(false)
  })

  it('never echoes the submitted value in validation issues', () => {
    const result = sepaySecretInputSchema.safeParse({ hmacSecret: 'SHORT1' })
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).not.toContain('SHORT1')
  })
})

describe('linkAccountInputSchema', () => {
  it('requires a uuid', () => {
    expect(linkAccountInputSchema.safeParse({ paymentAccountId: 'nope' }).success).toBe(false)
    expect(linkAccountInputSchema.safeParse({ paymentAccountId: crypto.randomUUID() }).success).toBe(true)
  })
})
```

- [ ] **Step 4: Chạy test để xác nhận thất bại**

Run: `npx vitest run --project unit tests/unit/shared/banks.test.ts tests/unit/shared/payment-schemas.test.ts`
Expected: FAIL — không resolve được `#shared/banks` và `#shared/schemas/payment`.

- [ ] **Step 5: Viết implementation**

`shared/banks.ts`:

```ts
export type VaPolicy = 'REQUIRED' | 'OPTIONAL'

export interface VietQrBank {
  /** VietQR/NAPAS code from banks.json, e.g. `VCB`. */
  code: string
  /** 6-digit bank identification number; the value sent as the `bank` QR parameter. */
  bin: string
  shortName: string
  vaPolicy: VaPolicy
  /** Bank appears in SePay's webhook support table (developer.sepay.vn tai-khoan-ngan-hang). */
  sepayWebhook: boolean
}

const bank = (code: string, bin: string, shortName: string, vaPolicy: VaPolicy = 'OPTIONAL', sepayWebhook = false): VietQrBank =>
  ({ code, bin, shortName, vaPolicy, sepayWebhook })

// Source: https://vietqr.app/banks.json, entries with supported=true (checked 2026-11-01).
export const VIETQR_BANKS: readonly VietQrBank[] = [
  bank('VCB', '970436', 'Vietcombank'),
  bank('TCB', '970407', 'Techcombank'),
  bank('ICB', '970415', 'VietinBank', 'OPTIONAL', true),
  bank('BIDV', '970418', 'BIDV', 'REQUIRED', true),
  bank('VBA', '970405', 'Agribank'),
  bank('MB', '970422', 'MBBank', 'OPTIONAL', true),
  bank('ACB', '970416', 'ACB', 'OPTIONAL', true),
  bank('VPB', '970432', 'VPBank', 'OPTIONAL', true),
  bank('TPB', '970423', 'TPBank', 'OPTIONAL', true),
  bank('STB', '970403', 'Sacombank', 'OPTIONAL', true),
  bank('MSB', '970426', 'MSB', 'REQUIRED', true),
  bank('OCB', '970448', 'OCB', 'REQUIRED', true),
  bank('KLB', '970452', 'KienLongBank', 'REQUIRED', true),
  bank('LPB', '970449', 'LPBank'),
  bank('VCCB', '970454', 'BVBank'),
  bank('VIB', '970441', 'VIB'),
  bank('HDB', '970437', 'HDBank'),
  bank('SEAB', '970440', 'SeABank'),
  bank('SHBVN', '970424', 'Shinhan Bank'),
  bank('BAB', '970409', 'BacABank'),
  bank('ABB', '970425', 'ABBANK'),
  bank('EIB', '970431', 'Eximbank'),
  bank('PBVN', '970439', 'Public Bank'),
]

export function findBank(code: string): VietQrBank | undefined {
  const wanted = code.trim().toUpperCase()
  return VIETQR_BANKS.find(b => b.code === wanted)
}

/** VietQR account numbers are letters or digits, at most 19 characters (vietqr.io quick link). */
export const ACCOUNT_NUMBER_PATTERN = /^[A-Z0-9]{6,19}$/

export function normalizeAccountNumber(input: string): string {
  return input.replace(/[\s.-]/g, '').toUpperCase()
}
```

`shared/payment.ts`:

```ts
export const SEPAY_ENVIRONMENTS = ['test', 'live'] as const
export const SEPAY_INTEGRATION_STATUSES = ['DRAFT', 'TESTING', 'ACTIVE', 'DISABLED'] as const
export const PAYMENT_ATTEMPT_STATUSES = ['PENDING', 'PAID', 'EXPIRED', 'SUPERSEDED'] as const

export type SepayEnvironment = (typeof SEPAY_ENVIRONMENTS)[number]
export type SepayIntegrationStatus = (typeof SEPAY_INTEGRATION_STATUSES)[number]
export type PaymentAttemptStatus = (typeof PAYMENT_ATTEMPT_STATUSES)[number]

/** Amount of the throw-away QR the owner scans to confirm the account (VND). */
export const PAYMENT_PREVIEW_AMOUNT_VND = 2000
```

`shared/schemas/payment.ts`:

```ts
import { z } from 'zod'
import { ACCOUNT_NUMBER_PATTERN, findBank, normalizeAccountNumber } from '../banks'
import { SEPAY_ENVIRONMENTS } from '../payment'

const holder = z.string().trim()
  .min(2, 'Tên chủ tài khoản cần ít nhất 2 ký tự')
  .max(80, 'Tên chủ tài khoản tối đa 80 ký tự')

export const paymentAccountInputSchema = z.object({
  bankCode: z.string().trim().transform(value => value.toUpperCase()),
  accountNumber: z.string().transform(value => normalizeAccountNumber(value)),
  accountHolder: holder,
  vaNumber: z.string().nullish(),
}).transform((value) => {
  // Object-level transform so an absent vaNumber deterministically becomes null.
  const normalized = value.vaNumber ? normalizeAccountNumber(value.vaNumber) : ''
  return { ...value, vaNumber: normalized === '' ? null : normalized }
}).superRefine((value, ctx) => {
  const bank = findBank(value.bankCode)
  if (!bank) ctx.addIssue({ code: 'custom', path: ['bankCode'], message: 'Ngân hàng chưa được hỗ trợ' })
  if (!ACCOUNT_NUMBER_PATTERN.test(value.accountNumber)) {
    ctx.addIssue({ code: 'custom', path: ['accountNumber'], message: 'Số tài khoản gồm 6–19 chữ hoặc số' })
  }
  if (value.vaNumber !== null && !ACCOUNT_NUMBER_PATTERN.test(value.vaNumber)) {
    ctx.addIssue({ code: 'custom', path: ['vaNumber'], message: 'Số tài khoản ảo gồm 6–19 chữ hoặc số' })
  }
  if (bank?.vaPolicy === 'REQUIRED' && value.vaNumber === null) {
    ctx.addIssue({ code: 'custom', path: ['vaNumber'], message: `${bank.shortName} chỉ nhận tiền qua tài khoản ảo (VA), hãy nhập số VA` })
  }
})
export type PaymentAccountInput = z.output<typeof paymentAccountInputSchema>

export const paymentAccountPatchSchema = z.object({
  bankCode: z.string().max(40).optional(),
  accountNumber: z.string().max(60).optional(),
  accountHolder: z.string().max(200).optional(),
  vaNumber: z.string().max(60).nullable().optional(),
}).refine(value => Object.values(value).some(v => v !== undefined), 'Không có thay đổi nào')
export type PaymentAccountPatch = z.output<typeof paymentAccountPatchSchema>

export const createIntegrationInputSchema = z.object({
  name: z.string().trim().min(2).max(80).default('SePay'),
  environment: z.enum(SEPAY_ENVIRONMENTS).default('live'),
})
export type CreateIntegrationInput = z.output<typeof createIntegrationInputSchema>

const NO_WHITESPACE = /^\S+$/

export const sepaySecretInputSchema = z.object({
  hmacSecret: z.string().trim()
    .min(8, 'Secret Key cần ít nhất 8 ký tự')
    .max(200, 'Secret Key tối đa 200 ký tự')
    .regex(NO_WHITESPACE, 'Secret Key không chứa khoảng trắng'),
  apiToken: z.string().trim()
    .min(8, 'Token API cần ít nhất 8 ký tự')
    .max(500, 'Token API tối đa 500 ký tự')
    .regex(NO_WHITESPACE, 'Token API không chứa khoảng trắng')
    .optional(),
})
export type SepaySecretInput = z.output<typeof sepaySecretInputSchema>

export const linkAccountInputSchema = z.object({ paymentAccountId: z.uuid() })
```

`shared/types/payment.ts`:

```ts
import type { SepayEnvironment, SepayIntegrationStatus } from '../payment'

export interface PaymentAccountDto {
  id: string
  bankCode: string
  bankName: string
  accountNumber: string
  vaNumber: string | null
  accountHolder: string
  qrCheckedAt: string | null
  verifiedAt: string | null
  linkedIntegrationId: string | null
}

export type PaymentAccountField = 'bankCode' | 'accountNumber' | 'accountHolder' | 'vaNumber'

export interface PaymentAccountIssue {
  field: PaymentAccountField
  message: string
}

export interface PaymentAccountPreview {
  bankName: string
  /** The number encoded in the QR (the VA when the account has one). */
  accountNumber: string
  accountHolder: string
  amountVnd: number
  transferContent: string
  imageUrl: string
}

export interface PaymentAccountCheck {
  ok: boolean
  issues: PaymentAccountIssue[]
  warnings: string[]
  preview: PaymentAccountPreview | null
}

export interface SepayIntegrationDto {
  id: string
  name: string
  environment: SepayEnvironment
  status: SepayIntegrationStatus
  hasSecret: boolean
  hasApiToken: boolean
  secretUpdatedAt: string | null
  lastValidWebhookAt: string | null
  updatedAt: string
  webhookUrl: string
  accountIds: string[]
}
```

- [ ] **Step 6: Chạy test để xác nhận đạt**

Run: `npx vitest run --project unit tests/unit/shared/banks.test.ts tests/unit/shared/payment-schemas.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add shared/banks.ts shared/payment.ts shared/schemas/payment.ts shared/types/payment.ts tests/unit/shared/banks.test.ts tests/unit/shared/payment-schemas.test.ts
git commit -m "feat(payment-setup): add verified VietQR bank catalogue and payment schemas" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: `payment-code.ts` — mã thanh toán, nội dung chuyển khoản, URL VietQR (hàm thuần)

**Files:**
- Create: `server/services/payments/payment-code.ts`, `server/services/payments/constants.ts`, `tests/unit/server/payment-code.test.ts`

**Interfaces:**
- Consumes: `findBank`, `ACCOUNT_NUMBER_PATTERN` (`#shared/banks`, Task 1); `assertVnd` (`#shared/money`, PR0).
- Produces (roadmap Task "payment-code.ts"; giữ nguyên tên):
  - `PAYMENT_CODE_PREFIX = 'ZO'`, `PAYMENT_CODE_PATTERN = /^ZO[A-Z0-9]{8}$/`, `PAYMENT_TEST_CODE = 'ZOTEST0000'` (mã của QR kiểm tra; PR6 nhận ra giao dịch thử nhờ mã này), `QR_IMAGE_ORIGIN = 'https://vietqr.app/img'`.
  - `generatePaymentCode(random?: (max: number) => number): string` — `ZO` + 8 ký tự `[A-Z0-9]`, mặc định `crypto.randomInt`. **Không** tự kiểm tra trùng (việc của `createPaymentAttempt`, Task 7).
  - `buildTransferContent(bankCode: string, paymentCode: string): string` — `SEVQR <code>` cho VietinBank (`ICB`), còn lại chính mã; ném `RangeError` khi mã sai định dạng hoặc ngân hàng lạ.
  - `buildVietQrUrl(input: { bankCode: string; accountNumber: string; amountVnd: number; paymentCode: string }): string` — `accountNumber` là số **đưa vào QR** (số VA nếu có); `RangeError` khi ngân hàng lạ (F2: host trả 200 HTML), số tiền không nguyên dương hoặc > 13 chữ số, mã sai định dạng, số tài khoản sai định dạng.
  - `constants.ts`: `PAYMENT_SECRET_KEY_VERSION = 1`, `MAX_PAYMENT_CODE_ATTEMPTS = 5`, `REPAY_RATE_LIMIT = { limit: 10, windowSec: 600 }`.

- [ ] **Step 1: Viết unit test thất bại**

`tests/unit/server/payment-code.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { VIETQR_BANKS } from '#shared/banks'
import {
  buildTransferContent,
  buildVietQrUrl,
  generatePaymentCode,
  PAYMENT_CODE_PATTERN,
  PAYMENT_TEST_CODE,
  QR_IMAGE_ORIGIN,
} from '../../../server/services/payments/payment-code'

describe('generatePaymentCode', () => {
  it('returns ZO + 8 characters of [A-Z0-9]', () => {
    for (let i = 0; i < 200; i++) expect(generatePaymentCode()).toMatch(PAYMENT_CODE_PATTERN)
  })

  it('maps random indexes onto the alphabet A-Z then 0-9', () => {
    const random = vi.fn().mockReturnValue(0)
    expect(generatePaymentCode(random)).toBe('ZOAAAAAAAA')
    expect(random).toHaveBeenCalledWith(36)
    expect(generatePaymentCode(() => 25)).toBe('ZOZZZZZZZZ')
    expect(generatePaymentCode(() => 26)).toBe('ZO00000000')
    expect(generatePaymentCode(() => 35)).toBe('ZO99999999')
  })

  it('does not repeat itself in practice', () => {
    const codes = new Set(Array.from({ length: 500 }, () => generatePaymentCode()))
    expect(codes.size).toBe(500)
  })

  it('the QR-check code is itself a valid payment code', () => {
    expect(PAYMENT_TEST_CODE).toMatch(PAYMENT_CODE_PATTERN)
  })
})

describe('buildTransferContent', () => {
  it('is the bare code for most banks', () => {
    expect(buildTransferContent('VCB', 'ZOABCD1234')).toBe('ZOABCD1234')
    expect(buildTransferContent('mb', 'ZOABCD1234')).toBe('ZOABCD1234')
  })

  it('prefixes SEVQR for VietinBank so SePay receives the transaction (F4)', () => {
    expect(buildTransferContent('ICB', 'ZOABCD1234')).toBe('SEVQR ZOABCD1234')
  })

  it('stays within the 50 character / no-special-character limit for every bank (F10)', () => {
    for (const bank of VIETQR_BANKS) expect(buildTransferContent(bank.code, 'ZOABCD1234')).toMatch(/^[A-Z0-9 ]{1,50}$/)
  })

  it.each(['zoabcd1234', 'ZOABCD123', 'ZOABCD12345', 'XXABCD1234', 'ZOABCD123!', ''])('rejects the malformed code %j', (code) => {
    expect(() => buildTransferContent('VCB', code)).toThrow(RangeError)
  })

  it('rejects an unknown bank', () => {
    expect(() => buildTransferContent('XXX', 'ZOABCD1234')).toThrow(RangeError)
  })
})

describe('buildVietQrUrl', () => {
  const base = { bankCode: 'VCB', accountNumber: '9988776655', amountVnd: 100_000, paymentCode: 'ZOABCD1234' }

  it('builds the SePay QR url with bin, amount and payment code (F1, F2)', () => {
    expect(buildVietQrUrl(base)).toBe(
      'https://vietqr.app/img?acc=9988776655&bank=970436&amount=100000&des=ZOABCD1234&template=qronly',
    )
  })

  it('uses the documented image origin', () => {
    expect(QR_IMAGE_ORIGIN).toBe('https://vietqr.app/img')
    expect(buildVietQrUrl(base).startsWith(`${QR_IMAGE_ORIGIN}?`)).toBe(true)
  })

  it('adds SEVQR and encodes the space for VietinBank (F4)', () => {
    const url = buildVietQrUrl({ ...base, bankCode: 'ICB' })
    expect(url).toContain('bank=970415')
    expect(url).toContain('des=SEVQR%20ZOABCD1234')
  })

  it('round-trips every parameter through URL parsing', () => {
    const params = new URL(buildVietQrUrl({ ...base, bankCode: 'ICB', accountNumber: 'VQRQ12345678', amountVnd: 70_000 })).searchParams
    expect(Object.fromEntries(params)).toEqual({
      acc: 'VQRQ12345678',
      bank: '970415',
      amount: '70000',
      des: 'SEVQR ZOABCD1234',
      template: 'qronly',
    })
  })

  it('refuses unknown banks because the host answers 200 text/html for them (F2)', () => {
    expect(() => buildVietQrUrl({ ...base, bankCode: 'XXX' })).toThrow(RangeError)
  })

  it.each([0, -1, 1.5, Number.NaN, 10_000_000_000_000])('refuses the amount %s', (amountVnd) => {
    expect(() => buildVietQrUrl({ ...base, amountVnd })).toThrow(RangeError)
  })

  it('accepts the largest 13-digit amount', () => {
    expect(buildVietQrUrl({ ...base, amountVnd: 9_999_999_999_999 })).toContain('amount=9999999999999')
  })

  it.each(['12345', '99 88 77', '9988776655&bank=970418', 'abc123'])('refuses the account number %j', (accountNumber) => {
    expect(() => buildVietQrUrl({ ...base, accountNumber })).toThrow(RangeError)
  })

  it('refuses a payment code that could inject query parameters', () => {
    expect(() => buildVietQrUrl({ ...base, paymentCode: 'ZOAB&amount=1' })).toThrow(RangeError)
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `npx vitest run --project unit tests/unit/server/payment-code.test.ts`
Expected: FAIL — không resolve được `server/services/payments/payment-code`.

- [ ] **Step 3: Viết implementation**

`server/services/payments/constants.ts`:

```ts
/** Version of APP_ENCRYPTION_KEY used for sepay_integrations.key_version (matches the `v1.` blob prefix). */
export const PAYMENT_SECRET_KEY_VERSION = 1

export const MAX_PAYMENT_CODE_ATTEMPTS = 5

/** Customer "Tạo mã mới": 10 calls per order per 10 minutes. */
export const REPAY_RATE_LIMIT = { limit: 10, windowSec: 600 } as const
```

`server/services/payments/payment-code.ts`:

```ts
import { randomInt } from 'node:crypto'
import { ACCOUNT_NUMBER_PATTERN, findBank } from '#shared/banks'
import { assertVnd } from '#shared/money'

export const PAYMENT_CODE_PREFIX = 'ZO'
const SUFFIX_LENGTH = 8
export const PAYMENT_CODE_PATTERN = /^ZO[A-Z0-9]{8}$/
/** Payment code of the throw-away QR used to confirm an account; PR6 recognises it as a test transaction. */
export const PAYMENT_TEST_CODE = 'ZOTEST0000'
/** Embed URL from https://developer.sepay.vn/vi/tien-ich-khac/tao-qr-code (qr.sepay.vn/img answers identically). */
export const QR_IMAGE_ORIGIN = 'https://vietqr.app/img'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const MAX_AMOUNT_VND = 9_999_999_999_999

export function generatePaymentCode(random: (max: number) => number = max => randomInt(max)): string {
  let suffix = ''
  for (let i = 0; i < SUFFIX_LENGTH; i++) suffix += ALPHABET[random(ALPHABET.length)]
  return `${PAYMENT_CODE_PREFIX}${suffix}`
}

function requireBank(bankCode: string) {
  const bank = findBank(bankCode)
  if (!bank) throw new RangeError(`Unknown bank code: ${bankCode}`)
  return bank
}

export function buildTransferContent(bankCode: string, paymentCode: string): string {
  const bank = requireBank(bankCode)
  if (!PAYMENT_CODE_PATTERN.test(paymentCode)) throw new RangeError('Malformed payment code')
  // VietinBank personal/household accounts only push the transaction to SePay when the content contains SEVQR.
  return bank.code === 'ICB' ? `SEVQR ${paymentCode}` : paymentCode
}

export function buildVietQrUrl(input: { bankCode: string, accountNumber: string, amountVnd: number, paymentCode: string }): string {
  const bank = requireBank(input.bankCode)
  assertVnd(input.amountVnd)
  if (input.amountVnd < 1 || input.amountVnd > MAX_AMOUNT_VND) throw new RangeError(`QR amount out of range: ${input.amountVnd}`)
  if (!ACCOUNT_NUMBER_PATTERN.test(input.accountNumber)) throw new RangeError('Malformed account number')
  const query: [string, string][] = [
    ['acc', input.accountNumber],
    ['bank', bank.bin],
    ['amount', String(input.amountVnd)],
    ['des', buildTransferContent(bank.code, input.paymentCode)],
    ['template', 'qronly'],
  ]
  return `${QR_IMAGE_ORIGIN}?${query.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')}`
}
```

- [ ] **Step 4: Chạy test để xác nhận đạt**

Run: `npx vitest run --project unit tests/unit/server/payment-code.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/payments/payment-code.ts server/services/payments/constants.ts tests/unit/server/payment-code.test.ts
git commit -m "feat(payment-setup): add payment code generator and VietQR url builder" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Schema `payment_setup` + migration + fixtures

**Files:**
- Create: `server/db/schema/payment-setup.ts`, `drizzle/0004_payment_setup.sql` (generated), `tests/support/payment-fixtures.ts`, `tests/integration/payment-setup-schema.test.ts`
- Modify: `server/db/schema/index.ts`

**Interfaces:**
- Consumes: `timestamps`, `organizations`, `stores` (`server/db/schema/identity.ts`, PR1); `orders` (`server/db/schema/ordering.ts`, PR3; unique `orders_store_id_id_uq`); `SEPAY_ENVIRONMENTS`, `SEPAY_INTEGRATION_STATUSES`, `PAYMENT_ATTEMPT_STATUSES` (Task 1); `getPgError` (`server/db/errors.ts`); `encryptSecret` (PR3); `generateToken` (PR2); `createTenant` (PR1), `insertRawOrder` (PR3).
- Produces (PR6 dùng; giữ nguyên tên):
  - pgEnum `sepayEnvironment` (`sepay_environment`), `sepayIntegrationStatus` (`sepay_integration_status`), `paymentAttemptStatus` (`payment_attempt_status`).
  - Bảng `storePaymentAccounts` (`store_payment_accounts`): `id, orgId, storeId, bankCode, accountNumber, vaNumber, accountHolder, isActive, qrCheckedAt, verifiedAt, createdAt, updatedAt`.
  - Bảng `sepayIntegrations` (`sepay_integrations`): `id, orgId, name, environment, webhookEndpointKey, encryptedHmacSecret, encryptedApiToken, keyVersion, status, secretUpdatedAt, lastValidWebhookAt, activatedAt, createdAt, updatedAt`.
  - Bảng `integrationAccounts` (`integration_accounts`): `orgId, integrationId, paymentAccountId, createdAt`.
  - Bảng `paymentAttempts` (`payment_attempts`): `id, orgId, storeId, orderId, accountId, bankCode, accountNumber, vaNumber, accountHolder, paymentCode, transferContent, expectedAmountVnd, status, expiresAt, createdAt, updatedAt` — các cột `bankCode…accountHolder` là **bản chụp** tại thời điểm tạo.
  - Tên constraint: unique `store_payment_accounts_store_id_id_uq`, `store_payment_accounts_org_id_id_uq`, `sepay_integrations_endpoint_key_uq`, `sepay_integrations_org_id_id_uq`, `payment_attempts_payment_code_uq`, `payment_attempts_store_id_id_uq`; unique index (một phần) `store_payment_accounts_one_active_uq`, `sepay_integrations_org_env_open_uq`, `payment_attempts_one_pending_uq`; FK `store_payment_accounts_store_fk`, `integration_accounts_integration_fk`, `integration_accounts_account_fk`, `payment_attempts_store_fk`, `payment_attempts_order_fk`, `payment_attempts_account_fk`; check `store_payment_accounts_verified_requires_check`, `sepay_integrations_secret_required`, `payment_attempts_amount_positive`; PK `integration_accounts_pk`; index `payment_attempts_order_idx`, `payment_attempts_expiry_idx`.
  - Fixtures `tests/support/payment-fixtures.ts`: `TEST_HMAC_SECRET`, `createPaymentAccount(store, over?)`, `createIntegration(org, over?)`, `linkAccount(orgId, integrationId, accountId)`, `setupBankQr(store, opts?) → { account, integration }` (tài khoản đã kiểm tra + xác minh, integration `ACTIVE` có secret, đã liên kết), `ownerCtx(tenant): StoreContext`.

- [ ] **Step 1: Viết fixtures**

`tests/support/payment-fixtures.ts`:

```ts
import { getDb } from '../../server/db/client'
import type { StoreContext } from '../../server/auth/guards'
import { integrationAccounts, sepayIntegrations, storePaymentAccounts } from '../../server/db/schema'
import { encryptSecret } from '../../server/utils/crypto'
import { generateToken } from '../../server/utils/tokens'

type StoreRef = { id: string, orgId: string }

export const TEST_HMAC_SECRET = 'whsec_test_0123456789abcdef'

export async function createPaymentAccount(store: StoreRef, over: Partial<typeof storePaymentAccounts.$inferInsert> = {}) {
  const [row] = await getDb().insert(storePaymentAccounts).values({
    orgId: store.orgId,
    storeId: store.id,
    bankCode: 'VCB',
    accountNumber: '9988776655',
    accountHolder: 'NGUYEN VAN A',
    ...over,
  }).returning()
  return row!
}

export async function createIntegration(org: { id: string }, over: Partial<typeof sepayIntegrations.$inferInsert> = {}) {
  const [row] = await getDb().insert(sepayIntegrations).values({
    orgId: org.id,
    name: 'SePay',
    webhookEndpointKey: generateToken(24),
    ...over,
  }).returning()
  return row!
}

export async function linkAccount(orgId: string, integrationId: string, paymentAccountId: string) {
  await getDb().insert(integrationAccounts).values({ orgId, integrationId, paymentAccountId })
}

/** A store that can take BANK_QR orders: verified account linked to an ACTIVE integration. */
export async function setupBankQr(store: StoreRef, opts: { bankCode?: string, vaNumber?: string | null, accountNumber?: string } = {}) {
  const now = new Date()
  const account = await createPaymentAccount(store, {
    bankCode: opts.bankCode ?? 'VCB',
    vaNumber: opts.vaNumber ?? null,
    ...(opts.accountNumber ? { accountNumber: opts.accountNumber } : {}),
    qrCheckedAt: now,
    verifiedAt: now,
  })
  const integration = await createIntegration({ id: store.orgId }, {
    status: 'ACTIVE',
    encryptedHmacSecret: encryptSecret(TEST_HMAC_SECRET),
    secretUpdatedAt: now,
    lastValidWebhookAt: now,
    activatedAt: now,
  })
  await linkAccount(store.orgId, integration.id, account.id)
  return { account, integration }
}

export function ownerCtx(tenant: { org: { id: string }, store: { id: string }, owner: { userId: string } }): StoreContext {
  return { orgId: tenant.org.id, storeId: tenant.store.id, role: 'OWNER', userId: tenant.owner.userId }
}
```

- [ ] **Step 2: Viết integration test thất bại cho schema**

`tests/integration/payment-setup-schema.test.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { getPgError } from '../../server/db/errors'
import { integrationAccounts, paymentAttempts, sepayIntegrations, storePaymentAccounts } from '../../server/db/schema'
import { resetDb } from '../support/db'
import { insertRawOrder } from '../support/checkout-fixtures'
import { createTenant } from '../support/fixtures'
import { createIntegration, createPaymentAccount, linkAccount } from '../support/payment-fixtures'

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

async function pgErrorOf(fn: () => Promise<unknown>) {
  try {
    await fn()
  }
  catch (err) {
    return getPgError(err)
  }
  throw new Error('expected the statement to be rejected')
}

type StoreRef = { id: string, orgId: string }

function attemptValues(store: StoreRef, orderId: string, accountId: string, over: Partial<typeof paymentAttempts.$inferInsert> = {}) {
  return {
    orgId: store.orgId,
    storeId: store.id,
    orderId,
    accountId,
    bankCode: 'VCB',
    accountNumber: '9988776655',
    vaNumber: null,
    accountHolder: 'NGUYEN VAN A',
    paymentCode: `ZO${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`,
    transferContent: 'ZOXXXXXXXX',
    expectedAmountVnd: 50_000,
    expiresAt: new Date(Date.now() + 900_000),
    ...over,
  }
}

async function bankQrOrder(store: StoreRef) {
  return insertRawOrder(store, { paymentMethod: 'BANK_QR', status: 'AWAITING_PAYMENT', paymentStatus: 'PENDING' })
}

describe('store_payment_accounts', () => {
  it('allows only one active account per store but many inactive ones', async () => {
    const t = await createTenant('acc1')
    await createPaymentAccount(t.store)
    const err = await pgErrorOf(() => createPaymentAccount(t.store, { accountNumber: '1122334455' }))
    expect(err).toMatchObject({ code: '23505', constraint: 'store_payment_accounts_one_active_uq' })
    await createPaymentAccount(t.store, { accountNumber: '1122334455', isActive: false })
  })

  it('refuses verified_at without qr_checked_at', async () => {
    const t = await createTenant('acc2')
    const err = await pgErrorOf(() => createPaymentAccount(t.store, { verifiedAt: new Date() }))
    expect(err).toMatchObject({ code: '23514', constraint: 'store_payment_accounts_verified_requires_check' })
  })

  it('refuses an org/store pair that does not exist together', async () => {
    const a = await createTenant('acc3a')
    const b = await createTenant('acc3b')
    const err = await pgErrorOf(() => getDb().insert(storePaymentAccounts).values({
      orgId: b.org.id, storeId: a.store.id, bankCode: 'VCB', accountNumber: '9988776655', accountHolder: 'X Y',
    }))
    expect(err).toMatchObject({ code: '23503', constraint: 'store_payment_accounts_store_fk' })
  })
})

describe('sepay_integrations', () => {
  it('allows one non-disabled integration per org and environment', async () => {
    const t = await createTenant('int1')
    await createIntegration(t.org)
    const err = await pgErrorOf(() => createIntegration(t.org))
    expect(err).toMatchObject({ code: '23505', constraint: 'sepay_integrations_org_env_open_uq' })
    await createIntegration(t.org, { environment: 'test' })
  })

  it('allows a new integration once the previous one is disabled', async () => {
    const t = await createTenant('int2')
    const first = await createIntegration(t.org)
    await getDb().update(sepayIntegrations).set({ status: 'DISABLED' })
    await createIntegration(t.org)
    expect(first.status).toBe('DRAFT')
  })

  it('keeps webhook endpoint keys unique', async () => {
    const a = await createTenant('int3a')
    const b = await createTenant('int3b')
    const first = await createIntegration(a.org)
    const err = await pgErrorOf(() => createIntegration(b.org, { webhookEndpointKey: first.webhookEndpointKey }))
    expect(err).toMatchObject({ code: '23505', constraint: 'sepay_integrations_endpoint_key_uq' })
  })

  it('refuses TESTING/ACTIVE without a secret', async () => {
    const t = await createTenant('int4')
    for (const status of ['TESTING', 'ACTIVE'] as const) {
      const err = await pgErrorOf(() => createIntegration(t.org, { status, environment: status === 'TESTING' ? 'test' : 'live' }))
      expect(err).toMatchObject({ code: '23514', constraint: 'sepay_integrations_secret_required' })
    }
  })
})

describe('integration_accounts', () => {
  it('links an account of the same org', async () => {
    const t = await createTenant('link1')
    const account = await createPaymentAccount(t.store)
    const integration = await createIntegration(t.org)
    await linkAccount(t.org.id, integration.id, account.id)
    expect(await getDb().select().from(integrationAccounts)).toHaveLength(1)
  })

  it('refuses to link an account of another org', async () => {
    const a = await createTenant('link2a')
    const b = await createTenant('link2b')
    const accountB = await createPaymentAccount(b.store)
    const integrationA = await createIntegration(a.org)
    const err = await pgErrorOf(() => linkAccount(a.org.id, integrationA.id, accountB.id))
    expect(err).toMatchObject({ code: '23503', constraint: 'integration_accounts_account_fk' })
  })

  it('refuses to link into an integration of another org', async () => {
    const a = await createTenant('link3a')
    const b = await createTenant('link3b')
    const accountA = await createPaymentAccount(a.store)
    const integrationB = await createIntegration(b.org)
    const err = await pgErrorOf(() => linkAccount(a.org.id, integrationB.id, accountA.id))
    expect(err).toMatchObject({ code: '23503', constraint: 'integration_accounts_integration_fk' })
  })
})

describe('payment_attempts', () => {
  it('keeps payment codes unique across the whole system, whatever the status', async () => {
    const a = await createTenant('att1a')
    const b = await createTenant('att1b')
    const accountA = await createPaymentAccount(a.store)
    const accountB = await createPaymentAccount(b.store)
    const orderA = await bankQrOrder(a.store)
    const orderB = await bankQrOrder(b.store)
    await getDb().insert(paymentAttempts).values(attemptValues(a.store, orderA.id, accountA.id, { paymentCode: 'ZOSAME0001', status: 'SUPERSEDED' }))
    const err = await pgErrorOf(() => getDb().insert(paymentAttempts).values(attemptValues(b.store, orderB.id, accountB.id, { paymentCode: 'ZOSAME0001' })))
    expect(err).toMatchObject({ code: '23505', constraint: 'payment_attempts_payment_code_uq' })
  })

  it('allows only one PENDING attempt per order but any number of old ones', async () => {
    const t = await createTenant('att2')
    const account = await createPaymentAccount(t.store)
    const order = await bankQrOrder(t.store)
    await getDb().insert(paymentAttempts).values(attemptValues(t.store, order.id, account.id))
    const err = await pgErrorOf(() => getDb().insert(paymentAttempts).values(attemptValues(t.store, order.id, account.id)))
    expect(err).toMatchObject({ code: '23505', constraint: 'payment_attempts_one_pending_uq' })
    await getDb().insert(paymentAttempts).values(attemptValues(t.store, order.id, account.id, { status: 'SUPERSEDED' }))
    await getDb().insert(paymentAttempts).values(attemptValues(t.store, order.id, account.id, { status: 'EXPIRED' }))
  })

  it('refuses an account of another store (composite FK)', async () => {
    const a = await createTenant('att3a')
    const b = await createTenant('att3b')
    const accountB = await createPaymentAccount(b.store)
    const orderA = await bankQrOrder(a.store)
    const err = await pgErrorOf(() => getDb().insert(paymentAttempts).values(attemptValues(a.store, orderA.id, accountB.id)))
    expect(err).toMatchObject({ code: '23503', constraint: 'payment_attempts_account_fk' })
  })

  it('refuses an order of another store (composite FK)', async () => {
    const a = await createTenant('att4a')
    const b = await createTenant('att4b')
    const accountA = await createPaymentAccount(a.store)
    const orderB = await bankQrOrder(b.store)
    const err = await pgErrorOf(() => getDb().insert(paymentAttempts).values(attemptValues(a.store, orderB.id, accountA.id)))
    expect(err).toMatchObject({ code: '23503', constraint: 'payment_attempts_order_fk' })
  })

  it('refuses a zero or negative expected amount', async () => {
    const t = await createTenant('att5')
    const account = await createPaymentAccount(t.store)
    const order = await bankQrOrder(t.store)
    const err = await pgErrorOf(() => getDb().insert(paymentAttempts).values(attemptValues(t.store, order.id, account.id, { expectedAmountVnd: 0 })))
    expect(err).toMatchObject({ code: '23514', constraint: 'payment_attempts_amount_positive' })
  })
})
```

- [ ] **Step 3: Chạy test để xác nhận thất bại**

Run: `npm run test:integration -- tests/integration/payment-setup-schema.test.ts`
Expected: FAIL — `payment-setup` chưa export `storePaymentAccounts`… (lỗi import).

- [ ] **Step 4: Viết schema**

`server/db/schema/payment-setup.ts`:

```ts
import { sql } from 'drizzle-orm'
import {
  bigint, boolean, check, foreignKey, index, integer, pgEnum, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core'
import { PAYMENT_ATTEMPT_STATUSES, SEPAY_ENVIRONMENTS, SEPAY_INTEGRATION_STATUSES } from '../../../shared/payment'
import { organizations, stores, timestamps } from './identity'
import { orders } from './ordering'

export const sepayEnvironment = pgEnum('sepay_environment', SEPAY_ENVIRONMENTS)
export const sepayIntegrationStatus = pgEnum('sepay_integration_status', SEPAY_INTEGRATION_STATUSES)
export const paymentAttemptStatus = pgEnum('payment_attempt_status', PAYMENT_ATTEMPT_STATUSES)

export const storePaymentAccounts = pgTable('store_payment_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  storeId: uuid('store_id').notNull(),
  bankCode: text('bank_code').notNull(),
  /** The bank account number (matches the webhook `accountNumber`). */
  accountNumber: text('account_number').notNull(),
  /** Official SePay virtual account; when set it is the number encoded in the QR (matches webhook `subAccount`). */
  vaNumber: text('va_number'),
  accountHolder: text('account_holder').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  /** Owner scanned the check QR and the bank app showed the right holder. */
  qrCheckedAt: timestamp('qr_checked_at', { withTimezone: true }),
  /** QR-checked and linked to an ACTIVE integration that has received a valid webhook. */
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  ...timestamps,
}, t => [
  unique('store_payment_accounts_store_id_id_uq').on(t.storeId, t.id),
  unique('store_payment_accounts_org_id_id_uq').on(t.orgId, t.id),
  foreignKey({ name: 'store_payment_accounts_store_fk', columns: [t.orgId, t.storeId], foreignColumns: [stores.orgId, stores.id] }).onDelete('cascade'),
  uniqueIndex('store_payment_accounts_one_active_uq').on(t.storeId).where(sql`${t.isActive}`),
  check('store_payment_accounts_verified_requires_check', sql`${t.verifiedAt} is null or ${t.qrCheckedAt} is not null`),
])

export const sepayIntegrations = pgTable('sepay_integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  environment: sepayEnvironment('environment').notNull().default('live'),
  webhookEndpointKey: text('webhook_endpoint_key').notNull(),
  encryptedHmacSecret: text('encrypted_hmac_secret'),
  encryptedApiToken: text('encrypted_api_token'),
  keyVersion: integer('key_version').notNull().default(1),
  status: sepayIntegrationStatus('status').notNull().default('DRAFT'),
  secretUpdatedAt: timestamp('secret_updated_at', { withTimezone: true }),
  /** Set by PR6 on the first webhook whose signature verified. */
  lastValidWebhookAt: timestamp('last_valid_webhook_at', { withTimezone: true }),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
  ...timestamps,
}, t => [
  unique('sepay_integrations_endpoint_key_uq').on(t.webhookEndpointKey),
  unique('sepay_integrations_org_id_id_uq').on(t.orgId, t.id),
  uniqueIndex('sepay_integrations_org_env_open_uq').on(t.orgId, t.environment).where(sql`${t.status} <> 'DISABLED'`),
  check('sepay_integrations_secret_required', sql`${t.status} in ('DRAFT', 'DISABLED') or ${t.encryptedHmacSecret} is not null`),
])

export const integrationAccounts = pgTable('integration_accounts', {
  orgId: uuid('org_id').notNull(),
  integrationId: uuid('integration_id').notNull(),
  paymentAccountId: uuid('payment_account_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  primaryKey({ name: 'integration_accounts_pk', columns: [t.integrationId, t.paymentAccountId] }),
  foreignKey({ name: 'integration_accounts_integration_fk', columns: [t.orgId, t.integrationId], foreignColumns: [sepayIntegrations.orgId, sepayIntegrations.id] }).onDelete('cascade'),
  foreignKey({ name: 'integration_accounts_account_fk', columns: [t.orgId, t.paymentAccountId], foreignColumns: [storePaymentAccounts.orgId, storePaymentAccounts.id] }).onDelete('cascade'),
  index('integration_accounts_account_idx').on(t.paymentAccountId),
])

export const paymentAttempts = pgTable('payment_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  storeId: uuid('store_id').notNull(),
  orderId: uuid('order_id').notNull(),
  accountId: uuid('account_id').notNull(),
  // Snapshot of the receiving account when the attempt was created: later account edits never change an old QR.
  bankCode: text('bank_code').notNull(),
  accountNumber: text('account_number').notNull(),
  vaNumber: text('va_number'),
  accountHolder: text('account_holder').notNull(),
  paymentCode: text('payment_code').notNull(),
  transferContent: text('transfer_content').notNull(),
  expectedAmountVnd: bigint('expected_amount_vnd', { mode: 'number' }).notNull(),
  status: paymentAttemptStatus('status').notNull().default('PENDING'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ...timestamps,
}, t => [
  unique('payment_attempts_payment_code_uq').on(t.paymentCode),
  unique('payment_attempts_store_id_id_uq').on(t.storeId, t.id),
  foreignKey({ name: 'payment_attempts_store_fk', columns: [t.orgId, t.storeId], foreignColumns: [stores.orgId, stores.id] }).onDelete('cascade'),
  foreignKey({ name: 'payment_attempts_order_fk', columns: [t.storeId, t.orderId], foreignColumns: [orders.storeId, orders.id] }).onDelete('cascade'),
  foreignKey({ name: 'payment_attempts_account_fk', columns: [t.storeId, t.accountId], foreignColumns: [storePaymentAccounts.storeId, storePaymentAccounts.id] }),
  uniqueIndex('payment_attempts_one_pending_uq').on(t.orderId).where(sql`${t.status} = 'PENDING'`),
  index('payment_attempts_order_idx').on(t.orderId, t.createdAt),
  index('payment_attempts_expiry_idx').on(t.status, t.expiresAt),
  check('payment_attempts_amount_positive', sql`${t.expectedAmountVnd} > 0`),
])
```

`server/db/schema/index.ts` — thêm một dòng ở cuối (giữ các dòng `export *` hiện có của PR1–PR4):

```ts
export * from './payment-setup'
```

- [ ] **Step 5: Sinh migration, kiểm tra, áp dụng lên branch `test`**

Run:

```bash
npx drizzle-kit generate --name payment_setup
npm run db:check
ENV_FILE=.env.test npx drizzle-kit migrate
grep -nE "payment_attempts_one_pending_uq|store_payment_accounts_one_active_uq|sepay_integrations_org_env_open_uq|payment_attempts_amount_positive|sepay_integrations_secret_required|integration_accounts_account_fk" drizzle/0004_payment_setup.sql
```

Expected: đúng một file `drizzle/0004_payment_setup.sql` (cộng `meta`); `db:check` ổn; migrate không lỗi; `grep` in đủ 6 tên. Mở file và xác nhận ba `CREATE UNIQUE INDEX … WHERE …` có điều kiện `"is_active"`/`<> 'DISABLED'`/`= 'PENDING'`, ba `CHECK`, và `CREATE TYPE` cho 3 enum. Số thứ tự `0004` có thể khác nếu PR trước sinh thêm file; không đổi tên file.

- [ ] **Step 6: Chạy test để xác nhận đạt**

Run: `npm run test:integration -- tests/integration/payment-setup-schema.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/db/schema/payment-setup.ts server/db/schema/index.ts drizzle tests/support/payment-fixtures.ts tests/integration/payment-setup-schema.test.ts
git commit -m "feat(payment-setup): add payment accounts, SePay integrations and payment attempts schema" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Logger che secret/đường dẫn nhạy cảm + công cụ bắt rò rỉ cho test

**Files:**
- Modify: `server/utils/logger.ts`
- Create: `tests/support/leaks.ts`, `tests/unit/server/logger-payments.test.ts`

**Interfaces:**
- Consumes: `logger`, `redact` (`server/utils/logger.ts`, PR0).
- Produces:
  - `redact` che thêm key khớp `endpoint[_-]?key` (`endpointKey`, `webhookEndpointKey`, `endpoint_key`) và che trong **chuỗi** các đoạn `/api/webhooks/sepay/<key>` và `/api/public/orders/<token>` (giữ phần sau token, vd `/payment-attempts`). Che ở sink log nên đúng kể cả khi code gọi log quên che đường dẫn.
  - `tests/support/leaks.ts`: `captureConsole(): { text(): string; restore(): void }` (spy `console.log/info/warn/error/debug`, không in ra thật), `expectNoneOf(haystack: string, needles: string[]): void` (thông báo lỗi chỉ ghi số thứ tự needle, không in secret).

- [ ] **Step 1: Viết helper và test thất bại**

`tests/support/leaks.ts`:

```ts
import { expect, vi } from 'vitest'

export function captureConsole() {
  const lines: string[] = []
  const push = (...args: unknown[]) => {
    lines.push(args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '))
  }
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(method => vi.spyOn(console, method).mockImplementation(push))
  return {
    text: () => lines.join('\n'),
    restore: () => spies.forEach(spy => spy.mockRestore()),
  }
}

/** Fails without printing the needle itself, so a leaked secret never lands in the test report. */
export function expectNoneOf(haystack: string, needles: string[]): void {
  needles.forEach((needle, index) => {
    expect(haystack.includes(needle), `needle #${index} leaked`).toBe(false)
  })
}
```

`tests/unit/server/logger-payments.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { logger, redact } from '../../../server/utils/logger'
import { captureConsole, expectNoneOf } from '../../support/leaks'

describe('redact: payment secrets', () => {
  it.each([
    'hmacSecret', 'apiToken', 'encryptedHmacSecret', 'encryptedApiToken',
    'webhookEndpointKey', 'endpointKey', 'endpoint_key', 'endpoint-key',
  ])('masks the key %s', (key) => {
    expect(redact({ [key]: 'value', ok: 1 })).toEqual({ [key]: '[REDACTED]', ok: 1 })
  })
})

describe('redact: sensitive paths inside strings', () => {
  it('masks the webhook endpoint key but keeps the rest of the message', () => {
    expect(redact('POST /api/webhooks/sepay/AbC_dEf-1234567890abcdefghijkl failed'))
      .toBe('POST /api/webhooks/sepay/[REDACTED] failed')
  })

  it('stops at the query string', () => {
    expect(redact({ path: '/api/webhooks/sepay/KEY123?x=1' })).toEqual({ path: '/api/webhooks/sepay/[REDACTED]?x=1' })
  })

  it('masks the guest token in order paths, including the payment-attempts sub-route', () => {
    expect(redact('/api/public/orders/Tok_en-0123456789')).toBe('/api/public/orders/[REDACTED]')
    expect(redact('/api/public/orders/Tok_en-0123456789/payment-attempts')).toBe('/api/public/orders/[REDACTED]/payment-attempts')
  })

  it('leaves unrelated paths untouched', () => {
    expect(redact('/api/public/stores/tra-sua/menu')).toBe('/api/public/stores/tra-sua/menu')
    expect(redact('/api/webhooks/other/abc')).toBe('/api/webhooks/other/abc')
  })
})

describe('logger output', () => {
  it('never prints a secret, endpoint key or guest token passed in the context', () => {
    const capture = captureConsole()
    try {
      logger.error('api.unhandled', {
        path: '/api/webhooks/sepay/ENDPOINTKEY0123456789abcdefghij',
        order: '/api/public/orders/GUESTTOKEN0123456789abcdefghijklmnopqrstu/payment-attempts',
        hmacSecret: 'SENTINEL_HMAC_VALUE',
        nested: { apiToken: 'SENTINEL_API_TOKEN' },
        err: new Error('boom'),
      })
    }
    finally {
      capture.restore()
    }
    expectNoneOf(capture.text(), [
      'ENDPOINTKEY0123456789abcdefghij',
      'GUESTTOKEN0123456789abcdefghijklmnopqrstu',
      'SENTINEL_HMAC_VALUE',
      'SENTINEL_API_TOKEN',
    ])
    expect(capture.text()).toContain('[REDACTED]')
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `npx vitest run --project unit tests/unit/server/logger-payments.test.ts`
Expected: FAIL — `webhookEndpointKey`/`endpointKey` chưa bị che, đường dẫn chưa bị che.

- [ ] **Step 3: Sửa `server/utils/logger.ts`**

Hai chỗ (nếu PR3 đã thêm xử lý đường dẫn khác ở đây, giữ nguyên của PR3 và chỉ thêm phần dưới):

```ts
// old
const SENSITIVE_KEY = /phone|address|secret|token|password|authorization|signature|cookie|api[_-]?key|hmac|encryption|jwt|session|credential|private[_-]?key/i
const CONNECTION_STRING = /\b(postgres(?:ql)?):\/\/\S+/gi
const MAX_DEPTH = 6

function redactString(value: string): string {
  return value.replace(CONNECTION_STRING, '$1://[REDACTED]')
}
```

```ts
// new
const SENSITIVE_KEY = /phone|address|secret|token|password|authorization|signature|cookie|api[_-]?key|hmac|encryption|jwt|session|credential|private[_-]?key|endpoint[_-]?key/i
const CONNECTION_STRING = /\b(postgres(?:ql)?):\/\/\S+/gi
// The webhook endpoint key and the guest token are bearer-like: they must never reach a log line inside a path.
const WEBHOOK_PATH = /(\/api\/webhooks\/sepay\/)[^\s/?#"']+/gi
const ORDER_TOKEN_PATH = /(\/api\/public\/orders\/)[^\s/?#"']+/gi
const MAX_DEPTH = 6

function redactString(value: string): string {
  return value
    .replace(CONNECTION_STRING, '$1://[REDACTED]')
    .replace(WEBHOOK_PATH, '$1[REDACTED]')
    .replace(ORDER_TOKEN_PATH, '$1[REDACTED]')
}
```

- [ ] **Step 4: Chạy test để xác nhận đạt (cả logger cũ)**

Run: `npx vitest run --project unit tests/unit/server/logger-payments.test.ts tests/unit/server/logger.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/utils/logger.ts tests/support/leaks.ts tests/unit/server/logger-payments.test.ts
git commit -m "feat(payment-setup): redact endpoint keys and token paths in logs" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Service tài khoản nhận tiền + quy trình "Kiểm tra" + routes (owner)

**Files:**
- Create: `server/services/payments/accounts.ts`, `server/api/stores/[storeId]/payment-accounts/index.get.ts`, `server/api/stores/[storeId]/payment-accounts/index.post.ts`, `server/api/stores/[storeId]/payment-accounts/[accountId]/index.patch.ts`, `server/api/stores/[storeId]/payment-accounts/[accountId]/check.post.ts`, `server/api/stores/[storeId]/payment-accounts/[accountId]/confirm-qr.post.ts`, `tests/integration/payment-accounts.test.ts`

**Interfaces:**
- Consumes: Task 1–3; `StoreContext`, `requireStoreOwner` (PR1); `Db`, `DbOrTx`; `AppError`, `zodIssues`; `parseWith`, `parseBody`; `requireUuidParam` (PR2); `buildTransferContent`, `buildVietQrUrl`, `PAYMENT_TEST_CODE` (Task 2).
- Produces (UI Task 11 và PR6 dùng):
  - `getPaymentAccount(db: DbOrTx, ctx: StoreContext): Promise<PaymentAccountDto | null>` — tài khoản `is_active` của store.
  - `createPaymentAccount(db: DbOrTx, ctx: StoreContext, input: PaymentAccountInput): Promise<PaymentAccountDto>` — store đã có tài khoản active → `AppError('STATUS_CONFLICT')`.
  - `updatePaymentAccount(db: Db, ctx: StoreContext, accountId: string, patch: PaymentAccountPatch): Promise<PaymentAccountDto>` — gộp với dữ liệu cũ, validate lại bằng `paymentAccountInputSchema` (lỗi → 400 `VALIDATION_FAILED`); **nếu có trường thật sự đổi thì xoá `qr_checked_at` và `verified_at`**; không đổi gì thì giữ nguyên; không thấy trong store → `NOT_FOUND`.
  - `checkPaymentAccount(db: DbOrTx, ctx, accountId): Promise<PaymentAccountCheck>` — kiểm tra lại dữ liệu đã lưu (bank, số tài khoản, VA bắt buộc), cảnh báo nếu ngân hàng chưa nằm trong bảng webhook của SePay (U3), và nếu hợp lệ dựng QR kiểm tra `PAYMENT_PREVIEW_AMOUNT_VND` với mã `PAYMENT_TEST_CODE`.
  - `confirmAccountQr(db: Db, ctx, accountId, now?: Date): Promise<PaymentAccountDto>` — dữ liệu phải hợp lệ (nếu không → 400); đặt `qr_checked_at = now`; nếu tài khoản đã gắn với integration `ACTIVE` có `last_valid_webhook_at` thì đặt luôn `verified_at`.
  - `verifyAccountIfIntegrationActive(db: DbOrTx, orgId: string, accountId: string, now: Date): Promise<void>` — đặt `verified_at` khi tài khoản đã QR-check và gắn với integration `ACTIVE` đã nhận webhook hợp lệ (Task 6 dùng).
  - Routes (đều `requireStoreOwner`: staff → 403, ngoài tenant → 404): `GET /api/stores/:storeId/payment-accounts` → `{ account: PaymentAccountDto | null }`; `POST …/payment-accounts` (201) → `PaymentAccountDto`; `PATCH …/payment-accounts/:accountId`; `POST …/:accountId/check` → `PaymentAccountCheck`; `POST …/:accountId/confirm-qr` → `PaymentAccountDto`. Tất cả `Cache-Control: no-store`.

Lưu ý TDD: các route handler chỉ là lớp mỏng; test HTTP (ma trận tenant, luồng owner) nằm ở Task 9 vì cần build server. Task này kiểm service bằng integration test và route bằng `nuxt typecheck`.

- [ ] **Step 1: Viết integration test thất bại**

`tests/integration/payment-accounts.test.ts`:

```ts
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { storePaymentAccounts } from '../../server/db/schema'
import {
  checkPaymentAccount,
  confirmAccountQr,
  createPaymentAccount,
  getPaymentAccount,
  updatePaymentAccount,
} from '../../server/services/payments/accounts'
import { resetDb } from '../support/db'
import { createTenant } from '../support/fixtures'
import { createIntegration, createPaymentAccount as insertAccount, linkAccount, ownerCtx } from '../support/payment-fixtures'
import { encryptSecret } from '../../server/utils/crypto'

const input = { bankCode: 'VCB', accountNumber: '9988776655', accountHolder: 'NGUYEN VAN A', vaNumber: null }

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('createPaymentAccount / getPaymentAccount', () => {
  it('creates an unchecked account for the store', async () => {
    const t = await createTenant('ac1')
    const dto = await createPaymentAccount(getDb(), ownerCtx(t), input)
    expect(dto).toMatchObject({
      bankCode: 'VCB', bankName: 'Vietcombank', accountNumber: '9988776655', vaNumber: null,
      accountHolder: 'NGUYEN VAN A', qrCheckedAt: null, verifiedAt: null, linkedIntegrationId: null,
    })
    expect(await getPaymentAccount(getDb(), ownerCtx(t))).toEqual(dto)
  })

  it('refuses a second active account with STATUS_CONFLICT', async () => {
    const t = await createTenant('ac2')
    await createPaymentAccount(getDb(), ownerCtx(t), input)
    await expect(createPaymentAccount(getDb(), ownerCtx(t), { ...input, accountNumber: '1122334455' }))
      .rejects.toMatchObject({ code: 'STATUS_CONFLICT' })
  })

  it('returns null when the store has none and never shows another store\'s account', async () => {
    const a = await createTenant('ac3a')
    const b = await createTenant('ac3b')
    await createPaymentAccount(getDb(), ownerCtx(a), input)
    expect(await getPaymentAccount(getDb(), ownerCtx(b))).toBeNull()
  })
})

describe('updatePaymentAccount', () => {
  it('clears the QR check and verification when a field really changes (Review Focus #4)', async () => {
    const t = await createTenant('up1')
    const created = await createPaymentAccount(getDb(), ownerCtx(t), input)
    const now = new Date()
    await getDb().update(storePaymentAccounts).set({ qrCheckedAt: now, verifiedAt: now }).where(eq(storePaymentAccounts.id, created.id))

    const updated = await updatePaymentAccount(getDb(), ownerCtx(t), created.id, { accountNumber: '1122-334455' })
    expect(updated).toMatchObject({ accountNumber: '1122334455', qrCheckedAt: null, verifiedAt: null })
  })

  it('keeps the check when the patch changes nothing', async () => {
    const t = await createTenant('up2')
    const created = await createPaymentAccount(getDb(), ownerCtx(t), input)
    const now = new Date()
    await getDb().update(storePaymentAccounts).set({ qrCheckedAt: now, verifiedAt: now }).where(eq(storePaymentAccounts.id, created.id))

    const same = await updatePaymentAccount(getDb(), ownerCtx(t), created.id, { bankCode: 'vcb', accountHolder: ' NGUYEN VAN A ' })
    expect(same.qrCheckedAt).not.toBeNull()
    expect(same.verifiedAt).not.toBeNull()
  })

  it('rejects a patch that would make the account invalid and leaves it untouched', async () => {
    const t = await createTenant('up3')
    const created = await createPaymentAccount(getDb(), ownerCtx(t), input)
    await expect(updatePaymentAccount(getDb(), ownerCtx(t), created.id, { bankCode: 'MSB' }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect((await getPaymentAccount(getDb(), ownerCtx(t)))?.bankCode).toBe('VCB')
  })

  it('does not find an account of another store', async () => {
    const a = await createTenant('up4a')
    const b = await createTenant('up4b')
    const created = await createPaymentAccount(getDb(), ownerCtx(a), input)
    await expect(updatePaymentAccount(getDb(), ownerCtx(b), created.id, { accountHolder: 'HACKER' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('checkPaymentAccount', () => {
  it('builds the 2.000đ check QR with the test code and warns when SePay does not list the bank (U3)', async () => {
    const t = await createTenant('ck1')
    const account = await createPaymentAccount(getDb(), ownerCtx(t), input)
    const check = await checkPaymentAccount(getDb(), ownerCtx(t), account.id)
    expect(check.ok).toBe(true)
    expect(check.issues).toEqual([])
    expect(check.preview).toEqual({
      bankName: 'Vietcombank',
      accountNumber: '9988776655',
      accountHolder: 'NGUYEN VAN A',
      amountVnd: 2000,
      transferContent: 'ZOTEST0000',
      imageUrl: 'https://vietqr.app/img?acc=9988776655&bank=970436&amount=2000&des=ZOTEST0000&template=qronly',
    })
    expect(check.warnings).toHaveLength(1)
    expect(check.warnings[0]).toContain('my.sepay.vn')
  })

  it('has no warning for a bank in the SePay webhook table', async () => {
    const t = await createTenant('ck2')
    const account = await createPaymentAccount(getDb(), ownerCtx(t), { ...input, bankCode: 'ACB' })
    expect((await checkPaymentAccount(getDb(), ownerCtx(t), account.id)).warnings).toEqual([])
  })

  it('encodes the VA and SEVQR (Review Focus #1)', async () => {
    const t = await createTenant('ck3')
    const ocb = await createPaymentAccount(getDb(), ownerCtx(t), { ...input, bankCode: 'OCB', vaNumber: 'VQRQ12345678' })
    const check = await checkPaymentAccount(getDb(), ownerCtx(t), ocb.id)
    expect(check.preview?.accountNumber).toBe('VQRQ12345678')
    expect(check.preview?.imageUrl).toContain('acc=VQRQ12345678')
    await getDb().update(storePaymentAccounts).set({ bankCode: 'ICB', vaNumber: null }).where(eq(storePaymentAccounts.id, ocb.id))
    const viet = await checkPaymentAccount(getDb(), ownerCtx(t), ocb.id)
    expect(viet.preview?.transferContent).toBe('SEVQR ZOTEST0000')
    expect(viet.preview?.imageUrl).toContain('des=SEVQR%20ZOTEST0000')
  })

  it('flags stored data that is invalid for its bank (a VA-only bank without VA)', async () => {
    const t = await createTenant('ck4')
    const row = await insertAccount(t.store, { bankCode: 'MSB' })
    const check = await checkPaymentAccount(getDb(), ownerCtx(t), row.id)
    expect(check.ok).toBe(false)
    expect(check.preview).toBeNull()
    expect(check.issues).toEqual([{ field: 'vaNumber', message: expect.stringContaining('MSB') }])
  })

  it('does not find an account of another store', async () => {
    const a = await createTenant('ck5a')
    const b = await createTenant('ck5b')
    const row = await insertAccount(a.store)
    await expect(checkPaymentAccount(getDb(), ownerCtx(b), row.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('confirmAccountQr', () => {
  it('records the QR check but does not verify an account with no active integration', async () => {
    const t = await createTenant('cf1')
    const account = await createPaymentAccount(getDb(), ownerCtx(t), input)
    const now = new Date('2026-11-01T05:00:00Z')
    const confirmed = await confirmAccountQr(getDb(), ownerCtx(t), account.id, now)
    expect(confirmed.qrCheckedAt).toBe(now.toISOString())
    expect(confirmed.verifiedAt).toBeNull()
  })

  it('also verifies when the account is already linked to an ACTIVE integration that received a valid webhook', async () => {
    const t = await createTenant('cf2')
    const account = await createPaymentAccount(getDb(), ownerCtx(t), input)
    const integration = await createIntegration(t.org, {
      status: 'ACTIVE', encryptedHmacSecret: encryptSecret('whsec_0123456789'), lastValidWebhookAt: new Date(),
    })
    await linkAccount(t.org.id, integration.id, account.id)
    const confirmed = await confirmAccountQr(getDb(), ownerCtx(t), account.id)
    expect(confirmed.verifiedAt).not.toBeNull()
    expect(confirmed.linkedIntegrationId).toBe(integration.id)
  })

  it('does not verify through an ACTIVE integration that has never seen a valid webhook', async () => {
    const t = await createTenant('cf3')
    const account = await createPaymentAccount(getDb(), ownerCtx(t), input)
    const integration = await createIntegration(t.org, { status: 'ACTIVE', encryptedHmacSecret: encryptSecret('whsec_0123456789') })
    await linkAccount(t.org.id, integration.id, account.id)
    expect((await confirmAccountQr(getDb(), ownerCtx(t), account.id)).verifiedAt).toBeNull()
  })

  it('refuses to confirm an invalid account', async () => {
    const t = await createTenant('cf4')
    const row = await insertAccount(t.store, { bankCode: 'BIDV' })
    await expect(confirmAccountQr(getDb(), ownerCtx(t), row.id)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    const [after] = await getDb().select().from(storePaymentAccounts).where(eq(storePaymentAccounts.id, row.id))
    expect(after!.qrCheckedAt).toBeNull()
  })

  it('does not find an account of another store', async () => {
    const a = await createTenant('cf5a')
    const b = await createTenant('cf5b')
    const row = await insertAccount(a.store)
    await expect(confirmAccountQr(getDb(), ownerCtx(b), row.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `npm run test:integration -- tests/integration/payment-accounts.test.ts`
Expected: FAIL — không resolve được `server/services/payments/accounts`.

- [ ] **Step 3: Viết service**

`server/services/payments/accounts.ts`:

```ts
import { and, desc, eq, exists, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import type { ZodError } from 'zod'
import { findBank } from '#shared/banks'
import { PAYMENT_PREVIEW_AMOUNT_VND } from '#shared/payment'
import { paymentAccountInputSchema, type PaymentAccountInput, type PaymentAccountPatch } from '#shared/schemas/payment'
import type { PaymentAccountCheck, PaymentAccountDto, PaymentAccountField, PaymentAccountIssue } from '#shared/types/payment'
import type { StoreContext } from '../../auth/guards'
import type { Db, DbOrTx } from '../../db/client'
import { isUniqueViolation } from '../../db/errors'
import { integrationAccounts, sepayIntegrations, storePaymentAccounts } from '../../db/schema'
import { AppError, zodIssues } from '../../utils/errors'
import { parseWith } from '../../utils/validation'
import { buildTransferContent, buildVietQrUrl, PAYMENT_TEST_CODE } from './payment-code'

type AccountRow = typeof storePaymentAccounts.$inferSelect

const notFound = () => new AppError('NOT_FOUND', 'Không tìm thấy')

const scope = (ctx: StoreContext) => and(
  eq(storePaymentAccounts.orgId, ctx.orgId),
  eq(storePaymentAccounts.storeId, ctx.storeId),
)

async function linkedIntegrationId(db: DbOrTx, orgId: string, accountId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: sepayIntegrations.id })
    .from(integrationAccounts)
    .innerJoin(sepayIntegrations, and(
      eq(sepayIntegrations.orgId, integrationAccounts.orgId),
      eq(sepayIntegrations.id, integrationAccounts.integrationId),
    ))
    .where(and(
      eq(integrationAccounts.orgId, orgId),
      eq(integrationAccounts.paymentAccountId, accountId),
      ne(sepayIntegrations.status, 'DISABLED'),
    ))
    .orderBy(desc(integrationAccounts.createdAt))
    .limit(1)
  return row?.id ?? null
}

async function toDto(db: DbOrTx, row: AccountRow): Promise<PaymentAccountDto> {
  return {
    id: row.id,
    bankCode: row.bankCode,
    bankName: findBank(row.bankCode)?.shortName ?? row.bankCode,
    accountNumber: row.accountNumber,
    vaNumber: row.vaNumber,
    accountHolder: row.accountHolder,
    qrCheckedAt: row.qrCheckedAt?.toISOString() ?? null,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    linkedIntegrationId: await linkedIntegrationId(db, row.orgId, row.id),
  }
}

const rawInput = (row: AccountRow) => ({
  bankCode: row.bankCode,
  accountNumber: row.accountNumber,
  accountHolder: row.accountHolder,
  vaNumber: row.vaNumber,
})

async function lockAccount(db: DbOrTx, ctx: StoreContext, accountId: string): Promise<AccountRow> {
  const [row] = await db
    .select()
    .from(storePaymentAccounts)
    .where(and(scope(ctx), eq(storePaymentAccounts.id, accountId), eq(storePaymentAccounts.isActive, true)))
    .for('update')
  if (!row) throw notFound()
  return row
}

function toIssues(error: ZodError): PaymentAccountIssue[] {
  return error.issues.map(issue => ({
    field: String(issue.path[0] ?? 'bankCode') as PaymentAccountField,
    message: issue.message,
  }))
}

export async function getPaymentAccount(db: DbOrTx, ctx: StoreContext): Promise<PaymentAccountDto | null> {
  const [row] = await db
    .select()
    .from(storePaymentAccounts)
    .where(and(scope(ctx), eq(storePaymentAccounts.isActive, true)))
    .limit(1)
  return row ? toDto(db, row) : null
}

export async function createPaymentAccount(db: DbOrTx, ctx: StoreContext, input: PaymentAccountInput): Promise<PaymentAccountDto> {
  try {
    const [row] = await db
      .insert(storePaymentAccounts)
      .values({
        orgId: ctx.orgId,
        storeId: ctx.storeId,
        bankCode: input.bankCode,
        accountNumber: input.accountNumber,
        vaNumber: input.vaNumber,
        accountHolder: input.accountHolder,
      })
      .returning()
    return await toDto(db, row!)
  }
  catch (err) {
    if (isUniqueViolation(err, 'store_payment_accounts_one_active_uq')) {
      throw new AppError('STATUS_CONFLICT', 'Cửa hàng đã có tài khoản nhận tiền, hãy sửa tài khoản hiện có')
    }
    throw err
  }
}

export async function updatePaymentAccount(db: Db, ctx: StoreContext, accountId: string, patch: PaymentAccountPatch): Promise<PaymentAccountDto> {
  return db.transaction(async (tx) => {
    const row = await lockAccount(tx, ctx, accountId)
    const merged = parseWith(paymentAccountInputSchema, {
      bankCode: patch.bankCode ?? row.bankCode,
      accountNumber: patch.accountNumber ?? row.accountNumber,
      accountHolder: patch.accountHolder ?? row.accountHolder,
      vaNumber: patch.vaNumber === undefined ? row.vaNumber : patch.vaNumber,
    })
    const changed = merged.bankCode !== row.bankCode
      || merged.accountNumber !== row.accountNumber
      || merged.accountHolder !== row.accountHolder
      || merged.vaNumber !== row.vaNumber
    if (!changed) return toDto(tx, row)
    // Any edit invalidates the proof that the owner scanned the right account.
    const [updated] = await tx
      .update(storePaymentAccounts)
      .set({ ...merged, qrCheckedAt: null, verifiedAt: null, updatedAt: new Date() })
      .where(eq(storePaymentAccounts.id, row.id))
      .returning()
    return toDto(tx, updated!)
  })
}

export async function checkPaymentAccount(db: DbOrTx, ctx: StoreContext, accountId: string): Promise<PaymentAccountCheck> {
  const [row] = await db
    .select()
    .from(storePaymentAccounts)
    .where(and(scope(ctx), eq(storePaymentAccounts.id, accountId), eq(storePaymentAccounts.isActive, true)))
  if (!row) throw notFound()

  const parsed = paymentAccountInputSchema.safeParse(rawInput(row))
  if (!parsed.success) return { ok: false, issues: toIssues(parsed.error), warnings: [], preview: null }

  const bank = findBank(row.bankCode)!
  const qrAccount = row.vaNumber ?? row.accountNumber
  return {
    ok: true,
    issues: [],
    warnings: bank.sepayWebhook
      ? []
      : [`SePay chưa liệt kê ${bank.shortName} trong danh sách ngân hàng hỗ trợ webhook; hãy kiểm tra tài khoản đã liên kết trên my.sepay.vn.`],
    preview: {
      bankName: bank.shortName,
      accountNumber: qrAccount,
      accountHolder: row.accountHolder,
      amountVnd: PAYMENT_PREVIEW_AMOUNT_VND,
      transferContent: buildTransferContent(bank.code, PAYMENT_TEST_CODE),
      imageUrl: buildVietQrUrl({
        bankCode: bank.code,
        accountNumber: qrAccount,
        amountVnd: PAYMENT_PREVIEW_AMOUNT_VND,
        paymentCode: PAYMENT_TEST_CODE,
      }),
    },
  }
}

export async function confirmAccountQr(db: Db, ctx: StoreContext, accountId: string, now = new Date()): Promise<PaymentAccountDto> {
  return db.transaction(async (tx) => {
    const row = await lockAccount(tx, ctx, accountId)
    const parsed = paymentAccountInputSchema.safeParse(rawInput(row))
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', 'Thông tin tài khoản chưa hợp lệ', zodIssues(parsed.error))
    await tx.update(storePaymentAccounts).set({ qrCheckedAt: now, updatedAt: now }).where(eq(storePaymentAccounts.id, row.id))
    await verifyAccountIfIntegrationActive(tx, ctx.orgId, row.id, now)
    const [fresh] = await tx.select().from(storePaymentAccounts).where(eq(storePaymentAccounts.id, row.id))
    return toDto(tx, fresh!)
  })
}

/** An account becomes verified when the owner checked its QR and an ACTIVE integration (valid webhook seen) covers it. */
export async function verifyAccountIfIntegrationActive(db: DbOrTx, orgId: string, accountId: string, now: Date): Promise<void> {
  await db
    .update(storePaymentAccounts)
    .set({ verifiedAt: now, updatedAt: now })
    .where(and(
      eq(storePaymentAccounts.orgId, orgId),
      eq(storePaymentAccounts.id, accountId),
      isNotNull(storePaymentAccounts.qrCheckedAt),
      isNull(storePaymentAccounts.verifiedAt),
      exists(
        db
          .select({ one: sql`1` })
          .from(integrationAccounts)
          .innerJoin(sepayIntegrations, and(
            eq(sepayIntegrations.orgId, integrationAccounts.orgId),
            eq(sepayIntegrations.id, integrationAccounts.integrationId),
          ))
          .where(and(
            eq(integrationAccounts.paymentAccountId, accountId),
            eq(sepayIntegrations.status, 'ACTIVE'),
            isNotNull(sepayIntegrations.lastValidWebhookAt),
          )),
      ),
    ))
}
```

- [ ] **Step 4: Viết route handlers (mỏng)**

`server/api/stores/[storeId]/payment-accounts/index.get.ts`:

```ts
import { getRouterParam, setHeader } from 'h3'
import { requireStoreOwner } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { getPaymentAccount } from '../../../../services/payments/accounts'
import { defineApiHandler } from '../../../../utils/api-handler'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  setHeader(event, 'cache-control', 'no-store')
  return { account: await getPaymentAccount(getDb(), ctx) }
})
```

`server/api/stores/[storeId]/payment-accounts/index.post.ts`:

```ts
import { getRouterParam, setHeader, setResponseStatus } from 'h3'
import { paymentAccountInputSchema } from '#shared/schemas/payment'
import { requireStoreOwner } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { createPaymentAccount } from '../../../../services/payments/accounts'
import { defineApiHandler } from '../../../../utils/api-handler'
import { parseBody } from '../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const input = await parseBody(event, paymentAccountInputSchema)
  const account = await createPaymentAccount(getDb(), ctx, input)
  setHeader(event, 'cache-control', 'no-store')
  setResponseStatus(event, 201)
  return account
})
```

`server/api/stores/[storeId]/payment-accounts/[accountId]/index.patch.ts`:

```ts
import { getRouterParam, setHeader } from 'h3'
import { paymentAccountPatchSchema } from '#shared/schemas/payment'
import { requireStoreOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { updatePaymentAccount } from '../../../../../services/payments/accounts'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { requireUuidParam } from '../../../../../utils/ids'
import { parseBody } from '../../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const accountId = requireUuidParam(event, 'accountId')
  const patch = await parseBody(event, paymentAccountPatchSchema)
  setHeader(event, 'cache-control', 'no-store')
  return updatePaymentAccount(getDb(), ctx, accountId, patch)
})
```

`server/api/stores/[storeId]/payment-accounts/[accountId]/check.post.ts`:

```ts
import { getRouterParam, setHeader } from 'h3'
import { requireStoreOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { checkPaymentAccount } from '../../../../../services/payments/accounts'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { requireUuidParam } from '../../../../../utils/ids'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const accountId = requireUuidParam(event, 'accountId')
  setHeader(event, 'cache-control', 'no-store')
  return checkPaymentAccount(getDb(), ctx, accountId)
})
```

`server/api/stores/[storeId]/payment-accounts/[accountId]/confirm-qr.post.ts`:

```ts
import { getRouterParam, setHeader } from 'h3'
import { requireStoreOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { confirmAccountQr } from '../../../../../services/payments/accounts'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { requireUuidParam } from '../../../../../utils/ids'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const accountId = requireUuidParam(event, 'accountId')
  setHeader(event, 'cache-control', 'no-store')
  return confirmAccountQr(getDb(), ctx, accountId)
})
```

- [ ] **Step 5: Chạy test và typecheck**

Run: `npm run test:integration -- tests/integration/payment-accounts.test.ts && npm run typecheck`
Expected: PASS; typecheck không lỗi (nếu `requireUuidParam` nằm ở `server/utils/params.ts` thay vì `ids.ts`, sửa đường dẫn import ở ba route `[accountId]`).

- [ ] **Step 6: Commit**

```bash
git add server/services/payments/accounts.ts server/api/stores tests/integration/payment-accounts.test.ts
git commit -m "feat(payment-setup): add owner payment account service with QR check flow" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: Service SePay integration (secret mã hoá, liên kết, kích hoạt) + routes (owner org)

**Files:**
- Create: `server/services/payments/integrations.ts`, `server/services/payments/integration-secrets.ts`, `server/api/organizations/[orgId]/sepay-integrations/index.get.ts`, `server/api/organizations/[orgId]/sepay-integrations/index.post.ts`, `server/api/organizations/[orgId]/sepay-integrations/[integrationId]/index.get.ts`, `server/api/organizations/[orgId]/sepay-integrations/[integrationId]/secret.put.ts`, `server/api/organizations/[orgId]/sepay-integrations/[integrationId]/accounts.post.ts`, `server/api/organizations/[orgId]/sepay-integrations/[integrationId]/activate.post.ts`, `tests/integration/payment-integrations.test.ts`, `tests/unit/server/app-base-url.test.ts`
- Modify: `server/utils/env.ts`

**Interfaces:**
- Consumes: Task 1–5; `encryptSecret`, `decryptSecret` (PR3); `generateToken` (PR2); `requireOrgOwner` (PR1: `Promise<{ orgId, userId }>`); `verifyAccountIfIntegrationActive` (Task 5); `captureConsole`, `expectNoneOf` (Task 4).
- Produces (UI Task 11, PR6 dùng; giữ nguyên tên):
  - `getAppBaseUrl(): string` (`server/utils/env.ts`) — `APP_BASE_URL` bỏ dấu `/` cuối, mặc định `http://localhost:3000`.
  - `buildWebhookUrl(baseUrl: string, endpointKey: string): string` = `<baseUrl>/api/webhooks/sepay/<endpointKey>`.
  - `createOrGetIntegration(db: Db, orgId: string, input: CreateIntegrationInput, baseUrl: string): Promise<{ integration: SepayIntegrationDto; created: boolean }>` — idempotent theo `(org, environment)` còn mở (bấm đúp không tạo hai).
  - `listIntegrations(db: DbOrTx, orgId: string, baseUrl: string): Promise<SepayIntegrationDto[]>` (không gồm `DISABLED`); `getIntegration(db, orgId, integrationId, baseUrl)` (không thấy → `NOT_FOUND`).
  - `saveIntegrationSecret(db: Db, orgId, integrationId, input: SepaySecretInput, baseUrl, now?): Promise<SepayIntegrationDto>` — mã hoá bằng `encryptSecret`; `apiToken` bỏ trống = giữ token cũ; `DRAFT → TESTING`, trạng thái khác giữ nguyên; `key_version = PAYMENT_SECRET_KEY_VERSION`; integration `DISABLED` → `STATUS_CONFLICT`.
  - `linkAccountToIntegration(db: Db, orgId, integrationId, paymentAccountId, baseUrl, now?): Promise<SepayIntegrationDto>` — tài khoản phải cùng org và `is_active`, nếu không `NOT_FOUND`; idempotent; gọi `verifyAccountIfIntegrationActive`.
  - `activateIntegration(db: Db, orgId, integrationId, baseUrl, now?): Promise<SepayIntegrationDto>` — `TESTING → ACTIVE` chỉ khi `last_valid_webhook_at` khác null **và** có ít nhất một tài khoản liên kết đã QR-check; ngược lại `STATUS_CONFLICT` với `details.reason ∈ {'NOT_TESTING','NO_VALID_WEBHOOK','NO_CHECKED_ACCOUNT'}`; thành công đặt `verified_at` cho các tài khoản liên kết đã QR-check; đã `ACTIVE` thì trả lại như cũ.
  - `loadIntegrationSecrets(db: DbOrTx, integrationId: string): Promise<{ hmacSecret: string | null; apiToken: string | null } | null>` — **đường duy nhất giải mã secret** (PR6 verify HMAC / gọi API đối soát); **không** bao giờ đưa kết quả vào DTO hay log.
  - `findIntegrationByEndpointKey(db: DbOrTx, endpointKey: string): Promise<{ id: string; orgId: string; environment: SepayEnvironment; status: SepayIntegrationStatus } | null>` — bỏ qua `DISABLED`; key sai định dạng (`/^[A-Za-z0-9_-]{32}$/`) trả `null` mà không chạm DB.
  - Routes (`requireOrgOwner`: không phải owner org → 404): `GET/POST /api/organizations/:orgId/sepay-integrations` (POST 201 khi mới, 200 khi trả bản có sẵn); `GET …/:integrationId`; `PUT …/:integrationId/secret`; `POST …/:integrationId/accounts` (body `{ paymentAccountId }`); `POST …/:integrationId/activate`. Response là `SepayIntegrationDto` (khoá cố định, xem test), `Cache-Control: no-store`.

- [ ] **Step 1: Viết unit test thất bại cho `getAppBaseUrl`**

`tests/unit/server/app-base-url.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAppBaseUrl } from '../../../server/utils/env'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getAppBaseUrl', () => {
  it('returns APP_BASE_URL without a trailing slash', () => {
    vi.stubEnv('APP_BASE_URL', 'https://zeno.vn//')
    expect(getAppBaseUrl()).toBe('https://zeno.vn')
  })

  it('falls back to localhost when unset or empty', () => {
    vi.stubEnv('APP_BASE_URL', '')
    expect(getAppBaseUrl()).toBe('http://localhost:3000')
  })
})
```

- [ ] **Step 2: Viết integration test thất bại**

`tests/integration/payment-integrations.test.ts`:

```ts
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { integrationAccounts, sepayIntegrations, storePaymentAccounts } from '../../server/db/schema'
import {
  activateIntegration,
  buildWebhookUrl,
  createOrGetIntegration,
  getIntegration,
  linkAccountToIntegration,
  listIntegrations,
  saveIntegrationSecret,
} from '../../server/services/payments/integrations'
import { findIntegrationByEndpointKey, loadIntegrationSecrets } from '../../server/services/payments/integration-secrets'
import { decryptSecret } from '../../server/utils/crypto'
import { resetDb } from '../support/db'
import { createTenant } from '../support/fixtures'
import { captureConsole, expectNoneOf } from '../support/leaks'
import { createIntegration, createPaymentAccount } from '../support/payment-fixtures'

const BASE = 'https://zeno.example'
const SECRET = 'SENTINEL_hmac_secret_0123456789'
const TOKEN = 'SENTINEL_api_token_0123456789'
const defaults = { name: 'SePay', environment: 'live' } as const

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('createOrGetIntegration', () => {
  it('creates a DRAFT integration with a 32-char endpoint key and no secret', async () => {
    const t = await createTenant('i1')
    const { integration, created } = await createOrGetIntegration(getDb(), t.org.id, defaults, BASE)
    expect(created).toBe(true)
    expect(integration).toMatchObject({ status: 'DRAFT', environment: 'live', hasSecret: false, hasApiToken: false, accountIds: [] })
    expect(integration.webhookUrl).toMatch(/^https:\/\/zeno\.example\/api\/webhooks\/sepay\/[A-Za-z0-9_-]{32}$/)
  })

  it('is idempotent per org and environment (double click)', async () => {
    const t = await createTenant('i2')
    const first = await createOrGetIntegration(getDb(), t.org.id, defaults, BASE)
    const second = await createOrGetIntegration(getDb(), t.org.id, defaults, BASE)
    expect(second.created).toBe(false)
    expect(second.integration.id).toBe(first.integration.id)
    const concurrent = await Promise.all(Array.from({ length: 4 }, () => createOrGetIntegration(getDb(), t.org.id, defaults, BASE)))
    expect(new Set(concurrent.map(r => r.integration.id))).toEqual(new Set([first.integration.id]))
    expect(await getDb().select().from(sepayIntegrations)).toHaveLength(1)
  })

  it('creates a separate integration for another environment', async () => {
    const t = await createTenant('i3')
    await createOrGetIntegration(getDb(), t.org.id, defaults, BASE)
    const test = await createOrGetIntegration(getDb(), t.org.id, { name: 'SePay test', environment: 'test' }, BASE)
    expect(test.created).toBe(true)
    expect(await listIntegrations(getDb(), t.org.id, BASE)).toHaveLength(2)
  })
})

describe('buildWebhookUrl', () => {
  it('joins base and key', () => {
    expect(buildWebhookUrl('https://a.vn', 'KEY')).toBe('https://a.vn/api/webhooks/sepay/KEY')
  })
})

describe('saveIntegrationSecret', () => {
  it('stores the secret encrypted, moves DRAFT to TESTING and exposes only flags', async () => {
    const t = await createTenant('s1')
    const { integration } = await createOrGetIntegration(getDb(), t.org.id, defaults, BASE)
    const dto = await saveIntegrationSecret(getDb(), t.org.id, integration.id, { hmacSecret: SECRET, apiToken: TOKEN }, BASE)

    expect(dto).toMatchObject({ status: 'TESTING', hasSecret: true, hasApiToken: true })
    expect(Object.keys(dto).sort()).toEqual([
      'accountIds', 'environment', 'hasApiToken', 'hasSecret', 'id', 'lastValidWebhookAt',
      'name', 'secretUpdatedAt', 'status', 'updatedAt', 'webhookUrl',
    ])
    expectNoneOf(JSON.stringify(dto), [SECRET, TOKEN])

    const [row] = await getDb().select().from(sepayIntegrations).where(eq(sepayIntegrations.id, integration.id))
    expect(row!.encryptedHmacSecret).not.toContain(SECRET)
    expect(row!.encryptedHmacSecret).toMatch(/^v1\./)
    expect(decryptSecret(row!.encryptedHmacSecret!)).toBe(SECRET)
    expect(decryptSecret(row!.encryptedApiToken!)).toBe(TOKEN)
    expect(row!.keyVersion).toBe(1)
  })

  it('rotates by overwriting, keeps the old API token when none is sent, keeps an ACTIVE status', async () => {
    const t = await createTenant('s2')
    const { integration } = await createOrGetIntegration(getDb(), t.org.id, defaults, BASE)
    await saveIntegrationSecret(getDb(), t.org.id, integration.id, { hmacSecret: SECRET, apiToken: TOKEN }, BASE)
    await getDb().update(sepayIntegrations).set({ status: 'ACTIVE' }).where(eq(sepayIntegrations.id, integration.id))

    const dto = await saveIntegrationSecret(getDb(), t.org.id, integration.id, { hmacSecret: 'SENTINEL_new_secret_9876543210' }, BASE)
    expect(dto.status).toBe('ACTIVE')
    const secrets = await loadIntegrationSecrets(getDb(), integration.id)
    expect(secrets).toEqual({ hmacSecret: 'SENTINEL_new_secret_9876543210', apiToken: TOKEN })
  })

  it('does not find an integration of another org and writes nothing', async () => {
    const a = await createTenant('s3a')
    const b = await createTenant('s3b')
    const { integration } = await createOrGetIntegration(getDb(), b.org.id, defaults, BASE)
    await expect(saveIntegrationSecret(getDb(), a.org.id, integration.id, { hmacSecret: SECRET }, BASE))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
    const [row] = await getDb().select().from(sepayIntegrations).where(eq(sepayIntegrations.id, integration.id))
    expect(row!.encryptedHmacSecret).toBeNull()
  })

  it('refuses a disabled integration', async () => {
    const t = await createTenant('s4')
    const row = await createIntegration(t.org, { status: 'DISABLED' })
    await expect(saveIntegrationSecret(getDb(), t.org.id, row.id, { hmacSecret: SECRET }, BASE))
      .rejects.toMatchObject({ code: 'STATUS_CONFLICT' })
  })

  it('never writes a secret, ciphertext or endpoint key to the console (Review Focus #5)', async () => {
    const t = await createTenant('s5')
    const { integration } = await createOrGetIntegration(getDb(), t.org.id, defaults, BASE)
    const capture = captureConsole()
    try {
      await saveIntegrationSecret(getDb(), t.org.id, integration.id, { hmacSecret: SECRET, apiToken: TOKEN }, BASE)
      await saveIntegrationSecret(getDb(), t.org.id, '00000000-0000-4000-8000-000000000000', { hmacSecret: SECRET }, BASE).catch(() => undefined)
      await activateIntegration(getDb(), t.org.id, integration.id, BASE).catch(() => undefined)
    }
    finally {
      capture.restore()
    }
    const [row] = await getDb().select().from(sepayIntegrations).where(eq(sepayIntegrations.id, integration.id))
    expectNoneOf(capture.text(), [SECRET, TOKEN, row!.encryptedHmacSecret!, row!.webhookEndpointKey])
  })
})

describe('linkAccountToIntegration', () => {
  it('links a store account of the same org, idempotently', async () => {
    const t = await createTenant('l1')
    const account = await createPaymentAccount(t.store)
    const { integration } = await createOrGetIntegration(getDb(), t.org.id, defaults, BASE)
    const dto = await linkAccountToIntegration(getDb(), t.org.id, integration.id, account.id, BASE)
    expect(dto.accountIds).toEqual([account.id])
    await linkAccountToIntegration(getDb(), t.org.id, integration.id, account.id, BASE)
    expect(await getDb().select().from(integrationAccounts)).toHaveLength(1)
  })

  it('refuses an account of another org and an unknown id', async () => {
    const a = await createTenant('l2a')
    const b = await createTenant('l2b')
    const accountB = await createPaymentAccount(b.store)
    const { integration } = await createOrGetIntegration(getDb(), a.org.id, defaults, BASE)
    await expect(linkAccountToIntegration(getDb(), a.org.id, integration.id, accountB.id, BASE)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(linkAccountToIntegration(getDb(), a.org.id, integration.id, '00000000-0000-4000-8000-000000000000', BASE)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('refuses an inactive account', async () => {
    const t = await createTenant('l3')
    const account = await createPaymentAccount(t.store, { isActive: false })
    const { integration } = await createOrGetIntegration(getDb(), t.org.id, defaults, BASE)
    await expect(linkAccountToIntegration(getDb(), t.org.id, integration.id, account.id, BASE)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('activateIntegration', () => {
  async function testing(label: string, opts: { checked?: boolean, webhook?: boolean } = {}) {
    const t = await createTenant(label)
    const account = await createPaymentAccount(t.store, opts.checked ? { qrCheckedAt: new Date() } : {})
    const { integration } = await createOrGetIntegration(getDb(), t.org.id, defaults, BASE)
    await saveIntegrationSecret(getDb(), t.org.id, integration.id, { hmacSecret: SECRET }, BASE)
    await linkAccountToIntegration(getDb(), t.org.id, integration.id, account.id, BASE)
    if (opts.webhook) await getDb().update(sepayIntegrations).set({ lastValidWebhookAt: new Date() }).where(eq(sepayIntegrations.id, integration.id))
    return { t, account, integration }
  }

  it('refuses a DRAFT integration', async () => {
    const t = await createTenant('a1')
    const { integration } = await createOrGetIntegration(getDb(), t.org.id, defaults, BASE)
    await expect(activateIntegration(getDb(), t.org.id, integration.id, BASE))
      .rejects.toMatchObject({ code: 'STATUS_CONFLICT', details: { reason: 'NOT_TESTING' } })
  })

  it('refuses until a valid webhook has arrived', async () => {
    const { t, integration } = await testing('a2', { checked: true })
    await expect(activateIntegration(getDb(), t.org.id, integration.id, BASE))
      .rejects.toMatchObject({ code: 'STATUS_CONFLICT', details: { reason: 'NO_VALID_WEBHOOK' } })
  })

  it('refuses when no linked account has passed the QR check', async () => {
    const { t, integration } = await testing('a3', { webhook: true })
    await expect(activateIntegration(getDb(), t.org.id, integration.id, BASE))
      .rejects.toMatchObject({ code: 'STATUS_CONFLICT', details: { reason: 'NO_CHECKED_ACCOUNT' } })
  })

  it('activates and verifies the checked accounts', async () => {
    const { t, account, integration } = await testing('a4', { checked: true, webhook: true })
    const now = new Date('2026-11-01T05:00:00Z')
    const dto = await activateIntegration(getDb(), t.org.id, integration.id, BASE, now)
    expect(dto.status).toBe('ACTIVE')
    const [row] = await getDb().select().from(storePaymentAccounts).where(eq(storePaymentAccounts.id, account.id))
    expect(row!.verifiedAt?.toISOString()).toBe(now.toISOString())
  })

  it('is idempotent once ACTIVE', async () => {
    const { t, integration } = await testing('a5', { checked: true, webhook: true })
    await activateIntegration(getDb(), t.org.id, integration.id, BASE)
    expect((await activateIntegration(getDb(), t.org.id, integration.id, BASE)).status).toBe('ACTIVE')
  })

  it('does not find an integration of another org', async () => {
    const a = await createTenant('a6a')
    const { integration } = await testing('a6b', { checked: true, webhook: true })
    await expect(activateIntegration(getDb(), a.org.id, integration.id, BASE)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('getIntegration / listIntegrations', () => {
  it('hides disabled integrations from the list and scopes by org', async () => {
    const a = await createTenant('g1a')
    const b = await createTenant('g1b')
    const live = await createIntegration(a.org)
    await createIntegration(a.org, { environment: 'test', status: 'DISABLED' })
    await createIntegration(b.org)
    expect((await listIntegrations(getDb(), a.org.id, BASE)).map(i => i.id)).toEqual([live.id])
    await expect(getIntegration(getDb(), b.org.id, live.id, BASE)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('integration-secrets (for PR6)', () => {
  it('decrypts both secrets, or null when absent', async () => {
    const t = await createTenant('x1')
    const { integration } = await createOrGetIntegration(getDb(), t.org.id, defaults, BASE)
    expect(await loadIntegrationSecrets(getDb(), integration.id)).toEqual({ hmacSecret: null, apiToken: null })
    await saveIntegrationSecret(getDb(), t.org.id, integration.id, { hmacSecret: SECRET }, BASE)
    expect(await loadIntegrationSecrets(getDb(), integration.id)).toEqual({ hmacSecret: SECRET, apiToken: null })
    expect(await loadIntegrationSecrets(getDb(), '00000000-0000-4000-8000-000000000000')).toBeNull()
  })

  it('finds an integration by endpoint key, ignores disabled ones and malformed keys', async () => {
    const t = await createTenant('x2')
    const live = await createIntegration(t.org)
    const dead = await createIntegration(t.org, { environment: 'test', status: 'DISABLED' })
    expect(await findIntegrationByEndpointKey(getDb(), live.webhookEndpointKey)).toEqual({
      id: live.id, orgId: t.org.id, environment: 'live', status: 'DRAFT',
    })
    expect(await findIntegrationByEndpointKey(getDb(), dead.webhookEndpointKey)).toBeNull()
    expect(await findIntegrationByEndpointKey(getDb(), 'short')).toBeNull()
    expect(await findIntegrationByEndpointKey(getDb(), `${live.webhookEndpointKey}%27 OR 1=1`)).toBeNull()
  })
})
```

- [ ] **Step 3: Chạy test để xác nhận thất bại**

Run: `npx vitest run --project unit tests/unit/server/app-base-url.test.ts; npm run test:integration -- tests/integration/payment-integrations.test.ts`
Expected: FAIL — thiếu `getAppBaseUrl` và `server/services/payments/integrations`.

- [ ] **Step 4: Viết `getAppBaseUrl`**

Thêm vào cuối `server/utils/env.ts`:

```ts
export function getAppBaseUrl(): string {
  return (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')
}
```

- [ ] **Step 5: Viết service integration**

`server/services/payments/integrations.ts`:

```ts
import { and, asc, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm'
import type { CreateIntegrationInput, SepaySecretInput } from '#shared/schemas/payment'
import type { SepayIntegrationDto } from '#shared/types/payment'
import type { Db, DbOrTx } from '../../db/client'
import { isUniqueViolation } from '../../db/errors'
import { integrationAccounts, sepayIntegrations, storePaymentAccounts } from '../../db/schema'
import { encryptSecret } from '../../utils/crypto'
import { AppError } from '../../utils/errors'
import { generateToken } from '../../utils/tokens'
import { verifyAccountIfIntegrationActive } from './accounts'
import { PAYMENT_SECRET_KEY_VERSION } from './constants'

type IntegrationRow = typeof sepayIntegrations.$inferSelect

const notFound = () => new AppError('NOT_FOUND', 'Không tìm thấy')

export function buildWebhookUrl(baseUrl: string, endpointKey: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/webhooks/sepay/${endpointKey}`
}

/** The only place an integration row becomes an API shape: an explicit whitelist, never a spread of the row. */
async function toDto(db: DbOrTx, row: IntegrationRow, baseUrl: string): Promise<SepayIntegrationDto> {
  const links = await db
    .select({ id: integrationAccounts.paymentAccountId })
    .from(integrationAccounts)
    .where(and(eq(integrationAccounts.orgId, row.orgId), eq(integrationAccounts.integrationId, row.id)))
    .orderBy(asc(integrationAccounts.createdAt))
  return {
    id: row.id,
    name: row.name,
    environment: row.environment,
    status: row.status,
    hasSecret: row.encryptedHmacSecret !== null,
    hasApiToken: row.encryptedApiToken !== null,
    secretUpdatedAt: row.secretUpdatedAt?.toISOString() ?? null,
    lastValidWebhookAt: row.lastValidWebhookAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    webhookUrl: buildWebhookUrl(baseUrl, row.webhookEndpointKey),
    accountIds: links.map(link => link.id),
  }
}

async function lockIntegration(db: DbOrTx, orgId: string, integrationId: string): Promise<IntegrationRow> {
  const [row] = await db
    .select()
    .from(sepayIntegrations)
    .where(and(eq(sepayIntegrations.orgId, orgId), eq(sepayIntegrations.id, integrationId)))
    .for('update')
  if (!row) throw notFound()
  return row
}

async function findOpen(db: DbOrTx, orgId: string, environment: IntegrationRow['environment']): Promise<IntegrationRow | undefined> {
  const [row] = await db
    .select()
    .from(sepayIntegrations)
    .where(and(
      eq(sepayIntegrations.orgId, orgId),
      eq(sepayIntegrations.environment, environment),
      ne(sepayIntegrations.status, 'DISABLED'),
    ))
    .limit(1)
  return row
}

export async function createOrGetIntegration(
  db: Db,
  orgId: string,
  input: CreateIntegrationInput,
  baseUrl: string,
): Promise<{ integration: SepayIntegrationDto, created: boolean }> {
  const existing = await findOpen(db, orgId, input.environment)
  if (existing) return { integration: await toDto(db, existing, baseUrl), created: false }
  try {
    const [row] = await db
      .insert(sepayIntegrations)
      .values({ orgId, name: input.name, environment: input.environment, webhookEndpointKey: generateToken(24) })
      .returning()
    return { integration: await toDto(db, row!, baseUrl), created: true }
  }
  catch (err) {
    if (!isUniqueViolation(err, 'sepay_integrations_org_env_open_uq')) throw err
    const winner = await findOpen(db, orgId, input.environment)
    if (!winner) throw err
    return { integration: await toDto(db, winner, baseUrl), created: false }
  }
}

export async function listIntegrations(db: DbOrTx, orgId: string, baseUrl: string): Promise<SepayIntegrationDto[]> {
  const rows = await db
    .select()
    .from(sepayIntegrations)
    .where(and(eq(sepayIntegrations.orgId, orgId), ne(sepayIntegrations.status, 'DISABLED')))
    .orderBy(asc(sepayIntegrations.createdAt))
  return Promise.all(rows.map(row => toDto(db, row, baseUrl)))
}

export async function getIntegration(db: DbOrTx, orgId: string, integrationId: string, baseUrl: string): Promise<SepayIntegrationDto> {
  const [row] = await db
    .select()
    .from(sepayIntegrations)
    .where(and(eq(sepayIntegrations.orgId, orgId), eq(sepayIntegrations.id, integrationId)))
  if (!row) throw notFound()
  return toDto(db, row, baseUrl)
}

export async function saveIntegrationSecret(
  db: Db,
  orgId: string,
  integrationId: string,
  input: SepaySecretInput,
  baseUrl: string,
  now = new Date(),
): Promise<SepayIntegrationDto> {
  return db.transaction(async (tx) => {
    const row = await lockIntegration(tx, orgId, integrationId)
    if (row.status === 'DISABLED') throw new AppError('STATUS_CONFLICT', 'Kết nối SePay này đã bị tắt')
    const [updated] = await tx
      .update(sepayIntegrations)
      .set({
        encryptedHmacSecret: encryptSecret(input.hmacSecret),
        ...(input.apiToken === undefined ? {} : { encryptedApiToken: encryptSecret(input.apiToken) }),
        keyVersion: PAYMENT_SECRET_KEY_VERSION,
        status: row.status === 'DRAFT' ? 'TESTING' : row.status,
        secretUpdatedAt: now,
        updatedAt: now,
      })
      .where(eq(sepayIntegrations.id, row.id))
      .returning()
    return toDto(tx, updated!, baseUrl)
  })
}

export async function linkAccountToIntegration(
  db: Db,
  orgId: string,
  integrationId: string,
  paymentAccountId: string,
  baseUrl: string,
  now = new Date(),
): Promise<SepayIntegrationDto> {
  return db.transaction(async (tx) => {
    const row = await lockIntegration(tx, orgId, integrationId)
    if (row.status === 'DISABLED') throw new AppError('STATUS_CONFLICT', 'Kết nối SePay này đã bị tắt')
    const [account] = await tx
      .select({ id: storePaymentAccounts.id })
      .from(storePaymentAccounts)
      .where(and(
        eq(storePaymentAccounts.orgId, orgId),
        eq(storePaymentAccounts.id, paymentAccountId),
        eq(storePaymentAccounts.isActive, true),
      ))
    if (!account) throw notFound()
    await tx.insert(integrationAccounts).values({ orgId, integrationId: row.id, paymentAccountId: account.id }).onConflictDoNothing()
    await verifyAccountIfIntegrationActive(tx, orgId, account.id, now)
    return toDto(tx, row, baseUrl)
  })
}

export async function activateIntegration(
  db: Db,
  orgId: string,
  integrationId: string,
  baseUrl: string,
  now = new Date(),
): Promise<SepayIntegrationDto> {
  return db.transaction(async (tx) => {
    const row = await lockIntegration(tx, orgId, integrationId)
    if (row.status === 'ACTIVE') return toDto(tx, row, baseUrl)
    if (row.status !== 'TESTING') {
      throw new AppError('STATUS_CONFLICT', 'Cần lưu Secret Key trước khi bật', { reason: 'NOT_TESTING' })
    }
    if (!row.lastValidWebhookAt) {
      throw new AppError('STATUS_CONFLICT', 'Chưa nhận được giao dịch hợp lệ nào từ SePay', { reason: 'NO_VALID_WEBHOOK' })
    }
    const checked = await tx
      .select({ id: storePaymentAccounts.id })
      .from(integrationAccounts)
      .innerJoin(storePaymentAccounts, and(
        eq(storePaymentAccounts.orgId, integrationAccounts.orgId),
        eq(storePaymentAccounts.id, integrationAccounts.paymentAccountId),
      ))
      .where(and(
        eq(integrationAccounts.orgId, orgId),
        eq(integrationAccounts.integrationId, row.id),
        eq(storePaymentAccounts.isActive, true),
        isNotNull(storePaymentAccounts.qrCheckedAt),
      ))
    if (checked.length === 0) {
      throw new AppError('STATUS_CONFLICT', 'Chưa có tài khoản nào đã kiểm tra mã QR', { reason: 'NO_CHECKED_ACCOUNT' })
    }
    const [updated] = await tx
      .update(sepayIntegrations)
      .set({ status: 'ACTIVE', activatedAt: now, updatedAt: now })
      .where(eq(sepayIntegrations.id, row.id))
      .returning()
    await tx
      .update(storePaymentAccounts)
      .set({ verifiedAt: now, updatedAt: now })
      .where(and(
        eq(storePaymentAccounts.orgId, orgId),
        inArray(storePaymentAccounts.id, checked.map(account => account.id)),
        isNull(storePaymentAccounts.verifiedAt),
      ))
    return toDto(tx, updated!, baseUrl)
  })
}
```

`server/services/payments/integration-secrets.ts`:

```ts
import { and, eq, ne } from 'drizzle-orm'
import type { SepayEnvironment, SepayIntegrationStatus } from '#shared/payment'
import type { DbOrTx } from '../../db/client'
import { sepayIntegrations } from '../../db/schema'
import { decryptSecret } from '../../utils/crypto'

const ENDPOINT_KEY = /^[A-Za-z0-9_-]{32}$/

/** The only code path that decrypts SePay secrets. Never put the result in a DTO, a log line or an error. */
export async function loadIntegrationSecrets(
  db: DbOrTx,
  integrationId: string,
): Promise<{ hmacSecret: string | null, apiToken: string | null } | null> {
  const [row] = await db
    .select({ hmac: sepayIntegrations.encryptedHmacSecret, token: sepayIntegrations.encryptedApiToken })
    .from(sepayIntegrations)
    .where(eq(sepayIntegrations.id, integrationId))
  if (!row) return null
  return {
    hmacSecret: row.hmac === null ? null : decryptSecret(row.hmac),
    apiToken: row.token === null ? null : decryptSecret(row.token),
  }
}

export async function findIntegrationByEndpointKey(
  db: DbOrTx,
  endpointKey: string,
): Promise<{ id: string, orgId: string, environment: SepayEnvironment, status: SepayIntegrationStatus } | null> {
  if (!ENDPOINT_KEY.test(endpointKey)) return null
  const [row] = await db
    .select({
      id: sepayIntegrations.id,
      orgId: sepayIntegrations.orgId,
      environment: sepayIntegrations.environment,
      status: sepayIntegrations.status,
    })
    .from(sepayIntegrations)
    .where(and(eq(sepayIntegrations.webhookEndpointKey, endpointKey), ne(sepayIntegrations.status, 'DISABLED')))
  return row ?? null
}
```

- [ ] **Step 6: Viết route handlers**

`server/api/organizations/[orgId]/sepay-integrations/index.get.ts`:

```ts
import { getRouterParam, setHeader } from 'h3'
import { requireOrgOwner } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { listIntegrations } from '../../../../services/payments/integrations'
import { defineApiHandler } from '../../../../utils/api-handler'
import { getAppBaseUrl } from '../../../../utils/env'

export default defineApiHandler(async (event) => {
  const { orgId } = await requireOrgOwner(event, getRouterParam(event, 'orgId'))
  setHeader(event, 'cache-control', 'no-store')
  return { integrations: await listIntegrations(getDb(), orgId, getAppBaseUrl()) }
})
```

`server/api/organizations/[orgId]/sepay-integrations/index.post.ts`:

```ts
import { getRouterParam, readBody, setHeader, setResponseStatus } from 'h3'
import { createIntegrationInputSchema } from '#shared/schemas/payment'
import { requireOrgOwner } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { createOrGetIntegration } from '../../../../services/payments/integrations'
import { defineApiHandler } from '../../../../utils/api-handler'
import { getAppBaseUrl } from '../../../../utils/env'
import { parseWith } from '../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const { orgId } = await requireOrgOwner(event, getRouterParam(event, 'orgId'))
  const raw = await readBody(event).catch(() => undefined)
  const input = parseWith(createIntegrationInputSchema, raw ?? {})
  const { integration, created } = await createOrGetIntegration(getDb(), orgId, input, getAppBaseUrl())
  setHeader(event, 'cache-control', 'no-store')
  setResponseStatus(event, created ? 201 : 200)
  return integration
})
```

`server/api/organizations/[orgId]/sepay-integrations/[integrationId]/index.get.ts`:

```ts
import { getRouterParam, setHeader } from 'h3'
import { requireOrgOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { getIntegration } from '../../../../../services/payments/integrations'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { getAppBaseUrl } from '../../../../../utils/env'
import { requireUuidParam } from '../../../../../utils/ids'

export default defineApiHandler(async (event) => {
  const { orgId } = await requireOrgOwner(event, getRouterParam(event, 'orgId'))
  const integrationId = requireUuidParam(event, 'integrationId')
  setHeader(event, 'cache-control', 'no-store')
  return getIntegration(getDb(), orgId, integrationId, getAppBaseUrl())
})
```

`server/api/organizations/[orgId]/sepay-integrations/[integrationId]/secret.put.ts`:

```ts
import { getRouterParam, setHeader } from 'h3'
import { sepaySecretInputSchema } from '#shared/schemas/payment'
import { requireOrgOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { saveIntegrationSecret } from '../../../../../services/payments/integrations'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { getAppBaseUrl } from '../../../../../utils/env'
import { requireUuidParam } from '../../../../../utils/ids'
import { parseBody } from '../../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const { orgId } = await requireOrgOwner(event, getRouterParam(event, 'orgId'))
  const integrationId = requireUuidParam(event, 'integrationId')
  const input = await parseBody(event, sepaySecretInputSchema)
  setHeader(event, 'cache-control', 'no-store')
  return saveIntegrationSecret(getDb(), orgId, integrationId, input, getAppBaseUrl())
})
```

`server/api/organizations/[orgId]/sepay-integrations/[integrationId]/accounts.post.ts`:

```ts
import { getRouterParam, setHeader } from 'h3'
import { linkAccountInputSchema } from '#shared/schemas/payment'
import { requireOrgOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { linkAccountToIntegration } from '../../../../../services/payments/integrations'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { getAppBaseUrl } from '../../../../../utils/env'
import { requireUuidParam } from '../../../../../utils/ids'
import { parseBody } from '../../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const { orgId } = await requireOrgOwner(event, getRouterParam(event, 'orgId'))
  const integrationId = requireUuidParam(event, 'integrationId')
  const input = await parseBody(event, linkAccountInputSchema)
  setHeader(event, 'cache-control', 'no-store')
  return linkAccountToIntegration(getDb(), orgId, integrationId, input.paymentAccountId, getAppBaseUrl())
})
```

`server/api/organizations/[orgId]/sepay-integrations/[integrationId]/activate.post.ts`:

```ts
import { getRouterParam, setHeader } from 'h3'
import { requireOrgOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { activateIntegration } from '../../../../../services/payments/integrations'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { getAppBaseUrl } from '../../../../../utils/env'
import { requireUuidParam } from '../../../../../utils/ids'

export default defineApiHandler(async (event) => {
  const { orgId } = await requireOrgOwner(event, getRouterParam(event, 'orgId'))
  const integrationId = requireUuidParam(event, 'integrationId')
  setHeader(event, 'cache-control', 'no-store')
  return activateIntegration(getDb(), orgId, integrationId, getAppBaseUrl())
})
```

- [ ] **Step 7: Chạy test và typecheck**

Run: `npx vitest run --project unit tests/unit/server/app-base-url.test.ts && npm run test:integration -- tests/integration/payment-integrations.test.ts tests/integration/payment-accounts.test.ts && npm run typecheck`
Expected: PASS (kể cả bốn request `createOrGetIntegration` đồng thời); typecheck sạch.

- [ ] **Step 8: Commit**

```bash
git add server/services/payments/integrations.ts server/services/payments/integration-secrets.ts server/api/organizations server/utils/env.ts tests/integration/payment-integrations.test.ts tests/unit/server/app-base-url.test.ts
git commit -m "feat(payment-setup): add encrypted SePay integration service and owner routes" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 7: Service payment attempt — chọn tài khoản nhận, TTL, mã không trùng, tạo lại mã

**Files:**
- Create: `server/services/payments/attempts.ts`, `tests/integration/payment-attempts.test.ts`

**Interfaces:**
- Consumes: Task 1–3; `orders`, `stores` (PR1/PR3 schema); `hashToken` (PR2); `AppError`; `PaymentQr` (`#shared/types/order`, PR3); `setupBankQr`, `createPaymentAccount`, `ownerCtx` (Task 3); `insertRawOrder` (PR3).
- Produces (Task 8–10 dùng; PR6 dùng `paymentAttempts` + `toPaymentQr`):
  - `interface StoreScope { orgId: string; storeId: string }`, `interface OrderRef extends StoreScope { orderId: string }`, `interface BankQrReceiver { accountId: string; bankCode: string; accountNumber: string; vaNumber: string | null; accountHolder: string }`, `interface AttemptDeps { now?: Date; generatePaymentCode?: () => string }`, `interface CreateAttemptInput extends OrderRef { amountVnd: number; receiver: BankQrReceiver }`.
  - `findBankQrReceiver(db: DbOrTx, scope: StoreScope): Promise<BankQrReceiver | null>` — tài khoản `is_active`, có `qr_checked_at` **và** `verified_at`, gắn với integration `ACTIVE`.
  - `requireBankQrReceiver(db: DbOrTx, scope: StoreScope): Promise<BankQrReceiver>` — không có → `AppError('PAYMENT_METHOD_UNAVAILABLE', 'Cửa hàng chưa bật thanh toán chuyển khoản')`.
  - `createPaymentAttempt(db: DbOrTx, input: CreateAttemptInput, deps?: AttemptDeps): Promise<PaymentQr>` — TTL = `stores.payment_ttl_minutes`, chụp bản sao tài khoản, sinh mã `ZO…` và thử lại tối đa `MAX_PAYMENT_CODE_ATTEMPTS` lần khi trùng (dùng `ON CONFLICT DO NOTHING` nên không làm hỏng transaction của người gọi); số tiền < 1 → `PAYMENT_METHOD_UNAVAILABLE`; hết lần thử → `INTERNAL`.
  - `toPaymentQr(row: typeof paymentAttempts.$inferSelect): PaymentQr` — `accountNumber` trong QR là `vaNumber ?? accountNumber`.
  - `getActiveQrForOrder(db: DbOrTx, ref: { storeId: string; orderId: string }, now?: Date): Promise<PaymentQr | null>` — attempt `PENDING` còn hạn (`expires_at > now`), mới nhất; không có → `null` (UI hiểu là "đã hết hạn, tạo mã mới").
  - `findOrderRefByGuestToken(db: DbOrTx, token: string): Promise<OrderRef | null>` — token sai định dạng (`/^[A-Za-z0-9_-]{43}$/`) trả `null` mà không chạm DB.
  - `createReplacementAttempt(db: Db, ref: OrderRef, deps?: AttemptDeps): Promise<{ qr: PaymentQr; created: boolean }>` — khoá dòng đơn `FOR UPDATE`; đơn phải `BANK_QR` + `AWAITING_PAYMENT` + `PENDING` (nếu không `STATUS_CONFLICT`); còn attempt hiệu lực thì trả lại nó (`created = false`); ngược lại chuyển mọi attempt `PENDING` còn lại sang `SUPERSEDED` (attempt `EXPIRED` giữ nguyên), kiểm tra tài khoản nhận (`PAYMENT_METHOD_UNAVAILABLE` nếu không còn) rồi tạo attempt mới với số tiền lấy từ `orders.total_vnd`.

- [ ] **Step 1: Viết integration test thất bại**

`tests/integration/payment-attempts.test.ts`:

```ts
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { orders, paymentAttempts, sepayIntegrations, storePaymentAccounts, stores } from '../../server/db/schema'
import {
  createPaymentAttempt,
  createReplacementAttempt,
  findBankQrReceiver,
  findOrderRefByGuestToken,
  getActiveQrForOrder,
  requireBankQrReceiver,
} from '../../server/services/payments/attempts'
import { PAYMENT_CODE_PATTERN } from '../../server/services/payments/payment-code'
import { generateToken, hashToken } from '../../server/utils/tokens'
import { insertRawOrder } from '../support/checkout-fixtures'
import { resetDb } from '../support/db'
import { createTenant } from '../support/fixtures'
import { createIntegration, createPaymentAccount, setupBankQr } from '../support/payment-fixtures'

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

type Tenant = Awaited<ReturnType<typeof createTenant>>
const scopeOf = (t: Tenant) => ({ orgId: t.org.id, storeId: t.store.id })

function awaitingOrder(t: Tenant, over: Partial<typeof orders.$inferInsert> = {}) {
  return insertRawOrder(t.store, {
    paymentMethod: 'BANK_QR', status: 'AWAITING_PAYMENT', paymentStatus: 'PENDING',
    subtotalVnd: 70_000, totalVnd: 70_000, ...over,
  })
}

async function readyTenant(label: string, opts: Parameters<typeof setupBankQr>[1] = {}) {
  const t = await createTenant(label)
  const setup = await setupBankQr(t.store, opts)
  return { t, ...setup }
}

async function attemptsOf(orderId: string) {
  return getDb().select().from(paymentAttempts).where(eq(paymentAttempts.orderId, orderId)).orderBy(paymentAttempts.createdAt)
}

describe('findBankQrReceiver', () => {
  it('returns the verified account of a store with an ACTIVE integration', async () => {
    const { t, account } = await readyTenant('r1')
    expect(await findBankQrReceiver(getDb(), scopeOf(t))).toEqual({
      accountId: account.id, bankCode: 'VCB', accountNumber: '9988776655', vaNumber: null, accountHolder: 'NGUYEN VAN A',
    })
  })

  it('is null for a store that never set up payments', async () => {
    const t = await createTenant('r2')
    expect(await findBankQrReceiver(getDb(), scopeOf(t))).toBeNull()
    await expect(requireBankQrReceiver(getDb(), scopeOf(t))).rejects.toMatchObject({ code: 'PAYMENT_METHOD_UNAVAILABLE' })
  })

  it('is null while the integration is not ACTIVE, the account is unverified, or it is inactive', async () => {
    const { t, account, integration } = await readyTenant('r3')
    await getDb().update(sepayIntegrations).set({ status: 'TESTING' }).where(eq(sepayIntegrations.id, integration.id))
    expect(await findBankQrReceiver(getDb(), scopeOf(t))).toBeNull()
    await getDb().update(sepayIntegrations).set({ status: 'ACTIVE' }).where(eq(sepayIntegrations.id, integration.id))
    expect(await findBankQrReceiver(getDb(), scopeOf(t))).not.toBeNull()
    await getDb().update(storePaymentAccounts).set({ verifiedAt: null }).where(eq(storePaymentAccounts.id, account.id))
    expect(await findBankQrReceiver(getDb(), scopeOf(t))).toBeNull()
    await getDb().update(storePaymentAccounts).set({ verifiedAt: new Date(), isActive: false }).where(eq(storePaymentAccounts.id, account.id))
    expect(await findBankQrReceiver(getDb(), scopeOf(t))).toBeNull()
  })

  it('is null when the account is not linked to any integration', async () => {
    const t = await createTenant('r4')
    const now = new Date()
    await createPaymentAccount(t.store, { qrCheckedAt: now, verifiedAt: now })
    await createIntegration(t.org, { status: 'ACTIVE' as const, encryptedHmacSecret: 'v1.x.y.z' })
    expect(await findBankQrReceiver(getDb(), scopeOf(t))).toBeNull()
  })

  it('never returns an account of another store', async () => {
    const a = await readyTenant('r5a')
    const b = await createTenant('r5b')
    expect(await findBankQrReceiver(getDb(), scopeOf(b))).toBeNull()
    expect(await findBankQrReceiver(getDb(), { orgId: b.org.id, storeId: a.t.store.id })).toBeNull()
  })

  it('stops offering the store once the owner edits the account (Review Focus #4)', async () => {
    const { t, account } = await readyTenant('r6')
    await getDb().update(storePaymentAccounts)
      .set({ accountNumber: '1122334455', qrCheckedAt: null, verifiedAt: null })
      .where(eq(storePaymentAccounts.id, account.id))
    expect(await findBankQrReceiver(getDb(), scopeOf(t))).toBeNull()
  })
})

describe('createPaymentAttempt', () => {
  it('snapshots the account, takes the amount and TTL from the server and returns the QR', async () => {
    const { t } = await readyTenant('c1')
    await getDb().update(stores).set({ paymentTtlMinutes: 20 }).where(eq(stores.id, t.store.id))
    const order = await awaitingOrder(t)
    const receiver = await requireBankQrReceiver(getDb(), scopeOf(t))
    const now = new Date('2026-11-01T05:00:00Z')

    const qr = await createPaymentAttempt(getDb(), { ...scopeOf(t), orderId: order.id, amountVnd: 70_000, receiver }, { now })

    expect(qr.expiresAt).toBe('2026-11-01T05:20:00.000Z')
    expect(qr).toMatchObject({ bankName: 'Vietcombank', accountNumber: '9988776655', accountHolder: 'NGUYEN VAN A', amountVnd: 70_000 })
    expect(qr.transferContent).toMatch(PAYMENT_CODE_PATTERN)
    const url = new URL(qr.imageUrl)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      acc: '9988776655', bank: '970436', amount: '70000', des: qr.transferContent, template: 'qronly',
    })
    const [row] = await attemptsOf(order.id)
    expect(row).toMatchObject({
      status: 'PENDING', bankCode: 'VCB', accountNumber: '9988776655', vaNumber: null, expectedAmountVnd: 70_000,
      paymentCode: qr.transferContent, transferContent: qr.transferContent,
    })
  })

  it('uses the VA as the QR account when the account has one', async () => {
    const { t } = await readyTenant('c2', { bankCode: 'OCB', vaNumber: 'VQRQ12345678' })
    const order = await awaitingOrder(t)
    const receiver = await requireBankQrReceiver(getDb(), scopeOf(t))
    const qr = await createPaymentAttempt(getDb(), { ...scopeOf(t), orderId: order.id, amountVnd: 70_000, receiver })
    expect(qr.accountNumber).toBe('VQRQ12345678')
    expect(new URL(qr.imageUrl).searchParams.get('acc')).toBe('VQRQ12345678')
    const [row] = await attemptsOf(order.id)
    expect(row).toMatchObject({ accountNumber: '9988776655', vaNumber: 'VQRQ12345678' })
  })

  it('writes SEVQR into both the QR and the stored content for VietinBank (Review Focus #1)', async () => {
    const { t } = await readyTenant('c3', { bankCode: 'ICB' })
    const order = await awaitingOrder(t)
    const receiver = await requireBankQrReceiver(getDb(), scopeOf(t))
    const qr = await createPaymentAttempt(getDb(), { ...scopeOf(t), orderId: order.id, amountVnd: 70_000, receiver })
    expect(qr.transferContent).toMatch(/^SEVQR ZO[A-Z0-9]{8}$/)
    expect(new URL(qr.imageUrl).searchParams.get('des')).toBe(qr.transferContent)
    const [row] = await attemptsOf(order.id)
    expect(row!.paymentCode).toMatch(PAYMENT_CODE_PATTERN)
    expect(row!.transferContent).toBe(`SEVQR ${row!.paymentCode}`)
  })

  it('retries when a generated code is already taken, and fails cleanly when none is free', async () => {
    const { t } = await readyTenant('c4')
    const taken = await awaitingOrder(t)
    const order = await awaitingOrder(t)
    const receiver = await requireBankQrReceiver(getDb(), scopeOf(t))
    await createPaymentAttempt(getDb(), { ...scopeOf(t), orderId: taken.id, amountVnd: 70_000, receiver }, { generatePaymentCode: () => 'ZODUPLICAT' })

    const sequence = vi.fn().mockReturnValueOnce('ZODUPLICAT').mockReturnValueOnce('ZODUPLICAT').mockReturnValue('ZOFRESH001')
    const qr = await createPaymentAttempt(getDb(), { ...scopeOf(t), orderId: order.id, amountVnd: 70_000, receiver }, { generatePaymentCode: sequence })
    expect(qr.transferContent).toBe('ZOFRESH001')
    expect(sequence).toHaveBeenCalledTimes(3)

    const third = await awaitingOrder(t)
    const alwaysTaken = vi.fn().mockReturnValue('ZODUPLICAT')
    await expect(createPaymentAttempt(getDb(), { ...scopeOf(t), orderId: third.id, amountVnd: 70_000, receiver }, { generatePaymentCode: alwaysTaken }))
      .rejects.toMatchObject({ code: 'INTERNAL' })
    expect(alwaysTaken).toHaveBeenCalledTimes(5)
  })

  it('refuses a zero amount instead of crashing on the DB check', async () => {
    const { t } = await readyTenant('c5')
    const order = await awaitingOrder(t, { subtotalVnd: 0, totalVnd: 0 })
    const receiver = await requireBankQrReceiver(getDb(), scopeOf(t))
    await expect(createPaymentAttempt(getDb(), { ...scopeOf(t), orderId: order.id, amountVnd: 0, receiver }))
      .rejects.toMatchObject({ code: 'PAYMENT_METHOD_UNAVAILABLE' })
  })

  it('does not break the caller\'s transaction on a code collision', async () => {
    const { t } = await readyTenant('c6')
    const first = await awaitingOrder(t)
    const second = await awaitingOrder(t)
    const receiver = await requireBankQrReceiver(getDb(), scopeOf(t))
    await createPaymentAttempt(getDb(), { ...scopeOf(t), orderId: first.id, amountVnd: 70_000, receiver }, { generatePaymentCode: () => 'ZODUPLICAT' })
    const seq = vi.fn().mockReturnValueOnce('ZODUPLICAT').mockReturnValue('ZOFRESH002')
    const qr = await getDb().transaction(tx => createPaymentAttempt(tx, { ...scopeOf(t), orderId: second.id, amountVnd: 70_000, receiver }, { generatePaymentCode: seq }))
    expect(qr.transferContent).toBe('ZOFRESH002')
  })
})

describe('getActiveQrForOrder', () => {
  it('returns the pending attempt until it expires, then null', async () => {
    const { t } = await readyTenant('g1')
    const order = await awaitingOrder(t)
    const receiver = await requireBankQrReceiver(getDb(), scopeOf(t))
    const now = new Date('2026-11-01T05:00:00Z')
    const qr = await createPaymentAttempt(getDb(), { ...scopeOf(t), orderId: order.id, amountVnd: 70_000, receiver }, { now })
    const ref = { storeId: t.store.id, orderId: order.id }
    expect(await getActiveQrForOrder(getDb(), ref, new Date('2026-11-01T05:14:59Z'))).toEqual(qr)
    expect(await getActiveQrForOrder(getDb(), ref, new Date('2026-11-01T05:15:00Z'))).toBeNull()
  })

  it('returns null for EXPIRED, SUPERSEDED and PAID attempts', async () => {
    const { t } = await readyTenant('g2')
    const order = await awaitingOrder(t)
    const receiver = await requireBankQrReceiver(getDb(), scopeOf(t))
    await createPaymentAttempt(getDb(), { ...scopeOf(t), orderId: order.id, amountVnd: 70_000, receiver })
    for (const status of ['EXPIRED', 'SUPERSEDED', 'PAID'] as const) {
      await getDb().update(paymentAttempts).set({ status }).where(eq(paymentAttempts.orderId, order.id))
      expect(await getActiveQrForOrder(getDb(), { storeId: t.store.id, orderId: order.id })).toBeNull()
    }
  })

  it('keeps showing the account the QR was made for after the owner edits the account', async () => {
    const { t, account } = await readyTenant('g3')
    const order = await awaitingOrder(t)
    const receiver = await requireBankQrReceiver(getDb(), scopeOf(t))
    await createPaymentAttempt(getDb(), { ...scopeOf(t), orderId: order.id, amountVnd: 70_000, receiver })
    await getDb().update(storePaymentAccounts)
      .set({ bankCode: 'ACB', accountNumber: '1122334455', accountHolder: 'NGUOI KHAC' })
      .where(eq(storePaymentAccounts.id, account.id))
    const qr = await getActiveQrForOrder(getDb(), { storeId: t.store.id, orderId: order.id })
    expect(qr).toMatchObject({ bankName: 'Vietcombank', accountNumber: '9988776655', accountHolder: 'NGUYEN VAN A' })
    expect(new URL(qr!.imageUrl).searchParams.get('bank')).toBe('970436')
  })

  it('does not return another store\'s attempt', async () => {
    const a = await readyTenant('g4a')
    const b = await createTenant('g4b')
    const order = await awaitingOrder(a.t)
    const receiver = await requireBankQrReceiver(getDb(), scopeOf(a.t))
    await createPaymentAttempt(getDb(), { ...scopeOf(a.t), orderId: order.id, amountVnd: 70_000, receiver })
    expect(await getActiveQrForOrder(getDb(), { storeId: b.store.id, orderId: order.id })).toBeNull()
  })
})

describe('findOrderRefByGuestToken', () => {
  it('resolves a token to the order and its tenant, and ignores bad tokens', async () => {
    const t = await createTenant('f1')
    const token = generateToken()
    const order = await insertRawOrder(t.store, { guestTokenHash: hashToken(token) })
    expect(await findOrderRefByGuestToken(getDb(), token)).toEqual({ orgId: t.org.id, storeId: t.store.id, orderId: order.id })
    expect(await findOrderRefByGuestToken(getDb(), generateToken())).toBeNull()
    expect(await findOrderRefByGuestToken(getDb(), 'short')).toBeNull()
    expect(await findOrderRefByGuestToken(getDb(), `${token}'; --`)).toBeNull()
  })
})

describe('createReplacementAttempt', () => {
  const PAST = () => new Date(Date.now() - 20 * 60_000)

  async function expiredOrder(label: string) {
    const ready = await readyTenant(label)
    const order = await awaitingOrder(ready.t)
    const receiver = await requireBankQrReceiver(getDb(), scopeOf(ready.t))
    const old = await createPaymentAttempt(getDb(), { ...scopeOf(ready.t), orderId: order.id, amountVnd: 70_000, receiver }, { now: PAST() })
    return { ...ready, order, old, ref: { ...scopeOf(ready.t), orderId: order.id } }
  }

  it('returns the live QR untouched when one exists (double tap)', async () => {
    const ready = await readyTenant('p1')
    const order = await awaitingOrder(ready.t)
    const receiver = await requireBankQrReceiver(getDb(), scopeOf(ready.t))
    const live = await createPaymentAttempt(getDb(), { ...scopeOf(ready.t), orderId: order.id, amountVnd: 70_000, receiver })
    const result = await createReplacementAttempt(getDb(), { ...scopeOf(ready.t), orderId: order.id })
    expect(result).toEqual({ qr: live, created: false })
    expect(await attemptsOf(order.id)).toHaveLength(1)
  })

  it('supersedes the lapsed attempt and issues a new code, keeping the old row and code (Review Focus #3)', async () => {
    const { order, old, ref } = await expiredOrder('p2')
    const result = await createReplacementAttempt(getDb(), ref)
    expect(result.created).toBe(true)
    expect(result.qr.transferContent).not.toBe(old.transferContent)
    expect(result.qr.amountVnd).toBe(70_000)

    const rows = await attemptsOf(order.id)
    expect(rows.map(r => r.status)).toEqual(['SUPERSEDED', 'PENDING'])
    expect(rows[0]!.paymentCode).toBe(old.transferContent)
    expect(new Set(rows.map(r => r.paymentCode)).size).toBe(2)
  })

  it('leaves an attempt the expiry job already marked EXPIRED as it is', async () => {
    const { order, ref } = await expiredOrder('p3')
    await getDb().update(paymentAttempts).set({ status: 'EXPIRED' }).where(eq(paymentAttempts.orderId, order.id))
    await createReplacementAttempt(getDb(), ref)
    expect((await attemptsOf(order.id)).map(r => r.status)).toEqual(['EXPIRED', 'PENDING'])
  })

  it('uses the order total from the database for the new attempt', async () => {
    const { order, ref } = await expiredOrder('p4')
    const result = await createReplacementAttempt(getDb(), ref)
    const [fresh] = await getDb().select({ total: orders.totalVnd }).from(orders).where(eq(orders.id, order.id))
    expect(result.qr.amountVnd).toBe(fresh!.total)
  })

  it('issues exactly one attempt for five concurrent calls on a lapsed order (Review Focus #2)', async () => {
    const { order, ref } = await expiredOrder('p5')
    const results = await Promise.all(Array.from({ length: 5 }, () => createReplacementAttempt(getDb(), ref)))
    expect(results.filter(r => r.created)).toHaveLength(1)
    expect(new Set(results.map(r => r.qr.transferContent)).size).toBe(1)
    const rows = await attemptsOf(order.id)
    expect(rows.filter(r => r.status === 'PENDING')).toHaveLength(1)
    expect(rows).toHaveLength(2)
  })

  it('refuses orders that are not waiting for a bank transfer', async () => {
    const ready = await readyTenant('p6')
    const cod = await awaitingOrder(ready.t, { paymentMethod: 'PAY_ON_RECEIPT', status: 'NEW', paymentStatus: 'UNPAID' })
    const paid = await awaitingOrder(ready.t, { status: 'NEW', paymentStatus: 'PAID' })
    const cancelled = await awaitingOrder(ready.t, { status: 'CANCELLED' })
    const review = await awaitingOrder(ready.t, { paymentStatus: 'REVIEW_REQUIRED' })
    for (const order of [cod, paid, cancelled, review]) {
      await expect(createReplacementAttempt(getDb(), { ...scopeOf(ready.t), orderId: order.id }))
        .rejects.toMatchObject({ code: 'STATUS_CONFLICT' })
    }
    expect(await getDb().select().from(paymentAttempts)).toHaveLength(0)
  })

  it('rolls back and reports PAYMENT_METHOD_UNAVAILABLE when the store no longer accepts bank transfer', async () => {
    const { order, ref, integration } = await expiredOrder('p7')
    await getDb().update(sepayIntegrations).set({ status: 'DISABLED' }).where(eq(sepayIntegrations.id, integration.id))
    await expect(createReplacementAttempt(getDb(), ref)).rejects.toMatchObject({ code: 'PAYMENT_METHOD_UNAVAILABLE' })
    expect((await attemptsOf(order.id)).map(r => r.status)).toEqual(['PENDING'])
  })

  it('does not find an order of another store', async () => {
    const { order } = await expiredOrder('p8')
    const other = await createTenant('p8b')
    await expect(createReplacementAttempt(getDb(), { ...scopeOf(other), orderId: order.id })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('never reuses a payment code across replacements', async () => {
    const { order, ref } = await expiredOrder('p9')
    for (let i = 0; i < 3; i++) {
      await getDb().update(paymentAttempts).set({ expiresAt: PAST() }).where(and(eq(paymentAttempts.orderId, order.id), eq(paymentAttempts.status, 'PENDING')))
      await createReplacementAttempt(getDb(), ref)
    }
    const rows = await attemptsOf(order.id)
    expect(rows).toHaveLength(4)
    expect(new Set(rows.map(r => r.paymentCode)).size).toBe(4)
    expect(rows.filter(r => r.status === 'PENDING')).toHaveLength(1)
  })
})
```


- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `npm run test:integration -- tests/integration/payment-attempts.test.ts`
Expected: FAIL — không resolve được `server/services/payments/attempts`.

- [ ] **Step 3: Viết service**

`server/services/payments/attempts.ts`:

```ts
import { and, desc, eq, exists, gt, isNotNull, sql } from 'drizzle-orm'
import { findBank } from '#shared/banks'
import { assertVnd } from '#shared/money'
import type { PaymentQr } from '#shared/types/order'
import type { Db, DbOrTx } from '../../db/client'
import { integrationAccounts, orders, paymentAttempts, sepayIntegrations, storePaymentAccounts, stores } from '../../db/schema'
import { AppError } from '../../utils/errors'
import { hashToken } from '../../utils/tokens'
import { MAX_PAYMENT_CODE_ATTEMPTS } from './constants'
import { buildTransferContent, buildVietQrUrl, generatePaymentCode as defaultGeneratePaymentCode } from './payment-code'

export interface StoreScope { orgId: string, storeId: string }
export interface OrderRef extends StoreScope { orderId: string }
export interface BankQrReceiver {
  accountId: string
  bankCode: string
  accountNumber: string
  vaNumber: string | null
  accountHolder: string
}
export interface AttemptDeps {
  now?: Date
  generatePaymentCode?: () => string
}
export interface CreateAttemptInput extends OrderRef {
  amountVnd: number
  receiver: BankQrReceiver
}

type AttemptRow = typeof paymentAttempts.$inferSelect

const GUEST_TOKEN = /^[A-Za-z0-9_-]{43}$/

export function toPaymentQr(row: AttemptRow): PaymentQr {
  const qrAccount = row.vaNumber ?? row.accountNumber
  return {
    bankName: findBank(row.bankCode)?.shortName ?? row.bankCode,
    accountNumber: qrAccount,
    accountHolder: row.accountHolder,
    amountVnd: row.expectedAmountVnd,
    transferContent: row.transferContent,
    imageUrl: buildVietQrUrl({
      bankCode: row.bankCode,
      accountNumber: qrAccount,
      amountVnd: row.expectedAmountVnd,
      paymentCode: row.paymentCode,
    }),
    expiresAt: row.expiresAt.toISOString(),
  }
}

export async function findBankQrReceiver(db: DbOrTx, scope: StoreScope): Promise<BankQrReceiver | null> {
  const [row] = await db
    .select()
    .from(storePaymentAccounts)
    .where(and(
      eq(storePaymentAccounts.orgId, scope.orgId),
      eq(storePaymentAccounts.storeId, scope.storeId),
      eq(storePaymentAccounts.isActive, true),
      isNotNull(storePaymentAccounts.qrCheckedAt),
      isNotNull(storePaymentAccounts.verifiedAt),
      exists(
        db
          .select({ one: sql`1` })
          .from(integrationAccounts)
          .innerJoin(sepayIntegrations, and(
            eq(sepayIntegrations.orgId, integrationAccounts.orgId),
            eq(sepayIntegrations.id, integrationAccounts.integrationId),
          ))
          .where(and(
            eq(integrationAccounts.paymentAccountId, storePaymentAccounts.id),
            eq(sepayIntegrations.status, 'ACTIVE'),
          )),
      ),
    ))
    .limit(1)
  if (!row) return null
  return {
    accountId: row.id,
    bankCode: row.bankCode,
    accountNumber: row.accountNumber,
    vaNumber: row.vaNumber,
    accountHolder: row.accountHolder,
  }
}

export async function requireBankQrReceiver(db: DbOrTx, scope: StoreScope): Promise<BankQrReceiver> {
  const receiver = await findBankQrReceiver(db, scope)
  if (!receiver) throw new AppError('PAYMENT_METHOD_UNAVAILABLE', 'Cửa hàng chưa bật thanh toán chuyển khoản')
  return receiver
}

export async function createPaymentAttempt(db: DbOrTx, input: CreateAttemptInput, deps: AttemptDeps = {}): Promise<PaymentQr> {
  assertVnd(input.amountVnd)
  if (input.amountVnd < 1) throw new AppError('PAYMENT_METHOD_UNAVAILABLE', 'Đơn 0đ không thanh toán bằng chuyển khoản')
  const now = deps.now ?? new Date()
  const generate = deps.generatePaymentCode ?? defaultGeneratePaymentCode

  const [store] = await db
    .select({ ttlMinutes: stores.paymentTtlMinutes })
    .from(stores)
    .where(and(eq(stores.id, input.storeId), eq(stores.orgId, input.orgId)))
  if (!store) throw new AppError('NOT_FOUND', 'Không tìm thấy')
  const expiresAt = new Date(now.getTime() + store.ttlMinutes * 60_000)

  for (let attempt = 0; attempt < MAX_PAYMENT_CODE_ATTEMPTS; attempt++) {
    const paymentCode = generate()
    // ON CONFLICT DO NOTHING keeps a code collision from aborting the caller's transaction.
    const [row] = await db
      .insert(paymentAttempts)
      .values({
        orgId: input.orgId,
        storeId: input.storeId,
        orderId: input.orderId,
        accountId: input.receiver.accountId,
        bankCode: input.receiver.bankCode,
        accountNumber: input.receiver.accountNumber,
        vaNumber: input.receiver.vaNumber,
        accountHolder: input.receiver.accountHolder,
        paymentCode,
        transferContent: buildTransferContent(input.receiver.bankCode, paymentCode),
        expectedAmountVnd: input.amountVnd,
        expiresAt,
      })
      .onConflictDoNothing({ target: paymentAttempts.paymentCode })
      .returning()
    if (row) return toPaymentQr(row)
  }
  throw new AppError('INTERNAL', 'Không tạo được mã thanh toán, vui lòng thử lại')
}

export async function getActiveQrForOrder(
  db: DbOrTx,
  ref: { storeId: string, orderId: string },
  now = new Date(),
): Promise<PaymentQr | null> {
  const [row] = await db
    .select()
    .from(paymentAttempts)
    .where(and(
      eq(paymentAttempts.storeId, ref.storeId),
      eq(paymentAttempts.orderId, ref.orderId),
      eq(paymentAttempts.status, 'PENDING'),
      gt(paymentAttempts.expiresAt, now),
    ))
    .orderBy(desc(paymentAttempts.createdAt))
    .limit(1)
  return row ? toPaymentQr(row) : null
}

export async function findOrderRefByGuestToken(db: DbOrTx, token: string): Promise<OrderRef | null> {
  if (!GUEST_TOKEN.test(token)) return null
  const [row] = await db
    .select({ orgId: orders.orgId, storeId: orders.storeId, orderId: orders.id })
    .from(orders)
    .where(eq(orders.guestTokenHash, hashToken(token)))
  return row ?? null
}

export async function createReplacementAttempt(
  db: Db,
  ref: OrderRef,
  deps: AttemptDeps = {},
): Promise<{ qr: PaymentQr, created: boolean }> {
  const now = deps.now ?? new Date()
  return db.transaction(async (tx) => {
    // The row lock serialises concurrent "Tạo mã mới" taps: the second sees the first one's fresh attempt.
    const [order] = await tx
      .select({
        status: orders.status,
        paymentMethod: orders.paymentMethod,
        paymentStatus: orders.paymentStatus,
        totalVnd: orders.totalVnd,
      })
      .from(orders)
      .where(and(eq(orders.id, ref.orderId), eq(orders.storeId, ref.storeId), eq(orders.orgId, ref.orgId)))
      .for('update')
    if (!order) throw new AppError('NOT_FOUND', 'Không tìm thấy')
    if (order.paymentMethod !== 'BANK_QR') throw new AppError('STATUS_CONFLICT', 'Đơn này không thanh toán bằng chuyển khoản')
    if (order.status !== 'AWAITING_PAYMENT' || order.paymentStatus !== 'PENDING') {
      throw new AppError('STATUS_CONFLICT', 'Đơn không còn chờ thanh toán')
    }

    const active = await getActiveQrForOrder(tx, ref, now)
    if (active) return { qr: active, created: false }

    const receiver = await requireBankQrReceiver(tx, ref)
    await tx
      .update(paymentAttempts)
      .set({ status: 'SUPERSEDED', updatedAt: now })
      .where(and(
        eq(paymentAttempts.storeId, ref.storeId),
        eq(paymentAttempts.orderId, ref.orderId),
        eq(paymentAttempts.status, 'PENDING'),
      ))
    const qr = await createPaymentAttempt(tx, { ...ref, amountVnd: order.totalVnd, receiver }, deps)
    return { qr, created: true }
  })
}
```

- [ ] **Step 4: Chạy test để xác nhận đạt**

Run: `npm run test:integration -- tests/integration/payment-attempts.test.ts`
Expected: PASS (kể cả năm lời gọi đồng thời và test collision trong transaction ngoài).

- [ ] **Step 5: Commit**

```bash
git add server/services/payments/attempts.ts tests/integration/payment-attempts.test.ts
git commit -m "feat(payment-setup): add payment attempts with TTL, snapshots and re-pay" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 8: Bật nhánh `BANK_QR` trong `createOrder` + `qr` trong `GET /api/public/orders/:token`

**Files:**
- Create: `tests/api/payment-setup-api.test.ts`
- Modify: `server/services/ordering/create-order.ts`, `server/services/ordering/public-view.ts`

**Interfaces:**
- Consumes: `requireBankQrReceiver`, `createPaymentAttempt`, `getActiveQrForOrder` (Task 7); `createOrder` + route `POST /api/public/stores/:slug/orders` (PR3); `getPublicOrderView` + route `GET /api/public/orders/:token` (PR3); board `GET /api/stores/:storeId/orders?tab=` (PR4 Task 3); `PATCH …/orders/:orderId/status` (PR4 Task 4); fixtures PR2/PR3/Task 3.
- Produces (Task 9, 10 và PR6 dùng):
  - `createOrder` với `paymentMethod = 'BANK_QR'`: đơn `AWAITING_PAYMENT` + `payment_status = 'PENDING'` + một `payment_attempts` `PENDING` trong **cùng transaction**; response có `qr: PaymentQr`; store chưa bật BANK_QR → 422 `PAYMENT_METHOD_UNAVAILABLE` và **không** tạo đơn; replay idempotent trả lại `qr` đang hiệu lực.
  - `GET /api/public/orders/:token`: `qr` = `getActiveQrForOrder` khi `paymentMethod = 'BANK_QR'` và `status = 'AWAITING_PAYMENT'`, ngược lại `null`.
  - File `tests/api/payment-setup-api.test.ts` (một lần build server cho cả PR5): Task 9 và 10 nối thêm `describe` vào cuối file, tại dòng `// NEXT-API-TESTS`.

- [ ] **Step 1: Viết API test thất bại**

`tests/api/payment-setup-api.test.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { setup } from '@nuxt/test-utils/e2e'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { orders, paymentAttempts, rateLimits, sepayIntegrations } from '../../server/db/schema'
import { hashToken } from '../../server/utils/tokens'
import { createTestAuth } from '../support/auth'
import { openStore, pickupBody, seedMenu, type SeededMenu } from '../support/checkout-fixtures'
import { resetDb } from '../support/db'
import { addStaff, createTenant } from '../support/fixtures'
import { call, type CallResult } from '../support/http'
import { findForbiddenKeys } from '../support/json'
import { setupBankQr } from '../support/payment-fixtures'

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
  menu: SeededMenu
  ownerToken: string
  staffToken: string
  plainSlug: string
  plainStoreId: string
  plainMenu: SeededMenu
}

const sign = (user: { userId: string, email: string }) => auth.sign({ sub: user.userId, email: user.email })

beforeAll(async () => {
  await resetDb()
  const a = await createTenant('pay-a')
  const staff = await addStaff(a.store)
  const menu = await seedMenu(a.store)
  await openStore(a.store.id)
  await setupBankQr(a.store)

  const b = await createTenant('pay-b')
  const plainMenu = await seedMenu(b.store)
  await openStore(b.store.id)

  Object.assign(seed, {
    slug: a.store.slug,
    storeId: a.store.id,
    orgId: a.org.id,
    menu,
    ownerToken: await sign(a.owner),
    staffToken: await sign(staff),
    plainSlug: b.store.slug,
    plainStoreId: b.store.id,
    plainMenu,
  })
})

afterAll(async () => {
  await closeDb()
})

const bankQrOrder = (slug: string, menu: SeededMenu, over: Record<string, unknown> = {}) =>
  call('POST', `/api/public/stores/${slug}/orders`, null, pickupBody(menu, { paymentMethod: 'BANK_QR', ...over }))

async function clearRateLimits() {
  await getDb().delete(rateLimits)
}

async function orderByToken(guestToken: string) {
  const [row] = await getDb().select().from(orders).where(eq(orders.guestTokenHash, hashToken(guestToken)))
  return row!
}

describe('BANK_QR checkout', () => {
  const state = {} as { body: ReturnType<typeof pickupBody>, guestToken: string, qr: Record<string, string | number>, orderId: string }

  it('creates an AWAITING_PAYMENT order with one PENDING attempt and a correct QR', async () => {
    await clearRateLimits()
    const body = pickupBody(seed.menu, { paymentMethod: 'BANK_QR' })
    const res = await call('POST', `/api/public/stores/${seed.slug}/orders`, null, body)
    expect([200, 201]).toContain(res.status)
    expect(res.body).toMatchObject({ status: 'AWAITING_PAYMENT', paymentStatus: 'PENDING', totalVnd: 70_000 })

    const qr = res.body.qr
    expect(qr).toMatchObject({ bankName: 'Vietcombank', accountNumber: '9988776655', accountHolder: 'NGUYEN VAN A', amountVnd: 70_000 })
    expect(qr.transferContent).toMatch(/^ZO[A-Z0-9]{8}$/)
    expect(Object.fromEntries(new URL(qr.imageUrl).searchParams)).toEqual({
      acc: '9988776655', bank: '970436', amount: '70000', des: qr.transferContent, template: 'qronly',
    })
    const msLeft = Date.parse(qr.expiresAt) - Date.now()
    expect(msLeft).toBeGreaterThan(14 * 60_000)
    expect(msLeft).toBeLessThanOrEqual(15 * 60_000 + 5_000)

    const order = await orderByToken(res.body.guestToken)
    expect(order).toMatchObject({ status: 'AWAITING_PAYMENT', paymentMethod: 'BANK_QR', paymentStatus: 'PENDING', totalVnd: 70_000 })
    const attempts = await getDb().select().from(paymentAttempts).where(eq(paymentAttempts.orderId, order.id))
    expect(attempts).toHaveLength(1)
    expect(attempts[0]).toMatchObject({ status: 'PENDING', paymentCode: qr.transferContent, expectedAmountVnd: 70_000 })
    Object.assign(state, { body, guestToken: res.body.guestToken, qr, orderId: order.id })
  })

  it('replays the same idempotency key with the same token and the same live QR', async () => {
    const res = await call('POST', `/api/public/stores/${seed.slug}/orders`, null, state.body)
    expect([200, 201]).toContain(res.status)
    expect(res.body.guestToken).toBe(state.guestToken)
    expect(res.body.qr).toEqual(state.qr)
    expect(await getDb().select().from(paymentAttempts).where(eq(paymentAttempts.orderId, state.orderId))).toHaveLength(1)
  })

  it('returns the live QR from GET /api/public/orders/:token without leaking internals', async () => {
    const res = await call('GET', `/api/public/orders/${state.guestToken}`)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'AWAITING_PAYMENT', paymentStatus: 'PENDING', paymentMethod: 'BANK_QR' })
    expect(res.body.qr).toEqual(state.qr)
    expect(findForbiddenKeys(res.body)).toEqual([])
    const json = JSON.stringify(res.body)
    for (const hidden of [seed.orgId, seed.storeId, 'accountId', 'vaNumber', 'encrypted']) expect(json).not.toContain(hidden)
  })

  it('keeps the order out of the prep queue: not in tab=new, present in tab=awaiting_payment', async () => {
    for (const token of [seed.ownerToken, seed.staffToken]) {
      const fresh = await call('GET', `/api/stores/${seed.storeId}/orders?tab=new`, token)
      expect(fresh.status).toBe(200)
      expect(fresh.body.orders.map((o: { id: string }) => o.id)).not.toContain(state.orderId)
      const waiting = await call('GET', `/api/stores/${seed.storeId}/orders?tab=awaiting_payment`, token)
      expect(waiting.body.orders.map((o: { id: string }) => o.id)).toContain(state.orderId)
      expect(waiting.body.counts.awaiting_payment).toBeGreaterThanOrEqual(1)
    }
  })

  it('does not let staff or owner push an AWAITING_PAYMENT order into preparation', async () => {
    for (const [token, nextStatus] of [[seed.staffToken, 'PREPARING'], [seed.ownerToken, 'PREPARING'], [seed.ownerToken, 'NEW']] as const) {
      const res = await call('PATCH', `/api/stores/${seed.storeId}/orders/${state.orderId}/status`, token, {
        expectedStatus: 'AWAITING_PAYMENT',
        nextStatus,
      })
      expect(res.status).toBeGreaterThanOrEqual(400)
    }
    expect((await orderByToken(state.guestToken)).status).toBe('AWAITING_PAYMENT')
  })

  it('answers 422 PAYMENT_METHOD_UNAVAILABLE and creates no order for a store without bank transfer', async () => {
    await clearRateLimits()
    const res = await bankQrOrder(seed.plainSlug, seed.plainMenu)
    expect(res).toMatchObject({ status: 422, body: { code: 'PAYMENT_METHOD_UNAVAILABLE' } })
    expect(await getDb().select().from(orders).where(eq(orders.storeId, seed.plainStoreId))).toHaveLength(0)
  })

  it('answers 422 while the integration is still TESTING', async () => {
    await clearRateLimits()
    await getDb().update(sepayIntegrations).set({ status: 'TESTING' }).where(eq(sepayIntegrations.orgId, seed.orgId))
    try {
      const res = await bankQrOrder(seed.slug, seed.menu)
      expect(res).toMatchObject({ status: 422, body: { code: 'PAYMENT_METHOD_UNAVAILABLE' } })
    }
    finally {
      await getDb().update(sepayIntegrations).set({ status: 'ACTIVE' }).where(eq(sepayIntegrations.orgId, seed.orgId))
    }
  })

  it('leaves cash-on-receipt orders untouched: NEW, UNPAID, no QR, no attempt', async () => {
    await clearRateLimits()
    const res = await call('POST', `/api/public/stores/${seed.slug}/orders`, null, pickupBody(seed.menu))
    expect([200, 201]).toContain(res.status)
    expect(res.body).toMatchObject({ status: 'NEW', paymentStatus: 'UNPAID' })
    expect(res.body.qr).toBeUndefined()
    const order = await orderByToken(res.body.guestToken)
    expect(await getDb().select().from(paymentAttempts).where(eq(paymentAttempts.orderId, order.id))).toHaveLength(0)
  })

  it('hides the QR once the attempt has lapsed but keeps the order waiting', async () => {
    await getDb().update(paymentAttempts).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(paymentAttempts.orderId, state.orderId))
    const res = await call('GET', `/api/public/orders/${state.guestToken}`)
    expect(res.body).toMatchObject({ status: 'AWAITING_PAYMENT', paymentStatus: 'PENDING', qr: null })
  })
})

// NEXT-API-TESTS
```

Ghi chú: nếu `CallResult` không được `tests/support/http.ts` (PR2) export, bỏ import đó — Task 9 dùng nó để gom response.

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `npm run test:api -- tests/api/payment-setup-api.test.ts`
Expected: FAIL — đơn `BANK_QR` trả 422 `PAYMENT_METHOD_UNAVAILABLE` (nhánh stub của PR3) ở test đầu tiên và các test phụ thuộc.

- [ ] **Step 3: Sửa `createOrder` — ba điểm chèn**

Mở `server/services/ordering/create-order.ts`. Các tên `tx`, `store`, `order` bên dưới là biến cục bộ mô tả trong plan PR3 (transaction, dòng store đã khoá/đọc, dòng đơn vừa insert); nếu PR3 đặt tên khác, đổi theo (đây là "Điểm sửa nếu lệch" duy nhất của task này).

(a) Thêm import:

```ts
import { createPaymentAttempt, getActiveQrForOrder, requireBankQrReceiver } from '../payments/attempts'
```

(b) Thay nhánh stub của PR3 (đoạn `if (input.paymentMethod === 'BANK_QR') { throw new AppError('PAYMENT_METHOD_UNAVAILABLE', …) }`, nằm **sau** bước kiểm tra store/mode/bàn/khu vực/giá và **trước** khi insert `orders`) bằng:

```ts
const bankQrReceiver = input.paymentMethod === 'BANK_QR'
  ? await requireBankQrReceiver(tx, { orgId: store.orgId, storeId: store.id })
  : null
```

(c) Trong `insert(orders).values({ … })` đổi hai trường và trường `toState` của event `CREATED`:

```ts
status: bankQrReceiver ? 'AWAITING_PAYMENT' : 'NEW',
paymentStatus: bankQrReceiver ? 'PENDING' : 'UNPAID',
```

```ts
// order_events CREATED
toState: bankQrReceiver ? 'AWAITING_PAYMENT' : 'NEW',
```

(d) Ngay sau khi insert `order_events(CREATED)`, trước khi dựng response, thêm:

```ts
const qr = bankQrReceiver
  ? await createPaymentAttempt(tx, {
    orgId: store.orgId,
    storeId: store.id,
    orderId: order.id,
    amountVnd: order.totalVnd,
    receiver: bankQrReceiver,
  })
  : undefined
```

và thêm `...(qr ? { qr } : {})` vào object response của nhánh tạo mới (cạnh `publicCode`, `guestToken`, `status`, `paymentStatus`, `totalVnd`).

(e) Ở nhánh **replay idempotent** (nơi PR3 dựng lại response từ đơn đã có, gọi dòng đó là `existing`) thêm vào object response:

```ts
...(existing.paymentMethod === 'BANK_QR' && existing.status === 'AWAITING_PAYMENT'
  ? { qr: (await getActiveQrForOrder(tx, { storeId: existing.storeId, orderId: existing.id })) ?? undefined }
  : {}),
```

Giữ nguyên rate limit, advisory lock và mọi bước khác của PR3. `createPaymentAttempt` chỉ dùng `insert … ON CONFLICT DO NOTHING` nên một mã trùng không làm hỏng transaction của `createOrder`.

- [ ] **Step 4: Sửa `getPublicOrderView`**

Trong `server/services/ordering/public-view.ts` thêm import `import { getActiveQrForOrder } from '../payments/attempts'` và thay `qr: null` của object trả về bằng (gọi dòng đơn đã đọc là `row`; đổi tên nếu PR3 khác):

```ts
qr: row.paymentMethod === 'BANK_QR' && row.status === 'AWAITING_PAYMENT'
  ? await getActiveQrForOrder(db, { storeId: row.storeId, orderId: row.id })
  : null,
```

- [ ] **Step 5: Chạy test để xác nhận đạt**

Run: `npm run test:api -- tests/api/payment-setup-api.test.ts && npm run test:integration -- tests/integration/checkout.test.ts`
Expected: PASS. (Tên file test checkout của PR3 có thể khác; chạy `npm run test:integration` đầy đủ để chắc chắn luồng COD của PR3 không đổi hành vi.)

- [ ] **Step 6: Commit**

```bash
git add server/services/ordering/create-order.ts server/services/ordering/public-view.ts tests/api/payment-setup-api.test.ts
git commit -m "feat(payment-setup): enable BANK_QR checkout and expose the QR on order tracking" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 9: Owner API end-to-end + ma trận tenant + quét rò rỉ secret qua HTTP

**Files:**
- Modify: `tests/api/payment-setup-api.test.ts` (nối vào `// NEXT-API-TESTS`), `tests/api/tenant-isolation.test.ts`

**Interfaces:**
- Consumes: mọi route Task 5, 6; `createTenant`, `addStaff`, `seedMenu`, `openStore`, `pickupBody`, `call`, `findForbiddenKeys`, `CallResult`; fixtures PR1 `tests/api/tenant-isolation.test.ts` (`call`, `tokens`, `ids`, `errorCodes`, `Actor`).
- Produces: bộ test hồi quy cho mọi route PR5; PR6 thêm route `/api/webhooks/sepay/:key` ở ngoài ma trận (public, xác thực bằng HMAC).

Task này không thêm code sản phẩm; test nào fail thì sửa ở service/route của Task 5–7 (không nới test).

- [ ] **Step 1: Nối luồng owner + quét rò rỉ vào `tests/api/payment-setup-api.test.ts`**

Thay dòng `// NEXT-API-TESTS` bằng (giữ lại dòng đó ở cuối để Task 10 nối tiếp):

```ts
describe('owner sets up bank transfer over HTTP (bank + number + name, then Kiểm tra)', () => {
  const SECRET = 'SENTINEL_http_hmac_0123456789'
  const API_TOKEN = 'SENTINEL_http_token_0123456789'
  const t = {} as { orgId: string, storeId: string, slug: string, ownerToken: string, staffToken: string, menu: SeededMenu }
  const bodies: string[] = []
  const ref = {} as { accountId: string, integrationId: string }

  const record = (res: CallResult) => {
    bodies.push(JSON.stringify(res.body))
    return res
  }
  const owner = (method: string, path: string, body?: unknown) => call(method, path, t.ownerToken, body).then(record)

  beforeAll(async () => {
    const tenant = await createTenant('pay-owner')
    const staff = await addStaff(tenant.store)
    const menu = await seedMenu(tenant.store)
    await openStore(tenant.store.id)
    Object.assign(t, {
      orgId: tenant.org.id,
      storeId: tenant.store.id,
      slug: tenant.store.slug,
      ownerToken: await sign(tenant.owner),
      staffToken: await sign(staff),
      menu,
    })
  })

  const accounts = () => `/api/stores/${t.storeId}/payment-accounts`
  const integrations = () => `/api/organizations/${t.orgId}/sepay-integrations`

  it('starts with no account', async () => {
    expect((await owner('GET', accounts())).body).toEqual({ account: null })
  })

  it('rejects a VA-only bank without a VA number, pointing at the field (Review Focus #1)', async () => {
    const res = await owner('POST', accounts(), { bankCode: 'MSB', accountNumber: '9988776655', accountHolder: 'NGUYEN VAN B' })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('VALIDATION_FAILED')
    expect(res.body.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'vaNumber' })]))
  })

  it('creates the account, normalising input', async () => {
    const res = await owner('POST', accounts(), { bankCode: 'acb', accountNumber: '1122 3344 55', accountHolder: ' NGUYEN VAN B ' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ bankCode: 'ACB', accountNumber: '1122334455', accountHolder: 'NGUYEN VAN B', qrCheckedAt: null, verifiedAt: null })
    ref.accountId = res.body.id
  })

  it('refuses a second account for the store', async () => {
    const res = await owner('POST', accounts(), { bankCode: 'VCB', accountNumber: '9988776655', accountHolder: 'NGUOI KHAC' })
    expect(res).toMatchObject({ status: 409, body: { code: 'STATUS_CONFLICT' } })
  })

  it('"Kiểm tra" returns a 2.000đ QR for the right bank, then the owner confirms', async () => {
    const check = await owner('POST', `${accounts()}/${ref.accountId}/check`)
    expect(check.status).toBe(200)
    expect(check.body).toMatchObject({ ok: true, issues: [], warnings: [] })
    expect(check.body.preview).toMatchObject({ bankName: 'ACB', accountNumber: '1122334455', amountVnd: 2000, transferContent: 'ZOTEST0000' })
    expect(Object.fromEntries(new URL(check.body.preview.imageUrl).searchParams)).toMatchObject({ acc: '1122334455', bank: '970416', amount: '2000' })

    const confirmed = await owner('POST', `${accounts()}/${ref.accountId}/confirm-qr`)
    expect(confirmed.body.qrCheckedAt).not.toBeNull()
    expect(confirmed.body.verifiedAt).toBeNull()
  })

  it('creates the SePay integration once (double tap returns the same one)', async () => {
    const first = await owner('POST', integrations(), {})
    expect(first.status).toBe(201)
    expect(first.body).toMatchObject({ status: 'DRAFT', hasSecret: false })
    expect(first.body.webhookUrl).toMatch(/\/api\/webhooks\/sepay\/[A-Za-z0-9_-]{32}$/)
    const second = await owner('POST', integrations(), {})
    expect(second.status).toBe(200)
    expect(second.body.id).toBe(first.body.id)
    ref.integrationId = first.body.id
  })

  it('rejects a too-short secret without echoing it (Review Focus #5)', async () => {
    const res = await owner('PUT', `${integrations()}/${ref.integrationId}/secret`, { hmacSecret: 'SHORT1' })
    expect(res).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
    expect(JSON.stringify(res.body)).not.toContain('SHORT1')
  })

  it('stores a valid secret and only reports flags', async () => {
    const res = await owner('PUT', `${integrations()}/${ref.integrationId}/secret`, { hmacSecret: `  ${SECRET}\n`, apiToken: API_TOKEN })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'TESTING', hasSecret: true, hasApiToken: true })
    expect(findForbiddenKeys(res.body)).toEqual([])
    const listed = await owner('GET', integrations())
    expect(listed.body.integrations).toHaveLength(1)
    const one = await owner('GET', `${integrations()}/${ref.integrationId}`)
    expect(one.body).toEqual(res.body)
  })

  it('links the account and refuses to activate before a valid webhook (PR6 sets last_valid_webhook_at)', async () => {
    const linked = await owner('POST', `${integrations()}/${ref.integrationId}/accounts`, { paymentAccountId: ref.accountId })
    expect(linked.body.accountIds).toEqual([ref.accountId])
    const early = await owner('POST', `${integrations()}/${ref.integrationId}/activate`)
    expect(early).toMatchObject({ status: 409, body: { code: 'STATUS_CONFLICT', details: { reason: 'NO_VALID_WEBHOOK' } } })
  })

  it('cannot take BANK_QR orders yet, then can once the integration is ACTIVE and the account verified', async () => {
    await clearRateLimits()
    expect(await bankQrOrder(t.slug, t.menu)).toMatchObject({ status: 422, body: { code: 'PAYMENT_METHOD_UNAVAILABLE' } })

    await getDb().update(sepayIntegrations).set({ lastValidWebhookAt: new Date() }).where(eq(sepayIntegrations.id, ref.integrationId))
    const activated = await owner('POST', `${integrations()}/${ref.integrationId}/activate`)
    expect(activated.body.status).toBe('ACTIVE')
    expect((await owner('GET', accounts())).body.account.verifiedAt).not.toBeNull()

    const order = await bankQrOrder(t.slug, t.menu)
    expect([200, 201]).toContain(order.status)
    expect(order.body).toMatchObject({ status: 'AWAITING_PAYMENT' })
    expect(order.body.qr).toMatchObject({ bankName: 'ACB', accountNumber: '1122334455', amountVnd: 70_000 })
    expect(new URL(order.body.qr.imageUrl).searchParams.get('bank')).toBe('970416')
  })

  it('stops offering bank transfer the moment the owner edits the account (Review Focus #4)', async () => {
    const patched = await owner('PATCH', `${accounts()}/${ref.accountId}`, { accountNumber: '5566778899' })
    expect(patched.body).toMatchObject({ accountNumber: '5566778899', qrCheckedAt: null, verifiedAt: null })
    await clearRateLimits()
    expect(await bankQrOrder(t.slug, t.menu)).toMatchObject({ status: 422, body: { code: 'PAYMENT_METHOD_UNAVAILABLE' } })
  })

  it('staff can read nothing of the payment setup', async () => {
    expect((await call('GET', accounts(), t.staffToken)).status).toBe(403)
    expect((await call('GET', integrations(), t.staffToken)).status).toBe(404)
  })

  it('no response of the whole flow ever contained a secret, API token, ciphertext or encrypted-field name', async () => {
    const [row] = await getDb().select().from(sepayIntegrations).where(eq(sepayIntegrations.id, ref.integrationId))
    const all = bodies.join('\n')
    for (const leaked of [SECRET, API_TOKEN, row!.encryptedHmacSecret!, row!.encryptedApiToken!, 'encryptedHmacSecret', 'encryptedApiToken']) {
      expect(all.includes(leaked), 'a secret-bearing value reached an API response').toBe(false)
    }
  })
})

// NEXT-API-TESTS
```

- [ ] **Step 2: Chạy test**

Run: `npm run test:api -- tests/api/payment-setup-api.test.ts`
Expected: PASS. Nếu `confirm-qr`/`activate` lệch (vd. `verifiedAt` null sau khi activate), sửa `verifyAccountIfIntegrationActive`/`activateIntegration`, không sửa test.

- [ ] **Step 3: Thêm hàng ma trận tenant**

Trong `tests/api/tenant-isolation.test.ts`: (a) thêm import ở đầu file

```ts
import { createIntegration, createPaymentAccount } from '../support/payment-fixtures'
```

(b) nối vào **cuối file** (sau mọi `describe` hiện có; dùng lại `call`, `tokens`, `ids`, `errorCodes`, `Actor` đã có trong file):

```ts
describe('payment setup routes (owner only)', () => {
  const refs = {} as { accountA1: string, integrationA: string, accountB: string, integrationB: string }

  beforeAll(async () => {
    const [storeB] = await getDb().select({ orgId: stores.orgId }).from(stores).where(eq(stores.id, ids.storeB))
    refs.accountA1 = (await createPaymentAccount({ id: ids.storeA1, orgId: ids.orgA })).id
    refs.integrationA = (await createIntegration({ id: ids.orgA })).id
    refs.accountB = (await createPaymentAccount({ id: ids.storeB, orgId: storeB!.orgId })).id
    refs.integrationB = (await createIntegration({ id: storeB!.orgId })).id
  })

  const storeRoutes: { name: string, method: string, path: () => string, body?: unknown }[] = [
    { name: 'GET payment-accounts', method: 'GET', path: () => `/api/stores/${ids.storeA1}/payment-accounts` },
    { name: 'POST payment-accounts', method: 'POST', path: () => `/api/stores/${ids.storeA1}/payment-accounts`, body: { bankCode: 'ACB', accountNumber: '1122334455', accountHolder: 'NGUYEN VAN B' } },
    { name: 'PATCH payment-accounts/:id', method: 'PATCH', path: () => `/api/stores/${ids.storeA1}/payment-accounts/${refs.accountA1}`, body: { accountHolder: 'DOI TEN' } },
    { name: 'POST payment-accounts/:id/check', method: 'POST', path: () => `/api/stores/${ids.storeA1}/payment-accounts/${refs.accountA1}/check` },
    { name: 'POST payment-accounts/:id/confirm-qr', method: 'POST', path: () => `/api/stores/${ids.storeA1}/payment-accounts/${refs.accountA1}/confirm-qr` },
  ]

  describe.each(storeRoutes)('$name', ({ method, path, body }) => {
    it('no token → 401', async () => {
      expect(await call(method, path(), null, body)).toMatchObject({ status: 401, body: { code: 'UNAUTHENTICATED' } })
    })

    it.each<[Actor, number]>([
      ['staffA1', 403],
      ['staffA2', 404],
      ['disabledA1', 404],
      ['ownerB', 404],
    ])('%s → %i', async (actor, status) => {
      const res = await call(method, path(), tokens[actor], body)
      expect(res.status).toBe(status)
      expect(res.body).toMatchObject({ code: errorCodes[status] })
    })
  })

  it('denied callers changed nothing', async () => {
    const res = await call('GET', `/api/stores/${ids.storeA1}/payment-accounts`, tokens.ownerA)
    expect(res.status).toBe(200)
    expect(res.body.account).toMatchObject({ id: refs.accountA1, accountHolder: 'NGUYEN VAN A' })
  })

  it('an account id of store A1 is a 404 under store A2, even for the owner of both', async () => {
    for (const [method, suffix] of [['PATCH', ''], ['POST', '/check'], ['POST', '/confirm-qr']] as const) {
      const res = await call(method, `/api/stores/${ids.storeA2}/payment-accounts/${refs.accountA1}${suffix}`, tokens.ownerA, method === 'PATCH' ? { accountHolder: 'X Y' } : undefined)
      expect(res).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
    }
    expect((await call('GET', `/api/stores/${ids.storeA2}/payment-accounts`, tokens.ownerA)).body).toEqual({ account: null })
  })

  it('a malformed account id is 404, not 400/500', async () => {
    const res = await call('POST', `/api/stores/${ids.storeA1}/payment-accounts/not-a-uuid/check`, tokens.ownerA)
    expect(res).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
  })

  const orgRoutes: { name: string, method: string, path: () => string, body?: unknown }[] = [
    { name: 'GET sepay-integrations', method: 'GET', path: () => `/api/organizations/${ids.orgA}/sepay-integrations` },
    { name: 'POST sepay-integrations', method: 'POST', path: () => `/api/organizations/${ids.orgA}/sepay-integrations`, body: {} },
    { name: 'GET sepay-integrations/:id', method: 'GET', path: () => `/api/organizations/${ids.orgA}/sepay-integrations/${refs.integrationA}` },
    { name: 'PUT sepay-integrations/:id/secret', method: 'PUT', path: () => `/api/organizations/${ids.orgA}/sepay-integrations/${refs.integrationA}/secret`, body: { hmacSecret: 'whsec_matrix_0123456789' } },
    { name: 'POST sepay-integrations/:id/accounts', method: 'POST', path: () => `/api/organizations/${ids.orgA}/sepay-integrations/${refs.integrationA}/accounts`, body: { paymentAccountId: refs.accountA1 } },
    { name: 'POST sepay-integrations/:id/activate', method: 'POST', path: () => `/api/organizations/${ids.orgA}/sepay-integrations/${refs.integrationA}/activate` },
  ]

  describe.each(orgRoutes)('$name', ({ method, path, body }) => {
    it('no token → 401', async () => {
      expect(await call(method, path(), null, body)).toMatchObject({ status: 401, body: { code: 'UNAUTHENTICATED' } })
    })

    it.each<[Actor]>([['staffA1'], ['staffA2'], ['disabledA1'], ['ownerB']])('%s → 404 (not an owner of the org)', async (actor) => {
      const res = await call(method, path(), tokens[actor], body)
      expect(res).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
    })
  })

  it('ownerA cannot read, write or link across orgs', async () => {
    const base = `/api/organizations/${ids.orgA}/sepay-integrations`
    expect(await call('GET', `${base}/${refs.integrationB}`, tokens.ownerA)).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
    expect(await call('PUT', `${base}/${refs.integrationB}/secret`, tokens.ownerA, { hmacSecret: 'whsec_cross_0123456789' })).toMatchObject({ status: 404 })
    expect(await call('POST', `${base}/${refs.integrationB}/activate`, tokens.ownerA)).toMatchObject({ status: 404 })
    expect(await call('POST', `${base}/${refs.integrationA}/accounts`, tokens.ownerA, { paymentAccountId: refs.accountB })).toMatchObject({ status: 404 })
    expect(await call('POST', `${base}/${refs.integrationB}/accounts`, tokens.ownerA, { paymentAccountId: refs.accountA1 })).toMatchObject({ status: 404 })
    const [untouched] = await getDb().select().from(sepayIntegrations).where(eq(sepayIntegrations.id, refs.integrationB))
    expect(untouched!.encryptedHmacSecret).toBeNull()
  })

  it('treats another org\'s real integration exactly like a random id', async () => {
    const real = await call('GET', `/api/organizations/${ids.orgA}/sepay-integrations/${refs.integrationB}`, tokens.ownerA)
    const random = await call('GET', `/api/organizations/${ids.orgA}/sepay-integrations/${randomUUID()}`, tokens.ownerA)
    expect(real).toEqual(random)
  })

  it('a malformed integration id is 404', async () => {
    expect(await call('GET', `/api/organizations/${ids.orgA}/sepay-integrations/not-a-uuid`, tokens.ownerA))
      .toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
  })
})
```

(c) bổ sung `sepayIntegrations` vào import schema đầu file: `import { sepayIntegrations, stores } from '../../server/db/schema'`.

- [ ] **Step 4: Chạy ma trận**

Run: `npm run test:api -- tests/api/tenant-isolation.test.ts tests/api/payment-setup-api.test.ts`
Expected: PASS toàn bộ (kể cả các hàng cũ của PR1–PR4).

- [ ] **Step 5: Commit**

```bash
git add tests/api/payment-setup-api.test.ts tests/api/tenant-isolation.test.ts
git commit -m "test(payment-setup): cover owner payment routes, tenant matrix and secret non-disclosure" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 10: `POST /api/public/orders/:token/payment-attempts` — "Tạo mã mới" khi hết hạn

**Files:**
- Create: `server/api/public/orders/[token]/payment-attempts.post.ts`
- Modify: `tests/api/payment-setup-api.test.ts` (nối vào `// NEXT-API-TESTS`)

**Interfaces:**
- Consumes: `findOrderRefByGuestToken`, `createReplacementAttempt` (Task 7); `consumeRateLimit` (PR3); `REPAY_RATE_LIMIT` (Task 2); `defineApiHandler`, `AppError`, `getDb`.
- Produces: `POST /api/public/orders/:token/payment-attempts` → `{ qr: PaymentQr }`, **201** khi tạo mã mới, **200** khi trả lại mã đang hiệu lực; token sai/không tồn tại → 404 y hệt nhau; đơn không còn chờ chuyển khoản → 409 `STATUS_CONFLICT`; store tắt chuyển khoản → 422 `PAYMENT_METHOD_UNAVAILABLE`; quá `REPAY_RATE_LIMIT` (10 lần/10 phút/đơn) → 429 `RATE_LIMITED`; `Cache-Control: no-store`.

- [ ] **Step 1: Viết API test thất bại**

Thay dòng `// NEXT-API-TESTS` ở cuối `tests/api/payment-setup-api.test.ts` bằng:

```ts
describe('POST /api/public/orders/:token/payment-attempts', () => {
  async function freshOrder() {
    await clearRateLimits()
    const res = await bankQrOrder(seed.slug, seed.menu)
    expect([200, 201]).toContain(res.status)
    const guestToken = res.body.guestToken as string
    return { guestToken, qr: res.body.qr, orderId: (await orderByToken(guestToken)).id }
  }
  const repay = (guestToken: string) => call('POST', `/api/public/orders/${guestToken}/payment-attempts`, null)
  const lapse = (orderId: string) =>
    getDb().update(paymentAttempts).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(paymentAttempts.orderId, orderId))
  const attemptsOf = (orderId: string) =>
    getDb().select().from(paymentAttempts).where(eq(paymentAttempts.orderId, orderId)).orderBy(paymentAttempts.createdAt)

  it('returns the live QR (200) without creating anything on a double tap', async () => {
    const order = await freshOrder()
    const res = await repay(order.guestToken)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ qr: order.qr })
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await attemptsOf(order.orderId)).toHaveLength(1)
  })

  it('issues a new code (201) after expiry, supersedes the old attempt and shows the new QR on the order', async () => {
    const order = await freshOrder()
    await lapse(order.orderId)
    const res = await repay(order.guestToken)
    expect(res.status).toBe(201)
    expect(res.body.qr.transferContent).not.toBe(order.qr.transferContent)
    expect(res.body.qr).toMatchObject({ amountVnd: 70_000, accountNumber: '9988776655' })

    const rows = await attemptsOf(order.orderId)
    expect(rows.map(r => r.status)).toEqual(['SUPERSEDED', 'PENDING'])
    expect(rows[0]!.paymentCode).toBe(order.qr.transferContent)

    const tracking = await call('GET', `/api/public/orders/${order.guestToken}`)
    expect(tracking.body.qr).toEqual(res.body.qr)
    expect(findForbiddenKeys(res.body)).toEqual([])
    expect(JSON.stringify(res.body)).not.toContain(seed.orgId)
  })

  it('creates exactly one attempt for four concurrent taps after expiry (Review Focus #2)', async () => {
    const order = await freshOrder()
    await lapse(order.orderId)
    const results = await Promise.all(Array.from({ length: 4 }, () => repay(order.guestToken)))
    expect(results.map(r => r.status).sort()).toEqual([200, 200, 200, 201])
    expect(new Set(results.map(r => r.body.qr.transferContent)).size).toBe(1)
    const rows = await attemptsOf(order.orderId)
    expect(rows.filter(r => r.status === 'PENDING')).toHaveLength(1)
    expect(rows).toHaveLength(2)
  })

  it('keeps every old code on record across repeated re-pays (Review Focus #3)', async () => {
    const order = await freshOrder()
    for (let i = 0; i < 2; i++) {
      await lapse(order.orderId)
      expect((await repay(order.guestToken)).status).toBe(201)
    }
    const rows = await attemptsOf(order.orderId)
    expect(rows.map(r => r.status)).toEqual(['SUPERSEDED', 'SUPERSEDED', 'PENDING'])
    expect(new Set(rows.map(r => r.paymentCode)).size).toBe(3)
  })

  it('answers 404 identically for an unknown token and a malformed one', async () => {
    const unknown = await repay('A'.repeat(43))
    const malformed = await repay('not-a-token')
    expect(unknown).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
    expect(malformed.status).toBe(404)
    expect(malformed.body).toEqual(unknown.body)
  })

  it('answers 409 for a cash-on-receipt order and for an order that is already paid', async () => {
    await clearRateLimits()
    const cod = await call('POST', `/api/public/stores/${seed.slug}/orders`, null, pickupBody(seed.menu))
    expect(await repay(cod.body.guestToken)).toMatchObject({ status: 409, body: { code: 'STATUS_CONFLICT' } })

    const order = await freshOrder()
    await getDb().update(orders).set({ status: 'NEW', paymentStatus: 'PAID' }).where(eq(orders.id, order.orderId))
    expect(await repay(order.guestToken)).toMatchObject({ status: 409, body: { code: 'STATUS_CONFLICT' } })
    expect((await call('GET', `/api/public/orders/${order.guestToken}`)).body.qr).toBeNull()
  })

  it('answers 422 and keeps the old attempt when the store switched bank transfer off', async () => {
    const order = await freshOrder()
    await lapse(order.orderId)
    await getDb().update(sepayIntegrations).set({ status: 'DISABLED' }).where(eq(sepayIntegrations.orgId, seed.orgId))
    try {
      expect(await repay(order.guestToken)).toMatchObject({ status: 422, body: { code: 'PAYMENT_METHOD_UNAVAILABLE' } })
      expect((await attemptsOf(order.orderId)).map(r => r.status)).toEqual(['PENDING'])
    }
    finally {
      await getDb().update(sepayIntegrations).set({ status: 'ACTIVE' }).where(eq(sepayIntegrations.orgId, seed.orgId))
    }
  })

  it('rate-limits the eleventh call within ten minutes for one order', async () => {
    const order = await freshOrder()
    for (let i = 0; i < 10; i++) expect((await repay(order.guestToken)).status).toBe(200)
    expect(await repay(order.guestToken)).toMatchObject({ status: 429, body: { code: 'RATE_LIMITED' } })
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `npm run test:api -- tests/api/payment-setup-api.test.ts`
Expected: FAIL — route chưa tồn tại (404/405 thay vì 200/201).

- [ ] **Step 3: Viết route**

`server/api/public/orders/[token]/payment-attempts.post.ts`:

```ts
import { getRouterParam, setHeader, setResponseStatus } from 'h3'
import { getDb } from '../../../../db/client'
import { createReplacementAttempt, findOrderRefByGuestToken } from '../../../../services/payments/attempts'
import { REPAY_RATE_LIMIT } from '../../../../services/payments/constants'
import { consumeRateLimit } from '../../../../services/ordering/rate-limit'
import { defineApiHandler } from '../../../../utils/api-handler'
import { AppError } from '../../../../utils/errors'

export default defineApiHandler(async (event) => {
  const db = getDb()
  const ref = await findOrderRefByGuestToken(db, getRouterParam(event, 'token') ?? '')
  if (!ref) throw new AppError('NOT_FOUND', 'Không tìm thấy')
  if (!(await consumeRateLimit(db, `repay:${ref.orderId}`, REPAY_RATE_LIMIT))) {
    throw new AppError('RATE_LIMITED', 'Bạn thao tác quá nhanh, vui lòng thử lại sau')
  }
  const { qr, created } = await createReplacementAttempt(db, ref)
  setHeader(event, 'cache-control', 'no-store')
  setResponseStatus(event, created ? 201 : 200)
  return { qr }
})
```

- [ ] **Step 4: Chạy test để xác nhận đạt**

Run: `npm run test:api -- tests/api/payment-setup-api.test.ts && npm run typecheck`
Expected: PASS; typecheck sạch. Nếu `consumeRateLimit` của PR3 trả ngược nghĩa (`true` = bị chặn) thì sửa **điều kiện ở route này**, không đổi test.

- [ ] **Step 5: Commit**

```bash
git add server/api/public tests/api/payment-setup-api.test.ts
git commit -m "feat(payment-setup): add public re-pay endpoint superseding lapsed attempts" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 11: UI owner — một thao tác "Kiểm tra", kết nối SePay, trạng thái sẵn sàng

**Files:**
- Create: `app/utils/payment-readiness.ts`, `app/composables/usePaymentSetup.ts`, `app/components/settings/PaymentAccountCard.vue`, `app/components/settings/SepayCard.vue`, `app/components/settings/PaymentTab.vue`, `tests/unit/app/payment-readiness.test.ts`, `tests/nuxt/app/payment-account-card.test.ts`, `tests/nuxt/app/sepay-card.test.ts`
- Modify: `app/pages/app/settings.vue`

**Interfaces:**
- Consumes: `PaymentAccountDto`, `PaymentAccountCheck`, `SepayIntegrationDto` (Task 1); `VIETQR_BANKS`, `findBank`; routes Task 5, 6; `useApi`, `useToast`, `extractApiError`, `AppCopyField`, `ZCard/ZAlert/ZBadge/ZButton/ZFormField/ZInput/ZSelect` (UI foundation); `StoreDetail.orgId` (PR1).
- Produces:
  - `paymentReadiness(account: PaymentAccountDto | null, integration: SepayIntegrationDto | null): { step: PaymentStep; ready: boolean }`; `type PaymentStep = 'ACCOUNT' | 'CONFIRM_QR' | 'CONNECT_SEPAY' | 'SAVE_SECRET' | 'LINK_ACCOUNT' | 'WAIT_WEBHOOK' | 'ACTIVATE' | 'READY'`; `PAYMENT_STEP_TITLES: Record<PaymentStep, string>`.
  - `usePaymentSetup(ids: { storeId: MaybeRefOrGetter<string>; orgId: MaybeRefOrGetter<string> })` → `{ account, integration, check, loading, loadFailed, busy, fieldErrors, load, runCheck(draft), confirm(), connect(), saveSecret(input), link(), activate() }`; `interface PaymentAccountDraft { bankCode; accountNumber; accountHolder; vaNumber: string | null }`.
  - `<SettingsPaymentTab :store-id :org-id />` (tab "Thanh toán", chỉ owner).
  - Luồng ít bước nhất cho chủ quán: **chọn ngân hàng + số tài khoản + tên → "Kiểm tra" → "Đúng tên, xác nhận"**; phần SePay (kết nối → dán Secret → chờ giao dịch thử → "Bật nhận chuyển khoản") là bước thứ hai, hiện theo `paymentReadiness`.

- [ ] **Step 1: Viết unit test thất bại cho `paymentReadiness`**

`tests/unit/app/payment-readiness.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { PaymentAccountDto, SepayIntegrationDto } from '#shared/types/payment'
import { PAYMENT_STEP_TITLES, paymentReadiness } from '../../../app/utils/payment-readiness'

const account = (over: Partial<PaymentAccountDto> = {}): PaymentAccountDto => ({
  id: 'acc-1', bankCode: 'VCB', bankName: 'Vietcombank', accountNumber: '9988776655', vaNumber: null,
  accountHolder: 'NGUYEN VAN A', qrCheckedAt: '2026-11-01T05:00:00.000Z', verifiedAt: null, linkedIntegrationId: null, ...over,
})
const integration = (over: Partial<SepayIntegrationDto> = {}): SepayIntegrationDto => ({
  id: 'int-1', name: 'SePay', environment: 'live', status: 'DRAFT', hasSecret: false, hasApiToken: false,
  secretUpdatedAt: null, lastValidWebhookAt: null, updatedAt: '2026-11-01T05:00:00.000Z', webhookUrl: 'https://x/api/webhooks/sepay/k', accountIds: [], ...over,
})

describe('paymentReadiness', () => {
  it('walks through the steps in order', () => {
    expect(paymentReadiness(null, null).step).toBe('ACCOUNT')
    expect(paymentReadiness(account({ qrCheckedAt: null }), null).step).toBe('CONFIRM_QR')
    expect(paymentReadiness(account(), null).step).toBe('CONNECT_SEPAY')
    expect(paymentReadiness(account(), integration()).step).toBe('SAVE_SECRET')
    expect(paymentReadiness(account(), integration({ hasSecret: true, status: 'TESTING' })).step).toBe('LINK_ACCOUNT')
    expect(paymentReadiness(account(), integration({ hasSecret: true, status: 'TESTING', accountIds: ['acc-1'] })).step).toBe('WAIT_WEBHOOK')
    expect(paymentReadiness(account(), integration({ hasSecret: true, status: 'TESTING', accountIds: ['acc-1'], lastValidWebhookAt: '2026-11-01T06:00:00.000Z' })).step).toBe('ACTIVATE')
  })

  it('is ready only with an ACTIVE integration and a verified account', () => {
    const active = integration({ hasSecret: true, status: 'ACTIVE', accountIds: ['acc-1'], lastValidWebhookAt: '2026-11-01T06:00:00.000Z' })
    expect(paymentReadiness(account({ verifiedAt: '2026-11-01T06:01:00.000Z' }), active)).toEqual({ step: 'READY', ready: true })
    expect(paymentReadiness(account(), active).ready).toBe(false)
  })

  it('falls back to the QR check when the owner edited the account after going live', () => {
    const active = integration({ hasSecret: true, status: 'ACTIVE', accountIds: ['acc-1'], lastValidWebhookAt: '2026-11-01T06:00:00.000Z' })
    expect(paymentReadiness(account({ qrCheckedAt: null, verifiedAt: null }), active)).toEqual({ step: 'CONFIRM_QR', ready: false })
  })

  it('has a Vietnamese title for every step', () => {
    for (const title of Object.values(PAYMENT_STEP_TITLES)) expect(title.length).toBeGreaterThan(5)
    expect(Object.keys(PAYMENT_STEP_TITLES)).toHaveLength(8)
  })
})
```

- [ ] **Step 2: Viết test component thất bại**

`tests/nuxt/app/payment-account-card.test.ts`:

```ts
import { renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import type { PaymentAccountCheck, PaymentAccountDto } from '#shared/types/payment'
import PaymentAccountCard from '~/components/settings/PaymentAccountCard.vue'

const account = (over: Partial<PaymentAccountDto> = {}): PaymentAccountDto => ({
  id: 'acc-1', bankCode: 'VCB', bankName: 'Vietcombank', accountNumber: '9988776655', vaNumber: null,
  accountHolder: 'NGUYEN VAN A', qrCheckedAt: null, verifiedAt: null, linkedIntegrationId: null, ...over,
})
const okCheck: PaymentAccountCheck = {
  ok: true, issues: [], warnings: [],
  preview: {
    bankName: 'Vietcombank', accountNumber: '9988776655', accountHolder: 'NGUYEN VAN A', amountVnd: 2000,
    transferContent: 'ZOTEST0000', imageUrl: 'https://vietqr.app/img?acc=9988776655&bank=970436&amount=2000&des=ZOTEST0000&template=qronly',
  },
}
const base = { account: null as PaymentAccountDto | null, check: null as PaymentAccountCheck | null, busy: null, fieldErrors: {} }

describe('PaymentAccountCard', () => {
  it('emits the draft when the owner presses "Kiểm tra"', async () => {
    const { emitted } = await renderSuspended(PaymentAccountCard, { props: { ...base, account: account() } })
    await fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra' }))
    expect(emitted().check).toEqual([[{ bankCode: 'VCB', accountNumber: '9988776655', accountHolder: 'NGUYEN VAN A', vaNumber: null }]])
  })

  it('keeps "Kiểm tra" disabled until bank, number and name are filled', async () => {
    await renderSuspended(PaymentAccountCard, { props: base })
    expect((screen.getByRole('button', { name: 'Kiểm tra' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('asks for a VA number only for banks that require one', async () => {
    const view = await renderSuspended(PaymentAccountCard, { props: { ...base, account: account({ bankCode: 'MSB', bankName: 'MSB' }) } })
    expect(screen.getByLabelText('Số tài khoản ảo (VA)')).toBeTruthy()
    expect(screen.getByText(/chỉ nhận tiền qua tài khoản ảo/i)).toBeTruthy()
    view.unmount()
    await renderSuspended(PaymentAccountCard, { props: { ...base, account: account() } })
    expect(screen.queryByLabelText('Số tài khoản ảo (VA)')).toBeNull()
  })

  it('shows the check QR with the holder to look for, and confirms on one tap', async () => {
    const { emitted } = await renderSuspended(PaymentAccountCard, { props: { ...base, account: account(), check: okCheck } })
    const qr = screen.getByAltText('Mã QR kiểm tra 2.000đ') as HTMLImageElement
    expect(qr.getAttribute('src')).toBe(okCheck.preview!.imageUrl)
    expect(qr.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(screen.getByTestId('payment-preview').textContent).toContain('NGUYEN VAN A')
    await fireEvent.click(screen.getByRole('button', { name: 'Đúng tên, xác nhận' }))
    expect(emitted().confirm).toHaveLength(1)
  })

  it('shows a success state, not the confirm button, once the QR check is recorded', async () => {
    await renderSuspended(PaymentAccountCard, { props: { ...base, account: account({ qrCheckedAt: '2026-11-01T05:00:00.000Z' }) } })
    expect(screen.getByText('Đã kiểm tra tài khoản')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Đúng tên, xác nhận' })).toBeNull()
  })

  it('lists issues and warnings from the check', async () => {
    const check: PaymentAccountCheck = {
      ok: false, preview: null, warnings: [],
      issues: [{ field: 'vaNumber', message: 'MSB chỉ nhận tiền qua tài khoản ảo (VA), hãy nhập số VA' }],
    }
    await renderSuspended(PaymentAccountCard, { props: { ...base, account: account({ bankCode: 'MSB', bankName: 'MSB' }), check } })
    expect(screen.getAllByRole('alert').some(el => el.textContent?.includes('hãy nhập số VA'))).toBe(true)
    expect(screen.queryByTestId('payment-preview')).toBeNull()
  })

  it('surfaces server-side field errors', async () => {
    await renderSuspended(PaymentAccountCard, { props: { ...base, account: account(), fieldErrors: { accountNumber: 'Số tài khoản gồm 6–19 chữ hoặc số' } } })
    expect(screen.getByText('Số tài khoản gồm 6–19 chữ hoặc số')).toBeTruthy()
  })
})
```

`tests/nuxt/app/sepay-card.test.ts`:

```ts
import { renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import type { SepayIntegrationDto } from '#shared/types/payment'
import SepayCard from '~/components/settings/SepayCard.vue'

const integration = (over: Partial<SepayIntegrationDto> = {}): SepayIntegrationDto => ({
  id: 'int-1', name: 'SePay', environment: 'live', status: 'DRAFT', hasSecret: false, hasApiToken: false,
  secretUpdatedAt: null, lastValidWebhookAt: null, updatedAt: '2026-11-01T05:00:00.000Z',
  webhookUrl: 'https://zeno.example/api/webhooks/sepay/abcdefghijklmnopqrstuvwxyz012345', accountIds: [], ...over,
})
const base = { integration: null as SepayIntegrationDto | null, step: 'CONNECT_SEPAY' as const, busy: null }

describe('SepayCard', () => {
  it('asks the owner to finish the account first', async () => {
    await renderSuspended(SepayCard, { props: { ...base, step: 'CONFIRM_QR' } })
    expect(screen.getByText(/Hoàn tất tài khoản nhận tiền trước/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Kết nối SePay' })).toBeNull()
  })

  it('connects with one tap', async () => {
    const { emitted } = await renderSuspended(SepayCard, { props: base })
    await fireEvent.click(screen.getByRole('button', { name: 'Kết nối SePay' }))
    expect(emitted().connect).toHaveLength(1)
  })

  it('shows the webhook URL and the verified SePay setup (prefix ZO, 8 chars, Số và chữ, HMAC-SHA256)', async () => {
    const dto = integration()
    await renderSuspended(SepayCard, { props: { ...base, integration: dto, step: 'SAVE_SECRET' } })
    expect((screen.getByLabelText('URL webhook') as HTMLInputElement).value).toBe(dto.webhookUrl)
    const text = document.body.textContent ?? ''
    for (const expected of ['ZO', 'Số và chữ', 'HMAC-SHA256', 'Tiền vào', 'chỉ hiện đầy đủ một lần']) expect(text).toContain(expected)
  })

  it('emits a trimmed secret, omits an empty API token, and clears the field once the save lands', async () => {
    const { emitted, rerender } = await renderSuspended(SepayCard, { props: { ...base, integration: integration(), step: 'SAVE_SECRET' } })
    await fireEvent.update(screen.getByLabelText('Secret Key (HMAC-SHA256)'), '  whsec_0123456789 ')
    await fireEvent.click(screen.getByRole('button', { name: 'Lưu Secret' }))
    expect(emitted()['save-secret']).toEqual([[{ hmacSecret: 'whsec_0123456789' }]])

    await rerender({ integration: integration({ hasSecret: true, status: 'TESTING', secretUpdatedAt: '2026-11-01T05:05:00.000Z' }), step: 'LINK_ACCOUNT' })
    expect(document.body.innerHTML).not.toContain('whsec_0123456789')
  })

  it('never renders a saved secret: only a flag and a "change" action', async () => {
    await renderSuspended(SepayCard, { props: { ...base, integration: integration({ hasSecret: true, status: 'TESTING', secretUpdatedAt: '2026-11-01T05:05:00.000Z' }), step: 'WAIT_WEBHOOK' } })
    expect(screen.getByText('Đã lưu Secret Key')).toBeTruthy()
    expect(screen.queryByLabelText('Secret Key (HMAC-SHA256)')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'Đổi Secret' }))
    expect(screen.getByLabelText('Secret Key (HMAC-SHA256)')).toBeTruthy()
  })

  it('explains the wait for the first SePay transaction and lets the owner reload', async () => {
    const { emitted } = await renderSuspended(SepayCard, { props: { ...base, integration: integration({ hasSecret: true, status: 'TESTING' }), step: 'WAIT_WEBHOOK' } })
    expect(screen.getByText('Chờ giao dịch đầu tiên từ SePay')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Tải lại' }))
    expect(emitted().refresh).toHaveLength(1)
  })

  it('offers to turn bank transfer on once a valid webhook arrived, and shows success when ready', async () => {
    const { emitted } = await renderSuspended(SepayCard, { props: { ...base, integration: integration({ hasSecret: true, status: 'TESTING' }), step: 'ACTIVATE' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Bật nhận chuyển khoản' }))
    expect(emitted().activate).toHaveLength(1)
  })

  it('shows the success state when ready', async () => {
    await renderSuspended(SepayCard, { props: { ...base, integration: integration({ hasSecret: true, status: 'ACTIVE' }), step: 'READY' } })
    expect(screen.getByText('Đang nhận chuyển khoản tự động')).toBeTruthy()
  })
})
```

- [ ] **Step 3: Chạy test để xác nhận thất bại**

Run: `npx vitest run --project unit tests/unit/app/payment-readiness.test.ts; npx vitest run --project nuxt tests/nuxt/app/payment-account-card.test.ts tests/nuxt/app/sepay-card.test.ts`
Expected: FAIL — thiếu `app/utils/payment-readiness` và hai component.

- [ ] **Step 4: Viết `payment-readiness.ts`**

`app/utils/payment-readiness.ts`:

```ts
import type { PaymentAccountDto, SepayIntegrationDto } from '#shared/types/payment'

export type PaymentStep = 'ACCOUNT' | 'CONFIRM_QR' | 'CONNECT_SEPAY' | 'SAVE_SECRET' | 'LINK_ACCOUNT' | 'WAIT_WEBHOOK' | 'ACTIVATE' | 'READY'

export const PAYMENT_STEP_TITLES: Record<PaymentStep, string> = {
  ACCOUNT: 'Thêm tài khoản nhận tiền để bật chuyển khoản',
  CONFIRM_QR: 'Quét mã QR kiểm tra để xác nhận tài khoản',
  CONNECT_SEPAY: 'Kết nối SePay để tự động xác nhận tiền về',
  SAVE_SECRET: 'Dán Secret Key từ SePay',
  LINK_ACCOUNT: 'Liên kết tài khoản với SePay',
  WAIT_WEBHOOK: 'Chờ giao dịch đầu tiên từ SePay',
  ACTIVATE: 'Sẵn sàng bật nhận chuyển khoản',
  READY: 'Sẵn sàng nhận chuyển khoản',
}

export function paymentReadiness(
  account: PaymentAccountDto | null,
  integration: SepayIntegrationDto | null,
): { step: PaymentStep, ready: boolean } {
  if (!account) return { step: 'ACCOUNT', ready: false }
  if (!account.qrCheckedAt) return { step: 'CONFIRM_QR', ready: false }
  if (!integration) return { step: 'CONNECT_SEPAY', ready: false }
  if (!integration.hasSecret) return { step: 'SAVE_SECRET', ready: false }
  if (!integration.accountIds.includes(account.id)) return { step: 'LINK_ACCOUNT', ready: false }
  if (integration.status === 'ACTIVE' && account.verifiedAt) return { step: 'READY', ready: true }
  if (integration.lastValidWebhookAt) return { step: 'ACTIVATE', ready: false }
  return { step: 'WAIT_WEBHOOK', ready: false }
}
```

- [ ] **Step 5: Viết composable**

`app/composables/usePaymentSetup.ts`:

```ts
import type { MaybeRefOrGetter } from 'vue'
import type { PaymentAccountCheck, PaymentAccountDto, SepayIntegrationDto } from '#shared/types/payment'

export interface PaymentAccountDraft {
  bankCode: string
  accountNumber: string
  accountHolder: string
  vaNumber: string | null
}

type Busy = 'check' | 'confirm' | 'connect' | 'secret' | 'link' | 'activate'

export function usePaymentSetup(ids: { storeId: MaybeRefOrGetter<string>, orgId: MaybeRefOrGetter<string> }) {
  const api = useApi()
  const toast = useToast()

  const account = ref<PaymentAccountDto | null>(null)
  const integration = ref<SepayIntegrationDto | null>(null)
  const check = ref<PaymentAccountCheck | null>(null)
  const loading = ref(true)
  const loadFailed = ref(false)
  const busy = ref<Busy | null>(null)
  const fieldErrors = ref<Record<string, string>>({})

  const storePath = () => `/api/stores/${toValue(ids.storeId)}/payment-accounts`
  const orgPath = () => `/api/organizations/${toValue(ids.orgId)}/sepay-integrations`

  async function reloadAccount() {
    account.value = (await api<{ account: PaymentAccountDto | null }>(storePath())).account
  }

  async function load() {
    loading.value = true
    loadFailed.value = false
    try {
      const [accountRes, integrationRes] = await Promise.all([
        api<{ account: PaymentAccountDto | null }>(storePath()),
        api<{ integrations: SepayIntegrationDto[] }>(orgPath()),
      ])
      account.value = accountRes.account
      integration.value = integrationRes.integrations.find(i => i.environment === 'live') ?? integrationRes.integrations[0] ?? null
      check.value = null
    }
    catch {
      loadFailed.value = true
    }
    finally {
      loading.value = false
    }
  }

  async function guarded(kind: Busy, action: () => Promise<void>, success?: string): Promise<boolean> {
    busy.value = kind
    fieldErrors.value = {}
    try {
      await action()
      if (success) toast.add({ color: 'success', title: success })
      return true
    }
    catch (err) {
      const apiError = extractApiError(err)
      if (apiError.code === 'VALIDATION_FAILED' && Array.isArray(apiError.details)) {
        fieldErrors.value = Object.fromEntries((apiError.details as { path: string, message: string }[]).map(d => [d.path, d.message]))
      }
      toast.add({ color: 'error', title: apiError.message })
      return false
    }
    finally {
      busy.value = null
    }
  }

  const runCheck = (draft: PaymentAccountDraft) => guarded('check', async () => {
    const saved = account.value
      ? await api<PaymentAccountDto>(`${storePath()}/${account.value.id}`, { method: 'PATCH', body: draft })
      : await api<PaymentAccountDto>(storePath(), { method: 'POST', body: draft })
    account.value = saved
    check.value = await api<PaymentAccountCheck>(`${storePath()}/${saved.id}/check`, { method: 'POST' })
  })

  const confirm = () => guarded('confirm', async () => {
    if (!account.value) return
    account.value = await api<PaymentAccountDto>(`${storePath()}/${account.value.id}/confirm-qr`, { method: 'POST' })
    check.value = null
  }, 'Đã xác nhận tài khoản nhận tiền')

  const connect = () => guarded('connect', async () => {
    integration.value = await api<SepayIntegrationDto>(orgPath(), { method: 'POST', body: {} })
  })

  const link = () => guarded('link', async () => {
    if (!integration.value || !account.value) return
    integration.value = await api<SepayIntegrationDto>(`${orgPath()}/${integration.value.id}/accounts`, {
      method: 'POST',
      body: { paymentAccountId: account.value.id },
    })
    await reloadAccount()
  })

  const saveSecret = (input: { hmacSecret: string, apiToken?: string }) => guarded('secret', async () => {
    if (!integration.value) return
    integration.value = await api<SepayIntegrationDto>(`${orgPath()}/${integration.value.id}/secret`, { method: 'PUT', body: input })
    const current = account.value
    if (current && !integration.value.accountIds.includes(current.id)) {
      integration.value = await api<SepayIntegrationDto>(`${orgPath()}/${integration.value.id}/accounts`, {
        method: 'POST',
        body: { paymentAccountId: current.id },
      })
      await reloadAccount()
    }
  }, 'Đã lưu Secret Key')

  const activate = () => guarded('activate', async () => {
    if (!integration.value) return
    integration.value = await api<SepayIntegrationDto>(`${orgPath()}/${integration.value.id}/activate`, { method: 'POST' })
    await reloadAccount()
  }, 'Đã bật nhận chuyển khoản')

  return { account, integration, check, loading, loadFailed, busy, fieldErrors, load, runCheck, confirm, connect, link, saveSecret, activate }
}
```

- [ ] **Step 6: Viết ba component**

`app/components/settings/PaymentAccountCard.vue`:

```vue
<script setup lang="ts">
import { findBank, VIETQR_BANKS } from '#shared/banks'
import type { PaymentAccountCheck, PaymentAccountDto } from '#shared/types/payment'
import type { PaymentAccountDraft } from '~/composables/usePaymentSetup'

const props = defineProps<{
  account: PaymentAccountDto | null
  check: PaymentAccountCheck | null
  busy: string | null
  fieldErrors: Record<string, string>
}>()
const emit = defineEmits<{ check: [draft: PaymentAccountDraft], confirm: [] }>()

const draft = reactive<PaymentAccountDraft>({ bankCode: '', accountNumber: '', accountHolder: '', vaNumber: null })
watch(() => props.account, (account) => {
  draft.bankCode = account?.bankCode ?? ''
  draft.accountNumber = account?.accountNumber ?? ''
  draft.accountHolder = account?.accountHolder ?? ''
  draft.vaNumber = account?.vaNumber ?? null
}, { immediate: true })

const bankItems = VIETQR_BANKS.map(bank => ({ label: `${bank.shortName} (${bank.code})`, value: bank.code }))
const bankCode = computed({
  get: () => draft.bankCode || undefined,
  set: (value) => { draft.bankCode = value ?? '' },
})
const bank = computed(() => findBank(draft.bankCode))
const vaRequired = computed(() => bank.value?.vaPolicy === 'REQUIRED')
const vaModel = computed({
  get: () => draft.vaNumber ?? '',
  set: (value) => { draft.vaNumber = value },
})

const errors = computed<Record<string, string>>(() => ({
  ...Object.fromEntries((props.check?.issues ?? []).map(issue => [issue.field, issue.message])),
  ...props.fieldErrors,
}))

const canSubmit = computed(() => draft.bankCode !== ''
  && draft.accountNumber.trim() !== ''
  && draft.accountHolder.trim() !== ''
  && (!vaRequired.value || (draft.vaNumber ?? '').trim() !== ''))

const dismissed = ref(false)
watch(() => props.check, () => { dismissed.value = false })
const showPreview = computed(() => props.check?.ok === true && props.check.preview !== null && !dismissed.value)

function submit() {
  if (!canSubmit.value) return
  emit('check', {
    bankCode: draft.bankCode,
    accountNumber: draft.accountNumber,
    accountHolder: draft.accountHolder,
    vaNumber: vaRequired.value ? draft.vaNumber : (props.account?.vaNumber ?? null),
  })
}
</script>

<template>
  <ZCard title="Tài khoản nhận tiền" description="Tiền khách chuyển khoản sẽ vào tài khoản này." padding="lg">
    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <ZFormField label="Ngân hàng" name="bankCode" required>
        <div class="flex flex-col gap-1.5">
          <ZSelect v-model="bankCode" :items="bankItems" placeholder="Chọn ngân hàng" size="lg" aria-label="Ngân hàng" />
          <p v-if="errors.bankCode" class="text-[13px] font-medium text-error" role="alert">
            {{ errors.bankCode }}
          </p>
        </div>
      </ZFormField>

      <ZAlert
        v-if="bank && vaRequired"
        color="warning"
        :title="`${bank.shortName} chỉ nhận tiền qua tài khoản ảo (VA)`"
        description="Nhập số tài khoản ảo bạn đã tạo trên SePay ở ô bên dưới, khách sẽ chuyển vào số này."
      />

      <ZFormField label="Số tài khoản" name="accountNumber" required>
        <div class="flex flex-col gap-1.5">
          <ZInput v-model="draft.accountNumber" size="lg" inputmode="numeric" autocomplete="off" />
          <p v-if="errors.accountNumber" class="text-[13px] font-medium text-error" role="alert">
            {{ errors.accountNumber }}
          </p>
        </div>
      </ZFormField>

      <ZFormField v-if="vaRequired" label="Số tài khoản ảo (VA)" name="vaNumber" required>
        <div class="flex flex-col gap-1.5">
          <ZInput v-model="vaModel" size="lg" autocomplete="off" />
          <p v-if="errors.vaNumber" class="text-[13px] font-medium text-error" role="alert">
            {{ errors.vaNumber }}
          </p>
        </div>
      </ZFormField>

      <ZFormField label="Tên chủ tài khoản" name="accountHolder" required help="Viết hoa, không dấu, đúng như app ngân hàng hiển thị.">
        <div class="flex flex-col gap-1.5">
          <ZInput v-model="draft.accountHolder" size="lg" autocomplete="off" autocapitalize="characters" />
          <p v-if="errors.accountHolder" class="text-[13px] font-medium text-error" role="alert">
            {{ errors.accountHolder }}
          </p>
        </div>
      </ZFormField>

      <ZAlert v-for="warning in check?.warnings ?? []" :key="warning" color="warning" :title="warning" />

      <ZButton type="submit" size="lg" block icon="i-lucide-scan-line" :loading="busy === 'check'" :disabled="!canSubmit">
        Kiểm tra
      </ZButton>
    </form>

    <div
      v-if="showPreview && check?.preview"
      class="mt-5 flex flex-col items-center gap-3 rounded-md bg-(--zeno-surface-inset) p-4"
      data-testid="payment-preview"
    >
      <img
        :src="check.preview.imageUrl"
        width="220"
        height="220"
        alt="Mã QR kiểm tra 2.000đ"
        referrerpolicy="no-referrer"
        class="size-[220px] rounded-md bg-white p-2"
      >
      <p class="text-center text-sm">
        Mở app ngân hàng và quét mã này (2.000đ). Tên người nhận phải là
        <strong>{{ check.preview.accountHolder }}</strong>.
      </p>
      <div class="flex w-full flex-col gap-2">
        <ZButton v-if="!account?.qrCheckedAt" block size="lg" :loading="busy === 'confirm'" @click="emit('confirm')">
          Đúng tên, xác nhận
        </ZButton>
        <ZButton variant="ghost" block @click="dismissed = true">
          Sửa lại
        </ZButton>
      </div>
    </div>

    <ZAlert
      v-else-if="account?.qrCheckedAt"
      class="mt-5"
      color="success"
      title="Đã kiểm tra tài khoản"
      :description="`${account.bankName} · ${account.vaNumber ?? account.accountNumber} · ${account.accountHolder}`"
    />
  </ZCard>
</template>
```

`app/components/settings/SepayCard.vue`:

```vue
<script setup lang="ts">
import type { SepayIntegrationDto } from '#shared/types/payment'
import type { PaymentStep } from '~/utils/payment-readiness'

const props = defineProps<{
  integration: SepayIntegrationDto | null
  step: PaymentStep
  busy: string | null
}>()
const emit = defineEmits<{
  'connect': []
  'save-secret': [input: { hmacSecret: string, apiToken?: string }]
  'link': []
  'activate': []
  'refresh': []
}>()

const hmacSecret = ref('')
const apiToken = ref('')
const editing = ref(false)

// Secrets must not linger in the DOM: clear the fields as soon as the server confirms a save.
watch(() => props.integration?.secretUpdatedAt, () => {
  hmacSecret.value = ''
  apiToken.value = ''
  editing.value = false
})

const accountReady = computed(() => props.step !== 'ACCOUNT' && props.step !== 'CONFIRM_QR')
const showSecretForm = computed(() => !!props.integration && (!props.integration.hasSecret || editing.value))

function saveSecret() {
  const secret = hmacSecret.value.trim()
  if (!secret) return
  const token = apiToken.value.trim()
  emit('save-secret', token ? { hmacSecret: secret, apiToken: token } : { hmacSecret: secret })
}
</script>

<template>
  <ZCard title="Nhận tiền tự động (SePay)" description="SePay báo về khi khách chuyển khoản; đơn tự chuyển sang đã thanh toán." padding="lg">
    <ZAlert v-if="!accountReady" color="info" title="Hoàn tất tài khoản nhận tiền trước" description="Kiểm tra tài khoản ở trên, sau đó quay lại đây để kết nối SePay." />

    <div v-else-if="!integration" class="flex flex-col gap-3">
      <p class="text-sm text-muted">
        Bạn cần tài khoản SePay đã liên kết ngân hàng. Kết nối chỉ mất vài phút.
      </p>
      <ZButton size="lg" block icon="i-lucide-plug-zap" :loading="busy === 'connect'" @click="emit('connect')">
        Kết nối SePay
      </ZButton>
    </div>

    <div v-else class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-2">
        <ZBadge :status="integration.status === 'ACTIVE' ? 'success' : 'info'">
          {{ integration.status === 'ACTIVE' ? 'Đang hoạt động' : 'Đang thiết lập' }}
        </ZBadge>
        <ZBadge v-if="integration.hasSecret" status="success" icon="i-lucide-lock-keyhole">
          Đã lưu Secret Key
        </ZBadge>
      </div>

      <template v-if="showSecretForm">
        <ol class="flex list-decimal flex-col gap-2 ps-5 text-sm">
          <li>
            Trên <strong>my.sepay.vn → Cấu hình công ty → Cấu hình chung → Cấu trúc mã thanh toán</strong>: tiền tố <strong>ZO</strong>,
            độ dài hậu tố tối thiểu và tối đa đều <strong>8</strong>, loại ký tự <strong>Số và chữ</strong>.
          </li>
          <li>
            Trên <strong>Tích hợp → Webhooks → Thêm webhook</strong>: dán URL bên dưới, loại sự kiện <strong>Tiền vào</strong>,
            xác thực <strong>HMAC-SHA256</strong>.
          </li>
          <li>SePay chỉ hiện đầy đủ một lần: sao chép Secret Key và dán vào ô bên dưới ngay.</li>
        </ol>
        <AppCopyField :value="integration.webhookUrl" label="URL webhook" />
        <ZFormField label="Secret Key (HMAC-SHA256)" name="hmacSecret" required>
          <ZInput v-model="hmacSecret" type="password" size="lg" autocomplete="off" />
        </ZFormField>
        <ZFormField label="Token API đối soát (không bắt buộc)" name="apiToken" help="Dùng để đối soát giao dịch bị lỡ webhook.">
          <ZInput v-model="apiToken" type="password" size="lg" autocomplete="off" />
        </ZFormField>
        <ZButton size="lg" block :loading="busy === 'secret'" :disabled="hmacSecret.trim() === ''" @click="saveSecret">
          Lưu Secret
        </ZButton>
      </template>
      <ZButton v-else-if="integration.hasSecret" variant="ghost" class="self-start" @click="editing = true">
        Đổi Secret
      </ZButton>

      <ZAlert v-if="step === 'LINK_ACCOUNT'" color="info" title="Liên kết tài khoản với SePay">
        <template #actions>
          <ZButton size="sm" :loading="busy === 'link'" @click="emit('link')">
            Liên kết tài khoản
          </ZButton>
        </template>
      </ZAlert>

      <ZAlert
        v-if="step === 'WAIT_WEBHOOK'"
        color="info"
        title="Chờ giao dịch đầu tiên từ SePay"
        description="Chuyển khoản một khoản nhỏ vào tài khoản đã liên kết SePay (có thể quét mã QR kiểm tra 2.000đ ở trên) rồi bấm Tải lại."
      >
        <template #actions>
          <ZButton variant="secondary" size="sm" icon="i-lucide-refresh-cw" @click="emit('refresh')">
            Tải lại
          </ZButton>
        </template>
      </ZAlert>

      <ZButton v-if="step === 'ACTIVATE'" size="lg" block icon="i-lucide-badge-check" :loading="busy === 'activate'" @click="emit('activate')">
        Bật nhận chuyển khoản
      </ZButton>

      <ZAlert v-if="step === 'READY'" color="success" title="Đang nhận chuyển khoản tự động" description="Khách chọn VietQR sẽ thấy mã đúng ngân hàng, số tiền và nội dung." />
    </div>
  </ZCard>
</template>
```

`app/components/settings/PaymentTab.vue`:

```vue
<script setup lang="ts">
const props = defineProps<{ storeId: string, orgId: string }>()

const { account, integration, check, loading, loadFailed, busy, fieldErrors, load, runCheck, confirm, connect, link, saveSecret, activate }
  = usePaymentSetup({ storeId: () => props.storeId, orgId: () => props.orgId })
const readiness = computed(() => paymentReadiness(account.value, integration.value))

onMounted(load)
watch(() => props.storeId, load)
</script>

<template>
  <div class="flex flex-col gap-6">
    <div v-if="loading && !account && !integration" class="flex flex-col gap-4" aria-busy="true" aria-label="Đang tải thanh toán">
      <USkeleton v-for="i in 2" :key="i" class="h-40 w-full rounded-md" />
    </div>

    <ZAlert v-else-if="loadFailed" color="error" title="Không tải được cài đặt thanh toán">
      <template #actions>
        <ZButton variant="secondary" size="sm" icon="i-lucide-refresh-cw" @click="load()">
          Thử lại
        </ZButton>
      </template>
    </ZAlert>

    <template v-else>
      <ZAlert :color="readiness.ready ? 'success' : 'info'" :title="PAYMENT_STEP_TITLES[readiness.step]" />
      <SettingsPaymentAccountCard
        :account="account"
        :check="check"
        :busy="busy"
        :field-errors="fieldErrors"
        @check="runCheck"
        @confirm="confirm"
      />
      <SettingsSepayCard
        :integration="integration"
        :step="readiness.step"
        :busy="busy"
        @connect="connect"
        @save-secret="saveSecret"
        @link="link"
        @activate="activate"
        @refresh="load"
      />
    </template>
  </div>
</template>
```

- [ ] **Step 7: Nối vào `settings.vue`**

Plan PR2 đã chuyển `app/pages/app/settings.vue` sang tab (`ZTabs`, mỗi tab là component trong `app/components/settings/`). Hai chỗ thêm (đổi tên biến theo file thật của PR2 nếu khác; `store` là `StoreDetail` đã tải ở đầu trang, `isOwner` đã có):

(a) trong danh sách tab (mảng `items`/`tabs` do PR2 định nghĩa) thêm mục chỉ cho owner:

```ts
...(isOwner.value ? [{ label: 'Thanh toán', value: 'payment' }] : []),
```

(b) trong template, cạnh các tab khác:

```vue
<SettingsPaymentTab v-if="activeTab === 'payment' && isOwner && store" :store-id="store.id" :org-id="store.orgId" />
```

(`activeTab` là biến `v-model` của `ZTabs` ở PR2.) Nếu PR2 render tab bằng slot theo `value`, đặt `<SettingsPaymentTab …/>` vào slot `#payment`. Giữ nguyên thanh lưu thay đổi của tab "Cửa hàng": tab Thanh toán tự lưu từng bước nên không ảnh hưởng `isDirty`.

- [ ] **Step 8: Chạy test, lint, typecheck**

Run: `npx vitest run --project unit tests/unit/app/payment-readiness.test.ts && npx vitest run --project nuxt tests/nuxt/app/payment-account-card.test.ts tests/nuxt/app/sepay-card.test.ts && npm run lint && npm run typecheck`
Expected: PASS. `PaymentTab.vue` nằm trong `components/` nên được dùng `USkeleton` như `settings.vue` hiện tại; nếu lint chặn thì thay bằng `<div class="h-40 animate-pulse rounded-md bg-(--zeno-surface-inset)">`.

- [ ] **Step 9: Commit**

```bash
git add app/utils/payment-readiness.ts app/composables/usePaymentSetup.ts app/components/settings app/pages/app/settings.vue tests/unit/app/payment-readiness.test.ts tests/nuxt/app/payment-account-card.test.ts tests/nuxt/app/sepay-card.test.ts
git commit -m "feat(payment-setup): add owner payment tab with one-tap account check and SePay wizard" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 12: UI khách — màn chờ thanh toán trên `/o/:token` (QR, sao chép, lưu ảnh, đếm ngược, tạo mã mới)

**Files:**
- Create: `app/utils/countdown.ts`, `app/components/order/PaymentPanel.vue`, `tests/unit/app/countdown.test.ts`, `tests/nuxt/app/payment-panel.test.ts`
- Modify: `app/pages/o/[token].vue`

**Interfaces:**
- Consumes: `PaymentQr` (PR3), `formatVnd` (`#shared/money`), `ZCard/ZAlert/ZButton`; `POST /api/public/orders/:token/payment-attempts` (Task 10); trang `/o/[token]` của PR3 (poll 4 s, có `order: PublicOrderView`, `refresh`, `token`).
- Produces:
  - `remainingSeconds(expiresAt: string, nowMs: number): number` (≥ 0, `NaN` → 0), `formatCountdown(totalSeconds: number): string` (`mm:ss`).
  - `<OrderPaymentPanel :qr :total-vnd :public-code :repaying @repay @expired />` — `qr` còn hạn: QR + số tiền + đếm ngược + sao chép số tài khoản/số tiền/nội dung + "Lưu ảnh QR"; `qr = null` hoặc hết hạn: cảnh báo + nút "Tạo mã mới"; phát `expired` đúng một lần khi đếm ngược về 0; ảnh QR có `referrerpolicy="no-referrer"`; mỗi dòng có `data-testid="payment-account|content|amount"`.

- [ ] **Step 1: Viết unit test thất bại cho `countdown`**

`tests/unit/app/countdown.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatCountdown, remainingSeconds } from '../../../app/utils/countdown'

describe('remainingSeconds', () => {
  const expiresAt = '2026-11-01T05:15:00.000Z'
  const at = (iso: string) => Date.parse(iso)

  it('counts whole seconds up to the expiry, rounding up', () => {
    expect(remainingSeconds(expiresAt, at('2026-11-01T05:00:00.000Z'))).toBe(900)
    expect(remainingSeconds(expiresAt, at('2026-11-01T05:14:59.200Z'))).toBe(1)
  })

  it('never goes negative', () => {
    expect(remainingSeconds(expiresAt, at('2026-11-01T05:15:00.000Z'))).toBe(0)
    expect(remainingSeconds(expiresAt, at('2026-11-01T06:00:00.000Z'))).toBe(0)
  })

  it('treats an unparsable date as expired', () => {
    expect(remainingSeconds('nope', Date.now())).toBe(0)
  })
})

describe('formatCountdown', () => {
  it.each([[900, '15:00'], [61, '01:01'], [5, '00:05'], [0, '00:00'], [-3, '00:00'], [3599.9, '59:59']])('%s → %s', (seconds, text) => {
    expect(formatCountdown(seconds)).toBe(text)
  })
})
```

- [ ] **Step 2: Viết test component thất bại**

`tests/nuxt/app/payment-panel.test.ts`:

```ts
import { renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PaymentQr } from '#shared/types/order'
import PaymentPanel from '~/components/order/PaymentPanel.vue'

const qr = (over: Partial<PaymentQr> = {}): PaymentQr => ({
  bankName: 'Vietcombank',
  accountNumber: '9988776655',
  accountHolder: 'NGUYEN VAN A',
  amountVnd: 70_000,
  transferContent: 'ZOABCD1234',
  imageUrl: 'https://vietqr.app/img?acc=9988776655&bank=970436&amount=70000&des=ZOABCD1234&template=qronly',
  expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  ...over,
})
const props = (over: Record<string, unknown> = {}) => ({ qr: qr(), totalVnd: 70_000, publicCode: 'K7M2PQ', repaying: false, ...over })

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true, writable: true })
})

describe('PaymentPanel (QR still valid)', () => {
  it('shows the QR with the exact image url, size, alt and no-referrer policy', async () => {
    await renderSuspended(PaymentPanel, { props: props() })
    const img = screen.getByAltText('Mã QR chuyển khoản') as HTMLImageElement
    expect(img.getAttribute('src')).toBe(qr().imageUrl)
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(img.getAttribute('width')).toBe('240')
    expect(img.getAttribute('height')).toBe('240')
  })

  it('shows order code, amount, bank details and a running countdown', async () => {
    await renderSuspended(PaymentPanel, { props: props() })
    expect(screen.getByRole('heading', { name: /Chuyển khoản để hoàn tất đơn #K7M2PQ/ })).toBeTruthy()
    expect(screen.getAllByText('70.000đ').length).toBeGreaterThan(0)
    expect(screen.getByTestId('payment-account').textContent).toBe('9988776655')
    expect(screen.getByTestId('payment-content').textContent).toBe('ZOABCD1234')
    expect(screen.getByTestId('payment-countdown').textContent).toMatch(/Còn \d{2}:\d{2} để thanh toán/)
    expect(screen.getByText(/NGUYEN VAN A/)).toBeTruthy()
  })

  it('copies the transfer content and the raw amount', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true })
    await renderSuspended(PaymentPanel, { props: props() })
    await fireEvent.click(screen.getByRole('button', { name: 'Sao chép nội dung chuyển khoản' }))
    expect(writeText).toHaveBeenLastCalledWith('ZOABCD1234')
    await fireEvent.click(screen.getByRole('button', { name: 'Sao chép số tiền' }))
    expect(writeText).toHaveBeenLastCalledWith('70000')
    await fireEvent.click(screen.getByRole('button', { name: 'Sao chép số tài khoản' }))
    expect(writeText).toHaveBeenLastCalledWith('9988776655')
  })

  it('falls back to a hint when the Clipboard API is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true, writable: true })
    await renderSuspended(PaymentPanel, { props: props() })
    await fireEvent.click(screen.getByRole('button', { name: 'Sao chép nội dung chuyển khoản' }))
    expect((await screen.findAllByText('Nhấn giữ để sao chép')).length).toBeGreaterThan(0)
  })

  it('offers to save the QR image through the download parameter (no CORS fetch)', async () => {
    await renderSuspended(PaymentPanel, { props: props() })
    const link = screen.getByRole('link', { name: /Lưu ảnh QR/ })
    expect(link.getAttribute('href')).toBe(`${qr().imageUrl}&download=true`)
  })

  it('tells the customer to type the exact content', async () => {
    await renderSuspended(PaymentPanel, { props: props() })
    expect(screen.getByText('Nhập đúng nội dung chuyển khoản')).toBeTruthy()
  })

  it('does not show the expired state or ask to repay', async () => {
    await renderSuspended(PaymentPanel, { props: props() })
    expect(screen.queryByRole('button', { name: 'Tạo mã mới' })).toBeNull()
  })
})

describe('PaymentPanel (expired or no live QR)', () => {
  it('shows the expired state for a lapsed QR, hides the image and emits expired once', async () => {
    const { emitted } = await renderSuspended(PaymentPanel, { props: props({ qr: qr({ expiresAt: new Date(Date.now() - 1000).toISOString() }) }) })
    expect(screen.getByText('Mã QR đã hết hạn')).toBeTruthy()
    expect(screen.queryByAltText('Mã QR chuyển khoản')).toBeNull()
    expect(emitted().expired).toHaveLength(1)
  })

  it('warns not to pay twice and lets the customer create a new code', async () => {
    const { emitted } = await renderSuspended(PaymentPanel, { props: props({ qr: null }) })
    expect(screen.getByText(/đừng chuyển lại/i)).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Tạo mã mới' }))
    expect(emitted().repay).toHaveLength(1)
    expect(emitted().expired).toBeUndefined()
  })

  it('disables the button while a new code is being created', async () => {
    await renderSuspended(PaymentPanel, { props: props({ qr: null, repaying: true }) })
    expect((screen.getByRole('button', { name: 'Tạo mã mới' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
```

- [ ] **Step 3: Chạy test để xác nhận thất bại**

Run: `npx vitest run --project unit tests/unit/app/countdown.test.ts; npx vitest run --project nuxt tests/nuxt/app/payment-panel.test.ts`
Expected: FAIL — thiếu `app/utils/countdown` và `PaymentPanel.vue`.

- [ ] **Step 4: Viết implementation**

`app/utils/countdown.ts`:

```ts
export function remainingSeconds(expiresAt: string, nowMs: number): number {
  const target = Date.parse(expiresAt)
  if (Number.isNaN(target)) return 0
  return Math.max(0, Math.ceil((target - nowMs) / 1000))
}

export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
```

`app/components/order/PaymentPanel.vue`:

```vue
<script setup lang="ts">
import { formatVnd } from '#shared/money'
import type { PaymentQr } from '#shared/types/order'

const props = defineProps<{
  qr: PaymentQr | null
  totalVnd: number
  publicCode: string
  repaying?: boolean
}>()
const emit = defineEmits<{ repay: [], expired: [] }>()

const nowMs = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  ticker = setInterval(() => { nowMs.value = Date.now() }, 1000)
})
onBeforeUnmount(() => clearInterval(ticker))

const remaining = computed(() => (props.qr ? remainingSeconds(props.qr.expiresAt, nowMs.value) : 0))
const lapsed = computed(() => props.qr !== null && remaining.value <= 0)
const showQr = computed(() => props.qr !== null && !lapsed.value)
watch(lapsed, (value) => {
  if (value) emit('expired')
}, { immediate: true })

const downloadUrl = computed(() => (props.qr ? `${props.qr.imageUrl}&download=true` : ''))

const rows = computed(() => {
  const qr = props.qr
  if (!qr) return []
  return [
    { key: 'account', label: 'Số tài khoản', shown: qr.accountNumber, raw: qr.accountNumber, copyLabel: 'Sao chép số tài khoản' },
    { key: 'amount', label: 'Số tiền', shown: formatVnd(qr.amountVnd), raw: String(qr.amountVnd), copyLabel: 'Sao chép số tiền' },
    { key: 'content', label: 'Nội dung chuyển khoản', shown: qr.transferContent, raw: qr.transferContent, copyLabel: 'Sao chép nội dung chuyển khoản' },
  ]
})

const copiedKey = ref<string | null>(null)
const copyFailed = ref(false)
let resetTimer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(resetTimer))

async function copy(key: string, text: string) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable')
    await navigator.clipboard.writeText(text)
    copyFailed.value = false
    copiedKey.value = key
    clearTimeout(resetTimer)
    resetTimer = setTimeout(() => { copiedKey.value = null }, 2000)
  }
  catch {
    copyFailed.value = true
  }
}
</script>

<template>
  <ZCard padding="lg" data-testid="payment-panel">
    <div v-if="showQr && qr" class="flex flex-col gap-4">
      <div class="text-center">
        <h2 class="text-lg font-semibold">
          Chuyển khoản để hoàn tất đơn #{{ publicCode }}
        </h2>
        <p class="mt-1 text-2xl font-semibold tabular-nums">
          {{ formatVnd(qr.amountVnd) }}
        </p>
        <p class="mt-1 text-sm text-muted" data-testid="payment-countdown">
          Còn {{ formatCountdown(remaining) }} để thanh toán
        </p>
      </div>

      <img
        :src="qr.imageUrl"
        width="240"
        height="240"
        alt="Mã QR chuyển khoản"
        referrerpolicy="no-referrer"
        class="mx-auto size-60 rounded-md bg-white p-2"
      >

      <ZButton variant="secondary" icon="i-lucide-download" :to="downloadUrl" target="_blank" class="self-center">
        Lưu ảnh QR
      </ZButton>

      <p class="text-center text-sm text-muted">
        {{ qr.bankName }} · {{ qr.accountHolder }}
      </p>

      <dl class="flex flex-col gap-2">
        <div v-for="row in rows" :key="row.key" class="flex items-center gap-3 rounded-md bg-(--zeno-surface-inset) px-3 py-2">
          <div class="min-w-0 flex-1">
            <dt class="text-[13px] text-muted">
              {{ row.label }}
            </dt>
            <dd class="break-all font-mono text-base font-medium" :data-testid="`payment-${row.key}`">
              {{ row.shown }}
            </dd>
          </div>
          <ZButton
            variant="secondary"
            square
            :icon="copiedKey === row.key ? 'i-lucide-check' : 'i-lucide-copy'"
            :aria-label="row.copyLabel"
            @click="copy(row.key, row.raw)"
          />
        </div>
      </dl>
      <p v-if="copyFailed" class="text-center text-[13px] text-muted">
        Nhấn giữ để sao chép
      </p>
      <p class="sr-only" aria-live="polite">
        {{ copiedKey ? 'Đã sao chép' : '' }}
      </p>

      <ZAlert
        color="info"
        title="Nhập đúng nội dung chuyển khoản"
        description="Đơn được xác nhận tự động nhờ mã trong nội dung. Sau khi chuyển khoản, trang này tự cập nhật."
      />
    </div>

    <div v-else class="flex flex-col gap-4">
      <ZAlert
        color="warning"
        title="Mã QR đã hết hạn"
        description="Nếu bạn đã chuyển khoản trước khi mã hết hạn, đừng chuyển lại: cửa hàng sẽ đối soát. Chưa chuyển thì hãy tạo mã mới."
      />
      <ZButton block size="lg" icon="i-lucide-qr-code" :loading="repaying" :disabled="repaying" @click="emit('repay')">
        Tạo mã mới
      </ZButton>
    </div>
  </ZCard>
</template>
```

- [ ] **Step 5: Nối vào trang theo dõi đơn của PR3**

Trong `app/pages/o/[token].vue` (PR3 Task 9; gọi dữ liệu đơn là `order`, hàm tải lại là `refresh`, tham số đường dẫn là `token` — đổi tên nếu PR3 khác):

(a) script — thêm:

```ts
const toast = useToast()
const repaying = ref(false)

async function repay() {
  repaying.value = true
  try {
    await $fetch(`/api/public/orders/${token}/payment-attempts`, { method: 'POST' })
  }
  catch (err) {
    toast.add({ color: 'error', title: extractApiError(err).message })
  }
  finally {
    await refresh()
    repaying.value = false
  }
}
```

(b) template — đặt **trước** khối tiến độ đơn, hiện khi đơn chờ chuyển khoản:

```vue
<OrderPaymentPanel
  v-if="order.paymentMethod === 'BANK_QR' && order.status === 'AWAITING_PAYMENT'"
  :qr="order.qr"
  :total-vnd="order.totalVnd"
  :public-code="order.publicCode"
  :repaying="repaying"
  @repay="repay"
  @expired="refresh"
/>
```

Khi PR6 chuyển đơn sang `NEW`, lần poll kế tiếp của trang làm khối này biến mất và hiện tiến độ bình thường. Giữ `Referrer-Policy: no-referrer` và `noindex` của PR3 cho `/o/**`.

- [ ] **Step 6: Chạy test, lint, typecheck**

Run: `npx vitest run --project unit tests/unit/app/countdown.test.ts && npx vitest run --project nuxt tests/nuxt/app/payment-panel.test.ts && npm run lint && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/utils/countdown.ts app/components/order/PaymentPanel.vue "app/pages/o/[token].vue" tests/unit/app/countdown.test.ts tests/nuxt/app/payment-panel.test.ts
git commit -m "feat(payment-setup): add customer payment panel with QR, copy, save and re-pay" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 13: E2E, cập nhật spec theo sự thật đã xác minh, kiểm thủ công (gate U2/U6/U7), exit checklist

**Files:**
- Create: `tests/e2e/payment-setup.spec.ts`
- Modify: `docs/superpowers/specs/2026-10-31-zeno-mini-order-v1-design.md` (§6.2, §13), `docs/superpowers/plans/2026-10-31-zeno-v1-00-roadmap.md` (mục PR5)

**Interfaces:**
- Consumes: `signUpAndOnboard(page, testInfo, storeName): Promise<{ slug, email }>` (`tests/e2e/support/owner.ts`, PR2), `expectNoHorizontalOverflow` (`tests/e2e/support/layout.ts`), `seedMenu`, `openStore`, `pickupBody` (PR3), `getDb`/`closeDb`, bảng `stores`, `sepayIntegrations`, `paymentAttempts`, `orders`; UI Task 11, 12; route Task 5, 6, 10.
- Produces: bằng chứng end-to-end cho exit của PR5; bảng kết quả kiểm thủ công ghi vào mô tả PR và vào spec §13.

- [ ] **Step 1: Viết E2E**

`tests/e2e/payment-setup.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { closeDb, getDb } from '../../server/db/client'
import { orders, paymentAttempts, sepayIntegrations, stores } from '../../server/db/schema'
import { hashToken } from '../../server/utils/tokens'
import { openStore, pickupBody, seedMenu } from '../support/checkout-fixtures'
import { expectNoHorizontalOverflow } from './support/layout'
import { signUpAndOnboard } from './support/owner'

const SECRET = 'e2e-hmac-secret-0123456789'

test.afterAll(async () => {
  await closeDb()
})

test('owner sets up bank transfer in few steps and a customer gets a correct, renewable QR', async ({ page }, testInfo) => {
  const { slug } = await signUpAndOnboard(page, testInfo, 'Trà Sữa Thanh Toán')

  // Owner: bank + number + name, one "Kiểm tra".
  await page.goto('/app/settings')
  await page.getByRole('tab', { name: 'Thanh toán' }).click()
  await page.getByRole('combobox', { name: 'Ngân hàng' }).click()
  await page.getByRole('option', { name: /ACB/ }).click()
  await page.getByLabel('Số tài khoản', { exact: true }).fill('1122 3344 55')
  await page.getByLabel('Tên chủ tài khoản').fill('NGUYEN VAN B')
  await page.getByRole('button', { name: 'Kiểm tra' }).click()

  const preview = page.getByTestId('payment-preview')
  await expect(preview).toBeVisible()
  await expect(page.getByAltText('Mã QR kiểm tra 2.000đ')).toHaveAttribute('src', /bank=970416.*amount=2000.*des=ZOTEST0000/)
  await expect(preview).toContainText('NGUYEN VAN B')
  await expectNoHorizontalOverflow(page)
  await page.getByRole('button', { name: 'Đúng tên, xác nhận' }).click()
  await expect(page.getByText('Đã kiểm tra tài khoản')).toBeVisible()

  // Owner: connect SePay; the secret is write-only.
  await page.getByRole('button', { name: 'Kết nối SePay' }).click()
  await expect(page.getByLabel('URL webhook')).toHaveValue(/\/api\/webhooks\/sepay\/[A-Za-z0-9_-]{32}$/)
  await page.getByLabel('Secret Key (HMAC-SHA256)').fill(SECRET)
  await page.getByRole('button', { name: 'Lưu Secret' }).click()
  await expect(page.getByText('Đã lưu Secret Key').first()).toBeVisible()
  await expect(page.getByLabel('Secret Key (HMAC-SHA256)')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText(SECRET)
  await expect(page.getByText('Chờ giao dịch đầu tiên từ SePay')).toBeVisible()

  // PR6 will record the first valid webhook; simulate it here.
  const [store] = await getDb().select().from(stores).where(eq(stores.slug, slug))
  await getDb().update(sepayIntegrations).set({ lastValidWebhookAt: new Date() }).where(eq(sepayIntegrations.orgId, store!.orgId))
  await page.reload()
  await page.getByRole('tab', { name: 'Thanh toán' }).click()
  await page.getByRole('button', { name: 'Bật nhận chuyển khoản' }).click()
  await expect(page.getByText('Sẵn sàng nhận chuyển khoản')).toBeVisible()
  await expect(page.locator('body')).not.toContainText(SECRET)

  // Customer: a BANK_QR order shows a correct QR.
  await openStore(store!.id)
  const menu = await seedMenu({ id: store!.id, orgId: store!.orgId })
  const created = await page.request.post(`/api/public/stores/${slug}/orders`, { data: pickupBody(menu, { paymentMethod: 'BANK_QR' }) })
  expect([200, 201]).toContain(created.status())
  const { guestToken } = await created.json()

  await page.goto(`/o/${guestToken}`)
  await expect(page.getByRole('heading', { name: /Chuyển khoản để hoàn tất đơn/ })).toBeVisible()
  await expect(page.getByAltText('Mã QR chuyển khoản')).toHaveAttribute('src', /acc=1122334455&bank=970416&amount=70000&des=ZO[A-Z0-9]{8}/)
  await expect(page.getByTestId('payment-account')).toHaveText('1122334455')
  await expect(page.getByTestId('payment-countdown')).toContainText(/Còn 1[0-5]:/)
  await expectNoHorizontalOverflow(page)
  const firstContent = await page.getByTestId('payment-content').innerText()
  expect(firstContent).toMatch(/^ZO[A-Z0-9]{8}$/)

  // The code lapses: the customer can create a new one, and the old row is kept.
  const [order] = await getDb().select().from(orders).where(eq(orders.guestTokenHash, hashToken(guestToken)))
  await getDb().update(paymentAttempts).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(paymentAttempts.orderId, order!.id))
  await page.reload()
  await expect(page.getByText('Mã QR đã hết hạn')).toBeVisible()
  await page.getByRole('button', { name: 'Tạo mã mới' }).click()
  await expect(page.getByAltText('Mã QR chuyển khoản')).toBeVisible()
  await expect(page.getByTestId('payment-content')).not.toHaveText(firstContent)
  const rows = await getDb().select().from(paymentAttempts).where(eq(paymentAttempts.orderId, order!.id))
  expect(rows.map(r => r.status).sort()).toEqual(['PENDING', 'SUPERSEDED'])
})
```

- [ ] **Step 2: Chạy E2E**

Run: `npx playwright test tests/e2e/payment-setup.spec.ts`
Expected: PASS trên `mobile-chrome` và `mobile-safari`. Nếu selector tab/select khác do cách PR2 dựng `ZTabs`/`ZSelect`, sửa **selector** (không đổi nội dung kiểm tra). Ảnh QR tải từ `vietqr.app`; test chỉ kiểm thuộc tính `src`, không phụ thuộc ảnh tải được.

- [ ] **Step 3: Cập nhật spec theo sự thật đã xác minh**

`docs/superpowers/specs/2026-10-31-zeno-mini-order-v1-design.md` §6.2 — thay dòng:

```md
- QR image: `https://qr.sepay.vn/img?acc=<acc>&bank=<bank>&amount=<amount>&des=<payment_code>` — URL dựng ở server; xác minh format với docs SePay khi implement.
```

bằng:

```md
- QR image (đã xác minh 2026-11-01): `https://vietqr.app/img?acc=<acc>&bank=<bin>&amount=<amount>&des=<transfer_content>&template=qronly` (nguồn: developer.sepay.vn/vi/tien-ich-khac/tao-qr-code; `qr.sepay.vn/img` trả cùng ảnh). `bank` truyền `bin` trong `banks.json`; ngân hàng lạ trả `200 text/html` nên server tự kiểm tra danh sách. `acc` là số VA nếu tài khoản có VA (bắt buộc với BIDV, MSB, OCB, KienLongBank), ngược lại là số tài khoản. `transfer_content` = `payment_code`, riêng VietinBank là `SEVQR <payment_code>`. URL dựng ở server từ bản chụp trong `payment_attempts`.
```

§13 — thay hai gạch đầu:

```md
- Định dạng mã thanh toán SePay (`ZO` + 8) khớp cấu hình prefix/độ dài.
- URL/tham số QR `qr.sepay.vn`.
```

bằng:

```md
- ~~Định dạng mã thanh toán SePay~~ Đã xác minh: tiền tố 2–5 ký tự, hậu tố 1–30, loại "Số nguyên"/"Số và chữ"; `ZO` + 8 `[A-Z0-9]` khớp mẫu {`ZO`, 8–8, Số và chữ}. Còn mở: mã chỉ toàn chữ/toàn số (kiểm bằng Test mode, PR5 Task 13).
- ~~URL/tham số QR~~ Đã xác minh (xem §6.2). Còn mở: ảnh `template=qronly` trên app ngân hàng thật; `accountNumber` trong webhook của ngân hàng VA là số gốc hay số VA; scheme header `Authorization` của `userapi.sepay.vn/v2` (xác minh ở PR6 Task 4).
```

- [ ] **Step 4: Ghi chú vào roadmap**

`docs/superpowers/plans/2026-10-31-zeno-v1-00-roadmap.md`, mục PR5 — thay dòng:

```md
**Trước khi viết plan chi tiết:** đọc lại 4 trang SePay trong spec §13 (mã thanh toán, URL QR, HMAC, payload). Cập nhật spec nếu tài liệu khác với giả định.
```

bằng:

```md
**Đã viết chi tiết:** [2026-10-31-zeno-v1-06-payment-setup.md](./2026-10-31-zeno-v1-06-payment-setup.md). Lệch so với outline: `payment_attempts` lưu bản chụp tài khoản; `store_payment_accounts` thêm `va_number`, `qr_checked_at`; `sepay_integrations` thêm `last_valid_webhook_at`, `secret_updated_at`, `activated_at`; thêm route `check`, `confirm-qr`, `activate`, các `GET` cho UI; bắt buộc VA cho BIDV/MSB/OCB/KienLongBank và `SEVQR` cho VietinBank (theo tài liệu SePay).
```

- [ ] **Step 5: Kiểm thủ công trước khi coi PR5 là xong (gate cho các mục UNVERIFIED)**

Ghi kết quả (đạt/không, ảnh chụp) vào mô tả PR; mục nào không đạt thì **không merge** và sửa theo kết quả.

| # | Việc | Đạt khi | Đóng mục |
|---|---|---|---|
| M1 | Mở QR kiểm tra (2.000đ) của owner trên app của ít nhất 2 ngân hàng thật (khuyến nghị 1 ngân hàng có `SEVQR` nếu có tài khoản VietinBank) | tên người nhận = tên chủ tài khoản; số tiền 2.000; nội dung điền sẵn `ZOTEST0000` (hoặc `SEVQR ZOTEST0000`) | U7 |
| M2 | Trên SePay **Test mode** → Cấu hình test: tạo mẫu tiền tố `ZO`, hậu tố 8–8, "Số và chữ"; mô phỏng giao dịch với nội dung `ZOABCDEFGH`, `ZO12345678`, `ZOAB12CD34`, `SEVQR ZOAB12CD34`, `zoab12cd34` | cả 5 trường hợp có `code` đúng (chữ hoa) trong log webhook | U6 |
| M3 | Nếu có tài khoản BIDV/MSB/OCB/KienLongBank: chuyển khoản nhỏ vào số VA và đọc payload webhook | ghi lại `accountNumber` và `subAccount`; cập nhật spec §13 và plan PR6 (khớp theo trường nào) | U2 |
| M4 | Đọc https://developer.sepay.vn/en/sepay-api/v2/bat-dau-nhanh và gọi thử `GET https://userapi.sepay.vn/v2/transactions?per_page=1` bằng token thật | ghi scheme header đúng vào spec §13 và plan PR6 Task 4 | U1 |
| M5 | Mở `/o/<token>` trên iPhone Safari và Android Chrome thật: bấm "Lưu ảnh QR", "Sao chép nội dung chuyển khoản" | ảnh được tải/lưu; nội dung dán được vào app ngân hàng | F9 |
| M6 | Quét QR của một đơn thật 10.000đ (đơn thử) từ app ngân hàng, chuyển khoản | tiền về tài khoản; (PR6 sẽ xác nhận đơn tự động) ghi lại nội dung ngân hàng hiển thị cho khách | — |

- [ ] **Step 6: Chạy toàn bộ bộ test của PR**

Run:

```bash
npm run lint && npm run typecheck && npm test && npm run test:integration && npm run test:api && npm run db:check && npm run build
```

Expected: tất cả xanh. `npm test` gồm unit + nuxt; `test:integration` áp dụng migration `payment_setup` lên branch `test` trước khi chạy.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/payment-setup.spec.ts docs/superpowers/specs/2026-10-31-zeno-mini-order-v1-design.md docs/superpowers/plans/2026-10-31-zeno-v1-00-roadmap.md
git commit -m "test(payment-setup): add payment setup e2e and record verified SePay facts in the spec" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## PR5 Exit Checklist

**Thực thi 2026-11-03:** phần code và kiểm thử tự động đã hoàn tất; xem [implementation và kết quả](../specs/2026-11-03-pr5-payment-setup-implementation.md). Người dùng chọn giữ M1–M6 chờ kiểm thử thật, PR ở draft. Interface `check`/`confirm-qr` dùng thêm `revision` để ngăn xác nhận thông tin tài khoản đã sửa ở tab khác.

- [x] Chủ quán nhập **ngân hàng + số tài khoản + tên → "Kiểm tra" → "Đúng tên, xác nhận"** là xong phần tài khoản; phần SePay đi tiếp theo trạng thái (kết nối → dán Secret → chờ giao dịch đầu tiên → "Bật nhận chuyển khoản").
- [x] Secret SePay: chỉ ghi, mã hoá AES-256-GCM; không có route/DTO/log/lỗi nào trả hoặc in secret, ciphertext hay endpoint key (Task 4, 6, 9 đều có test).
- [x] BANK_QR chỉ khả dụng khi tài khoản đã QR-check + `verified_at` + integration `ACTIVE`; tạo đơn BANK_QR không bao giờ để lại đơn mồ côi khi 422.
- [x] Đơn `AWAITING_PAYMENT` không xuất hiện ở tab `new`, không chuyển tiếp được bằng `PATCH status`; có ở tab `awaiting_payment`.
- [x] QR đúng ngân hàng (`bin`), số tiền (từ `orders.total_vnd`), mã `ZO…`; VietinBank có `SEVQR`; ngân hàng VA dùng số VA; test hàm thuần + so khớp với DB + API.
- [x] Mã cũ không bao giờ bị xoá/tái sử dụng; đúng một attempt `PENDING` mỗi đơn dù bấm đồng thời.
- [x] Mỗi route protected mới có hàng trong `tests/api/tenant-isolation.test.ts`; route public có test quét khoá JSON.
- [x] Migration `payment_setup` đúng một file, `db:check` ổn, đã áp dụng lên branch `test`.
- [ ] Spec §6.2/§13 và roadmap đã cập nhật; bảng kiểm thủ công M1–M6 đã điền vào mô tả PR.

## Self-review (plan ↔ spec/roadmap)

| Yêu cầu | Task |
|---|---|
| Roadmap PR5 Task 1: payment account + integration services (owner-only), secret write-only, `GET` chỉ `hasSecret`/`updatedAt`/`webhookUrl`, link account, staff 403, rotate ghi đè | 5, 6, 9 |
| Roadmap PR5 Task 2: `generatePaymentCode`, `buildVietQrUrl` theo định dạng đã xác minh, unit test | 2 |
| Roadmap PR5 Task 3: BANK_QR trong `createOrder`, TTL, `GET /api/public/orders/:token` trả `qr` khi `PENDING`, re-pay `SUPERSEDED`, board không thấy đơn `AWAITING_PAYMENT` ở tab `new` | 7, 8, 10 |
| Roadmap PR5 Task 4: wizard SePay trong settings (copy webhook URL), C4 chờ thanh toán (QR, copy, lưu ảnh, đếm ngược, poll 4 s do PR3) | 11, 12 |
| Spec §6.1: `DRAFT → TESTING` khi lưu secret; `TESTING → ACTIVE` khi có webhook hợp lệ + owner xác nhận; `verified_at` đặt cho tài khoản khớp; QR chỉ khi account verified + ACTIVE | 5, 6, 7 |
| Spec §6.2: TTL `payment_ttl_minutes`, QR dựng ở server, "thanh toán lại" tạo attempt mới, cũ vẫn match được | 2, 7, 10 |
| Spec §4.4: `webhook_endpoint_key` 24 byte; `payment_code` `ZO`+8 unique toàn hệ thống | 3, 6, 7 |
| Spec §5.1: `PAYMENT_METHOD_UNAVAILABLE` khi chưa có account verified + integration ACTIVE | 7, 8 |
| Spec §9: không thêm mã lỗi mới | Global Constraints |
| Spec §13: xác minh SePay/VietQR, đánh dấu UNVERIFIED có gate | "Verified external facts", Task 1 Step 1, Task 13 |
| Global: secret AES-256-GCM, không trả API, không vào `runtimeConfig.public`, log redact | 4, 6, 9 |
| Quy ước xuyên PR: ma trận tenant, public route quét khoá, migration một file, test DB qua fixtures | 3, 8, 9, 10 |

**Giả định/lệch cần người duyệt chú ý:** (1) tên bảng/route theo roadmap (`store_payment_accounts`, `sepay_integrations`), không theo tên rút gọn trong yêu cầu giao việc; (2) thêm cột bản chụp trong `payment_attempts` và `va_number`/`qr_checked_at`/`last_valid_webhook_at` (lý do ở Architecture và Review Focus #3–#4); (3) PR5 tự có `activate` nhưng chỉ kích hoạt được khi PR6 ghi `last_valid_webhook_at` — trước đó môi trường dev/test dùng fixture `setupBankQr` hoặc cập nhật DB như E2E Task 13; (4) điểm chèn trong `create-order.ts`, `public-view.ts`, `settings.vue`, `o/[token].vue` mô tả theo plan PR2/PR3 đang viết song song, phải đối chiếu ở "Step 0" và cuối từng task.
