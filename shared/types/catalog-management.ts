export type { CatalogResource } from '../schemas/catalog-management'
export type StoreMemberRole = 'owner' | 'manager' | 'staff'
export type ManagementRole = 'organization_admin' | StoreMemberRole
export interface ManagedStore {
  id: string
  organizationId: string
  publicSlug: string
  name: string
  description: string | null
  phone: string | null
  address: string | null
  logoPath: string | null
  coverPath: string | null
  timezone: string
  currency: string
  isActive: boolean
  publishedAt: string | null
  manualOpenState: 'open' | 'closed' | 'temporarily_closed' | null
  deliveryEnabled: boolean
  pickupEnabled: boolean
  minOrderAmount: string
  defaultDeliveryFee: string
  createdAt: string
  updatedAt: string
}
export interface ManagedStoreHour { id: string | null, storeId: string, dayOfWeek: number, isClosed: boolean, openTime: string | null, closeTime: string | null }
interface ManagedRow { id: string, storeId: string, createdAt: string }
export interface ManagedMenu extends ManagedRow { name: string, isActive: boolean, sortOrder: number, updatedAt: string }
export interface ManagedSection extends ManagedRow { menuId: string, name: string, slug: string, description: string | null, sortOrder: number, updatedAt: string }
export interface ManagedProduct extends ManagedRow { name: string, slug: string, description: string | null, imagePath: string | null, basePrice: string, isActive: boolean, isSoldOut: boolean, updatedAt: string }
export interface ManagedMenuItem extends ManagedRow { menuId: string, sectionId: string, productId: string, sortOrder: number }
export interface ManagedOptionGroup extends ManagedRow { name: string, selectionType: 'single' | 'multiple', required: boolean, minSelect: number, maxSelect: number, sortOrder: number, isActive: boolean, updatedAt: string }
export interface ManagedOptionValue extends ManagedRow { optionGroupId: string, name: string, priceAdjustment: string, isDefault: boolean, isActive: boolean, sortOrder: number, updatedAt: string }
export interface ManagedProductOptionGroup { storeId: string, productId: string, optionGroupId: string, sortOrder: number, createdAt: string }
export interface ManagedStoreMember { storeId: string, userId: string, role: StoreMemberRole, createdAt: string }
export interface ManagedResourceMap {
  'menus': ManagedMenu
  'sections': ManagedSection
  'products': ManagedProduct
  'menu-items': ManagedMenuItem
  'option-groups': ManagedOptionGroup
  'option-values': ManagedOptionValue
  'product-option-groups': ManagedProductOptionGroup
}
export interface CatalogManagementSnapshot {
  store: ManagedStore
  role: ManagementRole
  canManageCatalog: boolean
  canManageMembers: boolean
  hours: ManagedStoreHour[]
  menus: ManagedMenu[]
  sections: ManagedSection[]
  products: ManagedProduct[]
  menuItems: ManagedMenuItem[]
  optionGroups: ManagedOptionGroup[]
  optionValues: ManagedOptionValue[]
  productOptionGroups: ManagedProductOptionGroup[]
  members: ManagedStoreMember[]
}
