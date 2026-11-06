import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { integrationAccounts, sepayIntegrations, storePaymentAccounts } from '../../server/db/schema'
import {
  activateIntegration,
  buildWebhookUrl,
  createOrGetIntegration,
  getIntegration,
  linkAccountToIntegration,
  listIntegrations,
  saveIntegrationSecret,
} from '../../server/services/payments/integrations'
import { findIntegrationByEndpointKey, loadIntegrationSecrets } from '../../server/services/payments/integration-secrets'
import { decryptSecret } from '../../server/utils/crypto'
import { resetDb } from '../support/db'
import { createTenant } from '../support/fixtures'
import { captureConsole, expectNoneOf } from '../support/leaks'
import { createIntegration, createPaymentAccount } from '../support/payment-fixtures'

const BASE = 'https://zeno.example'
const SECRET = 'SENTINEL_hmac_secret_0123456789'
const TOKEN = 'SENTINEL_api_token_0123456789'
const defaults = { name: 'SePay', environment: 'live' } as const

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('createOrGetIntegration', () => {
  it('creates a DRAFT integration with a 32-char endpoint key and no secret', async () => {
    const t = await createTenant('i1')
    const { integration, created } = await createOrGetIntegration(getDb(), t.org.id, defaults, BASE)
    expect(created).toBe(true)
    expect(integration).toMatchObject({ status: 'DRAFT', environment: 'live', hasSecret: false, hasApiToken: false, accountIds: [] })
    expect(integration.webhookUrl).toMatch(/^https:\/\/zeno\.example\/api\/webhooks\/sepay\/[A-Za-z0-9_-]{32}$/)
  })

  it('is idempotent per org and environment (double click)', async () => {
    const t = await createTenant('i2')
    const first = await createOrGetIntegration(getDb(), t.org.id, defaults, BASE)
    const second = await createOrGetIntegration(getDb(), t.org.id, defaults, BASE)
    expect(second.created).toBe(false)
    expect(second.integration.id).toBe(first.integration.id)
    const concurrent = await Promise.all(Array.from({ length: 4 }, () => createOrGetIntegration(getDb(), t.org.id, defaults, BASE)))
    expect(new Set(concurrent.map(r => r.integration.id))).toEqual(new Set([first.integration.id]))
    expect(await getDb().select().from(sepayIntegrations)).toHaveLength(1)
  })

  it('coalesces concurrent first-time creation into one integration', async () => {
    const t = await createTenant('i2race')
    const results = await Promise.all(Array.from({ length: 4 }, () => createOrGetIntegration(getDb(), t.org.id, defaults, BASE)))
    expect(new Set(results.map(result => result.integration.id)).size).toBe(1)
    expect(results.filter(result => result.created)).toHaveLength(1)
    expect(await getDb().select().from(sepayIntegrations)).toHaveLength(1)
  })

  it('creates a separate integration for another environment', async () => {
    const t = await createTenant('i3')
    await createOrGetIntegration(getDb(), t.org.id, defaults, BASE)
    const test = await createOrGetIntegration(getDb(), t.org.id, { name: 'SePay test', environment: 'test' }, BASE)
    expect(test.created).toBe(true)
    expect(await listIntegrations(getDb(), t.org.id, BASE)).toHaveLength(2)
  })
})

describe('buildWebhookUrl', () => {
  it('joins base and key', () => {
    expect(buildWebhookUrl('https://a.vn', 'KEY')).toBe('https://a.vn/api/webhooks/sepay/KEY')
  })
})

