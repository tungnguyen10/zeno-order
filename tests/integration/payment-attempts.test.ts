import { and, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { orders, paymentAttempts, sepayIntegrations, storePaymentAccounts, stores } from '../../server/db/schema'
import {
  createPaymentAttempt,
  createReplacementAttempt,
  findBankQrReceiver,
  findOrderRefByGuestToken,
  getActiveQrForOrder,
  requireBankQrReceiver,
} from '../../server/services/payments/attempts'
import { PAYMENT_CODE_PATTERN } from '../../server/services/payments/payment-code'
import { generateToken, hashToken } from '../../server/utils/tokens'
import { insertRawOrder } from '../support/checkout-fixtures'
import { resetDb } from '../support/db'
import { createTenant } from '../support/fixtures'
import { createIntegration, createPaymentAccount, setupBankQr } from '../support/payment-fixtures'

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

type Tenant = Awaited<ReturnType<typeof createTenant>>
const scopeOf = (t: Tenant) => ({ orgId: t.org.id, storeId: t.store.id })

function awaitingOrder(t: Tenant, over: Partial<typeof orders.$inferInsert> = {}) {
  return insertRawOrder(t.store, {
    paymentMethod: 'BANK_QR', status: 'AWAITING_PAYMENT', paymentStatus: 'PENDING',
    subtotalVnd: 70_000, totalVnd: 70_000, ...over,
  })
}

async function readyTenant(label: string, opts: Parameters<typeof setupBankQr>[1] = {}) {
  const t = await createTenant(label)
  const setup = await setupBankQr(t.store, opts)
  return { t, ...setup }
}

async function attemptsOf(orderId: string) {
  return getDb().select().from(paymentAttempts).where(eq(paymentAttempts.orderId, orderId)).orderBy(paymentAttempts.createdAt)
}

describe('findBankQrReceiver', () => {
  it('returns the verified account of a store with an ACTIVE integration', async () => {
    const { t, account } = await readyTenant('r1')
    expect(await findBankQrReceiver(getDb(), scopeOf(t))).toEqual({
      accountId: account.id, bankCode: 'VCB', accountNumber: '9988776655', vaNumber: null, accountHolder: 'NGUYEN VAN A',
    })
  })

  it('is null for a store that never set up payments', async () => {
    const t = await createTenant('r2')
    expect(await findBankQrReceiver(getDb(), scopeOf(t))).toBeNull()
    await expect(requireBankQrReceiver(getDb(), scopeOf(t))).rejects.toMatchObject({ code: 'PAYMENT_METHOD_UNAVAILABLE' })
  })

  it('is null while the integration is not ACTIVE, the account is unverified, or it is inactive', async () => {
    const { t, account, integration } = await readyTenant('r3')
    await getDb().update(sepayIntegrations).set({ status: 'TESTING' }).where(eq(sepayIntegrations.id, integration.id))
    expect(await findBankQrReceiver(getDb(), scopeOf(t))).toBeNull()
    await getDb().update(sepayIntegrations).set({ status: 'ACTIVE' }).where(eq(sepayIntegrations.id, integration.id))
    expect(await findBankQrReceiver(getDb(), scopeOf(t))).not.toBeNull()
    await getDb().update(storePaymentAccounts).set({ verifiedAt: null }).where(eq(storePaymentAccounts.id, account.id))
    expect(await findBankQrReceiver(getDb(), scopeOf(t))).toBeNull()
    await getDb().update(storePaymentAccounts).set({ verifiedAt: new Date(), isActive: false }).where(eq(storePaymentAccounts.id, account.id))
    expect(await findBankQrReceiver(getDb(), scopeOf(t))).toBeNull()
  })

  it('does not accept customer payments through an ACTIVE test-mode integration', async () => {
    const { t, integration } = await readyTenant('test-mode')
    await getDb().update(sepayIntegrations).set({ environment: 'test' }).where(eq(sepayIntegrations.id, integration.id))
    expect(await findBankQrReceiver(getDb(), scopeOf(t))).toBeNull()
  })

  it('is null when the account is not linked to any integration', async () => {
    const t = await createTenant('r4')
    const now = new Date()
    await createPaymentAccount(t.store, { qrCheckedAt: now, verifiedAt: now })
    await createIntegration(t.org, { status: 'ACTIVE' as const, encryptedHmacSecret: 'v1.x.y.z' })
    expect(await findBankQrReceiver(getDb(), scopeOf(t))).toBeNull()
  })

  it('never returns an account of another store', async () => {
    const a = await readyTenant('r5a')
    const b = await createTenant('r5b')
    expect(await findBankQrReceiver(getDb(), scopeOf(b))).toBeNull()
    expect(await findBankQrReceiver(getDb(), { orgId: b.org.id, storeId: a.t.store.id })).toBeNull()
  })

  it('stops offering the store once the owner edits the account (Review Focus #4)', async () => {
    const { t, account } = await readyTenant('r6')
    await getDb().update(storePaymentAccounts)
      .set({ accountNumber: '1122334455', qrCheckedAt: null, verifiedAt: null })
      .where(eq(storePaymentAccounts.id, account.id))
    expect(await findBankQrReceiver(getDb(), scopeOf(t))).toBeNull()
  })
})

describe('createPaymentAttempt', () => {
  it('snapshots the account, takes the amount and TTL from the server and returns the QR', async () => {
    const { t } = await readyTenant('c1')
    await getDb().update(stores).set({ paymentTtlMinutes: 20 }).where(eq(stores.id, t.store.id))
    const order = await awaitingOrder(t)
    const receiver = await requireBankQrReceiver(getDb(), scopeOf(t))
    const now = new Date('2026-11-01T05:00:00Z')

    const qr = await createPaymentAttempt(getDb(), { ...scopeOf(t), orderId: order.id, amountVnd: 70_000, receiver }, { now })

    expect(qr.expiresAt).toBe('2026-11-01T05:20:00.000Z')
    expect(qr).toMatchObject({ bankName: 'Vietcombank', accountNumber: '9988776655', accountHolder: 'NGUYEN VAN A', amountVnd: 70_000 })
    expect(qr.transferContent).toMatch(PAYMENT_CODE_PATTERN)
    const url = new URL(qr.imageUrl)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      acc: '9988776655', bank: '970436', amount: '70000', des: qr.transferContent, template: 'qronly',
    })
    const [row] = await attemptsOf(order.id)
    expect(row).toMatchObject({
      status: 'PENDING', bankCode: 'VCB', accountNumber: '9988776655', vaNumber: null, expectedAmountVnd: 70_000,
      paymentCode: qr.transferContent, transferContent: qr.transferContent,
    })
  })

  it('uses the VA as the QR account when the account has one', async () => {
    const { t } = await readyTenant('c2', { bankCode: 'OCB', vaNumber: 'VQRQ12345678' })
    const order = await awaitingOrder(t)
    const receiver = await requireBankQrReceiver(getDb(), scopeOf(t))
    const qr = await createPaymentAttempt(getDb(), { ...scopeOf(t), orderId: order.id, amountVnd: 70_000, receiver })
    expect(qr.accountNumber).toBe('VQRQ12345678')
    expect(new URL(qr.imageUrl).searchParams.get('acc')).toBe('VQRQ12345678')
    const [row] = await attemptsOf(order.id)
    expect(row).toMatchObject({ accountNumber: '9988776655', vaNumber: 'VQRQ12345678' })
  })

  it('writes SEVQR into both the QR and the stored content for VietinBank (Review Focus #1)', async () => {
    const { t } = await readyTenant('c3', { bankCode: 'ICB' })
    const order = await awaitingOrder(t)
    const receiver = await requireBankQrReceiver(getDb(), scopeOf(t))
    const qr = await createPaymentAttempt(getDb(), { ...scopeOf(t), orderId: order.id, amountVnd: 70_000, receiver })
    expect(qr.transferContent).toMatch(/^SEVQR ZO[A-Z0-9]{8}$/)
    expect(new URL(qr.imageUrl).searchParams.get('des')).toBe(qr.transferContent)
    const [row] = await attemptsOf(order.id)
    expect(row!.paymentCode).toMatch(PAYMENT_CODE_PATTERN)
    expect(row!.transferContent).toBe(`SEVQR ${row!.paymentCode}`)
  })

  it('retries when a generated code is already taken, and fails cleanly when none is free', async () => {
    const { t } = await readyTenant('c4')
    const taken = await awaitingOrder(t)
    const order = await awaitingOrder(t)
    const receiver = await requireBankQrReceiver(getDb(), scopeOf(t))
    await createPaymentAttempt(getDb(), { ...scopeOf(t), orderId: taken.id, amountVnd: 70_000, receiver }, { generatePaymentCode: () => 'ZODUPLICAT' })

    const sequence = vi.fn().mockReturnValueOnce('ZODUPLICAT').mockReturnValueOnce('ZODUPLICAT').mockReturnValue('ZOFRESH001')
    const qr = await createPaymentAttempt(getDb(), { ...scopeOf(t), orderId: order.id, amountVnd: 70_000, receiver }, { generatePaymentCode: sequence })
    expect(qr.transferContent).toBe('ZOFRESH001')
    expect(sequence).toHaveBeenCalledTimes(3)

    const third = await awaitingOrder(t)
    const alwaysTaken = vi.fn().mockReturnValue('ZODUPLICAT')
    await expect(createPaymentAttempt(getDb(), { ...scopeOf(t), orderId: third.id, amountVnd: 70_000, receiver }, { generatePaymentCode: alwaysTaken }))
      .rejects.toMatchObject({ code: 'INTERNAL' })
    expect(alwaysTaken).toHaveBeenCalledTimes(5)
  })

  it('never allocates the reserved QR-check code to a customer order', async () => {
    const { t } = await readyTenant('reserved')
    const order = await awaitingOrder(t)
    const receiver = await requireBankQrReceiver(getDb(), scopeOf(t))
    const generate = vi.fn().mockReturnValueOnce('ZOTEST0000').mockReturnValue('ZOCUST0001')
    const qr = await createPaymentAttempt(getDb(), { ...scopeOf(t), orderId: order.id, amountVnd: 70_000, receiver }, { generatePaymentCode: generate })
    expect(qr.transferContent).toBe('ZOCUST0001')
    expect(generate).toHaveBeenCalledTimes(2)
    expect((await attemptsOf(order.id)).map(row => row.paymentCode)).toEqual(['ZOCUST0001'])
  })

  it('refuses a zero amount instead of crashing on the DB check', async () => {
    const { t } = await readyTenant('c5')
    const order = await awaitingOrder(t, { subtotalVnd: 0, totalVnd: 0 })
    const receiver = await requireBankQrReceiver(getDb(), scopeOf(t))
    await expect(createPaymentAttempt(getDb(), { ...scopeOf(t), orderId: order.id, amountVnd: 0, receiver }))
      .rejects.toMatchObject({ code: 'PAYMENT_METHOD_UNAVAILABLE' })
  })

  it('does not break the caller\'s transaction on a code collision', async () => {
    const { t } = await readyTenant('c6')
    const first = await awaitingOrder(t)
    const second = await awaitingOrder(t)
    const receiver = await requireBankQrReceiver(getDb(), scopeOf(t))
    await createPaymentAttempt(getDb(), { ...scopeOf(t), orderId: first.id, amountVnd: 70_000, receiver }, { generatePaymentCode: () => 'ZODUPLICAT' })
    const seq = vi.fn().mockReturnValueOnce('ZODUPLICAT').mockReturnValue('ZOFRESH002')
    const qr = await getDb().transaction(tx => createPaymentAttempt(tx, { ...scopeOf(t), orderId: second.id, amountVnd: 70_000, receiver }, { generatePaymentCode: seq }))
    expect(qr.transferContent).toBe('ZOFRESH002')
  })
})

