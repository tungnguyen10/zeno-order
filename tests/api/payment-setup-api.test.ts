import { fileURLToPath } from 'node:url'
import { setup } from '@nuxt/test-utils/e2e'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { orders, paymentAttempts, rateLimits, sepayIntegrations } from '../../server/db/schema'
import { hashToken } from '../../server/utils/tokens'
import { createTestAuth } from '../support/auth'
import { openStore, pickupBody, seedMenu, type SeededMenu } from '../support/checkout-fixtures'
import { resetDb } from '../support/db'
import { addStaff, createTenant } from '../support/fixtures'
import { call, type CallResult } from '../support/http'
import { findForbiddenKeys } from '../support/json'
import { setupBankQr } from '../support/payment-fixtures'

const auth = await createTestAuth()
process.env.AUTH_TEST_JWKS = auth.jwksJson

await setup({
  rootDir: fileURLToPath(new URL('../..', import.meta.url)),
  server: true,
  build: true,
  nuxtConfig: { typescript: { typeCheck: false } },
})

const seed = {} as {
  slug: string
  storeId: string
  orgId: string
  menu: SeededMenu
  ownerToken: string
  staffToken: string
  plainSlug: string
  plainStoreId: string
  plainMenu: SeededMenu
}

const sign = (user: { userId: string, email: string }) => auth.sign({ sub: user.userId, email: user.email })

beforeAll(async () => {
  await resetDb()
  const a = await createTenant('pay-a')
  const staff = await addStaff(a.store)
  const menu = await seedMenu(a.store)
  await openStore(a.store.id)
  await setupBankQr(a.store)

  const b = await createTenant('pay-b')
  const plainMenu = await seedMenu(b.store)
  await openStore(b.store.id)

  Object.assign(seed, {
    slug: a.store.slug,
    storeId: a.store.id,
    orgId: a.org.id,
    menu,
    ownerToken: await sign(a.owner),
    staffToken: await sign(staff),
    plainSlug: b.store.slug,
    plainStoreId: b.store.id,
    plainMenu,
  })
})

afterAll(async () => {
  await closeDb()
})

const bankQrOrder = (slug: string, menu: SeededMenu, over: Record<string, unknown> = {}) =>
  call('POST', `/api/public/stores/${slug}/orders`, null, pickupBody(menu, { paymentMethod: 'BANK_QR', ...over }))

async function clearRateLimits() {
  await getDb().delete(rateLimits)
}

async function orderByToken(guestToken: string) {
  const [row] = await getDb().select().from(orders).where(eq(orders.guestTokenHash, hashToken(guestToken)))
  return row!
}

