export function translateAuthError(error: { code?: string, message?: string } | null | undefined): string {
  const code = error?.code ?? ''
  if (code === 'INVALID_EMAIL_OR_PASSWORD') return 'Email hoặc mật khẩu không đúng'
  if (code.startsWith('USER_ALREADY_EXISTS')) return 'Email này đã được đăng ký'
  if (code === 'PASSWORD_TOO_SHORT') return 'Mật khẩu cần ít nhất 8 ký tự'
  if (code === 'EMAIL_NOT_VERIFIED') return 'Bạn cần xác minh email trước khi đăng nhập'
  return 'Có lỗi xảy ra, vui lòng thử lại'
}
