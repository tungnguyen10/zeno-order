import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { StoreContext } from '../../server/auth/guards'
import { closeDb, getDb } from '../../server/db/client'
import { createCategory, listCategories, updateCategory } from '../../server/services/catalog/categories'
import { resetDb } from '../support/db'
import { createCategory as seedCategory, createStore, createTenant } from '../support/fixtures'

const ctxOf = (t: { owner: { userId: string }, org: { id: string }, store: { id: string } }): StoreContext => ({
  userId: t.owner.userId,
  orgId: t.org.id,
  storeId: t.store.id,
  role: 'OWNER',
})

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('categories service', () => {
  it('appends categories with increasing positions', async () => {
    const t = await createTenant('cat')
    const first = await createCategory(getDb(), ctxOf(t), { name: 'Trà sữa' })
    const second = await createCategory(getDb(), ctxOf(t), { name: 'Cà phê' })
    expect([first.position, second.position]).toEqual([0, 1])
    expect((await listCategories(getDb(), ctxOf(t))).map(c => c.name)).toEqual(['Trà sữa', 'Cà phê'])
  })

  it('lists inactive categories too (owner view) and scopes by store', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    await seedCategory(a.store, 'Ẩn', { active: false })
    await seedCategory(b.store, 'Của B')
    const list = await listCategories(getDb(), ctxOf(a))
    expect(list.map(c => [c.name, c.active])).toEqual([['Ẩn', false]])
  })

  it('updates name, active and position', async () => {
    const t = await createTenant('upd')
    const created = await createCategory(getDb(), ctxOf(t), { name: 'Cũ' })
    const updated = await updateCategory(getDb(), ctxOf(t), created.id, { name: 'Mới', active: false, position: 5 })
    expect(updated).toEqual({ id: created.id, name: 'Mới', active: false, position: 5 })
  })

  it('cannot update a category of another store or org (NOT_FOUND) and leaves it untouched', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const foreign = await seedCategory(b.store, 'Của B')
    await expect(updateCategory(getDb(), ctxOf(a), foreign.id, { name: 'Bị đổi' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect((await listCategories(getDb(), ctxOf(b)))[0]!.name).toBe('Của B')
  })
})


describe('category scope boundaries', () => {
  it('isolates a second store in the same organization', async () => {
    const t = await createTenant('same-org')
    const other = await createStore(t.org.id, 'other-store')
    const foreign = await seedCategory(other, 'Other', { position: 12 })
    const own = await createCategory(getDb(), ctxOf(t), { name: 'Own' })
    expect(own.position).toBe(0)
    expect((await listCategories(getDb(), ctxOf(t))).map(c => c.id)).toEqual([own.id])
    await expect(updateCategory(getDb(), ctxOf(t), foreign.id, { active: false })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await listCategories(getDb(), { orgId: t.org.id, storeId: other.id })).toEqual([
      { id: foreign.id, name: 'Other', position: 12, active: true },
    ])
  })

  it('checks orgId as well as storeId and returns NOT_FOUND for missing categories', async () => {
    const a = await createTenant('org-a')
    const b = await createTenant('org-b')
    const own = await seedCategory(a.store, 'Own')
    const mismatched = { ...ctxOf(a), orgId: b.org.id }
    expect(await listCategories(getDb(), mismatched)).toEqual([])
    await expect(updateCategory(getDb(), mismatched, own.id, { name: 'Hijack' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(updateCategory(getDb(), ctxOf(a), randomUUID(), { name: 'Missing' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect((await listCategories(getDb(), ctxOf(a)))[0]!.name).toBe('Own')
  })
})
