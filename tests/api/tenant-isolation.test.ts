import { createOrderRow } from '../support/order-fixtures'
import { randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { fetch, setup } from '@nuxt/test-utils/e2e'
import { count, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { orders, stores } from '../../server/db/schema'
import { createTestAuth } from '../support/auth'
import { resetDb } from '../support/db'
import { addStaff, createCategory, createOptionGroup, createProduct, createStore, createTable, createTenant, createUser, createZone } from '../support/fixtures'

import { deliveryBody, dineInBody, openStore, pickupBody, seedMenu, teaItem, type SeededMenu } from '../support/checkout-fixtures'

const auth = await createTestAuth()
process.env.AUTH_TEST_JWKS = auth.jwksJson
// Mặc định production: bắt buộc email đã xác minh khi nhận lời mời (spec quy ước xuyên PR #7).
process.env.INVITE_REQUIRE_VERIFIED_EMAIL = 'true'

await setup({
  rootDir: fileURLToPath(new URL('../..', import.meta.url)),
  server: true,
  build: true,
  nuxtConfig: { typescript: { typeCheck: false } },
})

type Actor = 'ownerA' | 'staffA1' | 'staffA2' | 'disabledA1' | 'ownerB'
const tokens = {} as Record<Actor, string>
const ids = {} as {
  orgA: string
  storeA1: string
  storeA2: string
  storeB: string
  storeA1Slug: string
  storeBSlug: string
  categoryA1: string
  categoryA2: string
  categoryB: string
  productA1: string
  productA2: string
  productB: string
  tableA1: string
  zoneA1: string
}

let menuA: SeededMenu
let menuB: SeededMenu

async function call(method: string, path: string, token?: string | null, body?: unknown, extraHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extraHeaders }
  if (token) headers.authorization = `Bearer ${token}`
  let payload: string | undefined
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = typeof body === 'string' ? body : JSON.stringify(body)
  }
  const res = await fetch(path, { method, headers, body: payload })
  const json = await res.json().catch(() => null)
  return { status: res.status, body: json }
}

const errorCodes: Record<number, string> = { 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'NOT_FOUND' }

async function storeName(storeId: string) {
  const [row] = await getDb().select({ name: stores.name }).from(stores).where(eq(stores.id, storeId))
  return row!.name
}

beforeAll(async () => {
  await resetDb()
  const a = await createTenant('a1')
  const storeA2 = await createStore(a.org.id, 'a2')
  const b = await createTenant('b1')
  const staffA1 = await addStaff(a.store)
  const staffA2 = await addStaff(storeA2)
  const disabledA1 = await addStaff(a.store, { status: 'DISABLED' })

  const categoryA1 = await createCategory(a.store, 'Trà A1')
  const categoryA2 = await createCategory(storeA2, 'Trà A2')
  const categoryB = await createCategory(b.store, 'Trà B')
  const productA1 = await createProduct(a.store, { name: 'Món A1', categoryId: categoryA1.id })
  await createOptionGroup(a.store, productA1, { name: 'Size', required: true, values: [{ name: 'M' }, { name: 'L', priceDeltaVnd: 5000 }] })
  const productA2 = await createProduct(storeA2, { name: 'Món A2' })
  const productB = await createProduct(b.store, { name: 'Món B' })
  const tableA1 = await createTable(a.store, '01')
  const zoneA1 = await createZone(a.store, { name: 'Zone A1' })

  Object.assign(ids, {
    orgA: a.org.id,
    storeA1: a.store.id,
    storeA2: storeA2.id,
    storeB: b.store.id,
    storeA1Slug: a.store.slug,
    storeBSlug: b.store.slug,
    categoryA1: categoryA1.id,
    categoryA2: categoryA2.id,
    categoryB: categoryB.id,
    productA1: productA1.id,
    productA2: productA2.id,
    productB: productB.id,
    tableA1: tableA1.table.id,
    zoneA1: zoneA1.id,
  })
  const sign = (user: { userId: string, email: string }) => auth.sign({ sub: user.userId, email: user.email })
  tokens.ownerA = await sign(a.owner)
  tokens.staffA1 = await sign(staffA1)
  tokens.staffA2 = await sign(staffA2)
  tokens.disabledA1 = await sign(disabledA1)
  tokens.ownerB = await sign(b.owner)
})

afterAll(async () => {
  await closeDb()
})

