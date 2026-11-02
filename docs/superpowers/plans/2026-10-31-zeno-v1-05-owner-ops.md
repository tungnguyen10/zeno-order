# ZENO Mini Order V1 — PR4 Owner Ops: Order Board, Trạng thái, Hủy, Đã thu tiền, Mời nhân viên, Báo cáo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chủ quán và nhân viên phục vụ được đơn trả khi nhận (COD) end-to-end tại một cửa hàng: xem đơn mới trên board mobile, chuyển trạng thái bằng một chạm, hủy có lý do, ghi nhận đã thu tiền mặt, mời nhân viên bằng link, xem báo cáo ngày/7 ngày/30 ngày theo giờ Việt Nam (PRD Phase 3 exit).

**Architecture:** Toàn bộ thay đổi trạng thái đi qua một service dùng *optimistic concurrency*: `UPDATE orders … WHERE id = ? AND store_id = ? AND status = :expected`, 0 dòng bị ảnh hưởng thì trả 409 `STATUS_CONFLICT` và UI tải lại. Bảng chuyển trạng thái (`nextStatuses`, `canCancel` của PR3) là hàm thuần ở server; PR4 thêm bản thuần dùng chung cho client `shared/order-flow.ts` và một test vét cạn khóa hai bản không lệch nhau. Mời nhân viên dùng token 32 byte chỉ lưu sha256, nhận lời mời chạy trong một transaction (`ensureProfile` → khóa dòng lời mời → kiểm tra email → tạo membership → đánh dấu đã dùng). Board poll 5 s khi tab hiển thị, báo đơn mới bằng toast + tiêu đề tab + beep (chỉ sau tương tác).

**Tech Stack:** Nuxt 4.5.2, Nuxt UI 4.12.0 (qua `Z*` primitives), drizzle-orm 0.45.4, zod 4.6.5, jose 6.2.14, vitest 5, @nuxt/test-utils 4.3.2, Playwright 1.63.

**Spec:** [2026-10-31-zeno-mini-order-v1-design.md](../specs/2026-10-31-zeno-mini-order-v1-design.md) (§4.1, §4.2, §5.3–5.5, §7, §8, §9, §10) · Roadmap: [2026-10-31-zeno-v1-00-roadmap.md](./2026-10-31-zeno-v1-00-roadmap.md) (mục PR4, quy ước xuyên PR 1/6/7, Review Focus #9) · UI: [2026-10-31-ui-foundation-design.md](../specs/2026-10-31-ui-foundation-design.md) · Style tham chiếu: [PR1](./2026-10-31-zeno-v1-02-core-auth-tenancy.md) · Phụ thuộc: PR2 (`tokens.ts`) và PR3 (`orders`, `order_items`, `order_events`, `transitions.ts`, `insertRawOrder`, `safePath`, `useVisiblePolling`) đã merge.

## Đối chiếu khi thực thi PR4 (2026-11-02)

Code PR3 thực tế **chưa có** `orders_board_idx`; `0003_owner_ops` bổ sung index vào `server/db/schema/ordering.ts` cùng bảng `order_payments`. Những ghi chú bên dưới nói index đã có từ PR3 là giả định trước khi đối chiếu. UI team/reports được tách thành component nhỏ; quy trình trạng thái và response API giữ nguyên. Thay vì tạo helper UUID trùng, tái sử dụng `server/utils/ids.ts`. Bảng đơn dùng lại `AppStoreStatusAlert` để giữ nút bật nhận đơn một chạm của PR3; không thay bằng link vào settings. Kết quả thực thi và xác minh xem [PR4 implementation](../specs/2026-11-02-pr4-owner-ops-implementation.md).

## Global Constraints

Áp dụng "Global Constraints" của roadmap. Điểm chạm PR này:
- Không có quyền với resource tồn tại → **404 `NOT_FOUND`** (giống hệt UUID không tồn tại); có membership nhưng thiếu role → **403 `FORBIDDEN`**; thiếu/sai token → **401 `UNAUTHENTICATED`**. `orderId` hoặc `storeId` không phải UUID → 404 (không phải 400/500).
- Mọi query đơn/thành viên/lời mời đều có `org_id` **và** `store_id` trong `WHERE`; bảng con tham chiếu `(store_id, parent_id)`. `order_payments` có composite FK `(org_id, store_id) → stores(org_id, id)` và `(store_id, order_id) → orders(store_id, id)`.
- Tiền VND `bigint` (mode `number`), số nguyên ≥ 0; "đã thu" luôn lấy từ `order_payments`, không bao giờ từ `orders.total_vnd`.
- Mọi chuyển trạng thái: `UPDATE … WHERE id=? AND store_id=? AND status=:expected`; 0 dòng ⇒ 409 `STATUS_CONFLICT`; ghi `order_events` với `actor_user_id` trong cùng transaction.
- Token mời: 32 byte random base64url (`generateToken()` của PR2); DB chỉ lưu `sha256` hex (`hashToken()`); link trả về **một lần**, hạn 7 ngày, dùng một lần. Không log token (logger đã redact key chứa `token`).
- Log qua `logger` (redact PII); không log SĐT/địa chỉ/token.
- Transaction chỉ nằm trong `server/services/**`; route handler mỏng (parse → guard → service); repository luôn nhận `{ orgId, storeId }`.
- Thời gian báo cáo `Asia/Ho_Chi_Minh` (UTC+7, không có DST).
- UI tiếng Việt, mobile-first 360px, vùng bấm ≥ 44px, mọi màn có loading/empty/error; `pages/` và `layouts/` chỉ dùng `Z*` (ESLint enforce), Nuxt UI trực tiếp chỉ trong `app/components/app/**`.
- Commit conventional, kèm trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

## Ma trận quyền (role matrix, theo spec §5.3, §5.4, §8)

| Hành động | OWNER | STAFF | Ghi chú |
|---|---|---|---|
| Xem board, chi tiết đơn | ✓ | ✓ | store được cấp |
| Chuyển trạng thái (`PATCH …/status`) | ✓ | ✓ | `AWAITING_PAYMENT → NEW` là của hệ thống (PR6), không qua endpoint này |
| Hủy đơn chưa thu tiền (`payment_status ∈ {UNPAID, PENDING}`) | ✓ | ✓ | chỉ từ `AWAITING_PAYMENT`, `NEW`, `PREPARING` |
| Hủy đơn đã `PAID` | ✓ (`payment_status → REFUND_DUE`) | ✗ 403 | |
| Mark-paid `CASH` (đơn COD) | ✓ | ✓ | `BANK_MANUAL`, `REFUND_DUE → REFUNDED` là PR6, chỉ owner |
| `GET …/summary?date=` (một ngày) | ✓ | ✓ | spec §8: "staff chỉ store được cấp" |
| `GET …/reports?range=` (7/30 ngày, top món) | ✓ | ✗ 403 | mở rộng ngoài spec, chọn bảo thủ |
| Mời / xem / khóa nhân viên, thu hồi lời mời | ✓ | ✗ 403 | |
| Xem + nhận lời mời của chính mình | — | — | bất kỳ user đăng nhập có token và email khớp |

## Điểm nối với PR2/PR3 (đã đối chiếu với plan PR3 `…-04-ordering.md`)

Các tên dưới đây lấy từ roadmap **và** từ plan chi tiết PR3 (đã có khi viết plan này). Task 1 Step 1 kiểm lại bằng `grep` trên code thật trước khi bắt đầu; nếu code thật lệch plan PR3, sửa đúng các điểm nêu ở "Điểm sửa nếu lệch", không đổi thiết kế.

| Tên (Consumes) | Nguồn | Hình dạng đang dựa vào |
|---|---|---|
| `orders`, `orderItems`, `orderEvents` | `server/db/schema/ordering.ts` (migration `0002_ordering`) | `orders.{id, orgId, storeId, publicCode, tableId, tableLabel, customerName, customerPhone, deliveryZoneId, deliveryZoneName, addressSnapshot (text), notes, subtotalVnd, deliveryFeeVnd, totalVnd, status, paymentMethod, paymentStatus, latePayment, idempotencyKey, guestTokenHash, guestTokenEncrypted, createdAt, updatedAt}`; `unique(store_id, id)` tên `orders_store_id_id_uq`; check `orders_money_check` (`total = subtotal + delivery_fee`); **index `orders_board_idx (store_id, status, created_at desc)` đã có sẵn từ PR3**. `orderItems.{…, position (NOT NULL), nameSnapshot, optionsSnapshotJson: OrderItemOptionSnapshot[], qty (1–50), unitPriceVnd, lineTotalVnd}` với check `line_total = unit_price * qty`. `orderEvents.{…, actorUserId (nullable), eventType (text), fromState (text), toState (text), metadata (jsonb NOT NULL default {}), createdAt}` |
| Enum | `shared/enums.ts` | `ORDER_STATUSES`, `PAYMENT_STATUSES`, `FULFILLMENT_TYPES`, `PAYMENT_METHODS` (`as const`) + kiểu `OrderStatus`, `PaymentStatus`, `FulfillmentType`, `PaymentMethod` |
| `nextStatuses`, `canCancel`, `ActorRole` | `server/services/ordering/transitions.ts` (PR3 Task 6) | `type ActorRole = StoreRole \| 'SYSTEM'`; `nextStatuses(order: { status; fulfillmentType }, actorRole: ActorRole): OrderStatus[]` (không bao giờ chứa `CANCELLED`; `DELIVERING → ['COMPLETED']`); `canCancel(order: { status; paymentStatus }, actorRole: ActorRole): boolean` |
| `insertRawOrder` | `tests/support/checkout-fixtures.ts` (PR3 Task 3) | `insertRawOrder(store: { id; orgId }, over?: Partial<typeof orders.$inferInsert>)` |
| `safePath` | `server/utils/safe-path.ts` (PR3 Task 7) | `safePath(rawPath: string): string`; `api-handler.ts` đã gọi nó khi log lỗi 5xx |
| `useVisiblePolling` | `app/composables/useVisiblePolling.ts` (PR3 Task 9) | `useVisiblePolling(task, { intervalMs, enabled? })`: gọi ngay khi mount, rồi mỗi `intervalMs` chỉ khi tab hiển thị, không chạy chồng |
| `generateToken`, `hashToken` | `server/utils/tokens.ts` (PR2 Task 1) | `generateToken(bytes = 32): string` (base64url, 43 ký tự); `hashToken(token: string): string` (sha256 hex) |
| `getDb`, `Db`, `DbOrTx`, `AppError`, `defineApiHandler`, `parseBody`, `parseQuery`, `requireStoreStaff`, `requireStoreOwner`, `StoreContext`, `ensureProfile`, `findStoreAccess`, `getPgError`, `isUniqueViolation`, `extractApiError`, `useApi`, `useMe`, `useActiveStore`, `AppCopyField`, `AppPageHeader`, `AppEmptyState`, `Z*` | PR0/PR1 + UI foundation | như code hiện có trong repo |

**Điểm sửa nếu lệch:** `server/repositories/orders.ts` (ánh xạ cột), `server/services/ordering/board.ts` hàm `toBoardOrder`, `tests/support/order-fixtures.ts` (cột NOT NULL/check mà PR3 thêm), `shared/order-snapshot.ts` (hình dạng `options_snapshot_json`). Hai chỗ PR3 đã làm trước roadmap: index board (PR4 **không** thêm index nữa) và `orders.table_label` (board đọc nhãn bàn từ đây, không join `store_tables`).

## Review Focus

PR này sở hữu Review Focus #9 của roadmap và bốn tình huống thực tế khác mà spec không nói rõ:
1. **Hai nhân viên bấm chuyển trạng thái cùng lúc** (cả cùng đích lẫn khác đích) → đúng một người thắng, người kia nhận 409 `STATUS_CONFLICT`, board tải lại và báo "Đơn vừa được người khác cập nhật"; chỉ có đúng một `order_events`. → Task 4 (integration `Promise.all`), Task 9, Task 11 (E2E hai browser context).
2. **Nhân viên hủy đơn đúng lúc đơn vừa được thu tiền** (mark-paid song song, hoặc double tap "Đã thu") → không bao giờ ra trạng thái "hủy nhưng đã thu mà không REFUND_DUE"; mark-paid hai lần chỉ có một `order_payments`. → Task 5.
3. **Nhận lời mời sai cách:** email khác (link bị chuyển tiếp), email viết hoa/thường lẫn lộn, bấm "Tham gia" hai lần/hai tab, link quá hạn, đã dùng, email chưa xác minh → người sai **không đốt** token; đúng một membership; lỗi không lộ lời mời có thật hay không (404 đồng nhất). → Task 7.
4. **Đơn lúc 23:30 và 00:30 giờ VN, và ranh giới đúng 00:00** rơi đúng ngày; "đã thu" không lấy từ `total_vnd`; đơn hủy không tính vào doanh thu. → Task 8.
5. **Đơn `AWAITING_PAYMENT` không vào tab "Mới" và không phát âm báo; poll thất bại (mất mạng) giữ danh sách cũ kèm cảnh báo thay vì xóa trắng;** phân trang cursor không trùng/sót khi nhiều đơn cùng `created_at` (kể cả khác nhau ở micro giây). → Task 3 (service + API), Task 9 (unit + component), Task 11 (E2E cảnh báo poll lỗi).

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `server/db/schema/owner-ops.ts` (create) | enum `order_payment_method`, bảng `order_payments` (index board đã có ở PR3: `orders_board_idx`) |
| `server/db/schema/index.ts` (modify) | re-export `owner-ops` |
| `drizzle/00NN_owner_ops.sql` (generated, `0003_owner_ops`) | migration |
| `shared/order-flow.ts` | tab board, nhãn tiếng Việt, `advanceTargets`, `primaryAction`, `transitionLabel`, `canCancelOrder`, `paymentStatusAfterCancel`, `canMarkCashPaid` (thuần, dùng cả client lẫn server) |
| `shared/order-snapshot.ts` | `optionLabels(snapshot)` |
| `shared/schemas/orders.ts` | zod: `boardQuerySchema`, `statusChangeSchema`, `cancelOrderSchema`, `markPaidSchema` |
| `shared/schemas/team.ts`, `shared/email.ts` | zod: `inviteInputSchema`, `memberStatusSchema`; `maskEmail` |
| `shared/schemas/reports.ts` | zod: `summaryQuerySchema`, `reportQuerySchema` |
| `shared/vn-date.ts` | ngày/khoảng thời gian theo giờ VN |
| `shared/types/orders.ts`, `shared/types/team.ts`, `shared/types/reports.ts` | kiểu response dùng chung |
| `server/repositories/orders.ts`, `server/repositories/reporting.ts` | query đơn/items/events/payments, `transitionOrder`, `markOrderPaid`, `insertOrderEvent`, `insertCashPayment`; truy vấn báo cáo |
| `server/services/ordering/board.ts` | `listBoard`, `getOrderDetail`, `encodeCursor`, `decodeCursor` |
| `server/services/ordering/conflicts.ts`, `change-status.ts`, `cancel-order.ts`, `record-cash-payment.ts` | `statusConflict`; `changeOrderStatus`; `cancelOrder`; `recordCashPayment` |
| `server/services/identity/team.ts` | `listTeam`, `setMemberStatus`, `createInvitation`, `revokeInvitation` |
| `server/services/identity/invitations.ts` | `previewInvitation`, `acceptInvitation` |
| `server/services/reporting/summary.ts`, `server/services/reporting/reports.ts` | `getDailySummary`, `getReport` |
| `server/auth/jwt.ts` (modify), `server/utils/api-handler.ts` (modify), `server/utils/redact-path.ts` | claim `emailVerified`; che token lời mời trong path khi log lỗi (`redactPath(safePath(path))`) |
| `server/utils/env.ts` (modify), `server/utils/params.ts` | `appBaseUrl`, `inviteRequiresVerifiedEmail`, `requireUuidParam` |
| `server/api/stores/[storeId]/orders/**`, `…/summary.get.ts`, `…/reports.get.ts`, `…/team/**`, `server/api/invitations/[token]/**` | route handlers mỏng |
| `tests/support/order-fixtures.ts`, `tests/support/auth.ts` (modify) | `createOrderRow`, `createOrderItem`, `createPaymentRow`, `createInvitationRow`; claim `emailVerified` |
| `tests/api/tenant-isolation.test.ts` (modify) | hàng ma trận mới |
| `app/utils/order-board.ts`, `order-view.ts`, `time-ago.ts`, `after-signup.ts`, `invite-errors.ts` | helper thuần cho board, view, đăng ký qua lời mời |
| `app/composables/useOrderBoard.ts`, `useOrderAlerts.ts` | state + poll (qua `useVisiblePolling` của PR3) + âm báo |
| `app/components/app/BoardTabs.vue`, `OrderCard.vue`, `OrderDetailSlideover.vue` | UI board |
| `app/pages/app/orders.vue` (rewrite), `team.vue`, `reports.vue`, `app/pages/invite/[token].vue` | màn hình |
| `app/layouts/owner.vue`, `app/pages/signup.vue`, `app/pages/login.vue` (modify) | nav theo role; signup/login giữ `redirect=/invite/…` |
| `playwright.config.ts` (modify), `tests/e2e/owner-ops.spec.ts`, `tests/e2e/tsconfig.json`, `tests/e2e/support/flows.ts` | E2E owner + staff |

**Quyết định cần ghi vào spec/roadmap khi merge** (xem "PR4 Exit Checklist"): (a) trang `/app/team` thay cho tab "Nhân viên" trong settings, vì PR2 đang đổi cấu trúc settings; (b) `emailVerified` bắt buộc theo cờ `INVITE_REQUIRE_VERIFIED_EMAIL` (mặc định bật); (c) `GET …/reports` owner-only; (d) `order_payments` có `unique(order_id)`; (e) board poll lại trang đầu thay vì delta-poll (delta không biểu diễn được đơn rời khỏi tab); (f) migration `owner_ops` chỉ còn `order_payments` vì PR3 đã tạo index board.

---

### Task 1: Migration `owner_ops` — `order_payments`, fixtures đơn hàng

**Files:**
- Create: `server/db/schema/owner-ops.ts`, `tests/support/order-fixtures.ts`, `tests/integration/owner-ops-schema.test.ts`, `drizzle/0003_owner_ops.sql` (generated; số thứ tự do `drizzle-kit` gán)
- Modify: `server/db/schema/index.ts`

**Interfaces:**
- Consumes: `orders`, `orderItems` (PR3), `insertRawOrder` (PR3 `tests/support/checkout-fixtures.ts`), `stores`, `userProfiles` (PR1), `getDb`, `closeDb`, `resetDb`, `createTenant`, `createUser`, `getPgError`, index `orders_board_idx` (PR3).
- Produces:
  - `orderPaymentMethod` (pgEnum `order_payment_method`: `'CASH' | 'SEPAY' | 'BANK_MANUAL'`), `orderPayments` (cột: `id, orgId, storeId, orderId, bankTransactionId (nullable, chưa FK — PR6 thêm), method, amountVnd, note, recordedBy, recordedAt`).
  - Constraint names: `order_payments_store_fk`, `order_payments_order_fk`, `order_payments_order_uq`, `order_payments_amount_nonneg`; index `order_payments_store_recorded_idx`.
  - Fixtures trong `tests/support/order-fixtures.ts` (giữ tổng/phụ khớp check `orders_money_check` và `order_items_money_check` của PR3 khi chỉ truyền một phần số tiền):
    - `createOrderRow(store: { id: string; orgId: string }, overrides?: Partial<typeof orders.$inferInsert>)` → hàng `orders` (nếu chỉ truyền `totalVnd`, `subtotalVnd = totalVnd - deliveryFeeVnd`)
    - `createOrderItem(order: { id: string; orgId: string; storeId: string }, overrides?: Partial<typeof orderItems.$inferInsert>)` → hàng `order_items` (nếu chỉ truyền `qty` + `lineTotalVnd`, `unitPriceVnd = lineTotalVnd / qty`)
    - `createPaymentRow(order: { id: string; orgId: string; storeId: string }, overrides?: Partial<typeof orderPayments.$inferInsert>)` → hàng `order_payments`
    - `createInvitationRow(store: { id: string; orgId: string }, opts: { email: string; createdBy: string; expiresAt?: Date; acceptedAt?: Date | null })` → `{ token: string; row }` (chỉ hash nằm trong DB)

Ghi chú lệch roadmap: roadmap giao index `orders(store_id, status, created_at desc)` cho migration `owner_ops`, nhưng PR3 đã tạo nó (`orders_board_idx`); PR4 chỉ kiểm tra nó tồn tại và **không** thêm index trùng.

- [ ] **Step 1: Đối chiếu code PR2/PR3 thật với plan PR3**

Run:
```bash
grep -nE "export const (orders|orderItems|orderEvents|orderStatus|paymentStatus|fulfillmentType|paymentMethod)\b" server/db/schema/ordering.ts \
 && grep -nE "ORDER_STATUSES|PAYMENT_STATUSES|FULFILLMENT_TYPES|PAYMENT_METHODS" shared/enums.ts \
 && grep -nE "export (type ActorRole|function (nextStatuses|canCancel))" server/services/ordering/transitions.ts \
 && grep -nE "export function (generateToken|hashToken)" server/utils/tokens.ts \
 && grep -nE "export (async )?function (insertRawOrder)" tests/support/checkout-fixtures.ts \
 && grep -nE "export function (safePath)" server/utils/safe-path.ts \
 && grep -nE "export function (useVisiblePolling)" app/composables/useVisiblePolling.ts \
 && grep -n "orders_board_idx\|tableLabel\|updatedAt\|\.\.\.timestamps" server/db/schema/ordering.ts
```
Expected: mọi lệnh in ra ít nhất một dòng. Nếu code thật lệch plan PR3 (tên, kiểu cột, `eventType` thành `pgEnum`, thiếu `table_label`…), áp dụng "Điểm sửa nếu lệch" ở phần đầu plan **trước** khi sang Step 2; nếu `order_events.event_type` là `pgEnum`, thêm `STATUS_CHANGED`, `CANCELLED`, `PAYMENT_RECORDED` vào enum đó trong migration `owner_ops` (Step 5).

- [ ] **Step 2: Viết fixtures đơn hàng**

`tests/support/order-fixtures.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { getDb } from '../../server/db/client'
import { orderItems, orderPayments, orders, storeInvitations } from '../../server/db/schema'
import { generateToken, hashToken } from '../../server/utils/tokens'
import { insertRawOrder } from './checkout-fixtures'

type Scope = { id: string, orgId: string }
type OrderScope = { id: string, orgId: string, storeId: string }

/** Bọc `insertRawOrder` của PR3 và giữ `total = subtotal + delivery_fee` khi test chỉ truyền một phần số tiền. */
export async function createOrderRow(store: Scope, overrides: Partial<typeof orders.$inferInsert> = {}) {
  const deliveryFeeVnd = overrides.deliveryFeeVnd ?? 0
  const subtotalVnd = overrides.subtotalVnd ?? (overrides.totalVnd !== undefined ? overrides.totalVnd - deliveryFeeVnd : 50_000)
  const totalVnd = overrides.totalVnd ?? subtotalVnd + deliveryFeeVnd
  return insertRawOrder(store, { ...overrides, subtotalVnd, deliveryFeeVnd, totalVnd })
}

let itemPosition = 0

/** Giữ `line_total = unit_price * qty` khi test chỉ truyền `qty` + `lineTotalVnd` hoặc `unitPriceVnd`. */
export async function createOrderItem(order: OrderScope, overrides: Partial<typeof orderItems.$inferInsert> = {}) {
  const qty = overrides.qty ?? 2
  const lineTotalVnd = overrides.lineTotalVnd ?? (overrides.unitPriceVnd ?? 25_000) * qty
  const unitPriceVnd = overrides.unitPriceVnd ?? lineTotalVnd / qty
  const [row] = await getDb().insert(orderItems).values({
    orgId: order.orgId,
    storeId: order.storeId,
    orderId: order.id,
    position: itemPosition++,
    nameSnapshot: 'Trà sữa trân châu',
    optionsSnapshotJson: [{ groupId: randomUUID(), groupName: 'Đường', valueId: randomUUID(), valueName: '50%', priceDeltaVnd: 0 }],
    ...overrides,
    qty,
    unitPriceVnd,
    lineTotalVnd,
  }).returning()
  return row!
}

export async function createPaymentRow(order: OrderScope, overrides: Partial<typeof orderPayments.$inferInsert> = {}) {
  const [row] = await getDb().insert(orderPayments).values({
    orgId: order.orgId,
    storeId: order.storeId,
    orderId: order.id,
    method: 'CASH',
    amountVnd: 50_000,
    ...overrides,
  }).returning()
  return row!
}

export async function createInvitationRow(
  store: Scope,
  opts: { email: string, createdBy: string, expiresAt?: Date, acceptedAt?: Date | null },
) {
  const token = generateToken()
  const [row] = await getDb().insert(storeInvitations).values({
    orgId: store.orgId,
    storeId: store.id,
    email: opts.email.toLowerCase(),
    role: 'STAFF',
    tokenHash: hashToken(token),
    expiresAt: opts.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    acceptedAt: opts.acceptedAt ?? null,
    createdBy: opts.createdBy,
  }).returning()
  return { token, row: row! }
}
```

- [ ] **Step 3: Viết integration test thất bại cho schema**

`tests/integration/owner-ops-schema.test.ts`:

```ts
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { getPgError } from '../../server/db/errors'
import { resetDb } from '../support/db'
import { createTenant } from '../support/fixtures'
import { createOrderRow, createPaymentRow } from '../support/order-fixtures'

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

async function failure(run: () => Promise<unknown>) {
  try {
    await run()
  }
  catch (err) {
    return getPgError(err)
  }
  return {}
}

describe('order_payments', () => {
  it('stores a cash payment for an order', async () => {
    const a = await createTenant('pay')
    const order = await createOrderRow(a.store)
    const payment = await createPaymentRow(order, { amountVnd: order.totalVnd, recordedBy: a.owner.userId, note: 'Khách trả tiền mặt' })
    expect(payment).toMatchObject({ method: 'CASH', amountVnd: 50_000, bankTransactionId: null })
    expect(payment.recordedAt).toBeInstanceOf(Date)
  })

  it('rejects a payment whose order belongs to another store (composite FK)', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const orderOfA = await createOrderRow(a.store)
    const pg = await failure(() => createPaymentRow({ id: orderOfA.id, orgId: b.org.id, storeId: b.store.id }))
    expect(pg).toMatchObject({ code: '23503', constraint: 'order_payments_order_fk' })
  })

  it('rejects a store_id that is not under the org (tenant FK)', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const orderOfA = await createOrderRow(a.store)
    const pg = await failure(() => createPaymentRow({ id: orderOfA.id, orgId: b.org.id, storeId: a.store.id }))
    expect(pg).toMatchObject({ code: '23503', constraint: 'order_payments_store_fk' })
  })

  it('allows only one payment per order', async () => {
    const a = await createTenant('uq')
    const order = await createOrderRow(a.store)
    await createPaymentRow(order)
    const pg = await failure(() => createPaymentRow(order))
    expect(pg).toMatchObject({ code: '23505', constraint: 'order_payments_order_uq' })
  })

  it('rejects a negative amount', async () => {
    const a = await createTenant('neg')
    const order = await createOrderRow(a.store)
    const pg = await failure(() => createPaymentRow(order, { amountVnd: -1 }))
    expect(pg).toMatchObject({ code: '23514', constraint: 'order_payments_amount_nonneg' })
  })

  it('cascades when the order is deleted', async () => {
    const a = await createTenant('del')
    const order = await createOrderRow(a.store)
    await createPaymentRow(order)
    await getDb().execute(sql`delete from orders where id = ${order.id}`)
    const { rows } = await getDb().execute<{ n: number }>(sql`select count(*)::int as n from order_payments`)
    expect(rows[0]!.n).toBe(0)
  })
})

describe('board index (from PR3)', () => {
  it('orders(store_id, status, created_at desc) exists for the board query', async () => {
    const { rows } = await getDb().execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where schemaname = 'public' and indexname = 'orders_board_idx'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.indexdef).toMatch(/\(store_id, status, created_at DESC\)/)
  })
})
```

- [ ] **Step 4: Chạy test, xác nhận FAIL**

Run: `npx vitest run --project integration tests/integration/owner-ops-schema.test.ts`
Expected: FAIL (`orderPayments` chưa export / bảng `order_payments` chưa tồn tại); riêng test "board index" đã xanh vì index do PR3 tạo.

- [ ] **Step 5: Implement schema + migration**

`server/db/schema/owner-ops.ts`:

```ts
import { sql } from 'drizzle-orm'
import { bigint, check, foreignKey, index, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { stores, userProfiles } from './identity'
import { orders } from './ordering'

export const orderPaymentMethod = pgEnum('order_payment_method', ['CASH', 'SEPAY', 'BANK_MANUAL'])

export const orderPayments = pgTable('order_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  storeId: uuid('store_id').notNull(),
  orderId: uuid('order_id').notNull(),
  // FK tới bank_transactions được thêm ở PR6 cùng unique(bank_transaction_id) where not null.
  bankTransactionId: uuid('bank_transaction_id'),
  method: orderPaymentMethod('method').notNull(),
  amountVnd: bigint('amount_vnd', { mode: 'number' }).notNull(),
  note: text('note'),
  recordedBy: text('recorded_by').references(() => userProfiles.userId),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  foreignKey({ name: 'order_payments_store_fk', columns: [t.orgId, t.storeId], foreignColumns: [stores.orgId, stores.id] }).onDelete('cascade'),
  foreignKey({ name: 'order_payments_order_fk', columns: [t.storeId, t.orderId], foreignColumns: [orders.storeId, orders.id] }).onDelete('cascade'),
  unique('order_payments_order_uq').on(t.orderId),
  check('order_payments_amount_nonneg', sql`${t.amountVnd} >= 0`),
  index('order_payments_store_recorded_idx').on(t.storeId, t.recordedAt),
])
```

`server/db/schema/index.ts`: thêm một dòng (giữ nguyên các dòng PR2/PR3 đã thêm):

```ts
export * from './owner-ops'
```

`server/db/schema/ordering.ts` **không** đổi (index board đã có từ PR3).

Sinh migration rồi kiểm tra:

```bash
npx drizzle-kit generate --name owner_ops
npm run db:check
grep -n "order_payments\|order_payment_method" drizzle/*owner_ops.sql
```
Expected: chỉ **một** file `drizzle/0003_owner_ops.sql` mới, chứa `CREATE TYPE "public"."order_payment_method"`, `CREATE TABLE "order_payments"`, hai FK, `UNIQUE`, `CHECK`, `CREATE INDEX "order_payments_store_recorded_idx"`, và **không** có `CREATE INDEX` nào trên `orders`. `db:check` không báo lỗi. Nếu Step 1 phát hiện `event_type` là enum, thêm `ALTER TYPE … ADD VALUE` cho ba giá trị mới vào file migration vừa sinh trước khi áp dụng.

- [ ] **Step 6: Chạy test, xác nhận PASS**

Run: `npm run test:integration -- tests/integration/owner-ops-schema.test.ts` (script tự `drizzle-kit migrate` lên branch `test` rồi chạy vitest)
Expected: PASS (7 test).

- [ ] **Step 7: Commit**

```bash
git add server/db/schema drizzle tests/support/order-fixtures.ts tests/integration/owner-ops-schema.test.ts
git commit -m "feat(owner): add order_payments table and order fixtures" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Luồng trạng thái dùng chung (`shared/order-flow.ts`) + test vét cạn khóa với PR3

**Files:**
- Create: `shared/order-flow.ts`, `shared/order-snapshot.ts`, `tests/unit/shared/order-flow.test.ts`, `tests/unit/shared/order-snapshot.test.ts`, `tests/unit/server/order-flow-contract.test.ts`

**Interfaces:**
- Consumes: kiểu `OrderStatus`, `PaymentStatus`, `FulfillmentType`, `PaymentMethod` và hằng `ORDER_STATUSES`, `PAYMENT_STATUSES`, `FULFILLMENT_TYPES` (`shared/enums.ts`, PR3); `nextStatuses`, `canCancel` (`server/services/ordering/transitions.ts`, PR3 — chỉ trong test hợp đồng).
- Produces (client + server dùng, toàn bộ thuần):
  - `BOARD_TABS: readonly ['new','doing','ready','other','awaiting_payment']`, `type BoardTab`
  - `TAB_STATUSES: Record<BoardTab, readonly OrderStatus[]>`, `TAB_LABELS`, `STATUS_LABELS`, `PAYMENT_STATUS_LABELS`, `FULFILLMENT_LABELS`
  - `tabForStatus(status: OrderStatus): BoardTab`
  - `type OrderEventType = 'STATUS_CHANGED' | 'CANCELLED' | 'PAYMENT_RECORDED'`
  - `interface FlowOrder { status: OrderStatus; fulfillmentType: FulfillmentType }`
  - `advanceTargets(order: FlowOrder): OrderStatus[]` (không bao giờ chứa `CANCELLED`, không chứa bước của hệ thống)
  - `transitionLabel(order: FlowOrder, to: OrderStatus): string`
  - `primaryAction(order: FlowOrder): { nextStatus: OrderStatus; label: string } | null`
  - `canCancelOrder(order: { status: OrderStatus; paymentStatus: PaymentStatus }, role: 'OWNER' | 'STAFF'): boolean`
  - `paymentStatusAfterCancel(current: PaymentStatus): PaymentStatus`
  - `canMarkCashPaid(order: { status: OrderStatus; paymentMethod: PaymentMethod; paymentStatus: PaymentStatus }): boolean`
  - `optionLabels(snapshot: unknown): string[]`

Quy tắc chốt (theo spec §5.3): `NEW → PREPARING | READY`; `PREPARING → READY`; `READY → COMPLETED` (DINE_IN, PICKUP) hoặc `READY → DELIVERING` (DELIVERY); `DELIVERING → COMPLETED` (PR3 trả `['COMPLETED']` cho mọi fulfillment; chỉ đơn DELIVERY mới tới được trạng thái này); `AWAITING_PAYMENT → NEW` là của hệ thống (không có trong `advanceTargets`); không chuyển lùi. Hủy: từ `AWAITING_PAYMENT | NEW | PREPARING`; staff chỉ khi `payment_status ∈ {UNPAID, PENDING}`, owner mọi trường hợp; đơn `PAID` bị hủy thì `payment_status = REFUND_DUE`.

- [ ] **Step 1: Viết unit test thất bại cho `order-flow`**

`tests/unit/shared/order-flow.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { FULFILLMENT_TYPES, ORDER_STATUSES, PAYMENT_STATUSES, type FulfillmentType, type OrderStatus } from '../../../shared/enums'
import {
  BOARD_TABS,
  TAB_STATUSES,
  advanceTargets,
  canCancelOrder,
  canMarkCashPaid,
  paymentStatusAfterCancel,
  primaryAction,
  tabForStatus,
  transitionLabel,
} from '../../../shared/order-flow'

const same = (targets: OrderStatus[]): Record<FulfillmentType, OrderStatus[]> => ({ DINE_IN: targets, PICKUP: targets, DELIVERY: targets })

// Bảng kỳ vọng viết tay theo spec §5.3: 7 trạng thái × 3 fulfillment = 21 ô.
const EXPECTED: Record<OrderStatus, Record<FulfillmentType, OrderStatus[]>> = {
  AWAITING_PAYMENT: same([]),
  NEW: same(['PREPARING', 'READY']),
  PREPARING: same(['READY']),
  READY: { DINE_IN: ['COMPLETED'], PICKUP: ['COMPLETED'], DELIVERY: ['DELIVERING'] },
  // Chỉ đơn DELIVERY tới được DELIVERING; ô DINE_IN/PICKUP không tới được nhưng khớp bảng PR3 (`DELIVERING → COMPLETED`).
  DELIVERING: same(['COMPLETED']),
  COMPLETED: same([]),
  CANCELLED: same([]),
}

describe('advanceTargets (exhaustive)', () => {
  it('covers every status', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...ORDER_STATUSES].sort())
  })

  it.each(ORDER_STATUSES.flatMap(status => FULFILLMENT_TYPES.map(fulfillmentType => [status, fulfillmentType] as const)))(
    '%s / %s',
    (status, fulfillmentType) => {
      expect(advanceTargets({ status, fulfillmentType })).toEqual(EXPECTED[status][fulfillmentType])
    },
  )

  it('never goes backwards, never cancels, never leaves a terminal state', () => {
    const rank: Record<OrderStatus, number> = {
      AWAITING_PAYMENT: 0, NEW: 1, PREPARING: 2, READY: 3, DELIVERING: 4, COMPLETED: 5, CANCELLED: 5,
    }
    for (const status of ORDER_STATUSES) {
      for (const fulfillmentType of FULFILLMENT_TYPES) {
        for (const target of advanceTargets({ status, fulfillmentType })) {
          expect(rank[target]).toBeGreaterThan(rank[status])
          expect(target).not.toBe('CANCELLED')
        }
      }
    }
  })
})

describe('primaryAction', () => {
  it.each([
    ['NEW', 'PICKUP', 'PREPARING', 'Bắt đầu làm'],
    ['PREPARING', 'DINE_IN', 'READY', 'Đã xong'],
    ['READY', 'DINE_IN', 'COMPLETED', 'Đã phục vụ'],
    ['READY', 'PICKUP', 'COMPLETED', 'Khách đã nhận'],
    ['READY', 'DELIVERY', 'DELIVERING', 'Đi giao'],
    ['DELIVERING', 'DELIVERY', 'COMPLETED', 'Đã giao xong'],
  ] as const)('%s / %s → %s "%s"', (status, fulfillmentType, nextStatus, label) => {
    expect(primaryAction({ status, fulfillmentType })).toEqual({ nextStatus, label })
  })

  it.each(['AWAITING_PAYMENT', 'COMPLETED', 'CANCELLED'] as const)('%s has no primary action', (status) => {
    for (const fulfillmentType of FULFILLMENT_TYPES) {
      expect(primaryAction({ status, fulfillmentType })).toBeNull()
    }
  })

  it('offers a skip-ahead label for NEW → READY', () => {
    expect(transitionLabel({ status: 'NEW', fulfillmentType: 'PICKUP' }, 'READY')).toBe('Xong luôn')
  })
})

