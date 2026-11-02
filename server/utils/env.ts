export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing env ${name}`)
  return value
}

export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')
}

// Mặc định bật; chỉ tắt khi đặt đúng chuỗi "false" (môi trường dev/E2E dùng Neon Auth không bắt xác minh email).
export function inviteRequiresVerifiedEmail(): boolean {
  return process.env.INVITE_REQUIRE_VERIFIED_EMAIL !== 'false'
}
