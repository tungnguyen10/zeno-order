import { describe, expect, it } from 'vitest'
import { addRecentOrder, parseRecentOrders, recentForStore, type RecentOrder } from '../../../app/utils/recent-orders'

const HOUR = 3_600_000
const NOW = Date.parse('2026-10-31T12:00:00Z')

const entry = (over: Partial<RecentOrder> = {}): RecentOrder => ({
  token: 't1',
  publicCode: 'AB23CD',
  storeSlug: 'tra-sua-may',
  storeName: 'Trà sữa Mây',
  totalVnd: 70_000,
  createdAt: new Date(NOW).toISOString(),
  items: [],
  ...over,
})

describe('addRecentOrder', () => {
  it('puts the newest first and drops a duplicate token', () => {
    const list = addRecentOrder(addRecentOrder([], entry({ token: 'a' })), entry({ token: 'b' }))
    expect(list.map(item => item.token)).toEqual(['b', 'a'])
    expect(addRecentOrder(list, entry({ token: 'a', totalVnd: 1 })).map(item => item.token)).toEqual(['a', 'b'])
  })

  it('keeps at most 20 orders', () => {
    let list: RecentOrder[] = []
    for (let i = 0; i < 25; i++) list = addRecentOrder(list, entry({ token: `t${i}` }))
    expect(list).toHaveLength(20)
    expect(list[0]!.token).toBe('t24')
  })
})

describe('recentForStore', () => {
  it('returns only this store, only recent orders', () => {
    const list = [
      entry({ token: 'old', createdAt: new Date(NOW - 49 * HOUR).toISOString() }),
      entry({ token: 'other', storeSlug: 'quan-khac' }),
      entry({ token: 'fresh', createdAt: new Date(NOW - 2 * HOUR).toISOString() }),
    ]
    expect(recentForStore(list, 'tra-sua-may', NOW).map(item => item.token)).toEqual(['fresh'])
  })
})

describe('parseRecentOrders', () => {
  it.each([null, '', 'not json', '{"a":1}', '[{"token":1}]'])('returns [] for %j', (raw) => {
    expect(parseRecentOrders(raw)).toEqual([])
  })

  it('round-trips valid data and drops malformed entries', () => {
    const raw = JSON.stringify([entry(), { token: 5 }, entry({ token: 't2' })])
    expect(parseRecentOrders(raw).map(item => item.token)).toEqual(['t1', 't2'])
  })

  it('defaults items to [] for entries saved before re-order existed', () => {
    const { items: _omit, ...legacy } = entry()
    const parsed = parseRecentOrders(JSON.stringify([legacy]))
    expect(parsed).toHaveLength(1)
    expect(parsed[0]!.items).toEqual([])
  })

  it('keeps a valid item snapshot and drops an entry whose item is malformed', () => {
    const good = entry({ token: 'g', items: [{ productId: 'p1', name: 'Trà', optionValueIds: ['v1'], quantity: 2, note: '' }] })
    const bad = entry({ token: 'b', items: [{ productId: '', name: 'x', optionValueIds: [], quantity: 0, note: '' }] as never })
    const parsed = parseRecentOrders(JSON.stringify([good, bad]))
    expect(parsed.map(item => item.token)).toEqual(['g'])
    expect(parsed[0]!.items[0]).toMatchObject({ productId: 'p1', quantity: 2 })
  })
})
