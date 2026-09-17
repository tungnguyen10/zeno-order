import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { catalogCreateSchemas, catalogUpdateSchemas, catalogResourceSchema, catalogResourceIdSchema, storeHoursSchema, storeSettingsSchema } from '../../shared/schemas/catalog-management'
import { CatalogManagementError, createCatalogManagementRepository } from '../../server/repositories/catalog-management.repository'

const uuid = '11111111-1111-4111-8111-111111111111'
const otherUuid = '22222222-2222-4222-8222-222222222222'
const hours = Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, isClosed: true, openTime: null, closeTime: null }))
const resources = ['menus', 'sections', 'products', 'menu-items', 'option-groups', 'option-values', 'product-option-groups'] as const

function mockClient(responses: Record<string, unknown[]> = {}) {
  const queries: Array<{ table: string, query: ReturnType<typeof builder> }> = []
  function builder(result: unknown) {
    const query = {
      select: vi.fn().mockReturnThis(), insert: vi.fn().mockReturnThis(), update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(), upsert: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(result),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
    }
    return query
  }
  const client = { from: vi.fn((table: string) => {
    const result = responses[table]?.shift() ?? { data: { id: uuid, store_id: 'store-a' }, error: null }
    const query = builder(result)
    queries.push({ table, query })
    return query
  }) }
  return { client: client as unknown as SupabaseClient, queries }
}

describe('management schemas', () => {
  it('accepts only listed resources and validates ordinary/composite identifiers', () => {
    for (const resource of resources) expect(catalogResourceSchema.safeParse(resource).success).toBe(true)
    expect(catalogResourceSchema.safeParse('stores').success).toBe(false)
    expect(catalogResourceIdSchema('products').safeParse('bad').success).toBe(false)
    expect(catalogResourceIdSchema('products').safeParse(uuid).success).toBe(true)
    expect(catalogResourceIdSchema('product-option-groups').safeParse(`${uuid}:${otherUuid}`).success).toBe(true)
    for (const value of [uuid, `${uuid}:bad`, `${uuid}:${otherUuid}:extra`]) expect(catalogResourceIdSchema('product-option-groups').safeParse(value).success).toBe(false)
  })
  it('rejects unknown fields and empty updates without applying create defaults', () => {
    for (const resource of resources) {
      expect(catalogUpdateSchemas[resource].safeParse({}).success).toBe(false)
      expect(catalogUpdateSchemas[resource].safeParse({ storeId: uuid }).success).toBe(false)
    }
    expect(catalogUpdateSchemas.products.parse({ name: 'New' })).toEqual({ name: 'New' })
    expect(catalogCreateSchemas.products.safeParse({ name: 'New', slug: 'new', basePrice: '1', store_id: uuid }).success).toBe(false)
    expect(storeSettingsSchema.safeParse({}).success).toBe(false)
    expect(storeSettingsSchema.parse({ name: 'Shop' })).toEqual({ name: 'Shop' })
    expect(storeSettingsSchema.safeParse({ organizationId: uuid }).success).toBe(false)
  })
  it('preserves decimal integer money strings and rejects invalid or overflowing amounts', () => {
    for (const basePrice of ['-1', '1.2', '1e3', ' 1', '', '9223372036854775808', 100]) {
      expect(catalogCreateSchemas.products.safeParse({ name: 'Tea', slug: 'tea', basePrice }).success).toBe(false)
    }
    expect(catalogCreateSchemas.products.parse({ name: 'Tea', slug: 'tea', basePrice: '9007199254740993' }).basePrice).toBe('9007199254740993')
  })
  it('requires seven unique strict hour rows with valid same-day intervals', () => {
    expect(storeHoursSchema.safeParse(hours).success).toBe(true)
    expect(storeHoursSchema.safeParse(hours.slice(1)).success).toBe(false)
    expect(storeHoursSchema.safeParse(hours.map(() => hours[0])).success).toBe(false)
    expect(storeHoursSchema.safeParse([{ ...hours[0], unknown: true }, ...hours.slice(1)]).success).toBe(false)
    expect(storeHoursSchema.safeParse([{ ...hours[0], isClosed: false, openTime: '18:00', closeTime: '08:00' }, ...hours.slice(1)]).success).toBe(false)
  })
  it('validates option bounds on creates and supplied partial fields', () => {
    const group = { name: 'Size', selectionType: 'single', required: true, minSelect: 1, maxSelect: 1 }
    expect(catalogCreateSchemas['option-groups'].safeParse(group).success).toBe(true)
    for (const patch of [{ maxSelect: 2 }, { minSelect: 2 }, { required: false }]) {
      expect(catalogCreateSchemas['option-groups'].safeParse({ ...group, ...patch }).success).toBe(false)
    }
    expect(catalogUpdateSchemas['option-groups'].safeParse({ minSelect: 3, maxSelect: 1 }).success).toBe(false)
    expect(catalogCreateSchemas['menu-items'].safeParse({ menuId: uuid, sectionId: uuid, productId: 'bad' }).success).toBe(false)
    expect(catalogCreateSchemas['product-option-groups'].parse({ productId: uuid, optionGroupId: otherUuid })).toEqual({ productId: uuid, optionGroupId: otherUuid, sortOrder: 0 })
  })
})

