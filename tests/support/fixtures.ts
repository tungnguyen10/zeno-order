import { randomUUID } from 'node:crypto'
import { getDb } from '../../server/db/client'
import { organizationMembers, organizations, storeMembers, stores, userProfiles } from '../../server/db/schema'

const shortId = () => randomUUID().slice(0, 8)

export async function createUser(opts: { email?: string } = {}) {
  const userId = `user_${randomUUID()}`
  const email = opts.email ?? `${userId}@example.com`
  await getDb().insert(userProfiles).values({ userId, email })
  return { userId, email }
}

export async function createStore(orgId: string, label: string) {
  const [store] = await getDb().insert(stores)
    .values({ orgId, name: `Store ${label}`, slug: `${label}-${shortId()}` })
    .returning()
  return store!
}

export async function createTenant(label: string) {
  const owner = await createUser()
  const [org] = await getDb().insert(organizations)
    .values({ name: `Org ${label}`, slug: `org-${label}-${shortId()}` })
    .returning()
  await getDb().insert(organizationMembers).values({ orgId: org!.id, userId: owner.userId, role: 'OWNER' })
  const store = await createStore(org!.id, label)
  return { owner, org: org!, store }
}

export async function addStaff(
  store: { id: string, orgId: string },
  opts: { status?: 'ACTIVE' | 'DISABLED' } = {},
) {
  const staff = await createUser()
  await getDb().insert(storeMembers).values({
    orgId: store.orgId,
    storeId: store.id,
    userId: staff.userId,
    role: 'STAFF',
    status: opts.status ?? 'ACTIVE',
  })
  return staff
}
