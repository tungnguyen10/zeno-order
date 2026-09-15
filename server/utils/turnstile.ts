interface TurnstileResult {
  success?: boolean
}

export function createTurnstileVerifier(
  secretKey: string,
  fetcher: typeof fetch = globalThis.fetch,
) {
  return async (input: { token: string, remoteIp: string, idempotencyKey: string }) => {
    const body = new FormData()
    body.set('secret', secretKey)
    body.set('response', input.token)
    body.set('remoteip', input.remoteIp)
    body.set('idempotency_key', input.idempotencyKey)

    try {
      const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(5_000),
      })
      if (!response.ok) return false
      const result = await response.json() as TurnstileResult
      return result.success === true
    }
    catch {
      return false
    }
  }
}
