import { sql } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { paymentJobRuns } from '../../db/schema'
import { evaluateStatus } from './health-policy'

export async function getOpsStatus(db: Db, now = new Date()) {
  const jobs = await db.select().from(paymentJobRuns)
  const checkpoints = await db.execute<{ last_synced_at: string | null, last_error: string | null }>(sql`
    select c.last_synced_at, c.last_error
    from sepay_integrations i left join reconcile_checkpoints c on c.integration_id = i.id
    where i.status = 'ACTIVE' and i.environment = 'live' and i.encrypted_api_token is not null
  `)
  const counters = await db.execute<{ stuck: number, overdue: number, review: number, manual: number }>(sql`
    select
      (select count(*)::int from bank_transactions where reconciliation_status = 'RECEIVED' and received_at < ${new Date(now.getTime() - 10 * 60_000).toISOString()}::timestamptz) as stuck,
      (select count(*)::int from payment_attempts where status = 'PENDING' and expires_at < ${new Date(now.getTime() - 10 * 60_000).toISOString()}::timestamptz) as overdue,
      (select count(*)::int from bank_transactions where reconciliation_status = 'REVIEW_REQUIRED') as review,
      (select count(*)::int from sepay_integrations where status = 'ACTIVE' and environment = 'live' and encrypted_api_token is null) as manual
  `)
  const row = counters.rows[0]!
  return evaluateStatus({
    jobsEnabled: process.env.PAYMENT_JOBS_ENABLED === 'true', jobs,
    checkpoints: checkpoints.rows.map(row => ({ lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at) : null, lastError: row.last_error })),
    stuckTransactions: row.stuck, overdueAttempts: row.overdue, pendingReview: row.review, manualIntegrations: row.manual,
  }, now)
}