describe('saveIntegrationSecret', () => {
  it('stores the secret encrypted, moves DRAFT to TESTING and exposes only flags', async () => {
    const t = await createTenant('s1')
    const { integration } = await createOrGetIntegration(getDb(), t.org.id, defaults, BASE)
    const dto = await saveIntegrationSecret(getDb(), t.org.id, integration.id, { hmacSecret: SECRET, apiToken: TOKEN }, BASE)

    expect(dto).toMatchObject({ status: 'TESTING', hasSecret: true, hasApiToken: true })
    expect(Object.keys(dto).sort()).toEqual([
      'accountIds', 'environment', 'hasApiToken', 'hasSecret', 'id', 'lastValidWebhookAt',
      'name', 'secretUpdatedAt', 'status', 'updatedAt', 'webhookAuthMode', 'webhookUrl',
    ])
    expectNoneOf(JSON.stringify(dto), [SECRET, TOKEN])

    const [row] = await getDb().select().from(sepayIntegrations).where(eq(sepayIntegrations.id, integration.id))
    expect(row!.encryptedHmacSecret).not.toContain(SECRET)
    expect(row!.encryptedHmacSecret).toMatch(/^v1\./)
    expect(decryptSecret(row!.encryptedHmacSecret!)).toBe(SECRET)
    expect(decryptSecret(row!.encryptedApiToken!)).toBe(TOKEN)
    expect(row!.keyVersion).toBe(1)
  })

  it('rotates by overwriting, keeps the old API token when none is sent, keeps an ACTIVE status', async () => {
    const t = await createTenant('s2')
    const { integration } = await createOrGetIntegration(getDb(), t.org.id, defaults, BASE)
    await saveIntegrationSecret(getDb(), t.org.id, integration.id, { hmacSecret: SECRET, apiToken: TOKEN }, BASE)
    await getDb().update(sepayIntegrations).set({ status: 'ACTIVE' }).where(eq(sepayIntegrations.id, integration.id))

    const dto = await saveIntegrationSecret(getDb(), t.org.id, integration.id, { hmacSecret: 'SENTINEL_new_secret_9876543210' }, BASE)
    expect(dto.status).toBe('ACTIVE')
    const secrets = await loadIntegrationSecrets(getDb(), integration.id)
    expect(secrets).toEqual({ hmacSecret: 'SENTINEL_new_secret_9876543210', apiToken: TOKEN })
  })

  it('does not find an integration of another org and writes nothing', async () => {
    const a = await createTenant('s3a')
    const b = await createTenant('s3b')
    const { integration } = await createOrGetIntegration(getDb(), b.org.id, defaults, BASE)
    await expect(saveIntegrationSecret(getDb(), a.org.id, integration.id, { hmacSecret: SECRET }, BASE))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
    const [row] = await getDb().select().from(sepayIntegrations).where(eq(sepayIntegrations.id, integration.id))
    expect(row!.encryptedHmacSecret).toBeNull()
  })

  it('refuses a disabled integration', async () => {
    const t = await createTenant('s4')
    const row = await createIntegration(t.org, { status: 'DISABLED' })
    await expect(saveIntegrationSecret(getDb(), t.org.id, row.id, { hmacSecret: SECRET }, BASE))
      .rejects.toMatchObject({ code: 'STATUS_CONFLICT' })
  })

  it('never writes a secret, ciphertext or endpoint key to the console (Review Focus #5)', async () => {
    const t = await createTenant('s5')
    const { integration } = await createOrGetIntegration(getDb(), t.org.id, defaults, BASE)
    const capture = captureConsole()
    try {
      await saveIntegrationSecret(getDb(), t.org.id, integration.id, { hmacSecret: SECRET, apiToken: TOKEN }, BASE)
      await saveIntegrationSecret(getDb(), t.org.id, '00000000-0000-4000-8000-000000000000', { hmacSecret: SECRET }, BASE).catch(() => undefined)
      await activateIntegration(getDb(), t.org.id, integration.id, BASE).catch(() => undefined)
    }
    finally {
      capture.restore()
    }
    const [row] = await getDb().select().from(sepayIntegrations).where(eq(sepayIntegrations.id, integration.id))
    expectNoneOf(capture.text(), [SECRET, TOKEN, row!.encryptedHmacSecret!, row!.webhookEndpointKey])
  })
})

