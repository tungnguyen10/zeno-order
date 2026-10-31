export function decodeJwtExp(token: string): number | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const payload = JSON.parse(atob(padded)) as { exp?: unknown }
    return typeof payload.exp === 'number' ? payload.exp : null
  }
  catch {
    return null
  }
}

export function isTokenFresh(token: string, nowSec: number, skewSec = 60): boolean {
  const exp = decodeJwtExp(token)
  return exp !== null && exp - skewSec > nowSec
}

interface TokenSource {
  token: () => Promise<{ data?: { token?: string } | null }>
}

export function createTokenCache(source: TokenSource, now: () => number = () => Math.floor(Date.now() / 1000)) {
  let current: string | null = null
  let inflight: Promise<string | null> | null = null

  async function get(): Promise<string | null> {
    if (current && isTokenFresh(current, now())) return current
    inflight ??= source.token()
      .then((result) => {
        current = result.data?.token ?? null
        return current
      })
      .finally(() => {
        inflight = null
      })
    return inflight
  }

  function clear(): void {
    current = null
  }

  return { get, clear }
}