describe('authentication', () => {
  it.each([
    ['GET', '/api/me'],
    ['GET', '/api/stores'],
    ['POST', '/api/organizations'],
  ])('%s %s without token → 401', async (method, path) => {
    const res = await call(method, path, null, method === 'POST' ? {} : undefined)
    expect(res.status).toBe(401)
    expect(res.body).toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('rejects a garbage bearer token', async () => {
    expect(await call('GET', '/api/me', 'not-a-jwt')).toMatchObject({ status: 401, body: { code: 'UNAUTHENTICATED' } })
  })

  it('rejects a token signed by another key', async () => {
    const other = await createTestAuth()
    const token = await other.sign({ sub: 'intruder', email: 'i@example.com' })
    expect(await call('GET', '/api/me', token)).toMatchObject({ status: 401, body: { code: 'UNAUTHENTICATED' } })
  })
})

describe('GET /api/stores/:storeId', () => {
  it.each<[Actor, number]>([
    ['ownerA', 200],
    ['staffA1', 200],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
  ])('%s → %i', async (actor, status) => {
    const res = await call('GET', `/api/stores/${ids.storeA1}`, tokens[actor])
    expect(res.status).toBe(status)
    if (status === 200) expect(res.body).toMatchObject({ id: ids.storeA1, orgId: ids.orgA })
    else expect(res.body).toMatchObject({ code: errorCodes[status] })
  })

  it('treats another tenant\'s real store exactly like a random id', async () => {
    const real = await call('GET', `/api/stores/${ids.storeA1}`, tokens.ownerB)
    const random = await call('GET', `/api/stores/${randomUUID()}`, tokens.ownerB)
    expect(real).toEqual(random)
  })

  it('returns 404 (not 400/500) for a non-uuid id', async () => {
    const res = await call('GET', '/api/stores/not-a-uuid', tokens.ownerA)
    expect(res).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
  })

  it('reports the caller role', async () => {
    expect((await call('GET', `/api/stores/${ids.storeA1}`, tokens.ownerA)).body).toMatchObject({ role: 'OWNER' })
    expect((await call('GET', `/api/stores/${ids.storeA1}`, tokens.staffA1)).body).toMatchObject({ role: 'STAFF' })
  })
})

describe('PATCH /api/stores/:storeId', () => {
  it.each<[Actor, number]>([
    ['staffA1', 403],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
    ['ownerA', 200],
  ])('%s → %i', async (actor, status) => {
    const nameBefore = await storeName(ids.storeA1)
    const res = await call('PATCH', `/api/stores/${ids.storeA1}`, tokens[actor], { name: `Đổi bởi ${actor}` })
    expect(res.status).toBe(status)
    if (status !== 200) {
      expect(res.body).toMatchObject({ code: errorCodes[status] })
      expect(await storeName(ids.storeA1)).toBe(nameBefore)
    }
  })

  it('only the owner change was persisted', async () => {
    const [row] = await getDb().select().from(stores).where(eq(stores.id, ids.storeA1))
    expect(row!.name).toBe('Đổi bởi ownerA')
  })

  it('ignores attempts to move the store to another org or change slug', async () => {
    const res = await call('PATCH', `/api/stores/${ids.storeA1}`, tokens.ownerA, {
      isAcceptingOrders: true,
      orgId: randomUUID(),
      slug: 'hijack',
    })
    expect(res.status).toBe(200)
    const [row] = await getDb().select().from(stores).where(eq(stores.id, ids.storeA1))
    expect(row).toMatchObject({ orgId: ids.orgA, slug: ids.storeA1Slug, isAcceptingOrders: true })
  })

  it('rejects an empty patch with 400', async () => {
    const res = await call('PATCH', `/api/stores/${ids.storeA1}`, tokens.ownerA, {})
    expect(res).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
  })
})

describe('listing endpoints', () => {
  it('GET /api/stores is scoped per caller', async () => {
    const list = async (actor: Actor) => ((await call('GET', '/api/stores', tokens[actor])).body.stores as { id: string }[]).map(s => s.id).sort()
    expect(await list('ownerA')).toEqual([ids.storeA1, ids.storeA2].sort())
    expect(await list('staffA1')).toEqual([ids.storeA1])
    expect(await list('staffA2')).toEqual([ids.storeA2])
    expect(await list('disabledA1')).toEqual([])
    expect(await list('ownerB')).toEqual([ids.storeB])
  })

  it('GET /api/me for staff has no organizations', async () => {
    const res = await call('GET', '/api/me', tokens.staffA1)
    expect(res.status).toBe(200)
    expect(res.body.organizations).toEqual([])
    expect(res.body.stores).toEqual([expect.objectContaining({ id: ids.storeA1, role: 'STAFF' })])
  })
})

describe('POST /api/organizations', () => {
  it('creates once, then ORG_EXISTS', async () => {
    const user = { userId: `user_${randomUUID()}`, email: `new-${Date.now()}@example.com` }
    const token = await auth.sign({ sub: user.userId, email: user.email, name: 'Mới' })
    const body = { orgName: 'Nhóm Mới', storeName: 'Quán Mới', storeSlug: `quan-moi-${Date.now().toString(36)}` }
    const first = await call('POST', '/api/organizations', token, body)
    expect(first.status).toBe(201)
    expect(first.body.store).toMatchObject({ slug: body.storeSlug, role: 'OWNER' })
    const second = await call('POST', '/api/organizations', token, { ...body, storeSlug: `${body.storeSlug}-2` })
    expect(second).toMatchObject({ status: 409, body: { code: 'ORG_EXISTS' } })
  })

  it('returns SLUG_TAKEN for an existing slug', async () => {
    const user = await createUser()
    const token = await auth.sign({ sub: user.userId, email: user.email })
    const res = await call('POST', '/api/organizations', token, { orgName: 'X Group', storeName: 'X Store', storeSlug: ids.storeA1Slug })
    expect(res).toMatchObject({ status: 409, body: { code: 'SLUG_TAKEN', details: { field: 'storeSlug' } } })
  })

  it.each(['app', 'Bad Slug', 'ab'])('rejects slug %s with 400', async (storeSlug) => {
    const user = await createUser()
    const token = await auth.sign({ sub: user.userId, email: user.email })
    const res = await call('POST', '/api/organizations', token, { orgName: 'Y Group', storeName: 'Y Store', storeSlug })
    expect(res).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
  })

  it('rejects malformed JSON with 400', async () => {
    const user = await createUser()
    const token = await auth.sign({ sub: user.userId, email: user.email })
    const res = await call('POST', '/api/organizations', token, '{"orgName":')
    expect(res).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
  })
})

describe('categories', () => {
  it.each<[Actor, number]>([
    ['ownerA', 200],
    ['staffA1', 200],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
  ])('GET /categories %s → %i', async (actor, status) => {
    const res = await call('GET', `/api/stores/${ids.storeA1}/categories`, tokens[actor])
    expect(res.status).toBe(status)
    if (status === 200) {
      const listed = (res.body.categories as { id: string }[]).map(c => c.id)
      expect(listed).toContain(ids.categoryA1)
      expect(listed).not.toContain(ids.categoryA2)
      expect(listed).not.toContain(ids.categoryB)
    }
    else {
      expect(res.body).toMatchObject({ code: errorCodes[status] })
    }
  })

  it.each<[Actor, number]>([
    ['ownerA', 201],
    ['staffA1', 403],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
  ])('POST /categories %s → %i', async (actor, status) => {
    const res = await call('POST', `/api/stores/${ids.storeA1}/categories`, tokens[actor], { name: `Mới ${actor}` })
    expect(res.status).toBe(status)
    if (status !== 201) expect(res.body).toMatchObject({ code: errorCodes[status] })
  })

  it.each<[Actor, number]>([
    ['ownerA', 200],
    ['staffA1', 403],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
  ])('PATCH /categories/:id %s → %i', async (actor, status) => {
    const res = await call('PATCH', `/api/stores/${ids.storeA1}/categories/${ids.categoryA1}`, tokens[actor], { active: true })
    expect(res.status).toBe(status)
    if (status !== 200) expect(res.body).toMatchObject({ code: errorCodes[status] })
  })

  it('a category of another store is 404 even for the owner of both orgs\' stores', async () => {
    expect(await call('PATCH', `/api/stores/${ids.storeA1}/categories/${ids.categoryA2}`, tokens.ownerA, { name: 'Hijack' }))
      .toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
    expect(await call('PATCH', `/api/stores/${ids.storeB}/categories/${ids.categoryA1}`, tokens.ownerB, { name: 'Hijack' }))
      .toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
    const own = await call('GET', `/api/stores/${ids.storeA2}/categories`, tokens.ownerA)
    expect((own.body.categories as { id: string, name: string }[]).find(c => c.id === ids.categoryA2)!.name).toBe('Trà A2')
  })

  it('treats a non-uuid category id as 404 and validates the body', async () => {
    expect(await call('PATCH', `/api/stores/${ids.storeA1}/categories/xyz`, tokens.ownerA, { active: true })).toMatchObject({ status: 404 })
    expect(await call('POST', `/api/stores/${ids.storeA1}/categories`, tokens.ownerA, { name: '   ' })).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
    expect(await call('PATCH', `/api/stores/${ids.storeA1}/categories/${ids.categoryA1}`, tokens.ownerA, {})).toMatchObject({ status: 400 })
  })
})

describe('products', () => {
  it('rejects malformed product ids and invalid patches', async () => {
    expect(await call('PATCH', `/api/stores/${ids.storeA1}/products/not-a-uuid`, tokens.ownerA, { active: true }))
      .toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
    for (const body of [{}, { orgId: ids.orgA }, { basePriceVnd: -1 }, { name: ' ' }, { isAvailable: 'false' }, { categoryId: 'bad-id' }]) {
      expect(await call('PATCH', `/api/stores/${ids.storeA1}/products/${ids.productA1}`, tokens.ownerA, body))
        .toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
    }
    expect(await call('POST', `/api/stores/${ids.storeA1}/products`, tokens.ownerA, '{"name":'))
      .toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
  })

  it.each<[Actor, number]>([
    ['ownerA', 200],
    ['staffA1', 200],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
  ])('GET /products %s → %i', async (actor, status) => {
    const res = await call('GET', `/api/stores/${ids.storeA1}/products`, tokens[actor])
    expect(res.status).toBe(status)
    if (status === 200) {
      const listed = (res.body.products as { id: string }[]).map(p => p.id)
      expect(listed).toContain(ids.productA1)
      expect(listed).not.toContain(ids.productA2)
      expect(listed).not.toContain(ids.productB)
    }
    else {
      expect(res.body).toMatchObject({ code: errorCodes[status] })
    }
  })

  it.each<[Actor, number]>([
    ['ownerA', 201],
    ['staffA1', 403],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
  ])('POST /products %s → %i', async (actor, status) => {
    const res = await call('POST', `/api/stores/${ids.storeA1}/products`, tokens[actor], { name: `Món ${actor}`, basePriceVnd: 20000 })
    expect(res.status).toBe(status)
    if (status !== 201) expect(res.body).toMatchObject({ code: errorCodes[status] })
  })

  it.each<[Actor, number]>([
    ['ownerA', 200],
    ['staffA1', 403],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
  ])('PATCH /products/:id %s → %i', async (actor, status) => {
    const res = await call('PATCH', `/api/stores/${ids.storeA1}/products/${ids.productA1}`, tokens[actor], { isAvailable: true })
    expect(res.status).toBe(status)
    if (status !== 200) expect(res.body).toMatchObject({ code: errorCodes[status] })
  })

  it('a category from another store is 404 on create and update (same org or other org)', async () => {
    for (const categoryId of [ids.categoryA2, ids.categoryB]) {
      expect(await call('POST', `/api/stores/${ids.storeA1}/products`, tokens.ownerA, { name: 'X', basePriceVnd: 1000, categoryId }))
        .toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
      expect(await call('PATCH', `/api/stores/${ids.storeA1}/products/${ids.productA1}`, tokens.ownerA, { categoryId }))
        .toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
    }
  })

  it('a product of another store is 404 and stays unchanged', async () => {
    expect(await call('PATCH', `/api/stores/${ids.storeA1}/products/${ids.productA2}`, tokens.ownerA, { name: 'Hijack' })).toMatchObject({ status: 404 })
    expect(await call('PATCH', `/api/stores/${ids.storeB}/products/${ids.productA1}`, tokens.ownerB, { name: 'Hijack' })).toMatchObject({ status: 404 })
    const list = await call('GET', `/api/stores/${ids.storeA2}/products`, tokens.ownerA)
    expect((list.body.products as { id: string, name: string }[]).find(p => p.id === ids.productA2)!.name).toBe('Món A2')
  })

  it('validates the body (negative price, blank name, unknown fields are ignored)', async () => {
    expect(await call('POST', `/api/stores/${ids.storeA1}/products`, tokens.ownerA, { name: 'A', basePriceVnd: -5 })).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
    expect(await call('POST', `/api/stores/${ids.storeA1}/products`, tokens.ownerA, { name: ' ', basePriceVnd: 5 })).toMatchObject({ status: 400 })
    const created = await call('POST', `/api/stores/${ids.storeA1}/products`, tokens.ownerA, { name: 'Có thừa', basePriceVnd: 5, orgId: ids.storeB, storeId: ids.storeB })
    expect(created.status).toBe(201)
    expect(created.body).not.toHaveProperty('orgId')
  })
})

describe('PUT /products/:id/options', () => {
  const body = { groups: [{ name: 'Size', required: true, minSelect: 1, maxSelect: 1, values: [{ name: 'M' }, { name: 'L', priceDeltaVnd: 5000 }] }] }

  it.each<[Actor, number]>([
    ['staffA1', 403],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
    ['ownerA', 200],
  ])('%s → %i', async (actor, status) => {
    const before = await call('GET', `/api/stores/${ids.storeA1}/products`, tokens.ownerA)
    const res = await call('PUT', `/api/stores/${ids.storeA1}/products/${ids.productA1}/options`, tokens[actor], body)
    expect(res.status).toBe(status)
    if (status === 200) expect(res.body.optionGroups[0]).toMatchObject({ name: 'Size', required: true, minSelect: 1 })
    else {
      expect(res.body).toMatchObject({ code: errorCodes[status] })
      expect(await call('GET', `/api/stores/${ids.storeA1}/products`, tokens.ownerA)).toEqual(before)
    }
  })

  it('staff can read the options saved by the owner', async () => {
    const res = await call('GET', `/api/stores/${ids.storeA1}/products`, tokens.staffA1)
    expect(res.status).toBe(200)
    expect((res.body.products as { id: string, optionGroups: unknown[] }[]).find(p => p.id === ids.productA1)!.optionGroups[0])
      .toMatchObject({ name: 'Size', required: true, values: [{ name: 'M', priceDeltaVnd: 0 }, { name: 'L', priceDeltaVnd: 5000 }] })
  })

  it('returns 404 for missing and malformed product ids and requires authentication', async () => {
    for (const productId of [randomUUID(), 'not-a-uuid']) {
      expect(await call('PUT', `/api/stores/${ids.storeA1}/products/${productId}/options`, tokens.ownerA, body))
        .toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
    }
    expect(await call('PUT', `/api/stores/${ids.storeA1}/products/${ids.productA1}/options`, null, body))
      .toMatchObject({ status: 401, body: { code: 'UNAUTHENTICATED' } })
  })

  it('cannot replace the options of a product that belongs to another store', async () => {
    expect(await call('PUT', `/api/stores/${ids.storeA1}/products/${ids.productA2}/options`, tokens.ownerA, body)).toMatchObject({ status: 404 })
    expect(await call('PUT', `/api/stores/${ids.storeB}/products/${ids.productA1}/options`, tokens.ownerB, body)).toMatchObject({ status: 404 })
  })

  it('rejects inconsistent groups with 400', async () => {
    const bad = { groups: [{ name: 'Topping', required: false, minSelect: 3, maxSelect: 2, values: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] }] }
    expect(await call('PUT', `/api/stores/${ids.storeA1}/products/${ids.productA1}/options`, tokens.ownerA, bad))
      .toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
  })
})

describe('fulfillment settings', () => {
  it('requires authentication for fulfillment and delivery-zone endpoints', async () => {
    expect(await call('PATCH', `/api/stores/${ids.storeA1}/fulfillment`, null, { pickupEnabled: true }))
      .toMatchObject({ status: 401, body: { code: 'UNAUTHENTICATED' } })
    expect(await call('GET', `/api/stores/${ids.storeA1}/delivery-zones`))
      .toMatchObject({ status: 401, body: { code: 'UNAUTHENTICATED' } })
    expect(await call('POST', `/api/stores/${ids.storeA1}/delivery-zones`, null, { name: 'Quận 1', feeVnd: 10000 }))
      .toMatchObject({ status: 401, body: { code: 'UNAUTHENTICATED' } })
  })

  it.each<[Actor, number]>([['staffA1', 403], ['staffA2', 404], ['disabledA1', 404], ['ownerB', 404], ['ownerA', 200]])('PATCH /fulfillment %s → %i', async (actor, status) => {
    const res = await call('PATCH', `/api/stores/${ids.storeA1}/fulfillment`, tokens[actor], { pickupEnabled: true })
    expect(res.status).toBe(status)
    if (status !== 200) expect(res.body).toMatchObject({ code: errorCodes[status] })
  })
  it('refuses to turn every mode off with 400 and keeps the previous state', async () => {
    const res = await call('PATCH', `/api/stores/${ids.storeA1}/fulfillment`, tokens.ownerA, { dineInEnabled: false, pickupEnabled: false, deliveryEnabled: false })
    expect(res).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
    const store = await call('GET', `/api/stores/${ids.storeA1}`, tokens.ownerA)
    expect([store.body.dineInEnabled, store.body.pickupEnabled, store.body.deliveryEnabled].some(Boolean)).toBe(true)
  })
})

describe('delivery zones', () => {
  it.each<[Actor, number]>([['ownerA', 200], ['staffA1', 200], ['staffA2', 404], ['disabledA1', 404], ['ownerB', 404]])('GET /delivery-zones %s → %i', async (actor, status) => {
    const res = await call('GET', `/api/stores/${ids.storeA1}/delivery-zones`, tokens[actor])
    expect(res.status).toBe(status)
    if (status === 200) expect((res.body.zones as { id: string }[]).map(z => z.id)).toEqual([ids.zoneA1])
    else expect(res.body).toMatchObject({ code: errorCodes[status] })
  })
  it.each<[Actor, number]>([['ownerA', 201], ['staffA1', 403], ['staffA2', 404], ['disabledA1', 404], ['ownerB', 404]])('POST /delivery-zones %s → %i', async (actor, status) => {
    const res = await call('POST', `/api/stores/${ids.storeA1}/delivery-zones`, tokens[actor], { name: `Khu ${actor}`, feeVnd: 12000 })
    expect(res.status).toBe(status)
    if (status !== 201) expect(res.body).toMatchObject({ code: errorCodes[status] })
  })
  it.each<[Actor, number]>([['ownerA', 200], ['staffA1', 403], ['staffA2', 404], ['disabledA1', 404], ['ownerB', 404]])('PATCH /delivery-zones/:id %s → %i', async (actor, status) => {
    const res = await call('PATCH', `/api/stores/${ids.storeA1}/delivery-zones/${ids.zoneA1}`, tokens[actor], { feeVnd: 18000 })
    expect(res.status).toBe(status)
    if (status !== 200) expect(res.body).toMatchObject({ code: errorCodes[status] })
  })
  it('a zone of another store is 404 and a negative fee is 400', async () => {
    expect(await call('PATCH', `/api/stores/${ids.storeA2}/delivery-zones/${ids.zoneA1}`, tokens.ownerA, { feeVnd: 1 })).toMatchObject({ status: 404 })
    expect(await call('PATCH', `/api/stores/${ids.storeA1}/delivery-zones/${ids.zoneA1}`, tokens.ownerA, { feeVnd: -1 })).toMatchObject({ status: 400 })
  })
})

describe('tables', () => {
  it.each<[Actor, number]>([
    ['ownerA', 200],
    ['staffA1', 200],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
  ])('GET /tables %s → %i', async (actor, status) => {
    const res = await call('GET', `/api/stores/${ids.storeA1}/tables`, tokens[actor])
    expect(res.status).toBe(status)
    if (status === 200) {
      expect(JSON.stringify(res.body)).not.toMatch(/tokenHash|token_hash|qrUrl/)
      expect(Object.keys(res.body.tables[0]).sort()).toEqual(['active', 'code', 'displayName', 'id'])
    }
    else {
      expect(res.body).toMatchObject({ code: errorCodes[status] })
    }
  })

  it.each<[Actor, number]>([
    ['ownerA', 201],
    ['staffA1', 403],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
  ])('POST /tables %s → %i', async (actor, status) => {
    const res = await call('POST', `/api/stores/${ids.storeA1}/tables`, tokens[actor], {})
    expect(res.status).toBe(status)
    if (status === 201) expect(res.body.qrUrl).toContain(`/s/${ids.storeA1Slug}?t=`)
    else expect(res.body).toMatchObject({ code: errorCodes[status] })
  })

  it.each<[Actor, number]>([
    ['staffA1', 403],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
    ['ownerA', 200],
  ])('PATCH /tables/:id %s → %i', async (actor, status) => {
    const res = await call('PATCH', `/api/stores/${ids.storeA1}/tables/${ids.tableA1}`, tokens[actor], { active: true })
    expect(res.status).toBe(status)
    if (status !== 200) expect(res.body).toMatchObject({ code: errorCodes[status] })
  })

  it.each<[Actor, number]>([
    ['staffA1', 403],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
    ['ownerA', 200],
  ])('POST /tables/:id/regenerate %s → %i', async (actor, status) => {
    const res = await call('POST', `/api/stores/${ids.storeA1}/tables/${ids.tableA1}/regenerate`, tokens[actor])
    expect(res.status).toBe(status)
    if (status === 200) expect(Object.keys(res.body).sort()).toEqual(['active', 'code', 'displayName', 'id', 'qrUrl'])
    else expect(res.body).toMatchObject({ code: errorCodes[status] })
  })

  it('a table of another store is 404 for update and regenerate', async () => {
    expect(await call('PATCH', `/api/stores/${ids.storeA2}/tables/${ids.tableA1}`, tokens.ownerA, { active: false })).toMatchObject({ status: 404 })
    expect(await call('POST', `/api/stores/${ids.storeA2}/tables/${ids.tableA1}/regenerate`, tokens.ownerA)).toMatchObject({ status: 404 })
    expect(await call('POST', `/api/stores/${ids.storeB}/tables/${ids.tableA1}/regenerate`, tokens.ownerB)).toMatchObject({ status: 404 })
  })

  it('rejects a duplicate manual code with 400', async () => {
    const first = await call('POST', `/api/stores/${ids.storeA1}/tables`, tokens.ownerA, { code: 'VIP' })
    expect(first.status).toBe(201)
    expect(await call('POST', `/api/stores/${ids.storeA1}/tables`, tokens.ownerA, { code: 'VIP' })).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
  })
})

describe('public ordering routes: identity is irrelevant, stores never leak', () => {
  beforeAll(async () => {
    await openStore(ids.storeA1, { dineInEnabled: true, pickupEnabled: true, deliveryEnabled: true })
    await openStore(ids.storeB, { dineInEnabled: true, pickupEnabled: true, deliveryEnabled: true })
    menuA = await seedMenu({ id: ids.storeA1, orgId: ids.orgA })
    const [storeB] = await getDb().select().from(stores).where(eq(stores.id, ids.storeB))
    menuB = await seedMenu(storeB!)
  })

  const callers: (Actor | 'anonymous')[] = ['anonymous', 'ownerA', 'staffA1', 'staffA2', 'disabledA1', 'ownerB']
  let ipSeq = 0
  const nextIp = () => ({ 'x-forwarded-for': `203.0.113.${(ipSeq += 1)}` })
  const placeOrder = (slug: string, body: unknown, token: string | null = null) =>
    call('POST', `/api/public/stores/${slug}/orders`, token, body, nextIp())
  const ordersIn = async (storeId: string) =>
    (await getDb().select({ n: count() }).from(orders).where(eq(orders.storeId, storeId)))[0]!.n

  it.each(callers)('%s places an order in store A1 → 201', async (caller) => {
    const res = await placeOrder(ids.storeA1Slug, pickupBody(menuA), caller === 'anonymous' ? null : tokens[caller])
    expect(res.status).toBe(201)
    expect(res.body).toHaveProperty('guestToken')
  })

  describe('tracking by token', () => {
    let tracked: { guestToken: string, publicCode: string }

    it.each(callers)('%s reads the same public view → 200', async (caller) => {
      tracked ??= (await placeOrder(ids.storeA1Slug, deliveryBody(menuA))).body
      const res = await call('GET', `/api/public/orders/${tracked.guestToken}`, caller === 'anonymous' ? null : tokens[caller])
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ publicCode: tracked.publicCode, phoneMasked: '*******678' })
      expect(JSON.stringify(res.body)).not.toContain(ids.orgA)
      expect(JSON.stringify(res.body)).not.toContain(ids.storeA1)
    })

    it.each(callers)('%s with a wrong token → 404, identical to a random token', async (caller) => {
      tracked ??= (await placeOrder(ids.storeA1Slug, deliveryBody(menuA))).body
      const token = caller === 'anonymous' ? null : tokens[caller]
      const wrong = await call('GET', `/api/public/orders/${tracked.guestToken.toUpperCase()}`, token)
      const random = await call('GET', `/api/public/orders/${randomBytes(32).toString('base64url')}`, token)
      expect(wrong).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
      expect(wrong).toEqual(random)
    })
  })

  describe('store A resources are useless in store B', () => {
    it('a table QR token of store A → 422 INVALID_TABLE, nothing stored in B', async () => {
      const before = await ordersIn(ids.storeB)
      const res = await placeOrder(ids.storeBSlug, dineInBody(menuB, { tableToken: menuA.table.token }))
      expect(res).toMatchObject({ status: 422, body: { code: 'INVALID_TABLE' } })
      expect(await ordersIn(ids.storeB)).toBe(before)
    })

    it('a delivery zone of store A → 422 INVALID_ZONE', async () => {
      const before = await ordersIn(ids.storeB)
      const res = await placeOrder(ids.storeBSlug, deliveryBody(menuB, { deliveryZoneId: menuA.zone.id }))
      expect(res).toMatchObject({ status: 422, body: { code: 'INVALID_ZONE' } })
      expect(await ordersIn(ids.storeB)).toBe(before)
    })

    it('a product of store A → 409 CART_STALE as if it did not exist', async () => {
      const before = await ordersIn(ids.storeB)
      const res = await placeOrder(ids.storeBSlug, pickupBody(menuB, { items: [teaItem(menuA)] }))
      expect(res).toMatchObject({ status: 409, body: { code: 'CART_STALE', details: { lines: [{ index: 0, reason: 'PRODUCT_UNAVAILABLE', name: null }] } } })
      expect(await ordersIn(ids.storeB)).toBe(before)
    })

    it('option values of store A on a product of store B → 409 OPTION_INVALID', async () => {
      const res = await placeOrder(ids.storeBSlug, pickupBody(menuB, { items: [teaItem(menuB, { optionValueIds: [menuA.tea.size.m.id] })] }))
      expect(res).toMatchObject({ status: 409, body: { code: 'CART_STALE', details: { lines: [{ index: 0, reason: 'OPTION_INVALID' }] } } })
    })

    it('the same idempotency key in two stores yields two independent orders', async () => {
      const key = randomUUID()
      const a = await placeOrder(ids.storeA1Slug, pickupBody(menuA, { idempotencyKey: key }))
      const b = await placeOrder(ids.storeBSlug, pickupBody(menuB, { idempotencyKey: key }))
      expect([a.status, b.status]).toEqual([201, 201])
      expect(a.body.guestToken).not.toBe(b.body.guestToken)
    })
  })
})


