# PR5 — Payment Setup implementation

## Phạm vi

Triển khai tài khoản nhận tiền, kết nối SePay và lưu secret chỉ ghi; tạo đơn BANK_QR trong cùng transaction với payment attempt; giao diện owner và khách; tạo lại mã hết hạn mà giữ nguyên lịch sử mã và tài khoản nhận.

- Migration `0004_payment_setup`: bốn bảng `store_payment_accounts`, `sepay_integrations`, `integration_accounts`, `payment_attempts`; composite FK theo tenant, mã thanh toán unique toàn hệ thống và unique có điều kiện cho một attempt PENDING mỗi đơn. Chỉ áp dụng lên branch `test` qua `.env.test` trong phiên triển khai này.
- Secret dùng AES-256-GCM hiện có; DTO chỉ trả cờ `hasSecret`/`hasApiToken`, không trả plaintext/ciphertext. Endpoint URL chỉ cấp cho owner; log che đường dẫn chứa endpoint key và guest token.
- QR dùng BIN ngân hàng, số tiền server tính và bản chụp tài khoản tại thời điểm tạo attempt. VA bắt buộc cho BIDV/MSB/OCB/KLB; VietinBank có `SEVQR`.
- Tạo lại mã khóa dòng đơn, tái sử dụng attempt còn hạn, giữ mã cũ là SUPERSEDED/EXPIRED và có hạn mức 10 lần/10 phút/đơn.
- Đơn chờ tiền không vào tab `new`; staff/owner không đẩy đơn chờ thanh toán sang pha chế bằng endpoint trạng thái.

## Điều chỉnh cần thiết khi đối chiếu code thật

1. **Form checkout:** PR3 chỉ gửi PAY_ON_RECEIPT. Bổ sung `PublicMenu.bankQrEnabled` và lựa chọn VietQR trong form thật, chỉ khi có tài khoản đã kiểm tra, verified và integration ACTIVE **live**. Server tiếp tục kiểm tra lại khi đặt đơn; UI giữ giỏ và tải lại khi phương thức không còn khả dụng. Đơn 0đ dùng tiền mặt.
2. **Xác nhận đúng QR đã xem:** `PaymentAccountCheck` có `revision` là SHA256 của id và thông tin người nhận. `POST …/confirm-qr` bắt buộc `{ revision }`; service so sánh sau khi khóa tài khoản. Xem QR X, sửa sang tài khoản Y ở tab khác rồi xác nhận X trả 409 và không bật Y. Không thêm cột/schema vì revision dẫn xuất từ dữ liệu hiện tại.
3. **Mã QR kiểm tra:** không cấp `ZOTEST0000` cho đơn khách vì PR6 dành mã này cho giao dịch kiểm tra tài khoản.
4. **Màn khách:** QR và nút tạo lại chỉ dành cho paymentStatus PENDING. REVIEW_REQUIRED/REFUND_DUE/REFUNDED có thông báo riêng để khách không chuyển tiền thêm. QR gửi `no-referrer`; tải ảnh qua link `download=true`.
5. **Ảnh QR:** có trạng thái đang tải, lỗi và thử lại, giữ kích thước; bỏ qua load/error của ảnh đã bị thay thế để QR mới không bị ảnh cũ che. Các trường chuyển khoản, sao chép và xác nhận vẫn dùng được nếu dịch vụ ảnh lỗi.
6. **Tên helper:** dùng `server/utils/ids.ts` của repo; giữ `appBaseUrl()` và thêm alias `getAppBaseUrl`. Giữ nguyên cơ chế advisory lock/rate-limit preflight đã có trong `createOrder`.
7. **Cache:** mọi route owner mới và route tạo lại mã đặt `Cache-Control: no-store` trước cả guard/parse để phản hồi lỗi cũng không bị cache.

## Sự thật bên ngoài kiểm tra ngày 2026-11-03

