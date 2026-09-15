import { describe, expect, it } from 'vitest'
import { nextOrderStatuses, orderStatusLabel } from '../../app/domain/merchant-order-status'

describe('merchant order status presentation', () => {
  it('derives pickup and delivery actions from the locked state machine', () => {
    expect(nextOrderStatuses('pending', 'pickup')).toEqual(['confirmed', 'cancelled'])
    expect(nextOrderStatuses('ready', 'pickup')).toEqual(['completed', 'cancelled'])
    expect(nextOrderStatuses('ready', 'delivery')).toEqual(['delivering', 'cancelled'])
    expect(nextOrderStatuses('completed', 'delivery')).toEqual([])
  })

  it('has a Vietnamese label for every state', () => {
    expect(orderStatusLabel.delivering).toBe('Đang giao')
    expect(Object.keys(orderStatusLabel)).toHaveLength(7)
  })
})