// ───────────────────────── PR4: owner ops ─────────────────────────
const ops = {} as { orderA1: string, orderB: string, orgB: string }

beforeAll(async () => {
  const [storeB] = await getDb().select({ orgId: stores.orgId }).from(stores).where(eq(stores.id, ids.storeB))
  ops.orgB = storeB!.orgId
  ops.orderA1 = (await createOrderRow({ id: ids.storeA1, orgId: ids.orgA }, { status: 'NEW' })).id
  ops.orderB = (await createOrderRow({ id: ids.storeB, orgId: ops.orgB }, { status: 'NEW' })).id
})

const freshOrder = (overrides: Parameters<typeof createOrderRow>[1] = {}) =>
  createOrderRow({ id: ids.storeA1, orgId: ids.orgA }, overrides)
const orderStatusOf = async (orderId: string) =>
  (await call('GET', `/api/stores/${ids.storeA1}/orders/${orderId}`, tokens.ownerA)).body.order as { status: string, paymentStatus: string }

const staffSees: [Actor, number][] = [['ownerA', 200], ['staffA1', 200], ['staffA2', 404], ['disabledA1', 404], ['ownerB', 404]]

describe('GET /api/stores/:storeId/orders', () => {
  it('without token → 401', async () => {
    expect(await call('GET', `/api/stores/${ids.storeA1}/orders?tab=new`, null)).toMatchObject({ status: 401, body: { code: 'UNAUTHENTICATED' } })
  })

  it.each(staffSees)('%s → %i', async (actor, status) => {
    const res = await call('GET', `/api/stores/${ids.storeA1}/orders?tab=new`, tokens[actor])
    expect(res.status).toBe(status)
    if (status === 200) {
      const listed = (res.body.orders as { id: string }[]).map(o => o.id)
      expect(listed).toContain(ops.orderA1)
      expect(listed).not.toContain(ops.orderB)
      expect(JSON.stringify(res.body)).not.toMatch(/guestToken|idempotencyKey/i)
    }
    else {
      expect(res.body).toMatchObject({ code: errorCodes[status] })
    }
  })

  it('treats another tenant\'s real store exactly like a random id', async () => {
    const real = await call('GET', `/api/stores/${ids.storeA1}/orders?tab=new`, tokens.ownerB)
    const random = await call('GET', `/api/stores/${randomUUID()}/orders?tab=new`, tokens.ownerB)
    expect(real).toEqual(random)
  })

  it.each(['/orders', '/orders?tab=zzz', '/orders?tab=new&cursor=@@@', '/orders?tab=new&limit=0'])('%s → 400', async (suffix) => {
    const res = await call('GET', `/api/stores/${ids.storeA1}${suffix}`, tokens.ownerA)
    expect(res).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
  })
})

