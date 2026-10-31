# ZENO UI Foundation — Design Spec

> Ngày: 2026-10-31 · Trạng thái: Approved design, chờ implementation plan
> Liên quan: [ZENO Mini Order V1 design](./2026-10-31-zeno-mini-order-v1-design.md) (§7 UI)

## 1. Mục tiêu

Dựng nền design system production-ready, mobile-first (360px) cho ZENO dựa trên **CafeBlend** (ấm, tông cà phê, neumorphism nhẹ) với tinh thần **trẻ trung, năng động**, rồi áp lên toàn bộ UI Phase 1 đã có. Các phase sau (menu khách, board đơn, menu admin, …) dùng lại nền này mà không cần thiết kế lại.

**Thành công khi:**
- 8 màn hiện có (`/`, `/login`, `/signup`, `/onboarding`, owner layout, `/app/orders`, `/app/settings`, trang lỗi) dùng chung tokens + primitive `Z*`.
- Light và dark ("espresso") đều đạt WCAG AA về tương phản.
- Không scroll ngang ở 360px; mọi control ≥ 44px.
- Lighthouse mobile `/` và `/login`: Performance ≥ 90, Accessibility ≥ 95.
- `lint`, `typecheck`, `test`, `test:e2e` xanh.

**Ràng buộc:** giữ nguyên route, API, logic nghiệp vụ, label và tên nút mà E2E đang dùng Hai ngoại lệ có chủ đích, kèm cập nhật test: bước đăng xuất đi qua menu tài khoản (§5.1) và h1 landing đổi thành slogan (§6.1).

**Ngoài phạm vi:** flow quên mật khẩu (ẩn link), `ZSheet`/`ZTabs`/`ZTable` (thêm khi phase đầu tiên cần), màn Phase 2+, thay đổi API.

## 2. Quyết định đã chốt

| Chủ đề | Quyết định |
|---|---|
| Phạm vi | Design system nền + áp lên 8 màn hiện có |
| Nhận diện | CafeBlend, chỉnh cho production (§3.6) |
| Font tiêu đề | **Fraunces** (DM Serif Display không có subset tiếng Việt) |
| Color mode | Light (cream) + Dark (espresso), mặc định theo hệ thống, có toggle |
| Landing | Marketing gọn cho chủ quán |
| Owner layout | Mobile bottom nav; từ `md` (≥768px) sidebar |
| Kiến trúc UI | Primitive riêng `Z*` bọc Nuxt UI v4 bên trong |

## 3. Design tokens & theme

### 3.1 Font
Tự host qua `@nuxt/fonts` (đã đi kèm Nuxt UI v4), subset `vietnamese` + `latin`, `font-display: swap`, preload font tiêu đề.

| Token Tailwind | Font | Weight | Dùng cho |
|---|---|---|---|
| `font-display` | Fraunces | 500, 600 | Tiêu đề, wordmark. Không dùng cho body |
| `font-sans` | Work Sans | 400, 500, 600 | Mọi text còn lại |
| `font-mono` | IBM Plex Mono | 400, 500 | Mã đơn, giá tiền, URL preview |

### 3.2 Màu
Khai báo bằng CSS variables trong `app/assets/css/main.css`; Nuxt UI nhận qua `primary`/`neutral` trong `app.config.ts`. Tạo palette Tailwind `coffee` (50–950, `600 = #8B5E3C`) làm `primary` và `cream` (warm neutral) làm `neutral`.

| Token | Light | Dark (espresso) |
|---|---|---|
| bg | #FDF6EC | #1C1410 |
| surface | #FFFFFF | #2A1F19 |
| surface-inset | #F0E6D6 | #15100C |
| surface-hover | #FAF0E1 | #33261F |
| border | #E8DDD0 | #3D2E25 |
| text | #3E2723 | #F5EBDD |
| text-muted | #6D4C41 | #C9B8A6 |
| primary | #8B5E3C | #D4A373 |
| primary-hover | #6B4226 | #E0B88E |
| secondary (`caramel`) | #C4956A (chỉ nền/trang trí) | #C4956A (chỉ nền/trang trí) |

Semantic (nền chip theo spec CafeBlend; **chữ nhỏ** dùng sắc độ đậm hơn để đạt AA):

| Semantic | Fill/accent | Chip bg (light) | Chữ trên nền sáng |
|---|---|---|---|
| success | #059669 | #DCFCE7 | #047857 |
| warning | #D97706 | #FEF3C7 | #B45309 |
| error | #EF4444 | #FEE2E2 | #DC2626 |
| info | #6366F1 | #EDE9FE | #4F46E5 |

