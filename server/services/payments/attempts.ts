import { and, desc, eq, exists, gt, isNotNull, sql } from 'drizzle-orm'
import { findBank } from '../../../shared/banks'
import { assertVnd } from '../../../shared/money'
import type { PaymentQr } from '../../../shared/types/order'
import type { Db, DbOrTx } from '../../db/client'
import { integrationAccounts, orders, paymentAttempts, sepayIntegrations, storePaymentAccounts, stores } from '../../db/schema'
import { AppError } from '../../utils/errors'
import { hashToken } from '../../utils/tokens'
import { MAX_PAYMENT_CODE_ATTEMPTS } from './constants'
import { buildTransferContent, buildVietQrUrl, generatePaymentCode as defaultGeneratePaymentCode, PAYMENT_TEST_CODE } from './payment-code'

export interface StoreScope { orgId: string, storeId: string }
export interface OrderRef extends StoreScope { orderId: string }
export interface BankQrReceiver {
  accountId: string
  bankCode: string
  accountNumber: string
  vaNumber: string | null
  accountHolder: string
}
export interface AttemptDeps {
  now?: Date
  generatePaymentCode?: () => string
}
export interface CreateAttemptInput extends OrderRef {
  amountVnd: number
  receiver: BankQrReceiver
}

type AttemptRow = typeof paymentAttempts.$inferSelect

const GUEST_TOKEN = /^[A-Za-z0-9_-]{43}$/

export function toPaymentQr(row: AttemptRow): PaymentQr {
  const qrAccount = row.vaNumber ?? row.accountNumber
  return {
    bankName: findBank(row.bankCode)?.shortName ?? row.bankCode,
    accountNumber: qrAccount,
    accountHolder: row.accountHolder,
    amountVnd: row.expectedAmountVnd,
    transferContent: row.transferContent,
    imageUrl: buildVietQrUrl({
      bankCode: row.bankCode,
      accountNumber: qrAccount,
      amountVnd: row.expectedAmountVnd,
      paymentCode: row.paymentCode,
    }),
    expiresAt: row.expiresAt.toISOString(),
  }
}

export async function findBankQrReceiver(db: DbOrTx, scope: StoreScope): Promise<BankQrReceiver | null> {
  const [row] = await db
    .select()
    .from(storePaymentAccounts)
    .where(and(
      eq(storePaymentAccounts.orgId, scope.orgId),
      eq(storePaymentAccounts.storeId, scope.storeId),
      eq(storePaymentAccounts.isActive, true),
      isNotNull(storePaymentAccounts.qrCheckedAt),
      isNotNull(storePaymentAccounts.verifiedAt),
      exists(
        db
          .select({ one: sql`1` })
          .from(integrationAccounts)
          .innerJoin(sepayIntegrations, and(
            eq(sepayIntegrations.orgId, integrationAccounts.orgId),
            eq(sepayIntegrations.id, integrationAccounts.integrationId),
          ))
          .where(and(
            eq(integrationAccounts.paymentAccountId, storePaymentAccounts.id),
            eq(sepayIntegrations.status, 'ACTIVE'),
            eq(sepayIntegrations.environment, 'live'),
          )),
      ),
    ))
    .limit(1)
  if (!row) return null
  return {
    accountId: row.id,
    bankCode: row.bankCode,
    accountNumber: row.accountNumber,
    vaNumber: row.vaNumber,
    accountHolder: row.accountHolder,
  }
}

export async function requireBankQrReceiver(db: DbOrTx, scope: StoreScope): Promise<BankQrReceiver> {
  const receiver = await findBankQrReceiver(db, scope)
  if (!receiver) throw new AppError('PAYMENT_METHOD_UNAVAILABLE', 'Cửa hàng chưa bật thanh toán chuyển khoản')
  return receiver
}

