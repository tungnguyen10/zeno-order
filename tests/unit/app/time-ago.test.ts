import { describe, expect, it } from 'vitest'
import { formatAge } from '../../../app/utils/time-ago'

const base = Date.parse('2026-11-01T10:00:00Z')
describe('formatAge', () => {
  it.each([
    [0, 'Vừa xong'],
    [59, 'Vừa xong'],
    [60, '1 phút trước'],
    [59 * 60, '59 phút trước'],
    [60 * 60, '1 giờ trước'],
    [23 * 3600, '23 giờ trước'],
    [24 * 3600, '1 ngày trước'],
    [-30, 'Vừa xong'],
  ])('%i s ago → %s', (seconds, text) => {
    expect(formatAge(new Date(base - seconds * 1000).toISOString(), base)).toBe(text)
  })
})
