import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { organizationMembers, userProfiles } from '../../server/db/schema'
import { getMe } from '../../server/services/identity/me'
import { createOrganizationWithStore } from '../../server/services/identity/onboarding'
import { ensureProfile } from '../../server/services/identity/profile'
import { getStoreDetail, updateStore } from '../../server/services/store/settings'
import { resetDb } from '../support/db'
import { addStaff, createTenant } from '../support/fixtures'

const newUser = (suffix: string) => ({ userId: `user_${suffix}_${Date.now()}`, email: `${suffix}@Example.com`, name: 'Chủ quán' })
const input = (slug: string) => ({ orgName: 'Zeno Group', storeName: 'Quán Một', storeSlug: slug })

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('ensureProfile', () => {
  it('upserts, lowercases email, keeps displayName when the token has no name', async () => {
    const user = newUser('p1')
    await ensureProfile(getDb(), user)
    const updated = await ensureProfile(getDb(), { ...user, email: 'New@Example.com', name: null })
    expect(updated).toMatchObject({ userId: user.userId, email: 'new@example.com', displayName: 'Chủ quán' })
  })

  it('rejects users without an email claim', async () => {
    await expect(ensureProfile(getDb(), { userId: 'u-no-email', email: null, name: null }))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })
})

describe('createOrganizationWithStore', () => {
  it('creates org, owner membership and store; getMe reflects it', async () => {
    const user = newUser('o1')
    const result = await createOrganizationWithStore(getDb(), user, input('quan-mot'))
    expect(result.store).toMatchObject({ slug: 'quan-mot', name: 'Quán Một', role: 'OWNER', isAcceptingOrders: false })
    expect(result.organization).toMatchObject({ name: 'Zeno Group', role: 'OWNER' })

    const me = await getMe(getDb(), user)
    expect(me.user).toEqual({ id: user.userId, email: 'o1@example.com', displayName: 'Chủ quán' })
    expect(me.organizations.map(o => o.id)).toEqual([result.organization.id])
    expect(me.stores.map(s => s.id)).toEqual([result.store.id])
  })

  it('returns SLUG_TAKEN when another org already uses the slug', async () => {
    await createOrganizationWithStore(getDb(), newUser('o2'), input('trung'))
    await expect(createOrganizationWithStore(getDb(), newUser('o3'), input('trung')))
      .rejects.toMatchObject({ code: 'SLUG_TAKEN', details: { field: 'storeSlug' } })
  })

  it('creates exactly one org on concurrent double submit', async () => {
    const user = newUser('dbl')
    const results = await Promise.allSettled([
      createOrganizationWithStore(getDb(), user, input('double-a')),
      createOrganizationWithStore(getDb(), user, input('double-b')),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toMatchObject({ code: 'ORG_EXISTS' })
    const memberships = await getDb().select().from(organizationMembers).where(eq(organizationMembers.userId, user.userId))
    expect(memberships).toHaveLength(1)
  })

  it('rejects a second onboarding for a user who already belongs to an org', async () => {
    const tenant = await createTenant('exist')
    const [profile] = await getDb().select().from(userProfiles).where(eq(userProfiles.userId, tenant.owner.userId))
    await expect(createOrganizationWithStore(getDb(), { userId: profile!.userId, email: profile!.email, name: null }, input('khac')))
      .rejects.toMatchObject({ code: 'ORG_EXISTS' })
  })
})

describe('store settings', () => {
  it('reads and updates only within the caller context', async () => {
    const a = await createTenant('a')
    const ctx = { orgId: a.org.id, storeId: a.store.id, role: 'OWNER' as const, userId: a.owner.userId }
    expect(await getStoreDetail(getDb(), ctx)).toMatchObject({ id: a.store.id, deliveryEnabled: false })

    const updated = await updateStore(getDb(), ctx, { name: 'Quán Mới', isAcceptingOrders: true })
    expect(updated).toMatchObject({ name: 'Quán Mới', isAcceptingOrders: true, role: 'OWNER' })
  })

  it('throws NOT_FOUND when org/store pair does not match', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const forged = { orgId: b.org.id, storeId: a.store.id, role: 'OWNER' as const, userId: b.owner.userId }
    await expect(getStoreDetail(getDb(), forged)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(updateStore(getDb(), forged, { name: 'Hack' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('getMe for staff lists only the assigned store and no organizations', async () => {
    const a = await createTenant('a')
    const staff = await addStaff(a.store)
    const me = await getMe(getDb(), { userId: staff.userId, email: staff.email, name: null })
    expect(me.organizations).toEqual([])
    expect(me.stores).toEqual([expect.objectContaining({ id: a.store.id, role: 'STAFF' })])
  })
})
