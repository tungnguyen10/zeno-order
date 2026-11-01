import { randomUUID } from 'node:crypto'
import { getDb } from '../../server/db/client'
import { categories, deliveryZones, organizationMembers, organizations, productOptionGroups, productOptionValues, products, storeMembers, storeTables, stores, userProfiles } from '../../server/db/schema'
import { generateToken, hashToken } from '../../server/utils/tokens'

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

type StoreRef = { id: string, orgId: string }

export async function createCategory(store: StoreRef, name: string, opts: { active?: boolean, position?: number } = {}) {
  const [row] = await getDb().insert(categories)
    .values({ orgId: store.orgId, storeId: store.id, name, active: opts.active ?? true, position: opts.position ?? 0 })
    .returning()
  return row!
}

export async function createProduct(
  store: StoreRef,
  opts: {
    name?: string
    basePriceVnd?: number
    categoryId?: string | null
    isAvailable?: boolean
    active?: boolean
    position?: number
    imageKey?: string | null
  } = {},
) {
  const [row] = await getDb().insert(products)
    .values({
      orgId: store.orgId,
      storeId: store.id,
      name: opts.name ?? `Món ${shortId()}`,
      basePriceVnd: opts.basePriceVnd ?? 25000,
      categoryId: opts.categoryId ?? null,
      isAvailable: opts.isAvailable ?? true,
      active: opts.active ?? true,
      position: opts.position ?? 0,
      imageKey: opts.imageKey ?? null,
    })
    .returning()
  return row!
}

export async function createOptionGroup(
  store: StoreRef,
  product: { id: string },
  opts: {
    name?: string
    required?: boolean
    minSelect?: number
    maxSelect?: number
    position?: number
    values?: { name: string, priceDeltaVnd?: number, active?: boolean }[]
  } = {},
) {
  const required = opts.required ?? false
  const [group] = await getDb().insert(productOptionGroups)
    .values({
      orgId: store.orgId,
      storeId: store.id,
      productId: product.id,
      name: opts.name ?? 'Size',
      required,
      minSelect: opts.minSelect ?? (required ? 1 : 0),
      maxSelect: opts.maxSelect ?? 1,
      position: opts.position ?? 0,
    })
    .returning()
  const valueInputs = opts.values ?? [{ name: 'M' }, { name: 'L', priceDeltaVnd: 5000 }]
  const values = valueInputs.length === 0
    ? []
    : await getDb().insert(productOptionValues)
        .values(valueInputs.map((value, index) => ({
          orgId: store.orgId,
          storeId: store.id,
          groupId: group!.id,
          name: value.name,
          priceDeltaVnd: value.priceDeltaVnd ?? 0,
          active: value.active ?? true,
          position: index,
        })))
        .returning()
  return { group: group!, values }
}

export async function createTable(store: StoreRef, code: string, opts: { active?: boolean, displayName?: string } = {}) {
  const token = generateToken()
  const [table] = await getDb().insert(storeTables)
    .values({
      orgId: store.orgId,
      storeId: store.id,
      code,
      displayName: opts.displayName ?? `Bàn ${code}`,
      tokenHash: hashToken(token),
      active: opts.active ?? true,
    })
    .returning()
  return { table: table!, token }
}

export async function createZone(
  store: StoreRef,
  opts: { name?: string, feeVnd?: number, active?: boolean, position?: number } = {},
) {
  const [row] = await getDb().insert(deliveryZones)
    .values({
      orgId: store.orgId,
      storeId: store.id,
      name: opts.name ?? `Khu vực ${shortId()}`,
      feeVnd: opts.feeVnd ?? 15000,
      active: opts.active ?? true,
      position: opts.position ?? 0,
    })
    .returning()
  return row!
}
