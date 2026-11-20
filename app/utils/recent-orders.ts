import { z } from 'zod'
import { MAX_LINE_QUANTITY } from '#shared/pricing'
import { CHECKOUT_LIMITS } from '#shared/schemas/checkout'

/** A cart line snapshot kept so the customer can re-order with one tap. */
export interface RecentOrderItem {
  productId: string
  name: string
  optionValueIds: string[]
  quantity: number
  note: string
}

export interface RecentOrder {
  token: string
  publicCode: string
  storeSlug: string
  storeName: string
  totalVnd: number
  createdAt: string
  items: RecentOrderItem[]
}

const MAX_RECENT = 20
const DEFAULT_MAX_AGE_MS = 48 * 3_600_000

const itemSchema = z.object({
  productId: z.string().min(1).max(64),
  name: z.string().max(200),
  optionValueIds: z.array(z.string().max(64)).max(30),
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
  note: z.string().max(CHECKOUT_LIMITS.maxNote),
})

const entrySchema = z.object({
  token: z.string().min(1).max(128),
  publicCode: z.string().min(1).max(16),
  storeSlug: z.string().min(1).max(64),
  storeName: z.string().max(200),
  totalVnd: z.number().int().nonnegative(),
  createdAt: z.string().max(40),
  // Older entries predate re-order; default keeps them loadable without a stored item list.
  items: z.array(itemSchema).max(CHECKOUT_LIMITS.maxLines).default([]),
})

export function parseRecentOrders(raw: string | null): RecentOrder[] {
  if (!raw) return []
  try {
    const data: unknown = JSON.parse(raw)
    if (!Array.isArray(data)) return []
    return data.flatMap((item) => {
      const parsed = entrySchema.safeParse(item)
      return parsed.success ? [parsed.data] : []
    })
  }
  catch {
    return []
  }
}

export function addRecentOrder(list: RecentOrder[], entry: RecentOrder): RecentOrder[] {
  return [entry, ...list.filter(item => item.token !== entry.token)].slice(0, MAX_RECENT)
}

export function recentForStore(list: RecentOrder[], slug: string, nowMs: number, maxAgeMs = DEFAULT_MAX_AGE_MS): RecentOrder[] {
  return list.filter(item => item.storeSlug === slug && nowMs - Date.parse(item.createdAt) <= maxAgeMs)
}
