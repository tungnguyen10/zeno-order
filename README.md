# Zeno Order

Food Ordering Platform được triển khai theo vertical slices. Repository hiện chứa **R1–R4**: nền tenant/RLS, catalog tenant-safe, storefront SSR mobile-first, giỏ hàng theo store, atomic checkout và token-protected order tracking.

## Yêu cầu

- Node.js 24 LTS và npm 11+
- Docker Desktop hoặc Docker Engine đang chạy
- Git

## Khởi động local

```bash
npm ci
npx supabase start
npx supabase db reset
npx supabase status -o env
```

Tạo `.env` từ `.env.example`, sau đó lấy giá trị do lệnh `supabase status` trả về:

- `API_URL` → `NUXT_PUBLIC_SUPABASE_URL`
- `PUBLISHABLE_KEY` (hoặc `ANON_KEY` trên CLI cũ) → `NUXT_PUBLIC_SUPABASE_KEY`
- `SECRET_KEY` → `NUXT_SUPABASE_SECRET_KEY`; khóa này chỉ được client order chuyên dụng phía server dùng để gọi ba RPC đặc quyền của checkout.
- Cấu hình Turnstile và tracking HMAC theo `.env.example`. Chỉ dùng bộ Turnstile dummy key chính thức cho local/test; production phải dùng key riêng và tracking secret ngẫu nhiên tối thiểu 32 ký tự.

Chạy ứng dụng:

```bash
npm run dev
```

Mở [http://127.0.0.1:3000/s/mochi-cafe](http://127.0.0.1:3000/s/mochi-cafe). Reset local nạp `seed-demo.sql` trước, sau đó `seed.sql`; phần sau tạo merchant local `merchant@local.test` với mật khẩu `local-only-password`.

## Public storefront API

- `GET /api/storefront/:publicSlug`: profile tương thích R1, cache dùng chung 120 giây.
- `GET /api/storefront/:publicSlug/catalog`: menu, section, sản phẩm và option đã publish; `Cache-Control: public, max-age=0, s-maxage=120, stale-while-revalidate=60`.
- `GET /api/storefront/:publicSlug/availability`: trạng thái cửa hàng và sold-out hiện tại; luôn dùng `Cache-Control: no-store`.

Public API không trả store/organization UUID. Product và option UUID là opaque selector để các lát cắt sau gửi lựa chọn, không phải quyền truy cập. Giá tiền là chuỗi số nguyên thập phân để không mất độ chính xác của PostgreSQL `bigint`.

## Product configurator, giỏ hàng và checkout

- Chọn món tại `/s/:publicSlug`; generic option groups được kiểm tra ở client trước khi thêm.
- Giỏ hàng tại `/s/:publicSlug/cart`; quantity từ 1–99, có thể xóa dòng và xem tạm tính lossless.
- Checkout tại `/s/:publicSlug/checkout` xác minh Turnstile, gửi payload không có giá và chỉ ghi đơn qua atomic PostgreSQL RPC.
- Mỗi store lưu riêng trong LocalStorage với key `zeno-order:cart:v1:{publicSlug}`. Payload sai version, sai store/currency hoặc không hợp lệ sẽ bị loại bỏ.
- Giá trong giỏ chỉ là preview từ catalog snapshot. PostgreSQL tính lại sản phẩm, option, phí giao và tổng tiền trong cùng transaction.
- Thành công chuyển đến `/s/:publicSlug/order/:orderNumber#t=...`; trang tracking chuyển token vào sessionStorage và xóa fragment ngay, API chỉ nhận token qua Bearer header.

## Lệnh kiểm tra

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:nuxt
npm run build
npm run test:client-secrets
```

Các kiểm tra cần Docker và local Supabase:

```bash
npx supabase db reset
npx supabase db lint --fail-on error
npx supabase db advisors --local --type all --fail-on error
npm run test:db
npx playwright install chromium
npm run test:e2e
```

`npm run verify` chạy lint, typecheck, test TypeScript/Nuxt, production build và kiểm tra client bundle. Database và E2E được tách riêng vì cần Docker.

## Cấu trúc Phase 1 hiện tại

- `app/pages/s/[publicSlug]/`: storefront catalog SSR, giỏ hàng và checkout shell mobile-first.
- `app/stores/cart.ts`: Pinia cart versioned, store-scoped và persist ở browser.
- `app/domain/`: validation option và phép tính tiền bằng `BigInt`.
- `server/api/storefront/`: các endpoint Nitro dùng public client không mang session người dùng và RPC giới hạn quyền.
- `server/domain/`: validation, DTO mapping và resolver availability thuần theo IANA timezone.
- `supabase/migrations/`: tenant/catalog foundation, RLS helpers/policies và public resolver RPC.
- `supabase/tests/`: pgTAP constraints và tenant/role access matrix.
- `test/unit`, `test/nuxt`, `test/e2e`: ba tầng test độc lập.

## Nguyên tắc bảo mật R1–R4

- `public_slug` unique toàn cục, lowercase kebab-case, không dùng reserved slug và không đổi sau khi publish.
- Anon không có quyền `SELECT` trực tiếp trên business tables.
- Public storefront chỉ gọi ba read-only RPC được allow-list qua Nitro bằng publishable key.
- Organization owner/admin kế thừa quyền trên tất cả store thuộc organization; store role chỉ thấy store được gán.
- `NUXT_SUPABASE_SECRET_KEY` là server-only và không được dùng như generic database client.
- Cart không phải nguồn giá tin cậy; mọi dữ liệu client được PostgreSQL xác minh lại.
- Rate-limit table chỉ lưu SHA-256 của địa chỉ client. Database chỉ lưu SHA-256 của tracking token cùng phiên bản HMAC, không lưu raw token.
- Retry cùng UUID/payload trả đúng một đơn; tái sử dụng UUID với payload khác trả conflict.

## Workflow Supabase development đã link

Máy phát triển này hiện chưa có Docker/Podman, nên local reset vẫn là gate bắt buộc trong CI. Khi cần xác minh trên development project đã link, chạy tuần tự để tránh tranh chấp login role:

```bash
npx supabase db push --linked --dry-run --skip-vault --agent no
npx supabase db push --linked --skip-vault --yes --agent no
npx supabase db query --linked --file supabase/seed-demo.sql --agent no
npx supabase db query --linked --file supabase/tests/r2_catalog_foundation.test.sql --agent no
npx supabase db query --linked --file supabase/tests/r2_catalog_rls.test.sql --agent no
npx supabase db advisors --linked --type all --level warn --fail-on error --agent no
```

Không chạy `supabase/seed.sql` trên remote vì file đó chứa tài khoản/mật khẩu chỉ dành cho local. Advisors sẽ cảnh báo ba `SECURITY DEFINER` RPC có quyền anon/authenticated; đây là exposure có chủ ý, được giới hạn payload và kiểm tra bằng pgTAP.

Hai tài liệu kiến trúc nguồn là `architecture-p0-locked-baseline.md` và `food-ordering-platform-production-plan.md`; baseline P0 được ưu tiên nếu có mâu thuẫn.
