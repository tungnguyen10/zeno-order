export type StorefrontStatus = 'open' | 'closed' | 'temporarily_closed'

export interface StorefrontAvailability {
  publicSlug: string
  status: StorefrontStatus
  orderingEnabled: boolean
  fulfillment: {
    delivery: boolean
    pickup: boolean
  }
  nextOpeningAt: string | null
  products: Array<{
    productId: string
    isAvailable: boolean
  }>
}
