import type { SepayEnvironment, SepayIntegrationStatus } from '../payment'

export interface PaymentAccountDto {
  id: string
  bankCode: string
  bankName: string
  accountNumber: string
  vaNumber: string | null
  accountHolder: string
  qrCheckedAt: string | null
  verifiedAt: string | null
  linkedIntegrationId: string | null
}

export type PaymentAccountField = 'bankCode' | 'accountNumber' | 'accountHolder' | 'vaNumber'

export interface PaymentAccountIssue {
  field: PaymentAccountField
  message: string
}

export interface PaymentAccountPreview {
  bankName: string
  /** The number encoded in the QR (the VA when the account has one). */
  accountNumber: string
  accountHolder: string
  amountVnd: number
  transferContent: string
  imageUrl: string
}

export interface PaymentAccountCheck {
  /** Binds confirmation to the exact recipient details returned with this preview. */
  revision: string | null
  ok: boolean
  issues: PaymentAccountIssue[]
  warnings: string[]
  preview: PaymentAccountPreview | null
}

export interface SepayIntegrationDto {
  webhookAuthMode?: 'HMAC' | 'APIKEY'
  id: string
  name: string
  environment: SepayEnvironment
  status: SepayIntegrationStatus
  hasSecret: boolean
  hasApiToken: boolean
  secretUpdatedAt: string | null
  lastValidWebhookAt: string | null
  updatedAt: string
  webhookUrl: string
  accountIds: string[]
}