Dark mode: chip dùng nền accent ở 15–20% opacity, chữ sắc độ 300–400 tương ứng.

### 3.3 Shadow, radius, spacing

| Token | Light | Dark |
|---|---|---|
| `shadow-raised` | `6px 6px 12px #D5C9B8, -6px -6px 12px #FFFFFF` | `0 4px 12px rgb(0 0 0 / .35)` + `border` |
| `shadow-raised-sm` | `3px 3px 6px #D5C9B8, -3px -3px 6px #FFFFFF` | `0 2px 4px rgb(0 0 0 / .3)` |
| `shadow-inset` | `inset 4px 4px 8px #D5C9B8, inset -4px -4px 8px #FFFFFF` | `inset 0 1px 2px rgb(0 0 0 / .4)` + `border` |
| `shadow-sm/md/lg` | 2/4 · 4/12 · 8/24 (offset/blur), đen 6% · 8% · 12% | như light, opacity ×3 |
| focus ring | 3px `primary` / 25% | 3px `primary` / 40% |

Radius: `sm` 6px (tag), `md` 12px (button, card, input), `lg` 16px (modal, panel), `full`.
Spacing: bước 4/8px của Tailwind (khớp base unit 8px).

### 3.4 Type scale (mobile-first)

| Mức | Mobile | ≥ `sm` | Font |
|---|---|---|---|
| h1 | 30/38 | 34/42 | display 600 |
| h2 | 24/32 | 26/34 | display 500 |
| h3 | 20/28 | 20/28 | sans 600 |
| body | 16/24 | 16/24 | sans 400 |
| small | 13/18 | 13/18 | sans 400 |
| mono | 14/20 | 14/20 | mono 400 |

Mỗi trang dùng tối đa 2 cỡ tiêu đề display.

