import { describe, expect, it } from 'vitest'
import { compareAmount, reasonStatus } from '../../../app/utils/reconciliation'

describe('compareAmount', () => {
  it('reports an exact match, under- and over-payment with the absolute difference', () => {
    expect(compareAmount(55_000, 55_000)).toEqual({ kind: 'EXACT' })
    expect(compareAmount(50_000, 55_000)).toEqual({ kind: 'UNDER', diffVnd: 5_000 })
    expect(compareAmount(60_000, 55_000)).toEqual({ kind: 'OVER', diffVnd: 5_000 })
  })
})

describe('reasonStatus', () => {
  it('uses error for money that probably must be returned, warning for amount issues, info otherwise', () => {
    expect(reasonStatus('ORDER_CANCELLED')).toBe('error')
    expect(reasonStatus('ORDER_ALREADY_PAID')).toBe('error')
    expect(reasonStatus('AMOUNT_UNDER')).toBe('warning')
    expect(reasonStatus('AMOUNT_OVER')).toBe('warning')
    expect(reasonStatus('NO_CODE')).toBe('info')
    expect(reasonStatus(null)).toBe('info')
  })
})
