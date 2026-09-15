export type CatalogSelectionType = 'single' | 'multiple'

export interface StorefrontCatalog {
  store: {
    publicSlug: string
    name: string
    description: string | null
    logoPath: string | null
    coverPath: string | null
    timezone: string
    currency: string
  }
  menus: Array<{
    id: string
    name: string
  }>
  sections: Array<{
    id: string
    menuId: string
    name: string
    slug: string
    description: string | null
  }>
  menuItems: Array<{
    id: string
    menuId: string
    sectionId: string
    productId: string
  }>
  products: Array<{
    id: string
    name: string
    slug: string
    description: string | null
    basePrice: string
    imagePath: string | null
  }>
  optionGroups: Array<{
    id: string
    name: string
    selectionType: CatalogSelectionType
    required: boolean
    minSelect: number
    maxSelect: number
    values: Array<{
      id: string
      name: string
      priceAdjustment: string
      isDefault: boolean
    }>
  }>
  productOptionGroups: Array<{
    productId: string
    optionGroupId: string
  }>
}
