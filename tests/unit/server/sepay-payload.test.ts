import { describe, expect, it } from 'vitest'
import { generatePaymentCode } from '../../../server/services/payments/payment-code'
import {
  extractPaymentCode, parseSepayTransactionDate, sepayWebhookPayloadSchema, toBankTransactionInput,
} from '../../../server/services/payments/sepay-payload'

const DOC_SAMPLE = {
  id: 92704,
  gateway: 'Vietcombank',
  transactionDate: '2024-07-02 11:08:33',
  accountNumber: '1017588888',
  subAccount: '',
  code: 'SEVN63DC8E5C',
  content: 'SEVN63DC8E5C chuyen tien',
  transferType: 'in',
  description: 'NGUYEN VAN A chuyen tien',
  transferAmount: 5000000,
  accumulated: 105000000,
  referenceCode: 'FT24012345678',
}

describe('sepayWebhookPayloadSchema', () => {
  it('accepts the documented sample and stringifies the id', () => {
    const parsed = sepayWebhookPayloadSchema.parse(DOC_SAMPLE)
    expect(parsed.id).toBe('92704')
    expect(parsed.transferAmount).toBe(5_000_000)
  })

  it('accepts the test-ping id 0', () => {
    expect(sepayWebhookPayloadSchema.parse({ ...DOC_SAMPLE, id: 0 }).id).toBe('0')
  })

  it('accepts code null, empty subAccount/referenceCode/description and unknown extra fields', () => {
    const parsed = sepayWebhookPayloadSchema.parse({ ...DOC_SAMPLE, code: null, subAccount: null, referenceCode: '', description: '', extra: 1 })
    expect(parsed.code).toBeNull()
    expect(parsed).toHaveProperty('extra', 1)
  })

  it.each([
    ['zero amount', { transferAmount: 0 }],
    ['negative amount', { transferAmount: -1 }],
    ['fractional amount', { transferAmount: 1000.5 }],
    ['string amount', { transferAmount: '5000' }],
    ['unknown transferType', { transferType: 'x' }],
    ['negative id', { id: -1 }],
    ['missing id', { id: undefined }],
    ['non-numeric id', { id: 'abc' }],
    ['empty account', { accountNumber: '' }],
    ['malformed date', { transactionDate: '02/07/2024' }],
    ['impossible date', { transactionDate: '2024-13-45 99:99:99' }],
  ])('rejects %s', (_name, patch) => {
    expect(sepayWebhookPayloadSchema.safeParse({ ...DOC_SAMPLE, ...patch }).success).toBe(false)
  })
})

describe('parseSepayTransactionDate', () => {
  it('reads the timestamp as Vietnam time (UTC+7)', () => {
    expect(parseSepayTransactionDate('2024-07-02 11:08:33').toISOString()).toBe('2024-07-02T04:08:33.000Z')
  })
})

describe('extractPaymentCode', () => {
  it('prefers the code field and uppercases it', () => {
    expect(extractPaymentCode('zo1a2b3c4d', 'whatever')).toBe('ZO1A2B3C4D')
  })

  it('falls back to the transfer content when SePay sent code null', () => {
    expect(extractPaymentCode(null, 'NGUYEN VAN A chuyen tien zo1a2b3c4d cam on')).toBe('ZO1A2B3C4D')
  })

  it('keeps the first 10 characters when SePay captured a longer suffix', () => {
    expect(extractPaymentCode('ZO1A2B3C4DEF', null)).toBe('ZO1A2B3C4D')
  })

  it('returns null when nothing looks like a ZO code (no guessing by amount or substring)', () => {
    expect(extractPaymentCode(null, 'chuyen tien an trua')).toBeNull()
    expect(extractPaymentCode('SEVN63DC8E5C', 'SEVN63DC8E5C chuyen tien')).toBeNull()
    expect(extractPaymentCode('', '')).toBeNull()
    expect(extractPaymentCode(undefined, undefined)).toBeNull()
    expect(extractPaymentCode(null, 'ZO12345')).toBeNull()
  })

  it('recognises every code PR5 can generate', () => {
    for (let i = 0; i < 200; i++) {
      const code = generatePaymentCode()
      expect(extractPaymentCode(null, `thanh toan ${code.toLowerCase()}`)).toBe(code)
    }
  })
})

describe('toBankTransactionInput', () => {
  const integration = { id: 'int-1', orgId: 'org-1' }

  it('maps an incoming transfer', () => {
    const input = toBankTransactionInput(integration, sepayWebhookPayloadSchema.parse({ ...DOC_SAMPLE, code: null, content: 'ZO1A2B3C4D' }))
    expect(input).toMatchObject({
      orgId: 'org-1',
      integrationId: 'int-1',
      providerTransactionId: '92704',
      source: 'WEBHOOK',
      direction: 'IN',
      bankAccountNumber: '1017588888',
      subAccount: null,
      amountVnd: 5_000_000,
      paymentCode: 'ZO1A2B3C4D',
      referenceCode: 'FT24012345678',
    })
    expect(input.transactionDate.toISOString()).toBe('2024-07-02T04:08:33.000Z')
  })

  it('maps outgoing transfers to OUT and empty strings to null', () => {
    const input = toBankTransactionInput(integration, sepayWebhookPayloadSchema.parse({ ...DOC_SAMPLE, transferType: 'out', referenceCode: '', subAccount: '' }))
    expect(input.direction).toBe('OUT')
    expect(input.referenceCode).toBeNull()
    expect(input.subAccount).toBeNull()
  })
})

describe('strict calendar dates', () => {
  it('rejects normalized impossible dates', () => {
    expect(Number.isNaN(parseSepayTransactionDate('2026-02-30 10:00:00').getTime())).toBe(true)
  })
})
