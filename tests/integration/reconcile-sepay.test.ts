import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { bankTransactions, orderPayments, orders, reconcileCheckpoints } from '../../server/db/schema'
import { processSepayWebhook } from '../../server/services/payments/process-sepay-webhook'
import { reconcileSepay, RECONCILE_OVERLAP_MS, RECONCILE_SETTLE_MS } from '../../server/services/payments/reconcile-sepay'
import { recordBankTransaction } from '../../server/services/payments/record-bank-transaction'
import { sepayWebhookPayloadSchema } from '../../server/services/payments/sepay-payload'
import { SepayApiError, type SepayApiTransaction, type SepayTransactionsClient } from '../../server/services/payments/sepay-client'
import { createTenant } from '../support/fixtures'
import { bankTxInput, createAwaitingOrder, createPaymentSetup, sepayPayload, type PaymentSetup } from '../support/webhook-fixtures'
import { resetDb } from '../support/db'

const db = () => getDb()
const NOW = new Date('2026-11-01T12:00:00.000Z')
const noSleep = async () => {}

let setup: PaymentSetup

function apiTx(over: Partial<SepayApiTransaction> = {}): SepayApiTransaction {
  return {
    id: randomUUID(),
    accountNumber: setup.account.accountNumber,
    va: null,
    amountIn: 55_000,
    amountOut: 0,
    content: 'thanh toan',
    bankCode: setup.account.bankCode,
    referenceNumber: `FT${randomUUID().slice(0, 10)}`,
    code: null,
    transactionDate: new Date('2026-11-01T11:30:00.000Z'),
    transferType: 'in',
    raw: { fixture: true },
    ...over,
  }
}

function fakeClient(items: SepayApiTransaction[], opts: { pageSize?: number, fail?: SepayApiError, endless?: boolean } = {}) {
  const calls: Parameters<SepayTransactionsClient['list']>[0][] = []
  const client: SepayTransactionsClient = {
    async list(args) {
      calls.push(args)
      if (opts.fail) throw opts.fail
      const size = opts.pageSize ?? 100
      const start = args.cursor ? Number(args.cursor) : 0
      const slice = items.slice(start, start + size)
      const more = opts.endless || start + size < items.length
      return { items: slice, nextCursor: more ? String(start + size) : null }
    },
  }
  return { client, calls }
}

const run = (client: SepayTransactionsClient, extra: Partial<Parameters<typeof reconcileSepay>[1]> = {}) =>
  reconcileSepay(db(), { createClient: () => client, now: () => NOW, sleep: noSleep, ...extra })

const bankRows = () => db().select().from(bankTransactions).where(eq(bankTransactions.integrationId, setup.integration.id))
const paymentsOf = (orderId: string) => db().select().from(orderPayments).where(eq(orderPayments.orderId, orderId))
const checkpoint = async () => (await db().select().from(reconcileCheckpoints).where(eq(reconcileCheckpoints.integrationId, setup.integration.id)))[0]

beforeEach(async () => {
  await resetDb()
  setup = await createPaymentSetup(await createTenant('a'), { apiToken: 'sepay-token' })
})
afterEach(() => { delete process.env.SEPAY_VERIFIED_DEDUPE_INTEGRATIONS })
afterAll(async () => {
  await closeDb()
})

