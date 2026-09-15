# Architecture P0 — Food & Drink Ordering Platform

> **Status:** Locked baseline before implementation  
> **Stack:** Nuxt 4 + Supabase + Tailwind CSS  
> **Initial infrastructure:** Vercel Hobby / Supabase Free  
> **Purpose:** Chốt 5 quyết định kiến trúc bắt buộc trước khi bắt đầu schema migrations, storefront và checkout.

---

# P0-01 — Store Identity & URL

Mỗi store phải có một định danh public ổn định và **unique toàn hệ thống**.

## Store model

```text
stores
├── id
├── organization_id
├── public_slug   UNIQUE
└── name
```

Public URL chuẩn:

```text
/s/{public_slug}
```

Ví dụ:

```text
/s/mochi-cafe
/s/zeno-coffee-q1
```

Không dùng `organization_slug/store_slug` làm định danh bắt buộc cho storefront.

`public_slug` phải dùng lowercase kebab-case, không thuộc reserved-word list và
được xem là định danh lâu dài vì có thể được dùng trong:

- QR code.
- Link chia sẻ.
- Bookmark.
- Marketing material.

`published_at` là mốc publish đầu tiên: sau khi đã thiết lập thì không được xóa, và `public_slug` không được thay đổi.

## Custom domain

Sau này hỗ trợ custom domain bằng mapping riêng:

```text
store_domains
├── id
├── store_id
├── domain
├── is_primary
└── created_at
```

Flow:

```text
order.mochicafe.vn
        ↓
store_domains
        ↓
store_id
```

## Quyết định khóa

```text
Public store identity = stores.public_slug
Public route          = /s/{public_slug}
Internal identity     = stores.id (UUID)
```

---

# P0-02 — Transaction & Idempotency

Checkout phải chống double-submit và không được tạo partial order.

## Idempotency key

Mỗi lần checkout, client tạo:

```text
idempotency_key
```

Server chuẩn hóa payload và tạo:

```text
request_hash = SHA256(normalized_payload)
```

`normalized_payload` dùng canonical JSON với key order ổn định. Hash bao gồm
store, fulfillment, customer, delivery và items; không bao gồm
`turnstile_token`, `idempotency_key` hoặc bất kỳ giá nào do client gửi lên.

Lưu:

```text
store_id
idempotency_key
request_hash
order_id
created_at
```

Constraint:

```text
UNIQUE(store_id, idempotency_key)
```

## Algorithm

### Case 1 — Key mới

```text
new idempotency_key
→ validate request shape
→ apply Postgres-backed rate limit
→ verify Turnstile with the same idempotency UUID
→ call create_order_atomic RPC
```

### Case 2 — Cùng key, cùng payload

```text
same idempotency_key
+
same request_hash
→ return existing order before re-verifying Turnstile
```

Không tạo order mới.

### Case 3 — Cùng key, payload khác

```text
same idempotency_key
+
different request_hash
→ HTTP 409 IDEMPOTENCY_CONFLICT
```

## Atomic transaction

Toàn bộ order creation phải nằm trong **một database transaction**:

```text
order
+
order_items
+
order_item_options
+
order_status_history
+
idempotency record
```

Không được tồn tại trạng thái:

```text
orders             ✓
order_items        ✓
order_item_options ✗
```

Nếu bất kỳ bước nào fail:

```text
ROLLBACK ALL
```

`create_order_atomic` là transaction boundary duy nhất. RPC phải revalidate
store availability, product availability, option constraints và toàn bộ giá
ngay trong transaction. Hai request concurrent cùng key/hash phải hội tụ về
cùng một order; unique conflict không được biến thành lỗi 500.

## Server-side pricing

Server luôn tự load và tính lại:

```text
product price
option price
subtotal
delivery fee
discount
total
```

Client không phải source of truth cho giá.

Không trust:

```text
unit_price
subtotal
delivery_fee
discount
total
```

từ request payload.

## Quyết định khóa

```text
Order creation = atomic transaction
Duplicate protection = idempotency key + request hash
Transaction boundary = PostgreSQL create_order_atomic RPC
Pricing authority = database revalidation inside the RPC
```

---

# P0-03 — JWT / RLS / Service Role Boundary

Phải tách rõ quyền của browser, merchant user và server.

## Browser

Browser chỉ được biết:

```text
SUPABASE_ANON_KEY
```

Merchant sau khi login nhận:

```text
Supabase JWT
```

Không bao giờ expose:

```text
SUPABASE_SERVICE_ROLE_KEY
```

ra browser/client bundle.

## Merchant operations

Các thao tác merchant đi theo:

```text
Browser
   ↓ Supabase JWT
Nuxt Nitro API
   ↓ user JWT
Supabase
   ↓
RLS
```

