import type { NeonAuthClient } from '~/lib/neon-auth-client'

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  if (!config.public.neonAuthUrl) {
    throw new Error('runtimeConfig.public.neonAuthUrl is empty — set NEON_AUTH_BASE_URL at build time')
  }
  // Loaded on first use so pages that never touch auth (landing) don't ship the auth client up front.
  const getAuthClient = memoizeAsync<NeonAuthClient>(async () => {
    const { createNeonAuthClient } = await import('~/lib/neon-auth-client')
    return createNeonAuthClient(`${window.location.origin}/api/auth`)
  })
  const tokenCache = createTokenCache({
    token: createSessionTokenSource({
      getSession: async () => (await getAuthClient()).getSession(),
      forceFetchToken: async () => (await getAuthClient()).$fetch<{ token: string }>('/token', {
        method: 'GET',
        headers: { 'X-Force-Fetch': 'true' },
      }),
    }),
  })
  return { provide: { getAuthClient, tokenCache } }
})
