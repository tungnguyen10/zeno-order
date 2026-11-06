import { fileURLToPath } from 'node:url'
import { fetch, setup } from '@nuxt/test-utils/e2e'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { matchTransaction } from '../../server/services/payments/match-transaction'
import { recordBankTransaction } from '../../server/services/payments/record-bank-transaction'
import { createTestAuth } from '../support/auth'
import { resetDb } from '../support/db'
import { addStaff, createTenant } from '../support/fixtures'
import { bankTxInput, createAwaitingOrder, createPaymentSetup } from '../support/webhook-fixtures'

const auth = await createTestAuth()
process.env.AUTH_TEST_JWKS = auth.jwksJson
await setup({ rootDir: fileURLToPath(new URL('../..', import.meta.url)), server: true, build: true, nuxtConfig: { typescript: { typeCheck: false } } })
let a: Awaited<ReturnType<typeof createTenant>>
let b: Awaited<ReturnType<typeof createTenant>>
let paymentA: Awaited<ReturnType<typeof createPaymentSetup>>
let paymentB: Awaited<ReturnType<typeof createPaymentSetup>>
let owner: string
let staff: string
let outsider: string
beforeAll(async () => {
  await resetDb()
  a = await createTenant('recon-a')
  b = await createTenant('recon-b')
  paymentA = await createPaymentSetup(a)
  paymentB = await createPaymentSetup(b)
  const employee = await addStaff(a.store)
  const sign = (u: { userId: string, email: string }) => auth.sign({ sub: u.userId, email: u.email, emailVerified: true })
  owner = await sign(a.owner)
  staff = await sign(employee)
  outsider = await sign(b.owner)
})
afterAll(closeDb)
async function call(path: string, token?: string, body?: unknown) {
  const res = await fetch(path, { method: body ? 'POST' : 'GET', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  return { status: res.status, body: await res.json(), cache: res.headers.get('cache-control') }
}
async function review() {
  const bt = await recordBankTransaction(getDb(), bankTxInput(paymentA))
  await matchTransaction(getDb(), bt.id)
  return bt.id
}
describe('owner reconciliation HTTP scope', () => {
  it.each(['', '/summary', '/refunds', '/overdue'])('protects GET %s and disables caching including errors', async (leaf) => {
    for (const [token, status] of [[undefined, 401], [staff, 403], [outsider, 404], [owner, 200]] as const) {
      expect(await call(`/api/stores/${a.store.id}/reconciliation${leaf}`, token)).toMatchObject({ status, cache: 'no-store' })
    }
  })
  it('protects assign, resolve, refund and manual bank payment', async () => {
    const tx = await review()
    const { order } = await createAwaitingOrder(paymentA)
    const actions = [
      [`/reconciliation/${tx}/assign`, { orderId: order.id }],
      [`/reconciliation/${tx}/resolve`, { resolution: 'NOT_ORDER' }],
      [`/orders/${order.id}/refunded`, { note: 'Đã hoàn tiền', expectedHeldVnd: 55_000 }],
      [`/orders/${order.id}/mark-paid`, { method: 'BANK_MANUAL', expectedPaymentStatus: 'PENDING', note: 'Đã nhận tiền' }],
    ] as const
    for (const [path, body] of actions) for (const [token, status] of [[undefined, 401], [staff, 403], [outsider, 404]] as const) {
      expect((await call(`/api/stores/${a.store.id}${path}`, token, body)).status).toBe(status)
    }
  })
  it('rejects foreign transaction and foreign order ids even through an authorized store', async () => {
    const foreign = await recordBankTransaction(getDb(), bankTxInput(paymentB))
    await matchTransaction(getDb(), foreign.id)
    const tx = await review()
    const { order } = await createAwaitingOrder(paymentB)
    expect((await call(`/api/stores/${a.store.id}/reconciliation/${foreign.id}/resolve`, owner, { resolution: 'NOT_ORDER' })).status).toBe(404)
    expect((await call(`/api/stores/${a.store.id}/reconciliation/${tx}/assign`, owner, { orderId: order.id })).status).toBe(404)
  })
  it('assigns once and rejects a second assignment', async () => {
    const tx = await review()
    const { order } = await createAwaitingOrder(paymentA)
    const path = `/api/stores/${a.store.id}/reconciliation/${tx}/assign`
    expect((await call(path, owner, { orderId: order.id })).status).toBe(200)
    expect((await call(path, owner, { orderId: order.id })).status).toBe(409)
  })
})
