import { and, eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { bankTransactions, orderPayments, sepayIntegrations } from '../../server/db/schema'
import { processSepayWebhook, runWebhookProcessing } from '../../server/services/payments/process-sepay-webhook'
import { sepayWebhookPayloadSchema } from '../../server/services/payments/sepay-payload'
import { allowWebhookFailure, allowWebhookTraffic } from '../../server/services/payments/webhook-traffic'
import { getWebhookAuthMode, setWebhookAuthMode, touchVerifiedWebhook } from '../../server/services/payments/webhook-auth-settings'
import { AppError } from '../../server/utils/errors'
import { createTenant } from '../support/fixtures'
import { createAwaitingOrder, createPaymentSetup, sepayPayload, type PaymentSetup } from '../support/webhook-fixtures'
import { resetDb } from '../support/db'

const db = () => getDb()

let setup: PaymentSetup
const integration = () => ({ id: setup.integration.id, orgId: setup.orgId })
const parse = (payload: unknown) => sepayWebhookPayloadSchema.parse(payload)
const payments = (orderId: string) => db().select().from(orderPayments).where(eq(orderPayments.orderId, orderId))

beforeEach(async () => {
  await resetDb()
  setup = await createPaymentSetup(await createTenant('a'))
})
afterEach(() => {
  vi.restoreAllMocks()
})
afterAll(async () => {
  await closeDb()
})

describe('processSepayWebhook', () => {
  it('records and confirms a correct transfer', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { amountVnd: 55_000 })
    const payload = parse(sepayPayload(setup, { code: attempt.paymentCode, transferAmount: 55_000 }))
    const result = await processSepayWebhook(db(), { integration: integration(), payload })
    expect(result).toMatchObject({ created: true, outcome: { kind: 'MATCHED', orderId: order.id } })
    expect(await payments(order.id)).toHaveLength(1)
  })

  it('replaying a processed webhook is a no-op that still succeeds', async () => {
    const { order, attempt } = await createAwaitingOrder(setup)
    const payload = parse(sepayPayload(setup, { code: attempt.paymentCode }))
    await processSepayWebhook(db(), { integration: integration(), payload })
    const replay = await processSepayWebhook(db(), { integration: integration(), payload })
    expect(replay).toMatchObject({ created: false, outcome: null })
    expect(await payments(order.id)).toHaveLength(1)
  })

  it('five concurrent deliveries of the same transfer confirm exactly once', async () => {
    const { order, attempt } = await createAwaitingOrder(setup)
    const payload = parse(sepayPayload(setup, { code: attempt.paymentCode }))
    const results = await Promise.all(Array.from({ length: 5 }, () => processSepayWebhook(db(), { integration: integration(), payload })))
    expect(results.filter(r => r.outcome?.kind === 'MATCHED')).toHaveLength(1)
    expect(await payments(order.id)).toHaveLength(1)
    expect(await db().select().from(bankTransactions).where(eq(bankTransactions.integrationId, setup.integration.id))).toHaveLength(1)
  })

  it('stores an outgoing transfer as IGNORED without matching', async () => {
    const payload = parse(sepayPayload(setup, { transferType: 'out' }))
    const result = await processSepayWebhook(db(), { integration: integration(), payload })
    expect(result.outcome).toBeNull()
    const [row] = await db().select().from(bankTransactions).where(eq(bankTransactions.integrationId, setup.integration.id))
    expect(row!.reconciliationStatus).toBe('IGNORED')
  })

  it('keeps unknown money visible: code null and unknown code both land in REVIEW_REQUIRED', async () => {
    await processSepayWebhook(db(), { integration: integration(), payload: parse(sepayPayload(setup, { code: null, content: 'ck' })) })
    await processSepayWebhook(db(), { integration: integration(), payload: parse(sepayPayload(setup, { code: 'ZOUNKNOWN1' })) })
    const rows = await db().select().from(bankTransactions).where(and(eq(bankTransactions.integrationId, setup.integration.id), eq(bankTransactions.reconciliationStatus, 'REVIEW_REQUIRED')))
    expect(rows.map(r => r.reviewReason).sort()).toEqual(['NO_CODE', 'UNKNOWN_CODE'])
  })
})