describe('getActiveQrForOrder', () => {
  it('returns the pending attempt until it expires, then null', async () => {
    const { t } = await readyTenant('g1')
    const order = await awaitingOrder(t)
    const receiver = await requireBankQrReceiver(getDb(), scopeOf(t))
    const now = new Date('2026-11-01T05:00:00Z')
    const qr = await createPaymentAttempt(getDb(), { ...scopeOf(t), orderId: order.id, amountVnd: 70_000, receiver }, { now })
    const ref = { storeId: t.store.id, orderId: order.id }
    expect(await getActiveQrForOrder(getDb(), ref, new Date('2026-11-01T05:14:59Z'))).toEqual(qr)
    expect(await getActiveQrForOrder(getDb(), ref, new Date('2026-11-01T05:15:00Z'))).toBeNull()
  })

  it('returns null for EXPIRED, SUPERSEDED and PAID attempts', async () => {
    const { t } = await readyTenant('g2')
    const order = await awaitingOrder(t)
    const receiver = await requireBankQrReceiver(getDb(), scopeOf(t))
    await createPaymentAttempt(getDb(), { ...scopeOf(t), orderId: order.id, amountVnd: 70_000, receiver })
    for (const status of ['EXPIRED', 'SUPERSEDED', 'PAID'] as const) {
      await getDb().update(paymentAttempts).set({ status }).where(eq(paymentAttempts.orderId, order.id))
      expect(await getActiveQrForOrder(getDb(), { storeId: t.store.id, orderId: order.id })).toBeNull()
    }
  })

  it('keeps showing the account the QR was made for after the owner edits the account', async () => {
    const { t, account } = await readyTenant('g3')
    const order = await awaitingOrder(t)
    const receiver = await requireBankQrReceiver(getDb(), scopeOf(t))
    await createPaymentAttempt(getDb(), { ...scopeOf(t), orderId: order.id, amountVnd: 70_000, receiver })
    await getDb().update(storePaymentAccounts)
      .set({ bankCode: 'ACB', accountNumber: '1122334455', accountHolder: 'NGUOI KHAC' })
      .where(eq(storePaymentAccounts.id, account.id))
    const qr = await getActiveQrForOrder(getDb(), { storeId: t.store.id, orderId: order.id })
    expect(qr).toMatchObject({ bankName: 'Vietcombank', accountNumber: '9988776655', accountHolder: 'NGUYEN VAN A' })
    expect(new URL(qr!.imageUrl).searchParams.get('bank')).toBe('970436')
  })

  it('does not return another store\'s attempt', async () => {
    const a = await readyTenant('g4a')
    const b = await createTenant('g4b')
    const order = await awaitingOrder(a.t)
    const receiver = await requireBankQrReceiver(getDb(), scopeOf(a.t))
    await createPaymentAttempt(getDb(), { ...scopeOf(a.t), orderId: order.id, amountVnd: 70_000, receiver })
    expect(await getActiveQrForOrder(getDb(), { storeId: b.store.id, orderId: order.id })).toBeNull()
  })
})

