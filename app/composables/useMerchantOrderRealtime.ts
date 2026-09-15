export function useMerchantOrderRealtime(storeId: Ref<string>, refresh: () => void | Promise<void>) {
  const client = useSupabaseClient()
  let channel: ReturnType<typeof client.channel> | null = null
  let subscribedOnce = false

  function disconnect() {
    if (channel) void client.removeChannel(channel)
    channel = null
  }

  function connect(id: string) {
    disconnect()
    if (!id || !import.meta.client) return
    channel = client.channel(`merchant-orders:${id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: `store_id=eq.${id}`,
      }, () => { void refresh() })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (subscribedOnce) void refresh()
          subscribedOnce = true
        }
      })
  }

  watch(storeId, connect, { immediate: true })
  if (import.meta.client) {
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    onScopeDispose(() => window.removeEventListener('focus', onFocus))
  }
  onScopeDispose(disconnect)
}
