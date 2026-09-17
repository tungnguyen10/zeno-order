import type { SupabaseClient } from '@supabase/supabase-js'
import type { z } from 'zod'
import type { CatalogManagementSnapshot, ManagedResourceMap, ManagedStore, ManagedStoreHour, ManagedStoreMember, ManagementRole } from '../../shared/types/catalog-management'
import type { CatalogResource, membershipSchema, membershipUpdateSchema, storeHoursSchema, storeSettingsSchema } from '../../shared/schemas/catalog-management'
import { parseProductOptionGroupId } from '../../shared/schemas/catalog-management'

type Row = Record<string, unknown>
type Result<T> = { data: T | null, error: { code?: string } | null }
export class CatalogManagementError extends Error {
  constructor(readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL') { super(code); this.name = 'CatalogManagementError' }
}
function check(error: Result<unknown>['error']) {
  if (!error) return
  const code = error.code
  throw new CatalogManagementError(code === '42501' ? 'FORBIDDEN' : code === 'PGRST116' ? 'NOT_FOUND' : ['23505', '23503', '23514', '23P01', 'P0001'].includes(code ?? '') ? 'CONFLICT' : 'INTERNAL')
}
function single<T>(result: Result<T>): T {
  check(result.error)
  if (!result.data) throw new CatalogManagementError('NOT_FOUND')
  return result.data
}
function list<T>(result: Result<T[]>): T[] { check(result.error); return result.data ?? [] }
const metadata: Record<CatalogResource, { table: string, fields: string, writable: string }> = {
  'menus': { table: 'menus', fields: 'id,store_id,name,is_active,sort_order,created_at,updated_at', writable: 'name,is_active,sort_order' },
  'sections': { table: 'menu_sections', fields: 'id,store_id,menu_id,name,slug,description,sort_order,created_at,updated_at', writable: 'menu_id,name,slug,description,sort_order' },
  'products': { table: 'products', fields: 'id,store_id,name,slug,description,image_path,base_price::text,is_active,is_sold_out,created_at,updated_at', writable: 'name,slug,description,base_price,is_active,is_sold_out' },
  'menu-items': { table: 'menu_items', fields: 'id,store_id,menu_id,section_id,product_id,sort_order,created_at', writable: 'menu_id,section_id,product_id,sort_order' },
  'option-groups': { table: 'option_groups', fields: 'id,store_id,name,selection_type,required,min_select,max_select,sort_order,is_active,created_at,updated_at', writable: 'name,selection_type,required,min_select,max_select,sort_order,is_active' },
  'option-values': { table: 'option_values', fields: 'id,store_id,option_group_id,name,price_adjustment::text,is_default,is_active,sort_order,created_at,updated_at', writable: 'option_group_id,name,price_adjustment,is_default,is_active,sort_order' },
  'product-option-groups': { table: 'product_option_groups', fields: 'store_id,product_id,option_group_id,sort_order,created_at', writable: 'product_id,option_group_id,sort_order' },
}
const storeFields: string = 'id,organization_id,public_slug,name,description,phone,address,logo_path,cover_path,timezone,currency,is_active,published_at,manual_open_state,delivery_enabled,pickup_enabled,min_order_amount::text,default_delivery_fee::text,created_at,updated_at'
const storeWritable = 'name,description,phone,address,logo_path,cover_path,timezone,currency,is_active,manual_open_state,delivery_enabled,pickup_enabled,min_order_amount,default_delivery_fee'
const hourFields = 'id,store_id,day_of_week,is_closed,open_time,close_time'
const memberFields = 'store_id,user_id,role,created_at'
const camel = (key: string) => key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase())
const moneyFields = new Set(['base_price', 'price_adjustment', 'min_order_amount', 'default_delivery_fee'])
function dto<T>(row: Row, fields: string): T {
  return Object.fromEntries(fields.split(',').map(selection => {
    const key = selection.split('::')[0]!
    let value = row[key]
    if (moneyFields.has(key) && value != null) value = String(value)
    if ((key === 'open_time' || key === 'close_time') && typeof value === 'string') value = value.slice(0, 5)
    return [camel(key), value]
  })) as T
}
function command(input: Row, writable: string) {
  return Object.fromEntries(writable.split(',').filter(key => input[camel(key)] !== undefined).map(key => [key, input[camel(key)]]))
}

