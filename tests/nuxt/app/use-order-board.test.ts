import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useOrderBoard } from '~/composables/useOrderBoard'
import type { BoardOrder, BoardResponse } from '#shared/types/orders'
import { emptyCounts } from '~/utils/order-board'

const { api } = vi.hoisted(() => ({ api: vi.fn() }))
mockNuxtImport('useApi', () => () => api)
const order = (id: string): BoardOrder => ({ id, publicCode: id, status: 'NEW', fulfillmentType: 'PICKUP', paymentMethod: 'PAY_ON_RECEIPT', paymentStatus: 'UNPAID', latePayment: false, tableName: null, customerName: null, customerPhone: null, address: null, notes: null, totalVnd: 10000, createdAt: new Date().toISOString(), items: [] })
const response = (ids: string[], cursor: string | null = null): BoardResponse => ({ orders: ids.map(order), nextCursor: cursor, counts: { ...emptyCounts(), new: ids.length }, newOrderIds: ids, serverTime: new Date().toISOString() })
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
beforeEach(() => api.mockReset())

describe('useOrderBoard request races', () => {
  it('keeps existing cards and warns after polling fails', async () => {
    api.mockResolvedValueOnce(response(['a'])).mockRejectedValueOnce(new Error('offline'))
    const board = useOrderBoard(ref('s1'))
    await board.reload()
    await board.refresh()
    expect(board.orders.value.map(o => o.id)).toEqual(['a'])
    expect(board.stale.value).toBe(true)
  })

  it('ignores a late load-more from the previous store', async () => {
    const oldPage = deferred<BoardResponse>()
    api.mockResolvedValueOnce(response(['a'], 'cursor')).mockReturnValueOnce(oldPage.promise).mockResolvedValueOnce(response(['b']))
    const store = ref('s1')
    const board = useOrderBoard(store)
    await board.reload()
    const more = board.loadMore()
    store.value = 's2'
    await board.reload()
    oldPage.resolve(response(['old-store']))
    await more
    expect(board.orders.value.map(o => o.id)).toEqual(['b'])
  })

  it('ignores a late old-store action failure instead of restoring its cards', async () => {
    const action = deferred<unknown>()
    api.mockResolvedValueOnce(response(['a'])).mockReturnValueOnce(action.promise).mockResolvedValue(response(['b']))
    const store = ref('s1')
    const board = useOrderBoard(store)
    await board.reload()
    const advance = board.advance(board.orders.value[0]!, 'PREPARING')
    store.value = 's2'
    await board.reload()
    action.reject(new Error('offline'))
    await advance
    expect(board.orders.value.map(o => o.id)).toEqual(['b'])
    expect(api.mock.calls.filter(([, opts]) => !opts?.method)).toHaveLength(2)
  })

  it('a newer refresh wins when two refreshes resolve out of order', async () => {
    const slow = deferred<BoardResponse>()
    api.mockResolvedValueOnce(response(['a'])).mockReturnValueOnce(slow.promise).mockResolvedValueOnce(response(['new']))
    const board = useOrderBoard(ref('s1'))
    await board.reload()
    const oldRefresh = board.refresh()
    await board.refresh(true)
    slow.resolve(response(['old']))
    await oldRefresh
    expect(board.orders.value.map(o => o.id)).toEqual(['new'])
  })

  it('clears sensitive cards and counts when the active store disappears', async () => {
    api.mockResolvedValueOnce(response(['a']))
    const store = ref<string | null>('s1')
    const board = useOrderBoard(store)
    await board.reload()
    store.value = null
    await board.reload()
    expect(board.orders.value).toEqual([])
    expect(board.counts.value).toEqual(emptyCounts())
  })
  it('releases pagination after an overlapping action invalidates the pending page', async () => {
    const page = deferred<BoardResponse>()
    api.mockResolvedValueOnce(response(['a'], 'cursor')).mockReturnValueOnce(page.promise).mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('offline'))
    const board = useOrderBoard(ref('s1'))
    await board.reload()
    const more = board.loadMore()
    await board.advance(board.orders.value[0]!, 'PREPARING')
    page.resolve(response(['old']))
    await more
    expect(board.loadingMore.value).toBe(false)
    expect(board.orders.value).toEqual([])
  })

  it('ignores an older page after an authoritative poll has replaced the board', async () => {
    const page = deferred<BoardResponse>()
    api.mockResolvedValueOnce(response(['a'], 'cursor')).mockReturnValueOnce(page.promise).mockResolvedValueOnce(response(['a']))
    const board = useOrderBoard(ref('s1'))
    await board.reload()
    const more = board.loadMore()
    await board.refresh()
    page.resolve(response(['moved-away']))
    await more
    expect(board.orders.value.map(o => o.id)).toEqual(['a'])
    expect(board.nextCursor.value).toBeNull()
  })

  it('recovers from an initial load error when a later background refresh succeeds', async () => {
    api.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response(['a']))
    const board = useOrderBoard(ref('s1'))
    await board.reload()
    expect(board.loadError.value).not.toBeNull()
    await board.refresh()
    expect(board.orders.value.map(o => o.id)).toEqual(['a'])
    expect(board.loadError.value).toBeNull()
  })

  it('lets a newer reload finish when an old action completes after navigating away and back', async () => {
    const action = deferred<unknown>()
    const reload = deferred<BoardResponse>()
    api.mockResolvedValueOnce(response(['a'])).mockReturnValueOnce(action.promise).mockResolvedValueOnce(response([])).mockReturnValueOnce(reload.promise)
    const board = useOrderBoard(ref('s1'))
    await board.reload()
    const advance = board.advance(board.orders.value[0]!, 'PREPARING')
    board.tab.value = 'doing'
    await board.reload()
    board.tab.value = 'new'
    const loading = board.reload()
    action.resolve({})
    await advance
    reload.resolve(response([]))
    await loading
    expect(board.loading.value).toBe(false)
  })

  it('continues polling the new store while a request for the previous store is pending', async () => {
    const action = deferred<unknown>()
    api.mockResolvedValueOnce(response(['a'])).mockReturnValueOnce(action.promise).mockResolvedValueOnce(response(['b'])).mockResolvedValueOnce(response(['b', 'c']))
    const store = ref('s1')
    const board = useOrderBoard(store)
    await board.reload()
    const advance = board.advance(board.orders.value[0]!, 'PREPARING')
    store.value = 's2'
    await board.reload()
    await board.refresh()
    expect(board.orders.value.map(o => o.id)).toEqual(['b', 'c'])
    action.resolve({})
    await advance
  })

})
