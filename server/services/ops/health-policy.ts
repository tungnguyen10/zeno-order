export interface OpsSnapshot {
  jobsEnabled: boolean
  jobs: { job: string, lastSucceededAt: Date | null, lastError: string | null }[]
  checkpoints: { lastSyncedAt: Date | null, lastError: string | null }[]
  manualIntegrations: number
  stuckTransactions: number
  overdueAttempts: number
  pendingReview: number
}

export function evaluateStatus(snapshot: OpsSnapshot, now = new Date()) {
  const reasons: string[] = []
  if (!snapshot.jobsEnabled) reasons.push('JOBS_DISABLED')
  for (const [job, maxAge] of [['expire', 15 * 60_000], ['reconcile', 45 * 60_000]] as const) {
    const run = snapshot.jobs.find(row => row.job === job)
    if (!run?.lastSucceededAt || now.getTime() - run.lastSucceededAt.getTime() > maxAge || run.lastError) reasons.push(`${job.toUpperCase()}_STALE`)
  }
  if (snapshot.checkpoints.some(row => !row.lastSyncedAt || now.getTime() - row.lastSyncedAt.getTime() > 45 * 60_000 || row.lastError)) reasons.push('INTEGRATION_STALE')
  if (snapshot.stuckTransactions) reasons.push('TRANSACTIONS_STUCK')
  if (snapshot.overdueAttempts) reasons.push('ATTEMPTS_OVERDUE')
  return { ok: reasons.length === 0, reasons, counts: {
    stuckTransactions: snapshot.stuckTransactions, overdueAttempts: snapshot.overdueAttempts,
    pendingReview: snapshot.pendingReview, manualIntegrations: snapshot.manualIntegrations,
    apiIntegrations: snapshot.checkpoints.length,
  } }
}
