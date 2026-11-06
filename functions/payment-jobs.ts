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
    const result = path === '/expire'
      ? await withPaymentJobLease(db, 'expire', () => expirePaymentAttempts(db, new Date()))
      : await reconcileSepay(db, {
        createClient: (token, environment) => createSepayHttpClient(token, { baseUrl: sepayApiBaseUrl(environment) }),
        now: () => new Date(), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
      })
    // Failed jobs return a failure so the trigger can retry. Successful imports remain idempotent.
    if (result && 'integrations' in result && result.integrations.some(i => !i.ok)) return Response.json({ error: 'Reconciliation incomplete' }, { status: 503 })
    return Response.json({ ok: true, skipped: result === null })
  }
  catch (err) {
    logger.error('payment_job.failed', { errorName: err instanceof Error ? err.name : 'unknown' })
    return Response.json({ error: 'Payment job failed' }, { status: 500 })
  }
}

export default { fetch: handlePaymentJob }
