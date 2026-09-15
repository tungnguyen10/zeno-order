# Food & Drink Ordering Platform — Production Project Plan

> **Status:** Baseline architecture for project creation  
> **Target:** Production-quality codebase, mobile-first, multi-tenant ready  
> **Initial infrastructure budget:** **$0/month** for development / pilot  
> **Core stack:** Nuxt 4 + Vue 3 + TypeScript + Tailwind CSS + Supabase + Vercel  
> **Updated:** 2026-09-14

---

## 1. Product Definition

Build a mobile-first ordering platform for food and drink stores.

Primary customer flow:

```text
Open store link / scan QR
        ↓
Browse menu
        ↓
Select product + options
        ↓
Add to cart
        ↓
Choose delivery / pickup
        ↓
Enter customer information
        ↓
Submit order
        ↓
Store receives order
        ↓
Store confirms / prepares / delivers
        ↓
Customer tracks order status
```

The product is **not** a full POS system in Phase 1.

The platform focuses on:

- Fast ordering without customer account creation.
- Simple product/menu management.
- Receiving and processing orders.
- Delivery/pickup information.
- Realtime notifications for merchant devices.
- A codebase that can later support many stores and branches.

---

# 2. Architecture Principle

Although Phase 1 may serve only one store, the codebase and database must be designed as a **multi-tenant F&B ordering platform** from day one.

Do not design:

```text
User → Single Store
```

Design:

```text
Organization
    ↓
Store / Branch
    ↓
Menu
    ↓
Products
    ↓
Orders
```

Target future model:

```text
Mochi Coffee
├── District 1
├── District 3
├── District 7
└── Thu Duc
```

Adding a second store or branch must not require redesigning the database.

---

# 3. Infrastructure Constraint

## 3.1 Initial infrastructure

Development / pilot:

```text
Vercel Hobby
+
Supabase Free
```

Initial infrastructure budget:

```text
$0/month
```

However:

> Production-quality code does not mean the free hosting tier is suitable for long-term commercial production.

### Vercel Hobby

Current Vercel documentation states Hobby is intended for **personal / non-commercial use**.

Therefore:

- Use Vercel Hobby for development, testing and pilot.
- Before using the platform as a real commercial ordering service, review hosting eligibility.
- Upgrade to Vercel Pro or migrate Nuxt/Nitro to another compatible host when required.

The application architecture must not depend on Vercel-only business logic.

Nuxt/Nitro should remain portable to:

```text
Vercel
Cloudflare
Node.js
Docker
VPS
```

### Supabase Free

Current Supabase Free limits relevant to this project:

| Resource | Free allowance |
|---|---:|
| Database | 500 MB |
| File storage | 1 GB |
| Egress | 5 GB |
| Cached egress | 5 GB |
| Monthly active users | 50,000 |
| Edge Function invocations | 500,000 |
| Realtime messages | 2,000,000/month |
| Realtime peak connections | 200 |
| Active Free projects | 2 |
| Automatic backups | Not included |
| Image transformations | Not included |
| Inactive project behavior | May pause after 1 week |

These are **architecture constraints**.

Do not treat them as permanent capacity guarantees.

---

# 4. Free-Tier Design Rules

The codebase must intentionally minimize:

- Database queries.
- Serverless invocations.
- Realtime connections.
- Realtime messages.
- Storage usage.
- Image bandwidth.
- Duplicate files.
- Application logs stored in Postgres.
- Analytics event inserts.
- Background jobs.
- Unnecessary Supabase Edge Functions.

## 4.1 Realtime policy

Realtime is reserved primarily for merchant/admin devices.

Do not open a Realtime connection for every customer.

```text
Customer
    ↓
HTTP status polling / refresh

Merchant dashboard
    ↓
Supabase Realtime
```

Customer order tracking should poll approximately every:

```text
15–30 seconds
```

Only while:

- Tracking page is visible.
- Order is not in a terminal state.

Terminal states:

```text
completed
cancelled
```

---

# 5. Technology Stack

## Frontend

```text
Nuxt 4
Vue 3
TypeScript
Tailwind CSS
Pinia
```

## Backend

```text
Nuxt Nitro Server API
Supabase PostgreSQL
Supabase Auth
Supabase Storage
Supabase Realtime
```

## Validation

```text
Zod
```

## Security / Abuse Prevention

```text
Cloudflare Turnstile
Rate limiting
Supabase RLS
Server-side pricing
Idempotency keys
```

## Hosting

```text
Nuxt/Nitro → Vercel initially
Database/Auth/Storage/Realtime → Supabase
```

---

# 6. Application Architecture

```text
Customer Mobile Browser
        │
        ▼
     Nuxt 4
        │
        ├── SSR public storefront
        ├── Pinia local cart
        ├── Nitro API
        │
        ▼
     Domain Services
        │
        ▼
     Repositories
        │
        ▼
      Supabase
   ┌────┼───────┐
   │    │       │
Postgres Auth Storage
   │
Realtime
   │
   ▼
Merchant Dashboard
```

Layer rule:

```text
UI
↓
Composable / Store
↓
API
↓
Domain Service
↓
Repository
↓
Supabase
```

Avoid:

```ts
// Do not scatter direct business writes throughout Vue components.
await supabase.from('orders').insert(...)
```

Business writes must go through the server/domain layer.

---

# 7. Repository Structure

Recommended baseline:

