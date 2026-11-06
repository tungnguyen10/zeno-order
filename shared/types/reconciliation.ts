import type { BankTxStatus, Resolution, ReviewReason } from '../payments'

export interface OrderBrief {
  id: string
  storeId: string
  publicCode: string
  status: string
  paymentStatus: string
  totalVnd: number
}

export interface ReviewItem {
  id: string
  status: BankTxStatus
  reason: ReviewReason | null
  amountVnd: number
  accountLast4: string
  content: string | null
  referenceCode: string | null
  source: 'WEBHOOK' | 'RECONCILE'
  transactionDate: string
  receivedAt: string
  resolution: Resolution | null
  matchedOrder: OrderBrief | null
  suggestedOrders: OrderBrief[]
}

export interface RefundDueOrder {
  id: string
  publicCode: string
  totalVnd: number
  heldVnd: number
  createdAt: string
}

export interface OverdueOrder {
  id: string
  publicCode: string
  totalVnd: number
  paymentStatus: 'PENDING' | 'REVIEW_REQUIRED'
  createdAt: string
}

export interface ReconciliationSummary {
  reviewCount: number
  refundDueCount: number
  overdueCount: number
}
