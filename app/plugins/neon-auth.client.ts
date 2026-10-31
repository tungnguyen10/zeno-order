import { createAuthClient } from '@neon/auth'

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  if (!config.public.neonAuthUrl) {
    throw new Error('runtimeConfig.public.neonAuthUrl is empty — set NEON_AUTH_BASE_URL at build time')
  }
  const authClient = createAuthClient(config.public.neonAuthUrl)
  // The typed client omits the JWT plugin's `token()` action, so call its endpoint (GET /token) directly.
  // @neon/auth throws on non-2xx; a 401 means "signed out", which the cache represents as null.
  const tokenCache = createTokenCache({
    token: async () => {
      try {
        return await authClient.$fetch<{ token: string }>('/token', { method: 'GET' })
      }
      catch (err) {
        if ((err as { status?: number } | null)?.status === 401) return { data: null }
        throw err
      }
    },
  })
  return { provide: { authClient, tokenCache } }
})