describe('GET /api/stores/:storeId/orders/:orderId', () => {
  it.each(staffSees)('%s → %i', async (actor, status) => {
    const res = await call('GET', `/api/stores/${ids.storeA1}/orders/${ops.orderA1}`, tokens[actor])
    expect(res.status).toBe(status)
    if (status === 200) expect(res.body).toMatchObject({ order: { id: ops.orderA1 }, events: [], payment: null })
    else expect(res.body).toMatchObject({ code: errorCodes[status] })
  })

  it('another store\'s order via my store path is 404, identical to a random id', async () => {
    const foreign = await call('GET', `/api/stores/${ids.storeA1}/orders/${ops.orderB}`, tokens.ownerA)
    const random = await call('GET', `/api/stores/${ids.storeA1}/orders/${randomUUID()}`, tokens.ownerA)
    expect(foreign).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
    expect(foreign).toEqual(random)
  })

  it('a non-uuid order id is 404, not 400/500', async () => {
    expect(await call('GET', `/api/stores/${ids.storeA1}/orders/not-a-uuid`, tokens.ownerA)).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
  })
})

describe('PATCH /api/stores/:storeId/orders/:orderId/status', () => {
  const patch = (actor: Actor | null, orderId: string, body: unknown, storeId = ids.storeA1) =>
    call('PATCH', `/api/stores/${storeId}/orders/${orderId}/status`, actor ? tokens[actor] : null, body)
  const advance = { expectedStatus: 'NEW', nextStatus: 'PREPARING' }

  it('without token → 401', async () => {
    expect(await patch(null, ops.orderA1, advance)).toMatchObject({ status: 401, body: { code: 'UNAUTHENTICATED' } })
  })

  it.each<[Actor, number]>([['ownerA', 200], ['staffA1', 200], ['staffA2', 404], ['disabledA1', 404], ['ownerB', 404]])(
    '%s → %i',
    async (actor, status) => {
      const order = await freshOrder()
      const res = await patch(actor, order.id, advance)
      expect(res.status).toBe(status)
      if (status === 200) {
        expect(res.body).toMatchObject({ id: order.id, status: 'PREPARING' })
      }
      else {
        expect(res.body).toMatchObject({ code: errorCodes[status] })
        expect((await orderStatusOf(order.id)).status).toBe('NEW')
      }
    },
  )

  it('another store\'s order through my store path → 404 and unchanged', async () => {
    const res = await patch('ownerA', ops.orderB, advance)
    expect(res).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
  })

  it('stale expectedStatus → 409 STATUS_CONFLICT with the current status', async () => {
    const order = await freshOrder({ status: 'PREPARING' })
    expect(await patch('staffA1', order.id, advance)).toMatchObject({
      status: 409,
      body: { code: 'STATUS_CONFLICT', details: { currentStatus: 'PREPARING' } },
    })
  })

  it.each([
    [{ expectedStatus: 'NEW', nextStatus: 'COMPLETED' }, 400],
    [{ expectedStatus: 'NEW', nextStatus: 'CANCELLED' }, 400],
    [{ expectedStatus: 'NEW', nextStatus: 'NEW' }, 400],
    [{ expectedStatus: 'NEW' }, 400],
    [{ expectedStatus: 'BOGUS', nextStatus: 'READY' }, 400],
  ])('invalid body %j → %i', async (body, status) => {
    const order = await freshOrder()
    expect(await patch('ownerA', order.id, body)).toMatchObject({ status, body: { code: 'VALIDATION_FAILED' } })
  })

  it('a non-uuid order id → 404', async () => {
    expect(await patch('ownerA', 'not-a-uuid', advance)).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
  })
})

