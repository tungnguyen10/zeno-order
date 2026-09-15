export interface PublicOrderTracking {
  orderNumber: string
  status: 'pending' | 'confirmed' | 'preparing' | 'ready' | 'delivering' | 'completed' | 'cancelled'
  fulfillmentType: 'delivery' | 'pickup'
  paymentMethod: 'cash' | 'bank_transfer'
  paymentStatus: 'unpaid' | 'pending' | 'paid' | 'failed' | 'refunded'
  customerNote: string | null
  items: Array<{
    name: string
    unitPrice: string
    quantity: number
    lineTotal: string
    note: string | null
    options: Array<{ groupName: string, name: string, priceAdjustment: string }>
  }>
  totals: {
    subtotal: string
    deliveryFee: string
    discountAmount: string
    total: string
    currency: string
  }
  createdAt: string
  updatedAt: string
}
