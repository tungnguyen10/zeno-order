export function useApi() {
  const nuxtApp = useNuxtApp()
  const { $tokenCache } = nuxtApp
  const router = useRouter()
  const { clearLocalSession } = useAuth()
  return $fetch.create({
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
}