describe('BANK_QR checkout', () => {
  const state = {} as { body: ReturnType<typeof pickupBody>, guestToken: string, qr: Record<string, string | number>, orderId: string }

  it('creates an AWAITING_PAYMENT order with one PENDING attempt and a correct QR', async () => {
    await clearRateLimits()
    const body = pickupBody(seed.menu, { paymentMethod: 'BANK_QR' })
    const res = await call('POST', `/api/public/stores/${seed.slug}/orders`, null, body)
    expect([200, 201]).toContain(res.status)
    expect(res.body).toMatchObject({ status: 'AWAITING_PAYMENT', paymentStatus: 'PENDING', totalVnd: 70_000 })

    const qr = res.body.qr
    expect(qr).toMatchObject({ bankName: 'Vietcombank', accountNumber: '9988776655', accountHolder: 'NGUYEN VAN A', amountVnd: 70_000 })
    expect(qr.transferContent).toMatch(/^ZO[A-Z0-9]{8}$/)
    expect(Object.fromEntries(new URL(qr.imageUrl).searchParams)).toEqual({
      acc: '9988776655', bank: '970436', amount: '70000', des: qr.transferContent, template: 'qronly',
    })
    const msLeft = Date.parse(qr.expiresAt) - Date.now()
    expect(msLeft).toBeGreaterThan(14 * 60_000)
    expect(msLeft).toBeLessThanOrEqual(15 * 60_000 + 5_000)

    const order = await orderByToken(res.body.guestToken)
    expect(order).toMatchObject({ status: 'AWAITING_PAYMENT', paymentMethod: 'BANK_QR', paymentStatus: 'PENDING', totalVnd: 70_000 })
    const attempts = await getDb().select().from(paymentAttempts).where(eq(paymentAttempts.orderId, order.id))
    expect(attempts).toHaveLength(1)
    expect(attempts[0]).toMatchObject({ status: 'PENDING', paymentCode: qr.transferContent, expectedAmountVnd: 70_000 })
    Object.assign(state, { body, guestToken: res.body.guestToken, qr, orderId: order.id })
  })

  it('replays the same idempotency key with the same token and the same live QR', async () => {
    const res = await call('POST', `/api/public/stores/${seed.slug}/orders`, null, state.body)
    expect([200, 201]).toContain(res.status)
    expect(res.body.guestToken).toBe(state.guestToken)
    expect(res.body.qr).toEqual(state.qr)
    expect(await getDb().select().from(paymentAttempts).where(eq(paymentAttempts.orderId, state.orderId))).toHaveLength(1)
  })

  it('returns the live QR from GET /api/public/orders/:token without leaking internals', async () => {
    const res = await call('GET', `/api/public/orders/${state.guestToken}`)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'AWAITING_PAYMENT', paymentStatus: 'PENDING', paymentMethod: 'BANK_QR' })
    expect(res.body.qr).toEqual(state.qr)
    expect(findForbiddenKeys(res.body)).toEqual([])
    const json = JSON.stringify(res.body)
    for (const hidden of [seed.orgId, seed.storeId, 'accountId', 'vaNumber', 'encrypted']) expect(json).not.toContain(hidden)
  })

  it('keeps the order out of the prep queue: not in tab=new, present in tab=awaiting_payment', async () => {
    for (const token of [seed.ownerToken, seed.staffToken]) {
      const fresh = await call('GET', `/api/stores/${seed.storeId}/orders?tab=new`, token)
      expect(fresh.status).toBe(200)
      expect(fresh.body.orders.map((o: { id: string }) => o.id)).not.toContain(state.orderId)
      const waiting = await call('GET', `/api/stores/${seed.storeId}/orders?tab=awaiting_payment`, token)
      expect(waiting.body.orders.map((o: { id: string }) => o.id)).toContain(state.orderId)
      expect(waiting.body.counts.awaiting_payment).toBeGreaterThanOrEqual(1)
    }
  })

  it('does not let staff or owner push an AWAITING_PAYMENT order into preparation', async () => {
    for (const [token, nextStatus] of [[seed.staffToken, 'PREPARING'], [seed.ownerToken, 'PREPARING'], [seed.ownerToken, 'NEW']] as const) {
      const res = await call('PATCH', `/api/stores/${seed.storeId}/orders/${state.orderId}/status`, token, {
        expectedStatus: 'AWAITING_PAYMENT',
        nextStatus,
      })
      expect(res.status).toBeGreaterThanOrEqual(400)
    }
    expect((await orderByToken(state.guestToken)).status).toBe('AWAITING_PAYMENT')
  })

  it('answers 422 PAYMENT_METHOD_UNAVAILABLE and creates no order for a store without bank transfer', async () => {
    await clearRateLimits()
    const res = await bankQrOrder(seed.plainSlug, seed.plainMenu)
    expect(res).toMatchObject({ status: 422, body: { code: 'PAYMENT_METHOD_UNAVAILABLE' } })
    expect(await getDb().select().from(orders).where(eq(orders.storeId, seed.plainStoreId))).toHaveLength(0)
  })

  it('answers 422 while the integration is still TESTING', async () => {
    await clearRateLimits()
    await getDb().update(sepayIntegrations).set({ status: 'TESTING' }).where(eq(sepayIntegrations.orgId, seed.orgId))
    try {
      const res = await bankQrOrder(seed.slug, seed.menu)
      expect(res).toMatchObject({ status: 422, body: { code: 'PAYMENT_METHOD_UNAVAILABLE' } })
    }
    finally {
      await getDb().update(sepayIntegrations).set({ status: 'ACTIVE' }).where(eq(sepayIntegrations.orgId, seed.orgId))
    }
  })

  it('leaves cash-on-receipt orders untouched: NEW, UNPAID, no QR, no attempt', async () => {
    await clearRateLimits()
    const res = await call('POST', `/api/public/stores/${seed.slug}/orders`, null, pickupBody(seed.menu))
    expect([200, 201]).toContain(res.status)
    expect(res.body).toMatchObject({ status: 'NEW', paymentStatus: 'UNPAID' })
    expect(res.body.qr).toBeUndefined()
    const order = await orderByToken(res.body.guestToken)
    expect(await getDb().select().from(paymentAttempts).where(eq(paymentAttempts.orderId, order.id))).toHaveLength(0)
  })

  it('hides the QR once the attempt has lapsed but keeps the order waiting', async () => {
    await getDb().update(paymentAttempts).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(paymentAttempts.orderId, state.orderId))
    const res = await call('GET', `/api/public/orders/${state.guestToken}`)
    expect(res.body).toMatchObject({ status: 'AWAITING_PAYMENT', paymentStatus: 'PENDING', qr: null })
  })
})

