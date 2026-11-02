import { describe, expect, it } from 'vitest'
import { addDays, eachDate, isValidDateString, reportWindow, toVnDate, vnDayRange } from '../../../shared/vn-date'

describe('toVnDate', () => {
  it.each([
    ['2026-10-30T16:59:59.999Z', '2026-10-30'],
    ['2026-10-30T17:00:00.000Z', '2026-10-31'],
    ['2026-10-30T16:30:00Z', '2026-10-30'], // 23:30 giờ VN
    ['2026-10-30T17:30:00Z', '2026-10-31'], // 00:30 giờ VN
    ['2026-12-31T17:00:00Z', '2027-01-01'],
  ])('%s → %s', (iso, expected) => {
    expect(toVnDate(new Date(iso))).toBe(expected)
  })
})

describe('vnDayRange', () => {
  it('is [00:00 +07, next 00:00 +07) in UTC', () => {
    const { from, to } = vnDayRange('2026-10-31')
    expect(from.toISOString()).toBe('2026-10-30T17:00:00.000Z')
    expect(to.toISOString()).toBe('2026-10-31T17:00:00.000Z')
  })

  it('handles month and year ends', () => {
    expect(vnDayRange('2026-12-31').to.toISOString()).toBe('2026-12-31T17:00:00.000Z')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('isValidDateString', () => {
  it.each([
    ['2026-10-31', true],
    ['2028-02-29', true],
    ['2026-02-29', false],
    ['2026-13-01', false],
    ['2026-1-1', false],
    ['31/10/2026', false],
    ['', false],
  ])('%j → %s', (value, expected) => {
    expect(isValidDateString(value)).toBe(expected)
  })
})

describe('reportWindow', () => {
  const now = new Date('2026-10-31T05:00:00Z') // 12:00 giờ VN
  it.each([
    ['today', '2026-10-31', 1],
    ['7d', '2026-10-25', 7],
    ['30d', '2026-10-02', 30],
  ] as const)('%s starts %s and spans %i days', (range, fromDate, days) => {
    const window = reportWindow(range, now)
    expect(window).toMatchObject({ fromDate, toDate: '2026-10-31' })
    expect(eachDate(window.fromDate, window.toDate)).toHaveLength(days)
    expect(window.from.toISOString()).toBe(vnDayRange(fromDate).from.toISOString())
    expect(window.to.toISOString()).toBe('2026-10-31T17:00:00.000Z')
  })

  it('uses the Vietnam date even when UTC is still the previous day', () => {
    expect(reportWindow('today', new Date('2026-10-30T18:00:00Z')).toDate).toBe('2026-10-31')
  })
})
