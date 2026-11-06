import { and, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { bankTransactions, integrationAccounts, orderEvents, orderPayments, orders, paymentAttempts, storePaymentAccounts } from '../../server/db/schema'
import { matchTransaction } from '../../server/services/payments/match-transaction'
import { PAYMENT_TEST_CODE } from '../../server/services/payments/payment-code'
import { recordBankTransaction } from '../../server/services/payments/record-bank-transaction'
import { createTenant } from '../support/fixtures'
import { bankTxInput, createAttempt, createAwaitingOrder, createPaymentSetup, type PaymentSetup } from '../support/webhook-fixtures'
import { resetDb } from '../support/db'

const db = () => getDb()

let setup: PaymentSetup

async function receive(overrides: Parameters<typeof bankTxInput>[1] = {}) {
  const result = await recordBankTransaction(db(), bankTxInput(setup, overrides))
  return result.id
}

async function state(orderId: string, txId?: string) {
  const [order] = await db().select().from(orders).where(eq(orders.id, orderId))
  const payments = await db().select().from(orderPayments).where(eq(orderPayments.orderId, orderId))
  const attempts = await db().select().from(paymentAttempts).where(eq(paymentAttempts.orderId, orderId))
  const [tx] = txId ? await db().select().from(bankTransactions).where(eq(bankTransactions.id, txId)) : []
  return { order: order!, payments, attempts, tx }
}

beforeEach(async () => {
  await resetDb()
  setup = await createPaymentSetup(await createTenant('a'))
})
afterAll(async () => {
  await closeDb()
})

describe('matchTransaction — happy path', () => {
  it('confirms an exact transfer once: order NEW/PAID, one SEPAY payment, attempt PAID', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { amountVnd: 55_000 })
    const txId = await receive({ paymentCode: attempt.paymentCode, amountVnd: 55_000 })

    expect(await matchTransaction(db(), txId)).toEqual({ kind: 'MATCHED', orderId: order.id, late: false })

    const s = await state(order.id, txId)
    expect(s.order).toMatchObject({ status: 'NEW', paymentStatus: 'PAID', latePayment: false })
    expect(s.payments).toHaveLength(1)
    expect(s.payments[0]).toMatchObject({ method: 'SEPAY', amountVnd: 55_000, bankTransactionId: txId, recordedBy: null })
    expect(s.attempts[0]!.status).toBe('PAID')
    expect(s.tx).toMatchObject({ reconciliationStatus: 'MATCHED', matchedOrderId: order.id, reviewReason: null })
    const events = await db().select().from(orderEvents).where(eq(orderEvents.orderId, order.id))
    expect(events.map(e => e.eventType)).toContain('PAYMENT_CONFIRMED')
  })

  it('supersedes the sibling PENDING attempt of a re-pay flow', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { attemptStatus: 'EXPIRED' })
    await createAttempt(setup, order.id, { paymentCode: 'ZOSIBLING01', status: 'PENDING' })
    const txId = await receive({ paymentCode: attempt.paymentCode })
    expect(await matchTransaction(db(), txId)).toMatchObject({ kind: 'MATCHED', late: true })
    const s = await state(order.id)
    expect(s.attempts.find(a => a.paymentCode === 'ZOSIBLING01')!.status).toBe('SUPERSEDED')
  })

  it('accepts the VA number in either accountNumber or subAccount (gate G5 leaves it open)', async () => {
    const va = await createPaymentSetup(await createTenant('v'), { vaNumber: 'VA00112233' })
    const one = await createAwaitingOrder(va)
    const two = await createAwaitingOrder(va)
    const asSub = await recordBankTransaction(db(), bankTxInput(va, { paymentCode: one.attempt.paymentCode, bankAccountNumber: 'MAIN-ACCOUNT', subAccount: 'VA00112233' }))
    const asMain = await recordBankTransaction(db(), bankTxInput(va, { paymentCode: two.attempt.paymentCode, bankAccountNumber: 'VA00112233' }))
    expect(await matchTransaction(db(), asSub.id)).toMatchObject({ kind: 'MATCHED', orderId: one.order.id })
    expect(await matchTransaction(db(), asMain.id)).toMatchObject({ kind: 'MATCHED', orderId: two.order.id })
  })

  it('matches against the account snapshotted on the attempt, not the store account as edited later', async () => {
    const first = await createAwaitingOrder(setup)
    const second = await createAwaitingOrder(setup)
    const oldNumber = setup.account.accountNumber
    await db().update(storePaymentAccounts).set({ accountNumber: '5555555555' }).where(eq(storePaymentAccounts.id, setup.account.id))
    const toOld = await receive({ paymentCode: first.attempt.paymentCode, bankAccountNumber: oldNumber })
    const toNew = await receive({ paymentCode: second.attempt.paymentCode, bankAccountNumber: '5555555555' })
    expect(await matchTransaction(db(), toOld)).toMatchObject({ kind: 'MATCHED', orderId: first.order.id })
    expect(await matchTransaction(db(), toNew)).toEqual({ kind: 'REVIEW', reason: 'ACCOUNT_MISMATCH', orderId: second.order.id })
  })

  it('an account that is no longer linked to the integration is ACCOUNT_MISMATCH', async () => {
    const { order, attempt } = await createAwaitingOrder(setup)
    await db().delete(integrationAccounts).where(eq(integrationAccounts.paymentAccountId, setup.account.id))
    const txId = await receive({ paymentCode: attempt.paymentCode })
    expect(await matchTransaction(db(), txId)).toEqual({ kind: 'REVIEW', reason: 'ACCOUNT_MISMATCH', orderId: order.id })
  })

  it('the owner\'s own QR-check transfer (PAYMENT_TEST_CODE) resolves itself and never pollutes the review queue', async () => {
    const txId = await receive({ paymentCode: PAYMENT_TEST_CODE, amountVnd: 2_000 })
    expect(await matchTransaction(db(), txId)).toEqual({ kind: 'IGNORED' })
    const [row] = await db().select().from(bankTransactions).where(eq(bankTransactions.id, txId))
    expect(row).toMatchObject({ reconciliationStatus: 'RESOLVED', resolution: 'NOT_ORDER' })
  })

  it('is idempotent: matching again is SKIPPED and changes nothing', async () => {
    const { order, attempt } = await createAwaitingOrder(setup)
    const txId = await receive({ paymentCode: attempt.paymentCode })
    await matchTransaction(db(), txId)
    expect(await matchTransaction(db(), txId)).toEqual({ kind: 'SKIPPED', status: 'MATCHED' })
    expect((await state(order.id)).payments).toHaveLength(1)
  })
})

