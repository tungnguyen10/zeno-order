import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { StoreContext } from '../../server/auth/guards'
import { closeDb, getDb } from '../../server/db/client'
import { createProduct, listProducts, updateProduct } from '../../server/services/catalog/products'
import { resetDb } from '../support/db'
import { createCategory, createOptionGroup, createProduct as seedProduct, createStore, createTenant } from '../support/fixtures'

const ctxOf = (t: { owner: { userId: string }, org: { id: string } }, store: { id: string }): StoreContext => ({
  userId: t.owner.userId,
  orgId: t.org.id,
  storeId: store.id,
  role: 'OWNER',
})

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('createProduct (quick add)', () => {
  it('needs only a name and a price', async () => {
    const t = await createTenant('qa')
    const otherStore = await createStore(t.org.id, 'qa-other')
    await seedProduct(otherStore, { position: 20 })
    const first = await createProduct(getDb(), ctxOf(t, t.store), { name: 'Trà sữa trân châu', basePriceVnd: 35000 })
    const second = await createProduct(getDb(), ctxOf(t, t.store), { name: 'Cà phê muối', basePriceVnd: 29000 })
    expect(first).toEqual({
      id: first.id,
      categoryId: null,
      name: 'Trà sữa trân châu',
      description: null,
      basePriceVnd: 35000,
      isAvailable: true,
      active: true,
      position: 0,
      imageUrl: null,
      optionGroups: [],
    })
    expect(second.position).toBe(1)
  })

  it('attaches a category of the same store', async () => {
    const t = await createTenant('cat')
    const cat = await createCategory(t.store, 'Trà')
    const product = await createProduct(getDb(), ctxOf(t, t.store), { name: 'Trà đào', basePriceVnd: 30000, categoryId: cat.id })
    expect(product.categoryId).toBe(cat.id)
  })

  it('rejects a category from another org or from another store of the same org (NOT_FOUND)', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const a2 = await createStore(a.org.id, 'a2')
    const foreignOrg = await createCategory(b.store, 'B')
    const sameOrgOtherStore = await createCategory(a2, 'A2')
    for (const categoryId of [foreignOrg.id, sameOrgOtherStore.id]) {
      await expect(createProduct(getDb(), ctxOf(a, a.store), { name: 'X', basePriceVnd: 1000, categoryId })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    }
    expect(await listProducts(getDb(), ctxOf(a, a.store))).toEqual([])
  })
})

describe('updateProduct', () => {
  it('toggles availability and activity', async () => {
    const t = await createTenant('tog')
    const product = await seedProduct(t.store, { name: 'Trà' })
    const soldOut = await updateProduct(getDb(), ctxOf(t, t.store), product.id, { isAvailable: false })
    expect(soldOut.isAvailable).toBe(false)
    const hidden = await updateProduct(getDb(), ctxOf(t, t.store), product.id, { active: false })
    expect(hidden).toMatchObject({ isAvailable: false, active: false })
  })

  it('moves a product to another category and back to none', async () => {
    const t = await createTenant('mv')
    const cat = await createCategory(t.store, 'Trà')
    const product = await seedProduct(t.store, { name: 'Trà' })
    expect((await updateProduct(getDb(), ctxOf(t, t.store), product.id, { categoryId: cat.id })).categoryId).toBe(cat.id)
    expect((await updateProduct(getDb(), ctxOf(t, t.store), product.id, { categoryId: null })).categoryId).toBeNull()
  })

  it('edits name, price and turns an empty description into null', async () => {
    const t = await createTenant('ed')
    const product = await seedProduct(t.store, { name: 'Cũ', basePriceVnd: 10000 })
    const withDescription = await updateProduct(getDb(), ctxOf(t, t.store), product.id, { name: 'Mới', basePriceVnd: 45000, description: 'Ít đường' })
    expect(withDescription).toMatchObject({ name: 'Mới', basePriceVnd: 45000, description: 'Ít đường' })
    expect((await updateProduct(getDb(), ctxOf(t, t.store), product.id, { description: '' })).description).toBeNull()
  })

  it('cannot touch a product of another store (NOT_FOUND) or move it into a foreign category', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const a2 = await createStore(a.org.id, 'a2')
    const sibling = await seedProduct(a2, { name: 'Của A2' })
    const siblingCategory = await createCategory(a2, 'A2')
    const mine = await seedProduct(a.store, { name: 'Của A' })
    const theirs = await seedProduct(b.store, { name: 'Của B' })
    const foreignCategory = await createCategory(b.store, 'B')
    await expect(updateProduct(getDb(), ctxOf(a, a.store), theirs.id, { name: 'Hijack' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(updateProduct(getDb(), ctxOf(a, a.store), mine.id, { categoryId: foreignCategory.id })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(updateProduct(getDb(), ctxOf(a, a.store), sibling.id, { name: 'Hijack' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(updateProduct(getDb(), ctxOf(a, a.store), mine.id, { categoryId: siblingCategory.id })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect((await listProducts(getDb(), ctxOf(a, a2)))[0]!.name).toBe('Của A2')
    expect((await listProducts(getDb(), ctxOf(b, b.store)))[0]!.name).toBe('Của B')
    expect((await listProducts(getDb(), ctxOf(a, a.store)))[0]!.categoryId).toBeNull()
  })
})

describe('listProducts', () => {
  it('returns hidden and sold-out products with their option groups, scoped to the store', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const shown = await seedProduct(a.store, { name: 'Hiện', position: 1 })
    await seedProduct(a.store, { name: 'Ẩn', active: false, position: 2 })
    await seedProduct(a.store, { name: 'Hết', isAvailable: false, position: 3 })
    await seedProduct(b.store, { name: 'Của B' })
    const a2 = await createStore(a.org.id, 'a2')
    await seedProduct(a2, { name: 'Của A2' })
    await createOptionGroup(a.store, shown, { name: 'Size', required: true })

    const list = await listProducts(getDb(), ctxOf(a, a.store))
    expect(list.map(p => [p.name, p.active, p.isAvailable])).toEqual([['Hiện', true, true], ['Ẩn', false, true], ['Hết', true, false]])
    expect(list[0]!.optionGroups).toHaveLength(1)
    expect(list[0]!.optionGroups[0]!.values.map(v => v.name)).toEqual(['M', 'L'])
  })
})
