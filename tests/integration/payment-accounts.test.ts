import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { storePaymentAccounts } from '../../server/db/schema'
import {
  checkPaymentAccount,
  confirmAccountQr,
  createPaymentAccount,
  getPaymentAccount,
  updatePaymentAccount,
} from '../../server/services/payments/accounts'
import { resetDb } from '../support/db'
import { createTenant } from '../support/fixtures'
import { createIntegration, createPaymentAccount as insertAccount, linkAccount, ownerCtx } from '../support/payment-fixtures'
import { encryptSecret } from '../../server/utils/crypto'

const revision = async (ctx: Parameters<typeof checkPaymentAccount>[1], id: string) => (await checkPaymentAccount(getDb(), ctx, id)).revision!

const input = { bankCode: 'VCB', accountNumber: '9988776655', accountHolder: 'NGUYEN VAN A', vaNumber: null }

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('createPaymentAccount / getPaymentAccount', () => {
  it('creates an unchecked account for the store', async () => {
    const t = await createTenant('ac1')
    const dto = await createPaymentAccount(getDb(), ownerCtx(t), input)
    expect(dto).toMatchObject({
      bankCode: 'VCB', bankName: 'Vietcombank', accountNumber: '9988776655', vaNumber: null,
      accountHolder: 'NGUYEN VAN A', qrCheckedAt: null, verifiedAt: null, linkedIntegrationId: null,
    })
    expect(await getPaymentAccount(getDb(), ownerCtx(t))).toEqual(dto)
  })

  it('refuses a second active account with STATUS_CONFLICT', async () => {
    const t = await createTenant('ac2')
    await createPaymentAccount(getDb(), ownerCtx(t), input)
    await expect(createPaymentAccount(getDb(), ownerCtx(t), { ...input, accountNumber: '1122334455' }))
      .rejects.toMatchObject({ code: 'STATUS_CONFLICT' })
  })

  it('returns null when the store has none and never shows another store\'s account', async () => {
    const a = await createTenant('ac3a')
    const b = await createTenant('ac3b')
    await createPaymentAccount(getDb(), ownerCtx(a), input)
    expect(await getPaymentAccount(getDb(), ownerCtx(b))).toBeNull()
  })
})