describe('recovering a lost webhook (Review Focus #4)', () => {
  it('imports the missing transfer and confirms the order', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { amountVnd: 55_000 })
    const { client } = fakeClient([apiTx({ code: attempt.paymentCode })])
    const summary = await run(client)
    expect(summary).toMatchObject({ imported: 1, duplicates: 0, integrations: [{ id: setup.integration.id, ok: true }] })
    expect(await paymentsOf(order.id)).toHaveLength(1)
    expect((await bankRows())[0]).toMatchObject({ source: 'RECONCILE', reconciliationStatus: 'MATCHED' })
  })

  it('finds the order code in the content when the API row has code null', async () => {
    const { order, attempt } = await createAwaitingOrder(setup)
    await run(fakeClient([apiTx({ code: null, content: `ck ${attempt.paymentCode}` })]).client)
    expect(await paymentsOf(order.id)).toHaveLength(1)
  })

  it('does not credit a transfer the webhook already delivered (UUID id vs integer id)', async () => {
    const { order, attempt } = await createAwaitingOrder(setup)
    const payload = sepayWebhookPayloadSchema.parse(sepayPayload(setup, { id: 4242, code: attempt.paymentCode, referenceCode: 'FT-SAME', transactionDate: '2026-11-01 18:30:00' }))
    await processSepayWebhook(db(), { integration: { id: setup.integration.id, orgId: setup.orgId }, payload })

    process.env.SEPAY_VERIFIED_DEDUPE_INTEGRATIONS = setup.integration.id
    const row = apiTx({ code: attempt.paymentCode, referenceNumber: 'FT-SAME', transactionDate: new Date('2026-11-01T11:30:00.000Z') })
    const summary = await run(fakeClient([row]).client)

    expect(summary).toMatchObject({ imported: 0, duplicates: 1 })
    expect(await paymentsOf(order.id)).toHaveLength(1)
    const rows = await bankRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.providerAltIds).toEqual([row.id])
  })

  it('is idempotent across runs and a later webhook replay is still a no-op', async () => {
    const { order, attempt } = await createAwaitingOrder(setup)
    process.env.SEPAY_VERIFIED_DEDUPE_INTEGRATIONS = setup.integration.id
    const row = apiTx({ code: attempt.paymentCode, referenceNumber: 'FT-LATE' })
    const { client } = fakeClient([row])
    await run(client)
    await run(client)
    expect(await paymentsOf(order.id)).toHaveLength(1)

    const replay = sepayWebhookPayloadSchema.parse(sepayPayload(setup, { id: 99, code: attempt.paymentCode, referenceCode: 'FT-LATE', transactionDate: '2026-11-01 18:30:00' }))
    const result = await processSepayWebhook(db(), { integration: { id: setup.integration.id, orgId: setup.orgId }, payload: replay })
    expect(result.created).toBe(false)
    expect(await paymentsOf(order.id)).toHaveLength(1)
    expect(await bankRows()).toHaveLength(1)
  })

  it('matches again a transaction stuck in RECEIVED after a failed Tx2', async () => {
    const { order, attempt } = await createAwaitingOrder(setup)
    const stuck = await recordBankTransaction(db(), bankTxInput(setup, { paymentCode: attempt.paymentCode }))
    await db().update(bankTransactions).set({ receivedAt: new Date(NOW.getTime() - 5 * 60_000) }).where(eq(bankTransactions.id, stuck.id))
    const summary = await run(fakeClient([]).client)
    expect(summary.rematched).toBe(1)
    expect(await paymentsOf(order.id)).toHaveLength(1)
  })

  it('leaves very fresh RECEIVED rows to the webhook that is still processing them', async () => {
    const { attempt } = await createAwaitingOrder(setup)
    await recordBankTransaction(db(), bankTxInput(setup, { paymentCode: attempt.paymentCode }))
    expect((await run(fakeClient([]).client)).rematched).toBe(0)
  })
})

