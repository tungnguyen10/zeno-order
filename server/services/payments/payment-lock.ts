import { sql } from 'drizzle-orm'
import type { Tx } from '../../db/client'

/** Shared for single-order matching; exclusive for mutations that can span multiple orders.
 * Always acquire this gate before any bank/order row lock. Different orders may match in parallel. */
export async function lockOrgPayments(tx: Tx, orgId: string, shared = false): Promise<void> {
  await tx.execute(sql`set local lock_timeout = '5s'`)
  await tx.execute(sql`set local statement_timeout = '10s'`)
  await tx.execute(shared
    ? sql`select pg_advisory_xact_lock_shared(hashtextextended(${`payments:${orgId}`}, 0))`
    : sql`select pg_advisory_xact_lock(hashtextextended(${`payments:${orgId}`}, 0))`)
}