Ví dụ:

```text
Read orders
Update order status
Create/update product
Create/update category
Mark sold out
Update store settings
```

Nitro phải kiểm tra authentication/authorization, nhưng RLS vẫn là lớp tenant protection cuối cùng.

Role inheritance:

```text
organization owner/admin → all stores in the organization
store owner/manager/staff → assigned store only
```

## Public reads

Browser gọi catalog, availability và tracking qua Nitro API. Nitro dùng anon
role để gọi các read-only RPC có output giới hạn; anon không có quyền `SELECT`
trực tiếp trên business tables. Public reads không dùng service role.

## Public customer order

Customer không tạo Supabase Auth account.

Flow:

```text
Customer
   ↓
Nuxt Nitro API
   ↓
Zod validation
   ↓
Turnstile
   ↓
Rate limit
   ↓
Store/product validation
   ↓
Server-side pricing
   ↓
Atomic order creation
```

Không cho browser:

```text
INSERT orders trực tiếp
UPDATE orders trực tiếp
```

## Service Role

`SUPABASE_SERVICE_ROLE_KEY`:

- Chỉ tồn tại server-side.
- Chỉ dùng trong operation được xác định rõ.
- Không dùng như generic Supabase client cho toàn application.
- Không thay thế authorization logic.
- Không được truyền xuống composable/browser.

Các use case hợp lệ có thể gồm:

```text
public create-order transaction
trusted system maintenance
controlled server-only operation
```

## Quyết định khóa

```text
Browser          → anon key
Merchant         → JWT + RLS
Public customer  → Nitro API → limited anon RPC
Service role     → server-only, narrowly scoped
```

---

# P0-04 — Database Constraints & Tenant Integrity

Tenant hierarchy:

```text
organization
    ↓
store
```

Tenant isolation phải được enforce ở:

```text
Database constraints
+
RLS
+
Application authorization
```

Không phụ thuộc riêng một lớp.

## Organization-scoped tables

```text
organizations
organization_members
stores
```

`stores` chứa:

```text
organization_id
```

## Store-scoped tables

Các bảng business thuộc store chỉ cần `store_id` khi không có lý do thực sự phải duplicate `organization_id`.

Ví dụ:

```text
menus
menu_sections
menu_items
products
option_groups
option_values
orders
payments
```

Không mặc định lưu cả:

```text
organization_id
store_id
```

ở mọi row vì có thể sinh dữ liệu sai kiểu:

```text
organization_id = Org A
store_id        = Store thuộc Org B
```

Organization có thể derive:

```text
store
→ organization_id
```

## Cross-tenant integrity

Ví dụ:

```text
menu_items
├── store_id
├── menu_id
├── section_id
└── product_id
```

Database phải đảm bảo menu, section và product đều thuộc cùng store.

Ví dụ constraint logic:

```text
(store_id, menu_id)
→ menus(store_id, id)

(store_id, section_id)
→ menu_sections(store_id, id)

(store_id, product_id)
→ products(store_id, id)
```

Điều này ngăn:

```text
Product Store A
→ Menu Store B
```

kể cả application code có bug.

## Membership integrity

Membership phải có constraint:

```text
UNIQUE(organization_id, user_id)
UNIQUE(store_id, user_id)
```

Các role phải dùng controlled values:

```text
organization:
owner
admin

store:
owner
manager
staff
```

## Money / order constraints

Ví dụ:

```text
quantity > 0
unit_price >= 0
line_total >= 0
subtotal >= 0
delivery_fee >= 0
discount_amount >= 0
total >= 0
```

## Quyết định khóa

```text
Organization ownership is defined at stores.organization_id
Store-owned business rows use store_id
Cross-store references are blocked by DB constraints
RLS and app authorization remain mandatory
```

---

# P0-05 — Cache / Availability / Tracking Security Contract

Không được cache toàn bộ storefront như một object có TTL dài nếu object đó chứa availability thay đổi nhanh.

Phải tách:

```text
Catalog
vs
Availability
```

---

## A. Catalog Contract

Catalog thay đổi tương đối ít:

```text
store public profile
menu structure
menu sections
product name
description
image
base price
option groups
option values
```

Cache mặc định:

```text
120 seconds
```

Mục tiêu:

- Giảm Supabase queries.
- Giảm Vercel/Nitro work.
- Giảm egress.
- Phù hợp với Supabase Free / Vercel Free bootstrap.

Ví dụ endpoint:

```text
GET /api/storefront/{public_slug}/catalog
```

---

## B. Availability Contract

Availability thay đổi nhanh:

```text
store open/closed
ordering enabled
temporary closed
product sold out
temporary product availability
```

Không cache chung với catalog trong 1–5 phút.

