import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getDb, closeDb } from '../../server/db/client'
import { paymentJobRuns, reconcileCheckpoints } from '../../server/db/schema'
import { withJobHeartbeat } from '../../server/services/ops/job-heartbeat'
import { getOpsStatus } from '../../server/services/ops/status'
import { resetDb } from '../support/db'
import { createTenant } from '../support/fixtures'
import { createPaymentSetup, createAwaitingOrder } from '../support/webhook-fixtures'

beforeEach(async () => { await resetDb(); vi.stubEnv('PAYMENT_JOBS_ENABLED', 'true') })
afterEach(() => vi.unstubAllEnvs())
afterAll(closeDb)
it('records committed success and a sanitized error without losing last success', async () => {
  await withJobHeartbeat(getDb(), 'expire', async () => 1)
  const [before] = await getDb().select().from(paymentJobRuns)
  expect(before!.lastSucceededAt).toBeInstanceOf(Date)
  await expect(withJobHeartbeat(getDb(), 'expire', async () => { throw new Error('secret-sql-sensitive') })).rejects.toThrow()
  const [after] = await getDb().select().from(paymentJobRuns)
  expect(after!.lastSucceededAt).toEqual(before!.lastSucceededAt)
  expect(after!.lastError).toBe('JOB_FAILED')
  expect(JSON.stringify(after)).not.toContain('secret-sql-sensitive')
  await withJobHeartbeat(getDb(), 'expire', async () => {
    const [running] = await getDb().select().from(paymentJobRuns)
    expect(running!.lastError).toBe('JOB_FAILED')
  })
  const [recovered] = await getDb().select().from(paymentJobRuns)
  expect(recovered!.lastError).toBeNull()
})
it('prevents an obsolete worker from overwriting the current run', async () => {
  const newer = randomUUID()
  await withJobHeartbeat(getDb(), 'expire', async () => {
    await getDb().update(paymentJobRuns).set({ runId: newer, lastError: 'NEW_RUN_FAILED' }).where(eq(paymentJobRuns.job, 'expire'))
  })
  const [row] = await getDb().select().from(paymentJobRuns)
  expect(row!.runId).toBe(newer); expect(row!.lastSucceededAt).toBeNull(); expect(row!.lastError).toBe('NEW_RUN_FAILED')
})
it('checks every live integration, excludes testing and identifies manual-only accounts', async () => {
  for (const job of ['expire', 'reconcile'] as const) await withJobHeartbeat(getDb(), job, async () => 1)
  const good = await createPaymentSetup(await createTenant('healthy'), { apiToken: 'token-good' })
  const bad = await createPaymentSetup(await createTenant('stale'), { apiToken: 'token-stale' })
  await createPaymentSetup(await createTenant('manual'), { apiToken: null })
  await createPaymentSetup(await createTenant('testing'), { apiToken: 'test', status: 'TESTING', environment: 'test' })
  await getDb().insert(reconcileCheckpoints).values({ integrationId: good.integration.id, lastSyncedAt: new Date() })
  expect(await getOpsStatus(getDb())).toMatchObject({ ok: false, reasons: ['INTEGRATION_STALE'], counts: { apiIntegrations: 2, manualIntegrations: 1 } })
  await getDb().insert(reconcileCheckpoints).values({ integrationId: bad.integration.id, lastSyncedAt: new Date() })
  expect(await getOpsStatus(getDb())).toMatchObject({ ok: true })
})
it('detects overdue pending attempts using real PR6 schema/statuses', async () => {
  const setup = await createPaymentSetup(await createTenant('overdue'))
  await createAwaitingOrder(setup, { expiresAt: new Date(Date.now() - 20 * 60_000) })
  expect(await getOpsStatus(getDb())).toMatchObject({ ok: false, counts: { overdueAttempts: 1 } })
})