describe('updatePaymentAccount', () => {
  it('clears the QR check and verification when a field really changes (Review Focus #4)', async () => {
    const t = await createTenant('up1')
    const created = await createPaymentAccount(getDb(), ownerCtx(t), input)
    const now = new Date()
    await getDb().update(storePaymentAccounts).set({ qrCheckedAt: now, verifiedAt: now }).where(eq(storePaymentAccounts.id, created.id))

    const updated = await updatePaymentAccount(getDb(), ownerCtx(t), created.id, { accountNumber: '1122-334455' })
    expect(updated).toMatchObject({ accountNumber: '1122334455', qrCheckedAt: null, verifiedAt: null })
  })

  it('keeps the check when the patch changes nothing', async () => {
    const t = await createTenant('up2')
    const created = await createPaymentAccount(getDb(), ownerCtx(t), input)
    const now = new Date()
    await getDb().update(storePaymentAccounts).set({ qrCheckedAt: now, verifiedAt: now }).where(eq(storePaymentAccounts.id, created.id))

    const same = await updatePaymentAccount(getDb(), ownerCtx(t), created.id, { bankCode: 'vcb', accountHolder: ' NGUYEN VAN A ' })
    expect(same.qrCheckedAt).not.toBeNull()
    expect(same.verifiedAt).not.toBeNull()
  })

  it('rejects a patch that would make the account invalid and leaves it untouched', async () => {
    const t = await createTenant('up3')
    const created = await createPaymentAccount(getDb(), ownerCtx(t), input)
    await expect(updatePaymentAccount(getDb(), ownerCtx(t), created.id, { bankCode: 'MSB' }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect((await getPaymentAccount(getDb(), ownerCtx(t)))?.bankCode).toBe('VCB')
  })

  it('does not find an account of another store', async () => {
    const a = await createTenant('up4a')
    const b = await createTenant('up4b')
    const created = await createPaymentAccount(getDb(), ownerCtx(a), input)
    await expect(updatePaymentAccount(getDb(), ownerCtx(b), created.id, { accountHolder: 'HACKER' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('checkPaymentAccount', () => {
  it('builds the 2.000đ check QR with the test code and warns when SePay does not list the bank (U3)', async () => {
    const t = await createTenant('ck1')
    const account = await createPaymentAccount(getDb(), ownerCtx(t), input)
    const check = await checkPaymentAccount(getDb(), ownerCtx(t), account.id)
    expect(check.ok).toBe(true)
    expect(check.issues).toEqual([])
    expect(check.preview).toEqual({
      bankName: 'Vietcombank',
      accountNumber: '9988776655',
      accountHolder: 'NGUYEN VAN A',
      amountVnd: 2000,
      transferContent: 'ZOTEST0000',
      imageUrl: 'https://vietqr.app/img?acc=9988776655&bank=970436&amount=2000&des=ZOTEST0000&template=qronly',
    })
    expect(check.warnings).toHaveLength(1)
    expect(check.warnings[0]).toContain('my.sepay.vn')
  })

  it('has no warning for a bank in the SePay webhook table', async () => {
    const t = await createTenant('ck2')
    const account = await createPaymentAccount(getDb(), ownerCtx(t), { ...input, bankCode: 'ACB' })
    expect((await checkPaymentAccount(getDb(), ownerCtx(t), account.id)).warnings).toEqual([])
  })

  it('encodes the VA and SEVQR (Review Focus #1)', async () => {
    const t = await createTenant('ck3')
    const ocb = await createPaymentAccount(getDb(), ownerCtx(t), { ...input, bankCode: 'OCB', vaNumber: 'VQRQ12345678' })
    const check = await checkPaymentAccount(getDb(), ownerCtx(t), ocb.id)
    expect(check.preview?.accountNumber).toBe('VQRQ12345678')
    expect(check.preview?.imageUrl).toContain('acc=VQRQ12345678')
    await getDb().update(storePaymentAccounts).set({ bankCode: 'ICB', vaNumber: null }).where(eq(storePaymentAccounts.id, ocb.id))
    const viet = await checkPaymentAccount(getDb(), ownerCtx(t), ocb.id)
    expect(viet.preview?.transferContent).toBe('SEVQR ZOTEST0000')
    expect(viet.preview?.imageUrl).toContain('des=SEVQR%20ZOTEST0000')
  })

  it('flags stored data that is invalid for its bank (a VA-only bank without VA)', async () => {
    const t = await createTenant('ck4')
    const row = await insertAccount(t.store, { bankCode: 'MSB' })
    const check = await checkPaymentAccount(getDb(), ownerCtx(t), row.id)
    expect(check.ok).toBe(false)
    expect(check.preview).toBeNull()
    expect(check.issues).toEqual([{ field: 'vaNumber', message: expect.stringContaining('MSB') }])
  })

  it('does not find an account of another store', async () => {
    const a = await createTenant('ck5a')
    const b = await createTenant('ck5b')
    const row = await insertAccount(a.store)
    await expect(checkPaymentAccount(getDb(), ownerCtx(b), row.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('confirmAccountQr', () => {
  it('rejects a stale preview after another tab edits the recipient', async () => {
    const t = await createTenant('cf-stale')
    const account = await createPaymentAccount(getDb(), ownerCtx(t), input)
    const oldPreview = await checkPaymentAccount(getDb(), ownerCtx(t), account.id)
    expect(oldPreview.revision).toMatch(/^[a-f0-9]{64}$/)
    await updatePaymentAccount(getDb(), ownerCtx(t), account.id, { accountNumber: '1122334455' })
    await expect(confirmAccountQr(getDb(), ownerCtx(t), account.id, oldPreview.revision!))
      .rejects.toMatchObject({ code: 'STATUS_CONFLICT' })
    const current = await getPaymentAccount(getDb(), ownerCtx(t))
    expect(current).toMatchObject({ accountNumber: '1122334455', qrCheckedAt: null, verifiedAt: null })
    const freshPreview = await checkPaymentAccount(getDb(), ownerCtx(t), account.id)
    expect(freshPreview.revision).not.toBe(oldPreview.revision)
    expect((await confirmAccountQr(getDb(), ownerCtx(t), account.id, freshPreview.revision!)).qrCheckedAt).not.toBeNull()
  })

  it('records the QR check but does not verify an account with no active integration', async () => {
    const t = await createTenant('cf1')
    const account = await createPaymentAccount(getDb(), ownerCtx(t), input)
    const now = new Date('2026-11-01T05:00:00Z')
    const confirmed = await confirmAccountQr(getDb(), ownerCtx(t), account.id, await revision(ownerCtx(t), account.id), now)
    expect(confirmed.qrCheckedAt).toBe(now.toISOString())
    expect(confirmed.verifiedAt).toBeNull()
  })

  it('also verifies when the account is already linked to an ACTIVE integration that received a valid webhook', async () => {
    const t = await createTenant('cf2')
    const account = await createPaymentAccount(getDb(), ownerCtx(t), input)
    const integration = await createIntegration(t.org, {
      status: 'ACTIVE', encryptedHmacSecret: encryptSecret('whsec_0123456789'), lastValidWebhookAt: new Date(),
    })
    await linkAccount(t.org.id, integration.id, account.id)
    const confirmed = await confirmAccountQr(getDb(), ownerCtx(t), account.id, await revision(ownerCtx(t), account.id))
    expect(confirmed.verifiedAt).not.toBeNull()
    expect(confirmed.linkedIntegrationId).toBe(integration.id)
  })

  it('does not verify through an ACTIVE integration that has never seen a valid webhook', async () => {
    const t = await createTenant('cf3')
    const account = await createPaymentAccount(getDb(), ownerCtx(t), input)
    const integration = await createIntegration(t.org, { status: 'ACTIVE', encryptedHmacSecret: encryptSecret('whsec_0123456789') })
    await linkAccount(t.org.id, integration.id, account.id)
    expect((await confirmAccountQr(getDb(), ownerCtx(t), account.id, await revision(ownerCtx(t), account.id))).verifiedAt).toBeNull()
  })

  it('refuses to confirm an invalid account', async () => {
    const t = await createTenant('cf4')
    const row = await insertAccount(t.store, { bankCode: 'BIDV' })
    await expect(confirmAccountQr(getDb(), ownerCtx(t), row.id, '0'.repeat(64))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    const [after] = await getDb().select().from(storePaymentAccounts).where(eq(storePaymentAccounts.id, row.id))
    expect(after!.qrCheckedAt).toBeNull()
  })

  it('does not find an account of another store', async () => {
    const a = await createTenant('cf5a')
    const b = await createTenant('cf5b')
    const row = await insertAccount(a.store)
    await expect(confirmAccountQr(getDb(), ownerCtx(b), row.id, '0'.repeat(64))).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
