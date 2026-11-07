import { afterEach, describe, expect, it, vi } from 'vitest'
import { proxyAuth } from '../../../server/utils/auth-proxy'

const env = { APP_BASE_URL: 'https://order.example.com', NEON_AUTH_BASE_URL: 'https://provider.example.com/neondb/auth' }
const request = (path = 'sign-in/email', init: RequestInit = {}) => new Request(`${env.APP_BASE_URL}/api/auth/${path}`, {
  method: 'POST', headers: { origin: env.APP_BASE_URL, 'content-type': 'application/json' }, body: '{}', ...init,
})
afterEach(() => vi.unstubAllGlobals())

describe('same-origin managed Auth proxy', () => {
  it('keeps sessions first-party, Secure, HttpOnly and Lax; preserves cookie deletion', async () => {
    const headers = new Headers({ 'content-type': 'application/json' })
    headers.append('set-cookie', '__Secure-neon-auth.session_token=synthetic; Domain=provider.example.com; Path=/neondb/auth; Secure; HttpOnly; SameSite=None; Partitioned; Max-Age=3600')
    headers.append('set-cookie', '__Secure-neon-auth.session_data=; Path=/; Secure; HttpOnly; Max-Age=0')
    headers.append('set-cookie', 'unrelated=must-not-forward')
    const forward = vi.fn(async () => new Response('{}', { headers }))
    const result = await proxyAuth(request(), 'sign-in/email', env, forward)
    const cookies = result.headers.getSetCookie()
    expect(cookies).toHaveLength(2)
    expect(cookies[0]).toContain('__Secure-neon-auth.session_token=synthetic')
    for (const cookie of cookies) {
      expect(cookie).toMatch(/Secure/i)
      expect(cookie).toMatch(/HttpOnly/i)
      expect(cookie).toMatch(/SameSite=Lax/i)
      expect(cookie).toMatch(/Path=\//i)
      expect(cookie).not.toMatch(/Domain=|Partitioned/i)
    }
    expect(cookies[1]).toContain('Max-Age=0')
    expect(result.headers.get('cache-control')).toBe('no-store')
  })

  it.each(['https://evil.example.com', 'null', ''])('blocks foreign or absent mutation origin %j before calling Neon', async (origin) => {
    const forward = vi.fn()
    const response = await proxyAuth(request('sign-in/email', { headers: origin ? { origin } : {} }), 'sign-in/email', env, forward)
    expect(response.status).toBe(403)
    expect(forward).not.toHaveBeenCalled()
  })

  it('rejects wrong methods and oversized credentials without contacting the provider', async () => {
    const forward = vi.fn()
    expect((await proxyAuth(request('token'), 'token', env, forward)).status).toBe(405)
    expect((await proxyAuth(request('sign-in/email', { body: 'x'.repeat(16385) }), 'sign-in/email', env, forward)).status).toBe(413)
    expect(forward).not.toHaveBeenCalled()
  })

  it('uses only configured upstream and filtered provider cookies/headers with the real SDK forwarder', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ user: null }))
    vi.stubGlobal('fetch', fetchImpl)
    const response = await proxyAuth(request('get-session', { method: 'GET', body: undefined,
      headers: { cookie: '__Secure-neon-auth.session_token=synthetic; application-secret=private', authorization: 'Bearer private', 'x-forwarded-host': 'evil.example.com' },
    }), 'get-session', env)
    expect(response.status).toBe(200)
    const [url, options] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe(`${env.NEON_AUTH_BASE_URL}/get-session`)
    const headers = new Headers(options.headers)
    expect(headers.get('origin')).toBe(env.APP_BASE_URL)
    expect(headers.get('cookie')).toContain('__Secure-neon-auth.session_token=synthetic')
    expect(headers.get('cookie')).not.toContain('application-secret')
    expect(headers.has('authorization')).toBe(false)
    expect(headers.has('x-forwarded-host')).toBe(false)
  })

  it('preserves provider denial rather than creating a local session', async () => {
    const response = await proxyAuth(request(), 'sign-in/email', env, async () => Response.json({ code: 'INVALID_EMAIL_OR_PASSWORD' }, { status: 401 }))
    expect(response.status).toBe(401)
    expect(response.headers.getSetCookie()).toEqual([])
  })
})
