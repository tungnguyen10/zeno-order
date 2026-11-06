import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { paymentJobRuns } from '../../db/schema'

/** Run inside the job lease. A superseded worker cannot overwrite a newer heartbeat. */
export async function withJobHeartbeat<T>(db: Db, job: 'expire' | 'reconcile', work: () => Promise<T>): Promise<T> {
  const runId = randomUUID()
  const startedAt = new Date()
  await db.insert(paymentJobRuns).values({ job, runId, lastStartedAt: startedAt })
    .onConflictDoUpdate({ target: paymentJobRuns.job, set: { runId, lastStartedAt: startedAt } })
  const owned = and(eq(paymentJobRuns.job, job), eq(paymentJobRuns.runId, runId))
  try {
    const result = await work()
    await db.update(paymentJobRuns).set({ lastSucceededAt: new Date(), lastError: null }).where(owned)
    return result
  }
  catch (error) {
    // Never persist provider/SQL messages or credentials.
    await db.update(paymentJobRuns).set({ lastError: 'JOB_FAILED' }).where(owned)
    throw error
  }
}
