import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { paymentJobLeases } from '../../db/schema'

/** A crashed worker loses its lease after 5 minutes. Work must finish within 4 minutes. */
export async function withPaymentJobLease<T>(db: Db, key: string, work: () => Promise<T>): Promise<T | null> {
  const owner = randomUUID()
  const [lease] = await db.insert(paymentJobLeases).values({ key, owner, expiresAt: new Date(Date.now() + 300_000) })
    .onConflictDoUpdate({ target: paymentJobLeases.key, set: { owner, expiresAt: new Date(Date.now() + 300_000) }, setWhere: sql`${paymentJobLeases.expiresAt} < now()` })
    .returning({ owner: paymentJobLeases.owner })
  if (!lease) return null
  try { return await work() }
  finally { await db.delete(paymentJobLeases).where(and(eq(paymentJobLeases.key, key), eq(paymentJobLeases.owner, owner))) }
}
