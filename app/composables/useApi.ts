export function useApi() {
  const { $tokenCache } = useNuxtApp()
  return $fetch.create({
    async onRequest({ options }) {
      const token = await $tokenCache.get()
      if (!token) return
      const headers = new Headers(options.headers as HeadersInit | undefined)
      headers.set('authorization', `Bearer ${token}`)
      options.headers = headers
    },
  })
}
