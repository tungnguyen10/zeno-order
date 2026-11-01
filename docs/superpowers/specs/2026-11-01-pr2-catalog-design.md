# PR2 Catalog — Thiết kế hoàn thiện

Ngày: 2026-11-01. Phạm vi và phương án đã được người dùng duyệt trong hội thoại; bản spec này chờ bước review văn bản trước khi triển khai.

## Mục tiêu và phạm vi

Hoàn thành PR2 `feat(catalog)` theo [plan 19 task](../plans/2026-10-31-zeno-v1-03-catalog.md) và [roadmap](../plans/2026-10-31-zeno-v1-00-roadmap.md). Owner tạo menu bằng tên, giá và nút thêm; sửa option, ảnh, trạng thái còn hàng; cấu hình nhận món, khu vực giao và bàn/QR. Khách mở link chung hoặc QR để xem menu, chọn option và thêm giỏ tạm trên mobile 360px.

Checkout, đặt đơn, lưu giỏ vào localStorage, tracking và thanh toán thuộc PR3 trở đi. Giỏ PR2 chỉ giữ trong state. Không triển khai các phần đó trong PR2.

## Hiện trạng và phương án

Tại commit `81fb09f`, schema chỉ export identity; chưa có schema catalog, pricing, trang menu owner hoặc trang menu public. Storage service và guard tenant đã có. Settings hiện có draft, save bar và cảnh báo thay đổi chưa lưu; đổi cửa hàng và đăng xuất cũng đã tích hợp guard này.

Chọn hoàn thành đủ PR2 trong phạm vi plan hiện có. Hai phương án đã cân nhắc là chia thành nhiều PR nhỏ hoặc chỉ làm backend trước. Phương án được duyệt giữ một hành trình owner → khách hoàn chỉnh và điểm bàn giao rõ cho PR3.

Giữ CafeBlend, light/dark, typography, owner shell và primitive `Z*` theo [UI foundation](./2026-10-31-ui-foundation-design.md). Không thiết kế lại các màn đã có.

## Dữ liệu và ranh giới module

- Một migration catalog tạo `categories`, `products`, `product_option_groups`, `product_option_values`, `store_tables`, `delivery_zones`.
- Mỗi bảng có `org_id`, `store_id`, composite FK tới store và unique `(store_id, id)`; bảng con tham chiếu parent trong cùng store. Giá và phí không âm, giới hạn lựa chọn hợp lệ.
- Product cho phép thiếu category để thêm nhanh khi quán chưa có danh mục. Ẩn dữ liệu bằng `active=false`, giữ `isAvailable` riêng cho trạng thái còn hàng.
- Route chỉ parse, kiểm quyền và gọi service. Service điều phối nghiệp vụ và transaction; repository nhận scope tenant tường minh.
- `shared/pricing.ts` chứa hàm thuần kiểm option, mặc định lựa chọn, cộng giá và tổng tiền; client và PR3 dùng chung. Giá là số nguyên VND có kiểm giới hạn và overflow.
- `server/utils/tokens.ts` sinh token ngẫu nhiên 32 byte base64url và hash SHA-256. Database chỉ lưu hash token bàn.

Tên export, DTO, constraint và interface bám theo plan PR2 để PR3 tiếp tục dùng được. Khi code hiện tại khác giả định của plan, cập nhật điểm tích hợp trong plan trước khi triển khai phần đó; không sao chép nguyên đoạn code cũ làm mất hành vi hiện có.

## API owner và luồng ghi

Staff được đọc catalog, owner được ghi. Thiếu auth trả 401, thiếu role trả 403, resource không thuộc store hoặc tenant trả 404.

- Danh mục và món: tạo, đọc, cập nhật, sắp xếp và ẩn theo API trong plan.
- Option: thay toàn bộ nhóm và giá trị trong một transaction; hai lần lưu đồng thời không trộn các bộ lựa chọn.
- Ảnh: multipart qua server, tối đa 2 MB, JPEG/PNG/WebP; xác minh magic bytes và MIME. Dùng storage service hiện có, key nằm dưới store/product. Ghi ảnh mới trước, cập nhật DB rồi mới dọn ảnh cũ; lỗi dọn ảnh cũ không đảo ngược kết quả lưu. Nếu cập nhật DB thất bại, dọn object mới khi có thể.
- Fulfillment: phải bật ít nhất một mode; khóa hàng store khi cập nhật để không tắt hết mode qua các request đồng thời. Delivery có thể bật khi chưa có zone active nhưng public phải báo chưa khả dụng.
- Bàn: tạo trả QR URL một lần; regenerate làm token cũ mất hiệu lực ngay và kích hoạt lại bàn; thu hồi bằng `active=false`. Mã bàn tự đánh số khi bỏ trống, có khóa chống trùng.

## API public và luồng đọc

`GET /api/public/stores/:slug/menu` trả store, modes, categories, products và optionGroups theo DTO public; không trả các ID tenant, cờ active, object key hoặc token hash. Cache theo plan: `public, max-age=30, s-maxage=60`.

