import { afterEach, expect, it, vi } from 'vitest'
import { handlePaymentJob } from '../../../functions/payment-jobs'
vi.mock('../../../server/services/ops/prune-rate-limits', () => ({ pruneRateLimits: vi.fn() }))
const mocks = vi.hoisted(() => ({ reconcile: vi.fn(), expire: vi.fn(), heartbeat: vi.fn(), lease: vi.fn() }))
vi.mock('../../../server/db/client', () => ({ getDb: () => ({}) }))
vi.mock('../../../server/services/ops/job-heartbeat', () => ({ withJobHeartbeat: mocks.heartbeat }))
vi.mock('../../../server/services/payments/job-lease', () => ({ withPaymentJobLease: mocks.lease }))
vi.mock('../../../server/services/payments/reconcile-sepay', () => ({ reconcileSepay: mocks.reconcile }))
vi.mock('../../../server/services/payments/expire-payment-attempts', () => ({ expirePaymentAttempts: mocks.expire }))
const request = (path: string) => new Request(`https://neon.example/${path}`, { method: 'POST', headers: { 'x-neon-trigger-invocation-id': 'invocation' }, body: JSON.stringify({ data: { scheduled_at: new Date().toISOString() } }) })
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks() })
function setup() {
  vi.stubEnv('PAYMENT_JOBS_ENABLED', 'true')
  mocks.lease.mockImplementation((_db, _key, work) => work())
  mocks.heartbeat.mockImplementation((_db, _job, work) => work())
}
it('never reports partial reconciliation as a successful trigger', async () => {
  setup(); mocks.reconcile.mockResolvedValue({ integrations: [{ id: 'one', ok: true }, { id: 'two', ok: false }] })
  expect((await handlePaymentJob(request('reconcile'))).status).toBe(500)
  expect(mocks.heartbeat).toHaveBeenCalledWith(expect.anything(), 'reconcile', expect.any(Function))
})
it('does not write success for a skipped lease', async () => {
  setup(); mocks.lease.mockResolvedValue(null)
  const response = await handlePaymentJob(request('expire'))
  expect(await response.json()).toEqual({ ok: true, skipped: true })
  expect(mocks.heartbeat).not.toHaveBeenCalled(); expect(mocks.expire).not.toHaveBeenCalled()
})
it('calls expiry inside the lease and heartbeat', async () => {
  setup(); mocks.expire.mockResolvedValue({ expired: 0 })
  expect((await handlePaymentJob(request('expire'))).status).toBe(200)
  expect(mocks.lease).toHaveBeenCalledWith(expect.anything(), 'scheduled:expire', expect.any(Function))
  expect(mocks.heartbeat).toHaveBeenCalledWith(expect.anything(), 'expire', expect.any(Function))
})
