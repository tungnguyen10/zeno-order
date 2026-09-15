# Zeno Order

Food Ordering Platform được triển khai theo vertical slices. Repository hiện chứa **R1 — Tenant Skeleton**: nền Nuxt, tenant schema, RLS, public store resolver và storefront SSR tại `/s/:publicSlug`.

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
- `SECRET_KEY` chỉ ánh xạ sang `NUXT_SUPABASE_SECRET_KEY` khi một tác vụ server đặc quyền thực sự cần nó. R1 không dùng secret/service-role để đọc storefront công khai.

Chạy ứng dụng:

```bash
npm run dev
```

Mở [http://127.0.0.1:3000/s/mochi-cafe](http://127.0.0.1:3000/s/mochi-cafe). Seed chỉ dành cho local, tạo merchant `merchant@local.test` với mật khẩu `local-only-password`.

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

## Cấu trúc R1

- `app/pages/s/[publicSlug]/`: storefront shell mobile-first, render bằng SSR.
- `server/api/storefront/[publicSlug].get.ts`: endpoint Nitro dùng public client không mang session người dùng và RPC giới hạn quyền.
- `server/domain/`: validation và mapping sang public DTO, không chứa UUID nội bộ.
- `supabase/migrations/`: tenant foundation, RLS helpers/policies và public resolver RPC.
- `supabase/tests/`: pgTAP constraints và tenant/role access matrix.
- `test/unit`, `test/nuxt`, `test/e2e`: ba tầng test độc lập.

## Nguyên tắc bảo mật R1

- `public_slug` unique toàn cục, lowercase kebab-case, không dùng reserved slug và không đổi sau khi publish.
- Anon không có quyền `SELECT` trực tiếp trên business tables.
- Public storefront chỉ gọi `get_public_store_by_slug` qua Nitro bằng publishable key.
- Organization owner/admin kế thừa quyền trên tất cả store thuộc organization; store role chỉ thấy store được gán.
- `NUXT_SUPABASE_SECRET_KEY` là server-only và không được dùng như generic database client.

Hai tài liệu kiến trúc nguồn là `architecture-p0-locked-baseline.md` và `food-ordering-platform-production-plan.md`; baseline P0 được ưu tiên nếu có mâu thuẫn.