`GET /api/public/stores/:slug/fulfillment?t=` trả modes, zone active, tên bàn hợp lệ hoặc `INVALID_TABLE`; response `no-store`. Token rỗng, lặp, sai, thuộc store khác, đã regenerate hoặc bàn bị thu hồi đều không gắn khách vào bàn.

Slug viết hoa được chuẩn hóa; slug không hợp lệ, store/org bị tạm ngưng hoặc không tồn tại đều trả 404. Store đang tạm nghỉ vẫn cho xem menu. Món bị ẩn hoặc thuộc category bị ẩn không xuất hiện; món thiếu lựa chọn cần thiết để thỏa nhóm option hiển thị hết hàng.

Trạng thái nhận đơn trên menu có thể trễ theo TTL cache. Không hứa cập nhật tức thì ở trang khách; PR3 sẽ kiểm trạng thái thật khi tạo đơn.

## Giao diện và state

- `/app/menu`: thêm nhanh tên + giá + nút thêm; hiểu `35k`, `35.000`, `35,000đ`; input sai báo inline, double tap không tạo trùng. Có category, toggle còn hàng và sheet sửa món/option/ảnh.
- Settings có tab thông tin chung, nhận món/khu vực giao và bàn/QR. Tách nội dung thành component rõ trách nhiệm. Giữ save bar và guard draft; chuyển tab, đổi store hoặc đăng xuất không làm mất thay đổi mà không cảnh báo.
- QR sheet hiển thị link một lần, hỗ trợ tải PNG và in bằng `qrcode`. Khi cần lấy lại QR sau khi đóng sheet, owner regenerate và nhận cảnh báo token cũ hết hiệu lực.
- `/app/orders`: owner bật nhận đơn ngay tại banner và mở trang khách; giữ role guard và trạng thái lỗi khi request thất bại.
- `/s/[slug]`: header quán, danh mục sticky, tìm kiếm khi trên 15 món, card món, sheet option, quantity và giá cập nhật từ hàm pricing dùng chung. Món không có option thêm ngay. Giỏ tạm hiển thị số lượng và tổng tiền. QR hợp lệ hiện tên bàn; QR sai có thông báo và không gắn bàn.
- Thêm `ZSheet`, `ZTabs` bọc primitive Nuxt UI, theo convention hiện tại. Sheet có focus trap, nhãn truy cập và footer; mọi màn có loading, empty, error/retry và control tối thiểu 44px.

## Lỗi và tính nhất quán

Giữ envelope lỗi `{ code, message, details? }` và các mã hiện có. Lỗi validation không ghi dữ liệu; transaction rollback toàn bộ khi lưu option hay cập nhật cấu hình thất bại. UI khóa thao tác đang gửi, hiển thị lỗi và cho retry; không báo thành công trước khi API xác nhận.

Không log token hay dữ liệu nhạy cảm. Khi đổi store, state owner và request phải gắn đúng store; giỏ khách gắn theo slug để không lẫn món giữa các quán.

## Kiểm chứng và tiêu chí hoàn thành

1. Unit: các nhánh validation option, default selection, tính giá/overflow, parser VND, token, magic bytes, grouping/search và giỏ tạm.
2. Integration/API: FK chéo tenant, constraints, owner/staff/tenant khác, transaction đồng thời, upload lỗi, menu rỗng/ẩn, slug bất thường, tổ chức bị khóa, token bàn và quét key cấm trong JSON public.
3. Component: primitive mới và các hành vi tương tác chính theo plan; không làm mất guard thay đổi chưa lưu hiện có.
4. E2E: owner tạo món và option, tạo QR, khách mở QR trên 360px, chọn option và thấy đúng tổng giỏ; link chung không gắn bàn. Kiểm tra light/dark và overflow theo bộ test hiện tại.
5. Chạy `db:check`, lint, typecheck, unit/component, integration, API, build và Playwright. Migration và test dữ liệu chỉ chạy trên database test đã xác minh bằng helper hiện có. Báo rõ check nào bị chặn bởi môi trường; không ghi nhận pass khi chưa chạy.

PR2 hoàn thành khi hành trình trên chạy thật và các kiểm chứng liên quan đạt. Cập nhật plan để phản ánh tiến độ thực tế, ghi thay đổi upload qua server vào spec tổng và rà các điểm nối PR3. Roadmap có nhắc seed menu nhưng plan 19 task chưa định nghĩa task seed: khi cập nhật implementation plan phải bổ sung seed menu chạy lặp an toàn, scope fixture rõ ràng và chỉ cho phép database phát triển/test được chỉ định tường minh.

## Tự review

Đã đối chiếu phạm vi với plan 19 task, roadmap và code settings/orders/storage hiện tại. Không mở rộng sang đặt đơn hoặc thanh toán. Đã làm rõ cache, giỏ tạm, QR một lần, draft settings và khoảng thiếu seed giữa roadmap với implementation plan. Tất cả tiêu chí kiểm chứng đều mô tả kết quả cần đạt, không phải kết quả đã chạy.
