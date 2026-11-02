export const REPORT_TZ = 'Asia/Ho_Chi_Minh'
// Việt Nam là UTC+7 quanh năm, không có DST.
const VN_OFFSET_MS = 7 * 60 * 60 * 1000
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function isValidDateString(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function toVnDate(instant: Date): string {
  return new Date(instant.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10)
}

export function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

export function vnDayRange(date: string): { from: Date, to: Date } {
  return { from: new Date(`${date}T00:00:00+07:00`), to: new Date(`${addDays(date, 1)}T00:00:00+07:00`) }
}

export const REPORT_RANGES = ['today', '7d', '30d'] as const
export type ReportRange = (typeof REPORT_RANGES)[number]

const SPAN_DAYS: Record<ReportRange, number> = { today: 1, '7d': 7, '30d': 30 }

export function reportWindow(range: ReportRange, now: Date): { fromDate: string, toDate: string, from: Date, to: Date } {
  const toDate = toVnDate(now)
  const fromDate = addDays(toDate, -(SPAN_DAYS[range] - 1))
  return { fromDate, toDate, from: vnDayRange(fromDate).from, to: vnDayRange(toDate).to }
}

export function eachDate(fromDate: string, toDate: string): string[] {
  const dates: string[] = []
  for (let date = fromDate; date <= toDate; date = addDays(date, 1)) dates.push(date)
  return dates
}
