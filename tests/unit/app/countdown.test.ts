import { describe, expect, it } from 'vitest'
import { formatCountdown, remainingSeconds } from '../../../app/utils/countdown'

describe('remainingSeconds', () => {
  const expiresAt = '2026-11-01T05:15:00.000Z'
  const at = (iso: string) => Date.parse(iso)

  it('counts whole seconds up to the expiry, rounding up', () => {
    expect(remainingSeconds(expiresAt, at('2026-11-01T05:00:00.000Z'))).toBe(900)
    expect(remainingSeconds(expiresAt, at('2026-11-01T05:14:59.200Z'))).toBe(1)
  })

  it('never goes negative', () => {
    expect(remainingSeconds(expiresAt, at('2026-11-01T05:15:00.000Z'))).toBe(0)
    expect(remainingSeconds(expiresAt, at('2026-11-01T06:00:00.000Z'))).toBe(0)
  })

  it('treats an invalid clock as expired', () => {
    expect(remainingSeconds(expiresAt, Number.NaN)).toBe(0)
  })

  it('treats an unparsable date as expired', () => {
    expect(remainingSeconds('nope', Date.now())).toBe(0)
  })
})

describe('formatCountdown', () => {
  it.each([[900, '15:00'], [61, '01:01'], [5, '00:05'], [0, '00:00'], [-3, '00:00'], [3599.9, '59:59'], [Number.NaN, '00:00'], [Number.POSITIVE_INFINITY, '00:00']])('%s → %s', (seconds, text) => {
    expect(formatCountdown(seconds)).toBe(text)
  })
})