```text
.
├── app/
│   ├── assets/
│   ├── components/
│   │   ├── ui/
│   │   ├── storefront/
│   │   │   ├── StoreHeader.vue
│   │   │   ├── StoreStatus.vue
│   │   │   ├── CategoryTabs.vue
│   │   │   ├── ProductCard.vue
│   │   │   ├── ProductSheet.vue
│   │   │   └── CartBar.vue
│   │   ├── cart/
│   │   │   ├── CartItem.vue
│   │   │   └── CartSummary.vue
│   │   └── admin/
│   │       ├── OrderCard.vue
│   │       ├── OrderStatusBadge.vue
│   │       ├── ProductEditor.vue
│   │       └── StoreSwitcher.vue
│   │
│   ├── composables/
│   │   ├── useStorefront.ts
│   │   ├── useProducts.ts
│   │   ├── useCart.ts
│   │   ├── useCheckout.ts
│   │   └── useOrderTracking.ts
│   │
│   ├── layouts/
│   │   ├── default.vue
│   │   └── admin.vue
│   │
│   ├── middleware/
│   │   └── admin-auth.ts
│   │
│   ├── pages/
│   │   ├── s/
│   │   │   ├── index.vue
│   │   │   └── [publicSlug]/
│   │   │       ├── index.vue
│   │   │       ├── cart.vue
│   │   │       ├── checkout.vue
│   │   │       └── order/
│   │   │           └── [orderNumber].vue
│   │   └── admin/
│   │       ├── index.vue
│   │       ├── orders.vue
│   │       ├── products.vue
│   │       ├── menu-sections.vue
│   │       ├── menu.vue
│   │       ├── staff.vue
│   │       └── settings.vue
│   │
│   ├── stores/
│   │   └── cart.ts
│   │
│   ├── types/
│   └── utils/
│
├── server/
│   ├── api/
│   │   ├── storefront/
│   │   │   └── [publicSlug]/
│   │   │       ├── index.get.ts
│   │   │       ├── catalog.get.ts
│   │   │       └── availability.get.ts
│   │   ├── orders/
│   │   │   └── index.post.ts
│   │   └── admin/
│   │       ├── orders/
│   │       ├── products/
│   │       ├── menu-sections/
│   │       └── settings/
│   │
│   ├── domain/
│   │   ├── order/
│   │   ├── menu/
│   │   ├── pricing/
│   │   └── store/
│   │
│   ├── repositories/
│   │   ├── order.repository.ts
│   │   ├── menu.repository.ts
│   │   └── store.repository.ts
│   │
│   ├── services/
│   │   ├── order.service.ts
│   │   ├── pricing.service.ts
│   │   ├── menu.service.ts
│   │   └── notification.service.ts
│   │
│   ├── schemas/
│   │   ├── order.schema.ts
│   │   ├── product.schema.ts
│   │   └── store.schema.ts
│   │
│   └── utils/
│       ├── auth.ts
│       ├── supabase.ts
│       ├── rate-limit.ts
│       └── errors.ts
│
├── shared/
│   ├── constants/
│   ├── enums/
│   └── types/
│
├── supabase/
│   ├── migrations/
│   ├── seed.sql
│   └── README.md
│
├── public/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── .env.example
├── nuxt.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

---

# 8. Multi-Tenant Domain Model

Primary hierarchy:

```text
organizations
    │
    ├── organization_members
    │
    └── stores
          │
          ├── store_members
          ├── menus
          ├── menu_sections
          ├── menu_items
          ├── products
          └── orders
```

Every business-owned row must be traceable to a tenant.

Prefer explicit tenant ownership at the nearest boundary:

```text
store_id
```

where appropriate.

`stores.organization_id` defines organization ownership. Store-owned business
rows use `store_id`; do not duplicate `organization_id` on those rows. Composite
foreign keys must block cross-store references.

---

# 9. Database Schema

Use:

```text
UUID primary keys internally
```

Do not expose UUIDs as customer-facing order numbers.

---

## 9.1 organizations

```text
id uuid pk
name text
slug text unique
status text
created_at timestamptz
updated_at timestamptz
```

---

## 9.2 organization_members

```text
organization_id uuid fk
user_id uuid fk auth.users
role text
created_at timestamptz
```

Roles:

```text
owner
admin
```

Constraint:

```text
unique(organization_id, user_id)
```

---

## 9.3 stores

```text
id uuid pk
organization_id uuid fk

public_slug text unique
name text
logo_path text
cover_path text

phone text
address text
description text

timezone text
currency text

is_active boolean
published_at timestamptz nullable
manual_open_state text nullable

delivery_enabled boolean
pickup_enabled boolean

min_order_amount bigint
default_delivery_fee bigint

created_at timestamptz
updated_at timestamptz
```

Use integer monetary values in the smallest practical unit.

For VND:

```text
35000
```

Do not use floating point for money.

Constraints:

```text
unique(public_slug)
public_slug = lowercase kebab-case
public_slug not in reserved-word list
published_at is a durable first-publication marker and cannot be cleared; public_slug is immutable after it is set
```

---

## 9.4 store_hours

```text
id uuid pk
store_id uuid fk

day_of_week smallint
open_time time
close_time time

is_closed boolean
created_at timestamptz
```

---

## 9.5 store_members

```text
store_id uuid fk
user_id uuid fk auth.users
role text
created_at timestamptz
```

Roles:

```text
owner
manager
staff
```

Constraint:

```text
unique(store_id, user_id)
```

---

# 10. Menu Schema

## 10.1 menus

Support future multiple menus:

```text
Breakfast
Lunch
Dinner
Drinks
```

Fields:

```text
id uuid pk
store_id uuid fk

