import { safeRedirect } from './safe-redirect'

/** Người được mời đăng ký xong phải quay lại link mời, không bị đẩy vào onboarding tạo quán mới. */
export function afterSignUpTarget(redirect: unknown): string {
  const target = safeRedirect(redirect, '/onboarding')
  return target.startsWith('/invite/') ? target : '/onboarding'
}