describe('owner sets up bank transfer over HTTP (bank + number + name, then Kiểm tra)', () => {
  const SECRET = 'SENTINEL_http_hmac_0123456789'
  const API_TOKEN = 'SENTINEL_http_token_0123456789'
  const t = {} as { orgId: string, storeId: string, slug: string, ownerToken: string, staffToken: string, menu: SeededMenu }
  const bodies: string[] = []
  const ref = {} as { accountId: string, integrationId: string }

  const record = (res: CallResult) => {
    bodies.push(JSON.stringify(res.body))
    return res
  }
  const owner = (method: string, path: string, body?: unknown) => call(method, path, t.ownerToken, body).then(record)

  beforeAll(async () => {
    const tenant = await createTenant('pay-owner')
    const staff = await addStaff(tenant.store)
    const menu = await seedMenu(tenant.store)
    await openStore(tenant.store.id)
    Object.assign(t, {
      orgId: tenant.org.id,
      storeId: tenant.store.id,
      slug: tenant.store.slug,
      ownerToken: await sign(tenant.owner),
      staffToken: await sign(staff),
      menu,
    })
  })

  const accounts = () => `/api/stores/${t.storeId}/payment-accounts`
  const integrations = () => `/api/organizations/${t.orgId}/sepay-integrations`

  it('starts with no account', async () => {
    expect((await owner('GET', accounts())).body).toEqual({ account: null })
  })

  it('rejects a VA-only bank without a VA number, pointing at the field (Review Focus #1)', async () => {
    const res = await owner('POST', accounts(), { bankCode: 'MSB', accountNumber: '9988776655', accountHolder: 'NGUYEN VAN B' })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('VALIDATION_FAILED')
    expect(res.body.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'vaNumber' })]))
  })

  it('creates the account, normalising input', async () => {
    const res = await owner('POST', accounts(), { bankCode: 'acb', accountNumber: '1122 3344 55', accountHolder: ' NGUYEN VAN B ' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ bankCode: 'ACB', accountNumber: '1122334455', accountHolder: 'NGUYEN VAN B', qrCheckedAt: null, verifiedAt: null })
    ref.accountId = res.body.id
  })

  it('refuses a second account for the store', async () => {
    const res = await owner('POST', accounts(), { bankCode: 'VCB', accountNumber: '9988776655', accountHolder: 'NGUOI KHAC' })
    expect(res).toMatchObject({ status: 409, body: { code: 'STATUS_CONFLICT' } })
  })

  it('"Kiểm tra" returns a 2.000đ QR for the right bank, then the owner confirms', async () => {
    const check = await owner('POST', `${accounts()}/${ref.accountId}/check`)
    expect(check.status).toBe(200)
    expect(check.body).toMatchObject({ ok: true, issues: [], warnings: [] })
    expect(check.body.preview).toMatchObject({ bankName: 'ACB', accountNumber: '1122334455', amountVnd: 2000, transferContent: 'ZOTEST0000' })
    expect(Object.fromEntries(new URL(check.body.preview.imageUrl).searchParams)).toMatchObject({ acc: '1122334455', bank: '970416', amount: '2000' })

    const confirmed = await owner('POST', `${accounts()}/${ref.accountId}/confirm-qr`, { revision: check.body.revision })
    expect(confirmed.body.qrCheckedAt).not.toBeNull()
    expect(confirmed.body.verifiedAt).toBeNull()
  })

  it('creates the SePay integration once (double tap returns the same one)', async () => {
    const first = await owner('POST', integrations(), {})
    expect(first.status).toBe(201)
    expect(first.body).toMatchObject({ status: 'DRAFT', hasSecret: false })
    expect(first.body.webhookUrl).toMatch(/\/api\/webhooks\/sepay\/[A-Za-z0-9_-]{32}$/)
    const second = await owner('POST', integrations(), {})
    expect(second.status).toBe(200)
    expect(second.body.id).toBe(first.body.id)
    ref.integrationId = first.body.id
  })

  it('rejects a too-short secret without echoing it (Review Focus #5)', async () => {
    const res = await owner('PUT', `${integrations()}/${ref.integrationId}/secret`, { hmacSecret: 'SHORT1' })
    expect(res).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
    expect(JSON.stringify(res.body)).not.toContain('SHORT1')
  })

  it('stores a valid secret and only reports flags', async () => {
    const res = await owner('PUT', `${integrations()}/${ref.integrationId}/secret`, { hmacSecret: `  ${SECRET}\n`, apiToken: API_TOKEN })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'TESTING', hasSecret: true, hasApiToken: true })
    expect(findForbiddenKeys(res.body)).toEqual([])
    const listed = await owner('GET', integrations())
    expect(listed.body.integrations).toHaveLength(1)
    const one = await owner('GET', `${integrations()}/${ref.integrationId}`)
    expect(one.body).toEqual(res.body)
  })

  it('links the account and refuses to activate before a valid webhook (PR6 sets last_valid_webhook_at)', async () => {
    const linked = await owner('POST', `${integrations()}/${ref.integrationId}/accounts`, { paymentAccountId: ref.accountId })
    expect(linked.body.accountIds).toEqual([ref.accountId])
    const early = await owner('POST', `${integrations()}/${ref.integrationId}/activate`)
    expect(early).toMatchObject({ status: 409, body: { code: 'STATUS_CONFLICT', details: { reason: 'NO_VALID_WEBHOOK' } } })
  })

  it('cannot take BANK_QR orders yet, then can once the integration is ACTIVE and the account verified', async () => {
    await clearRateLimits()
    expect(await bankQrOrder(t.slug, t.menu)).toMatchObject({ status: 422, body: { code: 'PAYMENT_METHOD_UNAVAILABLE' } })

    await getDb().update(sepayIntegrations).set({ lastValidWebhookAt: new Date() }).where(eq(sepayIntegrations.id, ref.integrationId))
    const activated = await owner('POST', `${integrations()}/${ref.integrationId}/activate`)
    expect(activated.body.status).toBe('ACTIVE')
    expect((await owner('GET', accounts())).body.account.verifiedAt).not.toBeNull()

    const order = await bankQrOrder(t.slug, t.menu)
    expect([200, 201]).toContain(order.status)
    expect(order.body).toMatchObject({ status: 'AWAITING_PAYMENT' })
    expect(order.body.qr).toMatchObject({ bankName: 'ACB', accountNumber: '1122334455', amountVnd: 70_000 })
    expect(new URL(order.body.qr.imageUrl).searchParams.get('bank')).toBe('970416')
  })

  it('stops offering bank transfer the moment the owner edits the account (Review Focus #4)', async () => {
    const patched = await owner('PATCH', `${accounts()}/${ref.accountId}`, { accountNumber: '5566778899' })
    expect(patched.body).toMatchObject({ accountNumber: '5566778899', qrCheckedAt: null, verifiedAt: null })
    await clearRateLimits()
    expect(await bankQrOrder(t.slug, t.menu)).toMatchObject({ status: 422, body: { code: 'PAYMENT_METHOD_UNAVAILABLE' } })
  })

  it('rejects missing or stale QR confirmation revisions instead of verifying a changed recipient', async () => {
    const preview = await owner('POST', `${accounts()}/${ref.accountId}/check`)
    expect(preview.body.revision).toMatch(/^[a-f0-9]{64}$/)
    await owner('PATCH', `${accounts()}/${ref.accountId}`, { accountNumber: '7788991122' })
    const missing = await owner('POST', `${accounts()}/${ref.accountId}/confirm-qr`)
    expect(missing).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
    const stale = await owner('POST', `${accounts()}/${ref.accountId}/confirm-qr`, { revision: preview.body.revision })
    expect(stale).toMatchObject({ status: 409, body: { code: 'STATUS_CONFLICT' } })
    expect(stale.headers.get('cache-control')).toBe('no-store')
    const current = await owner('GET', accounts())
    expect(current.body.account).toMatchObject({ accountNumber: '7788991122', qrCheckedAt: null, verifiedAt: null })
  })

  it('staff can read nothing of the payment setup', async () => {
    expect((await call('GET', accounts(), t.staffToken)).status).toBe(403)
    expect((await call('GET', integrations(), t.staffToken)).status).toBe(404)
  })

  it('no response of the whole flow ever contained a secret, API token, ciphertext or encrypted-field name', async () => {
    const [row] = await getDb().select().from(sepayIntegrations).where(eq(sepayIntegrations.id, ref.integrationId))
    const all = bodies.join('\n')
    for (const leaked of [SECRET, API_TOKEN, row!.encryptedHmacSecret!, row!.encryptedApiToken!, 'encryptedHmacSecret', 'encryptedApiToken']) {
      expect(all.includes(leaked), 'a secret-bearing value reached an API response').toBe(false)
    }
  })
})

