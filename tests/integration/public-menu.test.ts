import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { organizations, stores } from '../../server/db/schema'
import { loadProductDTOs } from '../../server/services/catalog/product-view'
import { getPublicMenu } from '../../server/services/catalog/public-menu'
import { resetDb } from '../support/db'
import { createCategory, createOptionGroup, createProduct, createTenant, createZone } from '../support/fixtures'
import { findForbiddenKeys } from '../support/json'

const db = () => getDb()

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('getPublicMenu — store resolution', () => {
  it('returns NOT_FOUND for unknown, empty, oversized and path-like slugs', async () => {
    for (const slug of ['khong-ton-tai', '', 'a'.repeat(500), '../etc/passwd', 'khong có']) {
      await expect(getPublicMenu(db(), slug)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    }
  })

  it('treats suspended stores and stores of suspended organizations exactly like missing ones', async () => {
    const t = await createTenant('susp')
    await db().update(stores).set({ status: 'SUSPENDED' }).where(eq(stores.id, t.store.id))
    await expect(getPublicMenu(db(), t.store.slug)).rejects.toMatchObject({ code: 'NOT_FOUND' })

    await db().update(stores).set({ status: 'ACTIVE' }).where(eq(stores.id, t.store.id))
    await expect(getPublicMenu(db(), t.store.slug)).resolves.toBeTruthy()
    await db().update(organizations).set({ status: 'SUSPENDED' }).where(eq(organizations.id, t.org.id))
    await expect(getPublicMenu(db(), t.store.slug)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('resolves an upper-case slug of an existing store', async () => {
    const t = await createTenant('case')
    const menu = await getPublicMenu(db(), t.store.slug.toUpperCase())
    expect(menu.store.slug).toBe(t.store.slug)
  })
})

describe('getPublicMenu — content', () => {
  it('returns an empty menu for a fresh store', async () => {
    const t = await createTenant('empty')
    expect(await getPublicMenu(db(), t.store.slug)).toEqual({
      store: { name: t.store.name, slug: t.store.slug, isAcceptingOrders: false, logoUrl: null },
      modes: { dineIn: true, pickup: true, delivery: { enabled: false, available: false } },
      categories: [],
      products: [],
    })
  })

  it('hides inactive products/categories and the products of an inactive category, keeps unavailable ones flagged', async () => {
    const t = await createTenant('hide')
    const tea = await createCategory(t.store, 'Trà sữa', { position: 1 })
    const hidden = await createCategory(t.store, 'Ẩn', { active: false })
    await createProduct(t.store, { name: 'Trà đào', categoryId: tea.id, position: 2 })
    await createProduct(t.store, { name: 'Trà sữa', categoryId: tea.id, position: 1 })
    await createProduct(t.store, { name: 'Món tắt', active: false })
    await createProduct(t.store, { name: 'Món của danh mục ẩn', categoryId: hidden.id })
    await createProduct(t.store, { name: 'Hết hàng', isAvailable: false, position: 3 })

    const menu = await getPublicMenu(db(), t.store.slug)
    expect(menu.categories.map(c => c.name)).toEqual(['Trà sữa'])
    expect(menu.products.map(p => [p.name, p.isAvailable])).toEqual([['Trà sữa', true], ['Trà đào', true], ['Hết hàng', false]])
    expect(menu.products.find(p => p.name === 'Hết hàng')!.categoryId).toBeNull()
  })

  it('returns only active option values, in order', async () => {
    const t = await createTenant('opts')
    const product = await createProduct(t.store, { name: 'Trà sữa' })
    await createOptionGroup(t.store, product, {
      name: 'Size',
      required: true,
      values: [{ name: 'M' }, { name: 'L', priceDeltaVnd: 5000 }, { name: 'XL', active: false }],
    })
    await createOptionGroup(t.store, product, { name: 'Topping', maxSelect: 2, position: 1, values: [{ name: 'Trân châu', priceDeltaVnd: 5000 }] })

    const [item] = (await getPublicMenu(db(), t.store.slug)).products
    expect(item!.optionGroups.map(g => g.name)).toEqual(['Size', 'Topping'])
    expect(item!.optionGroups[0]).toMatchObject({ required: true, minSelect: 1, maxSelect: 1 })
    expect(item!.optionGroups[0]!.values.map(v => [v.name, v.priceDeltaVnd])).toEqual([['M', 0], ['L', 5000]])
  })

  it('marks a product unavailable when a required group has no active value left', async () => {
    const t = await createTenant('stuck')
    const product = await createProduct(t.store, { name: 'Cà phê' })
    await createOptionGroup(t.store, product, { required: true, values: [{ name: 'M', active: false }] })
    const [item] = (await getPublicMenu(db(), t.store.slug)).products
    expect(item).toMatchObject({ name: 'Cà phê', isAvailable: false, optionGroups: [] })
  })

  it('reports delivery availability from active zones only', async () => {
    const t = await createTenant('deliv')
    await db().update(stores).set({ deliveryEnabled: true }).where(eq(stores.id, t.store.id))
    expect((await getPublicMenu(db(), t.store.slug)).modes.delivery).toEqual({ enabled: true, available: false })
    await createZone(t.store, { active: false })
    expect((await getPublicMenu(db(), t.store.slug)).modes.delivery).toEqual({ enabled: true, available: false })
    await createZone(t.store, { active: true })
    expect((await getPublicMenu(db(), t.store.slug)).modes.delivery).toEqual({ enabled: true, available: true })
  })

  it('builds the image url from the stored key', async () => {
    const t = await createTenant('img')
    await createProduct(t.store, { imageKey: 'stores/s1/products/p1/abc.png' })
    const [item] = (await getPublicMenu(db(), t.store.slug)).products
    expect(item!.imageUrl).toMatch(/\/product-images\/stores\/s1\/products\/p1\/abc\.png$/)
  })

  it('never leaks tenant or internal fields', async () => {
    const t = await createTenant('leak')
    const cat = await createCategory(t.store, 'Trà')
    const product = await createProduct(t.store, { categoryId: cat.id, imageKey: 'stores/x/products/y/z.png' })
    await createOptionGroup(t.store, product)
    const menu = await getPublicMenu(db(), t.store.slug)
    expect(findForbiddenKeys(menu)).toEqual([])
    const json = JSON.stringify(menu)
    expect(json).not.toContain(t.org.id)
    expect(json).not.toContain(t.store.id)
  })
})

describe('public catalog boundaries', () => {
  it('isolates all menu content and zones from another store', async () => {
    const a = await createTenant('isolate-a')
    const b = await createTenant('isolate-b')
    await db().update(stores).set({ deliveryEnabled: true }).where(eq(stores.id, a.store.id))
    const category = await createCategory(b.store, 'Other category')
    const product = await createProduct(b.store, { categoryId: category.id })
    await createOptionGroup(b.store, product)
    await createZone(b.store)
    const menu = await getPublicMenu(db(), a.store.slug)
    expect(menu.categories).toEqual([])
    expect(menu.products).toEqual([])
    expect(menu.modes.delivery.available).toBe(false)
  })

  it('marks insufficient choices and a zero-capacity required group unavailable', async () => {
    const t = await createTenant('capacity')
    const p = await createProduct(t.store)
    await createOptionGroup(t.store, p, { required: true, minSelect: 2, maxSelect: 2, values: [{ name: 'Only' }] })
    const q = await createProduct(t.store)
    await createOptionGroup(t.store, q, { required: true, minSelect: 0, maxSelect: 0 })
    expect((await getPublicMenu(db(), t.store.slug)).products.map(p => p.isAvailable)).toEqual([false, false])
  })

  it('preserves internal DTO flags for later staff views and filters a single product', async () => {
    const t = await createTenant('dto')
    const hidden = await createCategory(t.store, 'Hidden', { active: false })
    const p = await createProduct(t.store, { active: false, categoryId: hidden.id })
    await createProduct(t.store)
    await createOptionGroup(t.store, p, { values: [{ name: 'Inactive', active: false }] })
    const scope = { orgId: t.org.id, storeId: t.store.id }
    const rows = await loadProductDTOs(db(), scope, { productId: p.id })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: p.id, active: false, optionGroups: [{ values: [{ active: false }] }] })
    expect(await loadProductDTOs(db(), scope, { productId: p.id, publicOnly: true })).toEqual([])
  })
})
