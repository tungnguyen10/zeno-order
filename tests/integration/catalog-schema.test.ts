import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { getPgError } from '../../server/db/errors'
import { categories, deliveryZones, productOptionGroups, productOptionValues, products, storeTables } from '../../server/db/schema'
import { hashToken } from '../../server/utils/tokens'
import { resetDb } from '../support/db'
import { createCategory, createOptionGroup, createProduct, createTable, createTenant } from '../support/fixtures'

async function pgErrorOf(promise: PromiseLike<unknown>) {
  try {
    await promise
    return null
  }
  catch (err) {
    return getPgError(err)
  }
}

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('catalog tenant isolation at the database level', () => {
  it('rejects a product whose category belongs to another store (23503)', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const foreign = await createCategory(b.store, 'Trà')
    const error = await pgErrorOf(getDb().insert(products).values({
      orgId: a.org.id,
      storeId: a.store.id,
      categoryId: foreign.id,
      name: 'Trà đào',
      basePriceVnd: 30000,
    }))
    expect(error).toMatchObject({ code: '23503', constraint: 'products_category_fk' })
  })

  it('rejects an (org_id, store_id) pair that does not match the store (23503)', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const error = await pgErrorOf(getDb().insert(categories).values({ orgId: a.org.id, storeId: b.store.id, name: 'Lạc tenant' }))
    expect(error).toMatchObject({ code: '23503', constraint: 'categories_store_fk' })
  })

  it('allows a product without a category (quick add)', async () => {
    const a = await createTenant('a')
    const product = await createProduct(a.store, { name: 'Trà sữa', categoryId: null })
    expect(product.categoryId).toBeNull()
  })

  it('rejects an option group that points at a product of another store (23503)', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const foreign = await createProduct(b.store)
    const error = await pgErrorOf(getDb().insert(productOptionGroups).values({
      orgId: a.org.id,
      storeId: a.store.id,
      productId: foreign.id,
      name: 'Size',
    }))
    expect(error).toMatchObject({ code: '23503', constraint: 'option_groups_product_fk' })
  })

  it('rejects an option value that points at a group of another store (23503)', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const { group } = await createOptionGroup(b.store, await createProduct(b.store))
    const error = await pgErrorOf(getDb().insert(productOptionValues).values({
      orgId: a.org.id,
      storeId: a.store.id,
      groupId: group.id,
      name: 'M',
    }))
    expect(error).toMatchObject({ code: '23503', constraint: 'option_values_group_fk' })
  })
})

describe('catalog check constraints', () => {
  it('rejects a negative product price (23514)', async () => {
    const a = await createTenant('a')
    const error = await pgErrorOf(getDb().insert(products).values({
      orgId: a.org.id,
      storeId: a.store.id,
      name: 'Giá âm',
      basePriceVnd: -1,
    }))
    expect(error).toMatchObject({ code: '23514', constraint: 'products_base_price_nonneg' })
  })

  it('rejects max_select < min_select (23514)', async () => {
    const a = await createTenant('a')
    const product = await createProduct(a.store)
    const error = await pgErrorOf(getDb().insert(productOptionGroups).values({
      orgId: a.org.id,
      storeId: a.store.id,
      productId: product.id,
      name: 'Topping',
      minSelect: 3,
      maxSelect: 2,
    }))
    expect(error).toMatchObject({ code: '23514', constraint: 'option_groups_min_max_valid' })
  })

  it('rejects a negative option price delta (23514)', async () => {
    const a = await createTenant('a')
    const { group } = await createOptionGroup(a.store, await createProduct(a.store))
    const error = await pgErrorOf(getDb().insert(productOptionValues).values({
      orgId: a.org.id,
      storeId: a.store.id,
      groupId: group.id,
      name: 'Giảm giá',
      priceDeltaVnd: -1000,
    }))
    expect(error).toMatchObject({ code: '23514', constraint: 'option_values_price_delta_nonneg' })
  })

  it('rejects a negative delivery fee (23514)', async () => {
    const a = await createTenant('a')
    const error = await pgErrorOf(getDb().insert(deliveryZones).values({
      orgId: a.org.id,
      storeId: a.store.id,
      name: 'Quận 1',
      feeVnd: -1,
    }))
    expect(error).toMatchObject({ code: '23514', constraint: 'delivery_zones_fee_nonneg' })
  })
})

describe('store_tables uniqueness', () => {
  it('keeps table codes unique per store but reusable across stores (23505)', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    await createTable(a.store, '05')
    await createTable(b.store, '05')
    const error = await pgErrorOf(getDb().insert(storeTables).values({
      orgId: a.org.id,
      storeId: a.store.id,
      code: '05',
      displayName: 'Bàn 05 (trùng)',
      tokenHash: hashToken('another-token'),
    }))
    expect(error).toMatchObject({ code: '23505', constraint: 'store_tables_store_code_uq' })
  })

  it('keeps token hashes globally unique (23505)', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const { table } = await createTable(a.store, '01')
    const error = await pgErrorOf(getDb().insert(storeTables).values({
      orgId: b.org.id,
      storeId: b.store.id,
      code: '01',
      displayName: 'Bàn 01',
      tokenHash: table.tokenHash,
    }))
    expect(error).toMatchObject({ code: '23505', constraint: 'store_tables_token_hash_uq' })
  })
})

describe('option cascade', () => {
  it('deleting a group removes its values', async () => {
    const a = await createTenant('a')
    const { values } = await createOptionGroup(a.store, await createProduct(a.store))
    expect(values.length).toBeGreaterThan(0)
    await getDb().delete(productOptionGroups)
    expect(await getDb().select().from(productOptionValues)).toEqual([])
  })
})
