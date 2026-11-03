import { describe, expect, it } from 'vitest'
import {
  createIntegrationInputSchema,
  linkAccountInputSchema,
  paymentAccountInputSchema,
  paymentAccountPatchSchema,
  sepaySecretInputSchema,
} from '#shared/schemas/payment'

const valid = { bankCode: 'vcb', accountNumber: '9988 776655', accountHolder: ' Nguyen Van A ' }

describe('paymentAccountInputSchema', () => {
  it('normalises bank code, account number and holder', () => {
    expect(paymentAccountInputSchema.parse(valid)).toEqual({
      bankCode: 'VCB',
      accountNumber: '9988776655',
      accountHolder: 'Nguyen Van A',
      vaNumber: null,
    })
  })

  it('rejects an unknown bank with an issue on bankCode', () => {
    const result = paymentAccountInputSchema.safeParse({ ...valid, bankCode: 'XXX' })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map(i => i.path[0])).toContain('bankCode')
  })

  it.each(['MSB', 'BIDV', 'OCB', 'KLB'])('requires a VA number for %s', (bankCode) => {
    const result = paymentAccountInputSchema.safeParse({ ...valid, bankCode })
    expect(result.success).toBe(false)
    const issue = result.error?.issues.find(i => i.path[0] === 'vaNumber')
    expect(issue?.message).toContain(bankCode === 'KLB' ? 'KienLongBank' : bankCode)
  })

  it('accepts a VA for a VA-only bank and normalises it', () => {
    expect(paymentAccountInputSchema.parse({ ...valid, bankCode: 'OCB', vaNumber: ' vqrq-1234 5678 ' }).vaNumber).toBe('VQRQ12345678')
  })

  it('turns an empty or blank VA into null for banks that do not need one', () => {
    expect(paymentAccountInputSchema.parse({ ...valid, vaNumber: '' }).vaNumber).toBeNull()
    expect(paymentAccountInputSchema.parse({ ...valid, vaNumber: '   ' }).vaNumber).toBeNull()
  })

  it.each(['123', '12345678901234567890', '99&88776655'])('rejects account number %j', (accountNumber) => {
    const result = paymentAccountInputSchema.safeParse({ ...valid, accountNumber })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map(i => i.path[0])).toContain('accountNumber')
  })

  it('rejects a too-short holder name', () => {
    expect(paymentAccountInputSchema.safeParse({ ...valid, accountHolder: 'A' }).success).toBe(false)
  })
})

describe('paymentAccountPatchSchema', () => {
  it('requires at least one field', () => {
    expect(paymentAccountPatchSchema.safeParse({}).success).toBe(false)
  })

  it('allows clearing the VA with null', () => {
    expect(paymentAccountPatchSchema.parse({ vaNumber: null })).toEqual({ vaNumber: null })
  })
})

describe('createIntegrationInputSchema', () => {
  it('defaults to a live SePay integration', () => {
    expect(createIntegrationInputSchema.parse({})).toEqual({ name: 'SePay', environment: 'live' })
  })

  it('rejects an unknown environment', () => {
    expect(createIntegrationInputSchema.safeParse({ environment: 'prod' }).success).toBe(false)
  })
})

describe('sepaySecretInputSchema', () => {
  it('trims the secret and keeps the optional API token', () => {
    expect(sepaySecretInputSchema.parse({ hmacSecret: '  whsec_0123456789\n', apiToken: ' tok_0123456789 ' }))
      .toEqual({ hmacSecret: 'whsec_0123456789', apiToken: 'tok_0123456789' })
  })

  it('treats the API token as optional', () => {
    expect(sepaySecretInputSchema.parse({ hmacSecret: 'whsec_0123456789' })).toEqual({ hmacSecret: 'whsec_0123456789' })
  })

  it('rejects whitespace inside the secret (e.g. a pasted sentence or URL with spaces)', () => {
    expect(sepaySecretInputSchema.safeParse({ hmacSecret: 'abc def 12345678' }).success).toBe(false)
  })

  it('rejects secrets shorter than 8 or longer than 200 characters', () => {
    expect(sepaySecretInputSchema.safeParse({ hmacSecret: 'short' }).success).toBe(false)
    expect(sepaySecretInputSchema.safeParse({ hmacSecret: 'x'.repeat(201) }).success).toBe(false)
  })

  it('never echoes the submitted value in validation issues', () => {
    const result = sepaySecretInputSchema.safeParse({ hmacSecret: 'SHORT1' })
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).not.toContain('SHORT1')
  })
})

describe('linkAccountInputSchema', () => {
  it('requires a uuid', () => {
    expect(linkAccountInputSchema.safeParse({ paymentAccountId: 'nope' }).success).toBe(false)
    expect(linkAccountInputSchema.safeParse({ paymentAccountId: crypto.randomUUID() }).success).toBe(true)
  })
})
