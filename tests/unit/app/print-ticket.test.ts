import { describe, expect, it } from 'vitest'
import { buildKitchenTicket, type TicketOrder } from '#shared/kitchen-ticket'
import { ticketHtml } from '../../../app/utils/print-ticket'

const order = (over: Partial<TicketOrder> = {}): TicketOrder => ({
  publicCode: 'A1B2C3',
  fulfillmentType: 'PICKUP',
  createdAt: '2026-11-18T05:00:00Z',
  items: [{ name: 'Trà sữa', qty: 2, options: ['Size L'], note: 'ít đá' }],
  ...over,
})

describe('ticketHtml', () => {
  it('renders code, place, items, options and note', () => {
    const html = ticketHtml(buildKitchenTicket(order()))
    expect(html).toContain('#A1B2C3')
    expect(html).toContain('Mang đi')
    expect(html).toContain('2×')
    expect(html).toContain('Trà sữa')
    expect(html).toContain('Size L')
    expect(html).toContain('* ít đá')
  })

  it('sets the page size to the requested paper width', () => {
    expect(ticketHtml(buildKitchenTicket(order()))).toContain('size: 80mm auto')
    expect(ticketHtml(buildKitchenTicket(order()), 58)).toContain('size: 58mm auto')
    expect(ticketHtml(buildKitchenTicket(order()), 58)).toContain('width: 50mm')
  })

  it('escapes HTML in customer-controlled fields', () => {
    const html = ticketHtml(buildKitchenTicket(order({
      items: [{ name: '<script>alert(1)</script>', qty: 1, options: [] }],
      customerName: 'A & B',
    })))
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('A &amp; B')
  })

  it('omits the meta block when there is no customer info', () => {
    const html = ticketHtml(buildKitchenTicket(order()))
    expect(html).not.toContain('class="meta"')
  })
})
