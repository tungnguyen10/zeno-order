import { describe, expect, it } from 'vitest'
import { boardQuerySchema, cancelOrderSchema, markPaidSchema, statusChangeSchema } from '../../../shared/schemas/orders'

describe('owner order input validation', () => {
  it('defaults the board page size and coerces an HTTP query limit', () => {
    expect(boardQuerySchema.parse({ tab: 'new' })).toEqual({ tab: 'new', limit: 30 })
    expect(boardQuerySchema.parse({ tab: 'other', limit: '100' }).limit).toBe(100)
  })

  it.each([{ tab: 'bad' }, { tab: 'new', limit: 0 }, { tab: 'new', limit: 101 }, { tab: 'new', limit: 1.5 }, { tab: 'new', cursor: '' }])('rejects invalid board query %j', (input) => {
    expect(boardQuerySchema.safeParse(input).success).toBe(false)
  })

  it('requires a real status change', () => {
    expect(statusChangeSchema.safeParse({ expectedStatus: 'NEW', nextStatus: 'NEW' }).success).toBe(false)
    expect(statusChangeSchema.safeParse({ expectedStatus: 'NEW', nextStatus: 'READY' }).success).toBe(true)
  })

  it.each(['', ' ', 'x', 'x'.repeat(201)])('requires a cancellation reason between 2 and 200 trimmed characters', (reason) => {
    expect(cancelOrderSchema.safeParse({ expectedStatus: 'NEW', reason }).success).toBe(false)
  })

  it('trims reason and cash note', () => {
    expect(cancelOrderSchema.parse({ expectedStatus: 'NEW', reason: '  Khách hủy  ' }).reason).toBe('Khách hủy')
    expect(markPaidSchema.parse({ expectedPaymentStatus: 'UNPAID', method: 'CASH', note: '  Tiền mặt  ' }).note).toBe('Tiền mặt')
  })

  it.each([{ expectedPaymentStatus: 'UNPAID' }, { expectedPaymentStatus: 'UNPAID', method: 'BANK_MANUAL' }, { method: 'CASH' }, { expectedPaymentStatus: 'UNPAID', method: 'CASH', note: 'x'.repeat(201) }])('rejects invalid cash input %j', (input) => {
    expect(markPaidSchema.safeParse(input).success).toBe(false)
  })
})
