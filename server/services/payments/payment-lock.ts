import { sql } from 'drizzle-orm'
import type { Tx } from '../../db/client'

/** MVP: serialize payment mutations within an organization, including cross-order assignment. */
export async function lockOrgPayments(tx: Tx, orgId: string): Promise<void> {
  await tx.execute(sql`set local lock_timeout = '5s'`)
  await tx.execute(sql`set local statement_timeout = '10s'`)
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`payments:${orgId}`}, 0))`)
}