describe('POST /api/stores/:storeId/orders/:orderId/cancel', () => {
  const cancel = (actor: Actor | null, orderId: string, body: unknown) =>
    call('POST', `/api/stores/${ids.storeA1}/orders/${orderId}/cancel`, actor ? tokens[actor] : null, body)
  const unpaidBody = { expectedStatus: 'NEW', reason: 'Khách đổi ý' }

  it('without token → 401', async () => {
    expect(await cancel(null, ops.orderA1, unpaidBody)).toMatchObject({ status: 401 })
  })

  it.each<[Actor, number]>([['ownerA', 200], ['staffA1', 200], ['staffA2', 404], ['disabledA1', 404], ['ownerB', 404]])(
    'unpaid order, %s → %i',
    async (actor, status) => {
      const order = await freshOrder()
      const res = await cancel(actor, order.id, unpaidBody)
      expect(res.status).toBe(status)
      if (status === 200) expect(res.body).toMatchObject({ status: 'CANCELLED', paymentStatus: 'UNPAID' })
      else expect((await orderStatusOf(order.id)).status).toBe('NEW')
    },
  )

  it('paid order: staff → 403 and unchanged; owner → 200 REFUND_DUE', async () => {
    const order = await freshOrder({ paymentStatus: 'PAID' })
    expect(await cancel('staffA1', order.id, unpaidBody)).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } })
    expect(await orderStatusOf(order.id)).toMatchObject({ status: 'NEW', paymentStatus: 'PAID' })
    expect(await cancel('ownerA', order.id, unpaidBody)).toMatchObject({ status: 200, body: { status: 'CANCELLED', paymentStatus: 'REFUND_DUE' } })
  })

  it('another store\'s order → 404', async () => {
    expect(await cancel('ownerA', ops.orderB, unpaidBody)).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
  })

  it.each([{ expectedStatus: 'NEW' }, { expectedStatus: 'NEW', reason: ' ' }, { expectedStatus: 'NEW', reason: 'x'.repeat(201) }])(
    'invalid body %j → 400',
    async (body) => {
      const order = await freshOrder()
      expect(await cancel('ownerA', order.id, body)).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
    },
  )

  it('stale expectedStatus → 409', async () => {
    const order = await freshOrder({ status: 'PREPARING' })
    expect(await cancel('ownerA', order.id, unpaidBody)).toMatchObject({ status: 409, body: { code: 'STATUS_CONFLICT' } })
  })
})

