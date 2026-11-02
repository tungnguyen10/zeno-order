import { describe, expect, it } from 'vitest'
import { maskPhone, normalizeVnPhone } from '#shared/phone'

describe('normalizeVnPhone', () => {
  it.each([
    ['0912345678', '0912345678'],
    ['+84912345678', '0912345678'],
    ['84912345678', '0912345678'],
    ['0912 345 678', '0912345678'],
    ['0912.345.678', '0912345678'],
    ['091-234-5678', '0912345678'],
    ['  (+84) 912 345 678  ', '0912345678'],
    ['0351234567', '0351234567'],
    ['0561234567', '0561234567'],
    ['0771234567', '0771234567'],
    ['0881234567', '0881234567'],
  ])('accepts %j as %s', (input, expected) => {
    expect(normalizeVnPhone(input)).toBe(expected)
  })

  it.each([
    '',
    '   ',
    'abcdefghij',
    '091234567',
    '09123456789',
    '0212345678',
    '0412345678',
    '0612345678',
    '0112345678',
    '+8491234567',
    '+840912345678',
    '+1 415 555 0132',
    '0912 345 67a',
  ])('rejects %j', (input) => {
    expect(normalizeVnPhone(input)).toBeNull()
  })
})

describe('maskPhone', () => {
  it('keeps only the last 3 digits', () => {
    expect(maskPhone('0912345678')).toBe('*******678')
  })

  it('passes null through and never throws on short input', () => {
    expect(maskPhone(null)).toBeNull()
    expect(maskPhone('12')).toBe('12')
  })
})
