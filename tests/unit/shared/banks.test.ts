import { describe, expect, it } from 'vitest'
import { ACCOUNT_NUMBER_PATTERN, findBank, normalizeAccountNumber, VIETQR_BANKS } from '#shared/banks'

describe('VIETQR_BANKS', () => {
  it('has unique codes and unique 6-digit bins', () => {
    expect(new Set(VIETQR_BANKS.map(b => b.code)).size).toBe(VIETQR_BANKS.length)
    expect(new Set(VIETQR_BANKS.map(b => b.bin)).size).toBe(VIETQR_BANKS.length)
    for (const bank of VIETQR_BANKS) expect(bank.bin).toMatch(/^\d{6}$/)
  })

  it('lists the 23 banks marked supported in banks.json', () => {
    expect(VIETQR_BANKS).toHaveLength(23)
  })

  it('requires a VA only for BIDV, KLB, MSB and OCB (SePay docs)', () => {
    expect(VIETQR_BANKS.filter(b => b.vaPolicy === 'REQUIRED').map(b => b.code).sort()).toEqual(['BIDV', 'KLB', 'MSB', 'OCB'])
  })

  it('flags exactly the ten banks SePay documents for webhooks', () => {
    expect(VIETQR_BANKS.filter(b => b.sepayWebhook).map(b => b.code).sort())
      .toEqual(['ACB', 'BIDV', 'ICB', 'KLB', 'MB', 'MSB', 'OCB', 'STB', 'TPB', 'VPB'])
  })

  it('pins the bins verified against banks.json on 2026-11-01', () => {
    expect(findBank('VCB')).toMatchObject({ bin: '970436', shortName: 'Vietcombank' })
    expect(findBank('ICB')).toMatchObject({ bin: '970415', shortName: 'VietinBank' })
    expect(findBank('MSB')?.bin).toBe('970426')
    expect(findBank('BIDV')?.bin).toBe('970418')
    expect(findBank('OCB')?.bin).toBe('970448')
    expect(findBank('KLB')?.bin).toBe('970452')
    expect(findBank('TCB')?.bin).toBe('970407')
  })
})

describe('findBank', () => {
  it('is case-insensitive and trims', () => {
    expect(findBank(' vcb ')?.code).toBe('VCB')
  })

  it('returns undefined for unknown or empty codes', () => {
    expect(findBank('XXX')).toBeUndefined()
    expect(findBank('')).toBeUndefined()
  })
})

describe('normalizeAccountNumber', () => {
  it('drops spaces, dots and dashes and upper-cases', () => {
    expect(normalizeAccountNumber(' 9988-776 655 ')).toBe('9988776655')
    expect(normalizeAccountNumber('vqrq1234.5678')).toBe('VQRQ12345678')
  })
})

describe('ACCOUNT_NUMBER_PATTERN', () => {
  it.each(['123456', '9988776655', 'VQRQ12345678', '1234567890123456789'])('accepts %s', (value) => {
    expect(ACCOUNT_NUMBER_PATTERN.test(value)).toBe(true)
  })

  it.each(['12345', '12345678901234567890', '99 88', 'abc123', '12345&6', ''])('rejects %j', (value) => {
    expect(ACCOUNT_NUMBER_PATTERN.test(value)).toBe(false)
  })
})
