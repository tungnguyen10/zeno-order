import { describe, expect, it } from 'vitest'
import {
  assignInputSchema, bankManualInputSchema, noteInputSchema, resolveInputSchema, reviewListQuerySchema,
} from '#shared/schemas/reconciliation'

const UUID = '3f1c6c3e-7a57-4a1e-9d57-0d8f7d0d1b11'

describe('reconciliation schemas', () => {
  it('defaults the list status and the amount-difference flag', () => {
    expect(reviewListQuerySchema.parse({})).toEqual({ status: 'REVIEW_REQUIRED' })
    expect(assignInputSchema.parse({ orderId: UUID })).toEqual({ orderId: UUID, acceptAmountDifference: false })
  })

  it('rejects a non-uuid order id and unknown statuses', () => {
    expect(assignInputSchema.safeParse({ orderId: 'abc' }).success).toBe(false)
    expect(reviewListQuerySchema.safeParse({ status: 'MATCHED' }).success).toBe(false)
  })

  it('requires a real note only for the OTHER resolution', () => {
    expect(resolveInputSchema.safeParse({ resolution: 'DUPLICATE' }).success).toBe(true)
    expect(resolveInputSchema.safeParse({ resolution: 'OTHER' }).success).toBe(false)
    expect(resolveInputSchema.safeParse({ resolution: 'OTHER', note: 'ab' }).success).toBe(false)
    expect(resolveInputSchema.safeParse({ resolution: 'OTHER', note: 'Khách hoàn qua Momo' }).success).toBe(true)
    expect(resolveInputSchema.safeParse({ resolution: 'NOPE' }).success).toBe(false)
  })

  it('trims notes and enforces 3–300 characters for refunds / manual bank payments', () => {
    expect(noteInputSchema.parse({ note: '  đã CK lại  ' })).toEqual({ note: 'đã CK lại' })
    expect(noteInputSchema.safeParse({ note: '  a ' }).success).toBe(false)
    expect(noteInputSchema.safeParse({ note: 'x'.repeat(301) }).success).toBe(false)
  })

  it('bank-manual input needs the method literal, an expected status and a note', () => {
    expect(bankManualInputSchema.safeParse({ method: 'BANK_MANUAL', expectedPaymentStatus: 'PENDING', note: 'Đã thấy tiền trong app' }).success).toBe(true)
    expect(bankManualInputSchema.safeParse({ method: 'CASH', expectedPaymentStatus: 'PENDING', note: 'abc' }).success).toBe(false)
    expect(bankManualInputSchema.safeParse({ method: 'BANK_MANUAL', expectedPaymentStatus: 'PAID', note: 'abc' }).success).toBe(false)
    expect(bankManualInputSchema.safeParse({ method: 'BANK_MANUAL', expectedPaymentStatus: 'PENDING' }).success).toBe(false)
  })
})
