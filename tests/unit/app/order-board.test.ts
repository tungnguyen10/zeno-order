import { describe, expect, it } from 'vitest'
import type { BoardOrder } from '../../../shared/types/orders'
import { applyStatus, detectNewOrderIds, emptyCounts, mergePage, shiftCounts } from '../../../app/utils/order-board'

const order = (id: string, status: BoardOrder['status'] = 'NEW'): BoardOrder => ({
  id, publicCode: id.toUpperCase(), status, fulfillmentType: 'PICKUP', paymentMethod: 'PAY_ON_RECEIPT', paymentStatus: 'UNPAID',
  latePayment: false, tableName: null, customerName: null, customerPhone: null, address: null, notes: null,
  totalVnd: 10_000, createdAt: '2026-11-01T00:00:00.000Z', items: [],
})

describe('detectNewOrderIds', () => {
  it('returns nothing on the first load (seen === null)', () => {
    expect(detectNewOrderIds(null, ['a', 'b'])).toEqual([])
  })

  it('returns only ids not seen before', () => {
    expect(detectNewOrderIds(new Set(['a']), ['a', 'b', 'c'])).toEqual(['b', 'c'])
    expect(detectNewOrderIds(new Set(['a', 'b']), ['a'])).toEqual([])
  })

  it('treats an order that re-enters the new queue (payment arrived) as new', () => {
    expect(detectNewOrderIds(new Set(['a']), ['a', 'paid-late'])).toEqual(['paid-late'])
  })
})

describe('applyStatus', () => {
  it('removes the card when the next status belongs to another tab', () => {
    expect(applyStatus([order('a'), order('b')], 'a', 'PREPARING', 'new').map(o => o.id)).toEqual(['b'])
  })

  it('keeps and updates the card when the tab is unchanged (READY → DELIVERING stays in "ready")', () => {
    const result = applyStatus([order('a', 'READY')], 'a', 'DELIVERING', 'ready')
    expect(result).toHaveLength(1)
    expect(result[0]!.status).toBe('DELIVERING')
  })
})

describe('shiftCounts', () => {
  it('moves one unit between tabs and never goes negative', () => {
    const base = { ...emptyCounts(), new: 2 }
    expect(shiftCounts(base, 'NEW', 'PREPARING')).toEqual({ ...emptyCounts(), new: 1, doing: 1 })
    expect(shiftCounts(emptyCounts(), 'NEW', 'PREPARING')).toEqual({ ...emptyCounts(), doing: 1 })
  })

  it('does not count the "other" tab and ignores same-tab moves', () => {
    const base = { ...emptyCounts(), ready: 1 }
    expect(shiftCounts(base, 'READY', 'COMPLETED')).toEqual(emptyCounts())
    expect(shiftCounts(base, 'READY', 'DELIVERING')).toEqual(base)
  })
})

describe('mergePage', () => {
  it('appends only unseen orders, preserving order', () => {
    expect(mergePage([order('a'), order('b')], [order('b'), order('c')]).map(o => o.id)).toEqual(['a', 'b', 'c'])
  })
})
