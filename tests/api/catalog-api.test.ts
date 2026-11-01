import { fileURLToPath } from 'node:url'
import { setup } from '@nuxt/test-utils/e2e'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { stores } from '../../server/db/schema'
import { createTestAuth } from '../support/auth'
import { resetDb } from '../support/db'
import { addStaff, createCategory, createOptionGroup, createProduct, createTenant } from '../support/fixtures'
import { call } from '../support/http'
import { findForbiddenKeys } from '../support/json'

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
  ownerToken: string
  staffToken: string
  otherStoreId: string
  otherOwnerToken: string
}

beforeAll(async () => {
  await resetDb()
  const a = await createTenant('pub-a')
  const b = await createTenant('pub-b')
  const staff = await addStaff(a.store)
  const category = await createCategory(a.store, 'Trà sữa')
  const product = await createProduct(a.store, { name: 'Trà sữa trân châu', basePriceVnd: 35000, categoryId: category.id })
  await createOptionGroup(a.store, product, { name: 'Size', required: true })
  const sign = (user: { userId: string, email: string }) => auth.sign({ sub: user.userId, email: user.email })
  Object.assign(seed, {
    slug: a.store.slug,
    storeId: a.store.id,
    orgId: a.org.id,
    ownerToken: await sign(a.owner),
    staffToken: await sign(staff),
    otherStoreId: b.store.id,
    otherOwnerToken: await sign(b.owner),
  })
})

afterAll(async () => {
  await closeDb()
})

describe('GET /api/public/stores/:slug/menu', () => {
  it('serves the menu anonymously with public cache headers', async () => {
    const res = await call('GET', `/api/public/stores/${seed.slug}/menu`)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=30, s-maxage=60')
    expect(res.body.store).toEqual({ name: 'Store pub-a', slug: seed.slug, isAcceptingOrders: false, logoUrl: null })
    expect(res.body.modes).toEqual({ dineIn: true, pickup: true, delivery: { enabled: false, available: false } })
    expect(res.body.products).toHaveLength(1)
    expect(res.body.products[0]).toMatchObject({ name: 'Trà sữa trân châu', basePriceVnd: 35000, isAvailable: true })
    expect(res.body.products[0].optionGroups[0]).toMatchObject({ name: 'Size', required: true })
  })

  it('does not leak internal or tenant fields', async () => {
    const res = await call('GET', `/api/public/stores/${seed.slug}/menu`)
    expect(findForbiddenKeys(res.body)).toEqual([])
    const json = JSON.stringify(res.body)
    expect(json).not.toContain(seed.orgId)
    expect(json).not.toContain(seed.storeId)
  })

  it('resolves an upper-case slug', async () => {
    const res = await call('GET', `/api/public/stores/${seed.slug.toUpperCase()}/menu`)
    expect(res.status).toBe(200)
    expect(res.body.store.slug).toBe(seed.slug)
  })

  it.each([
    ['unknown', 'khong-ton-tai'],
    ['500 characters', 'a'.repeat(500)],
    ['non-ascii', encodeURIComponent('không-có')],
  ])('returns a clean 404 for a %s slug and never caches it', async (_label, slug) => {
    const res = await call('GET', `/api/public/stores/${slug}/menu`)
    expect(res).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
    expect(res.headers.get('cache-control') ?? '').not.toContain('public')
  })

  it('returns the same 404 for a suspended store', async () => {
    await getDb().update(stores).set({ status: 'SUSPENDED' }).where(eq(stores.id, seed.storeId))
    const suspended = await call('GET', `/api/public/stores/${seed.slug}/menu`)
    await getDb().update(stores).set({ status: 'ACTIVE' }).where(eq(stores.id, seed.storeId))
    const missing = await call('GET', '/api/public/stores/khong-ton-tai/menu')
    expect(suspended.status).toBe(404)
    expect(suspended.body).toEqual(missing.body)
  })
})
