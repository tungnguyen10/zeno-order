# R5 — Merchant Order Operations Design

## Scope

R5 adds merchant authentication, a tenant-scoped order queue/detail flow, controlled status transitions and merchant-only Realtime refresh. Catalog mutation remains R6.

## Security boundary

- The browser authenticates with Supabase Auth and receives only its user JWT.
- Every merchant Nitro endpoint requires `Authorization: Bearer <JWT>`, validates the user, then forwards the same JWT to Supabase.
- Merchant reads and status updates run as `authenticated`; RLS remains the final tenant boundary. The service-role key is never used by merchant APIs.
- Authorized merchant DTOs may contain store/order UUIDs because they are operational identifiers behind authentication.

## Status state machine

Allowed transitions are:

- `pending → confirmed | cancelled`
- `confirmed → preparing | cancelled`
- `preparing → ready | cancelled`
- `ready → completed | cancelled` for pickup
- `ready → delivering | cancelled` for delivery
- `delivering → completed | cancelled`
- `completed` and `cancelled` are terminal

A database trigger rejects invalid transitions, stamps lifecycle timestamps and writes `order_status_history` with `auth.uid()`. The RPC is security-invoker and updates through RLS.

## HTTP/UI contracts

- `GET /api/merchant/stores`
- `GET /api/merchant/stores/:storeId/orders?status=&limit=`
- `GET /api/merchant/stores/:storeId/orders/:orderNumber`
- `PATCH /api/merchant/stores/:storeId/orders/:orderNumber/status`
- `/admin/login`, `/admin/orders`, `/admin/orders/:orderNumber`

Responses use authenticated merchant DTOs and never return tracking-token hashes, idempotency keys or customer tracking secrets.

## Consistency

The order queue performs an initial/refocus/manual fetch. A store-filtered Supabase Realtime subscription only signals that the queue should refetch; reconnect also refetches. Realtime is an enhancement, never the source of truth.