describe('matchTransaction — late, cancelled, duplicate', () => {
  it.each(['EXPIRED', 'SUPERSEDED'] as const)('confirms money that arrives after the attempt is %s and flags late_payment', async (attemptStatus) => {
    const { order, attempt } = await createAwaitingOrder(setup, { attemptStatus })
    const txId = await receive({ paymentCode: attempt.paymentCode })
    expect(await matchTransaction(db(), txId)).toEqual({ kind: 'MATCHED', orderId: order.id, late: true })
    expect((await state(order.id)).order).toMatchObject({ status: 'NEW', paymentStatus: 'PAID', latePayment: true })
  })

  it('sends money for a cancelled order to review and marks the order REFUND_DUE (no payment row)', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { orderStatus: 'CANCELLED', paymentStatus: 'UNPAID', attemptStatus: 'EXPIRED' })
    const txId = await receive({ paymentCode: attempt.paymentCode })
    expect(await matchTransaction(db(), txId)).toEqual({ kind: 'REVIEW', reason: 'ORDER_CANCELLED', orderId: order.id })
    const s = await state(order.id, txId)
    expect(s.order).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUND_DUE' })
    expect(s.payments).toHaveLength(0)
    expect(s.tx).toMatchObject({ reconciliationStatus: 'REVIEW_REQUIRED', reviewReason: 'ORDER_CANCELLED', matchedOrderId: order.id })
  })

  it('sends a second transfer for an already PAID order to review; exactly one payment stays', async () => {
    const { order, attempt } = await createAwaitingOrder(setup)
    const first = await receive({ paymentCode: attempt.paymentCode })
    const second = await receive({ paymentCode: attempt.paymentCode })
    expect(await matchTransaction(db(), first)).toMatchObject({ kind: 'MATCHED' })
    expect(await matchTransaction(db(), second)).toEqual({ kind: 'REVIEW', reason: 'ORDER_ALREADY_PAID', orderId: order.id })
    const s = await state(order.id, second)
    expect(s.payments).toHaveLength(1)
    expect(s.order.paymentStatus).toBe('PAID')
    expect(s.tx).toMatchObject({ reconciliationStatus: 'REVIEW_REQUIRED', reviewReason: 'ORDER_ALREADY_PAID' })
  })
})

