import { randomUUID } from 'node:crypto'
import { getDb } from '../../server/db/client'
import type { orders} from '../../server/db/schema';
import { orderItems, orderPayments, storeInvitations } from '../../server/db/schema'
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
