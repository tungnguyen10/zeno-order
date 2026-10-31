import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { getPgError } from '../../server/db/errors'
import { organizationMembers, organizations, storeInvitations, storeMembers, stores, userProfiles } from '../../server/db/schema'
import { resetDb } from '../support/db'

const db = () => getDb()

async function seedOrgWithStore(slug: string) {
  const [org] = await db().insert(organizations).values({ name: `Org ${slug}`, slug: `org-${slug}` }).returning()
  const [store] = await db().insert(stores).values({ orgId: org!.id, name: `Store ${slug}`, slug }).returning()
  return { org: org!, store: store! }
}

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('identity schema', () => {
  it('applies defaults for a new store', async () => {
    const { store } = await seedOrgWithStore('tra-sua-a')
    expect(store).toMatchObject({
      status: 'ACTIVE',
      isAcceptingOrders: false,
      dineInEnabled: true,
      pickupEnabled: true,
      deliveryEnabled: false,
      paymentTtlMinutes: 15,
    })
    expect(store.createdAt).toBeInstanceOf(Date)
  })

  it('rejects a store_member whose org_id does not own the store (composite FK)', async () => {
    const a = await seedOrgWithStore('store-a')
    const b = await seedOrgWithStore('store-b')
    const userId = `user_${randomUUID()}`
    await db().insert(userProfiles).values({ userId, email: 'staff@example.com' })

    let caught: unknown
    try {
      await db().insert(storeMembers).values({ orgId: b.org.id, storeId: a.store.id, userId, role: 'STAFF' })
    }
    catch (err) {
      caught = err
    }
    expect(getPgError(caught)).toMatchObject({ code: '23503', constraint: 'store_members_store_fk' })
  })

  it('enforces globally unique store slugs', async () => {
    await seedOrgWithStore('trung-slug')
    const [otherOrg] = await db().insert(organizations).values({ name: 'Other org', slug: 'org-other' }).returning()
    let caught: unknown
    try {
      await db().insert(stores).values({ orgId: otherOrg!.id, name: 'Duplicate', slug: 'trung-slug' })
    }
    catch (err) {
      caught = err
    }
    expect(getPgError(caught)).toMatchObject({ code: '23505', constraint: 'stores_slug_unique' })
  })

  it('rejects a store_invitation whose org_id does not own the store (composite FK)', async () => {
    const a = await seedOrgWithStore('invite-a')
    const b = await seedOrgWithStore('invite-b')
    const userId = `user_${randomUUID()}`
    await db().insert(userProfiles).values({ userId, email: 'owner@example.com' })

    let caught: unknown
    try {
      await db().insert(storeInvitations).values({
        orgId: b.org.id,
        storeId: a.store.id,
        email: 'invitee@example.com',
        tokenHash: `hash_${randomUUID()}`,
        expiresAt: new Date(Date.now() + 86_400_000),
        createdBy: userId,
      })
    }
    catch (err) {
      caught = err
    }
    expect(getPgError(caught)).toMatchObject({ code: '23503', constraint: 'store_invitations_store_fk' })
  })

  it('prevents duplicate membership of the same user in an org', async () => {
    const { org } = await seedOrgWithStore('dup-member')
    const userId = `user_${randomUUID()}`
    await db().insert(userProfiles).values({ userId, email: 'o@example.com' })
    await db().insert(organizationMembers).values({ orgId: org.id, userId, role: 'OWNER' })
    let caught: unknown
    try {
      await db().insert(organizationMembers).values({ orgId: org.id, userId, role: 'OWNER' })
    }
    catch (err) {
      caught = err
    }
    expect(getPgError(caught)).toMatchObject({ code: '23505', constraint: 'organization_members_org_user_uq' })
  })
})