describe('what gets imported', () => {
  it('skips outgoing rows and zero amounts', async () => {
    const { client } = fakeClient([apiTx({ transferType: 'out', amountIn: 0, amountOut: 10_000 }), apiTx({ amountIn: 0 }), apiTx()])
    expect(await run(client)).toMatchObject({ imported: 1 })
    expect(await bankRows()).toHaveLength(1)
  })

  it('unknown or code-less transfers are stored for review, not dropped', async () => {
    await run(fakeClient([apiTx({ code: null, content: 'ck' }), apiTx({ code: 'ZOUNKNOWN1' })]).client)
    const rows = await bankRows()
    expect(rows.map(r => r.reviewReason).sort()).toEqual(['NO_CODE', 'UNKNOWN_CODE'])
  })

  it('ignores DISABLED integrations and integrations without an API token', async () => {
    await createPaymentSetup(await createTenant('b'))
    await createPaymentSetup(await createTenant('c'), { apiToken: 'x', status: 'DISABLED' })
    const createClient = vi.fn(() => fakeClient([]).client)
    const summary = await reconcileSepay(db(), { createClient, now: () => NOW, sleep: noSleep })
    expect(summary.integrations.map(i => i.id)).toEqual([setup.integration.id])
    expect(createClient).toHaveBeenCalledTimes(1)
    expect(createClient).toHaveBeenCalledWith('sepay-token', 'live')
  })

  it('pages through results and pauses between pages', async () => {
    const sleep = vi.fn(async () => {})
    const { client, calls } = fakeClient([apiTx(), apiTx(), apiTx()], { pageSize: 1 })
    expect(await run(client, { sleep })).toMatchObject({ imported: 3 })
    expect(calls.map(c => c.cursor)).toEqual([undefined, '1', '2'])
    expect(sleep).toHaveBeenCalledTimes(3)
  })
})

describe('checkpoint', () => {
  it('advances to now − settle after a successful run and uses a 30-minute overlap next time', async () => {
    const first = fakeClient([])
    await run(first.client)
    const settled = new Date(NOW.getTime() - RECONCILE_SETTLE_MS)
    expect((await checkpoint())!.lastSyncedAt).toEqual(settled)
    expect(first.calls[0]!.to).toEqual(settled)
    expect(first.calls[0]!.from).toEqual(new Date(NOW.getTime() - 24 * 3_600_000 - RECONCILE_OVERLAP_MS))

    const later = new Date(NOW.getTime() + 15 * 60_000)
    const second = fakeClient([])
    await run(second.client, { now: () => later })
    expect(second.calls[0]!.from).toEqual(new Date(settled.getTime() - RECONCILE_OVERLAP_MS))
  })

  it('does not advance on failure, records the error, and still processes other integrations', async () => {
    const good = await createPaymentSetup(await createTenant('g'), { apiToken: 'tok-good' })
    await db().insert(reconcileCheckpoints).values({ integrationId: setup.integration.id, lastSyncedAt: new Date('2026-11-01T10:00:00.000Z') })

    const failing = fakeClient([], { fail: new SepayApiError('RATE_LIMITED', 2) })
    const ok = fakeClient([])
    const summary = await reconcileSepay(db(), {
      createClient: token => (token === 'sepay-token' ? failing.client : ok.client),
      now: () => NOW,
      sleep: noSleep,
    })

    expect(summary.integrations.find(i => i.id === setup.integration.id)).toEqual({ id: setup.integration.id, ok: false, error: 'RATE_LIMITED' })
    expect(summary.integrations.find(i => i.id === good.integration.id)).toEqual({ id: good.integration.id, ok: true })
    const row = (await checkpoint())!
    expect(row.lastSyncedAt).toEqual(new Date('2026-11-01T10:00:00.000Z'))
    expect(row.lastError).toBe('RATE_LIMITED')
  })

  it('treats a runaway pagination as a failure instead of looping forever', async () => {
    const { client } = fakeClient([apiTx()], { endless: true })
    const summary = await run(client)
    expect(summary.integrations[0]).toMatchObject({ ok: false, error: 'TOO_MANY_PAGES' })
    expect(await checkpoint()).toMatchObject({ lastError: 'TOO_MANY_PAGES' })
  })

  it('late money found by reconcile for an auto-cancelled order goes to review, not to the void', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { orderStatus: 'CANCELLED', paymentStatus: 'UNPAID', attemptStatus: 'EXPIRED' })
    await run(fakeClient([apiTx({ code: attempt.paymentCode })]).client)
    expect((await db().select().from(orders).where(eq(orders.id, order.id)))[0]).toMatchObject({ paymentStatus: 'REFUND_DUE' })
    expect((await bankRows())[0]).toMatchObject({ reconciliationStatus: 'REVIEW_REQUIRED', reviewReason: 'ORDER_CANCELLED' })
  })
})
