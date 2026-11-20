import { z } from 'zod'

/** Vietnam is a single timezone, UTC+7, with no daylight saving. */
export const VN_OFFSET_MINUTES = 420

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

export interface DayHours {
  open: string
  close: string
}

export interface OpeningHours {
  enabled: boolean
  /** Exactly 7 entries, index 0 = Sunday … 6 = Saturday (matches Date.getUTCDay). null = closed that day. */
  days: (DayHours | null)[]
}

export function hhmmToMinutes(value: string): number {
  const [h, m] = value.split(':')
  return Number(h) * 60 + Number(m)
}

export function minutesToHhmm(total: number): string {
  const h = Math.floor(total / 60) % 24
  const m = ((total % 60) + 60) % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

const timeField = z.string().regex(TIME_PATTERN, 'Giờ không hợp lệ (HH:MM)')

const dayHoursSchema = z
  .object({ open: timeField, close: timeField })
  .refine(day => hhmmToMinutes(day.close) > hhmmToMinutes(day.open), { message: 'Giờ đóng phải sau giờ mở', path: ['close'] })

export const openingHoursSchema = z.object({
  enabled: z.boolean(),
  days: z.array(dayHoursSchema.nullable()).length(7, 'Cần đủ 7 ngày trong tuần'),
})

export type OpeningHoursInput = z.output<typeof openingHoursSchema>

export interface VnLocalTime {
  /** 0 = Sunday … 6 = Saturday. */
  dayOfWeek: number
  /** Minutes from local midnight. */
  minutes: number
}

export function toVnLocal(now: Date): VnLocalTime {
  const shifted = new Date(now.getTime() + VN_OFFSET_MINUTES * 60_000)
  return { dayOfWeek: shifted.getUTCDay(), minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() }
}

export type ClosedReason = 'PAUSED' | 'OUTSIDE_HOURS'

export interface OpenState {
  open: boolean
  reason: ClosedReason | null
  /** The next scheduled opening, for building a "mở lúc …" hint. null when already open or never scheduled. */
  nextOpen: { dayOfWeek: number, minutes: number } | null
}

function findNextOpen(hours: OpeningHours, local: VnLocalTime): OpenState['nextOpen'] {
  for (let offset = 0; offset <= 7; offset++) {
    const dayOfWeek = (local.dayOfWeek + offset) % 7
    const day = hours.days[dayOfWeek]
    if (!day) continue
    const open = hhmmToMinutes(day.open)
    // Today only counts if its opening is still ahead of us (we are closed, so otherwise it is already past close).
    if (offset === 0 && local.minutes >= open) continue
    return { dayOfWeek, minutes: open }
  }
  return null
}

/**
 * Whether the store is open right now. A manual pause wins over the schedule; a store with no schedule
 * (or a disabled one) is always "open" so opening hours stay opt-in and the manual accepting flag governs.
 */
export function evaluateOpen(hours: OpeningHours | null, pausedUntil: Date | null, now: Date): OpenState {
  if (pausedUntil && pausedUntil.getTime() > now.getTime()) {
    return { open: false, reason: 'PAUSED', nextOpen: null }
  }
  if (!hours || !hours.enabled) {
    return { open: true, reason: null, nextOpen: null }
  }
  const local = toVnLocal(now)
  const today = hours.days[local.dayOfWeek] ?? null
  if (today && local.minutes >= hhmmToMinutes(today.open) && local.minutes < hhmmToMinutes(today.close)) {
    return { open: true, reason: null, nextOpen: null }
  }
  return { open: false, reason: 'OUTSIDE_HOURS', nextOpen: findNextOpen(hours, local) }
}

const WEEKDAYS_VI = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']

/** A short Vietnamese hint for customers, e.g. "Mở lúc 07:00 ngày mai". null when the store is open. */
export function describeOpenState(state: OpenState, now: Date): string | null {
  if (state.open) return null
  if (state.reason === 'PAUSED') return 'Quán đang tạm đóng'
  if (!state.nextOpen) return 'Quán đang đóng cửa'
  const local = toVnLocal(now)
  const dayDiff = (state.nextOpen.dayOfWeek - local.dayOfWeek + 7) % 7
  const time = minutesToHhmm(state.nextOpen.minutes)
  if (dayDiff === 0) return `Mở lúc ${time} hôm nay`
  if (dayDiff === 1) return `Mở lúc ${time} ngày mai`
  return `Mở ${WEEKDAYS_VI[state.nextOpen.dayOfWeek]} lúc ${time}`
}
