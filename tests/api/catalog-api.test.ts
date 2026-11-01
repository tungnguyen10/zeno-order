import { fileURLToPath } from 'node:url'
import { setup } from '@nuxt/test-utils/e2e'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { products, stores } from '../../server/db/schema'
import { deleteObject, PRODUCT_IMAGES_BUCKET } from '../../server/services/storage'
import { createTestAuth } from '../support/auth'
import { resetDb } from '../support/db'
import { addStaff, createCategory, createOptionGroup, createProduct, createTenant } from '../support/fixtures'
import { call, callForm } from '../support/http'
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
  productId: string
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
    productId: product.id,
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

describe('GET /api/public/stores/:slug/fulfillment', () => {
  const url = (query = '') => `/api/public/stores/${seed.slug}/fulfillment${query}`
  const tokenOf = (qrUrl: string) => new URL(qrUrl).searchParams.get('t')!

  it('is never cached, has no table without ?t= and leaks nothing', async () => {
    const res = await call('GET', url())
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.body).toMatchObject({ table: null, tableError: null, modes: { dineIn: true, pickup: true } })
    expect(findForbiddenKeys(res.body)).toEqual([])
    expect(JSON.stringify(res.body)).not.toContain(seed.orgId)
  })

  it('binds a valid QR to its table, and the old QR dies right after regenerate', async () => {
    const created = await call('POST', `/api/stores/${seed.storeId}/tables`, seed.ownerToken, { code: 'F1', displayName: 'Bàn 05' })
    expect(created.status).toBe(201)
    const oldToken = tokenOf(created.body.qrUrl)
    expect((await call('GET', url(`?t=${oldToken}`))).body).toMatchObject({ table: { displayName: 'Bàn 05' }, tableError: null })

    const renewed = await call('POST', `/api/stores/${seed.storeId}/tables/${created.body.id}/regenerate`, seed.ownerToken)
    expect(renewed.status).toBe(200)
    expect((await call('GET', url(`?t=${oldToken}`))).body).toMatchObject({ table: null, tableError: 'INVALID_TABLE' })
    expect((await call('GET', url(`?t=${tokenOf(renewed.body.qrUrl)}`))).body).toMatchObject({ table: { displayName: 'Bàn 05' }, tableError: null })

    await call('PATCH', `/api/stores/${seed.storeId}/tables/${created.body.id}`, seed.ownerToken, { active: false })
    expect((await call('GET', url(`?t=${tokenOf(renewed.body.qrUrl)}`))).body).toMatchObject({ tableError: 'INVALID_TABLE' })
  })

  it.each([['empty', '?t='], ['repeated', '?t=a&t=b'], ['garbage', '?t=khong-phai-qr'], ['too long', `?t=${'x'.repeat(500)}`]])(
    'reports INVALID_TABLE for a %s token',
    async (_label, query) => {
      const res = await call('GET', url(query))
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ table: null, tableError: 'INVALID_TABLE' })
    },
  )

  it('keeps delivery unavailable until an active zone exists, then lists only that zone', async () => {
    await call('PATCH', `/api/stores/${seed.storeId}/fulfillment`, seed.ownerToken, { deliveryEnabled: true })
    expect((await call('GET', url())).body.modes.delivery).toEqual({ enabled: true, available: false })
    expect((await call('GET', `/api/public/stores/${seed.slug}/menu`)).body.modes.delivery).toEqual({ enabled: true, available: false })

    const zone = await call('POST', `/api/stores/${seed.storeId}/delivery-zones`, seed.ownerToken, { name: 'Quận 1', feeVnd: 15000 })
    expect(zone.status).toBe(201)
    const res = await call('GET', url())
    expect(res.body.modes.delivery).toEqual({ enabled: true, available: true })
    expect(res.body.deliveryZones).toEqual([{ id: zone.body.id, name: 'Quận 1', feeVnd: 15000 }])
  })

  it.each([['unknown', 'khong-ton-tai'], ['500 characters', 'a'.repeat(500)]])('returns 404 for a %s slug', async (_label, slug) => {
    expect(await call('GET', `/api/public/stores/${slug}/fulfillment`)).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
  })
})

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

function imageForm(bytes: Uint8Array, filename: string, type: string, field = 'file') {
  const form = new FormData()
  form.append(field, new Blob([bytes], { type }), filename)
  return form
}

const imageKeyInDb = async () =>
  (await getDb().select({ key: products.imageKey }).from(products).where(and(eq(products.id, seed.productId), eq(products.orgId, seed.orgId), eq(products.storeId, seed.storeId))))[0]!.key

describe('POST /api/stores/:id/products/:productId/image', () => {
  const path = () => `/api/stores/${seed.storeId}/products/${seed.productId}/image`

  it('stores a valid image, serves it publicly and exposes it in the public menu', async () => {
    try {
      const res = await callForm('POST', path(), seed.ownerToken, imageForm(PNG_1X1, 'tra-sua.png', 'image/png'))
      expect(res.status).toBe(200)
      expect(res.body.imageUrl).toMatch(/\.png$/)

      const served = await fetch(res.body.imageUrl)
      expect(served.status).toBe(200)
      expect(new Uint8Array(await served.arrayBuffer())).toEqual(new Uint8Array(PNG_1X1))
      const menu = await call('GET', `/api/public/stores/${seed.slug}/menu`)
      expect(menu.body.products.find((p: { id: string }) => p.id === seed.productId).imageUrl).toBe(res.body.imageUrl)
    }
    finally {
      const key = await imageKeyInDb()
      if (key) await deleteObject(PRODUCT_IMAGES_BUCKET, key)
      await getDb().update(products).set({ imageKey: null }).where(and(eq(products.id, seed.productId), eq(products.orgId, seed.orgId), eq(products.storeId, seed.storeId)))
    }
  })

  it('rejects a text file renamed .png even when it claims image/png', async () => {
    const fake = Buffer.from('not really an image')
    const res = await callForm('POST', path(), seed.ownerToken, imageForm(fake, 'evil.png', 'image/png'))
    expect(res).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
    expect(await imageKeyInDb()).toBeNull()
  })

  it('rejects a real PNG declared as image/jpeg', async () => {
    const res = await callForm('POST', path(), seed.ownerToken, imageForm(PNG_1X1, 'a.jpg', 'image/jpeg'))
    expect(res).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
    expect(await imageKeyInDb()).toBeNull()
  })

  it('rejects a request without a file field', async () => {
    const res = await callForm('POST', path(), seed.ownerToken, imageForm(PNG_1X1, 'a.png', 'image/png', 'other'))
    expect(res).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
  })

  it.each([2 * 1024 * 1024 + 1, 3 * 1024 * 1024])('rejects a %i byte file', async (size) => {
    const big = new Uint8Array(size)
    big.set(PNG_1X1)
    const res = await callForm('POST', path(), seed.ownerToken, imageForm(big, 'big.png', 'image/png'))
    expect(res).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
    expect(await imageKeyInDb()).toBeNull()
  })

  it('only the owner of that store can upload', async () => {
    expect((await callForm('POST', path(), null, imageForm(PNG_1X1, 'a.png', 'image/png'))).status).toBe(401)
    expect((await callForm('POST', path(), seed.staffToken, imageForm(PNG_1X1, 'a.png', 'image/png'))).status).toBe(403)
    expect((await callForm('POST', path(), seed.otherOwnerToken, imageForm(PNG_1X1, 'a.png', 'image/png'))).status).toBe(404)
    expect(await imageKeyInDb()).toBeNull()
  })
})