describe('POST /api/stores/:storeId/orders/:orderId/mark-paid', () => {
  const markPaid = (actor: Actor | null, orderId: string, body: unknown = { expectedPaymentStatus: 'UNPAID', method: 'CASH' }) =>
    call('POST', `/api/stores/${ids.storeA1}/orders/${orderId}/mark-paid`, actor ? tokens[actor] : null, body)

  it('without token → 401', async () => {
    expect(await markPaid(null, ops.orderA1)).toMatchObject({ status: 401 })
  })

  it.each<[Actor, number]>([['ownerA', 200], ['staffA1', 200], ['staffA2', 404], ['disabledA1', 404], ['ownerB', 404]])(
    '%s → %i',
    async (actor, status) => {
      const order = await freshOrder()
      const res = await markPaid(actor, order.id)
      expect(res.status).toBe(status)
      if (status === 200) expect(res.body).toMatchObject({ paymentStatus: 'PAID' })
      else expect((await orderStatusOf(order.id)).paymentStatus).toBe('UNPAID')
    },
  )

  it('second call → 409', async () => {
    const order = await freshOrder()
    expect((await markPaid('staffA1', order.id)).status).toBe(200)
    expect(await markPaid('staffA1', order.id)).toMatchObject({ status: 409, body: { code: 'STATUS_CONFLICT' } })
  })

  it('another store\'s order → 404', async () => {
    expect(await markPaid('ownerA', ops.orderB)).toMatchObject({ status: 404 })
  })

  it.each([{ expectedPaymentStatus: 'UNPAID', method: 'BANK_MANUAL' }, { expectedPaymentStatus: 'UNPAID' }, { method: 'CASH' }])(
    'rejects %j with 400 (BANK_MANUAL is owner-only in PR6)',
    async (body) => {
      const order = await freshOrder()
      expect(await markPaid('ownerA', order.id, body)).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
    },
  )
})