describe('linkAccountToIntegration', () => {
  it('links a store account of the same org, idempotently', async () => {
    const t = await createTenant('l1')
    const account = await createPaymentAccount(t.store)
    const { integration } = await createOrGetIntegration(getDb(), t.org.id, defaults, BASE)
    const dto = await linkAccountToIntegration(getDb(), t.org.id, integration.id, account.id, BASE)
    expect(dto.accountIds).toEqual([account.id])
    await linkAccountToIntegration(getDb(), t.org.id, integration.id, account.id, BASE)
    expect(await getDb().select().from(integrationAccounts)).toHaveLength(1)
  })

  it('refuses an account of another org and an unknown id', async () => {
    const a = await createTenant('l2a')
    const b = await createTenant('l2b')
    const accountB = await createPaymentAccount(b.store)
    const { integration } = await createOrGetIntegration(getDb(), a.org.id, defaults, BASE)
    await expect(linkAccountToIntegration(getDb(), a.org.id, integration.id, accountB.id, BASE)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(linkAccountToIntegration(getDb(), a.org.id, integration.id, '00000000-0000-4000-8000-000000000000', BASE)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('refuses an inactive account', async () => {
    const t = await createTenant('l3')
    const account = await createPaymentAccount(t.store, { isActive: false })
    const { integration } = await createOrGetIntegration(getDb(), t.org.id, defaults, BASE)
    await expect(linkAccountToIntegration(getDb(), t.org.id, integration.id, account.id, BASE)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('activateIntegration', () => {
  async function testing(label: string, opts: { checked?: boolean, webhook?: boolean } = {}) {
    const t = await createTenant(label)
    const account = await createPaymentAccount(t.store, opts.checked ? { qrCheckedAt: new Date() } : {})
    const { integration } = await createOrGetIntegration(getDb(), t.org.id, defaults, BASE)
    await saveIntegrationSecret(getDb(), t.org.id, integration.id, { hmacSecret: SECRET }, BASE)
    await linkAccountToIntegration(getDb(), t.org.id, integration.id, account.id, BASE)
    if (opts.webhook) await getDb().update(sepayIntegrations).set({ lastValidWebhookAt: new Date() }).where(eq(sepayIntegrations.id, integration.id))
    return { t, account, integration }
  }

  it('refuses a DRAFT integration', async () => {
    const t = await createTenant('a1')
    const { integration } = await createOrGetIntegration(getDb(), t.org.id, defaults, BASE)
    await expect(activateIntegration(getDb(), t.org.id, integration.id, BASE))
      .rejects.toMatchObject({ code: 'STATUS_CONFLICT', details: { reason: 'NOT_TESTING' } })
  })

  it('refuses until a valid webhook has arrived', async () => {
    const { t, integration } = await testing('a2', { checked: true })
    await expect(activateIntegration(getDb(), t.org.id, integration.id, BASE))
      .rejects.toMatchObject({ code: 'STATUS_CONFLICT', details: { reason: 'NO_VALID_WEBHOOK' } })
  })

  it('refuses when no linked account has passed the QR check', async () => {
    const { t, integration } = await testing('a3', { webhook: true })
    await expect(activateIntegration(getDb(), t.org.id, integration.id, BASE))
      .rejects.toMatchObject({ code: 'STATUS_CONFLICT', details: { reason: 'NO_CHECKED_ACCOUNT' } })
  })

  it('activates and verifies the checked accounts', async () => {
    const { t, account, integration } = await testing('a4', { checked: true, webhook: true })
    const now = new Date('2026-11-01T05:00:00Z')
    const dto = await activateIntegration(getDb(), t.org.id, integration.id, BASE, now)
    expect(dto.status).toBe('ACTIVE')
    const [row] = await getDb().select().from(storePaymentAccounts).where(eq(storePaymentAccounts.id, account.id))
    expect(row!.verifiedAt?.toISOString()).toBe(now.toISOString())
  })

  it('is idempotent once ACTIVE', async () => {
    const { t, integration } = await testing('a5', { checked: true, webhook: true })
    await activateIntegration(getDb(), t.org.id, integration.id, BASE)
    expect((await activateIntegration(getDb(), t.org.id, integration.id, BASE)).status).toBe('ACTIVE')
  })

  it('does not find an integration of another org', async () => {
    const a = await createTenant('a6a')
    const { integration } = await testing('a6b', { checked: true, webhook: true })
    await expect(activateIntegration(getDb(), a.org.id, integration.id, BASE)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('getIntegration / listIntegrations', () => {
  it('hides disabled integrations from the list and scopes by org', async () => {
    const a = await createTenant('g1a')
    const b = await createTenant('g1b')
    const live = await createIntegration(a.org)
    await createIntegration(a.org, { environment: 'test', status: 'DISABLED' })
    await createIntegration(b.org)
    expect((await listIntegrations(getDb(), a.org.id, BASE)).map(i => i.id)).toEqual([live.id])
    await expect(getIntegration(getDb(), b.org.id, live.id, BASE)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('integration-secrets (for PR6)', () => {
  it('decrypts both secrets, or null when absent', async () => {
    const t = await createTenant('x1')
    const { integration } = await createOrGetIntegration(getDb(), t.org.id, defaults, BASE)
    expect(await loadIntegrationSecrets(getDb(), integration.id)).toEqual({ hmacSecret: null, apiToken: null })
    await saveIntegrationSecret(getDb(), t.org.id, integration.id, { hmacSecret: SECRET }, BASE)
    expect(await loadIntegrationSecrets(getDb(), integration.id)).toEqual({ hmacSecret: SECRET, apiToken: null })
    expect(await loadIntegrationSecrets(getDb(), '00000000-0000-4000-8000-000000000000')).toBeNull()
  })

  it('finds an integration by endpoint key, ignores disabled ones and malformed keys', async () => {
    const t = await createTenant('x2')
    const live = await createIntegration(t.org)
    const dead = await createIntegration(t.org, { environment: 'test', status: 'DISABLED' })
    expect(await findIntegrationByEndpointKey(getDb(), live.webhookEndpointKey)).toEqual({
      id: live.id, orgId: t.org.id, environment: 'live', status: 'DRAFT',
    })
    expect(await findIntegrationByEndpointKey(getDb(), dead.webhookEndpointKey)).toBeNull()
    expect(await findIntegrationByEndpointKey(getDb(), 'short')).toBeNull()
    expect(await findIntegrationByEndpointKey(getDb(), `${live.webhookEndpointKey}%27 OR 1=1`)).toBeNull()
  })
})
