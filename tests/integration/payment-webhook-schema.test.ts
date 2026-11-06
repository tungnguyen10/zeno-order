import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { getPgError } from '../../server/db/errors'
import { bankTransactions, orderPayments } from '../../server/db/schema'
import { resetDb } from '../support/db'
import { bankTxInput, createAwaitingOrder, createPaymentSetup } from '../support/webhook-fixtures'
import { createTenant } from '../support/fixtures'

const db = () => getDb()

async function insertTx(setup: Awaited<ReturnType<typeof createPaymentSetup>>, overrides: Record<string, unknown> = {}) {
  const input = bankTxInput(setup)
  const [row] = await db().insert(bankTransactions).values({
    orgId: input.orgId,
    integrationId: input.integrationId,
    providerTransactionId: input.providerTransactionId,
    source: input.source,
    direction: input.direction,
    bankAccountNumber: input.bankAccountNumber,
    amountVnd: input.amountVnd,
    transactionDate: input.transactionDate,
    rawPayloadJson: input.rawPayload,
    ...overrides,
  }).returning()
  return row!
}

async function expectPg(promise: Promise<unknown>, code: string, constraint?: string) {
  const err = await promise.then(() => null, (e: unknown) => e)
  expect(err, 'expected the statement to fail').not.toBeNull()
  expect(getPgError(err)).toMatchObject({ code, ...(constraint ? { constraint } : {}) })
}

beforeEach(async () => {
  await resetDb()
})
afterAll(async () => {
  await closeDb()
})

describe('bank_transactions', () => {
  it('rejects a second row with the same (integration, provider id)', async () => {
    const setup = await createPaymentSetup(await createTenant('a'))
    await insertTx(setup, { providerTransactionId: '777' })
    await expectPg(insertTx(setup, { providerTransactionId: '777' }), '23505', 'bank_transactions_integration_provider_uq')
  })

  it('allows the same provider id under a different integration', async () => {
    const one = await createPaymentSetup(await createTenant('a'))
    const two = await createPaymentSetup(await createTenant('b'))
    await insertTx(one, { providerTransactionId: '777' })
    await expect(insertTx(two, { providerTransactionId: '777' })).resolves.toBeTruthy()
  })

  it('rejects zero or negative amounts', async () => {
    const setup = await createPaymentSetup(await createTenant('a'))
    await expectPg(insertTx(setup, { amountVnd: 0 }), '23514', 'bank_transactions_amount_positive')
  })

  it('requires matched store and order to be set together', async () => {
    const tenant = await createTenant('a')
    const setup = await createPaymentSetup(tenant)
    await expectPg(insertTx(setup, { matchedStoreId: tenant.store.id }), '23514', 'bank_transactions_match_pair')
  })

  it('rejects a matched order from another store/tenant', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const setupA = await createPaymentSetup(a)
    const setupB = await createPaymentSetup(b)
    const { order } = await createAwaitingOrder(setupB)
    await expectPg(
      insertTx(setupA, { matchedStoreId: b.store.id, matchedOrderId: order.id }),
      '23503',
      'bank_transactions_store_fk',
    )
  })
})

describe('order_payments bank linkage', () => {
  async function pay(setup: Awaited<ReturnType<typeof createPaymentSetup>>, orderId: string, bankTransactionId: string | null) {
    return db().insert(orderPayments).values({
      orgId: setup.orgId,
      storeId: setup.storeId,
      orderId,
      bankTransactionId,
      method: bankTransactionId ? 'SEPAY' : 'BANK_MANUAL',
      amountVnd: 55_000,
    })
  }

  it('rejects an unknown bank_transaction_id', async () => {
    const setup = await createPaymentSetup(await createTenant('a'))
    const { order } = await createAwaitingOrder(setup)
    await expectPg(pay(setup, order.id, randomUUID()), '23503')
  })

  it('rejects the same bank transaction credited twice', async () => {
    const setup = await createPaymentSetup(await createTenant('a'))
    const one = await createAwaitingOrder(setup)
    const two = await createAwaitingOrder(setup)
    const tx = await insertTx(setup)
    await pay(setup, one.order.id, tx.id)
    await expectPg(pay(setup, two.order.id, tx.id), '23505', 'order_payments_bank_tx_uq')
  })

  it('rejects a second payment on the same order, whatever the method (PR4 order_payments_order_uq)', async () => {
    const setup = await createPaymentSetup(await createTenant('a'))
    const { order } = await createAwaitingOrder(setup)
    const first = await insertTx(setup)
    const second = await insertTx(setup)
    await pay(setup, order.id, first.id)
    await expectPg(pay(setup, order.id, second.id), '23505', 'order_payments_order_uq')
    await expectPg(pay(setup, order.id, null), '23505', 'order_payments_order_uq')
  })

  it('still allows a payment without a bank transaction (manual)', async () => {
    const setup = await createPaymentSetup(await createTenant('a'))
    const { order } = await createAwaitingOrder(setup)
    await pay(setup, order.id, null)
    expect(await db().select().from(orderPayments).where(eq(orderPayments.orderId, order.id))).toHaveLength(1)
  })
})
