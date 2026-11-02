import { renderSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import type { FulfillmentType, OrderStatus } from '#shared/enums'
import OrderStatusSteps from '~/components/order/StatusSteps.vue'

async function states(status: OrderStatus, fulfillmentType: FulfillmentType) {
  const { container } = await renderSuspended(OrderStatusSteps, { props: { status, fulfillmentType } })
  return [...container.querySelectorAll('li')].map(li => [li.textContent?.trim(), li.getAttribute('data-state')])
}

describe('OrderStatusSteps', () => {
  it('marks the current step and what is done before it', async () => {
    expect(await states('PREPARING', 'PICKUP')).toEqual([
      ['Đã gửi quán', 'done'],
      ['Quán đang làm món', 'current'],
      ['Sẵn sàng, mời bạn lấy món', 'todo'],
      ['Hoàn tất', 'todo'],
    ])
  })

  it('treats a skipped step as done (NEW → READY)', async () => {
    const result = await states('READY', 'DINE_IN')
    expect(result.map(([, state]) => state)).toEqual(['done', 'done', 'current', 'todo'])
  })

  it('adds the delivery step only for delivery orders', async () => {
    expect((await states('DELIVERING', 'DELIVERY')).map(([label]) => label)).toContain('Đang giao đến bạn')
    expect((await states('NEW', 'DINE_IN')).map(([label]) => label)).not.toContain('Đang giao đến bạn')
  })

  it('shows everything done when completed', async () => {
    expect((await states('COMPLETED', 'DELIVERY')).every(([, state]) => state === 'done')).toBe(true)
  })

  it('exposes the current step to assistive tech', async () => {
    const { container } = await renderSuspended(OrderStatusSteps, { props: { status: 'NEW', fulfillmentType: 'PICKUP' } })
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('Đã gửi quán')
  })
})
