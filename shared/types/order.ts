export interface CheckoutDraft {
  fulfillmentType: 'delivery' | 'pickup'
  customer: { name: string, phone: string }
  delivery: { address: string, note: string } | null
  customerNote: string
  paymentMethod: 'cash' | 'bank_transfer'
  turnstileToken: string
}

export interface CreateOrderResponse {
  orderNumber: string
  trackingPath: string
}
