import { lockOrgPayments } from './payment-lock'
import { and, eq } from 'drizzle-orm'
import type { ReviewReason } from '../../../shared/payments'
import type { Db, Tx } from '../../db/client'
import {
  bankTransactionEvents, bankTransactions, integrationAccounts, sepayIntegrations, orderEvents, orders, paymentAttempts,
} from '../../db/schema'
import { AppError } from '../../utils/errors'
import { confirmOrderPayment } from './confirm-payment'
import { lockOrderGraph, type OrderRow, type PaymentAttemptRow } from './lock-order-graph'
import { PAYMENT_TEST_CODE } from './payment-code'
import type { MatchOutcome } from './types'

type BankTxRow = typeof bankTransactions.$inferSelect

// Money must reach the account PR5 snapshotted on the attempt (so editing the store account later never
// misdirects an old QR), and that account must still be linked to the integration the webhook arrived on.
// `accountNumber` or `subAccount` may carry the VA number (gate G5), so either side may match either number.
async function accountMatches(tx: Tx, bt: BankTxRow, attempt: PaymentAttemptRow): Promise<boolean> {
  const [integration] = await tx.select({ environment: sepayIntegrations.environment }).from(sepayIntegrations).where(eq(sepayIntegrations.id, bt.integrationId))
  if (integration?.environment !== 'live') return false
  if (!bt.bankCode || bt.bankCode !== attempt.bankCode) return false
  const [linked] = await tx.select({ paymentAccountId: integrationAccounts.paymentAccountId })
    .from(integrationAccounts)
    .where(and(eq(integrationAccounts.integrationId, bt.integrationId), eq(integrationAccounts.paymentAccountId, attempt.accountId)))
    .limit(1)
  if (!linked) return false
  const expected = [attempt.accountNumber, attempt.vaNumber].filter((value): value is string => !!value)
  const received = [bt.bankAccountNumber, bt.subAccount].filter((value): value is string => !!value)
  if (attempt.vaNumber) return received.includes(attempt.vaNumber)
  return received.some(number => expected.includes(number))
}

async function markTestTransfer(tx: Tx, bt: BankTxRow): Promise<MatchOutcome> {
  await tx.update(bankTransactions).set({
    reconciliationStatus: 'RESOLVED',
    resolution: 'NOT_ORDER',
    resolutionNote: 'Giao dịch thử khi kiểm tra tài khoản',
    resolvedAt: new Date(),
  }).where(eq(bankTransactions.id, bt.id))
  await tx.insert(bankTransactionEvents).values({
    orgId: bt.orgId,
    bankTransactionId: bt.id,
    action: 'RESOLVED',
    fromStatus: 'RECEIVED',
    toStatus: 'RESOLVED',
    metadata: { reason: 'TEST_TRANSFER' },
  })
  return { kind: 'IGNORED' }
}

async function flagOrderForReview(tx: Tx, order: OrderRow): Promise<void> {
  await tx.update(orders).set({ paymentStatus: 'REVIEW_REQUIRED' })
    .where(and(eq(orders.id, order.id), eq(orders.paymentStatus, 'PENDING')))
}

async function markReview(tx: Tx, bt: BankTxRow, reason: ReviewReason, order: OrderRow | null): Promise<MatchOutcome> {
  await tx.update(bankTransactions).set({
    reconciliationStatus: 'REVIEW_REQUIRED',
    reviewReason: reason,
    matchedStoreId: order?.storeId ?? null,
    matchedOrderId: order?.id ?? null,
  }).where(eq(bankTransactions.id, bt.id))
  await tx.insert(bankTransactionEvents).values({
    orgId: bt.orgId,
    bankTransactionId: bt.id,
    action: 'REVIEW_REQUIRED',
    fromStatus: 'RECEIVED',
    toStatus: 'REVIEW_REQUIRED',
    orderId: order?.id ?? null,
    metadata: { reason },
  })
  if (order) {
    await tx.insert(orderEvents).values({
      orgId: order.orgId,
      storeId: order.storeId,
      orderId: order.id,
      actorUserId: null,
      eventType: 'PAYMENT_REVIEW_REQUIRED',
      metadata: { bankTransactionId: bt.id, reason, amountVnd: bt.amountVnd },
    })
  }
  return { kind: 'REVIEW', reason, orderId: order?.id ?? null }
}

