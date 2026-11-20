import { describe, expect, it } from 'vitest'
import { formatVnd } from '#shared/money'
import { FULFILLMENT_LABELS } from '#shared/order-flow'
import { buildOrderNotification } from '../../../server/services/push/notify'

describe('buildOrderNotification', () => {
  it('summarises a new order for the push payload', () => {
    expect(buildOrderNotification({ publicCode: 'A1B2C3', fulfillmentType: 'PICKUP', totalVnd: 70_000 })).toEqual({
      title: 'Đơn mới #A1B2C3',
      body: `${FULFILLMENT_LABELS.PICKUP} · ${formatVnd(70_000)}`,
      url: '/app/orders',
      tag: 'order-A1B2C3',
    })
  })

  it('labels delivery orders with their fulfillment', () => {
    expect(buildOrderNotification({ publicCode: 'X', fulfillmentType: 'DELIVERY', totalVnd: 0 }).body).toContain(FULFILLMENT_LABELS.DELIVERY)
  })
})
