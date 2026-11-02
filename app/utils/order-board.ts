import type { OrderStatus } from '#shared/enums'
import { tabForStatus, type BoardTab } from '#shared/order-flow'
import type { BoardOrder } from '#shared/types/orders'

export type TabCounts = Record<BoardTab, number>

export function emptyCounts(): TabCounts {
  return { new: 0, doing: 0, ready: 0, other: 0, awaiting_payment: 0 }
}

/** `seen === null` nghĩa là lần tải đầu: không báo gì. */
export function detectNewOrderIds(seen: ReadonlySet<string> | null, current: readonly string[]): string[] {
  if (seen === null) return []
  return current.filter(id => !seen.has(id))
}

export function applyStatus(orders: readonly BoardOrder[], id: string, next: OrderStatus, tab: BoardTab): BoardOrder[] {
  if (tabForStatus(next) !== tab) return orders.filter(order => order.id !== id)
  return orders.map(order => (order.id === id ? { ...order, status: next } : order))
}

export function shiftCounts(counts: TabCounts, from: OrderStatus, to: OrderStatus): TabCounts {
  const fromTab = tabForStatus(from)
  const toTab = tabForStatus(to)
  if (fromTab === toTab) return counts
  const next = { ...counts }
  if (fromTab !== 'other') next[fromTab] = Math.max(0, next[fromTab] - 1)
  if (toTab !== 'other') next[toTab] += 1
  return next
}

export function mergePage(existing: readonly BoardOrder[], incoming: readonly BoardOrder[]): BoardOrder[] {
  const seen = new Set(existing.map(order => order.id))
  return [...existing, ...incoming.filter(order => !seen.has(order.id))]
}
