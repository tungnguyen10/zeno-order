import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { categories, productOptionGroups, productOptionValues, products } from '../../server/db/schema'
import { seedCatalog } from '../../server/services/catalog/seed'
import { resetDb } from '../support/db'
import { createTenant } from '../support/fixtures'

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('seedCatalog', () => {
  it('seeds only the requested store once and rejects a missing store without writes', async () => {
    const a = await createTenant('seed-a')
    const b = await createTenant('seed-b')

    await expect(seedCatalog(getDb(), a.store.id)).resolves.toEqual({ created: true })
    await expect(seedCatalog(getDb(), a.store.id)).resolves.toEqual({ created: false })

    const db = getDb()
    const aCategories = await db.select().from(categories).where(eq(categories.storeId, a.store.id))
    const bCategories = await db.select().from(categories).where(eq(categories.storeId, b.store.id))
    const aProducts = await db.select().from(products).where(eq(products.storeId, a.store.id)).orderBy(asc(products.position))
    const bProducts = await db.select().from(products).where(eq(products.storeId, b.store.id))
    expect(aCategories).toHaveLength(1)
    expect(aCategories[0]).toMatchObject({ orgId: a.org.id, name: 'Menu mẫu ZENO' })
    expect(aProducts.map(product => product.name)).toEqual(['Cà phê sữa', 'Trà sữa'])
    expect(aProducts.every(product => product.orgId === a.org.id && product.categoryId === aCategories[0]!.id)).toBe(true)
    expect(bCategories).toEqual([])
    expect(bProducts).toEqual([])

    const tea = aProducts.find(product => product.name === 'Trà sữa')!
    const groups = await db.select().from(productOptionGroups).where(and(eq(productOptionGroups.storeId, a.store.id), eq(productOptionGroups.productId, tea.id)))
    const values = await db.select().from(productOptionValues).where(eq(productOptionValues.storeId, a.store.id)).orderBy(asc(productOptionValues.position))
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ orgId: a.org.id, name: 'Size', required: true, minSelect: 1, maxSelect: 1 })
    expect(values.map(value => [value.name, value.priceDeltaVnd])).toEqual([['M', 0], ['L', 5000]])

    await expect(seedCatalog(db, randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await db.select().from(categories).where(eq(categories.storeId, a.store.id))).toHaveLength(1)
  })
})