### 3.5 Color mode, icon, metadata
- `@nuxtjs/color-mode` (đi kèm Nuxt UI): `preference: 'system'`, lưu lựa chọn; `AppColorModeToggle` chuyển light/dark.
- `<meta name="theme-color">` cho light (#FDF6EC) và dark (#1C1410) qua `media`.
- Cài `@iconify-json/lucide` để bundle icon, không gọi Iconify API khi chạy.
- `public/`: `favicon.svg`, `favicon.ico` (hoặc PNG 32), `apple-touch-icon.png` (180), `manifest.webmanifest` tối giản (name, icons, theme/background color, `display: standalone`).
- `titleTemplate: '%s — ZENO'`; page chỉ khai báo phần đầu (ví dụ `useHead({ title: 'Đăng nhập' })`).

### 3.6 Điều chỉnh so với CafeBlend
1. Body và input dùng **16px** (không phải 14px): iOS tự zoom khi input < 16px; 14px khó đọc ở 360px.
2. Không dùng #C4956A cho chữ trên nền kem (tương phản ~2.5:1).
3. Input lỗi/focus có border/ring rõ, không chỉ dựa vào inset.
4. `raised` chỉ dùng cho phần tử ≥ 24px và đặt trên nền `bg`, không đặt trên `surface` trắng.
5. Dark mode bỏ neumorphism, thay bằng shadow phẳng + border.
6. Cỡ nút `md` = 44px (spec gốc 42px) để đạt chuẩn touch target.

## 4. Primitive `Z*` và component cấp app

### 4.1 Quy ước
- Primitive ở `app/components/z/` (auto-import `ZButton`, `ZInput`, …); component cấp app ở `app/components/app/` (`AppLogo`, `AppAuthShell`, …).
- `pages/` và `layouts/` **chỉ dùng `Z*`** cho các primitive dưới đây. Nuxt UI được dùng trực tiếp cho hạ tầng: `UApp`, `UForm`, `useToast`, `UIcon`, `NuxtLoadingIndicator`. Quy tắc này được ESLint enforce (cấm `UButton`, `UInput`, `USelect`, `USwitch`, `UCard`, `UAlert`, `UBadge`, `UFormField` trong `pages/**` và `layouts/**`).
- Primitive giữ API gọn, chỉ những prop cần dùng; style được đặt qua prop `ui`/`class` của component Nuxt UI bên trong, đọc từ tokens ở §3.
- Override touch target trong `app.config.ts` hiện tại được giữ hoặc chuyển vào primitive. Không được làm hụt mức tối thiểu 44px.

### 4.2 Primitive

| Component | API chính | Hành vi / style |
|---|---|---|
| `ZButton` | `variant`: `primary` \| `secondary` \| `ghost` \| `destructive` (mặc định `primary`); `size`: `sm` 36px \| `md` 44px \| `lg` 50px (mặc định `md`); `loading`, `disabled`, `block`, `icon`, `trailingIcon`, `to`, `type` | Primary: nền primary, chữ trắng, `shadow-raised` ở light, hover `primary-hover`, `active:` phẳng lại. Secondary: nền `surface-hover`, chữ primary. Ghost: trong suốt, chữ `text-muted`, hover nền `surface-hover`. Destructive: nền error, hover #DC2626. Disabled: opacity .4, không shadow. `sm` chỉ dùng trong vùng phụ, hit area vẫn ≥ 44px nhờ padding vô hình |
| `ZInput` | `v-model`, `type`, `size`: `md` 48px \| `lg` 52px, `icon`, `placeholder`, `autocomplete`, `inputmode`, `readonly`, `disabled`, slot `leading`/`trailing` | Nền `surface-inset` + `shadow-inset`, chữ 16px, radius 12. Hover nền #EBE0D0. Focus: ring. Lỗi: border error + nền #FEF2F2, không shadow. Disabled: nền #F5EDE3. `type="password"` có nút hiện/ẩn (aria-label "Hiện mật khẩu"/"Ẩn mật khẩu", `aria-pressed`) |
| `ZFormField` | `label`, `name`, `hint`, `help`, `required` | Bọc `UFormField`. Label sans 500 14px, mb 6px; help/hint 13px muted; lỗi màu error, liên kết bằng `aria-describedby` |
| `ZSelect` | `v-model`, `items`, `placeholder`, `size`, `aria-label` | Cùng style với `ZInput` |
| `ZSwitch` | `v-model`, `label`, `description`, `disabled` | Hàng label cao 44px, hit area ≥ 44px (cơ chế hiện tại). Track bật màu primary |
| `ZCard` | `variant`: `raised` \| `elevated` \| `flat`; `padding`: `md` 16px \| `lg` 24px; slot `header`, `default`, `footer` | Nền `surface`, radius 12. `raised`: `shadow-raised` (dark: border + shadow phẳng). `elevated`: `shadow-md`. `flat`: border |
| `ZAlert` | `color`: `info` \| `success` \| `warning` \| `error`; `title`, `description`, `icon`, slot `actions` | Nền chip bg, chữ AA (§3.2). `error` và `warning` dùng `role="alert"`, còn lại `role="status"` |
| `ZBadge` | `status`: `success` \| `warning` \| `error` \| `info` \| `neutral`; `size`: `sm` \| `md`; `icon` | Pill, màu theo §3.2 |

### 4.3 Component cấp app

| Component | Vai trò |
|---|---|
| `AppLogo` | Wordmark "zeno" (Fraunces 600) kèm icon ly cà phê SVG inline. Prop `size`, `variant` (`full` \| `mark`), `to`. Cũng là nguồn cho favicon |
| `AppAuthShell` | Khung login, signup, onboarding. Props `title`, `description`, `step?` (`{ current, total, label }`). Slot `default` (form), `footer`. Mobile: nền `bg` có blob caramel mờ, logo trên, form trong `ZCard raised`. ≥ `lg`: chia đôi, trái là panel thương hiệu nền primary (slogan + 3 lợi ích), phải là form |
| `AppPageHeader` | `title`, `description`, slot `actions`. h1 display |
| `AppEmptyState` | `icon`, `title`, `description`, slot `actions` |
| `AppCopyField` | `value`, `label`. Input readonly + nút "Sao chép" (đổi icon ✓ trong 2 giây, thông báo qua `aria-live="polite"`). Nút "Chia sẻ" chỉ hiện khi có `navigator.share`. Khi Clipboard API không khả dụng: tự chọn toàn bộ text và báo "Nhấn giữ để sao chép" |
| `AppColorModeToggle` | Nút chuyển sáng/tối. Variant `icon` (header) và `row` (menu/sidebar có label) |

## 5. Layout

### 5.1 `layouts/owner.vue`
`navItems` khai báo một lần (`Đơn hàng` → `/app/orders`, `Cài đặt` → `/app/settings`), dùng cho cả hai dạng nav. Có skip-link "Bỏ qua tới nội dung" trỏ tới `<main id="main">`.

**Mobile (< `md`):**
- Header sticky cao 56px, nền `bg`/95 + blur, border dưới.
  - Trái: tên store (sans 600, truncate; giữ `data-testid="active-store-name"`) hoặc `ZSelect` khi > 1 store; dưới là `ZBadge` "Đang nhận đơn" (success) / "Tạm nghỉ" (warning) từ `activeStore.isAcceptingOrders`.
  - Phải: nút avatar 44px (chữ cái đầu của `displayName`, fallback email), aria-label "Tài khoản". Mở dropdown: tên + email, `AppColorModeToggle` (row), **Đăng xuất**.
- Bottom nav cố định: icon + label, cao 64px + `env(safe-area-inset-bottom)`; mục active có pill nền `primary/10` sau icon và chữ primary 600; `aria-current="page"`. Thiết kế chứa tối đa 5 mục.
- `main`: padding 16px, `pb` đủ để không bị bottom nav che.

**≥ `md`:**
- Ẩn header và bottom nav. Sidebar trái 256px, sticky `h-dvh`, nền `surface`, border phải. Thứ tự: `AppLogo` → store switcher + badge trạng thái → nav (mục active nền `surface-inset`, viền trái 3px primary) → khối tài khoản ở đáy (avatar, tên, `AppColorModeToggle`, nút Đăng xuất).
- Nội dung `max-w-5xl`, padding 32px.

E2E đăng xuất: ở mobile phải mở menu "Tài khoản" trước khi bấm "Đăng xuất". Test cập nhật tương ứng; nút vẫn tên "Đăng xuất" và cao ≥ 44px.

### 5.2 Auth
`/login`, `/signup`, `/onboarding` dùng `AppAuthShell` (§4.3) với layout mặc định.

### 5.3 Toàn cục
- `app.vue`: thêm `NuxtLoadingIndicator` màu primary.
- `app/error.vue`: dùng `AppEmptyState`. 404: "Không tìm thấy trang"; lỗi khác: "Đã có lỗi xảy ra". Nút "Về trang chủ" (`clearError({ redirect: '/' })`).

## 6. Từng màn hình

### 6.1 `/` — landing marketing (SSR)
1. Header: `AppLogo`, link "Đăng nhập", `ZButton` "Dùng thử miễn phí" → `/signup` (ở mobile chỉ giữ một CTA để vừa 360px).
2. Hero: h1 "Đặt món tại bàn, không cần app", mô tả một dòng, CTA primary "Tạo quán miễn phí" → `/signup`, CTA secondary **"Đăng nhập chủ quán"** → `/login` (giữ nguyên tên cho smoke test). Mockup điện thoại vẽ bằng HTML/CSS (card món, giỏ, QR); `aria-hidden`. Ở mobile mockup nằm dưới CTA; ≥ `lg` chia 2 cột.
3. Lợi ích (3 `ZCard raised`): QR tại bàn · Thanh toán VietQR tự đối soát · Quản lý đơn trên điện thoại.
4. Cách hoạt động: 3 bước đánh số "Tạo quán → In QR → Nhận đơn".
5. CTA cuối trên nền primary + footer (© ZENO, link Đăng nhập/Đăng ký).
6. SEO: `useSeoMeta` (title "ZENO Order — Đặt món tại bàn cho quán cafe & trà sữa", description, `ogTitle`, `ogDescription`, `ogType: 'website'`). Trang có đúng một h1 là slogan hero; `AppLogo` không phải heading. Smoke test đổi sang kiểm tra heading slogan và link "Đăng nhập chủ quán".

### 6.2 `/login`, `/signup`
- `AppAuthShell`, `ZFormField` + `ZInput` (size `lg`), mật khẩu có nút hiện/ẩn.
- Lỗi chung: `ZAlert color="error"` đầu form.
- Signup: thanh độ mạnh mật khẩu theo độ dài (< 8 yếu, 8–11 khá, 12–15 tốt, ≥ 16 rất tốt), `aria-live="polite"`.
- Không có link "Quên mật khẩu?" ở V1.
- Giữ nguyên label, tên nút, schema, luồng xử lý và redirect.

### 6.3 `/onboarding`
- `AppAuthShell` với `step = { current: 2, total: 2, label: 'Tạo cửa hàng' }`.
- Hai nhóm field có tiêu đề nhỏ: "Doanh nghiệp" (`orgName`), "Cửa hàng" (`storeName`, `storeSlug`).
- `storeSlug`: leading text cố định `/s/`, `autocapitalize="off"`, `autocorrect="off"`, `spellcheck="false"`; preview URL đầy đủ dạng mono dưới field.
- Xử lý `SLUG_TAKEN`, `ORG_EXISTS`, lỗi khác giữ nguyên.

### 6.4 `/app/orders`
- `AppPageHeader` "Đơn hàng".
- Nếu `!activeStore.isAcceptingOrders`: `ZAlert color="warning"` "Quán đang tạm nghỉ — khách không đặt được món" kèm link "Bật nhận đơn" → `/app/settings`.
- `AppEmptyState` "Chưa có đơn hàng nào" + mô tả; actions: `AppCopyField` với link đặt món, và `ZButton variant="secondary"` "Mở cài đặt".

### 6.5 `/app/settings`
- `AppPageHeader` "Cài đặt cửa hàng".
- `ZCard` "Thông tin cửa hàng": `ZFormField` "Tên cửa hàng".
- `ZCard` "Nhận đơn": `ZSwitch` "Đang nhận đơn" (giữ label và description).
- `ZCard` "Link đặt món": `AppCopyField` + `ZButton variant="ghost"` "Mở trang khách" (`target="_blank"`, `rel="noopener"`).
- Lưu (chỉ owner):
  - Mobile: thanh sticky phía trên bottom nav, chỉ hiện khi `isDirty`, chứa "Lưu thay đổi" (block) và "Hủy" (khôi phục draft).
  - ≥ `md`: hai nút ở cuối form, "Lưu thay đổi" disabled khi chưa có thay đổi.
- Rời trang khi `isDirty`: `onBeforeRouteLeave` hỏi xác nhận; `beforeunload` khi đóng tab.
- Staff: field disabled + `ZAlert color="info"` "Chỉ chủ cửa hàng mới thay đổi được cài đặt".
- Loading: skeleton hình 3 card; lỗi: `ZAlert color="error"` kèm nút "Thử lại" (`refresh`).

## 7. Chất lượng production

- **A11y:** AA cho cả hai chế độ; focus ring nhìn thấy trên mọi control; touch target ≥ 44px; `prefers-reduced-motion` tắt transition/animation không thiết yếu; landmark `header`/`nav`/`main`/`footer`; skip-link; mỗi trang một h1.
- **Hiệu năng:** font subset + preload; icon bundle; landing không có ảnh raster; mockup bằng CSS; không thêm JS runtime ngoài Nuxt UI.
- **Mobile:** `min-h-dvh`, safe-area top/bottom, không scroll ngang ở 360px, đúng `type`/`inputmode`/`autocomplete`, `viewport-fit=cover` (đã có).

## 8. Kiểm thử

- **Unit (Vitest + Testing Library):**
  - `ZButton`: variant/size render đúng class; `loading` thì disabled + `aria-busy`.
  - `ZInput`: toggle hiện/ẩn mật khẩu đổi `type` và `aria-pressed`/aria-label.
  - `ZAlert`: role theo `color`.
  - `ZBadge`: class theo `status`.
  - `AppCopyField`: copy thành công (✓ + thông báo), Clipboard API không khả dụng (fallback), nút Chia sẻ chỉ hiện khi có `navigator.share`.
- **E2E (Playwright):**
  - Giữ test hiện có; cập nhật bước đăng xuất qua menu "Tài khoản" và heading của smoke test.
  - Thêm: không có scroll ngang ở 360px trên `/`, `/login`, `/signup`, `/onboarding`, `/app/orders`, `/app/settings`.
  - Thêm: viewport 1024px thì sidebar hiện, bottom nav ẩn.
  - Thêm: chuyển dark mode thì `html` có class `dark` và giữ nguyên sau reload.
- **Gate:** `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` xanh; Lighthouse mobile thủ công qua Chrome DevTools cho `/` và `/login` đạt ngưỡng ở §1.

## 9. Thứ tự triển khai

Mỗi bước một commit `feat(ui)`/`fix(ui)`/`test(ui)`:
1. Tokens (CSS variables, palette `coffee`/`cream`, shadow, type scale), font, color mode, `@iconify-json/lucide`, favicon/manifest/`theme-color`/`titleTemplate`.
2. Primitive `Z*` + unit test + luật ESLint.
3. Component cấp app (`AppLogo`, `AppAuthShell`, `AppPageHeader`, `AppEmptyState`, `AppCopyField`, `AppColorModeToggle`) + unit test `AppCopyField`.
4. Owner layout responsive, `error.vue`, `NuxtLoadingIndicator`; cập nhật E2E đăng xuất.
5. `/login`, `/signup`, `/onboarding`.
6. `/app/orders`, `/app/settings`.
7. Landing `/`; cập nhật smoke test.
8. E2E mới (no-overflow, sidebar, dark mode) + đo Lighthouse.
