import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { getPgError } from '../../server/db/errors'
import { integrationAccounts, paymentAttempts, sepayIntegrations, storePaymentAccounts } from '../../server/db/schema'
import { resetDb } from '../support/db'
import { insertRawOrder } from '../support/checkout-fixtures'
import { createTenant } from '../support/fixtures'
import { createIntegration, createPaymentAccount, linkAccount } from '../support/payment-fixtures'

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

async function pgErrorOf(fn: () => Promise<unknown>) {
  try {
    await fn()
  }
  catch (err) {
    return getPgError(err)
  }
  throw new Error('expected the statement to be rejected')
}

type StoreRef = { id: string, orgId: string }

function attemptValues(store: StoreRef, orderId: string, accountId: string, over: Partial<typeof paymentAttempts.$inferInsert> = {}) {
  return {
    orgId: store.orgId,
    storeId: store.id,
    orderId,
    accountId,
    bankCode: 'VCB',
    accountNumber: '9988776655',
    vaNumber: null,
    accountHolder: 'NGUYEN VAN A',
    paymentCode: `ZO${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`,
    transferContent: 'ZOXXXXXXXX',
    expectedAmountVnd: 50_000,
    expiresAt: new Date(Date.now() + 900_000),
    ...over,
  }
}

async function bankQrOrder(store: StoreRef) {
  return insertRawOrder(store, { paymentMethod: 'BANK_QR', status: 'AWAITING_PAYMENT', paymentStatus: 'PENDING' })
}

describe('store_payment_accounts', () => {
  it('allows only one active account per store but many inactive ones', async () => {
    const t = await createTenant('acc1')
    await createPaymentAccount(t.store)
    const err = await pgErrorOf(() => createPaymentAccount(t.store, { accountNumber: '1122334455' }))
    expect(err).toMatchObject({ code: '23505', constraint: 'store_payment_accounts_one_active_uq' })
    await createPaymentAccount(t.store, { accountNumber: '1122334455', isActive: false })
  })

  it('refuses verified_at without qr_checked_at', async () => {
    const t = await createTenant('acc2')
    const err = await pgErrorOf(() => createPaymentAccount(t.store, { verifiedAt: new Date() }))
    expect(err).toMatchObject({ code: '23514', constraint: 'store_payment_accounts_verified_requires_check' })
  })

  it('refuses an org/store pair that does not exist together', async () => {
    const a = await createTenant('acc3a')
    const b = await createTenant('acc3b')
    const err = await pgErrorOf(() => getDb().insert(storePaymentAccounts).values({
      orgId: b.org.id, storeId: a.store.id, bankCode: 'VCB', accountNumber: '9988776655', accountHolder: 'X Y',
    }))
    expect(err).toMatchObject({ code: '23503', constraint: 'store_payment_accounts_store_fk' })
  })
})

describe('sepay_integrations', () => {
  it('allows one non-disabled integration per org and environment', async () => {
    const t = await createTenant('int1')
    await createIntegration(t.org)
    const err = await pgErrorOf(() => createIntegration(t.org))
    expect(err).toMatchObject({ code: '23505', constraint: 'sepay_integrations_org_env_open_uq' })
    await createIntegration(t.org, { environment: 'test' })
  })

  it('allows a new integration once the previous one is disabled', async () => {
    const t = await createTenant('int2')
    const first = await createIntegration(t.org)
    await getDb().update(sepayIntegrations).set({ status: 'DISABLED' })
    await createIntegration(t.org)
    expect(first.status).toBe('DRAFT')
  })

  it('keeps webhook endpoint keys unique', async () => {
    const a = await createTenant('int3a')
    const b = await createTenant('int3b')
    const first = await createIntegration(a.org)
    const err = await pgErrorOf(() => createIntegration(b.org, { webhookEndpointKey: first.webhookEndpointKey }))
    expect(err).toMatchObject({ code: '23505', constraint: 'sepay_integrations_endpoint_key_uq' })
  })

  it('refuses TESTING/ACTIVE without a secret', async () => {
    const t = await createTenant('int4')
    for (const status of ['TESTING', 'ACTIVE'] as const) {
      const err = await pgErrorOf(() => createIntegration(t.org, { status, environment: status === 'TESTING' ? 'test' : 'live' }))
      expect(err).toMatchObject({ code: '23514', constraint: 'sepay_integrations_secret_required' })
    }
  })
})

