import type { ReportRange } from '../vn-date'

export interface PaymentBreakdown {
  SEPAY: number
  CASH: number
  BANK_MANUAL: number
}

export interface DailySummary {
  date: string
  totalOrders: number
  completedCount: number
  cancelledCount: number
  grossVnd: number
  collected: PaymentBreakdown
  collectedVnd: number
  outstandingVnd: number
  refundDueVnd: number
}

export interface TopProduct {
  name: string
  qty: number
  revenueVnd: number
}

export interface DayPoint {
  date: string
  orderCount: number
  grossVnd: number
  collectedVnd: number
}

export interface Report {
  range: ReportRange
  fromDate: string
  toDate: string
  orderCount: number
  cancelledCount: number
  grossVnd: number
  collectedVnd: number
  averageOrderVnd: number
  topProducts: TopProduct[]
  daily: DayPoint[]
}
