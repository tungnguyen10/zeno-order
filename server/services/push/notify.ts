import { inArray } from 'drizzle-orm'
import type { FulfillmentType } from '#shared/enums'
import { formatVnd } from '#shared/money'
import { FULFILLMENT_LABELS } from '#shared/order-flow'
import type { Db } from '../../db/client'
import { pushSubscriptions } from '../../db/schema'
import { logger } from '../../utils/logger'
import { listStoreSubscriptions } from './subscriptions'
import { configureVapid, pushConfigured, webpush } from './vapid'

export interface NewOrderInfo {
  publicCode: string
  fulfillmentType: FulfillmentType
  totalVnd: number
}

export interface OrderNotification {
  title: string
  body: string
  url: string
  tag: string
}

export function buildOrderNotification(order: NewOrderInfo): OrderNotification {
  return {
    title: `Đơn mới #${order.publicCode}`,
    body: `${FULFILLMENT_LABELS[order.fulfillmentType]} · ${formatVnd(order.totalVnd)}`,
    url: '/app/orders',
    tag: `order-${order.publicCode}`,
  }
}

/** Best-effort push to the store's owner/staff devices. Never throws into the order flow; prunes dead endpoints. */
export async function notifyNewOrder(db: Db, scope: { orgId: string, storeId: string }, order: NewOrderInfo): Promise<void> {
  if (!pushConfigured()) return
  try {
    const subs = await listStoreSubscriptions(db, scope)
    if (subs.length === 0) return
    configureVapid()
    const payload = JSON.stringify(buildOrderNotification(order))
    const results = await Promise.allSettled(subs.map(sub =>
      webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)))

    const gone: string[] = []
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const status = (result.reason as { statusCode?: number } | null)?.statusCode
        if (status === 404 || status === 410) gone.push(subs[index]!.endpoint)
      }
    })
    if (gone.length > 0) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, gone))
  }
  catch (err) {
    logger.warn('push.notify_failed', { storeId: scope.storeId, err })
  }
}