export async function createPaymentAttempt(db: DbOrTx, input: CreateAttemptInput, deps: AttemptDeps = {}): Promise<PaymentQr> {
  assertVnd(input.amountVnd)
  if (input.amountVnd < 1) throw new AppError('PAYMENT_METHOD_UNAVAILABLE', 'Đơn 0đ không thanh toán bằng chuyển khoản')
  const now = deps.now ?? new Date()
  const generate = deps.generatePaymentCode ?? defaultGeneratePaymentCode

  const [store] = await db
    .select({ ttlMinutes: stores.paymentTtlMinutes })
    .from(stores)
    .where(and(eq(stores.id, input.storeId), eq(stores.orgId, input.orgId)))
  if (!store) throw new AppError('NOT_FOUND', 'Không tìm thấy')
  const expiresAt = new Date(now.getTime() + store.ttlMinutes * 60_000)

  for (let attempt = 0; attempt < MAX_PAYMENT_CODE_ATTEMPTS; attempt++) {
    const paymentCode = generate()
    // PR6 treats this reserved QR-check code as a non-order transfer.
    if (paymentCode === PAYMENT_TEST_CODE) continue
    // ON CONFLICT DO NOTHING keeps a code collision from aborting the caller's transaction.
    const [row] = await db
      .insert(paymentAttempts)
      .values({
        orgId: input.orgId,
        storeId: input.storeId,
        orderId: input.orderId,
        accountId: input.receiver.accountId,
        bankCode: input.receiver.bankCode,
        accountNumber: input.receiver.accountNumber,
        vaNumber: input.receiver.vaNumber,
        accountHolder: input.receiver.accountHolder,
        paymentCode,
        transferContent: buildTransferContent(input.receiver.bankCode, paymentCode),
        expectedAmountVnd: input.amountVnd,
        expiresAt,
      })
      .onConflictDoNothing({ target: paymentAttempts.paymentCode })
      .returning()
    if (row) return toPaymentQr(row)
  }
  throw new AppError('INTERNAL', 'Không tạo được mã thanh toán, vui lòng thử lại')
}

export async function getActiveQrForOrder(
  db: DbOrTx,
  ref: { storeId: string, orderId: string },
  now = new Date(),
): Promise<PaymentQr | null> {
  const [row] = await db
    .select()
    .from(paymentAttempts)
    .where(and(
      eq(paymentAttempts.storeId, ref.storeId),
      eq(paymentAttempts.orderId, ref.orderId),
      eq(paymentAttempts.status, 'PENDING'),
      gt(paymentAttempts.expiresAt, now),
    ))
    .orderBy(desc(paymentAttempts.createdAt))
    .limit(1)
  return row ? toPaymentQr(row) : null
}

export async function findOrderRefByGuestToken(db: DbOrTx, token: string): Promise<OrderRef | null> {
  if (!GUEST_TOKEN.test(token)) return null
  const [row] = await db
    .select({ orgId: orders.orgId, storeId: orders.storeId, orderId: orders.id })
    .from(orders)
    .where(eq(orders.guestTokenHash, hashToken(token)))
  return row ?? null
}

export async function createReplacementAttempt(
  db: Db,
  ref: OrderRef,
  deps: AttemptDeps = {},
): Promise<{ qr: PaymentQr, created: boolean }> {
  const now = deps.now ?? new Date()
  return db.transaction(async (tx) => {
    // The row lock serialises concurrent "Tạo mã mới" taps: the second sees the first one's fresh attempt.
    const [order] = await tx
      .select({
        status: orders.status,
        paymentMethod: orders.paymentMethod,
        paymentStatus: orders.paymentStatus,
        totalVnd: orders.totalVnd,
      })
      .from(orders)
      .where(and(eq(orders.id, ref.orderId), eq(orders.storeId, ref.storeId), eq(orders.orgId, ref.orgId)))
      .for('update')
    if (!order) throw new AppError('NOT_FOUND', 'Không tìm thấy')
    if (order.paymentMethod !== 'BANK_QR') throw new AppError('STATUS_CONFLICT', 'Đơn này không thanh toán bằng chuyển khoản')
    if (order.status !== 'AWAITING_PAYMENT' || order.paymentStatus !== 'PENDING') {
      throw new AppError('STATUS_CONFLICT', 'Đơn không còn chờ thanh toán')
    }

    const active = await getActiveQrForOrder(tx, ref, now)
    if (active) return { qr: active, created: false }

    const receiver = await requireBankQrReceiver(tx, ref)
    await tx
      .update(paymentAttempts)
      .set({ status: 'SUPERSEDED', updatedAt: now })
      .where(and(
        eq(paymentAttempts.storeId, ref.storeId),
        eq(paymentAttempts.orderId, ref.orderId),
        eq(paymentAttempts.status, 'PENDING'),
      ))
    const qr = await createPaymentAttempt(tx, { ...ref, amountVnd: order.totalVnd, receiver }, deps)
    return { qr, created: true }
  })
}