describe('canCancelOrder (exhaustive)', () => {
  const CANCELLABLE = new Set<OrderStatus>(['AWAITING_PAYMENT', 'NEW', 'PREPARING'])
  const unpaid = new Set(['UNPAID', 'PENDING'])
  const cases = ORDER_STATUSES.flatMap(status =>
    PAYMENT_STATUSES.flatMap(paymentStatus => (['OWNER', 'STAFF'] as const).map(role => [status, paymentStatus, role] as const)),
  )

  it.each(cases)('%s / %s / %s', (status, paymentStatus, role) => {
    const expected = CANCELLABLE.has(status) && (role === 'OWNER' || unpaid.has(paymentStatus))
    expect(canCancelOrder({ status, paymentStatus }, role)).toBe(expected)
  })
})

describe('paymentStatusAfterCancel', () => {
  it.each(PAYMENT_STATUSES)('%s', (paymentStatus) => {
    expect(paymentStatusAfterCancel(paymentStatus)).toBe(paymentStatus === 'PAID' ? 'REFUND_DUE' : paymentStatus)
  })
})

describe('canMarkCashPaid', () => {
  it('only COD orders that are unpaid and not cancelled', () => {
    expect(canMarkCashPaid({ status: 'NEW', paymentMethod: 'PAY_ON_RECEIPT', paymentStatus: 'UNPAID' })).toBe(true)
    expect(canMarkCashPaid({ status: 'COMPLETED', paymentMethod: 'PAY_ON_RECEIPT', paymentStatus: 'UNPAID' })).toBe(true)
    expect(canMarkCashPaid({ status: 'CANCELLED', paymentMethod: 'PAY_ON_RECEIPT', paymentStatus: 'UNPAID' })).toBe(false)
    expect(canMarkCashPaid({ status: 'NEW', paymentMethod: 'PAY_ON_RECEIPT', paymentStatus: 'PAID' })).toBe(false)
    expect(canMarkCashPaid({ status: 'AWAITING_PAYMENT', paymentMethod: 'BANK_QR', paymentStatus: 'PENDING' })).toBe(false)
  })
})

describe('board tabs', () => {
  it('maps every status to exactly one tab', () => {
    for (const status of ORDER_STATUSES) {
      const owners = BOARD_TABS.filter(tab => TAB_STATUSES[tab].includes(status))
      expect(owners).toEqual([tabForStatus(status)])
    }
  })

  it('keeps AWAITING_PAYMENT out of the "new" queue', () => {
    expect(TAB_STATUSES.new).toEqual(['NEW'])
    expect(TAB_STATUSES.awaiting_payment).toEqual(['AWAITING_PAYMENT'])
    expect(tabForStatus('AWAITING_PAYMENT')).toBe('awaiting_payment')
  })
})
```

`tests/unit/shared/order-snapshot.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { optionLabels } from '../../../shared/order-snapshot'