export async function matchTransaction(db: Db, bankTransactionId: string): Promise<MatchOutcome> {
  const [tenantHint] = await db.select({ orgId: bankTransactions.orgId }).from(bankTransactions).where(eq(bankTransactions.id, bankTransactionId))
  if (!tenantHint) throw new AppError('NOT_FOUND', 'Không tìm thấy giao dịch')
  return db.transaction(async (tx) => {
    await lockOrgPayments(tx, tenantHint.orgId, true)
    const [bt] = await tx.select().from(bankTransactions).where(eq(bankTransactions.id, bankTransactionId)).for('update')
    if (!bt) throw new AppError('NOT_FOUND', 'Không tìm thấy giao dịch')
    if (bt.reconciliationStatus !== 'RECEIVED') return { kind: 'SKIPPED', status: bt.reconciliationStatus }
    if (bt.direction === 'OUT') {
      await tx.update(bankTransactions).set({ reconciliationStatus: 'IGNORED' }).where(eq(bankTransactions.id, bt.id))
      return { kind: 'IGNORED' }
    }
    if (!bt.paymentCode) return markReview(tx, bt, 'NO_CODE', null)
    if (bt.paymentCode === PAYMENT_TEST_CODE) return markTestTransfer(tx, bt)

    // Unlocked read only to learn which order owns the code; the org filter keeps tenants apart.
    const [hint] = await tx.select({ id: paymentAttempts.id, storeId: paymentAttempts.storeId, orderId: paymentAttempts.orderId })
      .from(paymentAttempts)
      .where(and(eq(paymentAttempts.paymentCode, bt.paymentCode), eq(paymentAttempts.orgId, bt.orgId)))
      .limit(1)
    if (!hint) return markReview(tx, bt, 'UNKNOWN_CODE', null)

    const { attempts, order } = await lockOrderGraph(tx, { orgId: bt.orgId, storeId: hint.storeId, orderId: hint.orderId })
    const attempt = attempts.find(a => a.id === hint.id)
    if (!order || !attempt) return markReview(tx, bt, 'UNKNOWN_CODE', null)

    if (!(await accountMatches(tx, bt, attempt))) {
      await flagOrderForReview(tx, order)
      return markReview(tx, bt, 'ACCOUNT_MISMATCH', order)
    }
    if (order.status === 'CANCELLED') {
      await tx.update(orders).set({ paymentStatus: 'REFUND_DUE' }).where(eq(orders.id, order.id))
      return markReview(tx, bt, 'ORDER_CANCELLED', order)
    }
    if (order.paymentStatus === 'PAID') return markReview(tx, bt, 'ORDER_ALREADY_PAID', order)
    if (
      order.status !== 'AWAITING_PAYMENT'
      || !['PENDING', 'REVIEW_REQUIRED'].includes(order.paymentStatus)
      || attempt.status === 'PAID'
    ) {
      return markReview(tx, bt, 'ORDER_NOT_PAYABLE', order)
    }
    if (bt.amountVnd !== attempt.expectedAmountVnd) {
      await flagOrderForReview(tx, order)
      return markReview(tx, bt, bt.amountVnd < attempt.expectedAmountVnd ? 'AMOUNT_UNDER' : 'AMOUNT_OVER', order)
    }

    const late = attempt.status !== 'PENDING' || bt.transactionDate.getTime() > attempt.expiresAt.getTime()
    await confirmOrderPayment(tx, {
      order,
      method: 'SEPAY',
      amountVnd: bt.amountVnd,
      bankTransactionId: bt.id,
      paymentCodeAttemptId: attempt.id,
      actorUserId: null,
      late,
      eventType: 'PAYMENT_CONFIRMED',
      note: null,
      metadata: { bankTransactionId: bt.id, source: bt.source },
    })
    await tx.update(bankTransactions).set({
      reconciliationStatus: 'MATCHED',
      reviewReason: null,
      matchedStoreId: order.storeId,
      matchedOrderId: order.id,
    }).where(eq(bankTransactions.id, bt.id))
    await tx.insert(bankTransactionEvents).values({
      orgId: bt.orgId,
      bankTransactionId: bt.id,
      action: 'MATCHED',
      fromStatus: 'RECEIVED',
      toStatus: 'MATCHED',
      orderId: order.id,
      metadata: { late },
    })
    return { kind: 'MATCHED', orderId: order.id, late }
  })
}
