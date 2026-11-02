import { sql } from 'drizzle-orm'
import type { DbOrTx } from '../../db/client'
import { rateLimits } from '../../db/schema'

export interface RateLimitOptions {
  limit: number
  windowSec: number
  /** Injectable clock, for tests only. */
  now?: Date
}

/** Fixed-window counter. The upsert is atomic, so concurrent callers each get a distinct count. */
export async function consumeRateLimit(db: DbOrTx, key: string, { limit, windowSec, now = new Date() }: RateLimitOptions): Promise<boolean> {
  const windowMs = windowSec * 1000
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs)
  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({ target: [rateLimits.key, rateLimits.windowStart], set: { count: sql`${rateLimits.count} + 1` } })
    .returning({ count: rateLimits.count })
  return row!.count <= limit
}