Đọc lại [tài liệu tạo VietQR](https://developer.sepay.vn/vi/tien-ich-khac/tao-qr-code), [mã thanh toán](https://developer.sepay.vn/vi/sepay-webhooks/cau-hinh-ma-thanh-toan), [xác thực webhook](https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc) và [tài khoản ngân hàng](https://developer.sepay.vn/vi/sepay-webhooks/tai-khoan-ngan-hang).

Gọi endpoint thật bằng dữ liệu minh họa: `banks.json` có 23 ngân hàng supported; 12 BIN tham chiếu trong plan khớp; ảnh dùng BIN và code đều trả 200 image/png; ngân hàng lạ trả 200 text/html; `download=true` trả attachment. Giữ quyết định thận trọng của plan về VA cho toàn bộ BIDV và SEVQR cho toàn bộ VietinBank; phạm vi doanh nghiệp chưa được kiểm chứng bằng tài khoản thật.

## Kiểm thử và review

Kết quả kiểm tra cuối được ghi ở phần xác minh trong PR. Bộ test bao phủ schema, đầu vào, QR, secret, API/ma trận tenant, snapshot, collision trong transaction, nhiều lời gọi tạo lại đồng thời, stale confirmation và chọn phương thức từ form thật. Review độc lập không còn phát hiện Critical/Important/Minor sau khi sửa stale confirmation và mã dành riêng.

### Kết quả tự động cuối

| Kiểm tra | Kết quả |
|---|---|
| `npm run lint` | Đạt |
| `npm run typecheck` | Đạt |
| `npm test` | 103 file, 1.162 test đạt, gồm regression sự kiện ảnh QR cũ |
| `npm run test:integration` | 30 file, 340 test đạt; migration wrapper áp dụng trên branch test |
| `npm run test:api` | 5 file, 383 test đạt, gồm tenant matrix và stale QR confirmation qua HTTP |
| `npm run db:check` | Đạt |
| `npm run build` | Production build đạt |

E2E checkout cũ và luồng thanh toán mới có 28 trường hợp riêng biệt trên mobile Chrome/Safari. Lượt kết hợp đầu tiên đạt 25/28: hai ca mới dừng vì selector khớp hai nhãn trạng thái giống nhau; một ca Safari timeout tại reload trước nghiệp vụ. Sau khi sửa selector, chạy lại hai ca thanh toán và hai ca phí giao trên server mới đạt 4/4. Sau bổ sung trạng thái tải ảnh và chặn sự kiện ảnh cũ, lượt cuối riêng luồng thanh toán đạt 2/2 trên hai trình duyệt (1,2 phút). Đã xem ảnh chụp Safari xác nhận QR hiển thị; không tràn ngang ở 360px. Dev server có cảnh báo module import/hydration thoáng qua trong quá trình navigation; các kiểm tra chức năng cuối đều đạt, production build đạt. Ảnh QR ACB thật cũng được tải bằng curl và Chromium: HTTP 200 image/png, naturalWidth 360.

## Checklist thực tế trước merge

Người dùng đã chọn giữ checklist chờ kiểm thử thật. Không có quyền truy cập app ngân hàng/tài khoản SePay của chủ quán trong phiên này; không chuyển tiền thật. Giữ PR ở draft cho đến khi có bằng chứng tương ứng; test tự động không thay thế các mục này.

| Mục | Trạng thái | Bằng chứng cần bổ sung |
|---|---|---|
| M1 / U7 | Chờ kiểm tra | Quét QR owner 2.000đ trên hai app ngân hàng: đúng người nhận, tiền và nội dung |
| M2 / U6 | Chờ kiểm tra | SePay Test mode bóc mã đúng với năm biến thể trong Task 13 |
| M3 / U2 | Chờ kiểm tra nếu dùng VA | Payload thật accountNumber/subAccount; PR6 dùng để chốt đối khớp |
| M4 / U1 | Chờ kiểm tra cho PR6 | Scheme Authorization của API v2 bằng token SePay thật; PR5 chỉ lưu token |
| M5 / F9 | Chờ kiểm tra trên điện thoại thật | Lưu ảnh và sao chép trên iPhone Safari/Android Chrome thật; Playwright chỉ chứng minh trình duyệt mô phỏng |
| M6 | Chờ kiểm tra | Đơn thử, quét và chuyển tiền thật vào tài khoản; PR6 xác nhận tự động |

Webhook nhận tiền, xác minh HMAC, cron và đối soát thuộc PR6. PR5 chỉ chuẩn bị `last_valid_webhook_at`; E2E mô phỏng việc PR6 ghi cột này, không thêm đường tắt kích hoạt cho production.