describe('POST /api/public/orders/:token/payment-attempts', () => {
  async function freshOrder() {
    await clearRateLimits()
    const res = await bankQrOrder(seed.slug, seed.menu)
    expect([200, 201]).toContain(res.status)
    const guestToken = res.body.guestToken as string
    return { guestToken, qr: res.body.qr, orderId: (await orderByToken(guestToken)).id }
  }
  const repay = (guestToken: string) => call('POST', `/api/public/orders/${guestToken}/payment-attempts`, null)
  const lapse = (orderId: string) =>
    getDb().update(paymentAttempts).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(paymentAttempts.orderId, orderId))
  const attemptsOf = (orderId: string) =>
    getDb().select().from(paymentAttempts).where(eq(paymentAttempts.orderId, orderId)).orderBy(paymentAttempts.createdAt)

  it('returns the live QR (200) without creating anything on a double tap', async () => {
    const order = await freshOrder()
    const res = await repay(order.guestToken)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ qr: order.qr })
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await attemptsOf(order.orderId)).toHaveLength(1)
  })

  it('issues a new code (201) after expiry, supersedes the old attempt and shows the new QR on the order', async () => {
    const order = await freshOrder()
    await lapse(order.orderId)
    const res = await repay(order.guestToken)
    expect(res.status).toBe(201)
    expect(res.body.qr.transferContent).not.toBe(order.qr.transferContent)
    expect(res.body.qr).toMatchObject({ amountVnd: 70_000, accountNumber: '9988776655' })

    const rows = await attemptsOf(order.orderId)
    expect(rows.map(r => r.status)).toEqual(['SUPERSEDED', 'PENDING'])
    expect(rows[0]!.paymentCode).toBe(order.qr.transferContent)

    const tracking = await call('GET', `/api/public/orders/${order.guestToken}`)
    expect(tracking.body.qr).toEqual(res.body.qr)
    expect(findForbiddenKeys(res.body)).toEqual([])
    expect(JSON.stringify(res.body)).not.toContain(seed.orgId)
  })

  it('creates exactly one attempt for four concurrent taps after expiry (Review Focus #2)', async () => {
    const order = await freshOrder()
    await lapse(order.orderId)
    const results = await Promise.all(Array.from({ length: 4 }, () => repay(order.guestToken)))
    expect(results.map(r => r.status).sort()).toEqual([200, 200, 200, 201])
    expect(new Set(results.map(r => r.body.qr.transferContent)).size).toBe(1)
    const rows = await attemptsOf(order.orderId)
    expect(rows.filter(r => r.status === 'PENDING')).toHaveLength(1)
    expect(rows).toHaveLength(2)
  })

  it('keeps every old code on record across repeated re-pays (Review Focus #3)', async () => {
    const order = await freshOrder()
    for (let i = 0; i < 2; i++) {
      await lapse(order.orderId)
      expect((await repay(order.guestToken)).status).toBe(201)
    }
    const rows = await attemptsOf(order.orderId)
    expect(rows.map(r => r.status)).toEqual(['SUPERSEDED', 'SUPERSEDED', 'PENDING'])
    expect(new Set(rows.map(r => r.paymentCode)).size).toBe(3)
  })

  it('answers 404 identically for an unknown token and a malformed one', async () => {
    const unknown = await repay('A'.repeat(43))
    const malformed = await repay('not-a-token')
    expect(unknown).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
    expect(malformed.status).toBe(404)
    expect(malformed.body).toEqual(unknown.body)
  })

  it('answers 409 for a cash-on-receipt order and for an order that is already paid', async () => {
    await clearRateLimits()
    const cod = await call('POST', `/api/public/stores/${seed.slug}/orders`, null, pickupBody(seed.menu))
    expect(await repay(cod.body.guestToken)).toMatchObject({ status: 409, body: { code: 'STATUS_CONFLICT' } })

    const order = await freshOrder()
    await getDb().update(orders).set({ status: 'NEW', paymentStatus: 'PAID' }).where(eq(orders.id, order.orderId))
    expect(await repay(order.guestToken)).toMatchObject({ status: 409, body: { code: 'STATUS_CONFLICT' } })
    expect((await call('GET', `/api/public/orders/${order.guestToken}`)).body.qr).toBeNull()
  })

  it('answers 422 and keeps the old attempt when the store switched bank transfer off', async () => {
    const order = await freshOrder()
    await lapse(order.orderId)
    await getDb().update(sepayIntegrations).set({ status: 'DISABLED' }).where(eq(sepayIntegrations.orgId, seed.orgId))
    try {
      expect(await repay(order.guestToken)).toMatchObject({ status: 422, body: { code: 'PAYMENT_METHOD_UNAVAILABLE' } })
      expect((await attemptsOf(order.orderId)).map(r => r.status)).toEqual(['PENDING'])
    }
    finally {
      await getDb().update(sepayIntegrations).set({ status: 'ACTIVE' }).where(eq(sepayIntegrations.orgId, seed.orgId))
    }
  })

  it('rate-limits the eleventh call within ten minutes for one order', async () => {
    const order = await freshOrder()
    for (let i = 0; i < 10; i++) expect((await repay(order.guestToken)).status).toBe(200)
    expect(await repay(order.guestToken)).toMatchObject({ status: 429, body: { code: 'RATE_LIMITED' } })
  })
})