name text
is_active boolean
sort_order integer

created_at timestamptz
updated_at timestamptz
```

Phase 1 may use only one default menu.

---

## 10.2 menu_sections

```text
id uuid pk
store_id uuid fk
menu_id uuid fk

name text
slug text
description text nullable
sort_order integer

created_at timestamptz
updated_at timestamptz
```

---

## 10.3 products

```text
id uuid pk
store_id uuid fk
name text
slug text
description text

base_price bigint
image_path text

is_active boolean
is_sold_out boolean

created_at timestamptz
updated_at timestamptz
```

---

## 10.4 menu_items

Products remain independent and can be reused across menus/sections.

```text
id uuid pk
store_id uuid fk
menu_id uuid fk
section_id uuid fk
product_id uuid fk
sort_order integer
created_at timestamptz
updated_at timestamptz
```

Composite foreign keys must prove that the menu, section and product belong to
the same store.

---

# 11. Generic Product Options

Do not hardcode:

```text
size
sugar
ice
topping
```

Use generic option groups.

---

## 11.1 option_groups

```text
id uuid pk
store_id uuid fk

name text

selection_type text
required boolean

min_select integer
max_select integer

sort_order integer
is_active boolean

created_at timestamptz
updated_at timestamptz
```

`selection_type`:

```text
single
multiple
```

Examples:

```text
Size
Sugar
Ice
Topping
Protein
Extra
```

---

## 11.2 option_values

```text
id uuid pk
option_group_id uuid fk

name text
price_adjustment bigint

is_default boolean
is_active boolean
sort_order integer

created_at timestamptz
updated_at timestamptz
```

---

## 11.3 product_option_groups

```text
product_id uuid fk
option_group_id uuid fk
sort_order integer
```

Constraint:

```text
unique(product_id, option_group_id)
```

---

# 12. Order Schema

Orders must preserve historical pricing and product information.

Never rely on current product data to render old orders.

---

## 12.1 orders

```text
id uuid pk

store_id uuid fk

order_number text
tracking_token_hash text
tracking_key_version integer

status text
fulfillment_type text

customer_name text
customer_phone text

delivery_address text nullable
delivery_note text nullable
customer_note text nullable

subtotal bigint
delivery_fee bigint
discount_amount bigint
total bigint

payment_method text
payment_status text

idempotency_key text

created_at timestamptz
confirmed_at timestamptz nullable
ready_at timestamptz nullable
completed_at timestamptz nullable
cancelled_at timestamptz nullable
updated_at timestamptz
```

Important constraints:

```text
unique(store_id, order_number)
unique(store_id, idempotency_key)
unique(tracking_token_hash)

subtotal >= 0
delivery_fee >= 0
discount_amount >= 0
total >= 0
```

---

## 12.2 order_items

Snapshot product data:

```text
id uuid pk
order_id uuid fk

product_id uuid nullable

product_name text
unit_price bigint

quantity integer
line_total bigint

note text nullable

created_at timestamptz
```

Constraints:

```text
quantity > 0
unit_price >= 0
line_total >= 0
```

`product_id` may remain as a historical reference but order rendering must use snapshot fields.

---

## 12.3 order_item_options

```text
id uuid pk
order_item_id uuid fk

option_group_name text
option_name text
price_adjustment bigint

created_at timestamptz
```

Snapshot only necessary customer-facing pricing data.

Do not snapshot entire product/category/store JSON objects.

---

## 12.4 order_status_history

```text
id uuid pk
order_id uuid fk

from_status text nullable
to_status text

changed_by uuid nullable
note text nullable

