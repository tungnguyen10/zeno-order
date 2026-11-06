import { createHmac, randomUUID } from 'node:crypto'
import { getDb } from '../../server/db/client'
import { paymentAttempts, sepayWebhookAuth } from '../../server/db/schema'
import type { BankTransactionInput } from '../../server/services/payments/types'
import { encryptSecret } from '../../server/utils/crypto'
import { generateToken, hashToken } from '../../server/utils/tokens'
import { insertRawOrder } from './checkout-fixtures'
import { createIntegration, createPaymentAccount, linkAccount } from './payment-fixtures'

export interface Tenantish {
  org: { id: string }
  store: { id: string, orgId: string }
}

export interface PaymentSetup {
  orgId: string
  storeId: string
  integration: { id: string, webhookEndpointKey: string, environment: 'test' | 'live' }
  account: { id: string, accountNumber: string, vaNumber: string | null, bankCode: string, accountHolder: string }
  secret: string
  authMode: 'HMAC' | 'APIKEY'
}

const randomAccountNumber = () => String(1_000_000_000 + Math.floor(Math.random() * 9_000_000_000))
const randomCode = () => `ZO${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`

/**
 * One verified account for the store, linked to an integration. PR5 allows a single open integration per
 * (org, environment), so a second store of the same org passes `reuse`, and a test that needs two integrations
 * in one org uses `environment: 'test'` for the second.
 */
export async function createPaymentSetup(
  tenant: Tenantish,
  opts: {
    authMode?: 'HMAC' | 'APIKEY'
    secret?: string
    apiToken?: string | null
    accountNumber?: string
    vaNumber?: string | null
    status?: 'TESTING' | 'ACTIVE' | 'DISABLED'
    environment?: 'test' | 'live'
    reuse?: PaymentSetup
  } = {},
): Promise<PaymentSetup> {
  const now = new Date()
  const account = await createPaymentAccount(tenant.store, {
    accountNumber: opts.accountNumber ?? randomAccountNumber(),
    vaNumber: opts.vaNumber ?? null,
    qrCheckedAt: now,
    verifiedAt: now,
  })

  let integration: PaymentSetup['integration']
  let secret: string
  let authMode: PaymentSetup['authMode']
  if (opts.reuse) {
    integration = opts.reuse.integration
    secret = opts.reuse.secret
    authMode = opts.reuse.authMode
  }
  else {
    secret = opts.secret ?? `secret-${randomUUID()}`
    authMode = opts.authMode ?? 'HMAC'
    const row = await createIntegration(tenant.org, {
      environment: opts.environment ?? 'live',
      status: opts.status ?? 'ACTIVE',
      encryptedHmacSecret: encryptSecret(secret),
      encryptedApiToken: opts.apiToken ? encryptSecret(opts.apiToken) : null,
      secretUpdatedAt: now,
    })
    integration = { id: row.id, webhookEndpointKey: row.webhookEndpointKey, environment: row.environment }
    if (authMode === 'APIKEY') await getDb().insert(sepayWebhookAuth).values({ integrationId: row.id, mode: 'APIKEY' })
  }
  await linkAccount(tenant.org.id, integration.id, account.id)

  return {
    orgId: tenant.org.id,
    storeId: tenant.store.id,
    integration,
    account: {
      id: account.id,
      accountNumber: account.accountNumber,
      vaNumber: account.vaNumber,
      bankCode: account.bankCode,
      accountHolder: account.accountHolder,
    },
    secret,
    authMode,
  }
}

