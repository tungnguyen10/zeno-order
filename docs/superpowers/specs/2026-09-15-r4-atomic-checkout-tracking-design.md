# R4 Atomic Checkout & Tracking Design

**Sources of truth:** `architecture-p0-locked-baseline.md` wins over the older production plan. R1–R3 public catalog, availability and cart contracts are frozen inputs.

## Scope

R4 turns the checkout shell into anonymous customer order submission, creates every order atomically in PostgreSQL, and adds token-protected customer tracking. It includes PostgreSQL rate limiting, Cloudflare Turnstile verification, canonical request hashing, idempotent retries, server-authoritative pricing and a success/tracking flow. It does not add merchant authentication or order operations.

## Public request contract

`POST /api/orders` accepts:

```ts
interface CreateOrderRequest {
  publicSlug: string
  fulfillmentType: 'delivery' | 'pickup'
  customer: { name: string; phone: string }
  delivery: { address: string; note?: string } | null
  customerNote?: string
  paymentMethod: 'cash' | 'bank_transfer'
  items: Array<{
    productId: string
    quantity: number
    optionValueIds: string[]
    note?: string
  }>
  idempotencyKey: string // UUID generated once per checkout attempt
  turnstileToken: string
}
```

The public slug, never a store UUID, identifies the tenant. Delivery requires a non-empty address; pickup requires `delivery: null`. Names, phone, notes, item counts and array sizes have explicit Zod limits. No price field is accepted.

The validated payload is normalized by trimming strings, converting absent optional notes to `null`, preserving item order and sorting each unique `optionValueIds` array. Canonical JSON recursively orders object keys. `requestHash = SHA256(canonical JSON)` covers store slug, fulfillment, customer, delivery, payment method and items, and excludes `turnstileToken`, `idempotencyKey` and all client price snapshots.

## Database model and tenant boundaries

- `orders` stores `store_id` but never duplicates `organization_id`; it has controlled order/fulfillment/payment states, non-negative monetary fields, timestamps, `tracking_token_hash`, `tracking_key_version` and no raw tracking token.
- `order_items` and `order_item_options` are immutable snapshots. They include `store_id` so composite foreign keys enforce that order/product/item relations cannot cross stores. Historical rendering uses snapshot names and prices, not current catalog rows.
- `order_status_history` stores the initial `null → pending` business event and later R5 transitions.
- `order_idempotency` stores `store_id`, UUID key, 64-character request hash, order ID and timestamp with `UNIQUE(store_id, idempotency_key)`.
- `public_rate_limits` stores only a hashed key, route scope, fixed window and counter. It is not a general event log.

All tables have RLS enabled. Anon/authenticated receive no direct privileges. Merchant read policies may be present for R5-compatible order reads, but R4 creates and tracks orders only through explicitly granted RPCs.

## Atomic order RPC

`create_order_atomic` is the only order-write boundary. A dedicated server-only privileged Supabase client invokes it; the browser never receives that credential and cannot call the function directly.

The RPC resolves the active published store, takes a transaction-scoped advisory lock derived from `(store_id, idempotency_key)`, then:

1. Returns the existing order when key and request hash match.
2. Raises `IDEMPOTENCY_CONFLICT` when the key exists with a different hash.
3. Revalidates store open state and fulfillment support at transaction time.
4. Revalidates active/non-sold-out products, product/group/value ownership, unique selections and every required/min/max/single rule.
5. Reloads product and option prices, calculates subtotal, default delivery fee, zero Phase-1 discount and total, and enforces minimum order amount.
6. Inserts order, item snapshots, option snapshots, initial status history and idempotency row in the same transaction.

An advisory lock makes concurrent equal requests converge. Any failure rolls back every insert. The RPC accepts a server-generated candidate order UUID and tracking hash so the hash is persisted in that same transaction; on an idempotent winner it returns the already stored order ID/key version.

## Rate limit and Turnstile

Nitro validates shape and computes the request hash, consumes a PostgreSQL-backed fixed-window limit keyed by route + store + SHA-256(client IP), then checks completed idempotency. A completed same-hash retry returns before Turnstile verification; a different hash returns HTTP 409.

For a new request Nitro sends `secret`, `response`, `remoteip` and the same UUID `idempotency_key` to Cloudflare Siteverify. Network failure, invalid response or missing configuration fails closed outside explicit test mode. Rate-limit rejection is HTTP 429 with `Retry-After`; Turnstile rejection is HTTP 422 with a stable safe code.

## Tracking token and API

Nitro creates a candidate order UUID and derives a 256-bit base64url token:

```text
HMAC-SHA256(versioned_secret, store_id + ":" + order_id + ":" + idempotency_key)
```

Only `SHA256(raw_token)` and `tracking_key_version` are stored. The server retains versioned secrets and can regenerate the same token from the returned order ID on idempotent retry.

`GET /api/storefront/:publicSlug/orders/:orderNumber` requires `Authorization: Bearer <token>`, hashes the token and invokes a limited read-only anon RPC. It always uses `Cache-Control: private, no-store` and returns only order number, customer-safe status, fulfillment type, item/option snapshots, totals and safe timestamps. Missing, invalid and mismatched credentials share a non-enumerating 404 response.

The success URL is `/s/:publicSlug/order/:orderNumber#t=<token>`. The client moves `t` to store-specific `sessionStorage`, immediately removes the fragment with `history.replaceState`, and sends the token only in the Authorization header. The page uses `robots: noindex, nofollow` and `Referrer-Policy: no-referrer`.

## Checkout UX

The mobile checkout collects fulfillment, name, phone, delivery address/note when applicable, optional order note and Phase-1 payment method. Submission creates one UUID and reuses it until the payload changes or a successful order clears the cart. The CTA locks during an in-flight request. Safe server errors remain visible and retryable.

On success the cart is cleared and navigation uses the fragment tracking URL. The tracking page renders the current status and immutable receipt; R4 refreshes on explicit user action and page visibility, while periodic polling remains compatible with the 30–60 second production guidance.

## Acceptance boundaries

- Duplicate and concurrent same-key/same-hash requests return one order; key reuse with changed payload returns 409.
- Invalid product, option, price, availability, minimum amount or fulfillment state creates no partial rows.
- Turnstile is not re-used for completed idempotent retry.
- No raw tracking token or client price is stored; no internal UUID appears in customer responses.
- Tracking tokens never enter query strings, server-rendered HTML, logs by design or cacheable responses.
- R4 introduces no merchant UI, direct browser order write or arbitrary order status mutation.
