import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { StoreContext } from '../../server/auth/guards'
import { closeDb, getDb } from '../../server/db/client'
import { productOptionGroups, productOptionValues } from '../../server/db/schema'
import { loadProductDTOs } from '../../server/services/catalog/product-view'
import { replaceProductOptions } from '../../server/services/catalog/options'
import { replaceOptionsInputSchema } from '#shared/schemas/catalog'
import { resetDb } from '../support/db'
import { createOptionGroup, createProduct, createStore, createTenant } from '../support/fixtures'

const ctxOf = (t: { owner: { userId: string }, org: { id: string }, store: { id: string } }): StoreContext => ({
  userId: t.owner.userId,
  orgId: t.org.id,
  storeId: t.store.id,
  role: 'OWNER',
})

const input = (groups: unknown[]) => replaceOptionsInputSchema.parse({ groups })
const group = (name: string, values: string[], extra: Record<string, unknown> = {}) => ({
  name,
  required: false,
  minSelect: 0,
  maxSelect: 1,
  values: values.map(value => ({ name: value })),
  ...extra,
})

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('replaceProductOptions', () => {
  it('creates groups and values in array order', async () => {
    const t = await createTenant('opt')
    const product = await createProduct(t.store)
    const result = await replaceProductOptions(getDb(), ctxOf(t), product.id, input([
      group('Size', ['M', 'L'], { required: true, minSelect: 0 }),
      group('Topping', ['Trân châu', 'Thạch', 'Pudding'], { maxSelect: 2 }),
    ]))

    expect(result.map(g => [g.name, g.required, g.minSelect, g.maxSelect, g.position])).toEqual([
      ['Size', true, 1, 1, 0],
      ['Topping', false, 0, 2, 1],
    ])
    expect(result[1]!.values.map(v => [v.name, v.position])).toEqual([['Trân châu', 0], ['Thạch', 1], ['Pudding', 2]])
  })

  it('replaces the previous groups and removes their values', async () => {
    const t = await createTenant('rep')
    const product = await createProduct(t.store)
    const old = await createOptionGroup(t.store, product, { name: 'Cũ', values: [{ name: 'x' }, { name: 'y' }] })
    await replaceProductOptions(getDb(), ctxOf(t), product.id, input([group('Mới', ['a'])]))

    const [dto] = await loadProductDTOs(getDb(), ctxOf(t), { productId: product.id })
    expect(dto!.optionGroups.map(g => g.name)).toEqual(['Mới'])
    expect(dto!.optionGroups[0]!.id).not.toBe(old.group.id)
    expect(dto!.optionGroups[0]!.values[0]!.id).not.toBe(old.values[0]!.id)
    expect(await getDb().select().from(productOptionValues)).toHaveLength(1)
  })

  it('an empty list removes every option', async () => {
    const t = await createTenant('clear')
    const product = await createProduct(t.store)
    await createOptionGroup(t.store, product)
    expect(await replaceProductOptions(getDb(), ctxOf(t), product.id, input([]))).toEqual([])
    expect(await getDb().select().from(productOptionGroups)).toEqual([])
  })

  it('NOT_FOUND for a product of another store and changes nothing there', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const theirs = await createProduct(b.store)
    await createOptionGroup(b.store, theirs, { name: 'Của B' })
    await expect(replaceProductOptions(getDb(), ctxOf(a), theirs.id, input([group('Hijack', ['x'])]))).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const remaining = await getDb().select().from(productOptionGroups).where(eq(productOptionGroups.productId, theirs.id))
    expect(remaining.map(g => g.name)).toEqual(['Của B'])
  })

  it('two concurrent replacements never leave a mixed state', async () => {
    const t = await createTenant('race')
    const product = await createProduct(t.store)
    const setA = input([group('A', ['a1', 'a2'])])
    const setB = input([group('B1', ['b1']), group('B2', ['b2', 'b3', 'b4'])])

    const results = await Promise.allSettled([
      replaceProductOptions(getDb(), ctxOf(t), product.id, setA),
      replaceProductOptions(getDb(), ctxOf(t), product.id, setB),
    ])
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(results.map(r => r.status === 'fulfilled' ? r.value.map(g => [g.name, g.values.length]) : null)).toEqual([
      [['A', 2]],
      [['B1', 1], ['B2', 3]],
    ])

    const [dto] = await loadProductDTOs(getDb(), ctxOf(t), { productId: product.id })
    const shape = dto!.optionGroups.map(g => [g.name, g.values.length])
    expect([[['A', 2]], [['B1', 1], ['B2', 3]]]).toContainEqual(shape)
  })

  it('rolls back deleted groups and partial inserts if a value fails its DB constraint', async () => {
    const t = await createTenant('rollback')
    const product = await createProduct(t.store)
    await createOptionGroup(t.store, product, { name: 'Original' })
    const [before] = await loadProductDTOs(getDb(), ctxOf(t), { productId: product.id })
    const invalid = input([group('First', ['a']), group('Broken', ['b'])])
    // Bypass request validation to exercise a real failure after destructive writes.
    invalid.groups[1]!.values[0]!.priceDeltaVnd = -1
    await expect(replaceProductOptions(getDb(), ctxOf(t), product.id, invalid)).rejects.toThrow()
    const [after] = await loadProductDTOs(getDb(), ctxOf(t), { productId: product.id })
    expect(after!.optionGroups).toEqual(before!.optionGroups)
    expect(await getDb().select().from(productOptionValues)).toHaveLength(2)
  })

  it('rejects another store in the same org and a mismatched org scope', async () => {
    const t = await createTenant('scope')
    const sibling = await createStore(t.org.id, 'sibling')
    const product = await createProduct(sibling)
    const other = await createTenant('other')
    await createOptionGroup(sibling, product, { name: 'Untouched' })
    for (const ctx of [ctxOf(t), { ...ctxOf(t), storeId: sibling.id, orgId: other.org.id }]) {
      await expect(replaceProductOptions(getDb(), ctx, product.id, input([]))).rejects.toMatchObject({ code: 'NOT_FOUND' })
    }
    const [dto] = await loadProductDTOs(getDb(), { orgId: t.org.id, storeId: sibling.id }, { productId: product.id })
    expect(dto!.optionGroups.map(g => g.name)).toEqual(['Untouched'])
  })
})