describe('team endpoints (owner only)', () => {
  const team = (actor: Actor | null, method: string, suffix = '', body?: unknown, storeId = ids.storeA1) =>
    call(method, `/api/stores/${storeId}/team${suffix}`, actor ? tokens[actor] : null, body)

  it('without token → 401', async () => {
    expect(await team(null, 'GET')).toMatchObject({ status: 401 })
  })

  it.each<[Actor, number]>([['ownerA', 200], ['staffA1', 403], ['staffA2', 404], ['disabledA1', 404], ['ownerB', 404]])(
    'GET team %s → %i',
    async (actor, status) => {
      const res = await team(actor, 'GET')
      expect(res.status).toBe(status)
      if (status === 200) {
        expect(res.body.members.length).toBeGreaterThan(0)
        expect(JSON.stringify(res.body)).not.toMatch(/tokenHash|token_hash|inviteUrl/)
      }
      else {
        expect(res.body).toMatchObject({ code: errorCodes[status] })
      }
    },
  )

  it.each<[Actor, number]>([['staffA1', 403], ['staffA2', 404], ['disabledA1', 404], ['ownerB', 404], ['ownerA', 201]])(
    'POST invitations %s → %i',
    async (actor, status) => {
      const email = `invite-${actor}-${Date.now()}@example.com`
      const res = await team(actor, 'POST', '/invitations', { email })
      expect(res.status).toBe(status)
      if (status === 201) {
        expect(res.body.inviteUrl).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/)
        expect(res.body.invitation).toMatchObject({ email: email.toLowerCase(), expired: false })
      }
      else {
        const listed = await team('ownerA', 'GET')
        expect((listed.body.invitations as { email: string }[]).map(i => i.email)).not.toContain(email.toLowerCase())
      }
    },
  )

  it.each(['', 'not-an-email', 'a@'])('POST invitations rejects email %j → 400', async (email) => {
    expect(await team('ownerA', 'POST', '/invitations', { email })).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
  })

  it('PATCH member: staff → 403, other tenant → 404, owner disables then re-enables (and access follows immediately)', async () => {
    const victim = await addStaff({ id: ids.storeA1, orgId: ids.orgA })
    const victimToken = await auth.sign({ sub: victim.userId, email: victim.email })
    const patch = (actor: Actor, status: string) => team(actor, 'PATCH', `/${victim.userId}`, { status })

    expect((await patch('staffA1', 'DISABLED')).status).toBe(403)
    expect((await patch('staffA2', 'DISABLED')).status).toBe(404)
    expect((await patch('ownerB', 'DISABLED')).status).toBe(404)
    expect((await call('GET', `/api/stores/${ids.storeA1}`, victimToken)).status).toBe(200)

    expect(await patch('ownerA', 'DISABLED')).toMatchObject({ status: 200, body: { ok: true } })
    expect(await call('GET', `/api/stores/${ids.storeA1}`, victimToken)).toMatchObject({ status: 404 })
    expect(await patch('ownerA', 'ACTIVE')).toMatchObject({ status: 200 })
    expect((await call('GET', `/api/stores/${ids.storeA1}`, victimToken)).status).toBe(200)
  })

  it('PATCH an unknown member → 404; invalid status → 400', async () => {
    expect(await team('ownerA', 'PATCH', `/user_${randomUUID()}`, { status: 'DISABLED' })).toMatchObject({ status: 404 })
    expect(await team('ownerA', 'PATCH', `/${randomUUID()}`, { status: 'BOGUS' })).toMatchObject({ status: 400 })
  })

  it('DELETE invitation: staff → 403, other tenant → 404, owner → 200, repeat → 404', async () => {
    const created = await team('ownerA', 'POST', '/invitations', { email: `revoke-${Date.now()}@example.com` })
    const id = created.body.invitation.id as string
    expect((await team('staffA1', 'DELETE', `/invitations/${id}`)).status).toBe(403)
    expect((await team('ownerB', 'DELETE', `/invitations/${id}`)).status).toBe(404)
    expect((await team('ownerA', 'DELETE', `/invitations/${id}`)).status).toBe(200)
    expect((await team('ownerA', 'DELETE', `/invitations/${id}`)).status).toBe(404)
    expect((await team('ownerA', 'DELETE', '/invitations/not-a-uuid')).status).toBe(404)
  })
})

