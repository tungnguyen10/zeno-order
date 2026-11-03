export interface PublicModes {
  dineIn: boolean
  pickup: boolean
  delivery: { enabled: boolean, available: boolean }
}

export interface PublicOptionValue {
  id: string
  name: string
  priceDeltaVnd: number
}

export interface PublicOptionGroup {
  id: string
  name: string
  required: boolean
  minSelect: number
  maxSelect: number
  values: PublicOptionValue[]
}

export interface PublicProduct {
  id: string
  categoryId: string | null
  name: string
  description: string | null
  basePriceVnd: number
  isAvailable: boolean
  imageUrl: string | null
  optionGroups: PublicOptionGroup[]
}

export interface PublicCategory {
  id: string
  name: string
}

export interface PublicMenu {
  /** Whether the store can currently receive real customer bank transfers. */
  bankQrEnabled?: boolean
  store: { name: string, slug: string, isAcceptingOrders: boolean, logoUrl: string | null }
  modes: PublicModes
  categories: PublicCategory[]
  products: PublicProduct[]
}

export interface PublicFulfillment {
  modes: PublicModes
  deliveryZones: { id: string, name: string, feeVnd: number }[]
  table: { displayName: string } | null
  tableError: 'INVALID_TABLE' | null
}

export interface CategoryDTO {
  id: string
  name: string
  position: number
  active: boolean
}

export interface OptionValueDTO {
  id: string
  name: string
  priceDeltaVnd: number
  active: boolean
  position: number
}

export interface OptionGroupDTO {
  id: string
  name: string
  required: boolean
  minSelect: number
  maxSelect: number
  position: number
  values: OptionValueDTO[]
}

export interface ProductDTO {
  id: string
  categoryId: string | null
  name: string
  description: string | null
  basePriceVnd: number
  isAvailable: boolean
  active: boolean
  position: number
  imageUrl: string | null
  optionGroups: OptionGroupDTO[]
}

export interface DeliveryZoneDTO {
  id: string
  name: string
  feeVnd: number
  active: boolean
  position: number
}

export interface TableDTO {
  id: string
  code: string
  displayName: string
  active: boolean
}

export interface TableWithQr extends TableDTO {
  qrUrl: string
}