describe('integration_accounts', () => {
  it('links an account of the same org', async () => {
    const t = await createTenant('link1')
    const account = await createPaymentAccount(t.store)
    const integration = await createIntegration(t.org)
    await linkAccount(t.org.id, integration.id, account.id)
    expect(await getDb().select().from(integrationAccounts)).toHaveLength(1)
  })

  it('refuses to link an account of another org', async () => {
    const a = await createTenant('link2a')
    const b = await createTenant('link2b')
    const accountB = await createPaymentAccount(b.store)
    const integrationA = await createIntegration(a.org)
    const err = await pgErrorOf(() => linkAccount(a.org.id, integrationA.id, accountB.id))
    expect(err).toMatchObject({ code: '23503', constraint: 'integration_accounts_account_fk' })
  })

  it('refuses to link into an integration of another org', async () => {
    const a = await createTenant('link3a')
    const b = await createTenant('link3b')
    const accountA = await createPaymentAccount(a.store)
    const integrationB = await createIntegration(b.org)
    const err = await pgErrorOf(() => linkAccount(a.org.id, integrationB.id, accountA.id))
    expect(err).toMatchObject({ code: '23503', constraint: 'integration_accounts_integration_fk' })
  })
})

describe('payment_attempts', () => {
  it('keeps payment codes unique across the whole system, whatever the status', async () => {
    const a = await createTenant('att1a')
    const b = await createTenant('att1b')
    const accountA = await createPaymentAccount(a.store)
    const accountB = await createPaymentAccount(b.store)
    const orderA = await bankQrOrder(a.store)
    const orderB = await bankQrOrder(b.store)
    await getDb().insert(paymentAttempts).values(attemptValues(a.store, orderA.id, accountA.id, { paymentCode: 'ZOSAME0001', status: 'SUPERSEDED' }))
    const err = await pgErrorOf(() => getDb().insert(paymentAttempts).values(attemptValues(b.store, orderB.id, accountB.id, { paymentCode: 'ZOSAME0001' })))
    expect(err).toMatchObject({ code: '23505', constraint: 'payment_attempts_payment_code_uq' })
  })

  it('allows only one PENDING attempt per order but any number of old ones', async () => {
    const t = await createTenant('att2')
    const account = await createPaymentAccount(t.store)
    const order = await bankQrOrder(t.store)
    await getDb().insert(paymentAttempts).values(attemptValues(t.store, order.id, account.id))
    const err = await pgErrorOf(() => getDb().insert(paymentAttempts).values(attemptValues(t.store, order.id, account.id)))
    expect(err).toMatchObject({ code: '23505', constraint: 'payment_attempts_one_pending_uq' })
    await getDb().insert(paymentAttempts).values(attemptValues(t.store, order.id, account.id, { status: 'SUPERSEDED' }))
    await getDb().insert(paymentAttempts).values(attemptValues(t.store, order.id, account.id, { status: 'EXPIRED' }))
  })

  it('refuses an account of another store (composite FK)', async () => {
    const a = await createTenant('att3a')
    const b = await createTenant('att3b')
    const accountB = await createPaymentAccount(b.store)
    const orderA = await bankQrOrder(a.store)
    const err = await pgErrorOf(() => getDb().insert(paymentAttempts).values(attemptValues(a.store, orderA.id, accountB.id)))
    expect(err).toMatchObject({ code: '23503', constraint: 'payment_attempts_account_fk' })
  })

  it('refuses an order of another store (composite FK)', async () => {
    const a = await createTenant('att4a')
    const b = await createTenant('att4b')
    const accountA = await createPaymentAccount(a.store)
    const orderB = await bankQrOrder(b.store)
    const err = await pgErrorOf(() => getDb().insert(paymentAttempts).values(attemptValues(a.store, orderB.id, accountA.id)))
    expect(err).toMatchObject({ code: '23503', constraint: 'payment_attempts_order_fk' })
  })

  it('refuses a zero or negative expected amount', async () => {
    const t = await createTenant('att5')
    const account = await createPaymentAccount(t.store)
    const order = await bankQrOrder(t.store)
    const err = await pgErrorOf(() => getDb().insert(paymentAttempts).values(attemptValues(t.store, order.id, account.id, { expectedAmountVnd: 0 })))
    expect(err).toMatchObject({ code: '23514', constraint: 'payment_attempts_amount_positive' })
  })
})
