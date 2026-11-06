function origin(value: string | undefined): string | undefined {
  try {
    const url = new URL(value ?? '')
    return url.protocol === 'https:' ? url.origin : undefined
  }
  catch { return undefined }
}

export function securityHeaders(path: string, env = process.env): Record<string, string> {
  const auth = origin(env.NEON_AUTH_BASE_URL)
  const storage = origin(env.AWS_ENDPOINT_URL_S3)
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    // Nuxt hydration/color-mode and UI dynamic styles currently require inline sources.
    // This is a baseline policy, not a nonce-based strict CSP. No unsafe-eval.
    'Content-Security-Policy': [
      "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'",
      "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'", "font-src 'self' data:",
      `img-src 'self' data: blob: https://qr.sepay.vn${storage ? ` ${storage}` : ''}`,
      `connect-src 'self'${auth ? ` ${auth}` : ''}`, "frame-src 'none'",
    ].join('; '),
  }
  if (env.NODE_ENV === 'production') headers['Strict-Transport-Security'] = 'max-age=31536000'
  if (/^\/(?:api|app|o|invite|login|signup|onboarding)(?:\/|$)/.test(path.toLowerCase())) {
    headers['Cache-Control'] = 'no-store'
    headers['X-Robots-Tag'] = 'noindex, nofollow'
  }
  return headers
}
