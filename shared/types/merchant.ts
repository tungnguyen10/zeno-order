export type OrderStatus = 'pending' | 'confirmed' | 'preparing' | 'ready' | 'delivering' | 'completed' | 'cancelled'

export interface MerchantStoreSummary {
  id: string
  publicSlug: string
  name: string
  timezone: string
  currency: string
}

export interface MerchantOrderSummary {
  id: string
  orderNumber: string
  status: OrderStatus
  fulfillmentType: 'delivery' | 'pickup'
  customerName: string
  total: string
  paymentStatus: string
  createdAt: string
  updatedAt: string
}

export interface MerchantOrderItem {
  id: string
  name: string
  unitPrice: string
  quantity: number
  lineTotal: string
  note: string | null
  options: Array<{ name: string, groupName: string, priceAdjustment: string }>
}

export interface MerchantOrderDetail extends MerchantOrderSummary {
  customerPhone: string
  deliveryAddress: string | null
  deliveryNote: string | null
  customerNote: string | null
  subtotal: string
  deliveryFee: string
  discountAmount: string
  paymentMethod: string
  items: MerchantOrderItem[]
  history: Array<{
    fromStatus: OrderStatus | null
    toStatus: OrderStatus
    note: string | null
    createdAt: string
  }>
}

export interface MerchantOrderListResponse {
  orders: MerchantOrderSummary[]
}