/** A payment attempt with the bank snapshot PR5 stores on every attempt. */
export async function createAttempt(
  setup: PaymentSetup,
  orderId: string,
  opts: { amountVnd?: number, status?: 'PENDING' | 'EXPIRED' | 'SUPERSEDED' | 'PAID', expiresAt?: Date, paymentCode?: string } = {},
) {
  const code = opts.paymentCode ?? randomCode()
  const [attempt] = await getDb().insert(paymentAttempts).values({
    orgId: setup.orgId,
    storeId: setup.storeId,
    orderId,
    accountId: setup.account.id,
    bankCode: setup.account.bankCode,
    accountNumber: setup.account.accountNumber,
    vaNumber: setup.account.vaNumber,
    accountHolder: setup.account.accountHolder,
    paymentCode: code,
    transferContent: code,
    expectedAmountVnd: opts.amountVnd ?? 55_000,
    status: opts.status ?? 'PENDING',
    expiresAt: opts.expiresAt ?? new Date(Date.now() + 15 * 60_000),
  }).returning()
  return attempt!
}

export async function createAwaitingOrder(
  setup: PaymentSetup,
  opts: {
    amountVnd?: number
    attemptStatus?: 'PENDING' | 'EXPIRED' | 'SUPERSEDED'
    expiresAt?: Date
    createdAt?: Date
    paymentCode?: string
    orderStatus?: 'AWAITING_PAYMENT' | 'NEW' | 'CANCELLED'
    paymentStatus?: 'PENDING' | 'PAID' | 'UNPAID' | 'REVIEW_REQUIRED' | 'REFUND_DUE'
  } = {},
) {
  const amountVnd = opts.amountVnd ?? 55_000
  const guestToken = generateToken()
  const order = await insertRawOrder({ id: setup.storeId, orgId: setup.orgId }, {
    guestTokenHash: hashToken(guestToken),
    guestTokenEncrypted: encryptSecret(guestToken),
    subtotalVnd: amountVnd,
    deliveryFeeVnd: 0,
    totalVnd: amountVnd,
    status: opts.orderStatus ?? 'AWAITING_PAYMENT',
    paymentMethod: 'BANK_QR',
    paymentStatus: opts.paymentStatus ?? 'PENDING',
    ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
  })
  const attempt = await createAttempt(setup, order.id, {
    amountVnd,
    status: opts.attemptStatus,
    expiresAt: opts.expiresAt,
    paymentCode: opts.paymentCode,
  })
  return { order, attempt, guestToken }
}

export function bankTxInput(setup: PaymentSetup, overrides: Partial<BankTransactionInput> = {}): BankTransactionInput {
  return {
    orgId: setup.orgId,
    integrationId: setup.integration.id,
    providerTransactionId: String(Math.floor(Math.random() * 1_000_000_000) + 1),
    source: 'WEBHOOK',
    direction: 'IN',
    bankCode: setup.account.bankCode,
    bankAccountNumber: setup.account.accountNumber,
    subAccount: null,
    amountVnd: 55_000,
    paymentCode: null,
    content: 'thanh toan',
    referenceCode: `FT${randomUUID().slice(0, 10)}`,
    transactionDate: new Date(),
    rawPayload: { fixture: true },
    ...overrides,
  }
}

export function sepayPayload(setup: PaymentSetup, overrides: Record<string, unknown> = {}) {
  return {
    id: Math.floor(Math.random() * 1_000_000_000) + 1,
    gateway: setup.account.bankCode,
    transactionDate: '2026-11-01 10:15:00',
    accountNumber: setup.account.accountNumber,
    subAccount: '',
    code: null as string | null,
    content: 'thanh toan don hang',
    transferType: 'in',
    description: '',
    transferAmount: 55_000,
    accumulated: 0,
    referenceCode: `FT${randomUUID().slice(0, 10)}`,
    ...overrides,
  }
}

export const bodyOf = (payload: unknown): string => JSON.stringify(payload)

export function signSepayBody(rawBody: string, secret: string, timestampSec = Math.floor(Date.now() / 1000)) {
  const hex = createHmac('sha256', secret).update(`${timestampSec}.${rawBody}`).digest('hex')
  return { 'x-sepay-signature': `sha256=${hex}`, 'x-sepay-timestamp': String(timestampSec) }
}
