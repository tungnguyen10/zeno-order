import { createAuthClient } from '@neon/auth'

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  if (!config.public.neonAuthUrl) {
    throw new Error('runtimeConfig.public.neonAuthUrl is empty — set NEON_AUTH_BASE_URL at build time')
  }
  const authClient = createAuthClient(config.public.neonAuthUrl)
  const tokenCache = createTokenCache({
    token: createSessionTokenSource({
      getSession: () => authClient.getSession(),
      forceFetchToken: () => authClient.$fetch<{ token: string }>('/token', {
        method: 'GET',
        headers: { 'X-Force-Fetch': 'true' },
      }),
    }),
  })
  return { provide: { authClient, tokenCache } }
})