describe('matchTransaction — mismatches never auto-pay', () => {
  it.each([
    ['AMOUNT_UNDER', 54_999],
    ['AMOUNT_OVER', 55_001],
  ] as const)('%s → review, order keeps AWAITING_PAYMENT and becomes REVIEW_REQUIRED', async (reason, amountVnd) => {
    const { order, attempt } = await createAwaitingOrder(setup, { amountVnd: 55_000 })
    const txId = await receive({ paymentCode: attempt.paymentCode, amountVnd })
    expect(await matchTransaction(db(), txId)).toEqual({ kind: 'REVIEW', reason, orderId: order.id })
    const s = await state(order.id)
    expect(s.order).toMatchObject({ status: 'AWAITING_PAYMENT', paymentStatus: 'REVIEW_REQUIRED' })
    expect(s.payments).toHaveLength(0)
  })

  it('wrong receiving account → ACCOUNT_MISMATCH and the order is flagged', async () => {
    const { order, attempt } = await createAwaitingOrder(setup)
    const txId = await receive({ paymentCode: attempt.paymentCode, bankAccountNumber: '000111222' })
    expect(await matchTransaction(db(), txId)).toEqual({ kind: 'REVIEW', reason: 'ACCOUNT_MISMATCH', orderId: order.id })
    expect((await state(order.id)).order.paymentStatus).toBe('REVIEW_REQUIRED')
  })

  it('no code → NO_CODE; unknown code → UNKNOWN_CODE; neither touches an order', async () => {
    const { order } = await createAwaitingOrder(setup)
    const noCode = await receive({ paymentCode: null })
    const unknown = await receive({ paymentCode: 'ZOUNKNOWN1' })
    expect(await matchTransaction(db(), noCode)).toEqual({ kind: 'REVIEW', reason: 'NO_CODE', orderId: null })
    expect(await matchTransaction(db(), unknown)).toEqual({ kind: 'REVIEW', reason: 'UNKNOWN_CODE', orderId: null })
    expect((await state(order.id)).order).toMatchObject({ status: 'AWAITING_PAYMENT', paymentStatus: 'PENDING' })
  })

  it('a code that belongs to another organisation is UNKNOWN_CODE and never credits that org', async () => {
    const other = await createPaymentSetup(await createTenant('b'))
    const foreign = await createAwaitingOrder(other)
    const txId = await receive({ paymentCode: foreign.attempt.paymentCode })
    expect(await matchTransaction(db(), txId)).toEqual({ kind: 'REVIEW', reason: 'UNKNOWN_CODE', orderId: null })
    expect((await state(foreign.order.id)).order).toMatchObject({ status: 'AWAITING_PAYMENT', paymentStatus: 'PENDING' })
  })

  it('an order that is no longer waiting for payment → ORDER_NOT_PAYABLE', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { orderStatus: 'NEW', paymentStatus: 'UNPAID' })
    const txId = await receive({ paymentCode: attempt.paymentCode })
    expect(await matchTransaction(db(), txId)).toEqual({ kind: 'REVIEW', reason: 'ORDER_NOT_PAYABLE', orderId: order.id })
  })

  it('outgoing transfers are IGNORED at ingestion and SKIPPED by the matcher', async () => {
    const txId = await receive({ direction: 'OUT', paymentCode: 'ZOABCDEFGH' })
    expect(await matchTransaction(db(), txId)).toEqual({ kind: 'SKIPPED', status: 'IGNORED' })
  })
})

describe('matchTransaction — concurrency (Review Focus #1, #2)', () => {
  it('five concurrent matches of the same transaction produce exactly one payment', async () => {
    const { order, attempt } = await createAwaitingOrder(setup)
    const txId = await receive({ paymentCode: attempt.paymentCode })
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => matchTransaction(db(), txId)))
    expect(outcomes.filter(o => o.kind === 'MATCHED')).toHaveLength(1)
    expect(outcomes.filter(o => o.kind === 'SKIPPED')).toHaveLength(4)
    expect((await state(order.id)).payments).toHaveLength(1)
  })

  it('two different transactions for the same code: one confirms, the other goes to review', async () => {
    const { order, attempt } = await createAwaitingOrder(setup)
    const a = await receive({ paymentCode: attempt.paymentCode })
    const b = await receive({ paymentCode: attempt.paymentCode })
    const outcomes = await Promise.all([matchTransaction(db(), a), matchTransaction(db(), b)])
    expect(outcomes.filter(o => o.kind === 'MATCHED')).toHaveLength(1)
    expect(outcomes.filter(o => o.kind === 'REVIEW' && o.reason === 'ORDER_ALREADY_PAID')).toHaveLength(1)
    const s = await state(order.id)
    expect(s.payments).toHaveLength(1)
    const reviewed = await db().select().from(bankTransactions).where(and(eq(bankTransactions.orgId, setup.orgId), eq(bankTransactions.reconciliationStatus, 'REVIEW_REQUIRED')))
    expect(reviewed).toHaveLength(1)
  })

  it('a burst across several orders (each paid twice) never deadlocks and pays each order once', async () => {
    const orderIds: string[] = []
    const txIds: string[] = []
    for (let i = 0; i < 3; i++) {
      const { order, attempt } = await createAwaitingOrder(setup)
      orderIds.push(order.id)
      for (let j = 0; j < 3; j++) txIds.push(await receive({ paymentCode: attempt.paymentCode }))
    }
    const outcomes = await Promise.all(txIds.map(id => matchTransaction(db(), id)))
    expect(outcomes.filter(o => o.kind === 'MATCHED')).toHaveLength(3)
    expect(outcomes.filter(o => o.kind === 'REVIEW')).toHaveLength(6)
    for (const orderId of orderIds) expect((await state(orderId)).payments).toHaveLength(1)
  })
})
