import { normalizeBank } from './bank-identity'
import { z } from 'zod'
import type { BankTransactionInput } from './types'

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

// SePay documents transactionDate as Vietnam local time without an offset.
export function parseSepayTransactionDate(value: string): Date {
  const date = new Date(`${value.replace(' ', 'T')}+07:00`)
  if (!Number.isFinite(date.getTime()) || new Date(date.getTime() + 7 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ') !== value) return new Date(Number.NaN)
  return date
}

const nullableText = z.string().nullish().transform(value => value ?? null)

export const sepayWebhookPayloadSchema = z.looseObject({
  // Zero is retained until the real dashboard ping contract is verified; never discard money by id.
  id: z.union([z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), z.string().regex(/^\d{1,18}$/)]).transform(value => String(value)),
  gateway: nullableText,
  transactionDate: z.string().regex(DATE_SHAPE).refine(value => !Number.isNaN(parseSepayTransactionDate(value).getTime())),
  accountNumber: z.string().trim().min(1).max(64),
  subAccount: nullableText,
  code: nullableText,
  content: z.string().nullish().transform(value => value ?? ''),
  transferType: z.enum(['in', 'out']),
  description: nullableText,
  transferAmount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  accumulated: z.number().nullish(),
  referenceCode: nullableText,
})

export type SepayWebhookPayload = z.output<typeof sepayWebhookPayloadSchema>

// Same alphabet/length PR5's generatePaymentCode() emits: "ZO" + 8 of [A-Z0-9].
const PAYMENT_CODE = /ZO[A-Z0-9]{8}/

export function extractPaymentCode(code: string | null | undefined, content: string | null | undefined): string | null {
  for (const source of [code, content]) {
    if (!source) continue
    const match = PAYMENT_CODE.exec(source.toUpperCase())
    if (match) return match[0]
  }
  return null
}

const emptyToNull = (value: string | null | undefined): string | null => (value ? value : null)

export function toBankTransactionInput(
  integration: { id: string, orgId: string },
  payload: SepayWebhookPayload,
): BankTransactionInput {
  return {
    bankCode: normalizeBank(payload.gateway),
    orgId: integration.orgId,
    integrationId: integration.id,
    providerTransactionId: payload.id,
    source: 'WEBHOOK',
    direction: payload.transferType === 'in' ? 'IN' : 'OUT',
    bankAccountNumber: payload.accountNumber,
    subAccount: emptyToNull(payload.subAccount),
    amountVnd: payload.transferAmount,
    paymentCode: extractPaymentCode(payload.code, payload.content),
    content: emptyToNull(payload.content),
    referenceCode: emptyToNull(payload.referenceCode),
    transactionDate: parseSepayTransactionDate(payload.transactionDate),
    rawPayload: payload,
  }
}
