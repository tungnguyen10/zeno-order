import { describe, expect, it } from 'vitest'
import { extractApiError } from '../../../app/utils/api-error'
import { translateAuthError } from '../../../app/utils/auth-errors'
import { safeRedirect } from '../../../app/utils/safe-redirect'

describe('extractApiError', () => {
  it('returns the API body from a FetchError-like object', () => {
    expect(extractApiError({ data: { code: 'SLUG_TAKEN', message: 'Đã dùng', details: { field: 'storeSlug' } } }))
      .toEqual({ code: 'SLUG_TAKEN', message: 'Đã dùng', details: { field: 'storeSlug' } })
  })

  it('falls back to a network message', () => {
    expect(extractApiError(new TypeError('Failed to fetch'))).toEqual({
      code: 'INTERNAL',
      message: 'Không kết nối được máy chủ, vui lòng thử lại',
    })
  })
})

describe('translateAuthError', () => {
  it.each([
    ['INVALID_EMAIL_OR_PASSWORD', 'Email hoặc mật khẩu không đúng'],
    ['USER_ALREADY_EXISTS', 'Email này đã được đăng ký'],
    ['USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', 'Email này đã được đăng ký'],
    ['PASSWORD_TOO_SHORT', 'Mật khẩu cần ít nhất 8 ký tự'],
    ['EMAIL_NOT_VERIFIED', 'Bạn cần xác minh email trước khi đăng nhập'],
  ])('%s', (code, message) => {
    expect(translateAuthError({ code })).toBe(message)
  })

  it('falls back to a generic message', () => {
    expect(translateAuthError({ code: 'WHATEVER' })).toBe('Có lỗi xảy ra, vui lòng thử lại')
    expect(translateAuthError(null)).toBe('Có lỗi xảy ra, vui lòng thử lại')
  })
})

describe('safeRedirect', () => {
  it.each([
    ['/app/settings', '/app/settings'],
    ['//evil.com', '/app'],
    ['/\\evil.com', '/app'],
    ['https://evil.com', '/app'],
    [undefined, '/app'],
    [['/a', '/b'], '/app'],
  ])('%s → %s', (input, expected) => {
    expect(safeRedirect(input)).toBe(expected)
  })
})
