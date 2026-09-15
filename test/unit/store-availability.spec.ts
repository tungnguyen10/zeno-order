import { describe, expect, it } from 'vitest'

import {
  InvalidStoreTimezoneError,
  resolveStoreAvailability,
} from '../../server/domain/availability/store-availability'

function source(overrides: Record<string, unknown> = {}) {
  return {
    public_slug: 'mochi-cafe',
    timezone: 'Asia/Ho_Chi_Minh',
    manual_open_state: null,
    delivery_enabled: true,
    pickup_enabled: true,
    hours: [{
      day_of_week: 2,
      open_time: '07:00:00',
      close_time: '22:00:00',
      is_closed: false,
    }],
    products: [
      { product_id: '60000000-0000-0000-0000-000000000001', is_sold_out: false },
      { product_id: '60000000-0000-0000-0000-000000000002', is_sold_out: true },
    ],
    ...overrides,
  }
}

describe('resolveStoreAvailability', () => {
  it.each([
    ['open', 'open'],
    ['closed', 'closed'],
    ['temporarily_closed', 'temporarily_closed'],
  ] as const)('honors the manual %s override', (manualState, expectedStatus) => {
    const result = resolveStoreAvailability(
      source({ manual_open_state: manualState }),
      new Date('2026-09-15T23:00:00.000Z'),
    )

    expect(result.status).toBe(expectedStatus)
    expect(result.nextOpeningAt).toBeNull()
  })

  it('uses an inclusive-open, exclusive-close interval', () => {
    expect(resolveStoreAvailability(source(), new Date('2026-09-15T00:00:00.000Z')).status).toBe('open')
    expect(resolveStoreAvailability(source(), new Date('2026-09-15T15:00:00.000Z')).status).toBe('closed')
  })

  it('returns the later-today opening as an absolute instant', () => {
    const result = resolveStoreAvailability(source(), new Date('2026-09-14T23:00:00.000Z'))

    expect(result.status).toBe('closed')
    expect(result.nextOpeningAt).toBe('2026-09-15T00:00:00.000Z')
  })

  it('scans only today and the next six local calendar days', () => {
    const closedWeek = Array.from({ length: 7 }, (_, day) => ({
      day_of_week: day,
      open_time: null,
      close_time: null,
      is_closed: true,
    }))

    expect(resolveStoreAvailability(
      source({ hours: closedWeek }),
      new Date('2026-09-14T23:00:00.000Z'),
    ).nextOpeningAt).toBeNull()
  })

  it('requires an open store and at least one fulfillment method for ordering', () => {
    expect(resolveStoreAvailability(
      source({ delivery_enabled: false, pickup_enabled: false }),
      new Date('2026-09-15T01:00:00.000Z'),
    ).orderingEnabled).toBe(false)
  })

  it('maps product sold-out state independently of store status', () => {
    expect(resolveStoreAvailability(
      source({ manual_open_state: 'closed' }),
      new Date('2026-09-15T01:00:00.000Z'),
    ).products).toEqual([
      { productId: '60000000-0000-0000-0000-000000000001', isAvailable: true },
      { productId: '60000000-0000-0000-0000-000000000002', isAvailable: false },
    ])
  })

  it('rejects an invalid IANA timezone with a typed error', () => {
    expect(() => resolveStoreAvailability(
      source({ timezone: 'Invalid/Zone' }),
      new Date('2026-09-15T01:00:00.000Z'),
    )).toThrow(InvalidStoreTimezoneError)
  })

  it('does not guess a next opening inside a DST gap', () => {
    const result = resolveStoreAvailability(source({
      timezone: 'America/New_York',
      hours: [{
        day_of_week: 0,
        open_time: '02:30:00',
        close_time: '03:30:00',
        is_closed: false,
      }],
    }), new Date('2026-03-08T05:00:00.000Z'))

    expect(result.nextOpeningAt).toBeNull()
  })

  it('returns null when the timezone offset changes before the next opening', () => {
    const result = resolveStoreAvailability(source({
      timezone: 'America/New_York',
      hours: [{
        day_of_week: 0,
        open_time: '07:00:00',
        close_time: '08:00:00',
        is_closed: false,
      }],
    }), new Date('2026-03-07T12:00:00.000Z'))

    expect(result.nextOpeningAt).toBeNull()
  })

  it('chooses the earlier instant when a local opening overlaps', () => {
    const result = resolveStoreAvailability(source({
      timezone: 'America/New_York',
      hours: [{
        day_of_week: 0,
        open_time: '01:30:00',
        close_time: '02:30:00',
        is_closed: false,
      }],
    }), new Date('2026-11-01T04:00:00.000Z'))

    expect(result.nextOpeningAt).toBe('2026-11-01T05:30:00.000Z')
  })
})