export function createCatalogManagementRepository(client: SupabaseClient) {
  // All access uses the authenticated caller's client and remains subject to Task 1 RLS.
  const identified = <Query extends { eq: (column: string, value: string) => Query }>(query: Query, resource: CatalogResource, id: string): Query => {
    if (resource !== 'product-option-groups') return query.eq('id', id)
    const { productId, optionGroupId } = parseProductOptionGroupId(id)
    return query.eq('product_id', productId).eq('option_group_id', optionGroupId)
  }
  return {
    async getSnapshot(storeId: string, userId: string): Promise<CatalogManagementSnapshot> {
      const store = dto<ManagedStore>(single(await client.from('stores').select(storeFields).eq('id', storeId).maybeSingle()), storeFields)
      const [hoursResult, membersResult, organizationResult, ...catalogResults] = await Promise.all([
        client.from('store_hours').select(hourFields).eq('store_id', storeId).order('day_of_week'),
        client.from('store_members').select(memberFields).eq('store_id', storeId).order('created_at'),
        client.from('organization_members').select('role').eq('organization_id', store.organizationId).eq('user_id', userId).maybeSingle(),
        ...Object.values(metadata).map(meta => client.from(meta.table).select(meta.fields).eq('store_id', storeId).order(meta.table === 'products' ? 'name' : 'sort_order')),
      ])
      check(organizationResult.error)
      const members = list<Row>(membersResult).map(row => dto<ManagedStoreMember>(row, memberFields))
      const role: ManagementRole | undefined = organizationResult.data && ['owner', 'admin'].includes(organizationResult.data.role) ? 'organization_admin' : members.find(member => member.userId === userId)?.role
      if (!role) throw new CatalogManagementError('FORBIDDEN')
      const storedHours = list<Row>(hoursResult).map(row => dto<ManagedStoreHour>(row, hourFields))
      const hours = Array.from({ length: 7 }, (_, dayOfWeek) => storedHours.find(row => row.dayOfWeek === dayOfWeek) ?? { id: null, storeId, dayOfWeek, isClosed: true, openTime: null, closeTime: null })
      // Supabase's select-string parser cannot preserve a correlated row type for
      // a heterogeneous metadata-driven Promise.all result, so normalize only at
      // this boundary after PostgREST has returned the standard result shape.
      const catalog = Object.fromEntries(Object.entries(metadata).map(([resource, meta], index) => [resource, list<Row>(catalogResults[index]! as unknown as Result<Row[]>).map(row => dto(row, meta.fields))])) as { [R in CatalogResource]: ManagedResourceMap[R][] }
      return { store, role, canManageCatalog: role !== 'staff', canManageMembers: role === 'owner' || role === 'organization_admin', hours, menus: catalog.menus, sections: catalog.sections, products: catalog.products, menuItems: catalog['menu-items'], optionGroups: catalog['option-groups'], optionValues: catalog['option-values'], productOptionGroups: catalog['product-option-groups'], members }
    },
    async createResource<R extends CatalogResource>(storeId: string, resource: R, input: Row): Promise<ManagedResourceMap[R]> {
      const meta = metadata[resource]
      return dto(single(await client.from(meta.table).insert({ ...command(input, meta.writable), store_id: storeId }).select(meta.fields).maybeSingle()), meta.fields)
    },
    async updateResource<R extends CatalogResource>(storeId: string, resource: R, resourceId: string, input: Row): Promise<ManagedResourceMap[R]> {
      const meta = metadata[resource]
      const writable = resource === 'product-option-groups' ? 'sort_order' : meta.writable
      return dto(single(await identified(client.from(meta.table).update(command(input, writable)).eq('store_id', storeId), resource, resourceId).select(meta.fields).maybeSingle()), meta.fields)
    },
    async deleteResource(storeId: string, resource: CatalogResource, resourceId: string) {
      const meta = metadata[resource]
      single(await identified(client.from(meta.table).delete().eq('store_id', storeId), resource, resourceId).select(meta.fields).maybeSingle())
      return { success: true as const }
    },
    async setSoldOut(storeId: string, productId: string, isSoldOut: boolean) {
      const fields = 'id,store_id,is_sold_out,updated_at'
      return dto<Pick<ManagedResourceMap['products'], 'id' | 'storeId' | 'isSoldOut' | 'updatedAt'>>(single(await client.from('products').update({ is_sold_out: isSoldOut }).eq('store_id', storeId).eq('id', productId).select(fields).maybeSingle()), fields)
    },
    async updateSettings(storeId: string, input: z.infer<typeof storeSettingsSchema>): Promise<ManagedStore> {
      return dto(single(await client.from('stores').update(command(input, storeWritable)).eq('id', storeId).select(storeFields).maybeSingle()), storeFields)
    },
    async replaceHours(storeId: string, input: z.infer<typeof storeHoursSchema>): Promise<ManagedStoreHour[]> {
      const rows = input.map(row => ({ ...command(row, 'day_of_week,is_closed,open_time,close_time'), store_id: storeId }))
      return list<Row>(await client.from('store_hours').upsert(rows, { onConflict: 'store_id,day_of_week' }).select(hourFields).eq('store_id', storeId).order('day_of_week')).map(row => dto(row, hourFields))
    },
    async addMember(storeId: string, input: z.infer<typeof membershipSchema>): Promise<ManagedStoreMember> {
      return dto(single(await client.from('store_members').insert({ store_id: storeId, user_id: input.userId, role: input.role }).select(memberFields).maybeSingle()), memberFields)
    },
    async updateMember(storeId: string, userId: string, input: z.infer<typeof membershipUpdateSchema>): Promise<ManagedStoreMember> {
      return dto(single(await client.from('store_members').update({ role: input.role }).eq('store_id', storeId).eq('user_id', userId).select(memberFields).maybeSingle()), memberFields)
    },
    async removeMember(storeId: string, userId: string) {
      single(await client.from('store_members').delete().eq('store_id', storeId).eq('user_id', userId).select(memberFields).maybeSingle())
      return { success: true as const }
    },
  }
}
