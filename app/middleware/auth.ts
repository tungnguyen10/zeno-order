export default defineNuxtRouteMiddleware(async (to) => {
  const { user, ready, refresh } = useAuth()
  if (!ready.value) await refresh()
  if (!user.value) return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
})