created_at timestamptz
```

This enables later reporting:

```text
Average confirmation time
Average preparation time
Average delivery time
Cancellation rate
```

---

# 13. Order Status Model

Delivery:

```text
pending
↓
confirmed
↓
preparing
↓
ready
↓
delivering
↓
completed
```

Pickup:

```text
pending
↓
confirmed
↓
preparing
↓
ready
↓
completed
```

Cancellation:

```text
cancelled
```

Terminal states:

```text
completed
cancelled
```

Use a controlled state transition service.

Do not allow arbitrary status updates.

Example:

```text
pending → preparing
```

should not be allowed unless explicitly supported by business rules.

---

# 14. Payments

Phase 1:

```text
cash
bank_transfer
```

Payment status:

```text
unpaid
pending
paid
failed
refunded
```

Do not integrate payment gateways in the first release unless required.

Future-ready table:

```text
payments
```

Suggested fields:

```text
id
store_id
order_id
provider
method
amount
status
provider_reference
paid_at
created_at
updated_at
```

---

# 15. Customer Authentication

Customer account is **not required**.

Customer ordering flow:

```text
No account
No Supabase Auth user
No anonymous Auth session
```

This keeps:

- UX fast.
- Auth MAU low.
- Database cleaner.
- Free-tier usage lower.

Merchant/staff users use Supabase Auth.

---

# 16. Authorization

## Owner

```text
Orders        full access
Products      full access
Categories    full access
Menu          full access
Store         full access
Staff         full access
Reports       read
```

## Manager

```text
Orders        full operational access
Products      create/update
Categories    create/update
Menu          create/update
Reports       read
```

## Staff

```text
Orders        read
Order status  update
Products      read
Sold-out      update
```

Customer:

```text
No admin access
```

---

# 17. RLS Strategy

RLS remains enabled on tenant-owned tables.

Core rule:

> An authenticated merchant may access a row only when the user belongs to the corresponding organization/store and has the required role.

Tables requiring tenant-aware policies include:

```text
organizations
organization_members
stores
store_members
menus
menu_sections
menu_items
products
option_groups
option_values
product_option_groups
orders
order_items
order_item_options
order_status_history
payments
```

Public storefront access goes through Nitro APIs backed by narrowly scoped,
read-only anon RPCs. Anon receives no direct `SELECT` grant on business tables.

Public product visibility requires:

```text
store.is_active = true
menu.is_active = true
product.is_active = true
```

Sensitive order creation and modification must be performed via Nitro server routes.

Never expose the Supabase service-role key to the browser.

---

# 18. API Design

Base application API:

```text
/api
```

---

## Public Storefront

### Get public store

```http
GET /api/storefront/:publicSlug
```

### Get storefront catalog

```http
GET /api/storefront/:publicSlug/catalog
```

Response:

```json
{
  "store": {},
  "menus": [],
  "sections": [],
  "menuItems": [],
  "products": [],
  "optionGroups": []
}
```

Goal:

> Avoid 5–10 client requests for one menu page.

### Get storefront availability

```http
GET /api/storefront/:publicSlug/availability
Cache-Control: no-store
```

---

## Create order

```http
POST /api/orders
```

Client payload:

```json
{
  "publicSlug": "mochi-cafe",
  "fulfillmentType": "delivery",
  "customer": {
    "name": "Thanh Tung",
    "phone": "0900000000"
  },
  "delivery": {
    "address": "...",
    "note": "Gọi trước khi giao"
  },
  "customerNote": "Không lấy muỗng nhựa",
  "paymentMethod": "cash",
  "items": [
    {
      "productId": "uuid",
      "quantity": 2,
      "optionValueIds": ["uuid"],
      "note": "Ít đá"
    }
  ],
  "idempotencyKey": "550e8400-e29b-41d4-a716-446655440000",
  "turnstileToken": "..."
}
```

Do **not** accept trusted pricing from the client.

The server must calculate:

```text
unit price
option price
subtotal
delivery fee
discount
total
```

---

## Order tracking

```http
GET /api/storefront/:publicSlug/orders/:orderNumber
Authorization: Bearer <trackingToken>
```

Return only safe customer-facing fields.

Never expose:

```text
internal UUID
merchant notes
staff identity
private admin data
```

---

# 19. Order Creation Transaction

Order creation flow:

```text
POST /api/orders
        ↓
Validate Zod payload
        ↓
Normalize payload + calculate request hash
        ↓
Apply rate limit
        ↓
Check completed idempotency request
        ↓
Verify Turnstile with the same idempotency UUID
        ↓
Call create_order_atomic RPC
        ↓
Revalidate store/product/option availability in transaction
        ↓
Calculate price in transaction
        ↓
Create order + items + option snapshots + status history
        ↓
Create idempotency record + commit
        ↓
Return order number + tracking token
```

All order writes should execute atomically.

Locked implementation:

- PostgreSQL `create_order_atomic` RPC is the only transaction boundary.
- The RPC is authoritative for pricing and availability.
- Concurrent requests with the same key/hash converge on the same order.
- Do not create partially persisted orders.

---

# 20. Idempotency

Required from day one.

Problem:

```text
Customer taps "Place order"
Network delays
Customer taps again
```

Without protection:

```text
2 requests
→
2 orders
```

Use:

```text
idempotency_key
```

Constraint:

```text
unique(store_id, idempotency_key)
```

If the same valid request is retried:

```text
Return existing order
```

The request stores a canonical payload hash. Reusing a key with a different
hash returns `409 IDEMPOTENCY_CONFLICT`. A completed retry is resolved before
re-validating the single-use Turnstile token.

Do not create a duplicate.

---

# 21. Mobile-First UX

Primary viewport:

```text
360px–430px
```

Desktop is an enhancement, not the design baseline.

---

## Storefront

Recommended structure:

```text
Store header
Store open/closed status

Promotion banner

Sticky category navigation

Product list

Sticky cart CTA
```

Sticky cart:

```text
┌───────────────────────────┐
│ 🛒 3 món       112.000đ → │
└───────────────────────────┘
```

---

## Product Detail

Use mobile bottom sheet.

```text
Product image
Product name
Description
Base price

Option groups
Quantity
Item note

