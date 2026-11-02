import type { ApiErrorBody } from '#shared/errors'

export function describeAcceptError(error: ApiErrorBody): string {
  const reason = (error.details as { reason?: string } | undefined)?.reason
  if (error.code === 'FORBIDDEN' && reason === 'EMAIL_MISMATCH') {
    return 'Email của bạn không khớp với lời mời. Hãy đăng nhập bằng đúng email được mời.'
  }
  if (error.code === 'FORBIDDEN' && reason === 'EMAIL_NOT_VERIFIED') {
    return 'Bạn cần xác minh email trước khi tham gia. Hãy kiểm tra hộp thư của bạn.'
  }
  if (error.code === 'NOT_FOUND') return 'Lời mời không còn hiệu lực. Hãy nhờ chủ quán gửi lại link mới.'
  return error.message
}
