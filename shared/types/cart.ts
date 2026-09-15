export interface CartItemOption {
  optionGroupId: string
  optionGroupName: string
  optionValueId: string
  optionValueName: string
  priceAdjustment: string
}

export interface CartItem {
  id: string
  productId: string
  productName: string
  basePrice: string
  options: CartItemOption[]
  quantity: number
  note: string
}

export type NewCartItem = Omit<CartItem, 'id'>

export interface StoreCartDocument {
  version: 1
  publicSlug: string
  currency: string
  items: CartItem[]
}