Add to cart CTA
```

---

## Checkout

Keep checkout short.

Required fields for delivery:

```text
Name
Phone
Address
```

Optional:

```text
Delivery note
Order note
```

Pickup does not require delivery address.

---

# 22. Cart

Use:

```text
Pinia
+
localStorage
```

Do not write cart state to Supabase before order submission.

Cart must survive:

```text
refresh
browser close/reopen
temporary connectivity loss
```

Because public clients do not receive internal store UUIDs, cart storage is
namespaced by the validated `public_slug`:

```text
zeno-order:cart:v1:{publicSlug}
```

Do not mix products from different stores in one cart.

---

# 23. Merchant Dashboard

Admin routes:

```text
/admin
/admin/orders
/admin/products
/admin/menu-sections
/admin/menu
/admin/staff
/admin/settings
```

Dashboard priorities:

```text
New orders
Pending confirmation
Preparing
Ready
Delivering
Completed
Cancelled
```

Mobile merchant interface must remain usable.

Desktop can add Kanban-style order columns.

---

# 24. Realtime

Subscribe only to necessary order changes.

Recommended merchant subscription scope:

```text
orders
WHERE store_id = current_store
```

Do not subscribe to:

```text
all tables
all stores
all product updates
```

Merchant flow:

```text
Order INSERT
→
Dashboard updates
→
Optional notification sound
```

Always provide fallback:

```text
refetch on reconnect
refetch on window focus
manual refresh
```

Realtime is an enhancement, not the sole source of state consistency.

---

# 25. Product Image Strategy

Supabase Free provides limited storage and no free image transformations.

Therefore image optimization happens before upload.

## Upload rules

Reject huge originals.

Recommended product image:

```text
Format: WebP
Max dimension: ~1200 × 1200
Typical target: 100–250 KB
```

Thumbnail when needed:

```text
~400 × 400
~30–80 KB
```

Client-side compression should occur before upload.

Do not store:

```text
5–10 MB camera originals
```

---

## Storage paths

```text
stores/
└── {store_id}/
    ├── logo/
    │   └── logo.webp
    ├── cover/
    │   └── cover.webp
    └── products/
        └── {product_id}/
            └── main.webp
```

Replacing a product image should replace/delete obsolete assets.

Avoid orphaned files.

---

# 26. Caching

Public menu data changes far less often than it is read.

Cache as catalog data:

```text
Store public profile
Menus
Menu sections
Menu items
Products
Options
```

Suggested initial TTL:

```text
120 seconds
```

Never cache:

```text
order status
merchant order queue
store/product availability
```

Cache invalidation can initially use:

```text
120-second catalog TTL
+
refetch after admin mutation
```

Avoid building complex distributed cache infrastructure in Phase 1.

---

# 27. Query Efficiency

Avoid storefront load pattern:

```text
request store
request menu sections
request products
request option groups
request option values
request settings
```

Prefer aggregated API/data query:

```text
GET /api/storefront/:publicSlug/catalog
+
GET /api/storefront/:publicSlug/availability
```

Recommended indexes:

```text
stores(public_slug)

store_members(user_id, store_id)

menu_sections(store_id, menu_id, sort_order)
menu_items(store_id, menu_id, section_id, sort_order)

products(store_id, is_active)

orders(store_id, created_at)
orders(store_id, status, created_at)

order_items(order_id)

order_status_history(order_id, created_at)
```

Do not index every column.

Indexes also consume storage.

---

# 28. Security Baseline

Required:

```text
Supabase RLS
Zod validation
Server-side pricing
Rate limiting
Turnstile
Idempotency
Role-based authorization
Safe error responses
Secure tracking tokens
Input length limits
Database constraints
```

---

## Tracking token

Customer tracking URL:

```text
/s/{publicSlug}/order/{orderNumber}#t={trackingToken}
```

Do not make customer access depend solely on sequential order number guessing.

Tracking tokens should be high entropy.

Generate them with versioned HMAC-SHA256 so an idempotent retry can reproduce
the same raw token. Store only `SHA256(trackingToken)` and the key version.
The client sends the token to the API in an `Authorization: Bearer` header;
tracking responses use `Cache-Control: private, no-store`.

---

# 29. Rate Limiting

Apply stronger limits to:

```text
POST /api/orders
login
admin mutations
tracking endpoints if abused
```

Rate limit keys may include:

```text
IP
store_id
route
```

Turnstile is required for public order submission.

---

# 30. Logging

Do not create a general-purpose `application_logs` table in Supabase.

Use hosting/runtime logs for technical diagnostics.

Persist only business-significant audit events such as:

```text
order status history
payment changes
important admin changes
```

This protects Free database storage.

---

# 31. Analytics

Do not INSERT an event row for every:

```text
page view
scroll
product impression
```

into Supabase during Phase 1.

Business database should prioritize:

```text
orders
order status
payments
merchant operations
```

If analytics is needed, use a dedicated lightweight analytics solution.

---

# 32. Store Availability

Store ordering availability should consider:

```text
store.is_active
store hours
manual override
```

Possible resolved states:

```text
open
closed
temporarily_closed
```

If closed:

- Menu can remain visible.
- Ordering CTA is disabled.
- Show next opening time where possible.

---

# 33. Delivery / Pickup

Phase 1 fulfillment:

```text
delivery
pickup
```

Phase 1 delivery fee:

```text
store.default_delivery_fee
```

Future:

```text
delivery zones
distance-based pricing
free-shipping thresholds
third-party delivery
```

Do not prematurely build maps/distance calculation.

---

# 34. Theme / White Label

Do not hardcode restaurant brand colors throughout Tailwind classes.

Use CSS variables:

```css
:root {
  --brand: 21 84 240;
  --background: 248 250 252;
  --surface: 255 255 255;
  --text: 16 24 40;
  --muted: 102 112 133;
  --border: 234 236 240;
}
```

Later store themes may override:

```text
--brand
--brand-soft
--brand-hover
```

This allows multi-store branding without rewriting components.

---

# 35. Performance Targets

Target storefront:

```text
LCP < 2.5s
CLS < 0.1
Good mobile Core Web Vitals
```

Strategies:

- SSR store shell.
- Cache public menu.
- Responsive WebP images.
- Lazy-load below-the-fold images.
- Avoid unnecessary JS.
- Avoid large UI dependencies.
- Lazy-load admin-only code where practical.
- Paginate large admin order histories.

---

# 36. SEO

Public store route:

```text
/s/{publicSlug}
```

Example:

```text
/s/mochi-coffee
```

Metadata:

```text
Mochi Coffee | Đặt món online
```

Storefront should be SSR-rendered.

Product details may remain bottom-sheet based for ordering UX.

Dedicated product URLs can be added later if SEO requires them.

---

# 37. Environment Variables

Create:

```text
.env.example
```

Suggested variables:

```bash
NUXT_PUBLIC_APP_URL=

