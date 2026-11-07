import { extractNeonAuthCookies, handleAuthRequest, parseSetCookies, serializeSetCookie } from '@neon/auth/server'

// Fixed routes only: never accept an upstream host/path from browser input.
export const AUTH_PROXY_ROUTES = {
  'sign-up/email': 'POST', 'sign-in/email': 'POST', 'sign-out': 'POST',
  'get-session': 'GET', 'token': 'GET',
} as const

export async function proxyAuth(request: Request, path: keyof typeof AUTH_PROXY_ROUTES,
  env = process.env, forward = handleAuthRequest): Promise<Response> {
  const app = new URL(env.APP_BASE_URL ?? '')
  const upstream = new URL(env.NEON_AUTH_BASE_URL ?? '')
  if (upstream.protocol !== 'https:' || upstream.username || upstream.password || upstream.search || upstream.hash) throw new Error('Invalid Auth upstream')
  if (request.method !== AUTH_PROXY_ROUTES[path]) return new Response(null, { status: 405 })
  // Enforce the configured application origin, never Host/X-Forwarded-Host.
  const origin = request.headers.get('origin')
  if ((origin && origin !== app.origin) || (request.method === 'POST' && origin !== app.origin)) {
    return new Response(null, { status: 403 })
  }
  const headers = new Headers()
  for (const key of ['content-type', 'x-force-fetch', 'x-neon-client-info']) {
    const value = request.headers.get(key)
    if (value) headers.set(key, value)
  }
  headers.set('origin', app.origin)
  headers.set('cookie', extractNeonAuthCookies(request.headers))
  const body = request.method === 'POST' ? await request.text() : undefined
  if (body && Buffer.byteLength(body) > 16_384) return new Response(null, { status: 413 })
  const result = await forward(upstream.href.replace(/\/$/, ''), new Request(`${app.origin}/api/auth/${path}${new URL(request.url).search}`, {
    method: request.method, headers, body,
  }), path)
  const out = new Headers({ 'cache-control': 'no-store' })
  for (const key of ['content-type', 'set-auth-jwt', 'set-auth-token']) {
    const value = result.headers.get(key)
    if (value) out.set(key, value)
  }
  for (const raw of result.headers.getSetCookie()) {
    for (const cookie of parseSetCookies(raw)) {
      if (!cookie.name.startsWith('__Secure-neon-auth.')) continue
      // Host-only first-party cookies; preserve HttpOnly, expiry and deletion.
      out.append('set-cookie', serializeSetCookie({ ...cookie, domain: undefined, path: '/', secure: true, httpOnly: true, sameSite: 'lax', partitioned: undefined }))
    }
  }
  // No local session cache or alternate issuer: every session/token remains provider-backed.
  return new Response(result.body, { status: result.status, headers: out })
}
