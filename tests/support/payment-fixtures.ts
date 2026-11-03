import { getDb } from '../../server/db/client'
import type { StoreContext } from '../../server/auth/guards'
import { integrationAccounts, sepayIntegrations, storePaymentAccounts } from '../../server/db/schema'
import { encryptSecret } from '../../server/utils/crypto'
import { generateToken } from '../../server/utils/tokens'

type StoreRef = { id: string, orgId: string }

export const TEST_HMAC_SECRET = 'whsec_test_0123456789abcdef'

export async function createPaymentAccount(store: StoreRef, over: Partial<typeof storePaymentAccounts.$inferInsert> = {}) {
  const [row] = await getDb().insert(storePaymentAccounts).values({
    orgId: store.orgId,
    storeId: store.id,
    bankCode: 'VCB',
    accountNumber: '9988776655',
    accountHolder: 'NGUYEN VAN A',
    ...over,
  }).returning()
  return row!
}

export async function createIntegration(org: { id: string }, over: Partial<typeof sepayIntegrations.$inferInsert> = {}) {
  const [row] = await getDb().insert(sepayIntegrations).values({
    orgId: org.id,
    name: 'SePay',
    webhookEndpointKey: generateToken(24),
    ...over,
  }).returning()
  return row!
}

export async function linkAccount(orgId: string, integrationId: string, paymentAccountId: string) {
  await getDb().insert(integrationAccounts).values({ orgId, integrationId, paymentAccountId })
}

/** A store that can take BANK_QR orders: verified account linked to an ACTIVE integration. */
export async function setupBankQr(store: StoreRef, opts: { bankCode?: string, vaNumber?: string | null, accountNumber?: string } = {}) {
  const now = new Date()
  const account = await createPaymentAccount(store, {
    bankCode: opts.bankCode ?? 'VCB',
    vaNumber: opts.vaNumber ?? null,
    ...(opts.accountNumber ? { accountNumber: opts.accountNumber } : {}),
    qrCheckedAt: now,
    verifiedAt: now,
  })
  const integration = await createIntegration({ id: store.orgId }, {
    status: 'ACTIVE',
    encryptedHmacSecret: encryptSecret(TEST_HMAC_SECRET),
    secretUpdatedAt: now,
    lastValidWebhookAt: now,
    activatedAt: now,
  })
  await linkAccount(store.orgId, integration.id, account.id)
  return { account, integration }
}

export function ownerCtx(tenant: { org: { id: string }, store: { id: string }, owner: { userId: string } }): StoreContext {
  return { orgId: tenant.org.id, storeId: tenant.store.id, role: 'OWNER', userId: tenant.owner.userId }
}
