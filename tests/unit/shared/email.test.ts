import { describe, expect, it } from 'vitest'
import { maskEmail } from '../../../shared/email'

describe('maskEmail', () => {
  it.each([
    ['staff@example.com', 's***@example.com'],
    ['a@b.vn', 'a***@b.vn'],
    ['Nhan.Vien@Gmail.com', 'N***@Gmail.com'],
    ['no-at-sign', '***'],
    ['', '***'],
  ])('%j → %j', (input, expected) => {
    expect(maskEmail(input)).toBe(expected)
  })
})
