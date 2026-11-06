import { fileURLToPath } from 'node:url'
import { fetch, setup } from '@nuxt/test-utils/e2e'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { bankTransactions, orderPayments, orders, sepayIntegrations } from '../../server/db/schema'
import { createStore, createTenant } from '../support/fixtures'
import {
  bodyOf, createAwaitingOrder, createPaymentSetup, sepayPayload, signSepayBody, type PaymentSetup,
} from '../support/webhook-fixtures'
import { resetDb } from '../support/db'

await setup({
  rootDir: fileURLToPath(new URL('../..', import.meta.url)),
  server: true,
  build: true,
  nuxtConfig: { typescript: { typeCheck: false } },
})

const db = () => getDb()

let hmac: PaymentSetup
let apikey: PaymentSetup

async function post(key: string, rawBody: string, headers: Record<string, string> = {}) {
  const res = await fetch(`/api/webhooks/sepay/${key}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: rawBody,
  })
  const text = await res.text()
  return { status: res.status, text, json: text ? JSON.parse(text) : null }
}

function signed(setupOf: PaymentSetup, payload: unknown, timestampSec?: number) {
  const raw = bodyOf(payload)
  return { raw, headers: signSepayBody(raw, setupOf.secret, timestampSec) }
}

const txCount = async () => (await db().select().from(bankTransactions)).length
const paymentsOf = (orderId: string) => db().select().from(orderPayments).where(eq(orderPayments.orderId, orderId))
const orderOf = async (id: string) => (await db().select().from(orders).where(eq(orders.id, id)))[0]!

beforeEach(async () => {
  await resetDb()
  const tenant = await createTenant('a')
  hmac = await createPaymentSetup(tenant, { secret: 'hmac-secret-for-tests' })
  // PR5 allows one active account per store and one open integration per (org, environment).
  const second = await createStore(tenant.org.id, 'k')
  apikey = await createPaymentSetup({ org: tenant.org, store: second }, { authMode: 'APIKEY', secret: 'apikey-for-tests', environment: 'test' })
})
afterAll(async () => {
  await closeDb()
})

describe('authentication', () => {
  it('rejects missing headers, a wrong secret, a tampered body and a stale timestamp — and stores nothing', async () => {
    const { attempt } = await createAwaitingOrder(hmac)
    const payload = sepayPayload(hmac, { code: attempt.paymentCode })
    const { raw, headers } = signed(hmac, payload)

    expect((await post(hmac.integration.webhookEndpointKey, raw)).status).toBe(401)
    expect((await post(hmac.integration.webhookEndpointKey, raw, { ...headers, 'x-sepay-signature': 'sha256=deadbeef' })).status).toBe(401)
    expect((await post(hmac.integration.webhookEndpointKey, `${raw} `, headers)).status).toBe(401)
    const old = signed(hmac, payload, Math.floor(Date.now() / 1000) - 600)
    expect((await post(hmac.integration.webhookEndpointKey, old.raw, old.headers)).status).toBe(401)
    expect(await txCount()).toBe(0)
  })

  it('returns 404 for an unknown endpoint key and for a DISABLED integration', async () => {
    const payload = sepayPayload(hmac)
    const { raw, headers } = signed(hmac, payload)
    expect(await post('does-not-exist', raw, headers)).toMatchObject({ status: 404, json: { code: 'NOT_FOUND' } })
    const disabled = await createPaymentSetup(await createTenant('d'), { status: 'DISABLED' })
    const signedDisabled = signed(disabled, payload)
    expect((await post(disabled.integration.webhookEndpointKey, signedDisabled.raw, signedDisabled.headers)).status).toBe(404)
  })

  it('API Key mode accepts "Apikey <key>" and rejects wrong keys, signature-only and Bearer', async () => {
    const payload = sepayPayload(apikey)
    const raw = bodyOf(payload)
    const key = apikey.integration.webhookEndpointKey
    expect((await post(key, raw, { authorization: `Apikey ${apikey.secret}` })).status).toBe(200)
    expect((await post(key, raw, { authorization: 'Apikey wrong' })).status).toBe(401)
    expect((await post(key, raw, { authorization: `Bearer ${apikey.secret}` })).status).toBe(401)
    expect((await post(key, raw, signSepayBody(raw, apikey.secret))).status).toBe(401)
  })

  it('HMAC mode ignores an Apikey header', async () => {
    const raw = bodyOf(sepayPayload(hmac))
    expect((await post(hmac.integration.webhookEndpointKey, raw, { authorization: `Apikey ${hmac.secret}` })).status).toBe(401)
  })
})

describe('contract with SePay', () => {
  it('answers 200 with exactly {"success": true} after the payment is committed', async () => {
    const { order, attempt } = await createAwaitingOrder(hmac, { amountVnd: 55_000 })
    const { raw, headers } = signed(hmac, sepayPayload(hmac, { code: attempt.paymentCode, transferAmount: 55_000 }))
    const res = await post(hmac.integration.webhookEndpointKey, raw, headers)
    expect(res).toMatchObject({ status: 200, json: { success: true } })
    expect(Object.keys(res.json)).toEqual(['success'])
    expect(await orderOf(order.id)).toMatchObject({ status: 'NEW', paymentStatus: 'PAID' })
    expect(await paymentsOf(order.id)).toHaveLength(1)
  })

  it('retains id 0 until the real ping contract is verified', async () => {
    const { raw, headers } = signed(hmac, sepayPayload(hmac, { id: 0 }))
    expect(await post(hmac.integration.webhookEndpointKey, raw, headers)).toMatchObject({ status: 200, json: { success: true } })
    expect(await txCount()).toBe(1)
    const [row] = await db().select().from(sepayIntegrations).where(eq(sepayIntegrations.id, hmac.integration.id))
    expect(row!.lastValidWebhookAt).toBeInstanceOf(Date)
  })

  it('treats a replay of the same signed request as success without a second payment', async () => {
    const { order, attempt } = await createAwaitingOrder(hmac)
    const { raw, headers } = signed(hmac, sepayPayload(hmac, { code: attempt.paymentCode }))
    expect((await post(hmac.integration.webhookEndpointKey, raw, headers)).status).toBe(200)
    expect((await post(hmac.integration.webhookEndpointKey, raw, headers)).json).toEqual({ success: true })
    expect(await paymentsOf(order.id)).toHaveLength(1)
    expect(await txCount()).toBe(1)
  })

  it('five identical requests in parallel all succeed and confirm exactly once (Review Focus #1)', async () => {
    const { order, attempt } = await createAwaitingOrder(hmac)
    const { raw, headers } = signed(hmac, sepayPayload(hmac, { code: attempt.paymentCode }))
    const results = await Promise.all(Array.from({ length: 5 }, () => post(hmac.integration.webhookEndpointKey, raw, headers)))
    expect(results.map(r => r.status)).toEqual([200, 200, 200, 200, 200])
    expect(await paymentsOf(order.id)).toHaveLength(1)
    expect(await txCount()).toBe(1)
  })

  it('two different transfers with the same code in parallel: one payment, one review (Review Focus #2)', async () => {
    const { order, attempt } = await createAwaitingOrder(hmac)
    const one = signed(hmac, sepayPayload(hmac, { code: attempt.paymentCode }))
    const two = signed(hmac, sepayPayload(hmac, { code: attempt.paymentCode }))
    const results = await Promise.all([
      post(hmac.integration.webhookEndpointKey, one.raw, one.headers),
      post(hmac.integration.webhookEndpointKey, two.raw, two.headers),
    ])
    expect(results.map(r => r.status)).toEqual([200, 200])
    expect(await paymentsOf(order.id)).toHaveLength(1)
    const reviews = (await db().select().from(bankTransactions)).filter(t => t.reconciliationStatus === 'REVIEW_REQUIRED')
    expect(reviews).toHaveLength(1)
    expect(reviews[0]!.reviewReason).toBe('ORDER_ALREADY_PAID')
  })

  it('rejects malformed JSON, invalid payloads and oversized bodies with 400 and stores nothing', async () => {
    const key = hmac.integration.webhookEndpointKey
    const bad = signed(hmac, sepayPayload(hmac, { transferAmount: -5 }))
    expect((await post(key, bad.raw, bad.headers)).status).toBe(400)
    const notJson = '{not json'
    expect((await post(key, notJson, signSepayBody(notJson, hmac.secret))).status).toBe(400)
    const huge = JSON.stringify({ filler: 'x'.repeat(70 * 1024) })
    expect((await post(key, huge, signSepayBody(huge, hmac.secret))).status).toBe(400)
    expect(await txCount()).toBe(0)
  })
})

describe('money that must never disappear (Review Focus #3)', () => {
  it('stores outgoing transfers as IGNORED', async () => {
    const { raw, headers } = signed(hmac, sepayPayload(hmac, { transferType: 'out' }))
    expect((await post(hmac.integration.webhookEndpointKey, raw, headers)).status).toBe(200)
    expect((await db().select().from(bankTransactions))[0]!.reconciliationStatus).toBe('IGNORED')
  })

  it.each([
    ['unknown code', { code: 'ZOUNKNOWN1' }, 'UNKNOWN_CODE'],
    ['null code with no code in the content', { code: null, content: 'chuyen tien' }, 'NO_CODE'],
  ])('%s → 200 and REVIEW_REQUIRED', async (_name, patch, reason) => {
    const { raw, headers } = signed(hmac, sepayPayload(hmac, patch))
    expect((await post(hmac.integration.webhookEndpointKey, raw, headers)).status).toBe(200)
    expect((await db().select().from(bankTransactions))[0]).toMatchObject({ reconciliationStatus: 'REVIEW_REQUIRED', reviewReason: reason })
  })

  it('code null but present in the transfer content is still matched', async () => {
    const { order, attempt } = await createAwaitingOrder(hmac)
    const { raw, headers } = signed(hmac, sepayPayload(hmac, { code: null, content: `ck ${attempt.paymentCode.toLowerCase()} cam on` }))
    expect((await post(hmac.integration.webhookEndpointKey, raw, headers)).status).toBe(200)
    expect(await orderOf(order.id)).toMatchObject({ paymentStatus: 'PAID' })
  })

  it('wrong or short amounts never confirm the order', async () => {
    const { order, attempt } = await createAwaitingOrder(hmac, { amountVnd: 55_000 })
    const { raw, headers } = signed(hmac, sepayPayload(hmac, { code: attempt.paymentCode, transferAmount: 50_000 }))
    expect((await post(hmac.integration.webhookEndpointKey, raw, headers)).status).toBe(200)
    expect(await orderOf(order.id)).toMatchObject({ status: 'AWAITING_PAYMENT', paymentStatus: 'REVIEW_REQUIRED' })
    expect(await paymentsOf(order.id)).toHaveLength(0)
  })

  it('transfer after the attempt expired is accepted and flagged late', async () => {
    const { order, attempt } = await createAwaitingOrder(hmac, { attemptStatus: 'EXPIRED' })
    const { raw, headers } = signed(hmac, sepayPayload(hmac, { code: attempt.paymentCode }))
    expect((await post(hmac.integration.webhookEndpointKey, raw, headers)).status).toBe(200)
    expect(await orderOf(order.id)).toMatchObject({ status: 'NEW', paymentStatus: 'PAID', latePayment: true })
  })

  it('transfer after the order was cancelled → order REFUND_DUE and the transaction waits for review', async () => {
    const { order, attempt } = await createAwaitingOrder(hmac, { orderStatus: 'CANCELLED', paymentStatus: 'UNPAID', attemptStatus: 'EXPIRED' })
    const { raw, headers } = signed(hmac, sepayPayload(hmac, { code: attempt.paymentCode }))
    expect((await post(hmac.integration.webhookEndpointKey, raw, headers)).status).toBe(200)
    expect(await orderOf(order.id)).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUND_DUE' })
    expect((await db().select().from(bankTransactions))[0]).toMatchObject({ reconciliationStatus: 'REVIEW_REQUIRED', reviewReason: 'ORDER_CANCELLED' })
  })
})
