import { toValue, type MaybeRefOrGetter } from 'vue'
import { addRecentOrder, parseRecentOrders, recentForStore, type RecentOrder } from '../utils/recent-orders'

const STORAGE_KEY = 'zeno:orders'

function read(): RecentOrder[] {
  try {
    return parseRecentOrders(localStorage.getItem(STORAGE_KEY))
  }
  catch {
    return []
  }
}

/** The customer's own device is the only place that knows their tracking links, since there is no account. */
export function useRecentOrders() {
  const list = useState<RecentOrder[]>(STORAGE_KEY, () => [])
  const ready = useState<boolean>(`${STORAGE_KEY}:ready`, () => false)

  onMounted(() => {
    if (ready.value) return
    list.value = read()
    ready.value = true
  })

  return {
    add(entry: RecentOrder) {
      list.value = addRecentOrder(ready.value ? list.value : read(), entry)
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list.value))
      }
      catch {
        // Not persisting is acceptable: the order page itself is reachable from the redirect.
      }
    },
    forStore: (slug: MaybeRefOrGetter<string>) => computed(() => recentForStore(list.value ?? [], toValue(slug), Date.now())),
  }
}
