export default defineNuxtRouteMiddleware(async () => {
  const { load } = useMe()
  const me = await load()
  if (me.stores.length === 0) return navigateTo('/onboarding')
})
