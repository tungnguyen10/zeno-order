import { z } from 'zod'

import type {
  StorefrontAvailability,
  StorefrontStatus,
} from '../../../shared/types/availability'
import { publicSlugSchema, StoreNotFoundError } from '../store/public-store'

const canonicalUuidSchema = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i)
const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/)

const availabilitySourceSchema = z.object({
  public_slug: publicSlugSchema,
  timezone: z.string().min(1),
  manual_open_state: z.enum(['open', 'closed', 'temporarily_closed']).nullable(),
  delivery_enabled: z.boolean(),
  pickup_enabled: z.boolean(),
  hours: z.array(z.object({
    day_of_week: z.number().int().min(0).max(6),
    open_time: timeSchema.nullable(),
    close_time: timeSchema.nullable(),
    is_closed: z.boolean(),
  })),
  products: z.array(z.object({
    product_id: canonicalUuidSchema,
    is_sold_out: z.boolean(),
  })),
})

export type AvailabilitySource = z.input<typeof availabilitySourceSchema>

export interface AvailabilityRepository {
  findPublicBySlug: (publicSlug: string) => Promise<AvailabilitySource | null>
}

interface ZonedParts {
  year: number
  month: number
  day: number
  weekday: number
  hour: number
  minute: number
  second: number
}

interface LocalDateTime {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const weekdayNumbers: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

export class InvalidStoreTimezoneError extends Error {
  constructor() {
    super('Store timezone is invalid')
    this.name = 'InvalidStoreTimezoneError'
  }
}

function createFormatter(timezone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
  }
  catch {
    throw new InvalidStoreTimezoneError()
  }
}

function zonedParts(date: Date, formatter: Intl.DateTimeFormat): ZonedParts {
  const values = Object.fromEntries(
    formatter.formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  )
  const weekday = weekdayNumbers[values.weekday ?? '']

  if (weekday === undefined) {
    throw new InvalidStoreTimezoneError()
  }

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    weekday,
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  }
}

function parseTime(time: string): Pick<LocalDateTime, 'hour' | 'minute' | 'second'> {
  const [hour, minute, second] = time.split(':').map(Number)
  return { hour: hour!, minute: minute!, second: second! }
}

function secondsSinceMidnight(parts: Pick<ZonedParts, 'hour' | 'minute' | 'second'>): number {
  return parts.hour * 3600 + parts.minute * 60 + parts.second
}

function offsetMilliseconds(date: Date, formatter: Intl.DateTimeFormat): number {
  const parts = zonedParts(date, formatter)
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  )
  return localAsUtc - Math.floor(date.getTime() / 1000) * 1000
}

function sameLocalDateTime(parts: ZonedParts, desired: LocalDateTime): boolean {
  return parts.year === desired.year
    && parts.month === desired.month
    && parts.day === desired.day
    && parts.hour === desired.hour
    && parts.minute === desired.minute
    && parts.second === desired.second
}

function possibleInstants(
  desired: LocalDateTime,
  formatter: Intl.DateTimeFormat,
): Date[] {
  const localAsUtc = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
    desired.second,
  )
  const offsets = new Set<number>()

  for (let hours = -36; hours <= 36; hours += 3) {
    offsets.add(offsetMilliseconds(new Date(localAsUtc + hours * 3_600_000), formatter))
  }

  return [...offsets]
    .map(offset => new Date(localAsUtc - offset))
    .filter(candidate => sameLocalDateTime(zonedParts(candidate, formatter), desired))
    .sort((left, right) => left.getTime() - right.getTime())
}

function addLocalDays(
  date: Pick<ZonedParts, 'year' | 'month' | 'day'>,
  days: number,
): Pick<LocalDateTime, 'year' | 'month' | 'day'> {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days, 12))
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  }
}

function nextOpening(
  source: z.output<typeof availabilitySourceSchema>,
  now: Date,
  localNow: ZonedParts,
  formatter: Intl.DateTimeFormat,
): string | null {
  const currentOffset = offsetMilliseconds(now, formatter)

  for (let dayOffset = 0; dayOffset <= 6; dayOffset++) {
    const calendarDate = addLocalDays(localNow, dayOffset)
    const weekday = (localNow.weekday + dayOffset) % 7
    const hours = source.hours.find(row => row.day_of_week === weekday)

    if (!hours || hours.is_closed || !hours.open_time) {
      continue
    }

    const candidates = possibleInstants({
      ...calendarDate,
      ...parseTime(hours.open_time),
    }, formatter)
    const candidate = candidates.find(instant => instant.getTime() > now.getTime())

    if (!candidate) {
      continue
    }

    if (offsetMilliseconds(candidate, formatter) !== currentOffset) {
      return null
    }

    return candidate.toISOString()
  }

  return null
}

export function resolveStoreAvailability(
  input: AvailabilitySource,
  now: Date,
): StorefrontAvailability {
  const source = availabilitySourceSchema.parse(input)
  const formatter = createFormatter(source.timezone)
  const localNow = zonedParts(now, formatter)
  let status: StorefrontStatus
  let nextOpeningAt: string | null = null

  if (source.manual_open_state) {
    status = source.manual_open_state
  }
  else {
    const today = source.hours.find(row => row.day_of_week === localNow.weekday)
    const currentSeconds = secondsSinceMidnight(localNow)
    const isWithinHours = Boolean(
      today
      && !today.is_closed
      && today.open_time
      && today.close_time
      && currentSeconds >= secondsSinceMidnight(parseTime(today.open_time))
      && currentSeconds < secondsSinceMidnight(parseTime(today.close_time)),
    )

    status = isWithinHours ? 'open' : 'closed'
    if (status === 'closed') {
      nextOpeningAt = nextOpening(source, now, localNow, formatter)
    }
  }

  return {
    publicSlug: source.public_slug,
    status,
    orderingEnabled: status === 'open'
      && (source.delivery_enabled || source.pickup_enabled),
    fulfillment: {
      delivery: source.delivery_enabled,
      pickup: source.pickup_enabled,
    },
    nextOpeningAt,
    products: source.products.map(product => ({
      productId: product.product_id,
      isAvailable: !product.is_sold_out,
    })),
  }
}

export function createStoreAvailabilityService(repository: AvailabilityRepository) {
  return {
    async resolve(publicSlug: string, now: Date): Promise<StorefrontAvailability> {
      const parsed = publicSlugSchema.safeParse(publicSlug)
      if (!parsed.success) {
        throw new StoreNotFoundError()
      }

      const source = await repository.findPublicBySlug(parsed.data)
      if (!source) {
        throw new StoreNotFoundError()
      }

      return resolveStoreAvailability(source, now)
    },
  }
}
