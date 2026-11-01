import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { fetch, setup } from '@nuxt/test-utils/e2e'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { stores } from '../../server/db/schema'
import { createTestAuth } from '../support/auth'
import { resetDb } from '../support/db'
import { addStaff, createCategory, createProduct, createStore, createTable, createTenant, createUser, createZone } from '../support/fixtures'

const auth = await createTestAuth()
process.env.AUTH_TEST_JWKS = auth.jwksJson

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
  categoryA1: string
  categoryA2: string
  categoryB: string
  productA1: string
  productA2: string
  productB: string
  tableA1: string
  zoneA1: string
}

async function call(method: string, path: string, token?: string | null, body?: unknown) {
  const headers: Record<string, string> = {}
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
