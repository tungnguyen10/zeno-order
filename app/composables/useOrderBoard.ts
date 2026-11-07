import type { OrderStatus } from '#shared/enums'
import type { BoardTab } from '#shared/order-flow'
import type { BoardOrder, BoardResponse } from '#shared/types/orders'
import { applyStatus, emptyCounts, mergePage, shiftCounts, type TabCounts } from '~/utils/order-board'
import { orderActionToast } from '~/utils/order-view'

const PAGE = 30
const MAX_REFRESH = 100

export function useOrderBoard(storeId: Ref<string | null>) {
  const api = useApi()
  const toast = useToast()

  const tab = ref<BoardTab>('new')
  const orders = ref<BoardOrder[]>([])
  const counts = ref<TabCounts>(emptyCounts())
  const newOrderIds = ref<string[]>([])
  const nextCursor = ref<string | null>(null)
  const loading = ref(false)
  const loadingMore = ref(false)
  const loadError = ref<string | null>(null)
  const stale = ref(false)
  const lastUpdated = ref<string | null>(null)
  const busyIds = ref<Set<string>>(new Set())

  // Mỗi thao tác/tải mới tăng version; phản hồi cũ hơn version hiện tại bị bỏ để không ghi đè trạng thái mới.
  let version = 0
  let reloadEpoch = 0
  const pendingStores = new Map<string, string>()
  let refreshing = false
  let refreshSequence = 0
  let pageSequence = 0
  let loadedStore: string | null = null
  const scope = () => `${storeId.value}:${tab.value}`

  const base = () => `/api/stores/${storeId.value}/orders`

  function invalidatePage() {
    pageSequence++
    loadingMore.value = false
  }

  function applyResponse(res: BoardResponse) {
    invalidatePage()
    loadError.value = null
    orders.value = res.orders
    nextCursor.value = res.nextCursor
    counts.value = res.counts
    newOrderIds.value = res.newOrderIds
    lastUpdated.value = res.serverTime
    stale.value = false
  }

  async function reload() {
    reloadEpoch++
    const mine = ++version
    refreshSequence++
    const context = scope()
    refreshing = false
    invalidatePage()
    stale.value = false
    if (loadedStore !== storeId.value) {
      counts.value = emptyCounts()
      newOrderIds.value = []
      lastUpdated.value = null
      loadedStore = storeId.value
    }
    if (!storeId.value) {
      orders.value = []
      nextCursor.value = null
      loading.value = false
      loadError.value = null
      return
    }
    loading.value = true
    loadError.value = null
    orders.value = []
    nextCursor.value = null
    try {
      const res = await api<BoardResponse>(base(), { query: { tab: tab.value, limit: PAGE } })
      if (mine === version && context === scope()) applyResponse(res)
    }
    catch (err) {
      if (mine === version && context === scope()) loadError.value = extractApiError(err).message
    }
    finally {
      if (mine === version) loading.value = false
    }
  }

  async function refresh(force = false) {
    if (!storeId.value || loading.value || (refreshing && !force)) return
    if ([...pendingStores.values()].includes(storeId.value)) return
    refreshing = true
    const mine = version
    const sequence = ++refreshSequence
    const context = scope()
    try {
      const limit = Math.min(MAX_REFRESH, Math.max(PAGE, orders.value.length))
      const res = await api<BoardResponse>(base(), { query: { tab: tab.value, limit } })
      if (mine === version && sequence === refreshSequence && context === scope()) applyResponse(res)
    }
    catch {
      if (mine === version && sequence === refreshSequence && context === scope()) stale.value = true
    }
    finally {
      if (sequence === refreshSequence) refreshing = false
    }
  }

  async function loadMore() {
    if (!nextCursor.value || loadingMore.value || !storeId.value) return
    const mine = version
    const context = scope()
    const page = ++pageSequence
    loadingMore.value = true
    try {
      const res = await api<BoardResponse>(base(), { query: { tab: tab.value, cursor: nextCursor.value, limit: PAGE } })
      if (mine !== version || context !== scope() || page !== pageSequence) return
      orders.value = mergePage(orders.value, res.orders)
      nextCursor.value = res.nextCursor
    }
    catch (err) {
      if (mine === version && context === scope() && page === pageSequence) toast.add({ color: 'error', title: extractApiError(err).message })
    }
    finally {
      if (page === pageSequence) loadingMore.value = false
    }
  }

  function setBusy(id: string, on: boolean) {
    const next = new Set(busyIds.value)
    if (on) {
      next.add(id)
      pendingStores.set(id, storeId.value!)
    }
    else {
      next.delete(id)
      pendingStores.delete(id)
    }
    busyIds.value = next
  }

  async function act(order: BoardOrder, optimistic: () => void, request: () => Promise<unknown>) {
    if (!storeId.value || busyIds.value.has(order.id)) return
    const context = scope()
    const store = storeId.value
    const epoch = reloadEpoch
    setBusy(order.id, true)
    invalidatePage()
    version++
    const snapshot = { orders: orders.value, counts: counts.value }
    optimistic()
    try {
      await request()
    }
    catch (err) {
      if (context === scope() && epoch === reloadEpoch) {
        toast.add(orderActionToast(err))
        // Roll back this card only; another card may have been updated concurrently.
        const previous = snapshot.orders.find(item => item.id === order.id)
        if (previous) {
          const remaining = orders.value.filter(item => item.id !== order.id)
          remaining.splice(Math.min(snapshot.orders.indexOf(previous), remaining.length), 0, previous)
          orders.value = remaining
        }
        if (busyIds.value.size === 1) counts.value = snapshot.counts
      }
    }
    finally {
      setBusy(order.id, false)
      if (store === storeId.value && context === scope() && epoch === reloadEpoch) {
        version++
        await refresh(true)
      }
    }
  }

  function advance(order: BoardOrder, nextStatus: OrderStatus) {
    return act(
      order,
      () => {
        orders.value = applyStatus(orders.value, order.id, nextStatus, tab.value)
        counts.value = shiftCounts(counts.value, order.status, nextStatus)
      },
      () => api<unknown>(`${base()}/${order.id}/status`, { method: 'PATCH', body: { expectedStatus: order.status, nextStatus } }),
    )
  }

  function markPaid(order: BoardOrder) {
    return act(
      order,
      () => {
        orders.value = orders.value.map(item => (item.id === order.id ? { ...item, paymentStatus: 'PAID' as const } : item))
      },
      () => api<unknown>(`${base()}/${order.id}/mark-paid`, { method: 'POST', body: { expectedPaymentStatus: order.paymentStatus, method: 'CASH' } }),
    )
  }

  return {
    tab, orders, counts, newOrderIds, nextCursor, loading, loadingMore, loadError, stale, lastUpdated, busyIds,
    reload, refresh, loadMore, advance, markPaid,
  }
}
