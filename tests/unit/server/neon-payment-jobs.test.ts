import { afterEach, describe, expect, it, vi } from 'vitest'
import { handlePaymentJob } from '../../../functions/payment-jobs'
import config from '../../../neon'

const req = (headers: Record<string, string> = {}, path = '/expire', body: unknown = { data: { scheduled_at: '2026-11-06T00:00:00Z' } }) => new Request(`https://neon.example${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
afterEach(() => { vi.unstubAllEnvs() })
describe('Neon scheduled job boundary', () => {
  it('rejects public requests before touching Postgres', async () => {
    vi.stubEnv('PAYMENT_JOBS_ENABLED', 'true')
    expect((await handlePaymentJob(req())).status).toBe(403)
  })
  it('stays disabled until explicitly enabled in the deployed branch', async () => {
    vi.stubEnv('PAYMENT_JOBS_ENABLED', 'false')
    const result = await handlePaymentJob(req({ 'x-neon-trigger-invocation-id': 'invocation' }))
    expect(await result.json()).toEqual({ skipped: 'disabled' })
  })
  it('validates trigger shape and path before accessing the database', async () => {
    vi.stubEnv('PAYMENT_JOBS_ENABLED', 'true')
    const headers = { 'x-neon-trigger-invocation-id': 'invocation' }
    expect((await handlePaymentJob(req(headers, '/expire', {}))).status).toBe(400)
    expect((await handlePaymentJob(req(headers, '/other'))).status).toBe(404)
  })
  it('declares the two jobs on Neon, with independent cadences and no Vercel dependency', () => {
    expect(config.triggers).toMatchObject({
      'payment-expiry': { function: 'paymentjobs', cron: '*/5 * * * *', functionPath: '/expire' },
      'payment-reconcile': { function: 'paymentjobs', cron: '*/15 * * * *', functionPath: '/reconcile' },
    })
  })
})
