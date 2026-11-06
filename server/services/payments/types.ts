import type { BankTxSource, BankTxStatus, ReviewReason } from '../../../shared/payments'

export interface BankTransactionInput {
  bankCode?: string | null
  orgId: string
  integrationId: string
  providerTransactionId: string
  source: BankTxSource
  direction: 'IN' | 'OUT'
  bankAccountNumber: string
  subAccount: string | null
  amountVnd: number
  paymentCode: string | null
  content: string | null
  referenceCode: string | null
  transactionDate: Date
  rawPayload: unknown
}

export interface RecordResult {
  id: string
  created: boolean
  status: BankTxStatus
}

export type MatchOutcome =
  | { kind: 'MATCHED', orderId: string, late: boolean }
  | { kind: 'REVIEW', reason: ReviewReason, orderId: string | null }
  | { kind: 'IGNORED' }
  | { kind: 'SKIPPED', status: BankTxStatus }
