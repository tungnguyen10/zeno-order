export function useActiveStore() {
  const { me } = useMe()
  const cookie = useCookie<string | null>('zeno_active_store', { sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 })
  const stores = computed(() => me.value?.stores ?? [])
  const activeStore = computed(() => stores.value.find(store => store.id === cookie.value) ?? stores.value[0] ?? null)

  function setActiveStore(id: string): void {
    if (stores.value.some(store => store.id === id)) cookie.value = id
  }

  return { stores, activeStore, setActiveStore }
}