Availability bắt buộc trả:

```text
Cache-Control: no-store
```

Ví dụ:

```text
GET /api/storefront/{public_slug}/availability
```

Storefront có thể dùng:

```text
Cached catalog
+
Fresh availability
```

Trước khi tạo order, server **bắt buộc validate availability lại**, bất kể UI đang hiển thị gì.

UI không phải source of truth.

---

## C. Tracking Security

`order_number` chỉ là display identifier.

Ví dụ:

```text
A1024
```

Không được dùng order number như credential truy cập order.

Customer nhận tracking token 256-bit được tái tạo bằng HMAC-SHA256 từ
`store_id`, `order_id` và `idempotency_key`, sử dụng server secret có version:

```text
/s/mochi-cafe/order/A1024#t=<tracking_token>
```

Server không lưu raw token.

Chỉ lưu:

```text
tracking_token_hash = SHA256(tracking_token)
tracking_key_version
```

Khi idempotent retry, server dùng `tracking_key_version` để tái tạo đúng raw
token mà không lưu raw token trong database. Secret cũ không được xóa khi vẫn
còn order dùng version đó.

Request tracking:

```text
tracking_token
      ↓
SHA256
      ↓
compare tracking_token_hash
      ↓
return safe customer-facing data
```

Fragment không được gửi trong HTTP request. Client đọc token từ fragment, giữ
trong `sessionStorage`, xóa fragment khỏi address bar bằng `history.replaceState`
và gọi tracking API bằng:

```http
Authorization: Bearer <tracking_token>
```

## Tracking API response

Chỉ trả dữ liệu cần cho customer:

```text
order number
status
items
item options
totals
fulfillment type
safe timestamps
```

Không trả:

```text
internal UUID
staff user ID
merchant internal notes
authorization metadata
database metadata
private operational fields
```

## Tracking page headers / SEO

Tracking page phải:

```text
noindex
```

và nên dùng:

```text
Referrer-Policy: no-referrer
```

Tracking API phải trả:

```text
Cache-Control: private, no-store
```

để giảm nguy cơ tracking token xuất hiện trong referrer.

## Quyết định khóa

```text
Catalog      → cache 120s
Availability → Cache-Control: no-store
Checkout     → always revalidate availability
Tracking     → fragment token + Authorization header
Token source → versioned HMAC-SHA256
DB storage   → token hash + key version, never raw token
```

---

# Locked Architecture Baseline

5 quyết định sau được coi là **P0 locked** trước khi bắt đầu implementation:

```text
P0-01  Store Identity & URL
P0-02  Transaction & Idempotency
P0-03  JWT / RLS / Service Role Boundary
P0-04  Database Constraints & Tenant Integrity
P0-05  Cache / Availability / Tracking Security
```

Implementation chỉ nên bắt đầu sau khi migrations, API contract và authorization strategy tuân thủ đầy đủ 5 quyết định này.

---

# Implementation Gate

Trước ticket feature đầu tiên, verify:

- [ ] `stores.public_slug` unique toàn hệ thống.
- [ ] Public URL dùng `/s/{public_slug}`.
- [ ] Order create có `idempotency_key`.
- [ ] Có request hash để phát hiện idempotency conflict.
- [ ] Order create chạy atomic transaction.
- [ ] Order create chỉ ghi qua `create_order_atomic` RPC.
- [ ] Turnstile Siteverify dùng cùng idempotency UUID.
- [ ] Retry completed order không yêu cầu dùng lại Turnstile token.
- [ ] Pricing chỉ tính server-side.
- [ ] Browser không có service-role key.
- [ ] Merchant operations dùng JWT + RLS.
- [ ] Organization owner/admin kế thừa quyền trên toàn bộ store của organization.
- [ ] Public reads đi qua Nitro và limited anon RPC.
- [ ] Anon không có direct table `SELECT` trên business tables.
- [ ] Customer order đi qua Nitro API.
- [ ] Store-owned tables có tenant constraints.
- [ ] Cross-store FK/reference bị database chặn.
- [ ] Catalog và availability có cache contract riêng.
- [ ] Checkout revalidate sold-out/store availability.
- [ ] Order number không phải tracking credential.
- [ ] Tracking token có entropy cao.
- [ ] Database chỉ lưu tracking token hash.
- [ ] Tracking token có key version và tái tạo được khi idempotent retry.
- [ ] Tracking link dùng fragment; API nhận token qua Authorization header.
- [ ] Tracking endpoint chỉ trả safe customer data.
- [ ] Tracking page `noindex`.
- [ ] Tracking page dùng `Referrer-Policy: no-referrer`.

Nếu bất kỳ mục P0 nào chưa đạt, chưa bắt đầu checkout implementation.
