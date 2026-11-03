import { and, asc, eq } from 'drizzle-orm'
import type { PublicOrderView } from '#shared/types/order'
import { maskPhone } from '#shared/phone'
import type { DbOrTx } from '../../db/client'
import { orderItems, orders, stores } from '../../db/schema'
import { AppError } from '../../utils/errors'
import { hashToken } from '../../utils/tokens'
import { getActiveQrForOrder } from '../payments/attempts'

// Tokens are 32 random bytes in base64url; anything else cannot match, so skip the database.
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,64}$/

const notFound = () => new AppError('NOT_FOUND', 'Không tìm thấy đơn hàng')

export async function getPublicOrderView(db: DbOrTx, token: string): Promise<PublicOrderView> {
  if (!TOKEN_SHAPE.test(token)) throw notFound()

  const [order] = await db
    .select({
      id: orders.id,
      storeId: orders.storeId,
      publicCode: orders.publicCode,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      paymentMethod: orders.paymentMethod,
      fulfillmentType: orders.fulfillmentType,
      tableLabel: orders.tableLabel,
      deliveryZoneName: orders.deliveryZoneName,
      customerName: orders.customerName,
      customerPhone: orders.customerPhone,
      subtotalVnd: orders.subtotalVnd,
      deliveryFeeVnd: orders.deliveryFeeVnd,
      totalVnd: orders.totalVnd,
      createdAt: orders.createdAt,
      storeName: stores.name,
      storeSlug: stores.slug,
    })
    .from(orders)
    .innerJoin(stores, eq(stores.id, orders.storeId))
    .where(eq(orders.guestTokenHash, hashToken(token)))
    .limit(1)
  if (!order) throw notFound()

  const items = await db
    .select({
      name: orderItems.nameSnapshot,
      quantity: orderItems.qty,
      unitPriceVnd: orderItems.unitPriceVnd,
      lineTotalVnd: orderItems.lineTotalVnd,
      options: orderItems.optionsSnapshotJson,
      note: orderItems.note,
    })
    .from(orderItems)
    .where(and(eq(orderItems.storeId, order.storeId), eq(orderItems.orderId, order.id)))
    .orderBy(asc(orderItems.position))

  // Deliberately omitted: order id, org/store ids, full phone, address, order-level note.
  return {
    publicCode: order.publicCode,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    fulfillmentType: order.fulfillmentType,
    tableLabel: order.tableLabel,
    deliveryZoneName: order.deliveryZoneName,
    customerName: order.customerName,
    phoneMasked: maskPhone(order.customerPhone),
    items: items.map(item => ({
      name: item.name,
      quantity: item.quantity,
      unitPriceVnd: item.unitPriceVnd,
      lineTotalVnd: item.lineTotalVnd,
      options: item.options.map(option => ({ name: option.valueName, priceDeltaVnd: option.priceDeltaVnd })),
      note: item.note,
    })),
    subtotalVnd: order.subtotalVnd,
    deliveryFeeVnd: order.deliveryFeeVnd,
    totalVnd: order.totalVnd,
    createdAt: order.createdAt.toISOString(),
    store: { name: order.storeName, slug: order.storeSlug },
    qr: order.paymentMethod === 'BANK_QR' && order.status === 'AWAITING_PAYMENT' && order.paymentStatus === 'PENDING'
      ? await getActiveQrForOrder(db, { storeId: order.storeId, orderId: order.id })
      : null,
  }
}
