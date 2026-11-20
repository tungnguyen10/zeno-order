import { describe, expect, it } from 'vitest'
import {
  describeOpenState,
  evaluateOpen,
  hhmmToMinutes,
  minutesToHhmm,
  openingHoursSchema,
  toVnLocal,
  type DayHours,
  type OpeningHours,
} from '#shared/store-hours'

const day = (open: string, close: string): DayHours => ({ open, close })

/** Build a 7-day week, applying overrides keyed by day-of-week index. */
function week(base: DayHours | null, overrides: Record<number, DayHours | null> = {}): OpeningHours {
  const days = Array.from({ length: 7 }, (_, i) => (i in overrides ? overrides[i]! : base))
  return { enabled: true, days }
}

describe('time helpers', () => {
  it('round-trips HH:MM and minutes', () => {
    expect(hhmmToMinutes('07:30')).toBe(450)
    expect(hhmmToMinutes('00:00')).toBe(0)
    expect(hhmmToMinutes('23:59')).toBe(1439)
    expect(minutesToHhmm(450)).toBe('07:30')
    expect(minutesToHhmm(0)).toBe('00:00')
  })
})

describe('toVnLocal', () => {
  it('shifts UTC to UTC+7 wall-clock', () => {
    // 2026-11-18T00:00Z is 07:00 the same day in Vietnam.
    expect(toVnLocal(new Date('2026-11-18T00:00:00Z')).minutes).toBe(420)
    // Crossing midnight: 18:00Z becomes 01:00 the next VN day.
    const before = toVnLocal(new Date('2026-11-18T16:00:00Z'))
    const after = toVnLocal(new Date('2026-11-18T18:00:00Z'))
    expect(after.minutes).toBe(60)
    expect((before.dayOfWeek + 1) % 7).toBe(after.dayOfWeek)
  })
})

describe('evaluateOpen', () => {
  const now = new Date('2026-11-18T05:00:00Z') // VN 12:00

  it('treats a missing or disabled schedule as always open', () => {
    expect(evaluateOpen(null, null, now).open).toBe(true)
    expect(evaluateOpen({ enabled: false, days: week(day('07:00', '22:00')).days }, null, now).open).toBe(true)
  })

  it('is open inside today\'s window', () => {
    expect(evaluateOpen(week(day('07:00', '22:00')), null, now)).toMatchObject({ open: true, reason: null })
  })

  it('is closed before opening and points at today\'s opening', () => {
    const early = new Date('2026-11-18T00:00:00Z') // VN 07:00
    const state = evaluateOpen(week(day('08:00', '22:00')), null, early)
    expect(state).toMatchObject({ open: false, reason: 'OUTSIDE_HOURS' })
    expect(state.nextOpen).toEqual({ dayOfWeek: toVnLocal(early).dayOfWeek, minutes: 480 })
  })

  it('is closed after closing and points at the next open day', () => {
    const late = new Date('2026-11-18T16:00:00Z') // VN 23:00
    const state = evaluateOpen(week(day('07:00', '22:00')), null, late)
    expect(state.open).toBe(false)
    expect(state.nextOpen).toEqual({ dayOfWeek: (toVnLocal(late).dayOfWeek + 1) % 7, minutes: 420 })
  })

  it('skips days that are closed when searching for the next opening', () => {
    const late = new Date('2026-11-18T16:00:00Z')
    const dow = toVnLocal(late).dayOfWeek
    const state = evaluateOpen(week(day('07:00', '22:00'), { [(dow + 1) % 7]: null }), null, late)
    expect(state.nextOpen).toEqual({ dayOfWeek: (dow + 2) % 7, minutes: 420 })
  })

  it('returns no next opening when every day is closed', () => {
    const state = evaluateOpen(week(null), null, now)
    expect(state).toMatchObject({ open: false, reason: 'OUTSIDE_HOURS', nextOpen: null })
  })

  it('a future pause overrides the schedule', () => {
    const state = evaluateOpen(week(day('07:00', '22:00')), new Date(now.getTime() + 3_600_000), now)
    expect(state).toMatchObject({ open: false, reason: 'PAUSED' })
  })

  it('a past pause is ignored', () => {
    const state = evaluateOpen(week(day('07:00', '22:00')), new Date(now.getTime() - 1_000), now)
    expect(state.open).toBe(true)
  })

  it('pause wins even when no schedule is set', () => {
    expect(evaluateOpen(null, new Date(now.getTime() + 60_000), now)).toMatchObject({ open: false, reason: 'PAUSED' })
  })
})

describe('describeOpenState', () => {
  const now = new Date('2026-11-18T05:00:00Z')
  const today = toVnLocal(now).dayOfWeek

  it('returns null when open', () => {
    expect(describeOpenState({ open: true, reason: null, nextOpen: null }, now)).toBeNull()
  })

  it('describes a pause', () => {
    expect(describeOpenState({ open: false, reason: 'PAUSED', nextOpen: null }, now)).toBe('Quán đang tạm đóng')
  })

  it('describes today, tomorrow and a later weekday', () => {
    expect(describeOpenState({ open: false, reason: 'OUTSIDE_HOURS', nextOpen: { dayOfWeek: today, minutes: 480 } }, now)).toBe('Mở lúc 08:00 hôm nay')
    expect(describeOpenState({ open: false, reason: 'OUTSIDE_HOURS', nextOpen: { dayOfWeek: (today + 1) % 7, minutes: 420 } }, now)).toBe('Mở lúc 07:00 ngày mai')
    expect(describeOpenState({ open: false, reason: 'OUTSIDE_HOURS', nextOpen: { dayOfWeek: (today + 2) % 7, minutes: 420 } }, now)).toMatch(/^Mở (Chủ nhật|Thứ [2-7]) lúc 07:00$/)
  })
})

describe('openingHoursSchema', () => {
  it('accepts a valid week', () => {
    expect(openingHoursSchema.safeParse(week(day('07:00', '22:00'))).success).toBe(true)
  })

  it('rejects a close time at or before open', () => {
    expect(openingHoursSchema.safeParse(week(day('22:00', '07:00'))).success).toBe(false)
    expect(openingHoursSchema.safeParse(week(day('07:00', '07:00'))).success).toBe(false)
  })

  it('rejects a bad time format', () => {
    expect(openingHoursSchema.safeParse(week(day('7:00', '22:00'))).success).toBe(false)
    expect(openingHoursSchema.safeParse(week(day('07:00', '24:00'))).success).toBe(false)
  })

  it('requires exactly seven days', () => {
    expect(openingHoursSchema.safeParse({ enabled: true, days: [null, null, null] }).success).toBe(false)
  })
})
