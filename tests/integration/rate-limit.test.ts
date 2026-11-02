import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { rateLimits } from '../../server/db/schema'
import { consumeRateLimit } from '../../server/services/ordering/rate-limit'
import { resetDb } from '../support/db'

const opts = { limit: 10, windowSec: 600 }
const T0 = new Date('2026-10-31T10:03:20Z')

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('consumeRateLimit', () => {
  it('lets `limit` calls through and blocks the rest of the window', async () => {
    const results: boolean[] = []
    for (let i = 0; i < 12; i++) results.push(await consumeRateLimit(getDb(), 'checkout:a', { ...opts, now: T0 }))
    expect(results.slice(0, 10)).toEqual(Array(10).fill(true))
    expect(results.slice(10)).toEqual([false, false])
  })

  it('resets in the next window', async () => {
    for (let i = 0; i < 11; i++) await consumeRateLimit(getDb(), 'checkout:a', { ...opts, now: T0 })
    const later = new Date(T0.getTime() + 600_000)
    expect(await consumeRateLimit(getDb(), 'checkout:a', { ...opts, now: later })).toBe(true)
    expect(await getDb().select().from(rateLimits)).toHaveLength(2)
  })

  it('aligns windows to multiples of windowSec since the epoch', async () => {
    await consumeRateLimit(getDb(), 'checkout:a', { ...opts, now: T0 })
    const [row] = await getDb().select().from(rateLimits)
    expect(row!.windowStart.toISOString()).toBe('2026-10-31T10:00:00.000Z')
    expect(row!.count).toBe(1)
  })

  it('keeps keys independent', async () => {
    for (let i = 0; i < 10; i++) await consumeRateLimit(getDb(), 'checkout:a', { ...opts, now: T0 })
    expect(await consumeRateLimit(getDb(), 'checkout:a', { ...opts, now: T0 })).toBe(false)
    expect(await consumeRateLimit(getDb(), 'checkout:b', { ...opts, now: T0 })).toBe(true)
  })

  it('never lets more than `limit` concurrent callers through', async () => {
    const results = await Promise.all(Array.from({ length: 15 }, () => consumeRateLimit(getDb(), 'checkout:a', { ...opts, now: T0 })))
    expect(results.filter(Boolean)).toHaveLength(10)
  })
})