NUXT_PUBLIC_SUPABASE_URL=
NUXT_PUBLIC_SUPABASE_ANON_KEY=

SUPABASE_SERVICE_ROLE_KEY=

NUXT_PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
```

Rules:

- `SUPABASE_SERVICE_ROLE_KEY` is server-only.
- Never prefix secrets with `NUXT_PUBLIC_`.
- Never commit `.env`.
- Keep development/staging/production credentials separate.

---

# 38. Supabase Development Strategy

Supabase migrations must be version-controlled.

Structure:

```text
supabase/
├── migrations/
└── seed.sql
```

Never make production schema changes only through the Supabase dashboard without adding the equivalent migration.

Every schema change must be reproducible.

---

# 39. Seed Data

Seed should create:

```text
1 organization
1 store
1 default menu
3–5 menu sections
sample products
sample option groups
```

Example:

```text
Organization
└── Mochi Foods

Store
└── Mochi Cafe

Categories
├── Cà phê
├── Trà
├── Đồ ăn
└── Combo
```

Seed must never contain real credentials or secrets.

---

# 40. Testing Strategy

## Unit tests

Prioritize:

```text
pricing
option validation
order totals
status transitions
store availability
permission helpers
```

---

## Integration tests

Test:

```text
create order
duplicate idempotency request
invalid product
sold-out product
invalid option selection
closed store
authorization
RLS expectations
```

---

## E2E

Critical path:

```text
Open store
→
Add product
→
Select options
→
Cart
→
Checkout
→
Submit order
→
Receive success
→
Merchant sees order
→
Merchant confirms
→
Customer sees updated status
```

---

# 41. Error Model

Server APIs should return consistent errors.

Example:

```json
{
  "error": {
    "code": "PRODUCT_SOLD_OUT",
    "message": "Một sản phẩm trong giỏ hàng đã hết."
  }
}
```

Suggested codes:

```text
VALIDATION_ERROR
STORE_NOT_FOUND
STORE_CLOSED
PRODUCT_NOT_FOUND
PRODUCT_SOLD_OUT
INVALID_OPTION
MIN_ORDER_NOT_MET
RATE_LIMITED
TURNSTILE_FAILED
ORDER_NOT_FOUND
UNAUTHORIZED
FORBIDDEN
CONFLICT
INTERNAL_ERROR
```

Do not return raw database errors to customers.

---

# 42. Phase 1 Scope

## Customer

- Storefront.
- Store information.
- Open/closed status.
- Categories.
- Products.
- Product options.
- Sold-out state.
- Cart.
- Delivery.
- Pickup.
- Customer information.
- COD.
- Bank transfer selection.
- Order submission.
- Order success.
- Order tracking.

## Merchant

- Supabase Auth login.
- Order dashboard.
- Realtime new orders.
- Order details.
- Controlled status updates.
- Category CRUD.
- Product CRUD.
- Product option CRUD.
- Sold-out toggle.
- Store settings.
- Store hours.

## Platform

- Multi-tenant schema.
- Organization/store membership.
- RLS.
- Storage.
- Image compression.
- Rate limiting.
- Turnstile.
- Idempotency.
- Server-side pricing.
- Status history.

---

# 43. Explicitly Not Phase 1

Do not build yet:

```text
Customer accounts
Favorites
Loyalty points
Complex promotions
Coupons
Advanced CRM
Google Maps distance pricing
Driver app
POS integration
Kitchen printer
Kitchen display system
Zalo OA
SMS
Payment gateway
Multiple currencies
Inventory accounting
Complex tax engine
AI recommendation
Advanced analytics warehouse
Redis
Kafka
Queue infrastructure
```

The database should remain extensible for these features without implementing them now.

---

# 44. Upgrade Triggers

Do not wait until a Free quota reaches 100%.

Start reviewing upgrades near approximately 60–70% of important limits.

Example Supabase triggers:

```text
Database > ~300 MB
Storage > ~700 MB
Egress > ~3.5 GB/month
Realtime approaching operational limits
Need automatic backups
Need production SLA
Need higher availability
Business becomes operationally critical
```

The most important non-quota trigger is:

```text
Orders become business-critical data
```

Supabase Free does not include automatic backups.

At that point:

- Upgrade Supabase.
- Or implement a reliable external backup process before relying on the system operationally.

Vercel trigger:

```text
Commercial production usage
```

Review plan eligibility before launch.

---

# 45. Backup Requirement

Development/pilot:

```text
Supabase Free
```

Commercial/business-critical phase:

```text
Automatic backup required
```

Do not treat a production order database with no recovery strategy as acceptable infrastructure.

The project README should explicitly distinguish:

```text
Production-quality application code
≠
Production-grade infrastructure SLA
```

---

# 46. Deployment Environments

Preferred:

```text
local
staging
production
```

Because Supabase Free allows only two active Free projects, initial bootstrap can use:

```text
Local Supabase development
+
1 remote Supabase Free project
```

or:

```text
1 staging/pilot remote project
1 production remote project
```

depending on launch stage.

Do not create unnecessary remote projects.

---

# 47. Git Workflow

Recommended branches:

```text
main
develop
feature/*
fix/*
```

`main`:

```text
deployable production/pilot baseline
```

Every database change:

```text
code
+
migration
+
test
```

in the same pull request/commit set.

---

# 48. Bootstrap Project

Suggested creation sequence:

## Step 1 — Create Nuxt project

```bash
npm create nuxt@latest food-ordering
cd food-ordering
npm install
```

Enable:

```text
TypeScript
ESLint
```

---

## Step 2 — Install application dependencies

Install current stable releases of:

```text
@pinia/nuxt
@nuxtjs/supabase
zod
```

Install Tailwind CSS using the current Nuxt-compatible setup.

Do not blindly pin versions from this document.

The repository lockfile is the source of truth for installed versions.

---

## Step 3 — Initialize Supabase

Install Supabase CLI for local migration workflow.

Create:

```text
supabase/
migrations/
seed.sql
```

Link to the remote project only after local schema is established.

---

## Step 4 — Create environment config

Create:

```text
.env
.env.example
```

Never commit `.env`.

---

## Step 5 — Establish design tokens

Before feature UI work:

```text
brand
background
surface
text
muted
border
success
warning
danger
radius
shadow
spacing
```

Use reusable UI primitives.

---

## Step 6 — Create database foundation

Migration order:

```text
001_extensions
002_organizations
003_memberships
004_stores
005_store_hours
006_menus
007_menu_sections
008_products
009_menu_items
010_options
011_orders
012_order_items
013_order_status_history
014_indexes
015_rls
016_functions
```

Exact grouping may change, but migrations must remain ordered and reproducible.

---

## Step 7 — Seed sample store

Ensure storefront can run entirely from seeded data.

---

## Step 8 — Build storefront

Sequence:

```text
store resolver
↓
menu API
↓
store page
↓
menu sections
↓
product cards
↓
product sheet
↓
cart
```

---

## Step 9 — Build checkout

Sequence:

```text
checkout UI
↓
validation
↓
Turnstile
↓
pricing service
↓
transactional order creation
↓
success page
↓
tracking
```

---

## Step 10 — Build merchant admin

Sequence:

```text
auth
↓
store access resolver
↓
order queue
↓
order status
↓
Realtime
↓
products
↓
menu sections
↓
options
↓
settings
```

---

# 49. Development Milestones

## Milestone 0 — Foundation

Deliver:

- Nuxt project.
- Tailwind setup.
- Pinia.
- Supabase integration.
- Environment validation.
- Base UI system.
- CI lint/typecheck.

---

## Milestone 1 — Database & Auth

Deliver:

- Multi-tenant schema.
- Migrations.
- Seed.
- Auth.
- Membership model.
- RLS.
- Authorization helpers.

---

## Milestone 2 — Public Storefront

Deliver:

- Store route.
- Store header/status.
- Menu API.
- Categories.
- Products.
- Product bottom sheet.
- Product options.
- Cart persistence.

---

## Milestone 3 — Checkout & Orders

Deliver:

- Delivery/pickup.
- Customer form.
- Validation.
- Turnstile.
- Rate limit.
- Pricing engine.
- Idempotency.
- Transactional order creation.
- Order success.
- Tracking.

---

## Milestone 4 — Merchant Orders

Deliver:

- Admin layout.
- Order dashboard.
- Order detail.
- Realtime subscription.
- Notification sound.
- Status transitions.
- Order history.

---

## Milestone 5 — Menu Management

Deliver:

- Category CRUD.
- Product CRUD.
- Options CRUD.
- Image upload/compression.
- Sold-out switch.
- Store settings.
- Store hours.

---

## Milestone 6 — Production Hardening

Deliver:

- Unit tests.
- Integration tests.
- Critical E2E.
- Security review.
- RLS review.
- Performance review.
- Accessibility review.
- Mobile device QA.
- Free-tier usage review.
- Backup/hosting launch decision.

---

# 50. Definition of Done — Phase 1

Phase 1 is complete only when:

### Customer

- Can order without login.
- Can select valid product options.
- Cannot submit invalid option combinations.
- Cart persists locally.
- Customer cannot manipulate price.
- Duplicate taps do not create duplicate orders.
- Customer receives order number.
- Customer can securely track status.

### Merchant

- Can login.
- Can only access assigned tenant/store.
- Receives new order updates.
- Can update status only via valid transitions.
- Can manage products/menu sections/options.
- Can mark products sold out.

### Security

- RLS enabled.
- Service role never reaches browser.
- Public order API rate limited.
- Turnstile enforced.
- All public writes validated.
- Server calculates pricing.
- Sensitive order data is not enumerable.

### Infrastructure

- Product images are compressed.
- Storefront query count is controlled.
- Realtime customer connections are avoided.
- No unnecessary Supabase Edge Functions.
- No business logic depends exclusively on Vercel proprietary APIs.
- Free-tier usage can be monitored.

---

# 51. Project Creation Checklist

Use this checklist when starting implementation.

## Repository

- [ ] Create Nuxt 4 project.
- [ ] Enable TypeScript strictness.
- [ ] Configure ESLint.
- [ ] Configure Tailwind CSS.
- [ ] Configure Pinia.
- [ ] Add `.env.example`.
- [ ] Add `.gitignore`.
- [ ] Commit lockfile.

## Supabase

- [ ] Create/link project.
- [ ] Set up local migration workflow.
- [ ] Create organization schema.
- [ ] Create store schema.
- [ ] Create membership schema.
- [ ] Create menu schema.
- [ ] Create order schema.
- [ ] Create indexes.
- [ ] Enable RLS.
- [ ] Add RLS tests.
- [ ] Add seed data.

## Storefront

- [ ] Store resolver.
- [ ] Cached menu endpoint.
- [ ] Store status.
- [ ] Category navigation.
- [ ] Product cards.
- [ ] Product bottom sheet.
- [ ] Generic option selection.
- [ ] Persistent cart.
- [ ] Mobile sticky cart CTA.

## Checkout

- [ ] Delivery/pickup.
- [ ] Customer validation.
- [ ] Turnstile.
- [ ] Rate limiting.
- [ ] Server-side pricing.
- [ ] Idempotency.
- [ ] Atomic order create.
- [ ] Order number generation.
- [ ] Secure tracking token.
- [ ] Success page.
- [ ] Tracking polling.

## Admin

- [ ] Login.
- [ ] Tenant/store authorization.
- [ ] Order queue.
- [ ] Realtime orders.
- [ ] Valid status transitions.
- [ ] Products CRUD.
- [ ] Categories CRUD.
- [ ] Options CRUD.
- [ ] Sold-out toggle.
- [ ] Store settings.
- [ ] Store hours.

## Media

- [ ] Client-side image compression.
- [ ] WebP conversion.
- [ ] File-size validation.
- [ ] Storage path convention.
- [ ] Remove obsolete files.

## QA

- [ ] Pricing unit tests.
- [ ] Order validation tests.
- [ ] Idempotency test.
- [ ] RLS tests.
- [ ] Store isolation tests.
- [ ] E2E checkout.
- [ ] E2E merchant processing.
- [ ] Mobile Safari test.
- [ ] Android Chrome test.
- [ ] Desktop test.
- [ ] Slow-network test.

## Launch

- [ ] Review Vercel plan eligibility.
- [ ] Review Supabase Free quotas.
- [ ] Decide backup strategy.
- [ ] Confirm domain.
- [ ] Configure production env vars.
- [ ] Configure Turnstile domain.
- [ ] Smoke test production deployment.
- [ ] Verify RLS in production.
- [ ] Verify no secret appears in client bundle.

---

# 52. Architecture Decisions — Locked for Initial Build

The following decisions are considered baseline unless intentionally changed through an architecture decision record.

```text
ADR-001
Nuxt Nitro is the application backend.

ADR-002
Supabase provides Postgres/Auth/Storage/Realtime, not scattered application business logic.

ADR-003
Multi-tenant organization/store model exists from day one.

ADR-004
Customers do not require accounts.

ADR-005
Prices are calculated on the server.

ADR-006
Orders snapshot product and option pricing data.

ADR-007
Order creation is idempotent.

ADR-008
Realtime is primarily merchant-facing.

ADR-009
Cart stays client-side until checkout.

ADR-010
Images are compressed before Supabase Storage upload.

ADR-011
Vercel Hobby + Supabase Free are bootstrap/pilot infrastructure constraints, not permanent architectural dependencies.

ADR-012
The application remains portable away from Vercel.

ADR-013
Business-critical launch requires an explicit backup/recovery decision.
```

---

# 53. Recommended First Implementation Ticket

Start with:

```text
FOUNDATION-001 — Bootstrap production codebase
```

Scope:

1. Create Nuxt 4 repository.
2. Add Tailwind CSS.
3. Add Pinia.
4. Add Supabase integration.
5. Add Zod.
6. Add environment validation.
7. Add folder architecture from this document.
8. Initialize Supabase migrations.
9. Implement organizations/stores/store_members.
10. Implement initial RLS helpers.
11. Create one seeded organization/store.
12. Create basic `/s/{public_slug}` route that resolves the seeded store.
13. Add lint + typecheck scripts.
14. Add README setup instructions.

Acceptance criteria:

```text
npm install
npm run dev
```

must start the application successfully.

A fresh local Supabase instance must be reproducible from:

```text
migrations
+
seed
```

The page:

```text
/s/{seeded-store-slug}
```

must resolve the correct store without any hardcoded store ID in Vue components.

---

# 54. Official References / Free-Tier Notes

Verify limits again before production launch because provider quotas and terms can change.

Supabase:

```text
https://supabase.com/pricing
https://supabase.com/docs/guides/platform/billing-on-supabase
https://supabase.com/docs/guides/realtime/limits
```

Vercel:

```text
https://vercel.com/pricing
https://vercel.com/legal/terms
```

---

# Final Baseline

The initial application should behave like a simple food-ordering storefront, but its foundation is a reusable multi-tenant ordering platform.

The desired Phase 1 result is:

```text
Fast customer ordering
+
Simple merchant operations
+
Strong tenant isolation
+
Correct order history
+
Secure server-side pricing
+
Low free-tier infrastructure usage
+
Clear upgrade path
```

Do not sacrifice data model correctness, authorization, idempotency or historical order integrity merely to stay on free infrastructure.