describe('findOrderRefByGuestToken', () => {
  it('resolves a token to the order and its tenant, and ignores bad tokens', async () => {
    const t = await createTenant('f1')
    const token = generateToken()
    const order = await insertRawOrder(t.store, { guestTokenHash: hashToken(token) })
    expect(await findOrderRefByGuestToken(getDb(), token)).toEqual({ orgId: t.org.id, storeId: t.store.id, orderId: order.id })
    expect(await findOrderRefByGuestToken(getDb(), generateToken())).toBeNull()
    expect(await findOrderRefByGuestToken(getDb(), 'short')).toBeNull()
    expect(await findOrderRefByGuestToken(getDb(), `${token}'; --`)).toBeNull()
  })
})

describe('createReplacementAttempt', () => {
  const PAST = () => new Date(Date.now() - 20 * 60_000)

  async function expiredOrder(label: string) {
    const ready = await readyTenant(label)
    const order = await awaitingOrder(ready.t)
    const receiver = await requireBankQrReceiver(getDb(), scopeOf(ready.t))
    const old = await createPaymentAttempt(getDb(), { ...scopeOf(ready.t), orderId: order.id, amountVnd: 70_000, receiver }, { now: PAST() })
    return { ...ready, order, old, ref: { ...scopeOf(ready.t), orderId: order.id } }
  }

  it('returns the live QR untouched when one exists (double tap)', async () => {
    const ready = await readyTenant('p1')
    const order = await awaitingOrder(ready.t)
    const receiver = await requireBankQrReceiver(getDb(), scopeOf(ready.t))
    const live = await createPaymentAttempt(getDb(), { ...scopeOf(ready.t), orderId: order.id, amountVnd: 70_000, receiver })
    const result = await createReplacementAttempt(getDb(), { ...scopeOf(ready.t), orderId: order.id })
    expect(result).toEqual({ qr: live, created: false })
    expect(await attemptsOf(order.id)).toHaveLength(1)
  })

  it('supersedes the lapsed attempt and issues a new code, keeping the old row and code (Review Focus #3)', async () => {
    const { order, old, ref } = await expiredOrder('p2')
    const result = await createReplacementAttempt(getDb(), ref)
    expect(result.created).toBe(true)
    expect(result.qr.transferContent).not.toBe(old.transferContent)
    expect(result.qr.amountVnd).toBe(70_000)

    const rows = await attemptsOf(order.id)
    expect(rows.map(r => r.status)).toEqual(['SUPERSEDED', 'PENDING'])
    expect(rows[0]!.paymentCode).toBe(old.transferContent)
    expect(new Set(rows.map(r => r.paymentCode)).size).toBe(2)
  })

  it('leaves an attempt the expiry job already marked EXPIRED as it is', async () => {
    const { order, ref } = await expiredOrder('p3')
    await getDb().update(paymentAttempts).set({ status: 'EXPIRED' }).where(eq(paymentAttempts.orderId, order.id))
    await createReplacementAttempt(getDb(), ref)
    expect((await attemptsOf(order.id)).map(r => r.status)).toEqual(['EXPIRED', 'PENDING'])
  })

  it('uses the order total from the database for the new attempt', async () => {
    const { order, ref } = await expiredOrder('p4')
    const result = await createReplacementAttempt(getDb(), ref)
    const [fresh] = await getDb().select({ total: orders.totalVnd }).from(orders).where(eq(orders.id, order.id))
    expect(result.qr.amountVnd).toBe(fresh!.total)
  })

  it('issues exactly one attempt for five concurrent calls on a lapsed order (Review Focus #2)', async () => {
    const { order, ref } = await expiredOrder('p5')
    const results = await Promise.all(Array.from({ length: 5 }, () => createReplacementAttempt(getDb(), ref)))
    expect(results.filter(r => r.created)).toHaveLength(1)
    expect(new Set(results.map(r => r.qr.transferContent)).size).toBe(1)
    const rows = await attemptsOf(order.id)
    expect(rows.filter(r => r.status === 'PENDING')).toHaveLength(1)
    expect(rows).toHaveLength(2)
  })

  it('refuses orders that are not waiting for a bank transfer', async () => {
    const ready = await readyTenant('p6')
    const cod = await awaitingOrder(ready.t, { paymentMethod: 'PAY_ON_RECEIPT', status: 'NEW', paymentStatus: 'UNPAID' })
    const paid = await awaitingOrder(ready.t, { status: 'NEW', paymentStatus: 'PAID' })
    const cancelled = await awaitingOrder(ready.t, { status: 'CANCELLED' })
    const review = await awaitingOrder(ready.t, { paymentStatus: 'REVIEW_REQUIRED' })
    for (const order of [cod, paid, cancelled, review]) {
      await expect(createReplacementAttempt(getDb(), { ...scopeOf(ready.t), orderId: order.id }))
        .rejects.toMatchObject({ code: 'STATUS_CONFLICT' })
    }
    expect(await getDb().select().from(paymentAttempts)).toHaveLength(0)
  })

  it('rolls back and reports PAYMENT_METHOD_UNAVAILABLE when the store no longer accepts bank transfer', async () => {
    const { order, ref, integration } = await expiredOrder('p7')
    await getDb().update(sepayIntegrations).set({ status: 'DISABLED' }).where(eq(sepayIntegrations.id, integration.id))
    await expect(createReplacementAttempt(getDb(), ref)).rejects.toMatchObject({ code: 'PAYMENT_METHOD_UNAVAILABLE' })
    expect((await attemptsOf(order.id)).map(r => r.status)).toEqual(['PENDING'])
  })

  it('does not find an order of another store', async () => {
    const { order } = await expiredOrder('p8')
    const other = await createTenant('p8b')
    await expect(createReplacementAttempt(getDb(), { ...scopeOf(other), orderId: order.id })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('never reuses a payment code across replacements', async () => {
    const { order, ref } = await expiredOrder('p9')
    for (let i = 0; i < 3; i++) {
      await getDb().update(paymentAttempts).set({ expiresAt: PAST() }).where(and(eq(paymentAttempts.orderId, order.id), eq(paymentAttempts.status, 'PENDING')))
      await createReplacementAttempt(getDb(), ref)
    }
    const rows = await attemptsOf(order.id)
    expect(rows).toHaveLength(4)
    expect(new Set(rows.map(r => r.paymentCode)).size).toBe(4)
    expect(rows.filter(r => r.status === 'PENDING')).toHaveLength(1)
  })
})
