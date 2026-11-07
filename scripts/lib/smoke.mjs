export async function runSmoke({ baseUrl, slug, opsSecret, fetchImpl = fetch }) {
  const base = new URL(baseUrl)
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/' || base.protocol !== 'https:') throw new Error('Smoke requires an HTTPS origin without credentials')
  const failures = []
  const routes = ['/api/health', '/login', '/api/internal/status', ...(slug ? [`/api/public/stores/${encodeURIComponent(slug)}/menu`] : [])]
  for (const path of routes) {
    try {
      const response = await fetchImpl(base.origin + path, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: path === '/api/internal/status' && opsSecret ? { authorization: `Bearer ${opsSecret}` } : {} })
      const expected = path === '/api/internal/status' && !opsSecret ? 401 : 200
      if (response.status !== expected) failures.push(`Unexpected status for ${path === '/api/internal/status' ? 'ops' : 'public'} probe`)
      for (const [header, value] of [['x-content-type-options', 'nosniff'], ['x-frame-options', 'DENY'], ['referrer-policy', 'no-referrer']]) if (response.headers.get(header) !== value) failures.push(`Missing ${header}`)
      if (!response.headers.get('strict-transport-security')) failures.push('Missing HSTS')
      if (!response.headers.get('content-security-policy')?.includes("frame-ancestors 'none'")) failures.push('Missing CSP')
      if (path === '/api/internal/status' && !response.headers.get('cache-control')?.includes('no-store')) failures.push('Ops response may be cached')
    }
    catch { failures.push('Smoke request failed') }
  }
  return failures
}
