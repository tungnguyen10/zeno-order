import { pruneRateLimits } from '../server/services/ops/prune-rate-limits'
import { withJobHeartbeat } from '../server/services/ops/job-heartbeat'
import { getDb } from '../server/db/client'
import { expirePaymentAttempts } from '../server/services/payments/expire-payment-attempts'
import { withPaymentJobLease } from '../server/services/payments/job-lease'
import { reconcileSepay } from '../server/services/payments/reconcile-sepay'
import { createSepayHttpClient, sepayApiBaseUrl } from '../server/services/payments/sepay-client'
import { logger } from '../server/utils/logger'

/** Neon strips caller-supplied X-Neon-* headers before routing to the function.
 * This attestation must never be trusted on a generic Nuxt/HTTP host.
 */
export async function handlePaymentJob(request: Request): Promise<Response> {
  if (request.method !== 'POST' || !request.headers.get('x-neon-trigger-invocation-id')) return Response.json({ error: 'Forbidden' }, { status: 403 })
  if (process.env.PAYMENT_JOBS_ENABLED !== 'true') return Response.json({ skipped: 'disabled' })
  const path = new URL(request.url).pathname
  if (!['/expire', '/reconcile'].includes(path)) return Response.json({ error: 'Not found' }, { status: 404 })
  try {
    const payload: unknown = await request.json()
    if (!payload || typeof payload !== 'object' || !('data' in payload) || !payload.data || typeof payload.data !== 'object' || !('scheduled_at' in payload.data) || typeof payload.data.scheduled_at !== 'string' || !Number.isFinite(Date.parse(payload.data.scheduled_at))) return Response.json({ error: 'Invalid trigger' }, { status: 400 })
    const db = getDb()
    const job = path === '/expire' ? 'expire' : 'reconcile'
    const result = await withPaymentJobLease(db, `scheduled:${job}`, () => withJobHeartbeat(db, job, async () => {
      if (job === 'expire') {
        const result = await expirePaymentAttempts(db, new Date())
        await pruneRateLimits(db)
        return result
      }
      const summary = await reconcileSepay(db, {
        createClient: (token, environment) => createSepayHttpClient(token, { baseUrl: sepayApiBaseUrl(environment) }),
        now: () => new Date(), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
      })
      // A partial import must not produce a healthy heartbeat or a successful trigger response.
      if (summary.integrations.some(i => !i.ok)) throw new Error('RECONCILE_INCOMPLETE')
      return summary
    }))
    return Response.json({ ok: true, skipped: result === null })
  }
  catch (err) {
    logger.error('payment_job.failed', { errorName: err instanceof Error ? err.name : 'unknown' })
    return Response.json({ error: 'Payment job failed' }, { status: 500 })
  }
}

export default { fetch: handlePaymentJob }