describe('Tx2 failure (Review Focus #4)', () => {
  it('leaves the transaction RECEIVED, surfaces an error, and a SePay retry then confirms exactly once', async () => {
    const { order, attempt } = await createAwaitingOrder(setup)
    const payload = parse(sepayPayload(setup, { code: attempt.paymentCode }))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const failing = { match: async () => { throw new Error('connection terminated') } }
    await expect(runWebhookProcessing(db(), { integration: integration(), payload }, failing)).rejects.toMatchObject({ code: 'INTERNAL' })

    const [stuck] = await db().select().from(bankTransactions).where(eq(bankTransactions.integrationId, setup.integration.id))
    expect(stuck!.reconciliationStatus).toBe('RECEIVED')
    expect(await payments(order.id)).toHaveLength(0)

    const retry = await runWebhookProcessing(db(), { integration: integration(), payload })
    expect(retry.outcome).toMatchObject({ kind: 'MATCHED', orderId: order.id })
    expect(await payments(order.id)).toHaveLength(1)
  })

  it('never writes the payload, transfer content, phone or driver params to logs', async () => {
    const payload = parse(sepayPayload(setup, {
      code: null,
      content: 'NGUYEN VAN A 0912345678 chuyen tien',
      description: 'secret-description',
    }))
    const lines: string[] = []
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => { lines.push(String(line)) })
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => { lines.push(String(line)) })

    const failing = { match: async () => { throw new Error('Failed query: update ... params: 0912345678,NGUYEN VAN A,secret-description') } }
    await expect(runWebhookProcessing(db(), { integration: integration(), payload }, failing)).rejects.toBeInstanceOf(AppError)

    const output = lines.join('\n')
    expect(output).toContain('webhook.processing_failed')
    for (const forbidden of ['0912345678', 'NGUYEN VAN A', 'secret-description', 'Failed query']) {
      expect(output).not.toContain(forbidden)
    }
  })
})

describe('rate limiting', () => {
  it('allows traffic up to the limit per IP and then refuses', async () => {
    const options = { limit: 3, windowSec: 60 }
    expect(await allowWebhookTraffic(db(), '1.1.1.1', options)).toBe(true)
    expect(await allowWebhookTraffic(db(), '1.1.1.1', options)).toBe(true)
    expect(await allowWebhookTraffic(db(), '1.1.1.1', options)).toBe(true)
    expect(await allowWebhookTraffic(db(), '1.1.1.1', options)).toBe(false)
    expect(await allowWebhookTraffic(db(), '2.2.2.2', options)).toBe(true)
  })

  it('throttles repeated authentication failures separately from normal traffic', async () => {
    const options = { limit: 2, windowSec: 600 }
    expect(await allowWebhookFailure(db(), '3.3.3.3', options)).toBe(true)
    expect(await allowWebhookFailure(db(), '3.3.3.3', options)).toBe(true)
    expect(await allowWebhookFailure(db(), '3.3.3.3', options)).toBe(false)
    expect(await allowWebhookTraffic(db(), '3.3.3.3', { limit: 5, windowSec: 60 })).toBe(true)
  })
})

describe('auth mode and last valid webhook', () => {
  it('defaults to HMAC and switches to APIKEY for the owning organisation only', async () => {
    expect(await getWebhookAuthMode(db(), setup.integration.id)).toBe('HMAC')
    await setWebhookAuthMode(db(), setup.orgId, setup.integration.id, 'APIKEY')
    expect(await getWebhookAuthMode(db(), setup.integration.id)).toBe('APIKEY')
    const other = await createTenant('c')
    await expect(setWebhookAuthMode(db(), other.org.id, setup.integration.id, 'HMAC')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(setWebhookAuthMode(db(), setup.orgId, 'not-a-uuid', 'HMAC')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await getWebhookAuthMode(db(), setup.integration.id)).toBe('APIKEY')
  })

  it('touchVerifiedWebhook sets last_valid_webhook_at once a minute', async () => {
    const read = async () => (await db().select().from(sepayIntegrations).where(eq(sepayIntegrations.id, setup.integration.id)))[0]!.lastValidWebhookAt
    expect(await read()).toBeNull()
    await touchVerifiedWebhook(db(), setup.integration.id)
    const first = await read()
    expect(first).toBeInstanceOf(Date)
    await touchVerifiedWebhook(db(), setup.integration.id)
    expect(await read()).toEqual(first)
  })
})
