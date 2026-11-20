# Tier 1 roadmap — implementation

Implements the five Tier 1 features from `ZENO_ORDER_FEATURE_ROADMAP.md` plus the agreed P1 extensions, on top of V1 (PR1–PR6). Payment code was intentionally not touched. Built to the existing repo conventions: Z* primitives in pages/layouts, no Pinia (composables + `useState`), Zod schemas in `shared/` as the source of truth, business logic in `server/services`, Drizzle migrations, tenant-scoped queries.

Use this document to recheck each feature: every item lists the delivered behavior, the files that carry it, and how to verify it.

## Feature 4 — Category image (+ product description)

- **Delivered:** Product description was already fully built in V1; only category images were added. Owners upload/replace/remove a per-category image (JPG/PNG/WebP, ≤2 MB, content-sniffed server-side) from the menu admin page. The customer menu shows the image as a thumbnail on the category chip. Upload mirrors the product-image flow exactly (tenant-scoped S3 key `stores/<storeId>/categories/<categoryId>/<token>.<ext>`, row updated in a `FOR UPDATE` transaction, old object deleted after commit, orphan cleanup on failure).
- **Files:** `server/db/schema/catalog.ts` (`categories.image_key`), `shared/types/catalog.ts` (`CategoryDTO.imageUrl`, `PublicCategory.imageUrl`), `server/services/catalog/categories.ts` (`toDTO` maps `imageUrl`), `server/services/catalog/category-image.ts` (`replaceCategoryImage`, `removeCategoryImage`), `server/api/stores/[storeId]/categories/[categoryId]/image.post.ts` + `.delete.ts`, `server/services/catalog/public-menu.ts` (maps category `imageUrl`), `app/composables/useMenuAdmin.ts` (`replaceCategory`), `app/components/menu/CategoryManager.vue` (upload + "Xoá ảnh"), `app/components/menu/CategoryChips.vue` (thumbnail), `app/pages/app/menu.vue` + `app/pages/s/[slug].vue` (wiring).
- **Migration:** `drizzle/0006_category_image.sql`.
- **Verify:** `tests/integration/catalog-category-image.test.ts` (upload/replace/remove, tenant isolation, bad-file rejection) and the updated `tests/integration/catalog-categories.test.ts`. Manually: menu admin → a category → "Thêm ảnh"/"Đổi ảnh"/trash icon; customer menu chip shows the thumbnail.

## Feature 5 — Re-order ("Đặt lại")

- **Delivered:** Recent orders already persisted to `localStorage`; the stored snapshot was extended to include line items (productId, optionValueIds, qty, note), backward-compatible (`items` defaults to `[]` for legacy entries). A "Đặt lại" button rebuilds the cart from a past order, reconciled against the current menu — unavailable products and invalid option selections are dropped, quantities clamped. After re-order the checkout sheet opens automatically. Entirely client-side, no account.
- **Files:** `app/utils/recent-orders.ts` (`RecentOrderItem`, schema with `items`), `app/utils/reorder.ts` (pure `planReorder`), `app/components/order/CheckoutSheet.vue` (captures items on success), `app/components/order/RecentOrders.vue` ("Đặt lại" + `reordered` emit), `app/pages/s/[slug].vue` (opens checkout on `reordered`).
- **Verify:** `tests/unit/app/reorder.test.ts` (keep/drop/clamp cases), `tests/unit/app/recent-orders.test.ts` (back-compat), `tests/nuxt/order/recent-orders-reorder.test.ts` (cart rebuild + emit). Manually: place an order, revisit the store menu → "Đặt lại" → cart fills and checkout opens.

## Feature 3 — Opening hours & quick pause

- **Delivered:** Stores gain an optional weekly schedule and a temporary "pause until" override. Opt-in: with no schedule the manual `isAcceptingOrders` flag governs alone. Checkout is gated server-side (`STORE_CLOSED`) when paused or outside hours. The customer menu reflects open/closed and shows a Vietnamese hint ("Mở lúc 07:00 ngày mai"), and the client re-evaluates open/closed live from the schedule so it flips at the exact boundary without a refetch. Settings has an "Giờ hoạt động" tab: per-weekday open/close, plus quick-pause buttons (30 min / 1 h / end of day / resume). All times are Vietnam local (UTC+7, no DST).
- **Files:** `shared/store-hours.ts` (pure: `openingHoursSchema`, `evaluateOpen`, `describeOpenState`, `toVnLocal`), `server/db/schema/identity.ts` (`stores.opening_hours` jsonb, `paused_until`), `shared/schemas/identity.ts` (`updateStoreInputSchema` gains `openingHours`/`pausedUntil`), `shared/types/identity.ts` (`StoreDetail`), `server/services/store/settings.ts`, `server/services/ordering/create-order.ts` (`assertStoreAcceptsOrders` gate), `server/repositories/public-store.ts` + `server/services/catalog/public-menu.ts` (ship `openNow`/`closedHint`/`openingHours`/`pausedUntil`), `shared/types/catalog.ts` (`PublicMenu.store`), `app/components/settings/HoursTab.vue`, `app/pages/app/settings.vue` (tab), `app/pages/s/[slug].vue` (live re-evaluation).
- **Migration:** `drizzle/0007_store_opening_hours.sql`.
- **Verify:** `tests/unit/shared/store-hours.test.ts` (18 cases: timezone, boundaries, pause precedence, next-open search, schema), `tests/nuxt/app/hours-tab.test.ts` (pause + save), `tests/integration/create-order.test.ts` (new STORE_CLOSED cases for pause + all-days-closed). Manually: Settings → Giờ hoạt động → set hours or pause; customer menu shows closed banner and blocks checkout.

## Feature 2 — Kitchen printer (CSS print + Web Bluetooth)

