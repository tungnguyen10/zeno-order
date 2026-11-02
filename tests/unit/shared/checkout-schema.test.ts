import { describe, expect, it } from 'vitest'
import { CHECKOUT_LIMITS, checkoutInputSchema } from '#shared/schemas/checkout'

const UUID_A = '3f6c1a52-8d0e-4b7a-9c11-2e5d7f0a9b34'
const UUID_B = '6a1d2c33-5b4e-4f10-8a77-0c9e1d2b3a45'
const UUID_C = '9b8a7c66-1d2e-4a3b-8c4d-5e6f7a8b9c01'

const item = { productId: UUID_B, quantity: 2, optionValueIds: [UUID_C], expectedUnitPriceVnd: 35000 }

function body(over: Record<string, unknown> = {}) {
  return {
    idempotencyKey: UUID_A,
    fulfillmentType: 'PICKUP',
    customer: { name: 'Lan', phone: '0912345678' },
    items: [item],
    paymentMethod: 'PAY_ON_RECEIPT',
    expectedTotalVnd: 70000,
    ...over,
  }
}

function issuePaths(raw: unknown): string[] {
  const result = checkoutInputSchema.safeParse(raw)
  return result.success ? [] : result.error.issues.map(issue => issue.path.join('.'))
}

describe('checkoutInputSchema — happy paths', () => {
  it('normalises a pickup order', () => {
    const parsed = checkoutInputSchema.parse(body({ customer: { name: '  Lan  ', phone: '+84 912 345 678' }, note: '  ít đá ' }))
    expect(parsed).toEqual({
      idempotencyKey: UUID_A,
      fulfillmentType: 'PICKUP',
      tableToken: null,
      customer: { name: 'Lan', phone: '0912345678', address: null },
      deliveryZoneId: null,
      items: [{ productId: UUID_B, quantity: 2, optionValueIds: [UUID_C], note: null, expectedUnitPriceVnd: 35000 }],
      expectedTotalVnd: 70000,
      paymentMethod: 'PAY_ON_RECEIPT',
      note: 'ít đá',
    })
  })

  it('accepts dine-in with only a table token and nothing about the customer', () => {
    const parsed = checkoutInputSchema.parse(body({ fulfillmentType: 'DINE_IN', tableToken: 'x'.repeat(43), customer: {} }))
    expect(parsed.tableToken).toBe('x'.repeat(43))
    expect(parsed.customer).toEqual({ name: null, phone: null, address: null })
  })

  it('accepts a complete delivery order and keeps the address', () => {
    const parsed = checkoutInputSchema.parse(body({
      fulfillmentType: 'DELIVERY',
      deliveryZoneId: UUID_C,
      customer: { name: 'Lan', phone: '0912345678', address: ' 12 Lê Lợi, Quận 1 ' },
    }))
    expect(parsed.deliveryZoneId).toBe(UUID_C)
    expect(parsed.customer.address).toBe('12 Lê Lợi, Quận 1')
  })

  it('drops fields that do not belong to the fulfillment type', () => {
    const parsed = checkoutInputSchema.parse(body({
      tableToken: 'y'.repeat(43),
      deliveryZoneId: UUID_C,
      customer: { name: 'Lan', phone: '0912345678', address: 'Không dùng' },
    }))
    expect(parsed).toMatchObject({ tableToken: null, deliveryZoneId: null, customer: { address: null } })
  })

  it('defaults optionValueIds to an empty list', () => {
    const parsed = checkoutInputSchema.parse(body({ items: [{ productId: UUID_B, quantity: 1, expectedUnitPriceVnd: 20000 }] }))
    expect(parsed.items[0]!.optionValueIds).toEqual([])
  })

  it('stores HTML verbatim; escaping is the renderer\'s job', () => {
    const parsed = checkoutInputSchema.parse(body({ items: [{ ...item, note: '<img src=x onerror=alert(1)>' }] }))
    expect(parsed.items[0]!.note).toBe('<img src=x onerror=alert(1)>')
  })
})

describe('checkoutInputSchema — required fields per fulfillment', () => {
  it('requires a table token for dine-in', () => {
    expect(issuePaths(body({ fulfillmentType: 'DINE_IN', customer: {} }))).toEqual(['tableToken'])
  })

  it('requires name and phone for pickup', () => {
    expect(issuePaths(body({ customer: {} })).sort()).toEqual(['customer.name', 'customer.phone'])
  })

  it('treats whitespace-only name as missing', () => {
    expect(issuePaths(body({ customer: { name: '   ', phone: '0912345678' } }))).toEqual(['customer.name'])
  })

  it('requires zone and address for delivery', () => {
    expect(issuePaths(body({ fulfillmentType: 'DELIVERY' })).sort()).toEqual(['customer.address', 'deliveryZoneId'])
  })

  it('reports an invalid phone on the phone field, also for dine-in where it is optional', () => {
    expect(issuePaths(body({ customer: { name: 'Lan', phone: '0212345678' } }))).toEqual(['customer.phone'])
    expect(issuePaths(body({ fulfillmentType: 'DINE_IN', tableToken: 'x'.repeat(43), customer: { phone: '123' } }))).toEqual(['customer.phone'])
  })
})

describe('checkoutInputSchema — limits', () => {
  it('exposes the spec limits', () => {
    expect(CHECKOUT_LIMITS).toEqual({ maxLines: 30, maxQuantity: 50, maxNote: 200, maxName: 80, maxAddress: 300 })
  })

  it.each([
    ['quantity 0', { items: [{ ...item, quantity: 0 }] }, 'items.0.quantity'],
    ['quantity 51', { items: [{ ...item, quantity: 51 }] }, 'items.0.quantity'],
    ['fractional quantity', { items: [{ ...item, quantity: 1.5 }] }, 'items.0.quantity'],
    ['no items', { items: [] }, 'items'],
    ['31 lines', { items: Array.from({ length: 31 }, () => item) }, 'items'],
    ['201-char item note', { items: [{ ...item, note: 'a'.repeat(201) }] }, 'items.0.note'],
    ['81-char name', { customer: { name: 'a'.repeat(81), phone: '0912345678' } }, 'customer.name'],
    ['201-char order note', { note: 'a'.repeat(201) }, 'note'],
    ['negative expected price', { items: [{ ...item, expectedUnitPriceVnd: -1 }] }, 'items.0.expectedUnitPriceVnd'],
    ['negative expected total', { expectedTotalVnd: -1 }, 'expectedTotalVnd'],
    ['bad idempotency key', { idempotencyKey: 'not-a-uuid' }, 'idempotencyKey'],
    ['unknown payment method', { paymentMethod: 'CARD' }, 'paymentMethod'],
    ['unknown fulfillment', { fulfillmentType: 'DRIVE_THRU' }, 'fulfillmentType'],
    ['bad product id', { items: [{ ...item, productId: 'nope' }] }, 'items.0.productId'],
  ])('rejects %s', (_label, over, path) => {
    expect(issuePaths(body(over))).toContain(path)
  })

  it('rejects an address over 300 characters for delivery', () => {
    const raw = body({ fulfillmentType: 'DELIVERY', deliveryZoneId: UUID_C, customer: { name: 'Lan', phone: '0912345678', address: 'a'.repeat(301) } })
    expect(issuePaths(raw)).toEqual(['customer.address'])
  })
})
