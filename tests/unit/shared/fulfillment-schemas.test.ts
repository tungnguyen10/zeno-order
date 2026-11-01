import { describe, expect, it } from 'vitest'
import { createZoneInputSchema, updateFulfillmentInputSchema, updateZoneInputSchema } from '#shared/schemas/fulfillment'

describe('updateFulfillmentInputSchema', () => {
  it('accepts a partial toggle and rejects an empty or non-boolean patch', () => {
    expect(updateFulfillmentInputSchema.safeParse({ deliveryEnabled: true }).success).toBe(true)
    expect(updateFulfillmentInputSchema.safeParse({}).success).toBe(false)
    expect(updateFulfillmentInputSchema.safeParse({ pickupEnabled: 'yes' }).success).toBe(false)
  })
})

describe('delivery zone schemas', () => {
  it('requires a name and a non-negative integer fee', () => {
    expect(createZoneInputSchema.parse({ name: ' Quận 1 ', feeVnd: 15000 })).toEqual({ name: 'Quận 1', feeVnd: 15000 })
    expect(createZoneInputSchema.parse({ name: 'Nội bộ', feeVnd: 0 }).feeVnd).toBe(0)
    for (const feeVnd of [-1, 1.5, 100_000_001]) expect(createZoneInputSchema.safeParse({ name: 'A', feeVnd }).success).toBe(false)
    expect(createZoneInputSchema.safeParse({ name: ' ', feeVnd: 1000 }).success).toBe(false)
  })
  it('update needs at least one change', () => {
    expect(updateZoneInputSchema.safeParse({}).success).toBe(false)
    expect(updateZoneInputSchema.safeParse({ active: false }).success).toBe(true)
  })
})
