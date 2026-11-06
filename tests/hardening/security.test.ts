import { randomUUID, createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { orders, rateLimits } from '../../server/db/schema'
import { api, context, signer } from '../support/hardening'
import { resetDb } from '../support/db'
import { createTenant } from '../support/fixtures'
import { deliveryBody, openStore, seedMenu } from '../support/checkout-fixtures'

let tenant: Awaited<ReturnType<typeof createTenant>>
let menu: Awaited<ReturnType<typeof seedMenu>>
let guestToken: string
const canary = { phone: '0987650123', address: '99 Canary-PRIVATE-7f3a' }
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
beforeAll(async () => {
  await resetDb(); tenant = await createTenant('hardening'); menu = await seedMenu(tenant.store)
  await openStore(tenant.store.id, { deliveryEnabled: true })
  const result = await api('POST', `/api/public/stores/${tenant.store.slug}/orders`, { body: deliveryBody(menu, { customer: { name: 'Khách', ...canary } }) })
  expect(result.status).toBe(201)
  guestToken = result.json.guestToken
})
afterAll(closeDb)
describe('production response policy', () => {
  it.each(['/login', '/signup', '/o/capability-canary', '/invite/invitation-canary', '/api/not-found', '/api/internal/status'])('enforces headers on %s, including failures', async (path) => {
    const result = await api('GET', path)
    expect(result.headers.get('x-content-type-options')).toBe('nosniff')
    expect(result.headers.get('x-frame-options')).toBe('DENY')
    expect(result.headers.get('referrer-policy')).toBe('no-referrer')
    expect(result.headers.get('cache-control')).toContain('no-store')
    expect(result.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
  })
  it('requires separate ops credentials; a valid owner session is insufficient', async () => {
    const auth = await signer()
    expect((await api('GET', '/api/internal/status')).status).toBe(401)
    const token = await auth.sign({ sub: tenant.owner.userId })
    expect((await api('GET', '/api/internal/status', { token })).status).toBe(401)
    const res = await api('GET', '/api/internal/status', { token: context().opsSecret })
    expect(res.status).toBe(503)
    expect(res.json.reasons).toEqual(['EXPIRE_STALE', 'RECONCILE_STALE'])
    expect(res.text).not.toContain(tenant.org.id)
  })
  it('never exposes raw phone/address or encrypted fields in public tracking', async () => {
    const result = await api('GET', `/api/public/orders/${guestToken}`)
    expect(result.status).toBe(200)
    expect(result.text).not.toContain(canary.phone); expect(result.text).not.toContain(canary.address)
    expect(result.json).not.toHaveProperty('orgId'); expect(result.json).not.toHaveProperty('guestTokenEncrypted')
    expect(result.json).not.toHaveProperty('customerAddress')
  })
  it('does not accept a cookie as API authentication (CSRF boundary)', async () => {
    const auth = await signer(); const jwt = await auth.sign({ sub: tenant.owner.userId })
    const result = await api('PATCH', `/api/stores/${tenant.store.id}`, { headers: { cookie: `session=${jwt}`, origin: 'https://evil.example' }, body: { name: 'Hacked' } })
    expect(result.status).toBe(401)
  })
})
describe('shared café Wi-Fi', () => {
  it('serves 30 simultaneous menu requests', async () => {
    const responses = await Promise.all(Array.from({ length: 30 }, () => api('GET', `/api/public/stores/${tenant.store.slug}/menu`)))
    expect(responses.map(row => row.status)).toEqual(Array.from({ length: 30 }, () => 200))
  })
  it('throttles one tracking capability without blocking another on the same IP', async () => {
    const key = `tracking:${hash(guestToken)}`
    const start = new Date(Math.floor(Date.now() / 60_000) * 60_000)
    await getDb().insert(rateLimits).values({ key, windowStart: start, count: 40 }).onConflictDoUpdate({ target: [rateLimits.key, rateLimits.windowStart], set: { count: 40 } })
    const blocked = await api('GET', `/api/public/orders/${guestToken}`, { headers: { 'x-forwarded-for': '8.8.8.8' } })
    expect(blocked.status).toBe(429); expect(blocked.headers.get('retry-after')).toBe('60')
    expect((await api('GET', `/api/public/orders/${randomUUID()}`)).status).toBe(404)
  })
  it('cannot bypass checkout limits by changing XFF and preserves idempotent replay', async () => {
    const [original] = await getDb().select().from(orders).where(eq(orders.guestTokenHash, hash(guestToken)))
    const key = `checkout:${tenant.store.id}:${hash('127.0.0.1').slice(0, 16)}`
    const start = new Date(Math.floor(Date.now() / 600_000) * 600_000)
    await getDb().insert(rateLimits).values({ key, windowStart: start, count: 10 }).onConflictDoUpdate({ target: [rateLimits.key, rateLimits.windowStart], set: { count: 10 } })
    const body = deliveryBody(menu, { customer: { name: 'Khách', ...canary } })
    for (const ip of ['8.8.8.8', '9.9.9.9']) expect((await api('POST', `/api/public/stores/${tenant.store.slug}/orders`, { body, headers: { 'x-forwarded-for': ip } })).status).toBe(429)
    const replay = await api('POST', `/api/public/stores/${tenant.store.slug}/orders`, { body: { ...body, idempotencyKey: original!.idempotencyKey } })
    expect(replay.status).toBe(200); expect(replay.json.guestToken).toBe(guestToken)
    expect((await getDb().execute(sql`select count(*)::int as count from orders`)).rows[0]).toEqual({ count: 1 })
    // Avoid retaining this test's rate fixture for unrelated consumers.
    await getDb().delete(rateLimits).where(and(eq(rateLimits.key, key), eq(rateLimits.windowStart, start)))
  })
})
it('keeps capabilities, query values and PII out of all server logs', async () => {
  await api('GET', `/o/${guestToken}?t=table-private-canary`)
  await api('GET', '/api/invitations/invitation-private-canary')
  await api('POST', '/api/webhooks/sepay/webhook-private-canary', { body: {} })
  await delay(50)
  const logs = readFileSync(context().logFile, 'utf8')
  expect(logs).toContain('http.request')
  for (const value of [guestToken, canary.phone, canary.address, 'table-private-canary', 'invitation-private-canary', 'webhook-private-canary', context().opsSecret]) expect(logs.includes(value), 'sensitive canary in server logs').toBe(false)
})
it('does not bundle server secrets into client assets', () => {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)])
  const secrets = ['APP_ENCRYPTION_KEY', 'OPS_STATUS_SECRET', 'DATABASE_URL', 'AWS_SECRET_ACCESS_KEY'].map(key => process.env[key]).filter((value): value is string => !!value && value.length >= 16)
  for (const file of walk('.output/public').filter(p => /\.(js|html|css|json|map)$/.test(p))) {
    const content = readFileSync(file, 'utf8')
    for (const value of secrets) expect(content.includes(value), 'server secret in a client asset').toBe(false)
  }
})