describe('tenant-scoped management repository', () => {
  it.each(resources)('scopes %s updates and deletes before identifiers', async (resource) => {
    const { client, queries } = mockClient()
    const repository = createCatalogManagementRepository(client)
    const id = resource === 'product-option-groups' ? `${uuid}:${otherUuid}` : uuid
    await repository.updateResource('store-a', resource, id, resource === 'product-option-groups' ? { sortOrder: 2 } : { name: 'Tea' })
    await repository.deleteResource('store-a', resource, id)
    for (const { query } of queries) {
      expect(query.eq).toHaveBeenNthCalledWith(1, 'store_id', 'store-a')
      expect(query.eq).toHaveBeenNthCalledWith(2, resource === 'product-option-groups' ? 'product_id' : 'id', uuid)
      if (resource === 'product-option-groups') expect(query.eq).toHaveBeenNthCalledWith(3, 'option_group_id', otherUuid)
    }
  })
  it.each(resources)('forces the insert tenant for %s', async (resource) => {
    const { client, queries } = mockClient()
    await createCatalogManagementRepository(client).createResource('store-a', resource, { name: 'Tea', storeId: 'evil', store_id: 'evil' })
    expect(queries[0]!.query.insert).toHaveBeenCalledWith(expect.objectContaining({ store_id: 'store-a' }))
  })
  it('maps snake-case fields and keeps money exact in selected text columns', async () => {
    const { client, queries } = mockClient({ products: [{ data: { id: uuid, store_id: 'store-a', base_price: '9007199254740993', image_path: null, is_sold_out: false }, error: null }] })
    const result = await createCatalogManagementRepository(client).updateResource('store-a', 'products', uuid, { basePrice: '9007199254740993' })
    expect(result).toMatchObject({ id: uuid, storeId: 'store-a', basePrice: '9007199254740993', imagePath: null, isSoldOut: false })
    expect(result).not.toHaveProperty('base_price')
    expect(queries[0]!.query.update).toHaveBeenCalledWith({ base_price: '9007199254740993' })
    expect(queries[0]!.query.select).toHaveBeenCalledWith(expect.stringContaining('base_price::text'))
  })
  it('scopes settings by stores.id, sold-out by tenant and id, and members by tenant and user', async () => {
    const { client, queries } = mockClient()
    const repo = createCatalogManagementRepository(client)
    await repo.updateSettings('store-a', { name: 'Shop' })
    await repo.setSoldOut('store-a', uuid, true)
    await repo.addMember('store-a', { userId: uuid, role: 'staff' })
    await repo.updateMember('store-a', uuid, { role: 'manager' })
    await repo.removeMember('store-a', uuid)
    expect(queries[0]!.query.eq).toHaveBeenCalledWith('id', 'store-a')
    expect(queries[1]!.query.update).toHaveBeenCalledWith({ is_sold_out: true })
    expect(queries[1]!.query.eq.mock.calls).toEqual([['store_id', 'store-a'], ['id', uuid]])
    expect(queries[2]!.query.insert).toHaveBeenCalledWith({ store_id: 'store-a', user_id: uuid, role: 'staff' })
    for (const { query } of queries.slice(3)) expect(query.eq.mock.calls).toEqual([['store_id', 'store-a'], ['user_id', uuid]])
  })
  it('replaces all seven days in one tenant-keyed upsert without a delete gap', async () => {
    const { client, queries } = mockClient({ store_hours: [{ data: hours.map(row => ({ day_of_week: row.dayOfWeek, is_closed: true, open_time: null, close_time: null, store_id: 'store-a' })), error: null }] })
    const result = await createCatalogManagementRepository(client).replaceHours('store-a', hours)
    expect(result).toHaveLength(7)
    expect(queries).toHaveLength(1)
    expect(queries[0]!.query.upsert).toHaveBeenCalledWith(hours.map(row => ({ store_id: 'store-a', day_of_week: row.dayOfWeek, is_closed: true, open_time: null, close_time: null })), { onConflict: 'store_id,day_of_week' })
    expect(queries[0]!.query.delete).not.toHaveBeenCalled()
  })
  it.each([['42501', 'FORBIDDEN'], ['23505', 'CONFLICT'], ['23503', 'CONFLICT'], ['23514', 'CONFLICT'], ['PGRST116', 'NOT_FOUND'], ['XX000', 'INTERNAL']])('maps %s errors without Postgres details', async (code, expected) => {
    const { client } = mockClient({ products: [{ data: null, error: { code, message: 'secret postgres detail' } }] })
    const error = await createCatalogManagementRepository(client).setSoldOut('store-a', uuid, true).catch(error => error)
    expect(error).toBeInstanceOf(CatalogManagementError)
    expect(error.code).toBe(expected)
    expect(error.message).not.toContain('secret')
  })
  it('treats zero-row writes as not found', async () => {
    const { client } = mockClient({ products: [{ data: null, error: null }] })
    await expect(createCatalogManagementRepository(client).deleteResource('store-a', 'products', uuid)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
  it.each(['staff', 'manager', 'owner', 'organization_admin'] as const)('loads a scoped snapshot and derives %s capabilities', async (role) => {
    const responses: Record<string, unknown[]> = Object.fromEntries(['store_hours', 'menus', 'menu_sections', 'products', 'menu_items', 'option_groups', 'option_values', 'product_option_groups'].map(table => [table, [{ data: [], error: null }]]))
    responses.stores = [{ data: { id: 'store-a', organization_id: 'org-a', name: 'Shop', min_order_amount: '0', default_delivery_fee: '5000' }, error: null }]
    responses.store_members = [{ data: role === 'organization_admin' ? [] : [{ store_id: 'store-a', user_id: uuid, role }], error: null }]
    responses.organization_members = [{ data: role === 'organization_admin' ? { role: 'admin' } : null, error: null }]
    const { client, queries } = mockClient(responses)
    const snapshot = await createCatalogManagementRepository(client).getSnapshot('store-a', uuid)
    expect(snapshot).toMatchObject({ role, canManageCatalog: role !== 'staff', canManageMembers: ['owner', 'organization_admin'].includes(role), store: { minOrderAmount: '0', defaultDeliveryFee: '5000' } })
    expect(snapshot.hours).toHaveLength(7)
    for (const { table, query } of queries) {
      if (table === 'stores') expect(query.eq.mock.calls).toEqual([['id', 'store-a']])
      else if (table === 'organization_members') expect(query.eq.mock.calls).toEqual([['organization_id', 'org-a'], ['user_id', uuid]])
      else expect(query.eq).toHaveBeenNthCalledWith(1, 'store_id', 'store-a')
    }
  })
})