- **Delivered:** Two printing paths. (1) Browser/OS print dialog via a hidden iframe (works on any 58/80 mm printer, no popup permission). (2) Web Bluetooth ESC/POS directly to a paired BLE thermal printer (Chromium + HTTPS). A shared ticket model renders code, place/table, time, items with options **and per-item notes**, and customer/delivery meta. ESC/POS output folds Vietnamese diacritics to ASCII for legibility. Owner chooses paper width (58 mm = 32 cols / 80 mm = 48 cols, persisted), can enable auto-print on new orders, and prints a single order from the order-detail slideover.
- **Files:** `shared/kitchen-ticket.ts` (`buildKitchenTicket`, `ticketToText`, `encodeTicketEscPos`, `stripVietnameseTones`), `app/utils/print-ticket.ts` (`ticketHtml`, `printTicketViaBrowser`, width-parametrized), `app/utils/bluetooth-printer.ts` (`connectPrinter`), `app/composables/usePrinter.ts` (method/autoPrint/paperWidth/connection/print), `app/components/app/PrinterControl.vue` (settings sheet), `app/components/app/OrderDetailSlideover.vue` ("In bếp" + per-item note display), `app/pages/app/orders.vue` (control + auto-print on new orders). Per-item note also flows through `shared/types/orders.ts` (`BoardOrderItem.note`) and `server/services/ordering/board.ts`.
- **Verify:** `tests/unit/shared/kitchen-ticket.test.ts` (ticket build, text wrap, ESC/POS framing, diacritic folding), `tests/unit/app/print-ticket.test.ts` (HTML, XSS-escaping, paper width), `tests/nuxt/app/printer.test.ts` (routing, paper width, persistence). Manually: order board → "Máy in" to configure; open an order → "In bếp".

## Feature 1 — Realtime Web Push

- **Delivered:** Web Push for the owner/staff order board, sized for Vercel serverless (no SSE/long-lived connections). A service worker shows notifications and focuses the board on click. Owners/staff opt in from the board ("Bật thông báo"); subscriptions are stored per store. A new COD order (status NEW) pushes the store's devices with code + fulfillment + total. The feature stays off unless the three VAPID env vars are set; dead endpoints (404/410) are pruned. Polling remains as the baseline. Scope is owner/staff only (not guests); BANK_QR→NEW via the SePay webhook is left out as it touches payment.
- **Files:** `server/db/schema/push.ts` (`push_subscriptions`), `shared/schemas/push.ts`, `server/services/push/vapid.ts` / `subscriptions.ts` / `notify.ts`, `server/api/stores/[storeId]/push/subscribe.post.ts` + `.delete.ts`, `server/services/ordering/create-order.ts` (fires `notifyNewOrder` on COD→NEW), `public/sw.js`, `app/plugins/register-sw.client.ts`, `app/utils/push.ts`, `app/composables/usePushNotifications.ts`, `app/components/app/PushToggle.vue`, `app/pages/app/orders.vue` (toggle), `nuxt.config.ts` (`runtimeConfig.public.vapidPublicKey`), `.env.example` (VAPID vars).
- **Migration:** `drizzle/0008_push_subscriptions.sql`.
- **Verify:** `tests/unit/app/push.test.ts` (base64 key decode), `tests/unit/shared/push-schema.test.ts`, `tests/unit/server/push-notify.test.ts` (payload), `tests/integration/push-subscriptions.test.ts` (upsert, tenant isolation, removal). Manually (needs real VAPID keys): `npx web-push generate-vapid-keys` → set env → board → "Bật thông báo" → place a COD order.

## Decisions and handoff

- **No payment code touched.** Push on BANK_QR (webhook NEW transition) and guest-facing push are deliberately deferred.
- **Opt-in semantics.** Opening hours and Web Push are both inert until configured; the pre-existing manual accepting flag and polling keep working unchanged.
- **Timezone.** `shared/store-hours.ts` fixes Vietnam at UTC+7 with no DST; the 7-day array is Sunday-indexed to match `Date.getUTCDay`.
- **Reuse.** Category image reuses the product-image `ImageStorage` seam and bucket; auto-print reuses the `detectNewOrderIds` seen-set pattern from `useOrderAlerts`; the create-order gate extends the existing `assertStoreAcceptsOrders`.
- **Migrations** `0006`/`0007`/`0008` are additive (new column/columns/table). `drizzle-kit check` passes; apply with `npm run db:migrate` before enabling the features that need them (all three).

## Verification

Run under Node 22 (`nvm use 22`); the box default Node 18 is too old for vitest/rolldown.

- Typecheck: `npm run typecheck` — PASS (clean).
- Unit: `npm run test:unit` — PASS (1102 tests, 81 files).
- Nuxt components: `npm run test:nuxt` — PASS (193 tests, 42 files).
- Lint: `npm run lint` — PASS.
- Migrations: `npx drizzle-kit check` — "Everything's fine" (0000–0008 consistent).

Not runnable in this environment (no Neon `.env.test`): the integration/API suites. Written to the repo's conventions for CI:
- `npm run test:integration` — includes `catalog-category-image` (incl. remove), `push-subscriptions`, and the new `create-order` STORE_CLOSED (pause + all-days-closed) cases.
- `npm run test:api` — tenant matrix picks up the new `openingHours`/`pausedUntil` menu fields and category-image endpoints.

Before enabling in an environment: apply migrations `0006`–`0008`; for push, generate VAPID keys and set `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`.

## Deferred (P2, not implemented)

#2 test-print button + auto-print across non-visible tabs; #3 split/overnight hours + "apply to all days"; #5 re-order on `/o/:token` + customer prefill; #4 category image in section header; #1 send-test-push + iOS PWA hint. Payment-side push intentionally excluded.
