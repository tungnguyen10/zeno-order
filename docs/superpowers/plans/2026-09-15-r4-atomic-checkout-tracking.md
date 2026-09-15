# R4 Atomic Checkout & Tracking Implementation Plan

> **Execution:** use Superpowers test-driven-development task by task, Supabase/Postgres best practices for every database change, and verification-before-completion for each gate.

**Goal:** Create anonymous customer orders exactly once with database-authoritative pricing and provide secure token-based tracking.

## Task 0 — Reconcile source documentation

Update the older production plan where it still shows `storeId`, non-UUID idempotency examples or ambiguous cart namespacing. Preserve the locked `/s/{publicSlug}`, server-only pricing and fragment tracking contracts. Search both source documents to prove no active R4 contract conflicts remain.

## Task 1 — Order schema, privileges and RLS

Write failing pgTAP tests, then add `orders`, `order_items`, `order_item_options`, `order_status_history`, `order_idempotency`, `public_rate_limits` and a global display-number sequence. Enforce controlled values, length/money/arithmetic checks, explicit delete behavior, composite tenant foreign keys, indexes and timestamps. Enable RLS and deny all direct anon/authenticated writes; add only R5-compatible member reads. Seed no order/customer data.

**Gate:** schema/constraint/privilege pgTAP passes and cross-store inserts fail.

## Task 2 — Atomic pricing and idempotency RPC

Write failing pgTAP cases for valid delivery/pickup orders, snapshots, totals, required and foreign options, duplicates, sold-out/inactive products, closed store, unsupported fulfillment, minimum amount, rollback, same-key retry, conflict and concurrent convergence. Implement the server-only `create_order_atomic` RPC plus limited idempotency lookup. Use a transaction advisory lock and revalidate all inputs/prices inside PostgreSQL.

**Gate:** the RPC is the only order writer; equal retries return one order and every invalid request leaves all order tables unchanged.

## Task 3 — PostgreSQL rate limiter and server crypto

Write unit/pgTAP tests for fixed-window counters, privacy-preserving keys, canonical JSON, hash stability, versioned HMAC generation/reproduction and timing-safe token hash comparison. Implement a server-only rate-limit RPC and crypto/config modules. Add environment variables for Turnstile, order rate limits and versioned tracking secrets without exposing secrets in public runtime config.

**Gate:** boundary tests pass, secrets are absent from client output and rate-limit state stores no raw IP.

## Task 4 — Turnstile and create-order Nitro API

Write route/service tests first. Implement Siteverify with the same idempotency UUID, completed-retry short circuit, safe 400/404/409/422/429/500 envelopes and a narrowly scoped privileged order client. Invoke the atomic RPC with a server-generated candidate order ID/token hash; regenerate the winner token on retry.

**Gate:** API tests prove call ordering, no client pricing, no Turnstile replay on completed retry and stable error mapping.

## Task 5 — Checkout UI and success navigation

Write Nuxt tests for conditional delivery fields, validation, locked submit, stable retry key, payload-change key rotation, errors, success cart clearing and fragment navigation. Replace the R3 shell with the real form and a Turnstile widget adapter. Preserve the 360–430 px baseline and keyboard labels.

**Gate:** checkout component/page tests pass without any direct Supabase browser write.

## Task 6 — Tracking RPC, API and page

Write pgTAP and route tests for token match/mismatch, tenant/order-number mismatch, safe DTOs and no-store headers. Implement the read-only RPC and Nitro endpoint. Build the tracking page to consume the fragment into store-scoped sessionStorage, strip it immediately, send only a bearer header, render noindex/no-referrer metadata and support safe refresh.

**Gate:** wrong and missing credentials are non-enumerating; raw tokens and UUIDs never appear in database/customer output.

## Task 7 — Concurrency, E2E and operations

Add a parallel-request integration test and mobile Chromium checkout → success → fragment stripped → reload/track flow. Update README/CI, apply the migration to the linked development project, run all pgTAP suites and advisors, then run `npm run verify`, secret scan and Playwright.

**Gate:** all R1–R4 suites pass from a clean schema; the linked project migration list matches local; no security advisor error remains.

## R4 Definition of Done

- One logical checkout creates exactly one complete order under retries/concurrency.
- PostgreSQL is authoritative for availability, option rules and all money.
- Rate limiting and Turnstile fail safely; completed retries do not consume a Turnstile token again.
- Tracking uses a versioned HMAC token, stores only its hash and never treats order number as authorization.
- Customer routes leak no internal UUID or private field and use the required cache/SEO/referrer policies.
- The full app, database, build, secret and browser gates pass.
