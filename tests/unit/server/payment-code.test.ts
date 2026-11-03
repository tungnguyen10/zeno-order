import { describe, expect, it, vi } from 'vitest'
import { VIETQR_BANKS } from '#shared/banks'
import {
  buildTransferContent,
  buildVietQrUrl,
  generatePaymentCode,
  PAYMENT_CODE_PATTERN,
  PAYMENT_TEST_CODE,
  QR_IMAGE_ORIGIN,
} from '../../../server/services/payments/payment-code'

describe('generatePaymentCode', () => {
  it('returns ZO + 8 characters of [A-Z0-9]', () => {
    for (let i = 0; i < 200; i++) expect(generatePaymentCode()).toMatch(PAYMENT_CODE_PATTERN)
  })

  it('maps random indexes onto the alphabet A-Z then 0-9', () => {
    const random = vi.fn().mockReturnValue(0)
    expect(generatePaymentCode(random)).toBe('ZOAAAAAAAA')
    expect(random).toHaveBeenCalledWith(36)
    expect(generatePaymentCode(() => 25)).toBe('ZOZZZZZZZZ')
    expect(generatePaymentCode(() => 26)).toBe('ZO00000000')
    expect(generatePaymentCode(() => 35)).toBe('ZO99999999')
  })

  it('does not repeat itself in practice', () => {
    const codes = new Set(Array.from({ length: 500 }, () => generatePaymentCode()))
    expect(codes.size).toBe(500)
  })

  it('the QR-check code is itself a valid payment code', () => {
    expect(PAYMENT_TEST_CODE).toMatch(PAYMENT_CODE_PATTERN)
  })
})

describe('buildTransferContent', () => {
  it('is the bare code for most banks', () => {
    expect(buildTransferContent('VCB', 'ZOABCD1234')).toBe('ZOABCD1234')
    expect(buildTransferContent('mb', 'ZOABCD1234')).toBe('ZOABCD1234')
  })

  it('prefixes SEVQR for VietinBank so SePay receives the transaction (F4)', () => {
    expect(buildTransferContent('ICB', 'ZOABCD1234')).toBe('SEVQR ZOABCD1234')
  })

  it('stays within the 50 character / no-special-character limit for every bank (F10)', () => {
    for (const bank of VIETQR_BANKS) expect(buildTransferContent(bank.code, 'ZOABCD1234')).toMatch(/^[A-Z0-9 ]{1,50}$/)
  })

  it.each(['zoabcd1234', 'ZOABCD123', 'ZOABCD12345', 'XXABCD1234', 'ZOABCD123!', ''])('rejects the malformed code %j', (code) => {
    expect(() => buildTransferContent('VCB', code)).toThrow(RangeError)
  })

  it('rejects an unknown bank', () => {
    expect(() => buildTransferContent('XXX', 'ZOABCD1234')).toThrow(RangeError)
  })
})

describe('buildVietQrUrl', () => {
  const base = { bankCode: 'VCB', accountNumber: '9988776655', amountVnd: 100_000, paymentCode: 'ZOABCD1234' }

  it('builds the SePay QR url with bin, amount and payment code (F1, F2)', () => {
    expect(buildVietQrUrl(base)).toBe(
      'https://vietqr.app/img?acc=9988776655&bank=970436&amount=100000&des=ZOABCD1234&template=qronly',
    )
  })

  it('uses the documented image origin', () => {
    expect(QR_IMAGE_ORIGIN).toBe('https://vietqr.app/img')
    expect(buildVietQrUrl(base).startsWith(`${QR_IMAGE_ORIGIN}?`)).toBe(true)
  })

  it('adds SEVQR and encodes the space for VietinBank (F4)', () => {
    const url = buildVietQrUrl({ ...base, bankCode: 'ICB' })
    expect(url).toContain('bank=970415')
    expect(url).toContain('des=SEVQR%20ZOABCD1234')
  })

  it('round-trips every parameter through URL parsing', () => {
    const params = new URL(buildVietQrUrl({ ...base, bankCode: 'ICB', accountNumber: 'VQRQ12345678', amountVnd: 70_000 })).searchParams
    expect(Object.fromEntries(params)).toEqual({
      acc: 'VQRQ12345678',
      bank: '970415',
      amount: '70000',
      des: 'SEVQR ZOABCD1234',
      template: 'qronly',
    })
  })

  it('refuses unknown banks because the host answers 200 text/html for them (F2)', () => {
    expect(() => buildVietQrUrl({ ...base, bankCode: 'XXX' })).toThrow(RangeError)
  })

  it.each([0, -1, 1.5, Number.NaN, 10_000_000_000_000])('refuses the amount %s', (amountVnd) => {
    expect(() => buildVietQrUrl({ ...base, amountVnd })).toThrow(RangeError)
  })

  it('accepts the largest 13-digit amount', () => {
    expect(buildVietQrUrl({ ...base, amountVnd: 9_999_999_999_999 })).toContain('amount=9999999999999')
  })

  it.each(['12345', '99 88 77', '9988776655&bank=970418', 'abc123'])('refuses the account number %j', (accountNumber) => {
    expect(() => buildVietQrUrl({ ...base, accountNumber })).toThrow(RangeError)
  })

  it('refuses a payment code that could inject query parameters', () => {
    expect(() => buildVietQrUrl({ ...base, paymentCode: 'ZOAB&amount=1' })).toThrow(RangeError)
  })
})
