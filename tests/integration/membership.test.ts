import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { stores } from '../../server/db/schema'
import { findOrgAccess, findStoreAccess, listAccessibleStores, listOwnedOrganizations } from '../../server/repositories/membership'
import { resetDb } from '../support/db'
import { addStaff, createStore, createTenant } from '../support/fixtures'

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('membership repository', () => {
  it('grants OWNER on every store of the owned org', async () => {
    const a = await createTenant('a')
    const a2 = await createStore(a.org.id, 'a2')
    const db = getDb()
    expect(await findStoreAccess(db, a.owner.userId, a.store.id)).toEqual({ orgId: a.org.id, storeId: a.store.id, role: 'OWNER' })
    expect(await findStoreAccess(db, a.owner.userId, a2.id)).toMatchObject({ role: 'OWNER' })
    expect(await findOrgAccess(db, a.owner.userId, a.org.id)).toEqual({ orgId: a.org.id, role: 'OWNER' })
  })

  it('grants STAFF only on the assigned store', async () => {
    const a = await createTenant('a')
    const a2 = await createStore(a.org.id, 'a2')
    const staff = await addStaff(a.store)
    const db = getDb()
    expect(await findStoreAccess(db, staff.userId, a.store.id)).toMatchObject({ role: 'STAFF' })
    expect(await findStoreAccess(db, staff.userId, a2.id)).toBeNull()
    expect(await findOrgAccess(db, staff.userId, a.org.id)).toBeNull()
  })

  it('denies other tenants, disabled staff and suspended stores', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const disabled = await addStaff(a.store, { status: 'DISABLED' })
    const db = getDb()
    expect(await findStoreAccess(db, b.owner.userId, a.store.id)).toBeNull()
    expect(await findOrgAccess(db, b.owner.userId, a.org.id)).toBeNull()
    expect(await findStoreAccess(db, disabled.userId, a.store.id)).toBeNull()
    await db.update(stores).set({ status: 'SUSPENDED' }).where(eq(stores.id, a.store.id))
    expect(await findStoreAccess(db, a.owner.userId, a.store.id)).toBeNull()
  })

  it('lists only accessible stores and owned organizations', async () => {
    const a = await createTenant('a')
    const a2 = await createStore(a.org.id, 'a2')
    const b = await createTenant('b')
    const staff = await addStaff(a.store)
    const db = getDb()

    const ownerStores = await listAccessibleStores(db, a.owner.userId)
    expect(ownerStores.map(s => s.id).sort()).toEqual([a.store.id, a2.id].sort())
    expect(ownerStores.every(s => s.role === 'OWNER')).toBe(true)

    const staffStores = await listAccessibleStores(db, staff.userId)
    expect(staffStores).toEqual([expect.objectContaining({ id: a.store.id, role: 'STAFF', orgId: a.org.id })])

    expect((await listAccessibleStores(db, b.owner.userId)).map(s => s.id)).toEqual([b.store.id])
    expect(await listOwnedOrganizations(db, a.owner.userId)).toEqual([
      { id: a.org.id, name: a.org.name, slug: a.org.slug, role: 'OWNER' },
    ])
    expect(await listOwnedOrganizations(db, staff.userId)).toEqual([])
  })
})
