import { describe, expect, it } from 'vitest'
import { describeAcceptError } from '../../../app/utils/invite-errors'

describe('describeAcceptError', () => {
  it.each([
    [{ code: 'FORBIDDEN', message: 'x', details: { reason: 'EMAIL_MISMATCH' } }, 'Email của bạn không khớp với lời mời. Hãy đăng nhập bằng đúng email được mời.'],
    [{ code: 'FORBIDDEN', message: 'x', details: { reason: 'EMAIL_NOT_VERIFIED' } }, 'Bạn cần xác minh email trước khi tham gia. Hãy kiểm tra hộp thư của bạn.'],
    [{ code: 'NOT_FOUND', message: 'x' }, 'Lời mời không còn hiệu lực. Hãy nhờ chủ quán gửi lại link mới.'],
    [{ code: 'INTERNAL', message: 'Lỗi mạng' }, 'Lỗi mạng'],
  ] as const)('%j', (error, expected) => {
    expect(describeAcceptError(error as never)).toBe(expected)
  })
})