describe('optionLabels', () => {
  it('reads valueName, name or label from objects', () => {
    expect(optionLabels([{ groupName: 'Đường', valueName: '50%' }, { name: 'Trân châu' }, { label: 'Đá riêng' }]))
      .toEqual(['50%', 'Trân châu', 'Đá riêng'])
  })

  it('accepts plain strings and nested value lists', () => {
    expect(optionLabels(['Ít đá', { groupName: 'Topping', values: [{ valueName: 'Pudding' }, { valueName: 'Thạch' }] }]))
      .toEqual(['Ít đá', 'Pudding', 'Thạch'])
  })

  it.each([null, undefined, 'x', 5, {}, [null, 1, {}, { valueName: '' }]])('ignores %j', (value) => {
    expect(optionLabels(value)).toEqual([])
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `npx vitest run --project unit tests/unit/shared/order-flow.test.ts tests/unit/shared/order-snapshot.test.ts`
Expected: FAIL (module `shared/order-flow` chưa tồn tại).

- [ ] **Step 3: Implement `shared/order-flow.ts` và `shared/order-snapshot.ts`**

`shared/order-flow.ts`:

```ts
import type { FulfillmentType, OrderStatus, PaymentMethod, PaymentStatus } from './enums'

export const BOARD_TABS = ['new', 'doing', 'ready', 'other', 'awaiting_payment'] as const
export type BoardTab = (typeof BOARD_TABS)[number]

export const TAB_STATUSES: Record<BoardTab, readonly OrderStatus[]> = {
  new: ['NEW'],
  doing: ['PREPARING'],
  ready: ['READY', 'DELIVERING'],
  other: ['COMPLETED', 'CANCELLED'],
  awaiting_payment: ['AWAITING_PAYMENT'],
}

export const TAB_LABELS: Record<BoardTab, string> = {
  new: 'Mới',
  doing: 'Đang làm',
  ready: 'Sẵn sàng',
  other: 'Khác',
  awaiting_payment: 'Chờ thanh toán',
}

export const STATUS_LABELS: Record<OrderStatus, string> = {
  AWAITING_PAYMENT: 'Chờ thanh toán',
  NEW: 'Mới',
  PREPARING: 'Đang làm',
  READY: 'Sẵn sàng',
  DELIVERING: 'Đang giao',
  COMPLETED: 'Hoàn tất',
  CANCELLED: 'Đã hủy',
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  UNPAID: 'Chưa thu',
  PENDING: 'Chờ chuyển khoản',
  PAID: 'Đã thu',
  REVIEW_REQUIRED: 'Cần kiểm tra',
  REFUND_DUE: 'Cần hoàn tiền',
  REFUNDED: 'Đã hoàn tiền',
}

export const FULFILLMENT_LABELS: Record<FulfillmentType, string> = {
  DINE_IN: 'Tại bàn',
  PICKUP: 'Mang đi',
  DELIVERY: 'Giao hàng',
}

export type OrderEventType = 'STATUS_CHANGED' | 'CANCELLED' | 'PAYMENT_RECORDED'

export function tabForStatus(status: OrderStatus): BoardTab {
  const tab = BOARD_TABS.find(candidate => TAB_STATUSES[candidate].includes(status))
  if (!tab) throw new Error(`No board tab for status ${status}`)
  return tab
}

export interface FlowOrder {
  status: OrderStatus
  fulfillmentType: FulfillmentType
}

/** Các bước tiến mà nhân viên được bấm. Không gồm hủy và bước hệ thống (AWAITING_PAYMENT → NEW). */
export function advanceTargets(order: FlowOrder): OrderStatus[] {
  switch (order.status) {
    case 'NEW':
      return ['PREPARING', 'READY']
    case 'PREPARING':
      return ['READY']
    case 'READY':
      return order.fulfillmentType === 'DELIVERY' ? ['DELIVERING'] : ['COMPLETED']
    case 'DELIVERING':
      return ['COMPLETED']
    default:
      return []
  }
}

export function transitionLabel(order: FlowOrder, to: OrderStatus): string {
  if (to === 'PREPARING') return 'Bắt đầu làm'
  if (to === 'READY') return order.status === 'NEW' ? 'Xong luôn' : 'Đã xong'
  if (to === 'DELIVERING') return 'Đi giao'
  if (to === 'COMPLETED') {
    if (order.fulfillmentType === 'DELIVERY') return 'Đã giao xong'
    return order.fulfillmentType === 'PICKUP' ? 'Khách đã nhận' : 'Đã phục vụ'
  }
  return STATUS_LABELS[to]
}

export function primaryAction(order: FlowOrder): { nextStatus: OrderStatus, label: string } | null {
  const [nextStatus] = advanceTargets(order)
  return nextStatus ? { nextStatus, label: transitionLabel(order, nextStatus) } : null
}

const CANCELLABLE: readonly OrderStatus[] = ['AWAITING_PAYMENT', 'NEW', 'PREPARING']

export function canCancelOrder(order: { status: OrderStatus, paymentStatus: PaymentStatus }, role: 'OWNER' | 'STAFF'): boolean {
  if (!CANCELLABLE.includes(order.status)) return false
  if (role === 'OWNER') return true
  return order.paymentStatus === 'UNPAID' || order.paymentStatus === 'PENDING'
}

export function paymentStatusAfterCancel(current: PaymentStatus): PaymentStatus {
  return current === 'PAID' ? 'REFUND_DUE' : current
}

export function canMarkCashPaid(order: { status: OrderStatus, paymentMethod: PaymentMethod, paymentStatus: PaymentStatus }): boolean {
  return order.paymentMethod === 'PAY_ON_RECEIPT' && order.paymentStatus === 'UNPAID' && order.status !== 'CANCELLED'
}
```

`shared/order-snapshot.ts`:

```ts
function collect(entry: unknown, out: string[]): void {
  if (typeof entry === 'string') {
    if (entry) out.push(entry)
    return
  }
  if (!entry || typeof entry !== 'object') return
  const record = entry as Record<string, unknown>
  if (Array.isArray(record.values)) {
    for (const inner of record.values) collect(inner, out)
    return
  }
  const label = record.valueName ?? record.name ?? record.label
  if (typeof label === 'string' && label) out.push(label)
}

/** Rút nhãn option từ `order_items.options_snapshot_json` mà không phụ thuộc cứng vào hình dạng JSON. */
export function optionLabels(snapshot: unknown): string[] {
  if (!Array.isArray(snapshot)) return []
  const out: string[] = []
  for (const entry of snapshot) collect(entry, out)
  return out
}
```

- [ ] **Step 4: Chạy lại, xác nhận PASS**

Run: `npx vitest run --project unit tests/unit/shared/order-flow.test.ts tests/unit/shared/order-snapshot.test.ts`
Expected: PASS.

- [ ] **Step 5: Viết test hợp đồng với `transitions.ts` của PR3**

`tests/unit/server/order-flow-contract.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { FULFILLMENT_TYPES, ORDER_STATUSES, PAYMENT_STATUSES } from '../../../shared/enums'
import { advanceTargets, canCancelOrder } from '../../../shared/order-flow'
import { canCancel, nextStatuses } from '../../../server/services/ordering/transitions'

// Khóa hai bản (server PR3 và shared PR4) không được lệch nhau.
describe('shared order-flow vs server transitions', () => {
  const roles = ['OWNER', 'STAFF'] as const

  it.each(ORDER_STATUSES.flatMap(status => FULFILLMENT_TYPES.flatMap(fulfillmentType => roles.map(role => [status, fulfillmentType, role] as const))))(
    'nextStatuses %s / %s / %s (không tính CANCELLED)',
    (status, fulfillmentType, role) => {
      const server = nextStatuses({ status, fulfillmentType }, role).filter(next => next !== 'CANCELLED').sort()
      expect(server).toEqual([...advanceTargets({ status, fulfillmentType })].sort())
    },
  )

  it.each(ORDER_STATUSES.flatMap(status => PAYMENT_STATUSES.flatMap(paymentStatus => roles.map(role => [status, paymentStatus, role] as const))))(
    'canCancel %s / %s / %s',
    (status, paymentStatus, role) => {
      expect(canCancel({ status, paymentStatus }, role)).toBe(canCancelOrder({ status, paymentStatus }, role))
    },
  )
})
```

Run: `npx vitest run --project unit tests/unit/server/order-flow-contract.test.ts`
Expected: PASS. Nếu FAIL ở ô nào, đó là chỗ PR3 và spec §5.3 lệch nhau: sửa `shared/order-flow.ts` về đúng spec (không nới test), và ghi chú cho tác giả PR3 nếu `transitions.ts` mới là bên sai.

- [ ] **Step 6: Commit**

```bash
git add shared/order-flow.ts shared/order-snapshot.ts tests/unit/shared/order-flow.test.ts tests/unit/shared/order-snapshot.test.ts tests/unit/server/order-flow-contract.test.ts
git commit -m "feat(owner): add shared order flow with exhaustive transition tests" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Board API — danh sách theo tab (cursor), chi tiết đơn + lịch sử

**Files:**
- Create: `shared/schemas/orders.ts`, `shared/types/orders.ts`, `server/utils/params.ts`, `server/repositories/orders.ts`, `server/services/ordering/board.ts`, `server/api/stores/[storeId]/orders/index.get.ts`, `server/api/stores/[storeId]/orders/[orderId]/index.get.ts`, `tests/integration/order-board.test.ts`
- Modify: `tests/api/tenant-isolation.test.ts` (thêm hàng ma trận)

**Interfaces:**
- Consumes: `orders`, `orderItems`, `orderEvents` (PR3); `orderPayments` (Task 1); `BoardTab`, `TAB_STATUSES`, `optionLabels` (Task 2); `requireStoreStaff`, `StoreContext`, `defineApiHandler`, `parseQuery`, `AppError`.
- Produces:
  - `boardQuerySchema` (`{ tab: BoardTab; cursor?: string; limit: number /* 1–100, mặc định 30 */ }`), `BOARD_PAGE_SIZE = 30`
  - Kiểu `BoardOrder`, `BoardOrderItem`, `BoardResponse`, `OrderEventView`, `OrderPaymentView`, `OrderDetailResponse`, `OrderActionResult` (`shared/types/orders.ts`)
  - `listBoard(db: DbOrTx, ctx: StoreContext, input: { tab: BoardTab; cursor?: string; limit?: number }): Promise<BoardResponse>`
  - `getOrderDetail(db: DbOrTx, ctx: StoreContext, orderId: string): Promise<OrderDetailResponse>` (không thấy ⇒ `AppError('NOT_FOUND')`)
  - `encodeCursor(cursor: OrderCursor): string`, `decodeCursor(raw: string): OrderCursor` (sai ⇒ 400 `VALIDATION_FAILED`)
  - Repository `server/repositories/orders.ts` (mọi hàm nhận `scope: { orgId; storeId }`): `listOrders`, `countByStatus`, `listStatusIds`, `listItems`, `findBoardRow`, `listEvents`, `findPayment`, `findOrderState`, `transitionOrder`, `markOrderPaid`, `insertOrderEvent`, `insertCashPayment` (ba hàm cuối dùng ở Task 4–5)
  - `requireUuidParam(event: H3Event, name: string): string` (không phải UUID ⇒ 404)
  - Routes: `GET /api/stores/:storeId/orders?tab=&cursor=&limit=` → `BoardResponse`; `GET /api/stores/:storeId/orders/:orderId` → `OrderDetailResponse`; cả hai `Cache-Control: no-store`.

Thiết kế chốt: tab `new` chỉ gồm `NEW` (không bao giờ có `AWAITING_PAYMENT`); `ready` gồm `READY` + `DELIVERING`; `other` sắp xếp mới → cũ, các tab còn lại cũ → mới (FIFO cho bếp). Cursor là keyset `(created_at, id)`, trong đó `created_at` được lấy dưới dạng **text của Postgres** (giữ micro giây) để trang sau không lặp lại dòng cuối của trang trước. Response có `counts` (badge), `newOrderIds` (tối đa 100 id đơn `NEW`, để client phát hiện đơn mới kể cả khi đang ở tab khác hoặc khi PR6 chuyển `AWAITING_PAYMENT → NEW`) và `serverTime`. Không có delta-poll: một phản hồi delta không biểu diễn được đơn **rời** tab (đổi trạng thái) nên client poll lại trang đầu (limit = số đơn đang hiển thị, tối đa 100); `serverTime` vẫn trả để hiển thị "cập nhật lúc".

- [ ] **Step 1: Viết integration test thất bại cho board service**

`tests/integration/order-board.test.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { OrderStatus } from '../../shared/enums'
import type { BoardTab } from '../../shared/order-flow'
import type { StoreContext } from '../../server/auth/guards'
import { closeDb, getDb } from '../../server/db/client'
import { insertOrderEvent } from '../../server/repositories/orders'
import { decodeCursor, encodeCursor, getOrderDetail, listBoard } from '../../server/services/ordering/board'
import { resetDb } from '../support/db'
import { addStaff, createTenant } from '../support/fixtures'
import { createOrderItem, createOrderRow, createPaymentRow } from '../support/order-fixtures'

type Tenant = Awaited<ReturnType<typeof createTenant>>
const ctxOf = (tenant: Tenant, role: 'OWNER' | 'STAFF' = 'OWNER', userId = tenant.owner.userId): StoreContext => ({
  orgId: tenant.org.id, storeId: tenant.store.id, role, userId,
})

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('listBoard tabs', () => {
  it('puts each status in exactly one tab and keeps AWAITING_PAYMENT out of "new"', async () => {
    const a = await createTenant('tabs')
    const mk = (status: OrderStatus, extra: Partial<Parameters<typeof createOrderRow>[1]> = {}) =>
      createOrderRow(a.store, { status, ...extra })
    const awaiting = await mk('AWAITING_PAYMENT', { paymentMethod: 'BANK_QR', paymentStatus: 'PENDING' })
    const fresh = await mk('NEW')
    const preparing = await mk('PREPARING')
    const ready = await mk('READY')
    const delivering = await mk('DELIVERING', { fulfillmentType: 'DELIVERY' })
    const done = await mk('COMPLETED', { paymentStatus: 'PAID' })
    const cancelled = await mk('CANCELLED')
    const ctx = ctxOf(a)

    const ids = async (tab: BoardTab) => (await listBoard(getDb(), ctx, { tab })).orders.map(o => o.id).sort()
    expect(await ids('new')).toEqual([fresh.id])
    expect(await ids('doing')).toEqual([preparing.id])
    expect(await ids('ready')).toEqual([ready.id, delivering.id].sort())
    expect(await ids('other')).toEqual([done.id, cancelled.id].sort())
    expect(await ids('awaiting_payment')).toEqual([awaiting.id])
  })

  it('returns counts and newOrderIds without AWAITING_PAYMENT', async () => {
    const a = await createTenant('counts')
    await createOrderRow(a.store, { status: 'AWAITING_PAYMENT', paymentMethod: 'BANK_QR', paymentStatus: 'PENDING' })
    const n1 = await createOrderRow(a.store, { status: 'NEW' })
    const n2 = await createOrderRow(a.store, { status: 'NEW' })
    await createOrderRow(a.store, { status: 'PREPARING' })
    await createOrderRow(a.store, { status: 'READY' })
    await createOrderRow(a.store, { status: 'DELIVERING', fulfillmentType: 'DELIVERY' })
    await createOrderRow(a.store, { status: 'COMPLETED' })

    const board = await listBoard(getDb(), ctxOf(a), { tab: 'doing' })
    expect(board.counts).toEqual({ new: 2, doing: 1, ready: 2, awaiting_payment: 1, other: 0 })
    expect(board.newOrderIds.sort()).toEqual([n1.id, n2.id].sort())
    expect(Date.parse(board.serverTime)).not.toBeNaN()
  })

  it('orders active tabs oldest-first and "other" newest-first', async () => {
    const a = await createTenant('order')
    const old = await createOrderRow(a.store, { status: 'NEW', createdAt: new Date('2026-11-01T01:00:00Z') })
    const mid = await createOrderRow(a.store, { status: 'NEW', createdAt: new Date('2026-11-01T02:00:00Z') })
    const doneOld = await createOrderRow(a.store, { status: 'COMPLETED', createdAt: new Date('2026-11-01T01:00:00Z') })
    const doneNew = await createOrderRow(a.store, { status: 'COMPLETED', createdAt: new Date('2026-11-01T02:00:00Z') })
    expect((await listBoard(getDb(), ctxOf(a), { tab: 'new' })).orders.map(o => o.id)).toEqual([old.id, mid.id])
    expect((await listBoard(getDb(), ctxOf(a), { tab: 'other' })).orders.map(o => o.id)).toEqual([doneNew.id, doneOld.id])
  })

  it('never returns another store\'s orders', async () => {
    const a = await createTenant('iso-a')
    const b = await createTenant('iso-b')
    await createOrderRow(b.store, { status: 'NEW' })
    const board = await listBoard(getDb(), ctxOf(a), { tab: 'new' })
    expect(board.orders).toEqual([])
    expect(board.counts.new).toBe(0)
    expect(board.newOrderIds).toEqual([])
  })
})

describe('listBoard card data', () => {
  it('includes items with option labels, table name and customer contact', async () => {
    const a = await createTenant('card')
    const order = await createOrderRow(a.store, { fulfillmentType: 'DINE_IN', tableLabel: 'Bàn 05', notes: 'Ít ngọt' })
    await createOrderItem(order, { nameSnapshot: 'Trà đào', optionsSnapshotJson: [{ groupId: randomUUID(), groupName: 'Đường', valueId: randomUUID(), valueName: '30%', priceDeltaVnd: 0 }], qty: 1, unitPriceVnd: 45_000, lineTotalVnd: 45_000 })
    await createOrderItem(order, { nameSnapshot: 'Cà phê sữa', optionsSnapshotJson: [], qty: 2, unitPriceVnd: 20_000, lineTotalVnd: 40_000 })

    const [card] = (await listBoard(getDb(), ctxOf(a), { tab: 'new' })).orders
    expect(card).toMatchObject({
      id: order.id,
      publicCode: order.publicCode,
      status: 'NEW',
      fulfillmentType: 'DINE_IN',
      tableName: 'Bàn 05',
      customerName: 'Khách Test',
      customerPhone: '0901234567',
      notes: 'Ít ngọt',
      totalVnd: 50_000,
      paymentStatus: 'UNPAID',
    })
    expect(card!.items.map(i => ({ name: i.name, qty: i.qty, options: i.options }))).toEqual(
      expect.arrayContaining([
        { name: 'Trà đào', qty: 1, options: ['30%'] },
        { name: 'Cà phê sữa', qty: 2, options: [] },
      ]),
    )
    expect(card!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(JSON.stringify(card)).not.toMatch(/guestToken|idempotencyKey/i)
  })
})

describe('listBoard pagination', () => {
  it('pages through 35 orders sharing one created_at without duplicates or gaps', async () => {
    const a = await createTenant('page')
    const sameInstant = new Date('2026-11-01T03:00:00.000Z')
    for (let i = 0; i < 35; i++) await createOrderRow(a.store, { status: 'NEW', createdAt: sameInstant })

    const seen: string[] = []
    let cursor: string | undefined
    for (let i = 0; i < 5; i++) {
      const page = await listBoard(getDb(), ctxOf(a), { tab: 'new', cursor })
      expect(page.orders.length).toBeLessThanOrEqual(30)
      seen.push(...page.orders.map(o => o.id))
      if (!page.nextCursor) break
      cursor = page.nextCursor
    }
    expect(seen).toHaveLength(35)
    expect(new Set(seen).size).toBe(35)
    expect(seen).toEqual([...seen].sort())
  })

  it('keeps microsecond precision in the cursor (no repeated row between pages)', async () => {
    const a = await createTenant('micro')
    const rows = [await createOrderRow(a.store), await createOrderRow(a.store), await createOrderRow(a.store)]
    const stamps = ['2026-11-01 10:00:00.123456+00', '2026-11-01 10:00:00.123457+00', '2026-11-01 10:00:00.123458+00']
    for (const [i, row] of rows.entries()) {
      await getDb().execute(sql`update orders set created_at = ${stamps[i]!}::timestamptz where id = ${row.id}`)
    }
    const seen: string[] = []
    let cursor: string | undefined
    for (let i = 0; i < 4; i++) {
      const page = await listBoard(getDb(), ctxOf(a), { tab: 'new', cursor, limit: 1 })
      seen.push(...page.orders.map(o => o.id))
      if (!page.nextCursor) break
      cursor = page.nextCursor
    }
    expect(seen).toEqual(rows.map(r => r.id))
  })

  it('rejects a malformed cursor with VALIDATION_FAILED', async () => {
    const a = await createTenant('badcursor')
    for (const cursor of ['not-base64-json', encodeCursor({ createdAt: 'yesterday', id: randomUUID() }), Buffer.from('{"t":1}').toString('base64url')]) {
      await expect(listBoard(getDb(), ctxOf(a), { tab: 'new', cursor })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    }
  })

  it('round-trips a cursor', () => {
    const cursor = { createdAt: '2026-11-01 10:00:00.123456+00', id: randomUUID() }
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
  })
})

describe('getOrderDetail', () => {
  it('returns the order, events in chronological order with actor names, and the payment', async () => {
    const a = await createTenant('detail')
    const staff = await addStaff(a.store)
    const order = await createOrderRow(a.store, { status: 'PREPARING', paymentStatus: 'PAID' })
    await createOrderItem(order)
    await createPaymentRow(order, { amountVnd: order.totalVnd, recordedBy: staff.userId, note: 'Tiền mặt' })
    const scope = { orgId: a.org.id, storeId: a.store.id }
    await insertOrderEvent(getDb(), scope, { orderId: order.id, actorUserId: a.owner.userId, eventType: 'STATUS_CHANGED', fromState: 'NEW', toState: 'PREPARING' })
    await insertOrderEvent(getDb(), scope, { orderId: order.id, actorUserId: staff.userId, eventType: 'PAYMENT_RECORDED', metadata: { method: 'CASH' } })

    const detail = await getOrderDetail(getDb(), ctxOf(a), order.id)
    expect(detail.order).toMatchObject({ id: order.id, status: 'PREPARING', items: [expect.objectContaining({ name: 'Trà sữa trân châu', options: ['50%'] })] })
    expect(detail.events.map(e => e.eventType)).toEqual(['STATUS_CHANGED', 'PAYMENT_RECORDED'])
    expect(detail.events[0]).toMatchObject({ fromState: 'NEW', toState: 'PREPARING' })
    expect(detail.events[1]!.actorName).toBeTruthy()
    expect(detail.payment).toMatchObject({ method: 'CASH', amountVnd: 50_000, note: 'Tiền mặt' })
  })

  it('returns payment null for an unpaid order', async () => {
    const a = await createTenant('nopay')
    const order = await createOrderRow(a.store)
    expect((await getOrderDetail(getDb(), ctxOf(a), order.id)).payment).toBeNull()
  })

  it('treats another store\'s order and a random id the same (NOT_FOUND)', async () => {
    const a = await createTenant('d-a')
    const b = await createTenant('d-b')
    const orderOfB = await createOrderRow(b.store)
    await expect(getOrderDetail(getDb(), ctxOf(a), orderOfB.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(getOrderDetail(getDb(), ctxOf(a), randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `npx vitest run --project integration tests/integration/order-board.test.ts`
Expected: FAIL (`server/services/ordering/board` chưa tồn tại).

- [ ] **Step 3: Implement schema zod, kiểu response, helper param**

`shared/schemas/orders.ts`:

```ts
import { z } from 'zod'
import { BOARD_TABS } from '../order-flow'

export const BOARD_PAGE_SIZE = 30

export const boardQuerySchema = z.object({
  tab: z.enum(BOARD_TABS),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(BOARD_PAGE_SIZE),
})
export type BoardQuery = z.output<typeof boardQuerySchema>
```

`shared/types/orders.ts`:

```ts
import type { FulfillmentType, OrderStatus, PaymentMethod, PaymentStatus } from '../enums'
import type { BoardTab } from '../order-flow'

export interface BoardOrderItem {
  id: string
  name: string
  qty: number
  options: string[]
  unitPriceVnd: number
  lineTotalVnd: number
}

export interface BoardOrder {
  id: string
  publicCode: string
  status: OrderStatus
  fulfillmentType: FulfillmentType
  paymentMethod: PaymentMethod
  paymentStatus: PaymentStatus
  latePayment: boolean
  tableName: string | null
  customerName: string | null
  customerPhone: string | null
  address: string | null
  notes: string | null
  totalVnd: number
  createdAt: string
  items: BoardOrderItem[]
}

export interface BoardResponse {
  orders: BoardOrder[]
  nextCursor: string | null
  counts: Record<BoardTab, number>
  newOrderIds: string[]
  serverTime: string
}

export interface OrderEventView {
  id: string
  eventType: string
  fromState: OrderStatus | null
  toState: OrderStatus | null
  actorName: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}

export interface OrderPaymentView {
  method: 'CASH' | 'SEPAY' | 'BANK_MANUAL'
  amountVnd: number
  note: string | null
  recordedAt: string
}

export interface OrderDetailResponse {
  order: BoardOrder
  events: OrderEventView[]
  payment: OrderPaymentView | null
}

export interface OrderActionResult {
  id: string
  status: OrderStatus
  paymentStatus: PaymentStatus
}
```

`server/utils/params.ts`:

```ts
import { getRouterParam, type H3Event } from 'h3'
import { z } from 'zod'
import { AppError } from './errors'

const uuid = z.uuid()

/** Param không phải UUID được coi như không tồn tại (404), giống UUID lạ. */
export function requireUuidParam(event: H3Event, name: string): string {
  const value = getRouterParam(event, name)
  if (!value || !uuid.safeParse(value).success) throw new AppError('NOT_FOUND', 'Không tìm thấy')
  return value
}
```

- [ ] **Step 4: Implement repository `server/repositories/orders.ts`**

```ts
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import type { OrderStatus, PaymentStatus } from '#shared/enums'
import type { OrderEventType } from '#shared/order-flow'
import type { DbOrTx } from '../db/client'
import { orderEvents, orderItems, orderPayments, orders, userProfiles } from '../db/schema'

export interface OrderScope {
  orgId: string
  storeId: string
}

export interface OrderCursor {
  createdAt: string
  id: string
}

export type OrderRow = typeof orders.$inferSelect

const inScope = (scope: OrderScope) => and(eq(orders.orgId, scope.orgId), eq(orders.storeId, scope.storeId))
const ACTIVE_STATUSES: OrderStatus[] = ['AWAITING_PAYMENT', 'NEW', 'PREPARING', 'READY', 'DELIVERING']

export async function listOrders(
  db: DbOrTx,
  scope: OrderScope,
  opts: { statuses: readonly OrderStatus[], direction: 'asc' | 'desc', limit: number, cursor?: OrderCursor },
) {
  const { cursor, direction } = opts
  // Row-value so sánh khớp đúng thứ tự (created_at, id), không bỏ sót đơn cùng created_at.
  const keyset = cursor
    ? direction === 'asc'
      ? sql`(${orders.createdAt}, ${orders.id}) > (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
      : sql`(${orders.createdAt}, ${orders.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
    : undefined
  const ordering = direction === 'asc' ? [asc(orders.createdAt), asc(orders.id)] : [desc(orders.createdAt), desc(orders.id)]
  return db
    .select({
      order: orders,
      // ::text giữ đủ micro giây; Date của JS chỉ có mili giây nên không dùng làm cursor.
      createdAtCursor: sql<string>`${orders.createdAt}::text`,
    })
    .from(orders)
    .where(and(inScope(scope), inArray(orders.status, [...opts.statuses]), keyset))
    .orderBy(...ordering)
    .limit(opts.limit + 1)
}

export async function countByStatus(db: DbOrTx, scope: OrderScope): Promise<Partial<Record<OrderStatus, number>>> {
  const rows = await db
    .select({ status: orders.status, count: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(inScope(scope), inArray(orders.status, ACTIVE_STATUSES)))
    .groupBy(orders.status)
  return Object.fromEntries(rows.map(row => [row.status, row.count]))
}

export async function listStatusIds(db: DbOrTx, scope: OrderScope, status: OrderStatus, limit: number): Promise<string[]> {
  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(inScope(scope), eq(orders.status, status)))
    .orderBy(asc(orders.createdAt), asc(orders.id))
    .limit(limit)
  return rows.map(row => row.id)
}

export async function listItems(db: DbOrTx, scope: OrderScope, orderIds: string[]) {
  if (orderIds.length === 0) return []
  return db
    .select()
    .from(orderItems)
    .where(and(eq(orderItems.orgId, scope.orgId), eq(orderItems.storeId, scope.storeId), inArray(orderItems.orderId, orderIds)))
    .orderBy(asc(orderItems.id))
}

export async function findBoardRow(db: DbOrTx, scope: OrderScope, orderId: string) {
  const [row] = await db
    .select()
    .from(orders)
    .where(and(inScope(scope), eq(orders.id, orderId)))
    .limit(1)
  return row ?? null
}

export async function listEvents(db: DbOrTx, scope: OrderScope, orderId: string) {
  return db
    .select({
      id: orderEvents.id,
      eventType: orderEvents.eventType,
      fromState: orderEvents.fromState,
      toState: orderEvents.toState,
      metadata: orderEvents.metadata,
      createdAt: orderEvents.createdAt,
      actorName: userProfiles.displayName,
      actorEmail: userProfiles.email,
    })
    .from(orderEvents)
    .leftJoin(userProfiles, eq(userProfiles.userId, orderEvents.actorUserId))
    .where(and(eq(orderEvents.orgId, scope.orgId), eq(orderEvents.storeId, scope.storeId), eq(orderEvents.orderId, orderId)))
    .orderBy(asc(orderEvents.createdAt), asc(orderEvents.id))
}

export async function findPayment(db: DbOrTx, scope: OrderScope, orderId: string) {
  const [row] = await db
    .select()
    .from(orderPayments)
    .where(and(eq(orderPayments.orgId, scope.orgId), eq(orderPayments.storeId, scope.storeId), eq(orderPayments.orderId, orderId)))
    .limit(1)
  return row ?? null
}

export async function findOrderState(db: DbOrTx, scope: OrderScope, orderId: string) {
  const [row] = await db
    .select({
      id: orders.id,
      status: orders.status,
      fulfillmentType: orders.fulfillmentType,
      paymentMethod: orders.paymentMethod,
      paymentStatus: orders.paymentStatus,
      totalVnd: orders.totalVnd,
    })
    .from(orders)
    .where(and(inScope(scope), eq(orders.id, orderId)))
    .limit(1)
  return row ?? null
}

/**
 * Chuyển trạng thái có điều kiện: chỉ cập nhật nếu đơn vẫn ở `from` (và, nếu có, vẫn ở `onlyIfPaymentStatus`).
 * Trả null khi 0 dòng khớp, tức là người khác đã đổi đơn trước.
 */
export async function transitionOrder(
  db: DbOrTx,
  scope: OrderScope,
  orderId: string,
  change: { from: OrderStatus, to: OrderStatus, onlyIfPaymentStatus?: PaymentStatus, setPaymentStatus?: PaymentStatus },
) {
  const [row] = await db
    .update(orders)
    .set({ status: change.to, ...(change.setPaymentStatus ? { paymentStatus: change.setPaymentStatus } : {}) })
    .where(and(
      inScope(scope),
      eq(orders.id, orderId),
      eq(orders.status, change.from),
      change.onlyIfPaymentStatus ? eq(orders.paymentStatus, change.onlyIfPaymentStatus) : undefined,
    ))
    .returning({ id: orders.id, status: orders.status, paymentStatus: orders.paymentStatus })
  return row ?? null
}

/** Đặt `PAID` chỉ khi payment_status còn đúng giá trị mong đợi và đơn chưa bị hủy. */
export async function markOrderPaid(db: DbOrTx, scope: OrderScope, orderId: string, expected: PaymentStatus) {
  const [row] = await db
    .update(orders)
    .set({ paymentStatus: 'PAID' })
    .where(and(inScope(scope), eq(orders.id, orderId), eq(orders.paymentStatus, expected), ne(orders.status, 'CANCELLED')))
    .returning({ id: orders.id, status: orders.status, paymentStatus: orders.paymentStatus })
  return row ?? null
}

export async function insertOrderEvent(
  db: DbOrTx,
  scope: OrderScope,
  event: {
    orderId: string
    actorUserId: string
    eventType: OrderEventType
    fromState?: OrderStatus | null
    toState?: OrderStatus | null
    metadata?: Record<string, unknown>
  },
) {
  await db.insert(orderEvents).values({
    orgId: scope.orgId,
    storeId: scope.storeId,
    orderId: event.orderId,
    actorUserId: event.actorUserId,
    eventType: event.eventType,
    fromState: event.fromState ?? null,
    toState: event.toState ?? null,
    ...(event.metadata ? { metadata: event.metadata } : {}),
  })
}

export async function insertCashPayment(
  db: DbOrTx,
  scope: OrderScope,
  payment: { orderId: string, amountVnd: number, recordedBy: string, note: string | null },
) {
  await db.insert(orderPayments).values({
    orgId: scope.orgId,
    storeId: scope.storeId,
    orderId: payment.orderId,
    method: 'CASH',
    amountVnd: payment.amountVnd,
    recordedBy: payment.recordedBy,
    note: payment.note,
  })
}
```

- [ ] **Step 5: Implement `server/services/ordering/board.ts`**

```ts
import { z } from 'zod'
import { TAB_STATUSES, type BoardTab } from '#shared/order-flow'
import { optionLabels } from '#shared/order-snapshot'
import type { BoardOrder, BoardOrderItem, BoardResponse, OrderDetailResponse } from '#shared/types/orders'
import type { StoreContext } from '../../auth/guards'
import type { DbOrTx } from '../../db/client'
import {
  countByStatus,
  findBoardRow,
  findPayment,
  listEvents,
  listItems,
  listOrders,
  listStatusIds,
  type OrderCursor,
  type OrderRow,
} from '../../repositories/orders'
import { AppError } from '../../utils/errors'

const PAGE_SIZE = 30
const NEW_IDS_LIMIT = 100
const PG_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:?\d{2})?$/
const cursorSchema = z.object({ t: z.string().regex(PG_TIMESTAMP), id: z.uuid() })

export function encodeCursor(cursor: OrderCursor): string {
  return Buffer.from(JSON.stringify({ t: cursor.createdAt, id: cursor.id })).toString('base64url')
}

export function decodeCursor(raw: string): OrderCursor {
  try {
    const parsed = cursorSchema.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')))
    return { createdAt: parsed.t, id: parsed.id }
  }
  catch {
    throw new AppError('VALIDATION_FAILED', 'Cursor không hợp lệ', { field: 'cursor' })
  }
}

type ItemRow = Awaited<ReturnType<typeof listItems>>[number]

function toItem(row: ItemRow): BoardOrderItem {
  return {
    id: row.id,
    name: row.nameSnapshot,
    qty: row.qty,
    options: optionLabels(row.optionsSnapshotJson),
    unitPriceVnd: row.unitPriceVnd,
    lineTotalVnd: row.lineTotalVnd,
  }
}

function toBoardOrder(row: OrderRow, items: BoardOrderItem[]): BoardOrder {
  return {
    id: row.id,
    publicCode: row.publicCode,
    status: row.status,
    fulfillmentType: row.fulfillmentType,
    paymentMethod: row.paymentMethod,
    paymentStatus: row.paymentStatus,
    latePayment: row.latePayment,
    tableName: row.tableLabel,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    address: typeof row.addressSnapshot === 'string' ? row.addressSnapshot : null,
    notes: row.notes,
    totalVnd: row.totalVnd,
    createdAt: row.createdAt.toISOString(),
    items,
  }
}

function groupItems(rows: ItemRow[]): Map<string, BoardOrderItem[]> {
  const grouped = new Map<string, BoardOrderItem[]>()
  for (const row of rows) {
    const list = grouped.get(row.orderId) ?? []
    list.push(toItem(row))
    grouped.set(row.orderId, list)
  }
  return grouped
}

export async function listBoard(
  db: DbOrTx,
  ctx: StoreContext,
  input: { tab: BoardTab, cursor?: string, limit?: number },
): Promise<BoardResponse> {
  const scope = { orgId: ctx.orgId, storeId: ctx.storeId }
  const limit = input.limit ?? PAGE_SIZE
  const cursor = input.cursor ? decodeCursor(input.cursor) : undefined

  const [rows, counts, newOrderIds] = await Promise.all([
    listOrders(db, scope, {
      statuses: TAB_STATUSES[input.tab],
      direction: input.tab === 'other' ? 'desc' : 'asc',
      limit,
      cursor,
    }),
    countByStatus(db, scope),
    listStatusIds(db, scope, 'NEW', NEW_IDS_LIMIT),
  ])

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const items = groupItems(await listItems(db, scope, page.map(row => row.order.id)))
  const last = page.at(-1)

  return {
    orders: page.map(row => toBoardOrder(row.order, items.get(row.order.id) ?? [])),
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAtCursor, id: last.order.id }) : null,
    counts: {
      new: counts.NEW ?? 0,
      doing: counts.PREPARING ?? 0,
      ready: (counts.READY ?? 0) + (counts.DELIVERING ?? 0),
      awaiting_payment: counts.AWAITING_PAYMENT ?? 0,
      other: 0,
    },
    newOrderIds,
    serverTime: new Date().toISOString(),
  }
}

export async function getOrderDetail(db: DbOrTx, ctx: StoreContext, orderId: string): Promise<OrderDetailResponse> {
  const scope = { orgId: ctx.orgId, storeId: ctx.storeId }
  const found = await findBoardRow(db, scope, orderId)
  if (!found) throw new AppError('NOT_FOUND', 'Không tìm thấy')
  const [itemRows, eventRows, payment] = await Promise.all([
    listItems(db, scope, [orderId]),
    listEvents(db, scope, orderId),
    findPayment(db, scope, orderId),
  ])
  return {
    order: toBoardOrder(found, itemRows.map(toItem)),
    events: eventRows.map(event => ({
      id: event.id,
      eventType: event.eventType,
      fromState: event.fromState as OrderStatus | null,
      toState: event.toState as OrderStatus | null,
      actorName: event.actorName ?? event.actorEmail ?? null,
      metadata: (event.metadata as Record<string, unknown> | null) ?? null,
      createdAt: event.createdAt.toISOString(),
    })),
    payment: payment
      ? { method: payment.method, amountVnd: payment.amountVnd, note: payment.note, recordedAt: payment.recordedAt.toISOString() }
      : null,
  }
}
```

- [ ] **Step 6: Implement route handlers**

`server/api/stores/[storeId]/orders/index.get.ts`:

```ts
import { getRouterParam, setHeader } from 'h3'
import { boardQuerySchema } from '#shared/schemas/orders'
import { requireStoreStaff } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { listBoard } from '../../../../services/ordering/board'
import { defineApiHandler } from '../../../../utils/api-handler'
import { parseQuery } from '../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreStaff(event, getRouterParam(event, 'storeId'))
  const query = parseQuery(event, boardQuerySchema)
  setHeader(event, 'Cache-Control', 'no-store')
  return listBoard(getDb(), ctx, query)
})
```

`server/api/stores/[storeId]/orders/[orderId]/index.get.ts`:

```ts
import { getRouterParam, setHeader } from 'h3'
import { requireStoreStaff } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { getOrderDetail } from '../../../../../services/ordering/board'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { requireUuidParam } from '../../../../../utils/params'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreStaff(event, getRouterParam(event, 'storeId'))
  const orderId = requireUuidParam(event, 'orderId')
  setHeader(event, 'Cache-Control', 'no-store')
  return getOrderDetail(getDb(), ctx, orderId)
})
```

- [ ] **Step 7: Chạy integration test, xác nhận PASS**

Run: `npx vitest run --project integration tests/integration/order-board.test.ts`
Expected: PASS (12 test).

- [ ] **Step 8: Thêm hàng ma trận tenant**

Trong `tests/api/tenant-isolation.test.ts`, thêm các import (cạnh import hiện có) và **cuối file** thêm khối sau. `beforeAll` cấp cao nhất đăng ký sau cái ban đầu nên chạy sau khi `ids`/`tokens` đã có.

```ts
import { createOrderRow } from '../support/order-fixtures'
```

```ts
// ───────────────────────── PR4: owner ops ─────────────────────────
const ops = {} as { orderA1: string, orderB: string, orgB: string }

beforeAll(async () => {
  const [storeB] = await getDb().select({ orgId: stores.orgId }).from(stores).where(eq(stores.id, ids.storeB))
  ops.orgB = storeB!.orgId
  ops.orderA1 = (await createOrderRow({ id: ids.storeA1, orgId: ids.orgA }, { status: 'NEW' })).id
  ops.orderB = (await createOrderRow({ id: ids.storeB, orgId: ops.orgB }, { status: 'NEW' })).id
})

const freshOrder = (overrides: Parameters<typeof createOrderRow>[1] = {}) =>
  createOrderRow({ id: ids.storeA1, orgId: ids.orgA }, overrides)
const orderStatusOf = async (orderId: string) =>
  (await call('GET', `/api/stores/${ids.storeA1}/orders/${orderId}`, tokens.ownerA)).body.order as { status: string, paymentStatus: string }

const staffSees: [Actor, number][] = [['ownerA', 200], ['staffA1', 200], ['staffA2', 404], ['disabledA1', 404], ['ownerB', 404]]

describe('GET /api/stores/:storeId/orders', () => {
  it('without token → 401', async () => {
    expect(await call('GET', `/api/stores/${ids.storeA1}/orders?tab=new`, null)).toMatchObject({ status: 401, body: { code: 'UNAUTHENTICATED' } })
  })

  it.each(staffSees)('%s → %i', async (actor, status) => {
    const res = await call('GET', `/api/stores/${ids.storeA1}/orders?tab=new`, tokens[actor])
    expect(res.status).toBe(status)
    if (status === 200) {
      const listed = (res.body.orders as { id: string }[]).map(o => o.id)
      expect(listed).toContain(ops.orderA1)
      expect(listed).not.toContain(ops.orderB)
      expect(JSON.stringify(res.body)).not.toMatch(/guestToken|idempotencyKey/i)
    }
    else {
      expect(res.body).toMatchObject({ code: errorCodes[status] })
    }
  })

  it('treats another tenant\'s real store exactly like a random id', async () => {
    const real = await call('GET', `/api/stores/${ids.storeA1}/orders?tab=new`, tokens.ownerB)
    const random = await call('GET', `/api/stores/${randomUUID()}/orders?tab=new`, tokens.ownerB)
    expect(real).toEqual(random)
  })

  it.each(['/orders', '/orders?tab=zzz', '/orders?tab=new&cursor=@@@', '/orders?tab=new&limit=0'])('%s → 400', async (suffix) => {
    const res = await call('GET', `/api/stores/${ids.storeA1}${suffix}`, tokens.ownerA)
    expect(res).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
  })
})

describe('GET /api/stores/:storeId/orders/:orderId', () => {
  it.each(staffSees)('%s → %i', async (actor, status) => {
    const res = await call('GET', `/api/stores/${ids.storeA1}/orders/${ops.orderA1}`, tokens[actor])
    expect(res.status).toBe(status)
    if (status === 200) expect(res.body).toMatchObject({ order: { id: ops.orderA1 }, events: [], payment: null })
    else expect(res.body).toMatchObject({ code: errorCodes[status] })
  })

  it('another store\'s order via my store path is 404, identical to a random id', async () => {
    const foreign = await call('GET', `/api/stores/${ids.storeA1}/orders/${ops.orderB}`, tokens.ownerA)
    const random = await call('GET', `/api/stores/${ids.storeA1}/orders/${randomUUID()}`, tokens.ownerA)
    expect(foreign).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
    expect(foreign).toEqual(random)
  })

  it('a non-uuid order id is 404, not 400/500', async () => {
    expect(await call('GET', `/api/stores/${ids.storeA1}/orders/not-a-uuid`, tokens.ownerA)).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
  })
})
```

Run: `npm run test:api -- tests/api/tenant-isolation.test.ts`
Expected: PASS (build Nuxt mất vài phút; các test PR1 vẫn xanh).

- [ ] **Step 9: Commit**

```bash
git add shared/schemas/orders.ts shared/types/orders.ts server/utils/params.ts server/repositories/orders.ts server/services/ordering/board.ts "server/api/stores/[storeId]/orders" tests/integration/order-board.test.ts tests/api/tenant-isolation.test.ts
git commit -m "feat(owner): add order board and order detail API" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Chuyển trạng thái với optimistic concurrency (`PATCH …/status`)

**Files:**
- Create: `server/services/ordering/conflicts.ts`, `server/services/ordering/change-status.ts`, `server/api/stores/[storeId]/orders/[orderId]/status.patch.ts`, `tests/integration/order-status.test.ts`
- Modify: `shared/schemas/orders.ts`, `tests/api/tenant-isolation.test.ts`

**Interfaces:**
- Consumes: `nextStatuses` (PR3 `transitions.ts`), `findOrderState`, `transitionOrder`, `insertOrderEvent` (Task 3), `requireUuidParam`, `requireStoreStaff`, `parseBody`.
- Produces:
  - `statusChangeSchema` (`{ expectedStatus: OrderStatus; nextStatus: OrderStatus }`, hai giá trị phải khác nhau)
  - `statusConflict(details: { currentStatus?: OrderStatus | null; currentPaymentStatus?: PaymentStatus | null }): AppError` (409 `STATUS_CONFLICT`, dùng lại ở Task 5 và PR5/PR6)
  - `changeOrderStatus(db: Db, ctx: StoreContext, input: { orderId: string; expectedStatus: OrderStatus; nextStatus: OrderStatus }): Promise<OrderActionResult>` — **API ổn định cho PR5/PR6** (PR6 dùng cùng `transitionOrder` cho `AWAITING_PAYMENT → NEW` của hệ thống)
  - `PATCH /api/stores/:storeId/orders/:orderId/status` body `{ expectedStatus, nextStatus }` → `OrderActionResult` (200)
  - Lỗi: 404 không thấy; 409 `STATUS_CONFLICT` với `details.currentStatus`; 400 `VALIDATION_FAILED` với `details.reason = 'TRANSITION_NOT_ALLOWED'` (bao gồm `nextStatus = CANCELLED`, vì hủy đi qua endpoint riêng có lý do).

- [ ] **Step 1: Viết integration test thất bại**

`tests/integration/order-status.test.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { StoreContext } from '../../server/auth/guards'
import { closeDb, getDb } from '../../server/db/client'
import { orderEvents, orders } from '../../server/db/schema'
import { changeOrderStatus } from '../../server/services/ordering/change-status'
import { resetDb } from '../support/db'
import { addStaff, createTenant } from '../support/fixtures'
import { createOrderRow } from '../support/order-fixtures'

type Tenant = Awaited<ReturnType<typeof createTenant>>
const ctxOf = (tenant: Tenant, role: 'OWNER' | 'STAFF' = 'OWNER', userId = tenant.owner.userId): StoreContext => ({
  orgId: tenant.org.id, storeId: tenant.store.id, role, userId,
})

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

const statusOf = async (id: string) => (await getDb().select().from(orders).where(eq(orders.id, id)))[0]!.status
const eventsOf = (id: string) => getDb().select().from(orderEvents).where(eq(orderEvents.orderId, id))

describe('changeOrderStatus', () => {
  it('moves NEW → PREPARING and records who did it', async () => {
    const a = await createTenant('adv')
    const staff = await addStaff(a.store)
    const order = await createOrderRow(a.store)
    const result = await changeOrderStatus(getDb(), ctxOf(a, 'STAFF', staff.userId), { orderId: order.id, expectedStatus: 'NEW', nextStatus: 'PREPARING' })
    expect(result).toMatchObject({ id: order.id, status: 'PREPARING', paymentStatus: 'UNPAID' })
    const events = await eventsOf(order.id)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ eventType: 'STATUS_CHANGED', fromState: 'NEW', toState: 'PREPARING', actorUserId: staff.userId, storeId: a.store.id })
  })

  it.each([
    ['DINE_IN', ['NEW', 'PREPARING', 'READY', 'COMPLETED']],
    ['PICKUP', ['NEW', 'READY', 'COMPLETED']],
    ['DELIVERY', ['NEW', 'PREPARING', 'READY', 'DELIVERING', 'COMPLETED']],
  ] as const)('walks the whole %s path one step at a time', async (fulfillmentType, path) => {
    const a = await createTenant(`walk-${fulfillmentType.toLowerCase()}`)
    const order = await createOrderRow(a.store, { fulfillmentType })
    for (let i = 0; i < path.length - 1; i++) {
      await changeOrderStatus(getDb(), ctxOf(a), { orderId: order.id, expectedStatus: path[i]!, nextStatus: path[i + 1]! })
    }
    expect(await statusOf(order.id)).toBe('COMPLETED')
    expect(await eventsOf(order.id)).toHaveLength(path.length - 1)
  })

  it.each([
    ['NEW', 'COMPLETED', 'PICKUP'],
    ['NEW', 'CANCELLED', 'PICKUP'],
    ['NEW', 'DELIVERING', 'DELIVERY'],
    ['PREPARING', 'NEW', 'PICKUP'],
    ['READY', 'DELIVERING', 'PICKUP'],
    ['READY', 'COMPLETED', 'DELIVERY'],
    ['COMPLETED', 'READY', 'PICKUP'],
    ['CANCELLED', 'NEW', 'PICKUP'],
    ['AWAITING_PAYMENT', 'NEW', 'PICKUP'],
  ] as const)('rejects %s → %s (%s) without touching the order', async (from, to, fulfillmentType) => {
    const a = await createTenant('illegal')
    const order = await createOrderRow(a.store, {
      status: from,
      fulfillmentType,
      ...(from === 'AWAITING_PAYMENT' ? { paymentMethod: 'BANK_QR' as const, paymentStatus: 'PENDING' as const } : {}),
    })
    await expect(changeOrderStatus(getDb(), ctxOf(a), { orderId: order.id, expectedStatus: from, nextStatus: to }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'TRANSITION_NOT_ALLOWED' } })
    expect(await statusOf(order.id)).toBe(from)
    expect(await eventsOf(order.id)).toHaveLength(0)
  })

  it('returns STATUS_CONFLICT with the current status when expectedStatus is stale', async () => {
    const a = await createTenant('stale')
    const order = await createOrderRow(a.store, { status: 'PREPARING' })
    await expect(changeOrderStatus(getDb(), ctxOf(a), { orderId: order.id, expectedStatus: 'NEW', nextStatus: 'PREPARING' }))
      .rejects.toMatchObject({ code: 'STATUS_CONFLICT', details: { currentStatus: 'PREPARING' } })
    expect(await eventsOf(order.id)).toHaveLength(0)
  })

  it('treats another store\'s order and an unknown id as NOT_FOUND', async () => {
    const a = await createTenant('nf-a')
    const b = await createTenant('nf-b')
    const orderOfB = await createOrderRow(b.store)
    for (const orderId of [orderOfB.id, randomUUID()]) {
      await expect(changeOrderStatus(getDb(), ctxOf(a), { orderId, expectedStatus: 'NEW', nextStatus: 'PREPARING' }))
        .rejects.toMatchObject({ code: 'NOT_FOUND' })
    }
    expect(await statusOf(orderOfB.id)).toBe('NEW')
  })
})

describe('changeOrderStatus concurrency (Review Focus #9)', () => {
  it('two staff tapping the same transition: exactly one wins, the other gets STATUS_CONFLICT', async () => {
    const a = await createTenant('race-same')
    const s1 = await addStaff(a.store)
    const s2 = await addStaff(a.store)
    const order = await createOrderRow(a.store)
    const input = { orderId: order.id, expectedStatus: 'NEW', nextStatus: 'PREPARING' } as const

    const results = await Promise.allSettled([
      changeOrderStatus(getDb(), ctxOf(a, 'STAFF', s1.userId), input),
      changeOrderStatus(getDb(), ctxOf(a, 'STAFF', s2.userId), input),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(rejected).toHaveLength(1)
    expect(rejected[0]!.reason).toMatchObject({ code: 'STATUS_CONFLICT' })
    expect(await statusOf(order.id)).toBe('PREPARING')
    expect(await eventsOf(order.id)).toHaveLength(1)
  })

  it('two staff choosing different targets (PREPARING vs READY): one winner, one event', async () => {
    const a = await createTenant('race-diff')
    const order = await createOrderRow(a.store)
    const results = await Promise.allSettled([
      changeOrderStatus(getDb(), ctxOf(a), { orderId: order.id, expectedStatus: 'NEW', nextStatus: 'PREPARING' }),
      changeOrderStatus(getDb(), ctxOf(a), { orderId: order.id, expectedStatus: 'NEW', nextStatus: 'READY' }),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(['PREPARING', 'READY']).toContain(await statusOf(order.id))
    expect(await eventsOf(order.id)).toHaveLength(1)
  })

  it('five simultaneous taps (double tap + retries) still produce one transition', async () => {
    const a = await createTenant('race-five')
    const order = await createOrderRow(a.store)
    const tap = () => changeOrderStatus(getDb(), ctxOf(a), { orderId: order.id, expectedStatus: 'NEW', nextStatus: 'PREPARING' })
    const results = await Promise.allSettled([tap(), tap(), tap(), tap(), tap()])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason).toMatchObject({ code: 'STATUS_CONFLICT' })
    }
    expect(await eventsOf(order.id)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `npx vitest run --project integration tests/integration/order-status.test.ts`
Expected: FAIL (`change-status` chưa tồn tại).

- [ ] **Step 3: Implement schema, lỗi conflict, service, route**

`shared/schemas/orders.ts`: đổi dòng import đầu file thành

```ts
import { ORDER_STATUSES } from '../enums'
import { BOARD_TABS } from '../order-flow'
```

và thêm ngay sau `export type BoardQuery = z.output<typeof boardQuerySchema>`:

```ts
const orderStatus = z.enum(ORDER_STATUSES)

export const statusChangeSchema = z.object({
  expectedStatus: orderStatus,
  nextStatus: orderStatus,
}).refine(value => value.expectedStatus !== value.nextStatus, 'Trạng thái mới phải khác trạng thái hiện tại')
export type StatusChangeInput = z.output<typeof statusChangeSchema>
```

`server/services/ordering/conflicts.ts`:

```ts
import type { OrderStatus, PaymentStatus } from '#shared/enums'
import { AppError } from '../../utils/errors'

export function statusConflict(details: { currentStatus?: OrderStatus | null, currentPaymentStatus?: PaymentStatus | null }): AppError {
  return new AppError('STATUS_CONFLICT', 'Đơn vừa được người khác cập nhật, vui lòng tải lại', details)
}
```

`server/services/ordering/change-status.ts`:

```ts
import type { OrderStatus } from '#shared/enums'
import type { OrderActionResult } from '#shared/types/orders'
import type { StoreContext } from '../../auth/guards'
import type { Db } from '../../db/client'
import { findOrderState, insertOrderEvent, transitionOrder } from '../../repositories/orders'
import { AppError } from '../../utils/errors'
import { statusConflict } from './conflicts'
import { nextStatuses } from './transitions'

export interface ChangeStatusInput {
  orderId: string
  expectedStatus: OrderStatus
  nextStatus: OrderStatus
}

export async function changeOrderStatus(db: Db, ctx: StoreContext, input: ChangeStatusInput): Promise<OrderActionResult> {
  const scope = { orgId: ctx.orgId, storeId: ctx.storeId }
  return db.transaction(async (tx) => {
    const current = await findOrderState(tx, scope, input.orderId)
    if (!current) throw new AppError('NOT_FOUND', 'Không tìm thấy')
    if (current.status !== input.expectedStatus) throw statusConflict({ currentStatus: current.status })

    const allowed = nextStatuses({ status: current.status, fulfillmentType: current.fulfillmentType }, ctx.role)
    // Hủy đi qua endpoint riêng vì bắt buộc có lý do và có quy tắc thu tiền.
    if (input.nextStatus === 'CANCELLED' || !allowed.includes(input.nextStatus)) {
      throw new AppError('VALIDATION_FAILED', 'Không thể chuyển sang trạng thái này', {
        reason: 'TRANSITION_NOT_ALLOWED',
        from: current.status,
        to: input.nextStatus,
      })
    }

    // Điểm duy nhất ngăn hai người cùng đổi một đơn: nếu người kia đã commit, WHERE status = expected không còn khớp.
    const updated = await transitionOrder(tx, scope, input.orderId, { from: input.expectedStatus, to: input.nextStatus })
    if (!updated) {
      const latest = await findOrderState(tx, scope, input.orderId)
      throw statusConflict({ currentStatus: latest?.status ?? null })
    }

    await insertOrderEvent(tx, scope, {
      orderId: input.orderId,
      actorUserId: ctx.userId,
      eventType: 'STATUS_CHANGED',
      fromState: input.expectedStatus,
      toState: input.nextStatus,
    })
    return updated
  })
}
```

`server/api/stores/[storeId]/orders/[orderId]/status.patch.ts`:

```ts
import { getRouterParam } from 'h3'
import { statusChangeSchema } from '#shared/schemas/orders'
import { requireStoreStaff } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { changeOrderStatus } from '../../../../../services/ordering/change-status'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { requireUuidParam } from '../../../../../utils/params'
import { parseBody } from '../../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreStaff(event, getRouterParam(event, 'storeId'))
  const orderId = requireUuidParam(event, 'orderId')
  const body = await parseBody(event, statusChangeSchema)
  return changeOrderStatus(getDb(), ctx, { orderId, ...body })
})
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

Run: `npx vitest run --project integration tests/integration/order-status.test.ts`
Expected: PASS. Chạy lặp 3 lần (`for i in 1 2 3; do npx vitest run --project integration tests/integration/order-status.test.ts || break; done`) để chắc test đồng thời không flaky.

- [ ] **Step 5: Thêm hàng ma trận tenant (PATCH status)**

Cuối `tests/api/tenant-isolation.test.ts`:

```ts
describe('PATCH /api/stores/:storeId/orders/:orderId/status', () => {
  const patch = (actor: Actor | null, orderId: string, body: unknown, storeId = ids.storeA1) =>
    call('PATCH', `/api/stores/${storeId}/orders/${orderId}/status`, actor ? tokens[actor] : null, body)
  const advance = { expectedStatus: 'NEW', nextStatus: 'PREPARING' }

  it('without token → 401', async () => {
    expect(await patch(null, ops.orderA1, advance)).toMatchObject({ status: 401, body: { code: 'UNAUTHENTICATED' } })
  })

  it.each<[Actor, number]>([['ownerA', 200], ['staffA1', 200], ['staffA2', 404], ['disabledA1', 404], ['ownerB', 404]])(
    '%s → %i',
    async (actor, status) => {
      const order = await freshOrder()
      const res = await patch(actor, order.id, advance)
      expect(res.status).toBe(status)
      if (status === 200) {
        expect(res.body).toMatchObject({ id: order.id, status: 'PREPARING' })
      }
      else {
        expect(res.body).toMatchObject({ code: errorCodes[status] })
        expect((await orderStatusOf(order.id)).status).toBe('NEW')
      }
    },
  )

  it('another store\'s order through my store path → 404 and unchanged', async () => {
    const res = await patch('ownerA', ops.orderB, advance)
    expect(res).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
  })

  it('stale expectedStatus → 409 STATUS_CONFLICT with the current status', async () => {
    const order = await freshOrder({ status: 'PREPARING' })
    expect(await patch('staffA1', order.id, advance)).toMatchObject({
      status: 409,
      body: { code: 'STATUS_CONFLICT', details: { currentStatus: 'PREPARING' } },
    })
  })

  it.each([
    [{ expectedStatus: 'NEW', nextStatus: 'COMPLETED' }, 400],
    [{ expectedStatus: 'NEW', nextStatus: 'CANCELLED' }, 400],
    [{ expectedStatus: 'NEW', nextStatus: 'NEW' }, 400],
    [{ expectedStatus: 'NEW' }, 400],
    [{ expectedStatus: 'BOGUS', nextStatus: 'READY' }, 400],
  ])('invalid body %j → %i', async (body, status) => {
    const order = await freshOrder()
    expect(await patch('ownerA', order.id, body)).toMatchObject({ status, body: { code: 'VALIDATION_FAILED' } })
  })

  it('a non-uuid order id → 404', async () => {
    expect(await patch('ownerA', 'not-a-uuid', advance)).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
  })
})
```

Run: `npm run test:api -- tests/api/tenant-isolation.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/schemas/orders.ts server/services/ordering/conflicts.ts server/services/ordering/change-status.ts "server/api/stores/[storeId]/orders/[orderId]/status.patch.ts" tests/integration/order-status.test.ts tests/api/tenant-isolation.test.ts
git commit -m "feat(owner): add optimistic-concurrency order status transitions" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Hủy đơn có lý do + ghi nhận đã thu tiền mặt

**Files:**
- Create: `server/services/ordering/cancel-order.ts`, `server/services/ordering/record-cash-payment.ts`, `server/api/stores/[storeId]/orders/[orderId]/cancel.post.ts`, `server/api/stores/[storeId]/orders/[orderId]/mark-paid.post.ts`, `tests/integration/order-cancel-pay.test.ts`
- Modify: `shared/schemas/orders.ts`, `tests/api/tenant-isolation.test.ts`

**Interfaces:**
- Consumes: `canCancel` (PR3), `paymentStatusAfterCancel` (Task 2), `findOrderState`, `transitionOrder`, `markOrderPaid`, `insertOrderEvent`, `insertCashPayment` (Task 3), `statusConflict` (Task 4), `isUniqueViolation`.
- Produces:
  - `cancelOrderSchema` (`{ expectedStatus: OrderStatus; reason: string /* trim, 2–200 */ }`), `markPaidSchema` (`{ expectedPaymentStatus: PaymentStatus; method: 'CASH'; note?: string /* trim, ≤ 200 */ }`)
  - `cancelOrder(db: Db, ctx: StoreContext, input: { orderId: string; expectedStatus: OrderStatus; reason: string }): Promise<OrderActionResult>` — đơn `PAID` bị hủy thì `paymentStatus = 'REFUND_DUE'`; staff hủy đơn đã thu ⇒ 403 `FORBIDDEN`; trạng thái không hủy được (kể cả owner) ⇒ 400 `TRANSITION_NOT_ALLOWED`; ghi event `CANCELLED` với `metadata.reason`
  - `recordCashPayment(db: Db, ctx: StoreContext, input: { orderId: string; expectedPaymentStatus: PaymentStatus; note?: string }): Promise<OrderActionResult>` — chỉ đơn `PAY_ON_RECEIPT` đang `UNPAID` và chưa hủy; tạo đúng một `order_payments(method='CASH', amount_vnd = total_vnd)` + event `PAYMENT_RECORDED`
  - `POST /api/stores/:storeId/orders/:orderId/cancel` (200), `POST …/mark-paid` (200), cả hai trả `OrderActionResult`; lỗi như Task 4 (`NOT_FOUND`, `STATUS_CONFLICT`, `VALIDATION_FAILED`, 403)

Quy tắc chống race (Review Focus #2): cả hủy lẫn mark-paid đều là `UPDATE … WHERE status/payment_status = <giá trị đã đọc>`; hủy kèm `onlyIfPaymentStatus` nên nếu tiền được ghi nhận giữa lúc đọc và ghi thì hủy thất bại với 409 (staff phải tải lại và sẽ thấy cần owner), còn mark-paid có `ne(status, 'CANCELLED')` nên không thể thu tiền một đơn đã hủy.

- [ ] **Step 1: Viết integration test thất bại**

`tests/integration/order-cancel-pay.test.ts`:

```ts
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { StoreContext } from '../../server/auth/guards'
import { closeDb, getDb } from '../../server/db/client'
import { orderEvents, orderPayments, orders } from '../../server/db/schema'
import { cancelOrder } from '../../server/services/ordering/cancel-order'
import { recordCashPayment } from '../../server/services/ordering/record-cash-payment'
import { resetDb } from '../support/db'
import { addStaff, createTenant } from '../support/fixtures'
import { createOrderRow, createPaymentRow } from '../support/order-fixtures'

type Tenant = Awaited<ReturnType<typeof createTenant>>
const ctxOf = (tenant: Tenant, role: 'OWNER' | 'STAFF' = 'OWNER', userId = tenant.owner.userId): StoreContext => ({
  orgId: tenant.org.id, storeId: tenant.store.id, role, userId,
})

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

const rowOf = async (id: string) => (await getDb().select().from(orders).where(eq(orders.id, id)))[0]!
const paymentsOf = (id: string) => getDb().select().from(orderPayments).where(eq(orderPayments.orderId, id))
const eventsOf = (id: string) => getDb().select().from(orderEvents).where(eq(orderEvents.orderId, id))

describe('cancelOrder', () => {
  it('lets staff cancel an unpaid order and records the reason', async () => {
    const a = await createTenant('c1')
    const staff = await addStaff(a.store)
    const order = await createOrderRow(a.store, { status: 'PREPARING' })
    const result = await cancelOrder(getDb(), ctxOf(a, 'STAFF', staff.userId), { orderId: order.id, expectedStatus: 'PREPARING', reason: 'Hết nguyên liệu' })
    expect(result).toMatchObject({ status: 'CANCELLED', paymentStatus: 'UNPAID' })
    const [event] = await eventsOf(order.id)
    expect(event).toMatchObject({ eventType: 'CANCELLED', fromState: 'PREPARING', toState: 'CANCELLED', actorUserId: staff.userId })
    expect(event!.metadata).toMatchObject({ reason: 'Hết nguyên liệu' })
  })

  it('forbids staff from cancelling a paid order, but the owner can and it becomes REFUND_DUE', async () => {
    const a = await createTenant('c2')
    const staff = await addStaff(a.store)
    const order = await createOrderRow(a.store, { paymentStatus: 'PAID' })
    await createPaymentRow(order)

    await expect(cancelOrder(getDb(), ctxOf(a, 'STAFF', staff.userId), { orderId: order.id, expectedStatus: 'NEW', reason: 'Khách đổi ý' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await rowOf(order.id)).toMatchObject({ status: 'NEW', paymentStatus: 'PAID' })
    expect(await eventsOf(order.id)).toHaveLength(0)

    const result = await cancelOrder(getDb(), ctxOf(a), { orderId: order.id, expectedStatus: 'NEW', reason: 'Khách đổi ý' })
    expect(result).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUND_DUE' })
    expect(await paymentsOf(order.id)).toHaveLength(1)
  })

  it.each(['READY', 'DELIVERING', 'COMPLETED', 'CANCELLED'] as const)('rejects cancelling a %s order, even for the owner', async (status) => {
    const a = await createTenant(`c3-${status.toLowerCase()}`)
    const order = await createOrderRow(a.store, { status, fulfillmentType: 'DELIVERY' })
    await expect(cancelOrder(getDb(), ctxOf(a), { orderId: order.id, expectedStatus: status, reason: 'Thử hủy' }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'TRANSITION_NOT_ALLOWED' } })
    expect((await rowOf(order.id)).status).toBe(status)
  })

  it('cancels an AWAITING_PAYMENT order for staff (payment PENDING)', async () => {
    const a = await createTenant('c4')
    const order = await createOrderRow(a.store, { status: 'AWAITING_PAYMENT', paymentMethod: 'BANK_QR', paymentStatus: 'PENDING' })
    const staff = await addStaff(a.store)
    expect(await cancelOrder(getDb(), ctxOf(a, 'STAFF', staff.userId), { orderId: order.id, expectedStatus: 'AWAITING_PAYMENT', reason: 'Khách không chuyển khoản' }))
      .toMatchObject({ status: 'CANCELLED', paymentStatus: 'PENDING' })
  })

  it('returns STATUS_CONFLICT when the status moved on', async () => {
    const a = await createTenant('c5')
    const order = await createOrderRow(a.store, { status: 'PREPARING' })
    await expect(cancelOrder(getDb(), ctxOf(a), { orderId: order.id, expectedStatus: 'NEW', reason: 'Lý do' }))
      .rejects.toMatchObject({ code: 'STATUS_CONFLICT', details: { currentStatus: 'PREPARING' } })
  })

  it('does not leak other stores (NOT_FOUND)', async () => {
    const a = await createTenant('c6a')
    const b = await createTenant('c6b')
    const orderOfB = await createOrderRow(b.store)
    await expect(cancelOrder(getDb(), ctxOf(a), { orderId: orderOfB.id, expectedStatus: 'NEW', reason: 'Lý do' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect((await rowOf(orderOfB.id)).status).toBe('NEW')
  })
})

describe('recordCashPayment', () => {
  it('records exactly one CASH payment equal to the order total', async () => {
    const a = await createTenant('p1')
    const staff = await addStaff(a.store)
    const order = await createOrderRow(a.store, { totalVnd: 73_000, subtotalVnd: 73_000 })
    const result = await recordCashPayment(getDb(), ctxOf(a, 'STAFF', staff.userId), { orderId: order.id, expectedPaymentStatus: 'UNPAID', note: 'Khách đưa 100k, thối 27k' })
    expect(result).toMatchObject({ status: 'NEW', paymentStatus: 'PAID' })
    const [payment] = await paymentsOf(order.id)
    expect(payment).toMatchObject({ method: 'CASH', amountVnd: 73_000, recordedBy: staff.userId, note: 'Khách đưa 100k, thối 27k', bankTransactionId: null })
    const [event] = await eventsOf(order.id)
    expect(event).toMatchObject({ eventType: 'PAYMENT_RECORDED', actorUserId: staff.userId })
    expect(event!.metadata).toMatchObject({ method: 'CASH', amountVnd: 73_000 })
  })

  it('works on a COMPLETED COD order (paid on delivery)', async () => {
    const a = await createTenant('p2')
    const order = await createOrderRow(a.store, { status: 'COMPLETED' })
    expect(await recordCashPayment(getDb(), ctxOf(a), { orderId: order.id, expectedPaymentStatus: 'UNPAID' })).toMatchObject({ paymentStatus: 'PAID' })
  })

  it('second tap is STATUS_CONFLICT and still one payment', async () => {
    const a = await createTenant('p3')
    const order = await createOrderRow(a.store)
    await recordCashPayment(getDb(), ctxOf(a), { orderId: order.id, expectedPaymentStatus: 'UNPAID' })
    await expect(recordCashPayment(getDb(), ctxOf(a), { orderId: order.id, expectedPaymentStatus: 'UNPAID' }))
      .rejects.toMatchObject({ code: 'STATUS_CONFLICT', details: { currentPaymentStatus: 'PAID' } })
    expect(await paymentsOf(order.id)).toHaveLength(1)
  })

  it('five simultaneous taps create one payment', async () => {
    const a = await createTenant('p4')
    const order = await createOrderRow(a.store)
    const tap = () => recordCashPayment(getDb(), ctxOf(a), { orderId: order.id, expectedPaymentStatus: 'UNPAID' })
    const results = await Promise.allSettled([tap(), tap(), tap(), tap(), tap()])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason).toMatchObject({ code: 'STATUS_CONFLICT' })
    }
    expect(await paymentsOf(order.id)).toHaveLength(1)
    expect(await eventsOf(order.id)).toHaveLength(1)
  })

  it('refuses cancelled orders and non-COD orders', async () => {
    const a = await createTenant('p5')
    const cancelled = await createOrderRow(a.store, { status: 'CANCELLED' })
    await expect(recordCashPayment(getDb(), ctxOf(a), { orderId: cancelled.id, expectedPaymentStatus: 'UNPAID' }))
      .rejects.toMatchObject({ code: 'STATUS_CONFLICT' })
    const bank = await createOrderRow(a.store, { status: 'AWAITING_PAYMENT', paymentMethod: 'BANK_QR', paymentStatus: 'PENDING' })
    await expect(recordCashPayment(getDb(), ctxOf(a), { orderId: bank.id, expectedPaymentStatus: 'PENDING' }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'NOT_COD' } })
    expect(await paymentsOf(cancelled.id)).toHaveLength(0)
    expect(await paymentsOf(bank.id)).toHaveLength(0)
  })

  it('does not leak other stores (NOT_FOUND)', async () => {
    const a = await createTenant('p6a')
    const b = await createTenant('p6b')
    const orderOfB = await createOrderRow(b.store)
    await expect(recordCashPayment(getDb(), ctxOf(a), { orderId: orderOfB.id, expectedPaymentStatus: 'UNPAID' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('cancel vs mark-paid race (Review Focus #2)', () => {
  it('never ends as cancelled-and-paid without REFUND_DUE, never pays a cancelled order', async () => {
    const a = await createTenant('race')
    const staff = await addStaff(a.store)
    for (let i = 0; i < 8; i++) {
      const order = await createOrderRow(a.store)
      const results = await Promise.allSettled([
        cancelOrder(getDb(), ctxOf(a, 'STAFF', staff.userId), { orderId: order.id, expectedStatus: 'NEW', reason: 'Khách hủy' }),
        recordCashPayment(getDb(), ctxOf(a, 'STAFF', staff.userId), { orderId: order.id, expectedPaymentStatus: 'UNPAID' }),
      ])
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)

      const row = await rowOf(order.id)
      const payments = await paymentsOf(order.id)
      if (row.status === 'CANCELLED') {
        expect(row.paymentStatus).toBe('UNPAID')
        expect(payments).toHaveLength(0)
      }
      else {
        expect(row).toMatchObject({ status: 'NEW', paymentStatus: 'PAID' })
        expect(payments).toHaveLength(1)
      }
    }
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `npx vitest run --project integration tests/integration/order-cancel-pay.test.ts`
Expected: FAIL (module chưa tồn tại).

- [ ] **Step 3: Implement schema, services, routes**

`shared/schemas/orders.ts`: đổi import đầu file thành `import { ORDER_STATUSES, PAYMENT_STATUSES } from '../enums'` và thêm ở cuối file:

```ts
export const cancelOrderSchema = z.object({
  expectedStatus: orderStatus,
  reason: z.string().trim().min(2, 'Nhập lý do hủy').max(200, 'Lý do tối đa 200 ký tự'),
})
export type CancelOrderInput = z.output<typeof cancelOrderSchema>

export const markPaidSchema = z.object({
  expectedPaymentStatus: z.enum(PAYMENT_STATUSES),
  method: z.literal('CASH'),
  note: z.string().trim().max(200, 'Ghi chú tối đa 200 ký tự').optional(),
})
export type MarkPaidInput = z.output<typeof markPaidSchema>
```

`server/services/ordering/cancel-order.ts`:

```ts
import type { OrderStatus } from '#shared/enums'
import { paymentStatusAfterCancel } from '#shared/order-flow'
import type { OrderActionResult } from '#shared/types/orders'
import type { StoreContext } from '../../auth/guards'
import type { Db } from '../../db/client'
import { findOrderState, insertOrderEvent, transitionOrder } from '../../repositories/orders'
import { AppError } from '../../utils/errors'
import { statusConflict } from './conflicts'
import { canCancel } from './transitions'

export interface CancelOrderInput {
  orderId: string
  expectedStatus: OrderStatus
  reason: string
}

export async function cancelOrder(db: Db, ctx: StoreContext, input: CancelOrderInput): Promise<OrderActionResult> {
  const scope = { orgId: ctx.orgId, storeId: ctx.storeId }
  return db.transaction(async (tx) => {
    const current = await findOrderState(tx, scope, input.orderId)
    if (!current) throw new AppError('NOT_FOUND', 'Không tìm thấy')
    if (current.status !== input.expectedStatus) throw statusConflict({ currentStatus: current.status })

    const subject = { status: current.status, paymentStatus: current.paymentStatus }
    if (!canCancel(subject, ctx.role)) {
      if (canCancel(subject, 'OWNER')) throw new AppError('FORBIDDEN', 'Đơn đã thu tiền, chỉ chủ quán được hủy')
      throw new AppError('VALIDATION_FAILED', 'Không thể hủy đơn ở trạng thái này', {
        reason: 'TRANSITION_NOT_ALLOWED',
        from: current.status,
        to: 'CANCELLED',
      })
    }

    const nextPaymentStatus = paymentStatusAfterCancel(current.paymentStatus)
    // onlyIfPaymentStatus: nếu tiền vừa được ghi nhận sau khi ta đọc, việc hủy phải thất bại thay vì bỏ sót REFUND_DUE.
    const updated = await transitionOrder(tx, scope, input.orderId, {
      from: current.status,
      to: 'CANCELLED',
      onlyIfPaymentStatus: current.paymentStatus,
      setPaymentStatus: nextPaymentStatus,
    })
    if (!updated) {
      const latest = await findOrderState(tx, scope, input.orderId)
      throw statusConflict({ currentStatus: latest?.status ?? null, currentPaymentStatus: latest?.paymentStatus ?? null })
    }

    await insertOrderEvent(tx, scope, {
      orderId: input.orderId,
      actorUserId: ctx.userId,
      eventType: 'CANCELLED',
      fromState: current.status,
      toState: 'CANCELLED',
      metadata: { reason: input.reason, paymentStatus: { from: current.paymentStatus, to: nextPaymentStatus } },
    })
    return updated
  })
}
```

`server/services/ordering/record-cash-payment.ts`:

```ts
import type { PaymentStatus } from '#shared/enums'
import type { OrderActionResult } from '#shared/types/orders'
import type { StoreContext } from '../../auth/guards'
import type { Db } from '../../db/client'
import { isUniqueViolation } from '../../db/errors'
import { findOrderState, insertCashPayment, insertOrderEvent, markOrderPaid } from '../../repositories/orders'
import { AppError } from '../../utils/errors'
import { statusConflict } from './conflicts'

export interface RecordCashPaymentInput {
  orderId: string
  expectedPaymentStatus: PaymentStatus
  note?: string
}

export async function recordCashPayment(db: Db, ctx: StoreContext, input: RecordCashPaymentInput): Promise<OrderActionResult> {
  const scope = { orgId: ctx.orgId, storeId: ctx.storeId }
  const note = input.note?.trim() ? input.note.trim() : null
  return db.transaction(async (tx) => {
    const current = await findOrderState(tx, scope, input.orderId)
    if (!current) throw new AppError('NOT_FOUND', 'Không tìm thấy')
    const conflict = () => statusConflict({ currentStatus: current.status, currentPaymentStatus: current.paymentStatus })
    if (current.paymentStatus !== input.expectedPaymentStatus || current.status === 'CANCELLED') throw conflict()
    if (current.paymentMethod !== 'PAY_ON_RECEIPT') {
      throw new AppError('VALIDATION_FAILED', 'Chỉ ghi nhận thu tiền mặt cho đơn trả khi nhận', { reason: 'NOT_COD' })
    }
    if (current.paymentStatus !== 'UNPAID') throw conflict()

    const updated = await markOrderPaid(tx, scope, input.orderId, 'UNPAID')
    if (!updated) {
      const latest = await findOrderState(tx, scope, input.orderId)
      throw statusConflict({ currentStatus: latest?.status ?? null, currentPaymentStatus: latest?.paymentStatus ?? null })
    }

    try {
      await insertCashPayment(tx, scope, { orderId: input.orderId, amountVnd: current.totalVnd, recordedBy: ctx.userId, note })
    }
    catch (err) {
      if (isUniqueViolation(err, 'order_payments_order_uq')) throw conflict()
      throw err
    }

    await insertOrderEvent(tx, scope, {
      orderId: input.orderId,
      actorUserId: ctx.userId,
      eventType: 'PAYMENT_RECORDED',
      metadata: { method: 'CASH', amountVnd: current.totalVnd, paymentStatus: { from: 'UNPAID', to: 'PAID' }, ...(note ? { note } : {}) },
    })
    return updated
  })
}
```

`server/api/stores/[storeId]/orders/[orderId]/cancel.post.ts`:

```ts
import { getRouterParam } from 'h3'
import { cancelOrderSchema } from '#shared/schemas/orders'
import { requireStoreStaff } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { cancelOrder } from '../../../../../services/ordering/cancel-order'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { requireUuidParam } from '../../../../../utils/params'
import { parseBody } from '../../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreStaff(event, getRouterParam(event, 'storeId'))
  const orderId = requireUuidParam(event, 'orderId')
  const body = await parseBody(event, cancelOrderSchema)
  return cancelOrder(getDb(), ctx, { orderId, ...body })
})
```

`server/api/stores/[storeId]/orders/[orderId]/mark-paid.post.ts`:

```ts
import { getRouterParam } from 'h3'
import { markPaidSchema } from '#shared/schemas/orders'
import { requireStoreStaff } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { recordCashPayment } from '../../../../../services/ordering/record-cash-payment'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { requireUuidParam } from '../../../../../utils/params'
import { parseBody } from '../../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreStaff(event, getRouterParam(event, 'storeId'))
  const orderId = requireUuidParam(event, 'orderId')
  const body = await parseBody(event, markPaidSchema)
  return recordCashPayment(getDb(), ctx, { orderId, expectedPaymentStatus: body.expectedPaymentStatus, note: body.note })
})
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

Run: `npx vitest run --project integration tests/integration/order-cancel-pay.test.ts`
Expected: PASS; chạy lặp 3 lần để loại trừ flaky của test race.

- [ ] **Step 5: Thêm hàng ma trận tenant (cancel, mark-paid)**

Cuối `tests/api/tenant-isolation.test.ts` (dùng `freshOrder`, `orderStatusOf` đã định nghĩa ở Task 3):

```ts
describe('POST /api/stores/:storeId/orders/:orderId/cancel', () => {
  const cancel = (actor: Actor | null, orderId: string, body: unknown) =>
    call('POST', `/api/stores/${ids.storeA1}/orders/${orderId}/cancel`, actor ? tokens[actor] : null, body)
  const unpaidBody = { expectedStatus: 'NEW', reason: 'Khách đổi ý' }

  it('without token → 401', async () => {
    expect(await cancel(null, ops.orderA1, unpaidBody)).toMatchObject({ status: 401 })
  })

  it.each<[Actor, number]>([['ownerA', 200], ['staffA1', 200], ['staffA2', 404], ['disabledA1', 404], ['ownerB', 404]])(
    'unpaid order, %s → %i',
    async (actor, status) => {
      const order = await freshOrder()
      const res = await cancel(actor, order.id, unpaidBody)
      expect(res.status).toBe(status)
      if (status === 200) expect(res.body).toMatchObject({ status: 'CANCELLED', paymentStatus: 'UNPAID' })
      else expect((await orderStatusOf(order.id)).status).toBe('NEW')
    },
  )

  it('paid order: staff → 403 and unchanged; owner → 200 REFUND_DUE', async () => {
    const order = await freshOrder({ paymentStatus: 'PAID' })
    expect(await cancel('staffA1', order.id, unpaidBody)).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } })
    expect(await orderStatusOf(order.id)).toMatchObject({ status: 'NEW', paymentStatus: 'PAID' })
    expect(await cancel('ownerA', order.id, unpaidBody)).toMatchObject({ status: 200, body: { status: 'CANCELLED', paymentStatus: 'REFUND_DUE' } })
  })

  it('another store\'s order → 404', async () => {
    expect(await cancel('ownerA', ops.orderB, unpaidBody)).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
  })

  it.each([{ expectedStatus: 'NEW' }, { expectedStatus: 'NEW', reason: ' ' }, { expectedStatus: 'NEW', reason: 'x'.repeat(201) }])(
    'invalid body %j → 400',
    async (body) => {
      const order = await freshOrder()
      expect(await cancel('ownerA', order.id, body)).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
    },
  )

  it('stale expectedStatus → 409', async () => {
    const order = await freshOrder({ status: 'PREPARING' })
    expect(await cancel('ownerA', order.id, unpaidBody)).toMatchObject({ status: 409, body: { code: 'STATUS_CONFLICT' } })
  })
})

describe('POST /api/stores/:storeId/orders/:orderId/mark-paid', () => {
  const markPaid = (actor: Actor | null, orderId: string, body: unknown = { expectedPaymentStatus: 'UNPAID', method: 'CASH' }) =>
    call('POST', `/api/stores/${ids.storeA1}/orders/${orderId}/mark-paid`, actor ? tokens[actor] : null, body)

  it('without token → 401', async () => {
    expect(await markPaid(null, ops.orderA1)).toMatchObject({ status: 401 })
  })

  it.each<[Actor, number]>([['ownerA', 200], ['staffA1', 200], ['staffA2', 404], ['disabledA1', 404], ['ownerB', 404]])(
    '%s → %i',
    async (actor, status) => {
      const order = await freshOrder()
      const res = await markPaid(actor, order.id)
      expect(res.status).toBe(status)
      if (status === 200) expect(res.body).toMatchObject({ paymentStatus: 'PAID' })
      else expect((await orderStatusOf(order.id)).paymentStatus).toBe('UNPAID')
    },
  )

  it('second call → 409', async () => {
    const order = await freshOrder()
    expect((await markPaid('staffA1', order.id)).status).toBe(200)
    expect(await markPaid('staffA1', order.id)).toMatchObject({ status: 409, body: { code: 'STATUS_CONFLICT' } })
  })

  it('another store\'s order → 404', async () => {
    expect(await markPaid('ownerA', ops.orderB)).toMatchObject({ status: 404 })
  })

  it.each([{ expectedPaymentStatus: 'UNPAID', method: 'BANK_MANUAL' }, { expectedPaymentStatus: 'UNPAID' }, { method: 'CASH' }])(
    'rejects %j with 400 (BANK_MANUAL is owner-only in PR6)',
    async (body) => {
      const order = await freshOrder()
      expect(await markPaid('ownerA', order.id, body)).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
    },
  )
})
```

Run: `npm run test:api -- tests/api/tenant-isolation.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/schemas/orders.ts server/services/ordering/cancel-order.ts server/services/ordering/record-cash-payment.ts "server/api/stores/[storeId]/orders/[orderId]" tests/integration/order-cancel-pay.test.ts tests/api/tenant-isolation.test.ts
git commit -m "feat(owner): add order cancel with reason and cash mark-paid" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: Quản lý nhân viên — mời (link một lần), danh sách, khóa/mở, thu hồi

**Files:**
- Create: `shared/schemas/team.ts`, `shared/types/team.ts`, `server/services/identity/team.ts`, `server/api/stores/[storeId]/team/index.get.ts`, `server/api/stores/[storeId]/team/invitations/index.post.ts`, `server/api/stores/[storeId]/team/invitations/[invitationId].delete.ts`, `server/api/stores/[storeId]/team/[userId].patch.ts`, `tests/unit/server/owner-env.test.ts`, `tests/unit/shared/team-schemas.test.ts`, `tests/integration/team.test.ts`
- Modify: `server/utils/env.ts`, `tests/api/tenant-isolation.test.ts`

**Interfaces:**
- Consumes: `storeInvitations`, `storeMembers`, `organizationMembers`, `userProfiles` (PR1); `generateToken`, `hashToken` (PR2); `requireStoreOwner`, `StoreContext`, `findStoreAccess`.
- Produces:
  - `inviteInputSchema` (`{ email: string }`, trim + lowercase + hợp lệ, ≤ 254 ký tự), `memberStatusSchema` (`{ status: 'ACTIVE' | 'DISABLED' }`)
  - Kiểu `TeamMember`, `TeamInvitation`, `TeamResponse`, `CreatedInvitation`, `InvitationPreview`, `AcceptInvitationResult` (`shared/types/team.ts`)
  - `listTeam(db: DbOrTx, ctx: StoreContext): Promise<TeamResponse>` (không bao giờ trả token hay hash)
  - `createInvitation(db: Db, ctx: StoreContext, input: { email: string }, baseUrl: string): Promise<CreatedInvitation>` — trả `inviteUrl` **một lần**; thay thế lời mời đang chờ của cùng email; email đã là thành viên ACTIVE (staff hoặc owner của org) ⇒ 400 `VALIDATION_FAILED` `details.reason = 'ALREADY_MEMBER'`
  - `setMemberStatus(db: Db, ctx: StoreContext, targetUserId: string, status: 'ACTIVE' | 'DISABLED'): Promise<void>` (tự khóa mình ⇒ 400 `details.reason='SELF'`; không phải thành viên của store ⇒ 404)
  - `revokeInvitation(db: Db, ctx: StoreContext, invitationId: string): Promise<void>` (chỉ lời mời chưa dùng của store này, nếu không ⇒ 404)
  - `appBaseUrl(): string`, `inviteRequiresVerifiedEmail(): boolean` (`server/utils/env.ts`)
  - Routes (đều owner-only, staff ⇒ 403): `GET /api/stores/:storeId/team` → `TeamResponse`; `POST /api/stores/:storeId/team/invitations` body `{ email }` → 201 `CreatedInvitation`; `DELETE …/team/invitations/:invitationId` → 204-like `{ ok: true }`; `PATCH …/team/:userId` body `{ status }` → `{ ok: true }`

Quyết định: **khóa nhân viên có hiệu lực ngay** vì `findStoreAccess` đọc `store_members.status` ở mọi request (JWT 15 phút không làm chậm việc này). Lời mời thay thế: bấm "Tạo lời mời" lần hai cho cùng email vô hiệu hóa link cũ (xóa dòng chờ) để không có hai link sống song song; advisory lock theo `(store, email)` chặn hai request đồng thời.

- [ ] **Step 1: Viết unit test thất bại (env helper, schema)**

`tests/unit/server/owner-env.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { appBaseUrl, inviteRequiresVerifiedEmail } from '../../../server/utils/env'

const saved = { base: process.env.APP_BASE_URL, verified: process.env.INVITE_REQUIRE_VERIFIED_EMAIL }
afterEach(() => {
  if (saved.base === undefined) delete process.env.APP_BASE_URL
  else process.env.APP_BASE_URL = saved.base
  if (saved.verified === undefined) delete process.env.INVITE_REQUIRE_VERIFIED_EMAIL
  else process.env.INVITE_REQUIRE_VERIFIED_EMAIL = saved.verified
})

describe('appBaseUrl', () => {
  it('strips trailing slashes and falls back to localhost', () => {
    process.env.APP_BASE_URL = 'https://zeno.vn///'
    expect(appBaseUrl()).toBe('https://zeno.vn')
    delete process.env.APP_BASE_URL
    expect(appBaseUrl()).toBe('http://localhost:3000')
  })
})

describe('inviteRequiresVerifiedEmail', () => {
  it('is on by default and only the literal "false" turns it off', () => {
    delete process.env.INVITE_REQUIRE_VERIFIED_EMAIL
    expect(inviteRequiresVerifiedEmail()).toBe(true)
    process.env.INVITE_REQUIRE_VERIFIED_EMAIL = 'true'
    expect(inviteRequiresVerifiedEmail()).toBe(true)
    process.env.INVITE_REQUIRE_VERIFIED_EMAIL = '0'
    expect(inviteRequiresVerifiedEmail()).toBe(true)
    process.env.INVITE_REQUIRE_VERIFIED_EMAIL = 'false'
    expect(inviteRequiresVerifiedEmail()).toBe(false)
  })
})
```

`tests/unit/shared/team-schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { inviteInputSchema, memberStatusSchema } from '../../../shared/schemas/team'

describe('inviteInputSchema', () => {
  it('trims and lowercases the email', () => {
    expect(inviteInputSchema.parse({ email: '  Nhan.Vien@Example.COM ' })).toEqual({ email: 'nhan.vien@example.com' })
  })

  it.each(['', 'abc', 'a@', '@b.vn', 'a b@c.vn', `${'x'.repeat(250)}@a.vn`])('rejects %j', (email) => {
    expect(inviteInputSchema.safeParse({ email }).success).toBe(false)
  })
})

describe('memberStatusSchema', () => {
  it('accepts ACTIVE and DISABLED only', () => {
    expect(memberStatusSchema.safeParse({ status: 'DISABLED' }).success).toBe(true)
    expect(memberStatusSchema.safeParse({ status: 'ACTIVE' }).success).toBe(true)
    expect(memberStatusSchema.safeParse({ status: 'OWNER' }).success).toBe(false)
    expect(memberStatusSchema.safeParse({}).success).toBe(false)
  })
})
```

- [ ] **Step 2: Chạy, xác nhận FAIL**

Run: `npx vitest run --project unit tests/unit/server/owner-env.test.ts tests/unit/shared/team-schemas.test.ts`
Expected: FAIL (hàm/module chưa có).

- [ ] **Step 3: Implement env helper, schema, kiểu**

`server/utils/env.ts`: thêm cuối file:

```ts
export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')
}

// Mặc định bật; chỉ tắt khi đặt đúng chuỗi "false" (môi trường dev/E2E dùng Neon Auth không bắt xác minh email).
export function inviteRequiresVerifiedEmail(): boolean {
  return process.env.INVITE_REQUIRE_VERIFIED_EMAIL !== 'false'
}
```

`shared/schemas/team.ts`:

```ts
import { z } from 'zod'

export const INVITATION_TTL_DAYS = 7

export const inviteInputSchema = z.object({
  email: z.string().trim().toLowerCase().max(254, 'Email quá dài').pipe(z.email('Email không hợp lệ')),
})
export type InviteInput = z.output<typeof inviteInputSchema>

export const memberStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'DISABLED']),
})
export type MemberStatusInput = z.output<typeof memberStatusSchema>
```

`shared/types/team.ts`:

```ts
import type { StoreSummary } from './identity'

export interface TeamMember {
  userId: string
  email: string
  displayName: string | null
  role: 'OWNER' | 'STAFF'
  status: 'ACTIVE' | 'DISABLED'
  source: 'ORG' | 'STORE'
  isSelf: boolean
  canDisable: boolean
}

export interface TeamInvitation {
  id: string
  email: string
  expiresAt: string
  expired: boolean
  createdAt: string
}

export interface TeamResponse {
  members: TeamMember[]
  invitations: TeamInvitation[]
}

export interface CreatedInvitation {
  invitation: TeamInvitation
  inviteUrl: string
}

export interface InvitationPreview {
  storeName: string
  role: 'OWNER' | 'STAFF'
  emailHint: string
  expiresAt: string
  emailMatches: boolean
  emailVerified: boolean
}

export interface AcceptInvitationResult {
  store: StoreSummary
}
```

Run lại bước 2. Expected: PASS.

- [ ] **Step 4: Viết integration test thất bại cho team service**

`tests/integration/team.test.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { StoreContext } from '../../server/auth/guards'
import { closeDb, getDb } from '../../server/db/client'
import { storeInvitations } from '../../server/db/schema'
import { findStoreAccess } from '../../server/repositories/membership'
import { createInvitation, listTeam, revokeInvitation, setMemberStatus } from '../../server/services/identity/team'
import { hashToken } from '../../server/utils/tokens'
import { resetDb } from '../support/db'
import { addStaff, createTenant, createUser } from '../support/fixtures'
import { createInvitationRow } from '../support/order-fixtures'

type Tenant = Awaited<ReturnType<typeof createTenant>>
const ownerCtx = (t: Tenant): StoreContext => ({ orgId: t.org.id, storeId: t.store.id, role: 'OWNER', userId: t.owner.userId })
const BASE = 'https://zeno.test'
const pendingOf = (storeId: string) => getDb().select().from(storeInvitations).where(eq(storeInvitations.storeId, storeId))

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('createInvitation', () => {
  it('returns the link once, stores only the hash, expires in 7 days', async () => {
    const a = await createTenant('inv')
    const result = await createInvitation(getDb(), ownerCtx(a), { email: 'nhanvien@example.com' }, BASE)
    const match = result.inviteUrl.match(/^https:\/\/zeno\.test\/invite\/([A-Za-z0-9_-]{43})$/)
    expect(match).not.toBeNull()
    const token = match![1]!

    const [row] = await pendingOf(a.store.id)
    expect(row).toMatchObject({ email: 'nhanvien@example.com', role: 'STAFF', tokenHash: hashToken(token), createdBy: a.owner.userId, acceptedAt: null })
    expect(JSON.stringify(row)).not.toContain(token)
    const days = (row!.expiresAt.getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(6.9)
    expect(days).toBeLessThan(7.1)
    expect(result.invitation).toMatchObject({ id: row!.id, email: 'nhanvien@example.com', expired: false })
    expect(JSON.stringify(result.invitation)).not.toContain(token)
  })

  it('replaces the pending invitation for the same email (old link dies)', async () => {
    const a = await createTenant('replace')
    const first = await createInvitation(getDb(), ownerCtx(a), { email: 'x@example.com' }, BASE)
    const second = await createInvitation(getDb(), ownerCtx(a), { email: 'x@example.com' }, BASE)
    expect(second.inviteUrl).not.toBe(first.inviteUrl)
    const rows = await pendingOf(a.store.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.tokenHash).toBe(hashToken(second.inviteUrl.split('/').pop()!))
  })

  it('five simultaneous invites for one email leave exactly one pending row', async () => {
    const a = await createTenant('par')
    await Promise.all(Array.from({ length: 5 }, () => createInvitation(getDb(), ownerCtx(a), { email: 'par@example.com' }, BASE)))
    expect(await pendingOf(a.store.id)).toHaveLength(1)
  })

  it('rejects an email that is already an active member or an org owner, but allows a disabled one', async () => {
    const a = await createTenant('member')
    const staff = await addStaff(a.store)
    const disabled = await addStaff(a.store, { status: 'DISABLED' })
    await expect(createInvitation(getDb(), ownerCtx(a), { email: staff.email }, BASE))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'ALREADY_MEMBER' } })
    await expect(createInvitation(getDb(), ownerCtx(a), { email: a.owner.email }, BASE))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'ALREADY_MEMBER' } })
    await expect(createInvitation(getDb(), ownerCtx(a), { email: disabled.email }, BASE)).resolves.toBeTruthy()
  })
})

describe('listTeam', () => {
  it('lists owners, staff and pending invitations of this store only, without secrets', async () => {
    const a = await createTenant('list')
    const b = await createTenant('list-b')
    const staff = await addStaff(a.store)
    await addStaff(b.store)
    const { token } = await createInvitationRow(a.store, { email: 'cho@example.com', createdBy: a.owner.userId })
    await createInvitationRow(b.store, { email: 'khac@example.com', createdBy: b.owner.userId })

    const team = await listTeam(getDb(), ownerCtx(a))
    expect(team.members.map(m => m.userId).sort()).toEqual([a.owner.userId, staff.userId].sort())
    expect(team.members.find(m => m.userId === a.owner.userId)).toMatchObject({ role: 'OWNER', source: 'ORG', isSelf: true, canDisable: false })
    expect(team.members.find(m => m.userId === staff.userId)).toMatchObject({ role: 'STAFF', source: 'STORE', status: 'ACTIVE', isSelf: false, canDisable: true })
    expect(team.invitations.map(i => i.email)).toEqual(['cho@example.com'])
    const serialized = JSON.stringify(team)
    expect(serialized).not.toContain(token)
    expect(serialized).not.toMatch(/tokenHash|token_hash/)
  })

  it('flags expired invitations', async () => {
    const a = await createTenant('exp')
    await createInvitationRow(a.store, { email: 'old@example.com', createdBy: a.owner.userId, expiresAt: new Date(Date.now() - 1000) })
    expect((await listTeam(getDb(), ownerCtx(a))).invitations[0]).toMatchObject({ email: 'old@example.com', expired: true })
  })
})

describe('setMemberStatus', () => {
  it('disables a staff member immediately and re-enables them', async () => {
    const a = await createTenant('dis')
    const staff = await addStaff(a.store)
    expect(await findStoreAccess(getDb(), staff.userId, a.store.id)).toMatchObject({ role: 'STAFF' })
    await setMemberStatus(getDb(), ownerCtx(a), staff.userId, 'DISABLED')
    expect(await findStoreAccess(getDb(), staff.userId, a.store.id)).toBeNull()
    await setMemberStatus(getDb(), ownerCtx(a), staff.userId, 'ACTIVE')
    expect(await findStoreAccess(getDb(), staff.userId, a.store.id)).toMatchObject({ role: 'STAFF' })
  })

  it('refuses to disable yourself and treats non-members and other stores as NOT_FOUND', async () => {
    const a = await createTenant('self')
    const b = await createTenant('self-b')
    const staffOfB = await addStaff(b.store)
    const stranger = await createUser()
    await expect(setMemberStatus(getDb(), ownerCtx(a), a.owner.userId, 'DISABLED'))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'SELF' } })
    for (const target of [staffOfB.userId, stranger.userId, `user_${randomUUID()}`]) {
      await expect(setMemberStatus(getDb(), ownerCtx(a), target, 'DISABLED')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    }
    expect(await findStoreAccess(getDb(), staffOfB.userId, b.store.id)).toMatchObject({ role: 'STAFF' })
  })
})

describe('revokeInvitation', () => {
  it('deletes a pending invitation but not accepted or foreign ones', async () => {
    const a = await createTenant('rev')
    const b = await createTenant('rev-b')
    const pending = await createInvitationRow(a.store, { email: 'p@example.com', createdBy: a.owner.userId })
    const accepted = await createInvitationRow(a.store, { email: 'a@example.com', createdBy: a.owner.userId, acceptedAt: new Date() })
    const foreign = await createInvitationRow(b.store, { email: 'f@example.com', createdBy: b.owner.userId })

    await revokeInvitation(getDb(), ownerCtx(a), pending.row.id)
    await expect(revokeInvitation(getDb(), ownerCtx(a), pending.row.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(revokeInvitation(getDb(), ownerCtx(a), accepted.row.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(revokeInvitation(getDb(), ownerCtx(a), foreign.row.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await pendingOf(b.store.id)).toHaveLength(1)
  })
})
```

- [ ] **Step 5: Chạy, xác nhận FAIL**

Run: `npx vitest run --project integration tests/integration/team.test.ts`
Expected: FAIL (`services/identity/team` chưa có).

- [ ] **Step 6: Implement `server/services/identity/team.ts`**

```ts
import { and, asc, desc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { INVITATION_TTL_DAYS } from '#shared/schemas/team'
import type { CreatedInvitation, TeamInvitation, TeamResponse } from '#shared/types/team'
import type { StoreContext } from '../../auth/guards'
import type { Db, DbOrTx } from '../../db/client'
import { organizationMembers, storeInvitations, storeMembers, userProfiles } from '../../db/schema'
import { AppError } from '../../utils/errors'
import { generateToken, hashToken } from '../../utils/tokens'

type InvitationRow = Pick<typeof storeInvitations.$inferSelect, 'id' | 'email' | 'expiresAt' | 'createdAt'>

function toInvitation(row: InvitationRow, now = Date.now()): TeamInvitation {
  return {
    id: row.id,
    email: row.email,
    expiresAt: row.expiresAt.toISOString(),
    expired: row.expiresAt.getTime() <= now,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function listTeam(db: DbOrTx, ctx: StoreContext): Promise<TeamResponse> {
  const [orgOwners, staff, invitations] = await Promise.all([
    db
      .select({ userId: userProfiles.userId, email: userProfiles.email, displayName: userProfiles.displayName })
      .from(organizationMembers)
      .innerJoin(userProfiles, eq(userProfiles.userId, organizationMembers.userId))
      .where(and(eq(organizationMembers.orgId, ctx.orgId), eq(organizationMembers.status, 'ACTIVE'), eq(organizationMembers.role, 'OWNER')))
      .orderBy(asc(organizationMembers.createdAt)),
    db
      .select({
        userId: userProfiles.userId,
        email: userProfiles.email,
        displayName: userProfiles.displayName,
        role: storeMembers.role,
        status: storeMembers.status,
      })
      .from(storeMembers)
      .innerJoin(userProfiles, eq(userProfiles.userId, storeMembers.userId))
      .where(and(eq(storeMembers.orgId, ctx.orgId), eq(storeMembers.storeId, ctx.storeId)))
      .orderBy(asc(storeMembers.createdAt)),
    db
      .select({ id: storeInvitations.id, email: storeInvitations.email, expiresAt: storeInvitations.expiresAt, createdAt: storeInvitations.createdAt })
      .from(storeInvitations)
      .where(and(eq(storeInvitations.orgId, ctx.orgId), eq(storeInvitations.storeId, ctx.storeId), isNull(storeInvitations.acceptedAt)))
      .orderBy(desc(storeInvitations.createdAt)),
  ])

  const ownerIds = new Set(orgOwners.map(owner => owner.userId))
  return {
    members: [
      ...orgOwners.map(owner => ({
        ...owner,
        role: 'OWNER' as const,
        status: 'ACTIVE' as const,
        source: 'ORG' as const,
        isSelf: owner.userId === ctx.userId,
        canDisable: false,
      })),
      ...staff
        .filter(member => !ownerIds.has(member.userId))
        .map(member => ({ ...member, source: 'STORE' as const, isSelf: member.userId === ctx.userId, canDisable: member.userId !== ctx.userId })),
    ],
    invitations: invitations.map(row => toInvitation(row)),
  }
}

export async function setMemberStatus(db: Db, ctx: StoreContext, targetUserId: string, status: 'ACTIVE' | 'DISABLED'): Promise<void> {
  if (targetUserId === ctx.userId) {
    throw new AppError('VALIDATION_FAILED', 'Bạn không thể tự khóa tài khoản của mình', { reason: 'SELF' })
  }
  const [row] = await db
    .update(storeMembers)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(storeMembers.orgId, ctx.orgId), eq(storeMembers.storeId, ctx.storeId), eq(storeMembers.userId, targetUserId)))
    .returning({ userId: storeMembers.userId })
  if (!row) throw new AppError('NOT_FOUND', 'Không tìm thấy')
}

export async function createInvitation(db: Db, ctx: StoreContext, input: { email: string }, baseUrl: string): Promise<CreatedInvitation> {
  const email = input.email.trim().toLowerCase()
  const token = generateToken()
  return db.transaction(async (tx) => {
    // Serialize theo (store, email): hai request đồng thời không để lại hai link sống.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invite:${ctx.storeId}:${email}`}))`)

    const [member] = await tx
      .select({ userId: userProfiles.userId })
      .from(userProfiles)
      .leftJoin(storeMembers, and(eq(storeMembers.userId, userProfiles.userId), eq(storeMembers.storeId, ctx.storeId), eq(storeMembers.status, 'ACTIVE')))
      .leftJoin(organizationMembers, and(eq(organizationMembers.userId, userProfiles.userId), eq(organizationMembers.orgId, ctx.orgId), eq(organizationMembers.status, 'ACTIVE')))
      .where(and(eq(userProfiles.email, email), or(isNotNull(storeMembers.id), isNotNull(organizationMembers.id))))
      .limit(1)
    if (member) {
      throw new AppError('VALIDATION_FAILED', 'Người này đã là thành viên của cửa hàng', { field: 'email', reason: 'ALREADY_MEMBER' })
    }

    await tx
      .delete(storeInvitations)
      .where(and(eq(storeInvitations.storeId, ctx.storeId), eq(storeInvitations.email, email), isNull(storeInvitations.acceptedAt)))

    const [row] = await tx
      .insert(storeInvitations)
      .values({
        orgId: ctx.orgId,
        storeId: ctx.storeId,
        email,
        role: 'STAFF',
        tokenHash: hashToken(token),
        expiresAt: sql`now() + make_interval(days => ${INVITATION_TTL_DAYS})`,
        createdBy: ctx.userId,
      })
      .returning({ id: storeInvitations.id, email: storeInvitations.email, expiresAt: storeInvitations.expiresAt, createdAt: storeInvitations.createdAt })
    return { invitation: toInvitation(row!), inviteUrl: `${baseUrl}/invite/${token}` }
  })
}

export async function revokeInvitation(db: Db, ctx: StoreContext, invitationId: string): Promise<void> {
  const [row] = await db
    .delete(storeInvitations)
    .where(and(
      eq(storeInvitations.id, invitationId),
      eq(storeInvitations.orgId, ctx.orgId),
      eq(storeInvitations.storeId, ctx.storeId),
      isNull(storeInvitations.acceptedAt),
    ))
    .returning({ id: storeInvitations.id })
  if (!row) throw new AppError('NOT_FOUND', 'Không tìm thấy')
}
```

- [ ] **Step 7: Implement route handlers**

`server/api/stores/[storeId]/team/index.get.ts`:

```ts
import { getRouterParam, setHeader } from 'h3'
import { requireStoreOwner } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { listTeam } from '../../../../services/identity/team'
import { defineApiHandler } from '../../../../utils/api-handler'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  setHeader(event, 'Cache-Control', 'no-store')
  return listTeam(getDb(), ctx)
})
```

`server/api/stores/[storeId]/team/invitations/index.post.ts`:

```ts
import { getRouterParam, setHeader, setResponseStatus } from 'h3'
import { inviteInputSchema } from '#shared/schemas/team'
import { requireStoreOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { createInvitation } from '../../../../../services/identity/team'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { appBaseUrl } from '../../../../../utils/env'
import { parseBody } from '../../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const body = await parseBody(event, inviteInputSchema)
  const result = await createInvitation(getDb(), ctx, body, appBaseUrl())
  setHeader(event, 'Cache-Control', 'no-store')
  setResponseStatus(event, 201)
  return result
})
```

`server/api/stores/[storeId]/team/invitations/[invitationId].delete.ts`:

```ts
import { getRouterParam } from 'h3'
import { requireStoreOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { revokeInvitation } from '../../../../../services/identity/team'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { requireUuidParam } from '../../../../../utils/params'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  await revokeInvitation(getDb(), ctx, requireUuidParam(event, 'invitationId'))
  return { ok: true }
})
```

`server/api/stores/[storeId]/team/[userId].patch.ts`:

```ts
import { getRouterParam } from 'h3'
import { memberStatusSchema } from '#shared/schemas/team'
import { requireStoreOwner } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { setMemberStatus } from '../../../../services/identity/team'
import { defineApiHandler } from '../../../../utils/api-handler'
import { AppError } from '../../../../utils/errors'
import { parseBody } from '../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const userId = getRouterParam(event, 'userId')
  if (!userId || userId.length > 128) throw new AppError('NOT_FOUND', 'Không tìm thấy')
  const body = await parseBody(event, memberStatusSchema)
  await setMemberStatus(getDb(), ctx, userId, body.status)
  return { ok: true }
})
```

- [ ] **Step 8: Chạy integration test, xác nhận PASS**

Run: `npx vitest run --project integration tests/integration/team.test.ts`
Expected: PASS (9 test).

- [ ] **Step 9: Thêm hàng ma trận tenant (team)**

Cuối `tests/api/tenant-isolation.test.ts`:

```ts
describe('team endpoints (owner only)', () => {
  const team = (actor: Actor | null, method: string, suffix = '', body?: unknown, storeId = ids.storeA1) =>
    call(method, `/api/stores/${storeId}/team${suffix}`, actor ? tokens[actor] : null, body)

  it('without token → 401', async () => {
    expect(await team(null, 'GET')).toMatchObject({ status: 401 })
  })

  it.each<[Actor, number]>([['ownerA', 200], ['staffA1', 403], ['staffA2', 404], ['disabledA1', 404], ['ownerB', 404]])(
    'GET team %s → %i',
    async (actor, status) => {
      const res = await team(actor, 'GET')
      expect(res.status).toBe(status)
      if (status === 200) {
        expect(res.body.members.length).toBeGreaterThan(0)
        expect(JSON.stringify(res.body)).not.toMatch(/tokenHash|token_hash|inviteUrl/)
      }
      else {
        expect(res.body).toMatchObject({ code: errorCodes[status] })
      }
    },
  )

  it.each<[Actor, number]>([['staffA1', 403], ['staffA2', 404], ['disabledA1', 404], ['ownerB', 404], ['ownerA', 201]])(
    'POST invitations %s → %i',
    async (actor, status) => {
      const email = `invite-${actor}-${Date.now()}@example.com`
      const res = await team(actor, 'POST', '/invitations', { email })
      expect(res.status).toBe(status)
      if (status === 201) {
        expect(res.body.inviteUrl).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/)
        expect(res.body.invitation).toMatchObject({ email, expired: false })
      }
      else {
        const listed = await team('ownerA', 'GET')
        expect((listed.body.invitations as { email: string }[]).map(i => i.email)).not.toContain(email)
      }
    },
  )

  it.each(['', 'not-an-email', 'a@'])('POST invitations rejects email %j → 400', async (email) => {
    expect(await team('ownerA', 'POST', '/invitations', { email })).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
  })

  it('PATCH member: staff → 403, other tenant → 404, owner disables then re-enables (and access follows immediately)', async () => {
    const victim = await addStaff({ id: ids.storeA1, orgId: ids.orgA })
    const victimToken = await auth.sign({ sub: victim.userId, email: victim.email })
    const patch = (actor: Actor, status: string) => team(actor, 'PATCH', `/${victim.userId}`, { status })

    expect((await patch('staffA1', 'DISABLED')).status).toBe(403)
    expect((await patch('staffA2', 'DISABLED')).status).toBe(404)
    expect((await patch('ownerB', 'DISABLED')).status).toBe(404)
    expect((await call('GET', `/api/stores/${ids.storeA1}`, victimToken)).status).toBe(200)

    expect(await patch('ownerA', 'DISABLED')).toMatchObject({ status: 200, body: { ok: true } })
    expect(await call('GET', `/api/stores/${ids.storeA1}`, victimToken)).toMatchObject({ status: 404 })
    expect(await patch('ownerA', 'ACTIVE')).toMatchObject({ status: 200 })
    expect((await call('GET', `/api/stores/${ids.storeA1}`, victimToken)).status).toBe(200)
  })

  it('PATCH an unknown member → 404; invalid status → 400', async () => {
    expect(await team('ownerA', 'PATCH', `/user_${randomUUID()}`, { status: 'DISABLED' })).toMatchObject({ status: 404 })
    expect(await team('ownerA', 'PATCH', `/${randomUUID()}`, { status: 'BOGUS' })).toMatchObject({ status: 400 })
  })

  it('DELETE invitation: staff → 403, other tenant → 404, owner → 200, repeat → 404', async () => {
    const created = await team('ownerA', 'POST', '/invitations', { email: `revoke-${Date.now()}@example.com` })
    const id = created.body.invitation.id as string
    expect((await team('staffA1', 'DELETE', `/invitations/${id}`)).status).toBe(403)
    expect((await team('ownerB', 'DELETE', `/invitations/${id}`)).status).toBe(404)
    expect((await team('ownerA', 'DELETE', `/invitations/${id}`)).status).toBe(200)
    expect((await team('ownerA', 'DELETE', `/invitations/${id}`)).status).toBe(404)
    expect((await team('ownerA', 'DELETE', '/invitations/not-a-uuid')).status).toBe(404)
  })
})
```

Run: `npm run test:api -- tests/api/tenant-isolation.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add server/utils/env.ts shared/schemas/team.ts shared/types/team.ts server/services/identity/team.ts "server/api/stores/[storeId]/team" tests/unit/server/owner-env.test.ts tests/unit/shared/team-schemas.test.ts tests/integration/team.test.ts tests/api/tenant-isolation.test.ts
git commit -m "feat(owner): add staff invitations and team management API" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 7: Nhận lời mời — `/api/invitations/:token` (xem trước + chấp nhận), claim `emailVerified`

**Files:**
- Create: `shared/email.ts`, `server/utils/redact-path.ts`, `server/services/identity/invitations.ts`, `server/api/invitations/[token]/index.get.ts`, `server/api/invitations/[token]/accept.post.ts`, `tests/unit/shared/email.test.ts`, `tests/unit/server/redact-path.test.ts`, `tests/unit/server/auth/jwt-email-verified.test.ts`, `tests/integration/invitations.test.ts`
- Modify: `server/auth/jwt.ts`, `server/utils/api-handler.ts`, `tests/support/auth.ts`, `tests/api/tenant-isolation.test.ts`

**Interfaces:**
- Consumes: `ensureProfile` (PR1, phải gọi **trong cùng transaction**, quy ước xuyên PR #7), `hashToken`, `storeInvitations`, `storeMembers`, `stores`, `organizations`, `requireUser`, `inviteRequiresVerifiedEmail` (Task 6), `InvitationPreview`, `AcceptInvitationResult`.
- Produces:
  - `VerifiedUser.emailVerified?: boolean` (đọc claim `emailVerified` hoặc `email_verified === true`; vắng mặt = chưa xác minh)
  - `maskEmail(email: string): string` (`shared/email.ts`)
  - `redactPath(path: string): string` (`server/utils/redact-path.ts`; che token trong `/api/invitations/<token>…` và `/invite/<token>`, dùng sau `safePath` của PR3 trong log lỗi của `api-handler.ts`)
  - `previewInvitation(db: DbOrTx, user: VerifiedUser, token: string): Promise<InvitationPreview>`
  - `acceptInvitation(db: Db, user: VerifiedUser, token: string, opts: { requireVerifiedEmail: boolean }): Promise<AcceptInvitationResult>`
  - `GET /api/invitations/:token` (đã đăng nhập) → `InvitationPreview`; `POST /api/invitations/:token/accept` (đã đăng nhập) → `AcceptInvitationResult`; cả hai `no-store`
  - Test helper: `auth.sign({ …, emailVerified?: boolean })`

**Quyết định về `emailVerified` (quy ước xuyên PR #7):** nhận lời mời yêu cầu **email khớp (không phân biệt hoa thường) và email đã xác minh**, được điều khiển bởi `INVITE_REQUIRE_VERIFIED_EMAIL` (mặc định bật; chỉ `false` mới tắt). Lý do: link lời mời là bí mật thứ nhất, email khớp là lớp thứ hai chống link bị chuyển tiếp; nếu không bắt xác minh thì ai nhặt được link và biết email người nhận chỉ cần đăng ký tài khoản bằng email đó. Dev/E2E dùng Neon Auth không bắt xác minh nên đặt `INVITE_REQUIRE_VERIFIED_EMAIL=false` trong `.env`/`.env.test` (file không commit). **Trước go-live (PR7 checklist): bật email verification trong Neon Auth rồi mới dùng mặc định bật ở production.** Lỗi: `FORBIDDEN` với `details.reason` là `EMAIL_MISMATCH` hoặc `EMAIL_NOT_VERIFIED`; người sai **không làm hỏng** lời mời (transaction rollback, `accepted_at` vẫn null). Mọi trường hợp token sai/hết hạn/đã dùng/store hoặc org bị tạm ngưng đều là 404 `NOT_FOUND` đồng nhất.

- [ ] **Step 1: Viết unit test thất bại**

`tests/unit/shared/email.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { maskEmail } from '../../../shared/email'

describe('maskEmail', () => {
  it.each([
    ['staff@example.com', 's***@example.com'],
    ['a@b.vn', 'a***@b.vn'],
    ['Nhan.Vien@Gmail.com', 'N***@Gmail.com'],
    ['no-at-sign', '***'],
    ['', '***'],
  ])('%j → %j', (input, expected) => {
    expect(maskEmail(input)).toBe(expected)
  })
})
```

`tests/unit/server/redact-path.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { redactPath } from '../../../server/utils/redact-path'
import { safePath } from '../../../server/utils/safe-path'

describe('redactPath (invitation tokens)', () => {
  it.each([
    ['/api/invitations/abc123_-XYZ', '/api/invitations/[REDACTED]'],
    ['/api/invitations/abc123_-XYZ/accept', '/api/invitations/[REDACTED]/accept'],
    ['/invite/abc123', '/invite/[REDACTED]'],
    ['/api/stores/11111111-1111-4111-8111-111111111111/team/invitations', '/api/stores/11111111-1111-4111-8111-111111111111/team/invitations'],
    ['/api/public/stores/quan-a/orders', '/api/public/stores/quan-a/orders'],
  ])('%s → %s', (input, expected) => {
    expect(redactPath(input)).toBe(expected)
  })

  it('composes with safePath (PR3): query dropped, order token and invitation token both hidden', () => {
    expect(redactPath(safePath('/api/invitations/abc123_-XYZ/accept?x=1'))).toBe('/api/invitations/[REDACTED]/accept')
    expect(redactPath(safePath('/api/public/orders/tok-en_1'))).toBe('/api/public/orders/[REDACTED]')
  })
})
```

`tests/unit/server/auth/jwt-email-verified.test.ts`:

```ts
import { createLocalJWKSet } from 'jose'
import { describe, expect, it } from 'vitest'
import { createJwtVerifier } from '../../../../server/auth/jwt'
import { TEST_ISSUER, createTestAuth } from '../../../support/auth'

const auth = await createTestAuth()
const verify = createJwtVerifier({ jwks: createLocalJWKSet(JSON.parse(auth.jwksJson)), issuer: TEST_ISSUER })

describe('emailVerified claim', () => {
  it('is true only when the token says so', async () => {
    expect(await verify(await auth.sign({ sub: 'u1', email: 'a@example.com', emailVerified: true }))).toMatchObject({ emailVerified: true })
    expect((await verify(await auth.sign({ sub: 'u2', email: 'a@example.com', emailVerified: false }))).emailVerified).toBeUndefined()
    expect((await verify(await auth.sign({ sub: 'u3', email: 'a@example.com' }))).emailVerified).toBeUndefined()
  })
})
```

Run: `npx vitest run --project unit tests/unit/shared/email.test.ts tests/unit/server/redact-path.test.ts tests/unit/server/auth/jwt-email-verified.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement helper thuần, claim, test signer, redact**

`shared/email.ts`:

```ts
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@')
  if (!local || !domain) return '***'
  return `${local.slice(0, 1)}***@${domain}`
}
```

`server/utils/redact-path.ts` (bổ sung cho `safePath` của PR3, che token lời mời; PR7 gộp hai hàm thành `sanitizePath = redactPath(safePath(raw))`):

```ts
const INVITATION_PATHS = /^(\/(?:api\/invitations|invite)\/)[^/?#]+/

export function redactPath(path: string): string {
  return path.replace(INVITATION_PATHS, '$1[REDACTED]')
}
```

`server/utils/api-handler.ts`: thêm `import { redactPath } from './redact-path'` và đổi `path: safePath(event.path),` (PR3 đã đặt) thành `path: redactPath(safePath(event.path)),`.

`server/auth/jwt.ts`: sửa interface và giá trị trả về:

```ts
export interface VerifiedUser {
  userId: string
  email: string | null
  name: string | null
  emailVerified?: boolean
}
```

```ts
      return {
        userId: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : null,
        name: typeof payload.name === 'string' ? payload.name : null,
        // Chỉ thêm khi true để các nơi so sánh toEqual hiện có không đổi; vắng mặt nghĩa là chưa xác minh.
        ...(payload.emailVerified === true || payload.email_verified === true ? { emailVerified: true } : {}),
      }
```

`tests/support/auth.ts`: thêm `emailVerified?: boolean` vào kiểu tham số của `sign`, và đổi `new SignJWT({ email: claims.email, name: claims.name })` thành `new SignJWT({ email: claims.email, name: claims.name, emailVerified: claims.emailVerified })`.

Run lại bước 1 và `npx vitest run --project unit tests/unit/server/auth`. Expected: PASS (các test jwt cũ vẫn xanh vì `emailVerified` chỉ xuất hiện khi true).

- [ ] **Step 3: Viết integration test thất bại cho nhận lời mời**

`tests/integration/invitations.test.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { VerifiedUser } from '../../server/auth/jwt'
import { closeDb, getDb } from '../../server/db/client'
import { storeInvitations, storeMembers, stores, userProfiles } from '../../server/db/schema'
import { findStoreAccess } from '../../server/repositories/membership'
import { acceptInvitation, previewInvitation } from '../../server/services/identity/invitations'
import { resetDb } from '../support/db'
import { addStaff, createStore, createTenant, createUser } from '../support/fixtures'
import { createInvitationRow } from '../support/order-fixtures'

const STRICT = { requireVerifiedEmail: true }
const verified = (userId: string, email: string): VerifiedUser => ({ userId, email, name: 'Nhân viên', emailVerified: true })
const membersOf = (storeId: string) => getDb().select().from(storeMembers).where(eq(storeMembers.storeId, storeId))
const invitationOf = async (id: string) => (await getDb().select().from(storeInvitations).where(eq(storeInvitations.id, id)))[0]!

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('acceptInvitation', () => {
  it('creates profile + membership in one transaction and marks the invitation used', async () => {
    const a = await createTenant('acc')
    const { token, row } = await createInvitationRow(a.store, { email: 'moi@example.com', createdBy: a.owner.userId })
    const userId = `user_${randomUUID()}` // chưa có user_profiles
    const result = await acceptInvitation(getDb(), verified(userId, 'Moi@Example.COM'), token, STRICT)

    expect(result.store).toMatchObject({ id: a.store.id, orgId: a.org.id, name: a.store.name, slug: a.store.slug, role: 'STAFF' })
    expect(await findStoreAccess(getDb(), userId, a.store.id)).toMatchObject({ role: 'STAFF' })
    const [profile] = await getDb().select().from(userProfiles).where(eq(userProfiles.userId, userId))
    expect(profile).toMatchObject({ email: 'moi@example.com' })
    expect(await invitationOf(row.id)).toMatchObject({ acceptedBy: userId })
    expect((await invitationOf(row.id)).acceptedAt).toBeInstanceOf(Date)
  })

  it('email mismatch → FORBIDDEN, rolls everything back, and does NOT burn the token', async () => {
    const a = await createTenant('mismatch')
    const { token, row } = await createInvitationRow(a.store, { email: 'dung@example.com', createdBy: a.owner.userId })
    const intruderId = `user_${randomUUID()}`

    await expect(acceptInvitation(getDb(), verified(intruderId, 'sai@example.com'), token, STRICT))
      .rejects.toMatchObject({ code: 'FORBIDDEN', details: { reason: 'EMAIL_MISMATCH' } })
    expect(await getDb().select().from(userProfiles).where(eq(userProfiles.userId, intruderId))).toHaveLength(0)
    expect(await membersOf(a.store.id)).toHaveLength(0)
    expect((await invitationOf(row.id)).acceptedAt).toBeNull()

    const rightId = `user_${randomUUID()}`
    await expect(acceptInvitation(getDb(), verified(rightId, 'dung@example.com'), token, STRICT)).resolves.toBeTruthy()
  })

  it('requires a verified email unless the flag is off', async () => {
    const a = await createTenant('verify')
    const { token, row } = await createInvitationRow(a.store, { email: 'chua@example.com', createdBy: a.owner.userId })
    const userId = `user_${randomUUID()}`
    const unverified: VerifiedUser = { userId, email: 'chua@example.com', name: null }

    await expect(acceptInvitation(getDb(), unverified, token, STRICT))
      .rejects.toMatchObject({ code: 'FORBIDDEN', details: { reason: 'EMAIL_NOT_VERIFIED' } })
    expect((await invitationOf(row.id)).acceptedAt).toBeNull()
    await expect(acceptInvitation(getDb(), unverified, token, { requireVerifiedEmail: false })).resolves.toBeTruthy()
  })

  it.each([
    ['unknown token', 'x'.repeat(43)],
    ['garbage token', 'abc'],
  ])('%s → NOT_FOUND', async (_label, token) => {
    await createTenant('nf')
    await expect(acceptInvitation(getDb(), verified('u1', 'a@example.com'), token, STRICT)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('expired and already-used invitations → NOT_FOUND', async () => {
    const a = await createTenant('dead')
    const expired = await createInvitationRow(a.store, { email: 'e@example.com', createdBy: a.owner.userId, expiresAt: new Date(Date.now() - 1000) })
    const used = await createInvitationRow(a.store, { email: 'u@example.com', createdBy: a.owner.userId, acceptedAt: new Date() })
    await expect(acceptInvitation(getDb(), verified('u-e', 'e@example.com'), expired.token, STRICT)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(acceptInvitation(getDb(), verified('u-u', 'u@example.com'), used.token, STRICT)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await membersOf(a.store.id)).toHaveLength(0)
  })

  it('is single-use under concurrency: 4 simultaneous accepts → 1 success, 1 membership', async () => {
    const a = await createTenant('par')
    const { token } = await createInvitationRow(a.store, { email: 'par@example.com', createdBy: a.owner.userId })
    const user = verified(`user_${randomUUID()}`, 'par@example.com')
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => acceptInvitation(getDb(), user, token, STRICT)))
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason).toMatchObject({ code: 'NOT_FOUND' })
    }
    expect(await membersOf(a.store.id)).toHaveLength(1)
  })

  it('re-activates a previously disabled member', async () => {
    const a = await createTenant('react')
    const disabled = await addStaff(a.store, { status: 'DISABLED' })
    const { token } = await createInvitationRow(a.store, { email: disabled.email, createdBy: a.owner.userId })
    await acceptInvitation(getDb(), verified(disabled.userId, disabled.email), token, STRICT)
    expect(await findStoreAccess(getDb(), disabled.userId, a.store.id)).toMatchObject({ role: 'STAFF' })
    expect(await membersOf(a.store.id)).toHaveLength(1)
  })

  it('a suspended store or org makes the invitation NOT_FOUND', async () => {
    const a = await createTenant('susp')
    const { token } = await createInvitationRow(a.store, { email: 's@example.com', createdBy: a.owner.userId })
    await getDb().update(stores).set({ status: 'SUSPENDED' }).where(eq(stores.id, a.store.id))
    await expect(acceptInvitation(getDb(), verified('u-s', 's@example.com'), token, STRICT)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('does not hand out access to another store of the same org', async () => {
    const a = await createTenant('scope')
    const invitee = await createUser({ email: 'scope@example.com' })
    const { token } = await createInvitationRow(a.store, { email: invitee.email, createdBy: a.owner.userId })
    await acceptInvitation(getDb(), verified(invitee.userId, invitee.email), token, STRICT)
    const other = await createStore(a.org.id, 'other')
    expect(await findStoreAccess(getDb(), invitee.userId, other.id)).toBeNull()
  })
})

describe('previewInvitation', () => {
  it('shows the store, a masked email and whether the caller matches', async () => {
    const a = await createTenant('prev')
    const { token } = await createInvitationRow(a.store, { email: 'nhanvien@example.com', createdBy: a.owner.userId })
    const match = await previewInvitation(getDb(), verified('u1', 'NhanVien@example.com'), token)
    expect(match).toMatchObject({ storeName: a.store.name, role: 'STAFF', emailHint: 'n***@example.com', emailMatches: true, emailVerified: true })
    const mismatch = await previewInvitation(getDb(), { userId: 'u2', email: 'khac@example.com', name: null }, token)
    expect(mismatch).toMatchObject({ emailMatches: false, emailVerified: false })
    expect(JSON.stringify(mismatch)).not.toContain('nhanvien@example.com')
  })

  it('NOT_FOUND for unknown, expired and used tokens', async () => {
    const a = await createTenant('prev-nf')
    const expired = await createInvitationRow(a.store, { email: 'e@example.com', createdBy: a.owner.userId, expiresAt: new Date(Date.now() - 1000) })
    const used = await createInvitationRow(a.store, { email: 'u@example.com', createdBy: a.owner.userId, acceptedAt: new Date() })
    for (const token of ['x'.repeat(43), expired.token, used.token]) {
      await expect(previewInvitation(getDb(), verified('u', 'e@example.com'), token)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    }
  })
})
```

Run: `npx vitest run --project integration tests/integration/invitations.test.ts`
Expected: FAIL (module chưa có).

- [ ] **Step 4: Implement `server/services/identity/invitations.ts`**

```ts
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { maskEmail } from '#shared/email'
import type { AcceptInvitationResult, InvitationPreview } from '#shared/types/team'
import type { VerifiedUser } from '../../auth/jwt'
import type { Db, DbOrTx } from '../../db/client'
import { organizations, storeInvitations, storeMembers, stores } from '../../db/schema'
import { AppError } from '../../utils/errors'
import { hashToken } from '../../utils/tokens'
import { ensureProfile } from './profile'

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/
const notFound = () => new AppError('NOT_FOUND', 'Lời mời không còn hiệu lực')

const openInvitation = (token: string) => and(
  eq(storeInvitations.tokenHash, hashToken(token)),
  isNull(storeInvitations.acceptedAt),
  gt(storeInvitations.expiresAt, sql`now()`),
  eq(stores.status, 'ACTIVE'),
  eq(organizations.status, 'ACTIVE'),
)

const invitationColumns = {
  id: storeInvitations.id,
  orgId: storeInvitations.orgId,
  storeId: storeInvitations.storeId,
  email: storeInvitations.email,
  role: storeInvitations.role,
  expiresAt: storeInvitations.expiresAt,
  storeName: stores.name,
  storeSlug: stores.slug,
  isAcceptingOrders: stores.isAcceptingOrders,
}

export async function previewInvitation(db: DbOrTx, user: VerifiedUser, token: string): Promise<InvitationPreview> {
  if (!TOKEN_SHAPE.test(token)) throw notFound()
  const [inv] = await db
    .select(invitationColumns)
    .from(storeInvitations)
    .innerJoin(stores, and(eq(stores.id, storeInvitations.storeId), eq(stores.orgId, storeInvitations.orgId)))
    .innerJoin(organizations, eq(organizations.id, storeInvitations.orgId))
    .where(openInvitation(token))
    .limit(1)
  if (!inv) throw notFound()
  return {
    storeName: inv.storeName,
    role: inv.role,
    emailHint: maskEmail(inv.email),
    expiresAt: inv.expiresAt.toISOString(),
    emailMatches: user.email?.trim().toLowerCase() === inv.email,
    emailVerified: user.emailVerified === true,
  }
}

export async function acceptInvitation(
  db: Db,
  user: VerifiedUser,
  token: string,
  opts: { requireVerifiedEmail: boolean },
): Promise<AcceptInvitationResult> {
  if (!TOKEN_SHAPE.test(token)) throw notFound()
  return db.transaction(async (tx) => {
    // Quy ước xuyên PR #7: mọi luồng tạo membership đều ensureProfile trong cùng transaction.
    const profile = await ensureProfile(tx, user)

    const [inv] = await tx
      .select(invitationColumns)
      .from(storeInvitations)
      .innerJoin(stores, and(eq(stores.id, storeInvitations.storeId), eq(stores.orgId, storeInvitations.orgId)))
      .innerJoin(organizations, eq(organizations.id, storeInvitations.orgId))
      .where(openInvitation(token))
      .limit(1)
      // Khóa dòng lời mời: hai accept đồng thời xếp hàng, người sau thấy accepted_at đã có và nhận 404.
      .for('update', { of: storeInvitations })
    if (!inv) throw notFound()

    if (profile.email !== inv.email) {
      throw new AppError('FORBIDDEN', 'Email của bạn không khớp với lời mời', { reason: 'EMAIL_MISMATCH' })
    }
    if (opts.requireVerifiedEmail && user.emailVerified !== true) {
      throw new AppError('FORBIDDEN', 'Bạn cần xác minh email trước khi tham gia', { reason: 'EMAIL_NOT_VERIFIED' })
    }

    const [existing] = await tx
      .select({ id: storeMembers.id, status: storeMembers.status })
      .from(storeMembers)
      .where(and(eq(storeMembers.storeId, inv.storeId), eq(storeMembers.userId, profile.userId)))
      .limit(1)
    if (!existing) {
      await tx.insert(storeMembers).values({ orgId: inv.orgId, storeId: inv.storeId, userId: profile.userId, role: inv.role })
    }
    else if (existing.status === 'DISABLED') {
      await tx.update(storeMembers).set({ status: 'ACTIVE', updatedAt: new Date() }).where(eq(storeMembers.id, existing.id))
    }

    await tx
      .update(storeInvitations)
      .set({ acceptedAt: new Date(), acceptedBy: profile.userId })
      .where(eq(storeInvitations.id, inv.id))

    return {
      store: {
        id: inv.storeId,
        orgId: inv.orgId,
        name: inv.storeName,
        slug: inv.storeSlug,
        role: inv.role,
        isAcceptingOrders: inv.isAcceptingOrders,
      },
    }
  })
}
```

Ghi chú khi đọc code: nếu người dùng đã là thành viên ACTIVE thì chỉ đánh dấu lời mời đã dùng (idempotent), không đổi role.

- [ ] **Step 5: Implement route handlers**

`server/api/invitations/[token]/index.get.ts`:

```ts
import { getRouterParam, setHeader } from 'h3'
import { requireUser } from '../../../auth/require-user'
import { getDb } from '../../../db/client'
import { previewInvitation } from '../../../services/identity/invitations'
import { defineApiHandler } from '../../../utils/api-handler'

export default defineApiHandler(async (event) => {
  const user = await requireUser(event)
  setHeader(event, 'Cache-Control', 'no-store')
  return previewInvitation(getDb(), user, getRouterParam(event, 'token') ?? '')
})
```

`server/api/invitations/[token]/accept.post.ts`:

```ts
import { getRouterParam, setHeader } from 'h3'
import { requireUser } from '../../../auth/require-user'
import { getDb } from '../../../db/client'
import { acceptInvitation } from '../../../services/identity/invitations'
import { defineApiHandler } from '../../../utils/api-handler'
import { inviteRequiresVerifiedEmail } from '../../../utils/env'

export default defineApiHandler(async (event) => {
  const user = await requireUser(event)
  setHeader(event, 'Cache-Control', 'no-store')
  return acceptInvitation(getDb(), user, getRouterParam(event, 'token') ?? '', { requireVerifiedEmail: inviteRequiresVerifiedEmail() })
})
```

- [ ] **Step 6: Chạy integration test, xác nhận PASS**

Run: `npx vitest run --project integration tests/integration/invitations.test.ts`
Expected: PASS (12 test); chạy lặp 3 lần cho test đồng thời.

- [ ] **Step 7: Ma trận tenant cho luồng mời (qua HTTP)**

Trong `tests/api/tenant-isolation.test.ts`, ngay sau dòng `process.env.AUTH_TEST_JWKS = auth.jwksJson` thêm:

```ts
// Mặc định production: bắt buộc email đã xác minh khi nhận lời mời (spec quy ước xuyên PR #7).
process.env.INVITE_REQUIRE_VERIFIED_EMAIL = 'true'
```

Cuối file thêm:

```ts
describe('invitations (accept flow)', () => {
  async function invite(email: string): Promise<string> {
    const res = await call('POST', `/api/stores/${ids.storeA1}/team/invitations`, tokens.ownerA, { email })
    expect(res.status).toBe(201)
    return (res.body.inviteUrl as string).split('/').pop()!
  }
  const sign = (user: { userId: string, email: string }, emailVerified: boolean) => auth.sign({ sub: user.userId, email: user.email, emailVerified })

  it('GET/POST without a login → 401', async () => {
    const token = await invite(`anon-${Date.now()}@example.com`)
    expect((await call('GET', `/api/invitations/${token}`, null)).status).toBe(401)
    expect((await call('POST', `/api/invitations/${token}/accept`, null)).status).toBe(401)
  })

  it('unknown or malformed token → 404', async () => {
    expect(await call('GET', '/api/invitations/nope', tokens.ownerB)).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
    expect(await call('POST', `/api/invitations/${'z'.repeat(43)}/accept`, tokens.ownerB)).toMatchObject({ status: 404 })
  })

  it('wrong email → 403 without burning the token; right + verified email → 200; reuse → 404', async () => {
    const email = `flow-${Date.now()}@example.com`
    const token = await invite(email)
    const stranger = await createUser()
    const invitee = await createUser({ email })

    expect(await call('GET', `/api/invitations/${token}`, await sign(stranger, true))).toMatchObject({
      status: 200,
      body: { emailMatches: false, storeName: expect.any(String) },
    })
    expect(await call('POST', `/api/invitations/${token}/accept`, await sign(stranger, true))).toMatchObject({
      status: 403,
      body: { code: 'FORBIDDEN', details: { reason: 'EMAIL_MISMATCH' } },
    })
    expect(await call('POST', `/api/invitations/${token}/accept`, await sign(invitee, false))).toMatchObject({
      status: 403,
      body: { details: { reason: 'EMAIL_NOT_VERIFIED' } },
    })

    const inviteeToken = await sign(invitee, true)
    expect(await call('GET', `/api/stores/${ids.storeA1}`, inviteeToken)).toMatchObject({ status: 404 })
    const ok = await call('POST', `/api/invitations/${token}/accept`, inviteeToken)
    expect(ok).toMatchObject({ status: 200, body: { store: { id: ids.storeA1, role: 'STAFF' } } })
    expect(await call('GET', `/api/stores/${ids.storeA1}`, inviteeToken)).toMatchObject({ status: 200, body: { role: 'STAFF' } })
    expect(await call('GET', `/api/stores/${ids.storeA2}`, inviteeToken)).toMatchObject({ status: 404 })
    expect(await call('POST', `/api/invitations/${token}/accept`, inviteeToken)).toMatchObject({ status: 404 })
  })

  it('an invitation never exposes the full email to a non-matching caller', async () => {
    const email = `hint-${Date.now()}@example.com`
    const token = await invite(email)
    const res = await call('GET', `/api/invitations/${token}`, tokens.ownerB)
    expect(res.status).toBe(200)
    expect(JSON.stringify(res.body)).not.toContain(email)
    expect(res.body.emailHint).toMatch(/^h\*\*\*@example\.com$/)
  })
})
```

Run: `npm run test:api -- tests/api/tenant-isolation.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add shared/email.ts server/utils/redact-path.ts server/utils/api-handler.ts server/auth/jwt.ts server/services/identity/invitations.ts server/api/invitations tests/support/auth.ts tests/unit tests/integration/invitations.test.ts tests/api/tenant-isolation.test.ts
git commit -m "feat(owner): add invitation preview and accept flow with email match" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 8: Báo cáo — `summary` theo ngày và `reports` 7/30 ngày (giờ Việt Nam)

**Files:**
- Create: `shared/vn-date.ts`, `shared/schemas/reports.ts`, `shared/types/reports.ts`, `server/repositories/reporting.ts`, `server/services/reporting/summary.ts`, `server/services/reporting/reports.ts`, `server/api/stores/[storeId]/summary.get.ts`, `server/api/stores/[storeId]/reports.get.ts`, `tests/unit/shared/vn-date.test.ts`, `tests/integration/reporting.test.ts`
- Modify: `tests/api/tenant-isolation.test.ts`

**Interfaces:**
- Consumes: `orders`, `orderItems` (PR3), `orderPayments` (Task 1), `requireStoreStaff`, `requireStoreOwner`.
- Produces:
  - `REPORT_TZ = 'Asia/Ho_Chi_Minh'`, `isValidDateString(value: string): boolean`, `toVnDate(instant: Date): string` (`YYYY-MM-DD` giờ VN), `addDays(date: string, days: number): string`, `vnDayRange(date: string): { from: Date; to: Date }` (nửa mở `[from, to)`), `REPORT_RANGES = ['today','7d','30d']`, `type ReportRange`, `reportWindow(range: ReportRange, now: Date): { fromDate: string; toDate: string; from: Date; to: Date }`, `eachDate(fromDate: string, toDate: string): string[]`
  - `summaryQuerySchema` (`{ date?: 'YYYY-MM-DD' }`), `reportQuerySchema` (`{ range: ReportRange /* mặc định 'today' */ }`)
  - Kiểu `PaymentBreakdown`, `DailySummary`, `TopProduct`, `DayPoint`, `Report`
  - `getDailySummary(db: DbOrTx, ctx: StoreContext, date?: string, now?: Date): Promise<DailySummary>` — `{ date, totalOrders, completedCount, cancelledCount, grossVnd /* không tính CANCELLED */, collected: { SEPAY, CASH, BANK_MANUAL }, collectedVnd, outstandingVnd, refundDueVnd }`
  - `getReport(db: DbOrTx, ctx: StoreContext, range: ReportRange, now?: Date): Promise<Report>` — `{ range, fromDate, toDate, orderCount /* không hủy */, cancelledCount, grossVnd, collectedVnd, averageOrderVnd, topProducts[≤5], daily[] /* đủ mọi ngày, ngày trống = 0 */ }`
  - `GET /api/stores/:storeId/summary?date=YYYY-MM-DD` (staff + owner) → `DailySummary`; `GET /api/stores/:storeId/reports?range=today|7d|30d` (owner) → `Report`; cả hai `no-store`

Định nghĩa chốt: đơn thuộc ngày D khi `created_at ∈ [D 00:00 +07, D+1 00:00 +07)`; so khớp bằng khoảng thời gian (dùng được index) thay vì cast từng dòng, và nhóm theo ngày bằng `to_char(created_at at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')` (không có DST nên hai cách khớp nhau — test khẳng định). "Đã thu" = tổng `order_payments` của các đơn chưa hủy trong khoảng; "còn chưa thu" = giá trị đơn − đã thu (≥ 0); "cần hoàn" = payment của đơn hủy có `payment_status = REFUND_DUE` (tiền không biến mất khỏi báo cáo).

- [ ] **Step 1: Viết unit test thất bại cho `vn-date`**

`tests/unit/shared/vn-date.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { addDays, eachDate, isValidDateString, reportWindow, toVnDate, vnDayRange } from '../../../shared/vn-date'

describe('toVnDate', () => {
  it.each([
    ['2026-10-30T16:59:59.999Z', '2026-10-30'],
    ['2026-10-30T17:00:00.000Z', '2026-10-31'],
    ['2026-10-30T16:30:00Z', '2026-10-30'], // 23:30 giờ VN
    ['2026-10-30T17:30:00Z', '2026-10-31'], // 00:30 giờ VN
    ['2026-12-31T17:00:00Z', '2027-01-01'],
  ])('%s → %s', (iso, expected) => {
    expect(toVnDate(new Date(iso))).toBe(expected)
  })
})

describe('vnDayRange', () => {
  it('is [00:00 +07, next 00:00 +07) in UTC', () => {
    const { from, to } = vnDayRange('2026-10-31')
    expect(from.toISOString()).toBe('2026-10-30T17:00:00.000Z')
    expect(to.toISOString()).toBe('2026-10-31T17:00:00.000Z')
  })

  it('handles month and year ends', () => {
    expect(vnDayRange('2026-12-31').to.toISOString()).toBe('2026-12-31T17:00:00.000Z')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('isValidDateString', () => {
  it.each([
    ['2026-10-31', true],
    ['2028-02-29', true],
    ['2026-02-29', false],
    ['2026-13-01', false],
    ['2026-1-1', false],
    ['31/10/2026', false],
    ['', false],
  ])('%j → %s', (value, expected) => {
    expect(isValidDateString(value)).toBe(expected)
  })
})

describe('reportWindow', () => {
  const now = new Date('2026-10-31T05:00:00Z') // 12:00 giờ VN
  it.each([
    ['today', '2026-10-31', 1],
    ['7d', '2026-10-25', 7],
    ['30d', '2026-10-02', 30],
  ] as const)('%s starts %s and spans %i days', (range, fromDate, days) => {
    const window = reportWindow(range, now)
    expect(window).toMatchObject({ fromDate, toDate: '2026-10-31' })
    expect(eachDate(window.fromDate, window.toDate)).toHaveLength(days)
    expect(window.from.toISOString()).toBe(vnDayRange(fromDate).from.toISOString())
    expect(window.to.toISOString()).toBe('2026-10-31T17:00:00.000Z')
  })

  it('uses the Vietnam date even when UTC is still the previous day', () => {
    expect(reportWindow('today', new Date('2026-10-30T18:00:00Z')).toDate).toBe('2026-10-31')
  })
})
```

Run: `npx vitest run --project unit tests/unit/shared/vn-date.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement `shared/vn-date.ts`, schema, kiểu**

`shared/vn-date.ts`:

```ts
export const REPORT_TZ = 'Asia/Ho_Chi_Minh'
// Việt Nam là UTC+7 quanh năm, không có DST.
const VN_OFFSET_MS = 7 * 60 * 60 * 1000
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function isValidDateString(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function toVnDate(instant: Date): string {
  return new Date(instant.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10)
}

export function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

export function vnDayRange(date: string): { from: Date, to: Date } {
  return { from: new Date(`${date}T00:00:00+07:00`), to: new Date(`${addDays(date, 1)}T00:00:00+07:00`) }
}

export const REPORT_RANGES = ['today', '7d', '30d'] as const
export type ReportRange = (typeof REPORT_RANGES)[number]

const SPAN_DAYS: Record<ReportRange, number> = { today: 1, '7d': 7, '30d': 30 }

export function reportWindow(range: ReportRange, now: Date): { fromDate: string, toDate: string, from: Date, to: Date } {
  const toDate = toVnDate(now)
  const fromDate = addDays(toDate, -(SPAN_DAYS[range] - 1))
  return { fromDate, toDate, from: vnDayRange(fromDate).from, to: vnDayRange(toDate).to }
}

export function eachDate(fromDate: string, toDate: string): string[] {
  const dates: string[] = []
  for (let date = fromDate; date <= toDate; date = addDays(date, 1)) dates.push(date)
  return dates
}
```

`shared/schemas/reports.ts`:

```ts
import { z } from 'zod'
import { REPORT_RANGES, isValidDateString } from '../vn-date'

export const summaryQuerySchema = z.object({
  date: z.string().refine(isValidDateString, 'Ngày không hợp lệ, dùng YYYY-MM-DD').optional(),
})

export const reportQuerySchema = z.object({
  range: z.enum(REPORT_RANGES).default('today'),
})
```

`shared/types/reports.ts`:

```ts
import type { ReportRange } from '../vn-date'

export interface PaymentBreakdown {
  SEPAY: number
  CASH: number
  BANK_MANUAL: number
}

export interface DailySummary {
  date: string
  totalOrders: number
  completedCount: number
  cancelledCount: number
  grossVnd: number
  collected: PaymentBreakdown
  collectedVnd: number
  outstandingVnd: number
  refundDueVnd: number
}

export interface TopProduct {
  name: string
  qty: number
  revenueVnd: number
}

export interface DayPoint {
  date: string
  orderCount: number
  grossVnd: number
  collectedVnd: number
}

export interface Report {
  range: ReportRange
  fromDate: string
  toDate: string
  orderCount: number
  cancelledCount: number
  grossVnd: number
  collectedVnd: number
  averageOrderVnd: number
  topProducts: TopProduct[]
  daily: DayPoint[]
}
```

Run lại bước 1. Expected: PASS.

- [ ] **Step 3: Viết integration test thất bại cho báo cáo**

`tests/integration/reporting.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { StoreContext } from '../../server/auth/guards'
import { closeDb, getDb } from '../../server/db/client'
import { getReport } from '../../server/services/reporting/reports'
import { getDailySummary } from '../../server/services/reporting/summary'
import { resetDb } from '../support/db'
import { createTenant } from '../support/fixtures'
import { createOrderItem, createOrderRow, createPaymentRow } from '../support/order-fixtures'

type Tenant = Awaited<ReturnType<typeof createTenant>>
const ctxOf = (t: Tenant): StoreContext => ({ orgId: t.org.id, storeId: t.store.id, role: 'OWNER', userId: t.owner.userId })
const at = (iso: string) => new Date(iso)

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('getDailySummary — Vietnam day boundaries', () => {
  it('puts 23:30, 00:00 sharp, 00:30 and 23:59:59.999 on the right VN day', async () => {
    const a = await createTenant('tz')
    await createOrderRow(a.store, { createdAt: at('2026-10-30T16:30:00.000Z') }) // 23:30 ngày 30
    await createOrderRow(a.store, { createdAt: at('2026-10-30T17:00:00.000Z') }) // 00:00 ngày 31
    await createOrderRow(a.store, { createdAt: at('2026-10-30T17:30:00.000Z') }) // 00:30 ngày 31
    await createOrderRow(a.store, { createdAt: at('2026-10-31T16:59:59.999Z') }) // 23:59:59.999 ngày 31
    await createOrderRow(a.store, { createdAt: at('2026-10-31T17:00:00.000Z') }) // 00:00 ngày 1/11

    const total = async (date: string) => (await getDailySummary(getDb(), ctxOf(a), date)).totalOrders
    expect(await total('2026-10-30')).toBe(1)
    expect(await total('2026-10-31')).toBe(3)
    expect(await total('2026-11-01')).toBe(1)
  })

  it('defaults to today in Vietnam, not in UTC', async () => {
    const a = await createTenant('today')
    await createOrderRow(a.store, { createdAt: at('2026-10-30T17:30:00Z') })
    const summary = await getDailySummary(getDb(), ctxOf(a), undefined, at('2026-10-30T18:00:00Z'))
    expect(summary).toMatchObject({ date: '2026-10-31', totalOrders: 1 })
  })
})

describe('getDailySummary — money', () => {
  it('counts value excluding cancelled, collected from order_payments only, outstanding and refund due', async () => {
    const a = await createTenant('money')
    const day = at('2026-10-31T05:00:00Z')
    const completedCash = await createOrderRow(a.store, { status: 'COMPLETED', paymentStatus: 'PAID', totalVnd: 50_000, createdAt: day })
    await createPaymentRow(completedCash, { method: 'CASH', amountVnd: 50_000 })
    await createOrderRow(a.store, { status: 'NEW', totalVnd: 30_000, createdAt: day })
    const sepay = await createOrderRow(a.store, { status: 'NEW', paymentMethod: 'BANK_QR', paymentStatus: 'PAID', totalVnd: 40_000, createdAt: day })
    await createPaymentRow(sepay, { method: 'SEPAY', amountVnd: 40_000 })
    await createOrderRow(a.store, { status: 'CANCELLED', totalVnd: 20_000, createdAt: day })
    const refund = await createOrderRow(a.store, { status: 'CANCELLED', paymentStatus: 'REFUND_DUE', totalVnd: 25_000, createdAt: day })
    await createPaymentRow(refund, { method: 'CASH', amountVnd: 25_000 })
    // PAID nhưng không có dòng order_payments: phải tính vào giá trị đơn, KHÔNG tính vào đã thu.
    await createOrderRow(a.store, { status: 'NEW', paymentStatus: 'PAID', totalVnd: 10_000, createdAt: day })

    const summary = await getDailySummary(getDb(), ctxOf(a), '2026-10-31')
    expect(summary).toEqual({
      date: '2026-10-31',
      totalOrders: 6,
      completedCount: 1,
      cancelledCount: 2,
      grossVnd: 130_000,
      collected: { SEPAY: 40_000, CASH: 50_000, BANK_MANUAL: 0 },
      collectedVnd: 90_000,
      outstandingVnd: 40_000,
      refundDueVnd: 25_000,
    })
  })

  it('returns zeros for an empty day and ignores other stores', async () => {
    const a = await createTenant('empty')
    const b = await createTenant('empty-b')
    await createOrderRow(b.store, { createdAt: at('2026-10-31T05:00:00Z'), totalVnd: 99_000 })
    expect(await getDailySummary(getDb(), ctxOf(a), '2026-10-31')).toMatchObject({
      totalOrders: 0, grossVnd: 0, collectedVnd: 0, outstandingVnd: 0, refundDueVnd: 0,
      collected: { SEPAY: 0, CASH: 0, BANK_MANUAL: 0 },
    })
  })
})

describe('getReport', () => {
  const now = at('2026-10-31T05:00:00Z') // 12:00 giờ VN ngày 31/10
  const noon = (date: string) => at(`${date}T05:00:00Z`)

  async function seed(a: Tenant) {
    const today = await createOrderRow(a.store, { status: 'COMPLETED', paymentStatus: 'PAID', totalVnd: 100_000, createdAt: noon('2026-10-31') })
    await createPaymentRow(today, { amountVnd: 100_000 })
    await createOrderItem(today, { nameSnapshot: 'Trà đào', qty: 3, lineTotalVnd: 90_000 })
    await createOrderItem(today, { nameSnapshot: 'Cà phê', qty: 1, lineTotalVnd: 10_000 })
    const threeDays = await createOrderRow(a.store, { status: 'COMPLETED', totalVnd: 40_000, createdAt: noon('2026-10-28') })
    await createOrderItem(threeDays, { nameSnapshot: 'Trà đào', qty: 2, lineTotalVnd: 40_000 })
    const cancelled = await createOrderRow(a.store, { status: 'CANCELLED', totalVnd: 300_000, createdAt: noon('2026-10-31') })
    await createOrderItem(cancelled, { nameSnapshot: 'Trà đào', qty: 10, lineTotalVnd: 300_000 })
    await createOrderRow(a.store, { status: 'COMPLETED', totalVnd: 10_000, createdAt: noon('2026-10-25') }) // trong 7d
    await createOrderRow(a.store, { status: 'COMPLETED', totalVnd: 20_000, createdAt: noon('2026-10-24') }) // ngoài 7d
    await createOrderRow(a.store, { status: 'COMPLETED', totalVnd: 5_000, createdAt: noon('2026-10-02') }) // trong 30d
    await createOrderRow(a.store, { status: 'COMPLETED', totalVnd: 7_000, createdAt: noon('2026-10-01') }) // ngoài 30d
  }

  it('today: one order, cancelled excluded from value and top products', async () => {
    const a = await createTenant('r-today')
    await seed(a)
    const report = await getReport(getDb(), ctxOf(a), 'today', now)
    expect(report).toMatchObject({ range: 'today', fromDate: '2026-10-31', toDate: '2026-10-31', orderCount: 1, cancelledCount: 1, grossVnd: 100_000, collectedVnd: 100_000, averageOrderVnd: 100_000 })
    expect(report.topProducts).toEqual([
      { name: 'Trà đào', qty: 3, revenueVnd: 90_000 },
      { name: 'Cà phê', qty: 1, revenueVnd: 10_000 },
    ])
    expect(report.daily).toEqual([{ date: '2026-10-31', orderCount: 1, grossVnd: 100_000, collectedVnd: 100_000 }])
  })

  it('7d: includes day -6, excludes day -7, zero-fills empty days, sums top products', async () => {
    const a = await createTenant('r-7d')
    await seed(a)
    const report = await getReport(getDb(), ctxOf(a), '7d', now)
    expect(report).toMatchObject({ fromDate: '2026-10-25', toDate: '2026-10-31', orderCount: 3, cancelledCount: 1, grossVnd: 150_000, collectedVnd: 100_000, averageOrderVnd: 50_000 })
    expect(report.daily.map(d => d.date)).toEqual(['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'])
    expect(report.daily.find(d => d.date === '2026-10-26')).toEqual({ date: '2026-10-26', orderCount: 0, grossVnd: 0, collectedVnd: 0 })
    expect(report.daily.find(d => d.date === '2026-10-25')).toMatchObject({ orderCount: 1, grossVnd: 10_000 })
    expect(report.topProducts[0]).toEqual({ name: 'Trà đào', qty: 5, revenueVnd: 130_000 })
  })

  it('30d: window edges and daily length', async () => {
    const a = await createTenant('r-30d')
    await seed(a)
    const report = await getReport(getDb(), ctxOf(a), '30d', now)
    expect(report).toMatchObject({ fromDate: '2026-10-02', orderCount: 5, grossVnd: 175_000 })
    expect(report.daily).toHaveLength(30)
  })

  it('groups an order created at 00:30 VN into the new VN day (SQL grouping matches the JS window)', async () => {
    const a = await createTenant('r-edge')
    await createOrderRow(a.store, { totalVnd: 12_000, createdAt: at('2026-10-30T17:30:00Z') })
    await createOrderRow(a.store, { totalVnd: 8_000, createdAt: at('2026-10-30T16:30:00Z') })
    const report = await getReport(getDb(), ctxOf(a), '7d', now)
    expect(report.daily.find(d => d.date === '2026-10-31')).toMatchObject({ orderCount: 1, grossVnd: 12_000 })
    expect(report.daily.find(d => d.date === '2026-10-30')).toMatchObject({ orderCount: 1, grossVnd: 8_000 })
  })

  it('never includes another store\'s orders or items', async () => {
    const a = await createTenant('r-iso-a')
    const b = await createTenant('r-iso-b')
    const foreign = await createOrderRow(b.store, { totalVnd: 77_000, createdAt: noon('2026-10-31') })
    await createOrderItem(foreign, { nameSnapshot: 'Món của B', qty: 9 })
    const report = await getReport(getDb(), ctxOf(a), '30d', now)
    expect(report).toMatchObject({ orderCount: 0, grossVnd: 0, averageOrderVnd: 0, topProducts: [] })
  })
})
```

Run: `npx vitest run --project integration tests/integration/reporting.test.ts`
Expected: FAIL (service chưa có).

- [ ] **Step 4: Implement repository + services**

`server/repositories/reporting.ts`:

```ts
import { and, desc, eq, gte, lt, ne, sql } from 'drizzle-orm'
import type { DbOrTx } from '../db/client'
import { orderItems, orderPayments, orders } from '../db/schema'
import type { OrderScope } from './orders'

const inWindow = (scope: OrderScope, from: Date, to: Date) => and(
  eq(orders.orgId, scope.orgId),
  eq(orders.storeId, scope.storeId),
  gte(orders.createdAt, from),
  lt(orders.createdAt, to),
)

const joinOrders = and(eq(orders.storeId, orderPayments.storeId), eq(orders.id, orderPayments.orderId))

// Literal (không bind param) để SELECT và GROUP BY cùng một biểu thức; PG từ chối khi hai biểu thức dùng param khác nhau.
const VN_DAY = sql<string>`to_char(${orders.createdAt} at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')`

export async function orderTotals(db: DbOrTx, scope: OrderScope, from: Date, to: Date) {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      completed: sql<number>`(count(*) filter (where ${orders.status} = 'COMPLETED'))::int`,
      cancelled: sql<number>`(count(*) filter (where ${orders.status} = 'CANCELLED'))::int`,
      gross: sql<number>`coalesce(sum(${orders.totalVnd}) filter (where ${orders.status} <> 'CANCELLED'), 0)::double precision`,
    })
    .from(orders)
    .where(inWindow(scope, from, to))
  return row!
}

export async function collectedByMethod(db: DbOrTx, scope: OrderScope, from: Date, to: Date) {
  const rows = await db
    .select({ method: orderPayments.method, amount: sql<number>`coalesce(sum(${orderPayments.amountVnd}), 0)::double precision` })
    .from(orderPayments)
    .innerJoin(orders, joinOrders)
    .where(and(inWindow(scope, from, to), ne(orders.status, 'CANCELLED')))
    .groupBy(orderPayments.method)
  return Object.fromEntries(rows.map(row => [row.method, row.amount])) as Partial<Record<'SEPAY' | 'CASH' | 'BANK_MANUAL', number>>
}

export async function refundDueTotal(db: DbOrTx, scope: OrderScope, from: Date, to: Date): Promise<number> {
  const [row] = await db
    .select({ amount: sql<number>`coalesce(sum(${orderPayments.amountVnd}), 0)::double precision` })
    .from(orderPayments)
    .innerJoin(orders, joinOrders)
    .where(and(inWindow(scope, from, to), eq(orders.paymentStatus, 'REFUND_DUE')))
  return row!.amount
}

export async function topProducts(db: DbOrTx, scope: OrderScope, from: Date, to: Date, limit: number) {
  const qty = sql<number>`sum(${orderItems.qty})::int`
  return db
    .select({ name: orderItems.nameSnapshot, qty, revenueVnd: sql<number>`sum(${orderItems.lineTotalVnd})::double precision` })
    .from(orderItems)
    .innerJoin(orders, and(eq(orders.storeId, orderItems.storeId), eq(orders.id, orderItems.orderId)))
    .where(and(inWindow(scope, from, to), ne(orders.status, 'CANCELLED')))
    .groupBy(orderItems.nameSnapshot)
    .orderBy(desc(qty), orderItems.nameSnapshot)
    .limit(limit)
}

export async function dailyValue(db: DbOrTx, scope: OrderScope, from: Date, to: Date) {
  return db
    .select({
      day: VN_DAY,
      orderCount: sql<number>`count(*)::int`,
      gross: sql<number>`coalesce(sum(${orders.totalVnd}), 0)::double precision`,
    })
    .from(orders)
    .where(and(inWindow(scope, from, to), ne(orders.status, 'CANCELLED')))
    .groupBy(VN_DAY)
}

export async function dailyCollected(db: DbOrTx, scope: OrderScope, from: Date, to: Date) {
  return db
    .select({ day: VN_DAY, amount: sql<number>`coalesce(sum(${orderPayments.amountVnd}), 0)::double precision` })
    .from(orderPayments)
    .innerJoin(orders, joinOrders)
    .where(and(inWindow(scope, from, to), ne(orders.status, 'CANCELLED')))
    .groupBy(VN_DAY)
}
```

`server/services/reporting/summary.ts`:

```ts
import { toVnDate, vnDayRange } from '#shared/vn-date'
import type { DailySummary } from '#shared/types/reports'
import type { StoreContext } from '../../auth/guards'
import type { DbOrTx } from '../../db/client'
import { collectedByMethod, orderTotals, refundDueTotal } from '../../repositories/reporting'

export async function getDailySummary(db: DbOrTx, ctx: StoreContext, date?: string, now = new Date()): Promise<DailySummary> {
  const scope = { orgId: ctx.orgId, storeId: ctx.storeId }
  const day = date ?? toVnDate(now)
  const { from, to } = vnDayRange(day)
  const [totals, byMethod, refundDueVnd] = await Promise.all([
    orderTotals(db, scope, from, to),
    collectedByMethod(db, scope, from, to),
    refundDueTotal(db, scope, from, to),
  ])
  const collected = { SEPAY: byMethod.SEPAY ?? 0, CASH: byMethod.CASH ?? 0, BANK_MANUAL: byMethod.BANK_MANUAL ?? 0 }
  const collectedVnd = collected.SEPAY + collected.CASH + collected.BANK_MANUAL
  return {
    date: day,
    totalOrders: totals.total,
    completedCount: totals.completed,
    cancelledCount: totals.cancelled,
    grossVnd: totals.gross,
    collected,
    collectedVnd,
    outstandingVnd: Math.max(0, totals.gross - collectedVnd),
    refundDueVnd,
  }
}
```

`server/services/reporting/reports.ts`:

```ts
import { eachDate, reportWindow, type ReportRange } from '#shared/vn-date'
import type { Report } from '#shared/types/reports'
import type { StoreContext } from '../../auth/guards'
import type { DbOrTx } from '../../db/client'
import { collectedByMethod, dailyCollected, dailyValue, orderTotals, topProducts } from '../../repositories/reporting'

const TOP_LIMIT = 5

export async function getReport(db: DbOrTx, ctx: StoreContext, range: ReportRange, now = new Date()): Promise<Report> {
  const scope = { orgId: ctx.orgId, storeId: ctx.storeId }
  const { fromDate, toDate, from, to } = reportWindow(range, now)
  const [totals, byMethod, top, valueByDay, collectedByDay] = await Promise.all([
    orderTotals(db, scope, from, to),
    collectedByMethod(db, scope, from, to),
    topProducts(db, scope, from, to, TOP_LIMIT),
    dailyValue(db, scope, from, to),
    dailyCollected(db, scope, from, to),
  ])
  const value = new Map(valueByDay.map(row => [row.day, row]))
  const collected = new Map(collectedByDay.map(row => [row.day, row.amount]))
  const orderCount = totals.total - totals.cancelled
  return {
    range,
    fromDate,
    toDate,
    orderCount,
    cancelledCount: totals.cancelled,
    grossVnd: totals.gross,
    collectedVnd: (byMethod.SEPAY ?? 0) + (byMethod.CASH ?? 0) + (byMethod.BANK_MANUAL ?? 0),
    averageOrderVnd: orderCount > 0 ? Math.round(totals.gross / orderCount) : 0,
    topProducts: top,
    daily: eachDate(fromDate, toDate).map(date => ({
      date,
      orderCount: value.get(date)?.orderCount ?? 0,
      grossVnd: value.get(date)?.gross ?? 0,
      collectedVnd: collected.get(date) ?? 0,
    })),
  }
}
```

- [ ] **Step 5: Implement routes**

`server/api/stores/[storeId]/summary.get.ts`:

```ts
import { getRouterParam, setHeader } from 'h3'
import { summaryQuerySchema } from '#shared/schemas/reports'
import { requireStoreStaff } from '../../../auth/guards'
import { getDb } from '../../../db/client'
import { getDailySummary } from '../../../services/reporting/summary'
import { defineApiHandler } from '../../../utils/api-handler'
import { parseQuery } from '../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreStaff(event, getRouterParam(event, 'storeId'))
  const { date } = parseQuery(event, summaryQuerySchema)
  setHeader(event, 'Cache-Control', 'no-store')
  return getDailySummary(getDb(), ctx, date)
})
```

`server/api/stores/[storeId]/reports.get.ts`:

```ts
import { getRouterParam, setHeader } from 'h3'
import { reportQuerySchema } from '#shared/schemas/reports'
import { requireStoreOwner } from '../../../auth/guards'
import { getDb } from '../../../db/client'
import { getReport } from '../../../services/reporting/reports'
import { defineApiHandler } from '../../../utils/api-handler'
import { parseQuery } from '../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const { range } = parseQuery(event, reportQuerySchema)
  setHeader(event, 'Cache-Control', 'no-store')
  return getReport(getDb(), ctx, range)
})
```

- [ ] **Step 6: Chạy integration test, xác nhận PASS**

Run: `npx vitest run --project integration tests/integration/reporting.test.ts`
Expected: PASS (9 test). Nếu lỗi `column "orders.created_at" must appear in the GROUP BY clause`, kiểm tra `VN_DAY` không có tham số bind (phải là literal như đã viết).

- [ ] **Step 7: Ma trận tenant (summary, reports)**

Cuối `tests/api/tenant-isolation.test.ts`:

```ts
describe('GET /api/stores/:storeId/summary', () => {
  const summary = (actor: Actor | null, query = '', storeId = ids.storeA1) =>
    call('GET', `/api/stores/${storeId}/summary${query}`, actor ? tokens[actor] : null)

  it('without token → 401', async () => {
    expect((await summary(null)).status).toBe(401)
  })

  it.each<[Actor, number]>([['ownerA', 200], ['staffA1', 200], ['staffA2', 404], ['disabledA1', 404], ['ownerB', 404]])(
    '%s → %i',
    async (actor, status) => {
      const res = await summary(actor, '?date=2026-10-31')
      expect(res.status).toBe(status)
      if (status === 200) expect(res.body).toMatchObject({ date: '2026-10-31', totalOrders: expect.any(Number), collected: { CASH: expect.any(Number) } })
      else expect(res.body).toMatchObject({ code: errorCodes[status] })
    },
  )

  it.each(['?date=2026-02-30', '?date=31-10-2026', '?date='])('%s → 400', async (query) => {
    expect(await summary('ownerA', query)).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
  })

  it('defaults to today when no date is given', async () => {
    const res = await summary('staffA1')
    expect(res.status).toBe(200)
    expect(res.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('GET /api/stores/:storeId/reports (owner only)', () => {
  const reports = (actor: Actor | null, query = '?range=7d') => call('GET', `/api/stores/${ids.storeA1}/reports${query}`, actor ? tokens[actor] : null)

  it('without token → 401', async () => {
    expect((await reports(null)).status).toBe(401)
  })

  it.each<[Actor, number]>([['ownerA', 200], ['staffA1', 403], ['staffA2', 404], ['disabledA1', 404], ['ownerB', 404]])(
    '%s → %i',
    async (actor, status) => {
      const res = await reports(actor)
      expect(res.status).toBe(status)
      if (status === 200) expect(res.body).toMatchObject({ range: '7d', daily: expect.any(Array), topProducts: expect.any(Array) })
      else expect(res.body).toMatchObject({ code: errorCodes[status] })
    },
  )

  it('rejects an unknown range with 400', async () => {
    expect(await reports('ownerA', '?range=90d')).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
  })
})
```

Run: `npm run test:api -- tests/api/tenant-isolation.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add shared/vn-date.ts shared/schemas/reports.ts shared/types/reports.ts server/repositories/reporting.ts server/services/reporting "server/api/stores/[storeId]/summary.get.ts" "server/api/stores/[storeId]/reports.get.ts" tests/unit/shared/vn-date.test.ts tests/integration/reporting.test.ts tests/api/tenant-isolation.test.ts
git commit -m "feat(owner): add daily summary and 7/30-day reports in Vietnam time" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 9: Board client — composables, thẻ đơn, tab, chi tiết, trang `/app/orders`

**Files:**
- Create: `app/utils/order-board.ts`, `app/utils/order-view.ts`, `app/utils/time-ago.ts`, `app/composables/useOrderAlerts.ts`, `app/composables/useOrderBoard.ts`, `app/components/app/BoardTabs.vue`, `app/components/app/OrderCard.vue`, `app/components/app/OrderDetailSlideover.vue`, `tests/unit/app/order-board.test.ts`, `tests/unit/app/order-view.test.ts`, `tests/unit/app/time-ago.test.ts`, `tests/nuxt/app/board-tabs.test.ts`, `tests/nuxt/app/order-card.test.ts`
- Modify (rewrite): `app/pages/app/orders.vue`

**Interfaces:**
- Consumes: `BoardResponse`, `BoardOrder`, `OrderDetailResponse` (Task 3), `primaryAction`, `advanceTargets`, `transitionLabel`, `canCancelOrder`, `canMarkCashPaid`, `TAB_LABELS`, `STATUS_LABELS`, `PAYMENT_STATUS_LABELS`, `FULFILLMENT_LABELS`, `tabForStatus` (Task 2); routes Task 3–5; `useVisiblePolling` (PR3); `useApi`, `useActiveStore`, `extractApiError`, `formatVnd`, `AppPageHeader`, `AppEmptyState`, `AppCopyField`, `ZButton`, `ZCard`, `ZBadge`, `ZAlert`, `ZInput`.
- Produces (PR5/PR6 dùng board này, giữ ổn định):
  - Utils thuần: `detectNewOrderIds(seen: ReadonlySet<string> | null, current: readonly string[]): string[]`, `applyStatus(orders, id, next, tab): BoardOrder[]`, `shiftCounts(counts, from, to): TabCounts`, `mergePage(existing, incoming): BoardOrder[]`, `emptyCounts(): TabCounts`, `formatAge(iso: string, now?: number): string`, `orderActionToast(err: unknown)`, `paymentTone(status)`, `describeEvent(event)`, `formatDateTime(iso)`
  - `useVisiblePolling` (PR3) được dùng lại cho poll 5 s của board và nhịp 30 s cập nhật "x phút trước"
  - `useOrderBoard(storeId: Ref<string | null>)` → `{ tab, orders, counts, newOrderIds, nextCursor, loading, loadingMore, loadError, stale, lastUpdated, busyIds, reload(), refresh(force?), loadMore(), advance(order, next), markPaid(order) }`
  - `useOrderAlerts(newOrderIds: Ref<string[]>, resetKey: Ref<string | null>)` → `{ soundOn, toggleSound() }`
  - Components: `AppBoardTabs` (`v-model: BoardTab`, prop `counts`), `AppOrderCard` (props `order`, `busy?`, `now`; emits `advance(status)`, `markPaid`, `open`), `AppOrderDetailSlideover` (props `storeId`, `orderId: string | null`, `role`; emits `close`, `changed`)

UX chốt (một chạm): thẻ đơn có **một nút chính cỡ `lg` (50px) full-width** theo trạng thái ("Bắt đầu làm" → "Đã xong" → "Khách đã nhận/Đã phục vụ/Đi giao" → "Đã giao xong") và, với đơn COD chưa thu, nút phụ "Đã thu tiền mặt". Bấm là chạy ngay (optimistic: thẻ chuyển sang tab mới, badge cập nhật), không hộp xác nhận; hủy chỉ có trong chi tiết (cần lý do) để tránh bấm nhầm. Poll 5 s khi tab hiển thị; mỗi phản hồi poll bắt đầu trước một thao tác sẽ bị bỏ qua (số phiên `version`) để thẻ vừa chuyển không "nhảy ngược". Poll lỗi thì giữ danh sách cũ và hiện cảnh báo, không xóa trắng. Âm báo (WebAudio beep) chỉ phát sau khi người dùng đã chạm/bấm phím ít nhất một lần và khi công tắc âm báo bật.

- [ ] **Step 1: Viết unit test thất bại cho các helper thuần**

`tests/unit/app/order-board.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { BoardOrder } from '../../../shared/types/orders'
import { applyStatus, detectNewOrderIds, emptyCounts, mergePage, shiftCounts } from '../../../app/utils/order-board'

const order = (id: string, status: BoardOrder['status'] = 'NEW'): BoardOrder => ({
  id, publicCode: id.toUpperCase(), status, fulfillmentType: 'PICKUP', paymentMethod: 'PAY_ON_RECEIPT', paymentStatus: 'UNPAID',
  latePayment: false, tableName: null, customerName: null, customerPhone: null, address: null, notes: null,
  totalVnd: 10_000, createdAt: '2026-11-01T00:00:00.000Z', items: [],
})

describe('detectNewOrderIds', () => {
  it('returns nothing on the first load (seen === null)', () => {
    expect(detectNewOrderIds(null, ['a', 'b'])).toEqual([])
  })

  it('returns only ids not seen before', () => {
    expect(detectNewOrderIds(new Set(['a']), ['a', 'b', 'c'])).toEqual(['b', 'c'])
    expect(detectNewOrderIds(new Set(['a', 'b']), ['a'])).toEqual([])
  })

  it('treats an order that re-enters the new queue (payment arrived) as new', () => {
    expect(detectNewOrderIds(new Set(['a']), ['a', 'paid-late'])).toEqual(['paid-late'])
  })
})

describe('applyStatus', () => {
  it('removes the card when the next status belongs to another tab', () => {
    expect(applyStatus([order('a'), order('b')], 'a', 'PREPARING', 'new').map(o => o.id)).toEqual(['b'])
  })

  it('keeps and updates the card when the tab is unchanged (READY → DELIVERING stays in "ready")', () => {
    const result = applyStatus([order('a', 'READY')], 'a', 'DELIVERING', 'ready')
    expect(result).toHaveLength(1)
    expect(result[0]!.status).toBe('DELIVERING')
  })
})

describe('shiftCounts', () => {
  it('moves one unit between tabs and never goes negative', () => {
    const base = { ...emptyCounts(), new: 2 }
    expect(shiftCounts(base, 'NEW', 'PREPARING')).toEqual({ ...emptyCounts(), new: 1, doing: 1 })
    expect(shiftCounts(emptyCounts(), 'NEW', 'PREPARING')).toEqual({ ...emptyCounts(), doing: 1 })
  })

  it('does not count the "other" tab and ignores same-tab moves', () => {
    const base = { ...emptyCounts(), ready: 1 }
    expect(shiftCounts(base, 'READY', 'COMPLETED')).toEqual(emptyCounts())
    expect(shiftCounts(base, 'READY', 'DELIVERING')).toEqual(base)
  })
})

describe('mergePage', () => {
  it('appends only unseen orders, preserving order', () => {
    expect(mergePage([order('a'), order('b')], [order('b'), order('c')]).map(o => o.id)).toEqual(['a', 'b', 'c'])
  })
})
```

`tests/unit/app/order-view.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { describeEvent, formatDateTime, orderActionToast, paymentTone } from '../../../app/utils/order-view'

const event = (over: Partial<Parameters<typeof describeEvent>[0]>) => ({
  id: 'e', eventType: 'STATUS_CHANGED', fromState: null, toState: null, actorName: null, metadata: null, createdAt: '2026-10-31T08:20:00Z', ...over,
})

describe('orderActionToast', () => {
  it('turns STATUS_CONFLICT into a friendly warning', () => {
    expect(orderActionToast({ data: { code: 'STATUS_CONFLICT', message: 'x' } })).toMatchObject({ color: 'warning', title: 'Đơn vừa được người khác cập nhật' })
  })

  it('maps FORBIDDEN and passes other messages through', () => {
    expect(orderActionToast({ data: { code: 'FORBIDDEN', message: 'x' } })).toMatchObject({ color: 'error', title: 'Bạn không có quyền thực hiện thao tác này' })
    expect(orderActionToast({ data: { code: 'VALIDATION_FAILED', message: 'Nhập lý do hủy' } })).toMatchObject({ color: 'error', title: 'Nhập lý do hủy' })
    expect(orderActionToast(new TypeError('Failed to fetch'))).toMatchObject({ color: 'error', title: 'Không kết nối được máy chủ, vui lòng thử lại' })
  })
})

describe('paymentTone', () => {
  it.each([
    ['PAID', 'success'], ['UNPAID', 'warning'], ['PENDING', 'info'], ['REVIEW_REQUIRED', 'error'], ['REFUND_DUE', 'error'], ['REFUNDED', 'neutral'],
  ] as const)('%s → %s', (status, tone) => {
    expect(paymentTone(status)).toBe(tone)
  })
})

describe('describeEvent', () => {
  it('describes each event type', () => {
    expect(describeEvent(event({ toState: 'PREPARING' }))).toBe('Đang làm')
    expect(describeEvent(event({ eventType: 'CANCELLED', metadata: { reason: 'Hết nguyên liệu' } }))).toBe('Đã hủy — Hết nguyên liệu')
    expect(describeEvent(event({ eventType: 'PAYMENT_RECORDED' }))).toBe('Đã thu tiền mặt')
    expect(describeEvent(event({ eventType: 'CREATED' }))).toBe('Khách đặt đơn')
  })
})

describe('formatDateTime', () => {
  it('renders Vietnam time', () => {
    const text = formatDateTime('2026-10-31T08:20:00Z')
    expect(text).toContain('15:20')
    expect(text).toContain('31/10')
  })
})
```

`tests/unit/app/time-ago.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatAge } from '../../../app/utils/time-ago'

const base = Date.parse('2026-11-01T10:00:00Z')
describe('formatAge', () => {
  it.each([
    [0, 'Vừa xong'],
    [59, 'Vừa xong'],
    [60, '1 phút trước'],
    [59 * 60, '59 phút trước'],
    [60 * 60, '1 giờ trước'],
    [23 * 3600, '23 giờ trước'],
    [24 * 3600, '1 ngày trước'],
    [-30, 'Vừa xong'],
  ])('%i s ago → %s', (seconds, text) => {
    expect(formatAge(new Date(base - seconds * 1000).toISOString(), base)).toBe(text)
  })
})
```

Run: `npx vitest run --project unit tests/unit/app/order-board.test.ts tests/unit/app/order-view.test.ts tests/unit/app/time-ago.test.ts`
Expected: FAIL (module chưa có).

- [ ] **Step 2: Implement helper thuần**

`app/utils/order-board.ts`:

```ts
import type { OrderStatus } from '#shared/enums'
import { tabForStatus, type BoardTab } from '#shared/order-flow'
import type { BoardOrder } from '#shared/types/orders'

export type TabCounts = Record<BoardTab, number>

export function emptyCounts(): TabCounts {
  return { new: 0, doing: 0, ready: 0, other: 0, awaiting_payment: 0 }
}

/** `seen === null` nghĩa là lần tải đầu: không báo gì. */
export function detectNewOrderIds(seen: ReadonlySet<string> | null, current: readonly string[]): string[] {
  if (seen === null) return []
  return current.filter(id => !seen.has(id))
}

export function applyStatus(orders: readonly BoardOrder[], id: string, next: OrderStatus, tab: BoardTab): BoardOrder[] {
  if (tabForStatus(next) !== tab) return orders.filter(order => order.id !== id)
  return orders.map(order => (order.id === id ? { ...order, status: next } : order))
}

export function shiftCounts(counts: TabCounts, from: OrderStatus, to: OrderStatus): TabCounts {
  const fromTab = tabForStatus(from)
  const toTab = tabForStatus(to)
  if (fromTab === toTab) return counts
  const next = { ...counts }
  if (fromTab !== 'other') next[fromTab] = Math.max(0, next[fromTab] - 1)
  if (toTab !== 'other') next[toTab] += 1
  return next
}

export function mergePage(existing: readonly BoardOrder[], incoming: readonly BoardOrder[]): BoardOrder[] {
  const seen = new Set(existing.map(order => order.id))
  return [...existing, ...incoming.filter(order => !seen.has(order.id))]
}
```

`app/utils/time-ago.ts`:

```ts
export function formatAge(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000))
  if (seconds < 60) return 'Vừa xong'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} phút trước`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} giờ trước`
  return `${Math.floor(hours / 24)} ngày trước`
}
```

`app/utils/order-view.ts`:

```ts
import type { PaymentStatus } from '#shared/enums'
import { STATUS_LABELS } from '#shared/order-flow'
import type { OrderEventView } from '#shared/types/orders'
import { extractApiError } from './api-error'

export const PAYMENT_METHOD_LABELS = {
  CASH: 'tiền mặt',
  SEPAY: 'chuyển khoản',
  BANK_MANUAL: 'chuyển khoản (chủ quán xác nhận)',
} as const

export function orderActionToast(err: unknown): { color: 'warning' | 'error', title: string, description?: string } {
  const error = extractApiError(err)
  if (error.code === 'STATUS_CONFLICT') {
    return { color: 'warning', title: 'Đơn vừa được người khác cập nhật', description: 'Đã tải lại danh sách.' }
  }
  if (error.code === 'FORBIDDEN') return { color: 'error', title: 'Bạn không có quyền thực hiện thao tác này' }
  return { color: 'error', title: error.message }
}

export function paymentTone(status: PaymentStatus): 'success' | 'warning' | 'error' | 'info' | 'neutral' {
  switch (status) {
    case 'PAID': return 'success'
    case 'UNPAID': return 'warning'
    case 'PENDING': return 'info'
    case 'REVIEW_REQUIRED':
    case 'REFUND_DUE': return 'error'
    default: return 'neutral'
  }
}

export function describeEvent(event: OrderEventView): string {
  if (event.eventType === 'CANCELLED') {
    const reason = typeof event.metadata?.reason === 'string' ? event.metadata.reason : ''
    return reason ? `Đã hủy — ${reason}` : 'Đã hủy'
  }
  if (event.eventType === 'PAYMENT_RECORDED') return 'Đã thu tiền mặt'
  if (event.eventType === 'CREATED') return 'Khách đặt đơn'
  return event.toState ? STATUS_LABELS[event.toState] : event.eventType
}

const DATE_TIME = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh',
})

export function formatDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso))
}
```

Run lại bước 1. Expected: PASS.

- [ ] **Step 3: Implement composables**

Poll dùng `useVisiblePolling(task, { intervalMs })` của PR3 (gọi ngay khi mount, rồi mỗi `intervalMs` chỉ khi tab hiển thị, quay lại tab thì gọi ngay, không chạy chồng); không viết lại. Lần gọi ngay khi mount trùng với `reload()` đầu tiên nên `refresh()` bỏ qua khi `loading` đang bật.

`app/composables/useOrderAlerts.ts`:

```ts
import { detectNewOrderIds } from '~/utils/order-board'

const SOUND_KEY = 'zeno:board-sound'

export function useOrderAlerts(newOrderIds: Ref<string[]>, resetKey: Ref<string | null>) {
  const toast = useToast()
  const soundOn = ref(true)
  let seen: Set<string> | null = null
  let userActive = false
  let audio: AudioContext | null = null

  const markActive = () => {
    userActive = true
  }

  onMounted(() => {
    soundOn.value = localStorage.getItem(SOUND_KEY) !== 'off'
    window.addEventListener('pointerdown', markActive, { once: true })
    window.addEventListener('keydown', markActive, { once: true })
  })
  onBeforeUnmount(() => {
    window.removeEventListener('pointerdown', markActive)
    window.removeEventListener('keydown', markActive)
    void audio?.close()
  })

  function beep() {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      audio ??= new Ctor()
      void audio.resume()
      const start = audio.currentTime
      const osc = audio.createOscillator()
      const gain = audio.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, start)
      osc.frequency.setValueAtTime(1175, start + 0.15)
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.4)
      osc.connect(gain).connect(audio.destination)
      osc.start(start)
      osc.stop(start + 0.45)
    }
    catch {
      // Âm báo là phụ; thiếu WebAudio không được làm hỏng board.
    }
  }

  function toggleSound() {
    markActive()
    soundOn.value = !soundOn.value
    localStorage.setItem(SOUND_KEY, soundOn.value ? 'on' : 'off')
    if (soundOn.value) beep()
  }

  watch(resetKey, () => {
    seen = null
  })

  watch(newOrderIds, (ids) => {
    const fresh = detectNewOrderIds(seen, ids)
    seen = new Set(ids)
    if (fresh.length === 0) return
    toast.add({ color: 'info', icon: 'i-lucide-bell-ring', title: fresh.length === 1 ? 'Có 1 đơn mới' : `Có ${fresh.length} đơn mới` })
    if (soundOn.value && userActive) beep()
  })

  return { soundOn, toggleSound }
}
```

`app/composables/useOrderBoard.ts`:

```ts
import type { OrderStatus } from '#shared/enums'
import type { BoardTab } from '#shared/order-flow'
import type { BoardOrder, BoardResponse } from '#shared/types/orders'
import { applyStatus, emptyCounts, mergePage, shiftCounts, type TabCounts } from '~/utils/order-board'
import { orderActionToast } from '~/utils/order-view'

const PAGE = 30
const MAX_REFRESH = 100

export function useOrderBoard(storeId: Ref<string | null>) {
  const api = useApi()
  const toast = useToast()

  const tab = ref<BoardTab>('new')
  const orders = ref<BoardOrder[]>([])
  const counts = ref<TabCounts>(emptyCounts())
  const newOrderIds = ref<string[]>([])
  const nextCursor = ref<string | null>(null)
  const loading = ref(false)
  const loadingMore = ref(false)
  const loadError = ref<string | null>(null)
  const stale = ref(false)
  const lastUpdated = ref<string | null>(null)
  const busyIds = ref<Set<string>>(new Set())

  // Mỗi thao tác/tải mới tăng version; phản hồi cũ hơn version hiện tại bị bỏ để không ghi đè trạng thái mới.
  let version = 0
  let refreshing = false

  const base = () => `/api/stores/${storeId.value}/orders`

  function applyResponse(res: BoardResponse) {
    orders.value = res.orders
    nextCursor.value = res.nextCursor
    counts.value = res.counts
    newOrderIds.value = res.newOrderIds
    lastUpdated.value = res.serverTime
    stale.value = false
  }

  async function reload() {
    if (!storeId.value) return
    const mine = ++version
    loading.value = true
    loadError.value = null
    orders.value = []
    nextCursor.value = null
    try {
      const res = await api<BoardResponse>(base(), { query: { tab: tab.value, limit: PAGE } })
      if (mine === version) applyResponse(res)
    }
    catch (err) {
      if (mine === version) loadError.value = extractApiError(err).message
    }
    finally {
      if (mine === version) loading.value = false
    }
  }

  async function refresh(force = false) {
    if (!storeId.value || loading.value || (refreshing && !force)) return
    refreshing = true
    const mine = version
    try {
      const limit = Math.min(MAX_REFRESH, Math.max(PAGE, orders.value.length))
      const res = await api<BoardResponse>(base(), { query: { tab: tab.value, limit } })
      if (mine === version) applyResponse(res)
    }
    catch {
      if (mine === version) stale.value = true
    }
    finally {
      refreshing = false
    }
  }

  async function loadMore() {
    if (!nextCursor.value || loadingMore.value || !storeId.value) return
    loadingMore.value = true
    try {
      const res = await api<BoardResponse>(base(), { query: { tab: tab.value, cursor: nextCursor.value, limit: PAGE } })
      orders.value = mergePage(orders.value, res.orders)
      nextCursor.value = res.nextCursor
    }
    catch (err) {
      toast.add({ color: 'error', title: extractApiError(err).message })
    }
    finally {
      loadingMore.value = false
    }
  }

  function setBusy(id: string, on: boolean) {
    const next = new Set(busyIds.value)
    if (on) next.add(id)
    else next.delete(id)
    busyIds.value = next
  }

  async function act(order: BoardOrder, optimistic: () => void, request: () => Promise<unknown>) {
    if (!storeId.value || busyIds.value.has(order.id)) return
    setBusy(order.id, true)
    version++
    const snapshot = { orders: orders.value, counts: counts.value }
    optimistic()
    try {
      await request()
    }
    catch (err) {
      toast.add(orderActionToast(err))
      orders.value = snapshot.orders
      counts.value = snapshot.counts
    }
    finally {
      setBusy(order.id, false)
      version++
      await refresh(true)
    }
  }

  function advance(order: BoardOrder, nextStatus: OrderStatus) {
    return act(
      order,
      () => {
        orders.value = applyStatus(orders.value, order.id, nextStatus, tab.value)
        counts.value = shiftCounts(counts.value, order.status, nextStatus)
      },
      () => api(`${base()}/${order.id}/status`, { method: 'PATCH', body: { expectedStatus: order.status, nextStatus } }),
    )
  }

  function markPaid(order: BoardOrder) {
    return act(
      order,
      () => {
        orders.value = orders.value.map(item => (item.id === order.id ? { ...item, paymentStatus: 'PAID' as const } : item))
      },
      () => api(`${base()}/${order.id}/mark-paid`, { method: 'POST', body: { expectedPaymentStatus: order.paymentStatus, method: 'CASH' } }),
    )
  }

  return {
    tab, orders, counts, newOrderIds, nextCursor, loading, loadingMore, loadError, stale, lastUpdated, busyIds,
    reload, refresh, loadMore, advance, markPaid,
  }
}
```

- [ ] **Step 4: Viết nuxt component test thất bại cho `AppBoardTabs` và `AppOrderCard`**

`tests/nuxt/app/board-tabs.test.ts`:

```ts
import { renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import AppBoardTabs from '~/components/app/BoardTabs.vue'

const counts = { new: 3, doing: 0, ready: 1, other: 0, awaiting_payment: 0 }

describe('AppBoardTabs', () => {
  it('shows tabs with badges, hides an empty "Chờ thanh toán" tab and marks the selected one', async () => {
    await renderSuspended(AppBoardTabs, { props: { modelValue: 'new', counts } })
    const selected = screen.getByRole('tab', { selected: true })
    expect(selected.textContent).toContain('Mới')
    expect(selected.textContent).toContain('3')
    expect(screen.getByRole('tab', { name: /Sẵn sàng/ }).textContent).toContain('1')
    expect(screen.queryByRole('tab', { name: /Chờ thanh toán/ })).toBeNull()
  })

  it('shows "Chờ thanh toán" when it has orders', async () => {
    await renderSuspended(AppBoardTabs, { props: { modelValue: 'new', counts: { ...counts, awaiting_payment: 2 } } })
    expect(screen.getByRole('tab', { name: /Chờ thanh toán/ }).textContent).toContain('2')
  })

  it('emits the chosen tab and keeps tap targets at least 44px tall by class', async () => {
    const onUpdate = vi.fn()
    await renderSuspended(AppBoardTabs, { props: { modelValue: 'new', counts, 'onUpdate:modelValue': onUpdate } })
    const tab = screen.getByRole('tab', { name: /Đang làm/ })
    expect(tab.className).toContain('min-h-12')
    await fireEvent.click(tab)
    expect(onUpdate).toHaveBeenCalledWith('doing')
  })
})
```

`tests/nuxt/app/order-card.test.ts`:

```ts
import { renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import type { BoardOrder } from '#shared/types/orders'
import AppOrderCard from '~/components/app/OrderCard.vue'

const order = (over: Partial<BoardOrder> = {}): BoardOrder => ({
  id: 'o1', publicCode: 'K7M2PQ', status: 'NEW', fulfillmentType: 'PICKUP', paymentMethod: 'PAY_ON_RECEIPT', paymentStatus: 'UNPAID',
  latePayment: false, tableName: null, customerName: 'Lan', customerPhone: '0901234567', address: null, notes: 'Ít đá',
  totalVnd: 50_000, createdAt: new Date().toISOString(),
  items: [{ id: 'i1', name: 'Trà đào', qty: 2, options: ['30% đường', 'Thêm đào'], unitPriceVnd: 25_000, lineTotalVnd: 50_000 }],
  ...over,
})

describe('AppOrderCard', () => {
  it('shows code, items with options, total and customer', async () => {
    await renderSuspended(AppOrderCard, { props: { order: order(), now: Date.now() } })
    expect(screen.getByText('K7M2PQ')).toBeTruthy()
    expect(screen.getByText(/Trà đào/)).toBeTruthy()
    expect(screen.getByText(/30% đường/)).toBeTruthy()
    expect(screen.getByText('50.000đ')).toBeTruthy()
    expect(screen.getByText(/Lan/)).toBeTruthy()
    expect(screen.getByText('Chưa thu')).toBeTruthy()
  })

  it('has one primary action and a cash button for unpaid COD; both emit', async () => {
    const { emitted } = await renderSuspended(AppOrderCard, { props: { order: order(), now: Date.now() } })
    await fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu làm' }))
    await fireEvent.click(screen.getByRole('button', { name: /Đã thu tiền mặt/ }))
    expect(emitted().advance).toEqual([['PREPARING']])
    expect(emitted().markPaid).toHaveLength(1)
  })

  it.each([
    ['NEW', 'PICKUP', 'Bắt đầu làm'],
    ['PREPARING', 'DINE_IN', 'Đã xong'],
    ['READY', 'DELIVERY', 'Đi giao'],
    ['DELIVERING', 'DELIVERY', 'Đã giao xong'],
  ] as const)('%s / %s shows "%s"', async (status, fulfillmentType, label) => {
    await renderSuspended(AppOrderCard, { props: { order: order({ status, fulfillmentType, paymentStatus: 'PAID' }), now: Date.now() } })
    expect(screen.getByRole('button', { name: label })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Đã thu tiền mặt/ })).toBeNull()
  })

  it('has no action buttons for AWAITING_PAYMENT (system-owned) or finished orders', async () => {
    await renderSuspended(AppOrderCard, {
      props: { order: order({ status: 'AWAITING_PAYMENT', paymentMethod: 'BANK_QR', paymentStatus: 'PENDING' }), now: Date.now() },
    })
    expect(screen.queryByRole('button', { name: 'Bắt đầu làm' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Đã thu tiền mặt/ })).toBeNull()
    expect(screen.getByText('Chờ chuyển khoản')).toBeTruthy()
  })

  it('disables the actions while busy and opens the detail from the info area', async () => {
    const { emitted } = await renderSuspended(AppOrderCard, { props: { order: order(), busy: true, now: Date.now() } })
    expect((screen.getByRole('button', { name: 'Bắt đầu làm' }) as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.click(screen.getByRole('button', { name: /Xem chi tiết đơn K7M2PQ/ }))
    expect(emitted().open).toHaveLength(1)
  })

  it('shows the dine-in table name', async () => {
    await renderSuspended(AppOrderCard, { props: { order: order({ fulfillmentType: 'DINE_IN', tableName: 'Bàn 05' }), now: Date.now() } })
    expect(screen.getByText(/Bàn 05/)).toBeTruthy()
  })
})
```

Run: `npx vitest run --project nuxt tests/nuxt/app/board-tabs.test.ts tests/nuxt/app/order-card.test.ts`
Expected: FAIL (component chưa có).

- [ ] **Step 5: Implement `AppBoardTabs` và `AppOrderCard`**

`app/components/app/BoardTabs.vue`:

```vue
<script setup lang="ts">
import { BOARD_TABS, TAB_LABELS, type BoardTab } from '#shared/order-flow'

const props = defineProps<{ counts: Record<BoardTab, number> }>()
const model = defineModel<BoardTab>({ required: true })

const visibleTabs = computed(() =>
  BOARD_TABS.filter(tab => tab !== 'awaiting_payment' || props.counts.awaiting_payment > 0 || model.value === 'awaiting_payment'),
)
</script>

<template>
  <div
    role="tablist"
    aria-label="Nhóm đơn hàng"
    class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:px-0"
  >
    <button
      v-for="tab in visibleTabs"
      :key="tab"
      type="button"
      role="tab"
      :aria-selected="model === tab"
      :data-testid="`tab-${tab}`"
      class="flex min-h-12 shrink-0 items-center gap-2 rounded-full border px-4 font-medium outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      :class="model === tab
        ? 'border-primary bg-primary text-(--zeno-on-primary)'
        : 'border-default bg-(--zeno-surface) text-muted hover:bg-(--zeno-surface-hover)'"
      @click="model = tab"
    >
      {{ TAB_LABELS[tab] }}
      <span
        v-if="tab !== 'other' && counts[tab] > 0"
        class="min-w-6 rounded-full px-1.5 text-center text-[13px] font-semibold"
        :class="model === tab ? 'bg-white/25 text-(--zeno-on-primary)' : 'bg-primary/12 text-primary'"
      >{{ counts[tab] }}</span>
    </button>
  </div>
</template>
```

`app/components/app/OrderCard.vue`:

```vue
<script setup lang="ts">
import type { OrderStatus } from '#shared/enums'
import { formatVnd } from '#shared/money'
import { FULFILLMENT_LABELS, PAYMENT_STATUS_LABELS, canMarkCashPaid, primaryAction } from '#shared/order-flow'
import type { BoardOrder } from '#shared/types/orders'

const props = defineProps<{ order: BoardOrder, busy?: boolean, now: number }>()
const emit = defineEmits<{ advance: [status: OrderStatus], markPaid: [], open: [] }>()

const MAX_LINES = 3
const action = computed(() => primaryAction(props.order))
const canPay = computed(() => canMarkCashPaid(props.order))
const where = computed(() => (props.order.fulfillmentType === 'DINE_IN' && props.order.tableName
  ? `${FULFILLMENT_LABELS.DINE_IN} · ${props.order.tableName}`
  : FULFILLMENT_LABELS[props.order.fulfillmentType]))
const lines = computed(() => props.order.items.slice(0, MAX_LINES))
const hidden = computed(() => Math.max(0, props.order.items.length - MAX_LINES))
const contact = computed(() => [props.order.customerName, props.order.customerPhone].filter(Boolean).join(' · '))
</script>

<template>
  <article :data-testid="`order-card-${order.publicCode}`">
    <ZCard variant="flat" padding="md">
      <div class="flex flex-col gap-3">
        <button
          type="button"
          class="flex min-h-11 w-full flex-col gap-2 rounded-md text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          :aria-label="`Xem chi tiết đơn ${order.publicCode}`"
          @click="emit('open')"
        >
          <span class="flex items-center justify-between gap-3">
            <span class="font-mono text-xl font-semibold text-default">{{ order.publicCode }}</span>
            <span class="flex items-center gap-2">
              <ZBadge v-if="order.latePayment" status="warning" size="sm">Chuyển muộn</ZBadge>
              <ZBadge :status="paymentTone(order.paymentStatus)" size="sm">{{ PAYMENT_STATUS_LABELS[order.paymentStatus] }}</ZBadge>
            </span>
          </span>
          <span class="flex items-center justify-between gap-3 text-sm text-muted">
            <span class="font-medium text-default">{{ where }}</span>
            <span>{{ formatAge(order.createdAt, now) }}</span>
          </span>
          <span v-if="contact" class="block text-sm text-muted">{{ contact }}</span>
          <span class="flex flex-col gap-1">
            <span v-for="item in lines" :key="item.id" class="block text-base text-default">
              <span class="font-semibold">{{ item.qty }}×</span> {{ item.name }}
              <span v-if="item.options.length" class="block text-[13px] text-muted">{{ item.options.join(', ') }}</span>
            </span>
            <span v-if="hidden > 0" class="block text-sm text-muted">+{{ hidden }} món nữa</span>
          </span>
          <span v-if="order.notes" class="block rounded-md bg-(--zeno-surface-inset) px-3 py-2 text-sm text-default">Ghi chú: {{ order.notes }}</span>
          <span class="block text-right font-mono text-lg font-semibold text-default">{{ formatVnd(order.totalVnd) }}</span>
        </button>

        <div v-if="action || canPay" class="flex flex-col gap-2">
          <ZButton
            v-if="action"
            size="lg"
            block
            :loading="busy"
            :disabled="busy"
            @click="emit('advance', action.nextStatus)"
          >
            {{ action.label }}
          </ZButton>
          <ZButton
            v-if="canPay"
            variant="secondary"
            size="lg"
            block
            icon="i-lucide-banknote"
            :disabled="busy"
            @click="emit('markPaid')"
          >
            Đã thu tiền mặt
          </ZButton>
        </div>
      </div>
    </ZCard>
  </article>
</template>
```

Run: `npx vitest run --project nuxt tests/nuxt/app/board-tabs.test.ts tests/nuxt/app/order-card.test.ts`
Expected: PASS. Nếu `getByRole('button', { name: 'Bắt đầu làm' })` không khớp vì `ZButton` chèn icon/loading vào tên, đổi sang `{ name: /Bắt đầu làm/ }` — nhưng phải giữ nguyên các nhãn hiển thị.

- [ ] **Step 6: Implement `AppOrderDetailSlideover`**

`app/components/app/OrderDetailSlideover.vue`:

```vue
<script setup lang="ts">
import type { OrderStatus } from '#shared/enums'
import { formatVnd } from '#shared/money'
import {
  FULFILLMENT_LABELS, PAYMENT_STATUS_LABELS, STATUS_LABELS,
  advanceTargets, canCancelOrder, canMarkCashPaid, transitionLabel,
} from '#shared/order-flow'
import type { OrderDetailResponse } from '#shared/types/orders'

const props = defineProps<{ storeId: string, orderId: string | null, role: 'OWNER' | 'STAFF' }>()
const emit = defineEmits<{ close: [], changed: [] }>()

const api = useApi()
const toast = useToast()

const detail = ref<OrderDetailResponse | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const acting = ref<string | null>(null)
const showCancel = ref(false)
const reason = ref('')
const QUICK_REASONS = ['Hết nguyên liệu', 'Khách yêu cầu hủy', 'Không liên lạc được khách']

const open = computed({
  get: () => props.orderId !== null,
  set: (value: boolean) => {
    if (!value) emit('close')
  },
})
const base = computed(() => `/api/stores/${props.storeId}/orders/${props.orderId}`)

async function load() {
  if (!props.orderId) return
  loading.value = detail.value?.order.id !== props.orderId
  error.value = null
  try {
    detail.value = await api<OrderDetailResponse>(base.value)
  }
  catch (err) {
    error.value = extractApiError(err).message
  }
  finally {
    loading.value = false
  }
}

watch(() => props.orderId, (id) => {
  detail.value = null
  showCancel.value = false
  reason.value = ''
  if (id) void load()
}, { immediate: true })

async function run(kind: string, request: () => Promise<unknown>) {
  acting.value = kind
  try {
    await request()
    showCancel.value = false
    reason.value = ''
  }
  catch (err) {
    toast.add(orderActionToast(err))
  }
  finally {
    acting.value = null
    emit('changed')
    await load()
  }
}

const order = computed(() => detail.value?.order ?? null)
const targets = computed(() => (order.value ? advanceTargets(order.value) : []))
const cancellable = computed(() => !!order.value && canCancelOrder(order.value, props.role))
const needsOwnerToCancel = computed(() => !!order.value && !cancellable.value && canCancelOrder(order.value, 'OWNER'))
const canPay = computed(() => !!order.value && canMarkCashPaid(order.value))

const advance = (status: OrderStatus) => run('advance', () =>
  api(`${base.value}/status`, { method: 'PATCH', body: { expectedStatus: order.value!.status, nextStatus: status } }))
const markPaid = () => run('pay', () =>
  api(`${base.value}/mark-paid`, { method: 'POST', body: { expectedPaymentStatus: order.value!.paymentStatus, method: 'CASH' } }))
const cancel = () => run('cancel', () =>
  api(`${base.value}/cancel`, { method: 'POST', body: { expectedStatus: order.value!.status, reason: reason.value } }))
</script>

<template>
  <USlideover
    v-model:open="open"
    side="right"
    :title="order ? `Đơn ${order.publicCode}` : 'Chi tiết đơn'"
    description="Chi tiết, thao tác và lịch sử của đơn hàng"
    :ui="{ content: 'w-full max-w-md' }"
  >
    <template #body>
      <div v-if="loading" class="flex flex-col gap-3" aria-busy="true" aria-label="Đang tải đơn">
        <USkeleton v-for="i in 4" :key="i" class="h-20 w-full rounded-md" />
      </div>

      <ZAlert v-else-if="error && !order" color="error" title="Không tải được đơn" :description="error">
        <template #actions>
          <ZButton variant="secondary" size="sm" icon="i-lucide-refresh-cw" @click="load()">
            Thử lại
          </ZButton>
        </template>
      </ZAlert>

      <div v-else-if="order" class="flex flex-col gap-5" data-testid="order-detail">
        <div class="flex flex-wrap items-center gap-2">
          <ZBadge :status="order.status === 'CANCELLED' ? 'error' : 'info'">{{ STATUS_LABELS[order.status] }}</ZBadge>
          <ZBadge :status="paymentTone(order.paymentStatus)">{{ PAYMENT_STATUS_LABELS[order.paymentStatus] }}</ZBadge>
          <ZBadge v-if="order.latePayment" status="warning">Chuyển muộn</ZBadge>
          <span class="text-sm text-muted">{{ FULFILLMENT_LABELS[order.fulfillmentType] }}<template v-if="order.tableName"> · {{ order.tableName }}</template> · {{ formatDateTime(order.createdAt) }}</span>
        </div>

        <section v-if="order.customerName || order.customerPhone || order.address || order.notes" class="flex flex-col gap-2">
          <p v-if="order.customerName" class="font-medium text-default">{{ order.customerName }}</p>
          <ZButton v-if="order.customerPhone" variant="secondary" icon="i-lucide-phone" :to="`tel:${order.customerPhone}`">
            Gọi {{ order.customerPhone }}
          </ZButton>
          <p v-if="order.address" class="text-sm text-default">{{ order.address }}</p>
          <p v-if="order.notes" class="rounded-md bg-(--zeno-surface-inset) px-3 py-2 text-sm text-default">Ghi chú: {{ order.notes }}</p>
        </section>

        <section aria-label="Món đã đặt">
          <ul class="flex flex-col gap-2">
            <li v-for="item in order.items" :key="item.id" class="flex items-start justify-between gap-3">
              <span class="min-w-0">
                <span class="font-semibold">{{ item.qty }}×</span> {{ item.name }}
                <span v-if="item.options.length" class="block text-[13px] text-muted">{{ item.options.join(', ') }}</span>
              </span>
              <span class="shrink-0 font-mono text-sm">{{ formatVnd(item.lineTotalVnd) }}</span>
            </li>
          </ul>
          <p class="mt-3 flex justify-between border-t border-default pt-3 font-semibold">
            <span>Tổng</span><span class="font-mono">{{ formatVnd(order.totalVnd) }}</span>
          </p>
          <p v-if="detail?.payment" class="mt-1 text-sm text-muted">
            Đã thu {{ formatVnd(detail.payment.amountVnd) }} bằng {{ PAYMENT_METHOD_LABELS[detail.payment.method] }} lúc {{ formatDateTime(detail.payment.recordedAt) }}<template v-if="detail.payment.note"> — {{ detail.payment.note }}</template>
          </p>
        </section>

        <section v-if="targets.length || canPay || cancellable || needsOwnerToCancel" class="flex flex-col gap-2" aria-label="Thao tác">
          <ZButton
            v-for="(status, index) in targets"
            :key="status"
            size="lg"
            block
            :variant="index === 0 ? 'primary' : 'secondary'"
            :loading="acting === 'advance'"
            :disabled="acting !== null"
            @click="advance(status)"
          >
            {{ transitionLabel(order, status) }}
          </ZButton>
          <ZButton v-if="canPay" variant="secondary" size="lg" block icon="i-lucide-banknote" :loading="acting === 'pay'" :disabled="acting !== null" @click="markPaid()">
            Đã thu tiền mặt
          </ZButton>
          <ZAlert v-if="needsOwnerToCancel" color="info" title="Đơn đã thu tiền — chỉ chủ quán được hủy" />
          <ZButton v-if="cancellable && !showCancel" variant="ghost" size="lg" block icon="i-lucide-x" @click="showCancel = true">
            Hủy đơn
          </ZButton>
          <div v-if="cancellable && showCancel" class="flex flex-col gap-3 rounded-md border border-default p-3" data-testid="cancel-panel">
            <ZFormField label="Lý do hủy" name="reason" required>
              <ZInput v-model="reason" size="lg" maxlength="200" placeholder="Nhập lý do" />
            </ZFormField>
            <div class="flex flex-wrap gap-2">
              <ZButton v-for="quick in QUICK_REASONS" :key="quick" variant="secondary" size="sm" @click="reason = quick">
                {{ quick }}
              </ZButton>
            </div>
            <p v-if="order.paymentStatus === 'PAID'" class="text-sm text-muted">Đơn đã thu tiền sẽ chuyển sang "Cần hoàn tiền".</p>
            <ZButton variant="destructive" size="lg" block :disabled="reason.trim().length < 2 || acting !== null" :loading="acting === 'cancel'" @click="cancel()">
              Xác nhận hủy đơn
            </ZButton>
          </div>
        </section>

        <section aria-label="Lịch sử">
          <h3 class="mb-2 text-sm font-semibold text-muted">Lịch sử</h3>
          <ol class="flex flex-col gap-2">
            <li v-for="event in detail?.events" :key="event.id" class="flex justify-between gap-3 text-sm">
              <span class="text-default">{{ describeEvent(event) }}<span v-if="event.actorName" class="text-muted"> · {{ event.actorName }}</span></span>
              <span class="shrink-0 text-muted">{{ formatDateTime(event.createdAt) }}</span>
            </li>
            <li v-if="!detail?.events.length" class="text-sm text-muted">Chưa có thao tác nào.</li>
          </ol>
        </section>
      </div>
    </template>
  </USlideover>
</template>
```

- [ ] **Step 7: Viết lại trang `/app/orders`**

`app/pages/app/orders.vue` (thay toàn bộ):

```vue
<script setup lang="ts">
import { TAB_LABELS } from '#shared/order-flow'

definePageMeta({ layout: 'owner', middleware: ['auth', 'has-store'] })

const config = useRuntimeConfig()
const { activeStore } = useActiveStore()
const storeId = computed(() => activeStore.value?.id ?? null)
const role = computed(() => activeStore.value?.role ?? 'STAFF')
const publicUrl = computed(() => (activeStore.value ? `${config.public.appBaseUrl}/s/${activeStore.value.slug}` : ''))

const board = useOrderBoard(storeId)
const { tab, orders, counts, nextCursor, loading, loadingMore, loadError, stale, busyIds } = board
const { soundOn, toggleSound } = useOrderAlerts(board.newOrderIds, storeId)

const now = ref(Date.now())
useVisiblePolling(() => board.refresh(), { intervalMs: 5000 })
useVisiblePolling(() => {
  now.value = Date.now()
}, { intervalMs: 30_000 })
watch([storeId, tab], () => void board.reload(), { immediate: true })

useHead({ title: () => (counts.value.new > 0 ? `(${counts.value.new}) Đơn hàng` : 'Đơn hàng') })

const detailId = ref<string | null>(null)
const nothingAtAll = computed(() => Object.values(counts.value).every(count => count === 0) && orders.value.length === 0)
const EMPTY: Record<string, string> = {
  new: 'Chưa có đơn mới',
  doing: 'Không có đơn đang làm',
  ready: 'Không có đơn sẵn sàng',
  other: 'Chưa có đơn hoàn tất hoặc đã hủy',
  awaiting_payment: 'Không có đơn chờ thanh toán',
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <AppPageHeader title="Đơn hàng" description="Theo dõi và xử lý đơn của quán.">
      <template #actions>
        <ZButton
          variant="ghost"
          :icon="soundOn ? 'i-lucide-bell' : 'i-lucide-bell-off'"
          :aria-label="soundOn ? 'Tắt âm báo đơn mới' : 'Bật âm báo đơn mới'"
          @click="toggleSound()"
        >
          {{ soundOn ? 'Âm báo bật' : 'Âm báo tắt' }}
        </ZButton>
      </template>
    </AppPageHeader>

    <ZAlert
      v-if="activeStore && !activeStore.isAcceptingOrders"
      color="warning"
      title="Quán đang tạm nghỉ — khách không đặt được món"
    >
      <template #actions>
        <ZButton v-if="role === 'OWNER'" variant="secondary" size="sm" to="/app/settings">
          Bật nhận đơn
        </ZButton>
      </template>
    </ZAlert>

    <AppBoardTabs v-model="tab" :counts="counts" />

    <ZAlert v-if="stale && orders.length" color="warning" title="Không cập nhật được, đang thử lại…" />

    <div v-if="loading" class="flex flex-col gap-3" aria-busy="true" aria-label="Đang tải đơn">
      <USkeleton v-for="i in 3" :key="i" class="h-44 w-full rounded-md" />
    </div>

    <ZAlert v-else-if="loadError" color="error" title="Không tải được danh sách đơn" :description="loadError">
      <template #actions>
        <ZButton variant="secondary" size="sm" icon="i-lucide-refresh-cw" @click="board.reload()">
          Thử lại
        </ZButton>
      </template>
    </ZAlert>

    <template v-else-if="orders.length">
      <ul class="flex flex-col gap-3" :aria-label="TAB_LABELS[tab]">
        <li v-for="order in orders" :key="order.id">
          <AppOrderCard
            :order="order"
            :now="now"
            :busy="busyIds.has(order.id)"
            @advance="status => board.advance(order, status)"
            @mark-paid="board.markPaid(order)"
            @open="detailId = order.id"
          />
        </li>
      </ul>
      <ZButton v-if="nextCursor" variant="secondary" block :loading="loadingMore" @click="board.loadMore()">
        Xem thêm
      </ZButton>
    </template>

    <ZCard v-else variant="raised" padding="lg">
      <AppEmptyState
        icon="i-lucide-receipt"
        :title="nothingAtAll && tab === 'new' ? 'Chưa có đơn hàng nào' : EMPTY[tab]!"
        :description="nothingAtAll && tab === 'new' ? 'Chia sẻ link đặt món để khách bắt đầu gọi món. Đơn mới sẽ hiện ở đây.' : 'Danh sách tự cập nhật mỗi vài giây.'"
      >
        <template v-if="nothingAtAll && tab === 'new'" #actions>
          <AppCopyField v-if="publicUrl" :value="publicUrl" label="Link đặt món" />
          <ZButton v-if="role === 'OWNER'" variant="secondary" block icon="i-lucide-settings" to="/app/settings">
            Mở cài đặt
          </ZButton>
        </template>
      </AppEmptyState>
    </ZCard>

    <AppOrderDetailSlideover
      v-if="storeId"
      :store-id="storeId"
      :order-id="detailId"
      :role="role"
      @close="detailId = null"
      @changed="board.refresh(true)"
    />
  </div>
</template>
```

- [ ] **Step 8: Chạy toàn bộ kiểm tra tĩnh + test client**

Run: `npm run lint && npm run typecheck && npm run test:unit && npm run test:nuxt`
Expected: tất cả xanh. Lint phải không báo `UButton/UCard/…` trong `pages/` (trang chỉ dùng `Z*` và `USkeleton`, vốn không bị cấm).

- [ ] **Step 9: Commit**

```bash
git add app/utils app/composables app/components/app/BoardTabs.vue app/components/app/OrderCard.vue app/components/app/OrderDetailSlideover.vue app/pages/app/orders.vue tests/unit/app tests/nuxt/app/board-tabs.test.ts tests/nuxt/app/order-card.test.ts
git commit -m "feat(owner): add order board with one-tap actions, polling and new-order alerts" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 10: Màn nhân viên, nhận lời mời, báo cáo + nav theo role

**Files:**
- Create: `app/utils/after-signup.ts`, `app/utils/invite-errors.ts`, `app/pages/app/team.vue`, `app/pages/app/reports.vue`, `app/pages/invite/[token].vue`, `tests/unit/app/after-signup.test.ts`, `tests/unit/app/invite-errors.test.ts`
- Modify: `app/layouts/owner.vue`, `app/pages/signup.vue`, `app/pages/login.vue`

**Interfaces:**
- Consumes: routes Task 6–8; `TeamResponse`, `CreatedInvitation`, `InvitationPreview`, `AcceptInvitationResult`, `DailySummary`, `Report` (Task 6, 8); `inviteInputSchema`, `useApi`, `useMe`, `useActiveStore`, `useAuth`, `extractApiError`, `safeRedirect`, `formatVnd`, `AppCopyField`, `AppAuthShell`, `AppPageHeader`, `AppEmptyState`, `Z*`.
- Produces:
  - `afterSignUpTarget(redirect: unknown): string` (chỉ cho phép `/invite/…`, còn lại về `/onboarding`)
  - `describeAcceptError(error: ApiErrorBody): string`
  - Trang `/app/team` (owner; staff thấy thông báo), `/app/reports` (mọi role: khối "Hôm nay" từ `summary`; owner thêm tab 7/30 ngày + top món), `/invite/[token]`
  - Nav owner layout: thêm "Báo cáo" (mọi role) và "Nhân viên" (chỉ owner)

Quyết định (ghi lại ở Exit Checklist): quản lý nhân viên là trang riêng `/app/team` thay vì tab trong `/app/settings` mà roadmap nêu, vì PR2 đang đổi cấu trúc trang settings thành nhiều tab; link vẫn ở nav (owner) nên không mất khả năng tìm thấy, và gom vào tab sau này chỉ là di chuyển component.

- [ ] **Step 1: Viết unit test thất bại cho hai helper**

`tests/unit/app/after-signup.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { afterSignUpTarget } from '../../../app/utils/after-signup'

describe('afterSignUpTarget', () => {
  it.each([
    ['/invite/abc123', '/invite/abc123'],
    ['/app/settings', '/onboarding'],
    ['//evil.example.com/invite/x', '/onboarding'],
    ['https://evil.example.com/invite/x', '/onboarding'],
    ['/invite', '/onboarding'],
    [undefined, '/onboarding'],
    [['/invite/a'], '/onboarding'],
  ])('%j → %s', (input, expected) => {
    expect(afterSignUpTarget(input)).toBe(expected)
  })
})
```

`tests/unit/app/invite-errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { describeAcceptError } from '../../../app/utils/invite-errors'

describe('describeAcceptError', () => {
  it.each([
    [{ code: 'FORBIDDEN', message: 'x', details: { reason: 'EMAIL_MISMATCH' } }, 'Email của bạn không khớp với lời mời. Hãy đăng nhập bằng đúng email được mời.'],
    [{ code: 'FORBIDDEN', message: 'x', details: { reason: 'EMAIL_NOT_VERIFIED' } }, 'Bạn cần xác minh email trước khi tham gia. Hãy kiểm tra hộp thư của bạn.'],
    [{ code: 'NOT_FOUND', message: 'x' }, 'Lời mời không còn hiệu lực. Hãy nhờ chủ quán gửi lại link mới.'],
    [{ code: 'INTERNAL', message: 'Lỗi mạng' }, 'Lỗi mạng'],
  ] as const)('%j', (error, expected) => {
    expect(describeAcceptError(error as never)).toBe(expected)
  })
})
```

Run: `npx vitest run --project unit tests/unit/app/after-signup.test.ts tests/unit/app/invite-errors.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement helper**

`app/utils/after-signup.ts`:

```ts
import { safeRedirect } from './safe-redirect'

/** Người được mời đăng ký xong phải quay lại link mời, không bị đẩy vào onboarding tạo quán mới. */
export function afterSignUpTarget(redirect: unknown): string {
  const target = safeRedirect(redirect, '/onboarding')
  return target.startsWith('/invite/') ? target : '/onboarding'
}
```

`app/utils/invite-errors.ts`:

```ts
import type { ApiErrorBody } from '#shared/errors'

export function describeAcceptError(error: ApiErrorBody): string {
  const reason = (error.details as { reason?: string } | undefined)?.reason
  if (error.code === 'FORBIDDEN' && reason === 'EMAIL_MISMATCH') {
    return 'Email của bạn không khớp với lời mời. Hãy đăng nhập bằng đúng email được mời.'
  }
  if (error.code === 'FORBIDDEN' && reason === 'EMAIL_NOT_VERIFIED') {
    return 'Bạn cần xác minh email trước khi tham gia. Hãy kiểm tra hộp thư của bạn.'
  }
  if (error.code === 'NOT_FOUND') return 'Lời mời không còn hiệu lực. Hãy nhờ chủ quán gửi lại link mới.'
  return error.message
}
```

Run lại bước 1. Expected: PASS.

- [ ] **Step 3: Sửa signup/login giữ `redirect`, nav theo role**

`app/pages/signup.vue`: trong `<script setup>` thêm sau `const { signUp } = useAuth()`:

```ts
const route = useRoute()
```

đổi `await navigateTo('/onboarding')` thành `await navigateTo(afterSignUpTarget(route.query.redirect))`, và đổi link footer `<NuxtLink to="/login" …>` thành:

```vue
<NuxtLink :to="{ path: '/login', query: route.query.redirect ? { redirect: String(route.query.redirect) } : {} }" class="inline-flex min-h-11 items-center px-1 font-semibold text-primary underline-offset-4 hover:underline">
```

`app/pages/login.vue`: đổi `<NuxtLink to="/signup" …>` thành:

```vue
<NuxtLink :to="{ path: '/signup', query: route.query.redirect ? { redirect: String(route.query.redirect) } : {} }" class="inline-flex min-h-11 items-center px-1 font-semibold text-primary underline-offset-4 hover:underline">
```

`app/layouts/owner.vue`: đổi `const navItems = [` thành `const allNavItems: { label: string, to: string, icon: string, ownerOnly?: boolean }[] = [`, và thay dòng cuối của mảng:

```ts
  { label: 'Cài đặt', to: '/app/settings', icon: 'i-lucide-settings' },
]
```

bằng:

```ts
  { label: 'Báo cáo', to: '/app/reports', icon: 'i-lucide-chart-column' },
  { label: 'Nhân viên', to: '/app/team', icon: 'i-lucide-users', ownerOnly: true },
  { label: 'Cài đặt', to: '/app/settings', icon: 'i-lucide-settings' },
]
const { activeStore } = useActiveStore()
const navItems = computed(() => allNavItems.filter(item => !item.ownerOnly || activeStore.value?.role === 'OWNER'))
```

(Giữ nguyên mọi phần tử PR2 đã thêm vào mảng, ví dụ "Thực đơn". Bottom nav thiết kế tối đa 5 mục: owner có Đơn hàng, Thực đơn, Báo cáo, Nhân viên, Cài đặt = 5.)

- [ ] **Step 4: Trang nhận lời mời `/invite/[token]`**

`app/pages/invite/[token].vue`:

```vue
<script setup lang="ts">
import type { AcceptInvitationResult, InvitationPreview } from '#shared/types/team'

definePageMeta({ middleware: ['auth'] })
useHead({ title: 'Lời mời tham gia quán' })

const route = useRoute()
const token = computed(() => String(route.params.token ?? ''))
const api = useApi()
const { user, signOut } = useAuth()
const { load } = useMe()
const { setActiveStore } = useActiveStore()

const { data: preview, error: loadErrorRaw, status } = await useAsyncData(
  () => `invitation-${token.value}`,
  () => api<InvitationPreview>(`/api/invitations/${token.value}`),
)
const loadError = computed(() => (loadErrorRaw.value ? describeAcceptError(extractApiError(loadErrorRaw.value)) : null))

const accepting = ref(false)
const acceptError = ref<string | null>(null)

async function accept() {
  accepting.value = true
  acceptError.value = null
  try {
    const result = await api<AcceptInvitationResult>(`/api/invitations/${token.value}/accept`, { method: 'POST' })
    await load(true)
    setActiveStore(result.store.id)
    await navigateTo('/app/orders')
  }
  catch (err) {
    acceptError.value = describeAcceptError(extractApiError(err))
  }
  finally {
    accepting.value = false
  }
}

async function switchAccount() {
  await signOut()
  await navigateTo({ path: '/login', query: { redirect: route.fullPath } })
}
</script>

<template>
  <AppAuthShell title="Tham gia quán" description="Bạn được chủ quán mời làm nhân viên.">
    <div v-if="status === 'pending'" class="flex flex-col gap-3" aria-busy="true" aria-label="Đang tải lời mời">
      <USkeleton class="h-24 w-full rounded-md" />
    </div>

    <ZAlert v-else-if="loadError" color="error" title="Không mở được lời mời" :description="loadError">
      <template #actions>
        <ZButton variant="secondary" size="sm" to="/app">
          Về trang chính
        </ZButton>
      </template>
    </ZAlert>

    <div v-else-if="preview" class="flex flex-col gap-5">
      <ZCard variant="flat" padding="md">
        <p class="text-muted">Quán</p>
        <p class="text-h3 text-default" data-testid="invite-store-name">{{ preview.storeName }}</p>
        <p class="mt-3 text-sm text-muted">Lời mời gửi tới <span class="font-mono">{{ preview.emailHint }}</span></p>
        <p class="text-sm text-muted">Bạn đang đăng nhập bằng <span class="font-mono">{{ user?.email }}</span></p>
      </ZCard>

      <ZAlert
        v-if="!preview.emailMatches"
        color="warning"
        title="Email không khớp với lời mời"
        description="Hãy đăng xuất và đăng nhập (hoặc đăng ký) bằng đúng email được mời."
      >
        <template #actions>
          <ZButton variant="secondary" size="sm" @click="switchAccount()">
            Đăng xuất để dùng email khác
          </ZButton>
        </template>
      </ZAlert>

      <ZAlert v-if="acceptError" color="error" :title="acceptError" />

      <ZButton size="lg" block :loading="accepting" :disabled="!preview.emailMatches" @click="accept()">
        Tham gia quán
      </ZButton>
    </div>
  </AppAuthShell>
</template>
```

- [ ] **Step 5: Trang nhân viên `/app/team`**

`app/pages/app/team.vue`:

```vue
<script setup lang="ts">
import { inviteInputSchema } from '#shared/schemas/team'
import type { CreatedInvitation, TeamMember, TeamResponse } from '#shared/types/team'

definePageMeta({ layout: 'owner', middleware: ['auth', 'has-store'] })
useHead({ title: 'Nhân viên' })

const api = useApi()
const toast = useToast()
const { activeStore } = useActiveStore()
const isOwner = computed(() => activeStore.value?.role === 'OWNER')

const { data: team, status, refresh } = await useAsyncData(
  'team',
  async () => {
    const id = activeStore.value?.id
    return id && isOwner.value ? await api<TeamResponse>(`/api/stores/${id}/team`) : null
  },
  { watch: [() => activeStore.value?.id] },
)

const email = ref('')
const inviting = ref(false)
const formError = ref<string | null>(null)
const created = ref<CreatedInvitation | null>(null)

async function invite() {
  if (!activeStore.value) return
  const parsed = inviteInputSchema.safeParse({ email: email.value })
  if (!parsed.success) {
    formError.value = 'Email không hợp lệ'
    return
  }
  inviting.value = true
  formError.value = null
  try {
    created.value = await api<CreatedInvitation>(`/api/stores/${activeStore.value.id}/team/invitations`, { method: 'POST', body: parsed.data })
    email.value = ''
    await refresh()
  }
  catch (err) {
    const error = extractApiError(err)
    const reason = (error.details as { reason?: string } | undefined)?.reason
    formError.value = reason === 'ALREADY_MEMBER' ? 'Người này đã là thành viên của quán.' : error.message
  }
  finally {
    inviting.value = false
  }
}

async function setStatus(member: TeamMember, next: 'ACTIVE' | 'DISABLED') {
  try {
    await api(`/api/stores/${activeStore.value!.id}/team/${member.userId}`, { method: 'PATCH', body: { status: next } })
    toast.add({ color: 'success', title: next === 'DISABLED' ? 'Đã khóa nhân viên' : 'Đã mở lại nhân viên' })
    await refresh()
  }
  catch (err) {
    toast.add({ color: 'error', title: extractApiError(err).message })
  }
}

async function revoke(id: string) {
  try {
    await api(`/api/stores/${activeStore.value!.id}/team/invitations/${id}`, { method: 'DELETE' })
    await refresh()
  }
  catch (err) {
    toast.add({ color: 'error', title: extractApiError(err).message })
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <AppPageHeader title="Nhân viên" description="Mời nhân viên bằng link và quản lý quyền vào quán." />

    <ZAlert v-if="!isOwner" color="info" title="Chỉ chủ cửa hàng mới quản lý được nhân viên." />

    <template v-else>
      <ZCard title="Mời nhân viên" description="Tạo link rồi tự gửi qua Zalo hoặc tin nhắn. Nhân viên cần đăng nhập bằng đúng email này." padding="lg">
        <form class="flex flex-col gap-4" @submit.prevent="invite">
          <ZFormField label="Email nhân viên" name="email">
            <ZInput v-model="email" type="email" size="lg" inputmode="email" autocomplete="off" placeholder="nhanvien@gmail.com" />
          </ZFormField>
          <ZAlert v-if="formError" color="error" :title="formError" />
          <ZButton type="submit" size="lg" block :loading="inviting" :disabled="!email">
            Tạo lời mời
          </ZButton>
        </form>

        <div v-if="created" class="mt-5 flex flex-col gap-3 border-t border-default pt-5" data-testid="invite-result">
          <ZAlert color="success" title="Đã tạo lời mời" :description="`Link chỉ hiện một lần và hết hạn sau 7 ngày. Gửi cho ${created.invitation.email}.`" />
          <AppCopyField :value="created.inviteUrl" label="Link lời mời" />
          <ZButton variant="ghost" @click="created = null">
            Xong, ẩn link
          </ZButton>
        </div>
      </ZCard>

      <div v-if="status === 'pending' && !team" class="flex flex-col gap-3" aria-busy="true" aria-label="Đang tải danh sách">
        <USkeleton v-for="i in 3" :key="i" class="h-16 w-full rounded-md" />
      </div>

      <ZAlert v-else-if="status === 'error'" color="error" title="Không tải được danh sách nhân viên">
        <template #actions>
          <ZButton variant="secondary" size="sm" icon="i-lucide-refresh-cw" @click="refresh()">
            Thử lại
          </ZButton>
        </template>
      </ZAlert>

      <template v-else-if="team">
        <ZCard title="Thành viên" padding="lg">
          <ul class="flex flex-col divide-y divide-(--zeno-border)">
            <li v-for="member in team.members" :key="member.userId" class="flex flex-wrap items-center justify-between gap-3 py-3" :data-testid="`member-${member.email}`">
              <div class="min-w-0">
                <p class="truncate font-medium text-default">{{ member.displayName || member.email }}</p>
                <p class="truncate text-sm text-muted">{{ member.email }}</p>
              </div>
              <div class="flex items-center gap-2">
                <ZBadge :status="member.role === 'OWNER' ? 'info' : 'neutral'">{{ member.role === 'OWNER' ? 'Chủ quán' : 'Nhân viên' }}</ZBadge>
                <ZBadge v-if="member.status === 'DISABLED'" status="error">Đã khóa</ZBadge>
                <ZButton v-if="member.canDisable && member.status === 'ACTIVE'" variant="secondary" size="sm" @click="setStatus(member, 'DISABLED')">
                  Khóa
                </ZButton>
                <ZButton v-if="member.canDisable && member.status === 'DISABLED'" variant="secondary" size="sm" @click="setStatus(member, 'ACTIVE')">
                  Mở lại
                </ZButton>
              </div>
            </li>
          </ul>
        </ZCard>

        <ZCard v-if="team.invitations.length" title="Lời mời đang chờ" padding="lg">
          <ul class="flex flex-col divide-y divide-(--zeno-border)">
            <li v-for="invitation in team.invitations" :key="invitation.id" class="flex flex-wrap items-center justify-between gap-3 py-3">
              <div class="min-w-0">
                <p class="truncate font-medium text-default">{{ invitation.email }}</p>
                <p class="text-sm text-muted">{{ invitation.expired ? 'Đã hết hạn' : `Hết hạn ${formatDateTime(invitation.expiresAt)}` }}</p>
              </div>
              <ZButton variant="ghost" size="sm" @click="revoke(invitation.id)">
                Thu hồi
              </ZButton>
            </li>
          </ul>
        </ZCard>
      </template>
    </template>
  </div>
</template>
```

- [ ] **Step 6: Trang báo cáo `/app/reports`**

`app/pages/app/reports.vue`:

```vue
<script setup lang="ts">
import { formatVnd } from '#shared/money'
import type { DailySummary, Report } from '#shared/types/reports'
import type { ReportRange } from '#shared/vn-date'

definePageMeta({ layout: 'owner', middleware: ['auth', 'has-store'] })
useHead({ title: 'Báo cáo' })

const api = useApi()
const { activeStore } = useActiveStore()
const isOwner = computed(() => activeStore.value?.role === 'OWNER')
const range = ref<ReportRange>('7d')
const RANGES: { value: ReportRange, label: string }[] = [
  { value: 'today', label: 'Hôm nay' },
  { value: '7d', label: '7 ngày' },
  { value: '30d', label: '30 ngày' },
]

const { data: summary, status: summaryStatus, error: summaryError, refresh: refreshSummary } = await useAsyncData(
  'report-summary',
  async () => {
    const id = activeStore.value?.id
    return id ? await api<DailySummary>(`/api/stores/${id}/summary`) : null
  },
  { watch: [() => activeStore.value?.id] },
)

const { data: report, status: reportStatus, error: reportError, refresh: refreshReport } = await useAsyncData(
  'report-range',
  async () => {
    const id = activeStore.value?.id
    return id && isOwner.value ? await api<Report>(`/api/stores/${id}/reports`, { query: { range: range.value } }) : null
  },
  { watch: [() => activeStore.value?.id, range] },
)

const summaryStats = computed(() => {
  const s = summary.value
  if (!s) return []
  return [
    { label: 'Tổng đơn', value: String(s.totalOrders) },
    { label: 'Hoàn tất', value: String(s.completedCount) },
    { label: 'Đã hủy', value: String(s.cancelledCount) },
    { label: 'Giá trị đơn', value: formatVnd(s.grossVnd) },
    { label: 'Đã thu', value: formatVnd(s.collectedVnd) },
    { label: 'Còn chưa thu', value: formatVnd(s.outstandingVnd) },
  ]
})

const reportStats = computed(() => {
  const r = report.value
  if (!r) return []
  return [
    { label: 'Giá trị đơn', value: formatVnd(r.grossVnd) },
    { label: 'Đã thu', value: formatVnd(r.collectedVnd) },
    { label: 'Số đơn', value: String(r.orderCount) },
    { label: 'Trung bình/đơn', value: formatVnd(r.averageOrderVnd) },
  ]
})

const maxGross = computed(() => Math.max(1, ...(report.value?.daily.map(day => day.grossVnd) ?? [1])))
const shortDate = (date: string) => `${date.slice(8)}/${date.slice(5, 7)}`
</script>

<template>
  <div class="flex flex-col gap-6">
    <AppPageHeader title="Báo cáo" description="Tính theo ngày giờ Việt Nam. Đã thu lấy từ các khoản thanh toán đã ghi nhận." />

    <section class="flex flex-col gap-3" aria-labelledby="today-heading">
      <h2 id="today-heading" class="text-h3 text-default">
        Hôm nay<span v-if="summary" class="text-sm font-normal text-muted"> · {{ summary.date }}</span>
      </h2>
      <div v-if="summaryStatus === 'pending' && !summary" class="grid grid-cols-2 gap-3" aria-busy="true" aria-label="Đang tải báo cáo">
        <USkeleton v-for="i in 6" :key="i" class="h-20 w-full rounded-md" />
      </div>
      <ZAlert v-else-if="summaryError" color="error" title="Không tải được báo cáo hôm nay">
        <template #actions>
          <ZButton variant="secondary" size="sm" icon="i-lucide-refresh-cw" @click="refreshSummary()">
            Thử lại
          </ZButton>
        </template>
      </ZAlert>
      <template v-else-if="summary">
        <ul class="grid grid-cols-2 gap-3">
          <li v-for="stat in summaryStats" :key="stat.label">
            <ZCard variant="flat" padding="md">
              <p class="text-sm text-muted">{{ stat.label }}</p>
              <p class="font-mono text-xl font-semibold text-default">{{ stat.value }}</p>
            </ZCard>
          </li>
        </ul>
        <ZCard variant="flat" padding="md" title="Đã thu theo hình thức">
          <ul class="flex flex-col gap-1 text-sm">
            <li class="flex justify-between"><span class="text-muted">Tiền mặt</span><span class="font-mono">{{ formatVnd(summary.collected.CASH) }}</span></li>
            <li class="flex justify-between"><span class="text-muted">Chuyển khoản (SePay)</span><span class="font-mono">{{ formatVnd(summary.collected.SEPAY) }}</span></li>
            <li class="flex justify-between"><span class="text-muted">Chuyển khoản (xác nhận tay)</span><span class="font-mono">{{ formatVnd(summary.collected.BANK_MANUAL) }}</span></li>
            <li v-if="summary.refundDueVnd > 0" class="flex justify-between text-(--zeno-text)"><span>Cần hoàn tiền</span><span class="font-mono">{{ formatVnd(summary.refundDueVnd) }}</span></li>
          </ul>
        </ZCard>
      </template>
    </section>

    <section v-if="isOwner" class="flex flex-col gap-3" aria-labelledby="trend-heading">
      <h2 id="trend-heading" class="text-h3 text-default">Xu hướng</h2>
      <div role="tablist" aria-label="Khoảng thời gian" class="flex gap-2">
        <button
          v-for="option in RANGES"
          :key="option.value"
          type="button"
          role="tab"
          :aria-selected="range === option.value"
          class="flex min-h-12 flex-1 items-center justify-center rounded-full border px-4 font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          :class="range === option.value ? 'border-primary bg-primary text-(--zeno-on-primary)' : 'border-default bg-(--zeno-surface) text-muted'"
          @click="range = option.value"
        >
          {{ option.label }}
        </button>
      </div>

      <div v-if="reportStatus === 'pending' && !report" class="grid grid-cols-2 gap-3" aria-busy="true" aria-label="Đang tải báo cáo">
        <USkeleton v-for="i in 4" :key="i" class="h-20 w-full rounded-md" />
      </div>
      <ZAlert v-else-if="reportError" color="error" title="Không tải được báo cáo">
        <template #actions>
          <ZButton variant="secondary" size="sm" icon="i-lucide-refresh-cw" @click="refreshReport()">
            Thử lại
          </ZButton>
        </template>
      </ZAlert>
      <template v-else-if="report">
        <ul class="grid grid-cols-2 gap-3">
          <li v-for="stat in reportStats" :key="stat.label">
            <ZCard variant="flat" padding="md">
              <p class="text-sm text-muted">{{ stat.label }}</p>
              <p class="font-mono text-xl font-semibold text-default">{{ stat.value }}</p>
            </ZCard>
          </li>
        </ul>

        <ZCard v-if="report.daily.length > 1" variant="flat" padding="md" title="Giá trị đơn theo ngày">
          <div class="flex h-32 items-end gap-1" role="img" :aria-label="`Biểu đồ giá trị đơn ${report.daily.length} ngày`">
            <div
              v-for="day in report.daily"
              :key="day.date"
              class="min-w-1 flex-1 rounded-t-sm bg-primary/70"
              :style="{ height: `${Math.max(2, Math.round((day.grossVnd / maxGross) * 100))}%` }"
              :title="`${shortDate(day.date)}: ${formatVnd(day.grossVnd)}`"
            />
          </div>
          <p class="mt-2 flex justify-between text-[13px] text-muted">
            <span>{{ shortDate(report.fromDate) }}</span><span>{{ shortDate(report.toDate) }}</span>
          </p>
        </ZCard>

        <ZCard variant="flat" padding="md" title="Món bán chạy">
          <ol v-if="report.topProducts.length" class="flex flex-col gap-2">
            <li v-for="(product, index) in report.topProducts" :key="product.name" class="flex items-baseline justify-between gap-3">
              <span class="min-w-0 truncate"><span class="font-mono text-muted">{{ index + 1 }}.</span> {{ product.name }}</span>
              <span class="shrink-0 text-sm text-muted">{{ product.qty }} ly · <span class="font-mono">{{ formatVnd(product.revenueVnd) }}</span></span>
            </li>
          </ol>
          <p v-else class="text-sm text-muted">Chưa có đơn nào trong khoảng này.</p>
        </ZCard>
      </template>
    </section>
  </div>
</template>
```

- [ ] **Step 7: Kiểm tra tĩnh + test**

Run: `npm run lint && npm run typecheck && npm run test:unit && npm run test:nuxt`
Expected: xanh. Nếu lint báo `UBadge`/`UCard`… trong `pages/`, thay bằng `Z*` tương ứng (các trang trên chỉ dùng `USkeleton`).

- [ ] **Step 8: Commit**

```bash
git add app/utils/after-signup.ts app/utils/invite-errors.ts app/pages/app/team.vue app/pages/app/reports.vue "app/pages/invite/[token].vue" app/layouts/owner.vue app/pages/signup.vue app/pages/login.vue tests/unit/app/after-signup.test.ts tests/unit/app/invite-errors.test.ts
git commit -m "feat(owner): add team page, invite acceptance page, reports page and role-based nav" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 11: E2E — owner + staff (hai browser context), xung đột trạng thái, mời nhân viên, hủy/thu tiền, báo cáo

**Files:**
- Create: `tests/e2e/owner-ops.spec.ts`, `tests/e2e/support/flows.ts`, `tests/e2e/tsconfig.json`
- Modify: `playwright.config.ts`
- (Không commit) `.env.test`, `.env`: thêm `INVITE_REQUIRE_VERIFIED_EMAIL=false`

**Interfaces:**
- Consumes: toàn bộ UI Task 9–10; `createOrderRow`, `createOrderItem` (Task 1); `getDb`, `closeDb`; `expectNoHorizontalOverflow` (`tests/e2e/support/layout.ts`).
- Produces: `signUpAndOnboard(page, opts)`, `stampOf(testInfo, tag?)`, `seedCodOrder(slug, overrides?)`, `countEvents(orderId)` cho các spec E2E sau (PR5/PR6 dùng để dựng đơn).

Điều kiện chạy: dev server chạy với `.env.test` (Playwright tự khởi động). Neon Auth của môi trường test không bắt xác minh email nên cần `INVITE_REQUIRE_VERIFIED_EMAIL=false` trong `.env.test` (file không commit, giống các biến khác).

- [ ] **Step 1: Cấu hình để E2E import được code server**

`tests/e2e/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": { "#shared/*": ["../../shared/*"] }
  }
}
```

`playwright.config.ts`: thêm ngay sau dòng `testDir: 'tests/e2e',`:

```ts
  tsconfig: 'tests/e2e/tsconfig.json',
```

Thêm vào `.env.test` (và `.env` nếu chạy `npm run dev` để thử tay) dòng:

```
INVITE_REQUIRE_VERIFIED_EMAIL=false
```

- [ ] **Step 2: Viết helper**

`tests/e2e/support/flows.ts`:

```ts
import { expect, type Page, type TestInfo } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { getDb } from '../../../server/db/client'
import { orderEvents, stores } from '../../../server/db/schema'
import { createOrderItem, createOrderRow } from '../../support/order-fixtures'

export const PASSWORD = 'E2e-Password-123'

export const stampOf = (testInfo: TestInfo, tag = '') =>
  `${Date.now().toString(36)}${tag}${testInfo.project.name === 'mobile-safari' ? 's' : 'c'}`

export async function signUpAndOnboard(page: Page, opts: { name: string, email: string, storeName: string, slug: string }) {
  await page.goto('/signup')
  await page.getByLabel('Tên của bạn').fill(opts.name)
  await page.getByLabel('Email').fill(opts.email)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Tạo tài khoản' }).click()
  await expect(page).toHaveURL(/\/onboarding$/)
  await page.getByLabel('Tên doanh nghiệp').fill(`${opts.storeName} Group`)
  await page.getByLabel('Tên cửa hàng').fill(opts.storeName)
  await page.getByLabel('Đường dẫn cửa hàng').fill(opts.slug)
  await page.getByRole('button', { name: 'Tạo cửa hàng' }).click()
  await expect(page).toHaveURL(/\/app\/orders$/)
}

export async function seedCodOrder(slug: string, overrides: Parameters<typeof createOrderRow>[1] = {}) {
  const [store] = await getDb().select().from(stores).where(eq(stores.slug, slug))
  if (!store) throw new Error(`Store ${slug} not found`)
  const order = await createOrderRow(store, overrides)
  await createOrderItem(order, { nameSnapshot: 'Trà đào cam sả', qty: 2, lineTotalVnd: order.totalVnd })
  return order
}

export async function countEvents(orderId: string): Promise<number> {
  return (await getDb().select().from(orderEvents).where(eq(orderEvents.orderId, orderId))).length
}
```

- [ ] **Step 3: Viết E2E**

`tests/e2e/owner-ops.spec.ts`:

```ts
import { expect, test, type Locator, type Page } from '@playwright/test'
import { closeDb } from '../../server/db/client'
import { expectNoHorizontalOverflow } from './support/layout'
import { PASSWORD, countEvents, seedCodOrder, signUpAndOnboard, stampOf } from './support/flows'

test.afterAll(async () => {
  await closeDb()
})

async function expectTouchTarget(locator: Locator) {
  await expect(locator).toBeVisible()
  await expect.poll(async () => (await locator.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
}

const card = (page: Page, code: string) => page.getByTestId(`order-card-${code}`)
const tab = (page: Page, name: RegExp) => page.getByRole('tab', { name })

test('owner and staff serve a COD order end to end', async ({ browser }, testInfo) => {
  test.slow()
  const stamp = stampOf(testInfo)
  const slug = `ops-${stamp}`
  const staffEmail = `e2e+${stamp}staff@example.com`
  const context = { viewport: { width: 360, height: 740 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', baseURL: testInfo.project.use.baseURL }
  const ownerContext = await browser.newContext(context)
  const staffContext = await browser.newContext(context)
  const owner = await ownerContext.newPage()
  const staff = await staffContext.newPage()

  await signUpAndOnboard(owner, { name: 'Chủ Quán Ops', email: `e2e+${stamp}owner@example.com`, storeName: 'Quán Ops', slug })

  // Hai đơn COD vừa vào quán.
  const orderA = await seedCodOrder(slug, { fulfillmentType: 'PICKUP', totalVnd: 60_000, subtotalVnd: 60_000 })
  const orderB = await seedCodOrder(slug, { fulfillmentType: 'DINE_IN', totalVnd: 45_000, subtotalVnd: 45_000 })
  await owner.reload()

  // Một chạm để chuyển đơn sang bước tiếp theo.
  await expect(card(owner, orderA.publicCode)).toBeVisible()
  await expect(tab(owner, /^Mới\s*2/)).toBeVisible()
  const start = card(owner, orderA.publicCode).getByRole('button', { name: 'Bắt đầu làm' })
  await expectTouchTarget(start)
  await expectNoHorizontalOverflow(owner)
  await start.click()
  await expect(card(owner, orderA.publicCode)).toHaveCount(0)
  await expect(tab(owner, /^Mới\s*1/)).toBeVisible()
  await tab(owner, /^Đang làm/).click()
  await expect(card(owner, orderA.publicCode).getByRole('button', { name: 'Đã xong' })).toBeVisible()

  // Mời nhân viên: link hiện một lần.
  await owner.goto('/app/team')
  await owner.getByLabel('Email nhân viên').fill(staffEmail)
  await owner.getByRole('button', { name: 'Tạo lời mời' }).click()
  const inviteUrl = await owner.getByLabel('Link lời mời').inputValue()
  expect(inviteUrl).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/)
  await owner.reload()
  await expect(owner.getByTestId('invite-result')).toHaveCount(0)
  await expect(owner.getByText(staffEmail)).toBeVisible()

  // Nhân viên đăng ký qua link mời (không bị đẩy vào onboarding) rồi tham gia quán.
  const invitePath = new URL(inviteUrl).pathname
  await staff.goto(`/signup?redirect=${encodeURIComponent(invitePath)}`)
  await staff.getByLabel('Tên của bạn').fill('Nhân Viên Ops')
  await staff.getByLabel('Email').fill(staffEmail)
  await staff.getByLabel('Mật khẩu', { exact: true }).fill(PASSWORD)
  await staff.getByRole('button', { name: 'Tạo tài khoản' }).click()
  await expect(staff).toHaveURL(new RegExp(`${invitePath}$`))
  await expect(staff.getByTestId('invite-store-name')).toHaveText('Quán Ops')
  await staff.getByRole('button', { name: 'Tham gia quán' }).click()
  await expect(staff).toHaveURL(/\/app\/orders$/)
  await expect(staff.getByTestId('active-store-name')).toHaveText('Quán Ops')
  await expect(staff.getByRole('link', { name: 'Nhân viên', exact: true })).toHaveCount(0)
  await staff.goto('/app/team')
  await expect(staff.getByText('Chỉ chủ cửa hàng mới quản lý được nhân viên.')).toBeVisible()

  // Review Focus #9: hai người cùng bấm một đơn, một người thắng, người kia thấy báo và danh sách được tải lại.
  await owner.goto('/app/orders')
  await staff.goto('/app/orders')
  await expect(card(owner, orderB.publicCode)).toBeVisible()
  await expect(card(staff, orderB.publicCode)).toBeVisible()
  const boardPoll = /\/api\/stores\/[^/]+\/orders\?/
  await staff.route(boardPoll, route => route.abort()) // giữ màn hình nhân viên "cũ"
  await card(owner, orderB.publicCode).getByRole('button', { name: 'Bắt đầu làm' }).click()
  await expect(card(owner, orderB.publicCode)).toHaveCount(0)

  const conflict = staff.waitForResponse(res => res.url().includes('/status') && res.status() === 409)
  await card(staff, orderB.publicCode).getByRole('button', { name: 'Bắt đầu làm' }).click()
  await conflict
  await expect(staff.getByText('Đơn vừa được người khác cập nhật')).toBeVisible()
  await expect(staff.getByText('Không cập nhật được, đang thử lại…')).toBeVisible() // poll lỗi: giữ danh sách cũ + cảnh báo
  await staff.unroute(boardPoll)
  await expect(card(staff, orderB.publicCode)).toHaveCount(0, { timeout: 15_000 })
  await expect(staff.getByText('Không cập nhật được, đang thử lại…')).toHaveCount(0)
  await tab(staff, /^Đang làm/).click()
  await expect(card(staff, orderB.publicCode)).toBeVisible()
  expect(await countEvents(orderB.id)).toBe(1)

  // Thu tiền mặt rồi hủy: staff không được hủy đơn đã thu, owner thì được và đơn thành "Cần hoàn tiền".
  const staffDialog = staff.getByRole('dialog')
  await card(staff, orderA.publicCode).getByRole('button', { name: /Xem chi tiết đơn/ }).click()
  await staffDialog.getByRole('button', { name: 'Đã thu tiền mặt' }).click()
  await expect(staffDialog.getByText(/Đã thu 60\.000đ bằng tiền mặt/)).toBeVisible()
  await expect(staffDialog.getByText('Đơn đã thu tiền — chỉ chủ quán được hủy')).toBeVisible()
  await expect(staffDialog.getByRole('button', { name: 'Hủy đơn' })).toHaveCount(0)
  await staff.keyboard.press('Escape')

  await owner.reload()
  await tab(owner, /^Đang làm/).click()
  const ownerDialog = owner.getByRole('dialog')
  await card(owner, orderA.publicCode).getByRole('button', { name: /Xem chi tiết đơn/ }).click()
  await ownerDialog.getByRole('button', { name: 'Hủy đơn' }).click()
  await expect(ownerDialog.getByRole('button', { name: 'Xác nhận hủy đơn' })).toBeDisabled()
  await ownerDialog.getByRole('button', { name: 'Hết nguyên liệu' }).click()
  await ownerDialog.getByRole('button', { name: 'Xác nhận hủy đơn' }).click()
  await expect(ownerDialog.getByText('Đã hủy — Hết nguyên liệu')).toBeVisible()
  await expect(ownerDialog.getByText('Cần hoàn tiền').first()).toBeVisible()
  await owner.keyboard.press('Escape')
  await tab(owner, /^Khác/).click()
  await expect(card(owner, orderA.publicCode)).toBeVisible()

  // Báo cáo: owner thấy xu hướng, staff chỉ thấy "Hôm nay"; không tràn ngang ở 360px.
  await owner.goto('/app/reports')
  await expect(owner.getByRole('heading', { name: /Hôm nay/ })).toBeVisible()
  await expect(owner.getByRole('heading', { name: 'Xu hướng' })).toBeVisible()
  await expectNoHorizontalOverflow(owner)
  await staff.goto('/app/reports')
  await expect(staff.getByRole('heading', { name: /Hôm nay/ })).toBeVisible()
  await expect(staff.getByRole('heading', { name: 'Xu hướng' })).toHaveCount(0)

  // Khóa nhân viên có hiệu lực ngay: lần tải sau họ không còn quán nào.
  await owner.goto('/app/team')
  await owner.getByTestId(`member-${staffEmail}`).getByRole('button', { name: 'Khóa' }).click()
  await expect(owner.getByTestId(`member-${staffEmail}`).getByText('Đã khóa')).toBeVisible()
  await staff.goto('/app/orders')
  await expect(staff).toHaveURL(/\/onboarding$/)

  await ownerContext.close()
  await staffContext.close()
})

test('an invitation link used with the wrong account is rejected and stays usable', async ({ browser }, testInfo) => {
  test.slow()
  const stamp = stampOf(testInfo, 'w')
  const slug = `ops-wrong-${stamp}`
  const context = { viewport: { width: 360, height: 740 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', baseURL: testInfo.project.use.baseURL }
  const ownerContext = await browser.newContext(context)
  const strangerContext = await browser.newContext(context)
  const owner = await ownerContext.newPage()
  const stranger = await strangerContext.newPage()

  await signUpAndOnboard(owner, { name: 'Chủ Quán W', email: `e2e+${stamp}owner@example.com`, storeName: 'Quán W', slug })
  await owner.goto('/app/team')
  await owner.getByLabel('Email nhân viên').fill(`e2e+${stamp}right@example.com`)
  await owner.getByRole('button', { name: 'Tạo lời mời' }).click()
  const invitePath = new URL(await owner.getByLabel('Link lời mời').inputValue()).pathname

  await stranger.goto(`/signup?redirect=${encodeURIComponent(invitePath)}`)
  await stranger.getByLabel('Tên của bạn').fill('Người Lạ')
  await stranger.getByLabel('Email').fill(`e2e+${stamp}stranger@example.com`)
  await stranger.getByLabel('Mật khẩu', { exact: true }).fill(PASSWORD)
  await stranger.getByRole('button', { name: 'Tạo tài khoản' }).click()
  await expect(stranger).toHaveURL(new RegExp(`${invitePath}$`))
  await expect(stranger.getByText('Email không khớp với lời mời')).toBeVisible()
  await expect(stranger.getByRole('button', { name: 'Tham gia quán' })).toBeDisabled()

  // Lời mời vẫn còn hiệu lực cho người đúng email.
  await owner.reload()
  await expect(owner.getByText(`e2e+${stamp}right@example.com`)).toBeVisible()

  await ownerContext.close()
  await strangerContext.close()
})
```

- [ ] **Step 4: Chạy E2E**

Run: `npx playwright test tests/e2e/owner-ops.spec.ts --project=mobile-chrome`
Expected: PASS (2 test). Sau đó `npx playwright test tests/e2e/owner-ops.spec.ts --project=mobile-safari` cũng PASS. Nếu một locator không khớp vì nhãn nút bị icon chèn vào, dùng `getByRole('button', { name: /nhãn/ })` nhưng **không** đổi nhãn hiển thị.

- [ ] **Step 5: Chạy toàn bộ bộ test của PR**

Run: `npm run lint && npm run typecheck && npm run test && npm run test:integration && npm run test:api && npm run build`
Expected: tất cả xanh; `npm run db:check` sạch.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/owner-ops.spec.ts tests/e2e/support/flows.ts tests/e2e/tsconfig.json playwright.config.ts
git commit -m "test(owner): e2e for owner and staff board, invitation, conflict, cancel and reports" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## PR4 Exit Checklist (PRD Phase 3 exit: phục vụ được đơn trả khi nhận end-to-end)

- [ ] `npm run test:integration`, `npm run test:api`, `npm run test`, `npx playwright test tests/e2e/owner-ops.spec.ts` (chrome + safari) xanh; `npm run db:check` sạch; chỉ có **một** migration mới `owner_ops` và đã áp lên branch `test`.
- [ ] Review Focus #9 có test ở cả ba tầng: service (`Promise.all`), API (ma trận), E2E (hai context, 409 + toast + tải lại).
- [ ] Mọi route mới có hàng ma trận tenant (`ownerA`, `staffA1`, `staffA2`, `disabledA1`, `ownerB`) và 401 khi thiếu token.
- [ ] `.env.test`/`.env` local có `INVITE_REQUIRE_VERIFIED_EMAIL=false`; **production không đặt biến này**. Trước go-live (đưa vào checklist PR7): bật email verification trong Neon Auth và kiểm tra JWT thật có claim `emailVerified` (hoặc `email_verified`); nếu tên claim khác, sửa đúng một chỗ ở `server/auth/jwt.ts` và `tests/support/auth.ts`.
- [ ] Ghi vào spec/roadmap các quyết định lệch (cùng commit merge PR): (a) trang `/app/team` thay tab "Nhân viên" trong settings (spec §7, roadmap PR4 Task 6); (b) `emailVerified` bắt buộc theo cờ `INVITE_REQUIRE_VERIFIED_EMAIL`, mặc định bật (roadmap quy ước #7); (c) `GET …/reports` (7/30 ngày, top món) chỉ owner, `GET …/summary` staff được xem theo spec §8; (d) `order_payments` có `unique(order_id)` và PR6 phải thêm FK `bank_transaction_id` + unique-where-not-null ở migration của mình; (e) board poll lại trang đầu thay vì delta-poll (delta không biểu diễn được đơn rời tab); (f) `PATCH …/status` từ chối `nextStatus = CANCELLED`, hủy đi qua `POST …/cancel`; (g) token lời mời được che trong log lỗi bằng `redactPath` (đặt sau `safePath` của PR3); (h) migration `owner_ops` tạo `order_payments` và bổ sung index board `orders_board_idx` còn thiếu trong code PR3 thực tế.
- [ ] Cập nhật bảng trạng thái roadmap: PR4 → "Chi tiết, đã thực thi"; PR5/PR6 ghi chú các API ổn định họ dùng lại: `changeOrderStatus`/`transitionOrder` (chuyển `AWAITING_PAYMENT → NEW` của hệ thống dùng `transitionOrder` + `insertOrderEvent`, `actor_user_id = null` cần nới ở PR6 nếu cột NOT NULL), `statusConflict`, `recordCashPayment` (mẫu cho `BANK_MANUAL` owner-only), `listBoard` (`awaiting_payment` tab và `newOrderIds` đã sẵn sàng cho đơn VietQR), `AppOrderCard`/`AppOrderDetailSlideover`.
- [ ] CI xanh trên PR `feat(owner)`.