describe('invitations (accept flow)', () => {
  async function invite(email: string): Promise<string> {
    const res = await call('POST', `/api/stores/${ids.storeA1}/team/invitations`, tokens.ownerA, { email })
    expect(res.status).toBe(201)
    return (res.body.inviteUrl as string).split('/').pop()!
  }
  const sign = (user: { userId: string, email: string }, emailVerified: boolean) => auth.sign({ sub: user.userId, email: user.email, emailVerified })

  it('GET/POST without a login → 401', async () => {
    const token = await invite(`anon-${Date.now()}@example.com`)
    expect((await call('GET', `/api/invitations/${token}`, null)).status).toBe(401)
    expect((await call('POST', `/api/invitations/${token}/accept`, null)).status).toBe(401)
  })

  it('unknown or malformed token → 404', async () => {
    expect(await call('GET', '/api/invitations/nope', tokens.ownerB)).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
    expect(await call('POST', `/api/invitations/${'z'.repeat(43)}/accept`, tokens.ownerB)).toMatchObject({ status: 404 })
  })

  it('wrong email → 403 without burning the token; right + verified email → 200; reuse → 404', async () => {
    const email = `flow-${Date.now()}@example.com`
    const token = await invite(email)
    const stranger = await createUser()
    const invitee = await createUser({ email })

    expect(await call('GET', `/api/invitations/${token}`, await sign(stranger, true))).toMatchObject({
      status: 200,
      body: { emailMatches: false, storeName: expect.any(String) },
    })
    expect(await call('POST', `/api/invitations/${token}/accept`, await sign(stranger, true))).toMatchObject({
      status: 403,
      body: { code: 'FORBIDDEN', details: { reason: 'EMAIL_MISMATCH' } },
    })
    expect(await call('POST', `/api/invitations/${token}/accept`, await sign(invitee, false))).toMatchObject({
      status: 403,
      body: { details: { reason: 'EMAIL_NOT_VERIFIED' } },
    })

    const inviteeToken = await sign(invitee, true)
    expect(await call('GET', `/api/stores/${ids.storeA1}`, inviteeToken)).toMatchObject({ status: 404 })
    const ok = await call('POST', `/api/invitations/${token}/accept`, inviteeToken)
    expect(ok).toMatchObject({ status: 200, body: { store: { id: ids.storeA1, role: 'STAFF' } } })
    expect(await call('GET', `/api/stores/${ids.storeA1}`, inviteeToken)).toMatchObject({ status: 200, body: { role: 'STAFF' } })
    expect(await call('GET', `/api/stores/${ids.storeA2}`, inviteeToken)).toMatchObject({ status: 404 })
    expect(await call('POST', `/api/invitations/${token}/accept`, inviteeToken)).toMatchObject({ status: 404 })
  })

  it('an invitation never exposes the full email to a non-matching caller', async () => {
    const email = `hint-${Date.now()}@example.com`
    const token = await invite(email)
    const res = await call('GET', `/api/invitations/${token}`, tokens.ownerB)
    expect(res.status).toBe(200)
    expect(JSON.stringify(res.body)).not.toContain(email)
    expect(res.body.emailHint).toMatch(/^h\*\*\*@example\.com$/)
  })
})

describe('GET /api/stores/:storeId/summary', () => {
  const summary = (actor: Actor | null, query = '', storeId = ids.storeA1) =>
    call('GET', `/api/stores/${storeId}/summary${query}`, actor ? tokens[actor] : null)

  it('without token → 401', async () => {
    expect((await summary(null)).status).toBe(401)
  })

  it.each<[Actor, number]>([['ownerA', 200], ['staffA1', 200], ['staffA2', 404], ['disabledA1', 404], ['ownerB', 404]])(
    '%s → %i',
    async (actor, status) => {
      const res = await summary(actor, '?date=2026-10-31')
      expect(res.status).toBe(status)
      if (status === 200) expect(res.body).toMatchObject({ date: '2026-10-31', totalOrders: expect.any(Number), collected: { CASH: expect.any(Number) } })
      else expect(res.body).toMatchObject({ code: errorCodes[status] })
    },
  )

  it.each(['?date=2026-02-30', '?date=31-10-2026', '?date='])('%s → 400', async (query) => {
    expect(await summary('ownerA', query)).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
  })

  it('defaults to today when no date is given', async () => {
    const res = await summary('staffA1')
    expect(res.status).toBe(200)
    expect(res.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('GET /api/stores/:storeId/reports (owner only)', () => {
  const reports = (actor: Actor | null, query = '?range=7d') => call('GET', `/api/stores/${ids.storeA1}/reports${query}`, actor ? tokens[actor] : null)

  it('without token → 401', async () => {
    expect((await reports(null)).status).toBe(401)
  })

  it.each<[Actor, number]>([['ownerA', 200], ['staffA1', 403], ['staffA2', 404], ['disabledA1', 404], ['ownerB', 404]])(
    '%s → %i',
    async (actor, status) => {
      const res = await reports(actor)
      expect(res.status).toBe(status)
      if (status === 200) expect(res.body).toMatchObject({ range: '7d', daily: expect.any(Array), topProducts: expect.any(Array) })
      else expect(res.body).toMatchObject({ code: errorCodes[status] })
    },
  )

  it('rejects an unknown range with 400', async () => {
    expect(await reports('ownerA', '?range=90d')).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
  })
})

describe('PR4 remaining authentication and full team mutation matrix', () => {
  it('requires a token for order detail and every team mutation', async () => {
    const paths: [string, string, unknown?][] = [
      ['GET', `/api/stores/${ids.storeA1}/orders/${ops.orderA1}`],
      ['POST', `/api/stores/${ids.storeA1}/team/invitations`, { email: 'anonymous@example.com' }],
      ['PATCH', `/api/stores/${ids.storeA1}/team/unknown`, { status: 'DISABLED' }],
      ['DELETE', `/api/stores/${ids.storeA1}/team/invitations/${randomUUID()}`],
    ]
    for (const [method, path, body] of paths) {
      expect(await call(method, path, null, body)).toMatchObject({ status: 401, body: { code: 'UNAUTHENTICATED' } })
    }
  })

  const matrix: [Actor, number][] = [['ownerA', 200], ['staffA1', 403], ['staffA2', 404], ['disabledA1', 404], ['ownerB', 404]]

  it.each(matrix)('PATCH member %s → %i', async (actor, status) => {
    const member = await addStaff({ id: ids.storeA1, orgId: ids.orgA })
    const result = await call('PATCH', `/api/stores/${ids.storeA1}/team/${member.userId}`, tokens[actor], { status: 'DISABLED' })
    expect(result.status).toBe(status)
    if (status !== 200) expect(result.body).toMatchObject({ code: errorCodes[status] })
  })

  it.each(matrix)('DELETE invitation %s → %i', async (actor, status) => {
    const created = await call('POST', `/api/stores/${ids.storeA1}/team/invitations`, tokens.ownerA, { email: `matrix-${randomUUID()}@example.com` })
    expect(created.status).toBe(201)
    const result = await call('DELETE', `/api/stores/${ids.storeA1}/team/invitations/${created.body.invitation.id}`, tokens[actor])
    expect(result.status).toBe(status)
    if (status !== 200) expect(result.body).toMatchObject({ code: errorCodes[status] })
  })
})
