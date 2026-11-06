import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { bankTransactionEvents, bankTransactions } from '../../server/db/schema'
import { recordBankTransaction } from '../../server/services/payments/record-bank-transaction'
import { createTenant } from '../support/fixtures'
import { bankTxInput, createPaymentSetup, type PaymentSetup } from '../support/webhook-fixtures'
import { resetDb } from '../support/db'

const db = () => getDb()
const rows = (setup: PaymentSetup) => db().select().from(bankTransactions).where(eq(bankTransactions.integrationId, setup.integration.id))

let setup: PaymentSetup

beforeEach(async () => {
  await resetDb()
  setup = await createPaymentSetup(await createTenant('a'))
})
afterEach(() => { delete process.env.SEPAY_VERIFIED_DEDUPE_INTEGRATIONS })
afterAll(async () => {
  await closeDb()
})

describe('recordBankTransaction', () => {
  it('creates a RECEIVED row and an audit event', async () => {
    const result = await recordBankTransaction(db(), bankTxInput(setup, { providerTransactionId: '1', paymentCode: 'ZOABCDEFGH' }))
    expect(result).toMatchObject({ created: true, status: 'RECEIVED' })
    const [row] = await rows(setup)
    expect(row).toMatchObject({ providerTransactionId: 'WEBHOOK:1', paymentCode: 'ZOABCDEFGH', source: 'WEBHOOK', orgId: setup.orgId })
    const events = await db().select().from(bankTransactionEvents).where(eq(bankTransactionEvents.bankTransactionId, row!.id))
    expect(events.map(e => e.action)).toEqual(['RECEIVED'])
  })

  it('stores outgoing transfers as IGNORED', async () => {
    const result = await recordBankTransaction(db(), bankTxInput(setup, { direction: 'OUT' }))
    expect(result.status).toBe('IGNORED')
  })

  it('replay of the same provider id returns the existing row', async () => {
    const input = bankTxInput(setup, { providerTransactionId: '42' })
    const first = await recordBankTransaction(db(), input)
    const again = await recordBankTransaction(db(), input)
    expect(again).toEqual({ id: first.id, created: false, status: 'RECEIVED' })
    expect(await rows(setup)).toHaveLength(1)
  })

  it('five concurrent deliveries of one transaction create exactly one row', async () => {
    const input = bankTxInput(setup, { providerTransactionId: '9001' })
    const results = await Promise.all(Array.from({ length: 5 }, () => recordBankTransaction(db(), input)))
    expect(results.filter(r => r.created)).toHaveLength(1)
    expect(new Set(results.map(r => r.id)).size).toBe(1)
    expect(await rows(setup)).toHaveLength(1)
  })

  it('merges a reconcile (UUID) report into the webhook row and remembers the alias', async () => {
    process.env.SEPAY_VERIFIED_DEDUPE_INTEGRATIONS = setup.integration.id
    const webhook = bankTxInput(setup, { providerTransactionId: '123', referenceCode: 'FT111', amountVnd: 70_000 })
    const first = await recordBankTransaction(db(), webhook)
    const reconcile = { ...webhook, source: 'RECONCILE' as const, providerTransactionId: 'uuid-aaaa' }
    const second = await recordBankTransaction(db(), reconcile)
    expect(second).toMatchObject({ id: first.id, created: false })
    const [row] = await rows(setup)
    expect(row!.providerAltIds).toEqual(['uuid-aaaa'])
    expect(await recordBankTransaction(db(), reconcile)).toMatchObject({ id: first.id, created: false })
    expect(await rows(setup)).toHaveLength(1)
  })

  it('merges in the other direction too (reconcile first, webhook later)', async () => {
    process.env.SEPAY_VERIFIED_DEDUPE_INTEGRATIONS = setup.integration.id
    const reconcile = bankTxInput(setup, { source: 'RECONCILE', providerTransactionId: 'uuid-bbbb', referenceCode: 'FT222' })
    const first = await recordBankTransaction(db(), reconcile)
    const webhook = { ...reconcile, source: 'WEBHOOK' as const, providerTransactionId: '555' }
    expect(await recordBankTransaction(db(), webhook)).toMatchObject({ id: first.id, created: false })
    const [row] = await rows(setup)
    expect(row!.providerAltIds).toEqual(['555'])
    expect(await recordBankTransaction(db(), webhook)).toMatchObject({ id: first.id, created: false })
  })

  it('never merges two webhook transactions that merely look alike (money must not vanish)', async () => {
    const base = bankTxInput(setup, { referenceCode: 'FT333', amountVnd: 50_000 })
    const one = await recordBankTransaction(db(), { ...base, providerTransactionId: '1' })
    const two = await recordBankTransaction(db(), { ...base, providerTransactionId: '2' })
    expect(one.id).not.toBe(two.id)
    expect(await rows(setup)).toHaveLength(2)
  })

  it('preserves ambiguous cross-source candidates instead of guessing pairs', async () => {
    process.env.SEPAY_VERIFIED_DEDUPE_INTEGRATIONS = setup.integration.id
    const base = bankTxInput(setup, { referenceCode: 'FT444', amountVnd: 50_000 })
    const w1 = await recordBankTransaction(db(), { ...base, providerTransactionId: '1' })
    const w2 = await recordBankTransaction(db(), { ...base, providerTransactionId: '2' })
    const r1 = await recordBankTransaction(db(), { ...base, source: 'RECONCILE', providerTransactionId: 'uuid-1' })
    const r2 = await recordBankTransaction(db(), { ...base, source: 'RECONCILE', providerTransactionId: 'uuid-2' })
    expect(r1.created && r2.created).toBe(true)
    expect(new Set([r1.id, r2.id, w1.id, w2.id]).size).toBe(4)
    expect(await rows(setup)).toHaveLength(4)
  })

  it('creates a separate row when a reconcile report differs in amount or account', async () => {
    const base = bankTxInput(setup, { providerTransactionId: '1', referenceCode: 'FT555', amountVnd: 50_000 })
    await recordBankTransaction(db(), base)
    const differentAmount = await recordBankTransaction(db(), { ...base, source: 'RECONCILE', providerTransactionId: 'u1', amountVnd: 60_000 })
    const differentAccount = await recordBankTransaction(db(), { ...base, source: 'RECONCILE', providerTransactionId: 'u2', bankAccountNumber: '999' })
    expect(differentAmount.created).toBe(true)
    expect(differentAccount.created).toBe(true)
  })

  it('without a reference code, twins must share the exact transaction instant', async () => {
    const at = new Date('2026-11-01T03:15:00.000Z')
    const base = bankTxInput(setup, { providerTransactionId: '1', referenceCode: null, transactionDate: at })
    const first = await recordBankTransaction(db(), base)
    const same = await recordBankTransaction(db(), { ...base, source: 'RECONCILE', providerTransactionId: 'u1' })
    const later = await recordBankTransaction(db(), { ...base, source: 'RECONCILE', providerTransactionId: 'u2', transactionDate: new Date(at.getTime() + 60_000) })
    expect(same.id).not.toBe(first.id)
    expect(same.created).toBe(true)
    expect(later.created).toBe(true)
  })

  it('a webhook and a reconcile report racing for the same transaction yield one row', async () => {
    process.env.SEPAY_VERIFIED_DEDUPE_INTEGRATIONS = setup.integration.id
    const webhook = bankTxInput(setup, { providerTransactionId: '31337', referenceCode: 'FT666' })
    const reconcile = { ...webhook, source: 'RECONCILE' as const, providerTransactionId: 'uuid-race' }
    const results = await Promise.all([
      recordBankTransaction(db(), webhook),
      recordBankTransaction(db(), reconcile),
      recordBankTransaction(db(), webhook),
      recordBankTransaction(db(), reconcile),
    ])
    expect(results.filter(r => r.created)).toHaveLength(1)
    expect(await rows(setup)).toHaveLength(1)
  })
})
