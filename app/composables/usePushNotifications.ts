import { urlBase64ToUint8Array } from '../utils/push'

/** Owner/staff opt-in for Web Push notifications of new orders. Degrades silently where push is unavailable. */
export function usePushNotifications() {
  const config = useRuntimeConfig()
  const api = useApi()
  const vapidKey = config.public.vapidPublicKey

  const supported = ref(false)
  const enabled = ref(false)
  const busy = ref(false)

  onMounted(async () => {
    supported.value = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!vapidKey
    if (!supported.value) return
    const registration = await navigator.serviceWorker.ready.catch(() => null)
    const subscription = await registration?.pushManager.getSubscription().catch(() => null)
    enabled.value = !!subscription
  })

  async function enable(storeId: string): Promise<void> {
    if (!supported.value || busy.value) return
    busy.value = true
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') return
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast: the view is ArrayBuffer-backed, but the lib types it as the wider ArrayBufferLike.
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
      })
      const json = subscription.toJSON()
      await api(`/api/stores/${storeId}/push/subscribe`, { method: 'POST', body: { endpoint: json.endpoint, keys: json.keys } })
      enabled.value = true
    }
    finally {
      busy.value = false
    }
  }

  async function disable(storeId: string): Promise<void> {
    if (busy.value) return
    busy.value = true
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        await api(`/api/stores/${storeId}/push/subscribe`, { method: 'DELETE', body: { endpoint: subscription.endpoint } }).catch(() => {})
        await subscription.unsubscribe().catch(() => false)
      }
      enabled.value = false
    }
    finally {
      busy.value = false
    }
  }

  return { supported, enabled, busy, enable, disable }
}
