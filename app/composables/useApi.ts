import type { NitroFetchOptions } from 'nitropack'

// API responses are explicitly typed by callers; avoid recursive Nitro route inference for dynamic IDs.
export function useApi() {
  const nuxtApp = useNuxtApp()
  const { $tokenCache } = nuxtApp
  const router = useRouter()
  const { clearLocalSession } = useAuth()
  const client = $fetch.create({
    async onRequest({ options }) {
      const token = await $tokenCache.get()
      if (!token) return
      const headers = new Headers(options.headers as HeadersInit | undefined)
      headers.set('authorization', `Bearer ${token}`)
      options.headers = headers
    },
    async onResponseError({ response }) {
      if (response.status !== 401) return
      clearLocalSession()
      const current = router.currentRoute.value
      if (current.path === '/login') return
      await nuxtApp.runWithContext(() => navigateTo({ path: '/login', query: { redirect: current.fullPath } }))
    },
  })
  return <T = unknown>(request: string, options?: NitroFetchOptions<string>) => client<T, string>(request, options)
}
