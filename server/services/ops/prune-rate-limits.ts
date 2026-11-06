import { sql } from 'drizzle-orm'
import type { Db } from '../../db/client'

/** Bounded cleanup; current/previous windows are never touched. Runs only with enabled Neon jobs. */
export async function pruneRateLimits(db: Db): Promise<void> {
  await db.execute(sql`
    delete from rate_limits where (key, window_start) in (
      select key, window_start from rate_limits
      where window_start < now() - interval '1 day'
      limit 5000
    )
  `)
}
