import { describe, expect, it } from 'vitest'
import { checkoutInputSchema } from '#shared/schemas/checkout'
import { buildCheckoutPayload, checkoutFingerprint, type CheckoutForm } from '../../../app/utils/checkout-body'
import type { CartLine } from '../../../app/utils/cart-storage'

const UUID = '3f6c1a52-8d0e-4b7a-9c11-2e5d7f0a9b34'
const ZONE = '6a1d2c33-5b4e-4f10-8a77-0c9e1d2b3a45'
const PRODUCT = '9b8a7c66-1d2e-4a3b-8c4d-5e6f7a8b9c01'
const OPTION = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f'

const line = (over: Partial<CartLine> = {}): CartLine => ({
  lineId: 'l1',
  productId: PRODUCT,
  name: 'Trà sữa',
  optionValueIds: [OPTION],
  optionLabels: ['M'],
  unitPriceVnd: 35_000,
  quantity: 2,
  note: '',
  stale: null,
  currentUnitPriceVnd: null,
  ...over,
})

const form = (over: Partial<CheckoutForm> = {}): CheckoutForm => ({
  customer: { name: '  Lan ', phone: '0912 345 678', address: ' 12 Lê Lợi ' },
  deliveryZoneId: ZONE,
  note: '',
  ...over,
})

const base = { lines: [line()], paymentMethod: 'PAY_ON_RECEIPT' as const, deliveryFeeVnd: 15_000 }

const accepted = (payload: object) => checkoutInputSchema.safeParse({ ...payload, idempotencyKey: UUID })

describe('buildCheckoutPayload', () => {
  it('builds a pickup payload without table, zone or address, and the server schema accepts it', () => {
    const payload = buildCheckoutPayload({ ...base, form: form(), fulfillmentType: 'PICKUP', tableToken: 'tok' })
    expect(payload).toEqual({
      fulfillmentType: 'PICKUP',
      customer: { name: 'Lan', phone: '0912 345 678' },
      items: [{ productId: PRODUCT, quantity: 2, optionValueIds: [OPTION], expectedUnitPriceVnd: 35_000 }],
      paymentMethod: 'PAY_ON_RECEIPT',
      expectedTotalVnd: 70_000,
    })
    expect(accepted(payload).success).toBe(true)
  })

  it('builds a dine-in payload with only the table token when the customer typed nothing', () => {
    const payload = buildCheckoutPayload({ ...base, form: form({ customer: { name: '', phone: '', address: '' } }), fulfillmentType: 'DINE_IN', tableToken: 'tok-123' })
    expect(payload).toMatchObject({ fulfillmentType: 'DINE_IN', tableToken: 'tok-123', customer: {} })
    expect(payload).not.toHaveProperty('deliveryZoneId')
    expect(accepted(payload).success).toBe(true)
  })

  it('builds a delivery payload: zone, address and the fee in the expected total', () => {
    const payload = buildCheckoutPayload({ ...base, form: form(), fulfillmentType: 'DELIVERY', tableToken: null })
    expect(payload).toMatchObject({
      fulfillmentType: 'DELIVERY',
      deliveryZoneId: ZONE,
      customer: { name: 'Lan', phone: '0912 345 678', address: '12 Lê Lợi' },
      expectedTotalVnd: 85_000,
    })
    expect(accepted(payload).success).toBe(true)
  })

  it('includes item and order notes only when they have text', () => {
    const withNotes = buildCheckoutPayload({ ...base, lines: [line({ note: ' ít đá ' })], form: form({ note: ' gọi trước ' }), fulfillmentType: 'PICKUP', tableToken: null })
    expect(withNotes.items![0]).toMatchObject({ note: 'ít đá' })
    expect(withNotes).toMatchObject({ note: 'gọi trước' })
    const without = buildCheckoutPayload({ ...base, form: form({ note: '   ' }), fulfillmentType: 'PICKUP', tableToken: null })
    expect(without).not.toHaveProperty('note')
    expect(without.items![0]).not.toHaveProperty('note')
  })

  it('a delivery form missing the zone is rejected by the same schema the server uses', () => {
    const payload = buildCheckoutPayload({ ...base, form: form({ deliveryZoneId: null }), fulfillmentType: 'DELIVERY', tableToken: null })
    expect(accepted(payload).success).toBe(false)
  })
})

describe('checkoutFingerprint', () => {
  const make = (over: Partial<CartLine> = {}) =>
    buildCheckoutPayload({ ...base, lines: [line(over)], form: form(), fulfillmentType: 'PICKUP', tableToken: null })

  it('is identical for identical input and different after any change', () => {
    expect(checkoutFingerprint(make())).toBe(checkoutFingerprint(make()))
    expect(checkoutFingerprint(make())).not.toBe(checkoutFingerprint(make({ quantity: 3 })))
    expect(checkoutFingerprint(make())).not.toBe(checkoutFingerprint(make({ unitPriceVnd: 36_000 })))
  })
})
