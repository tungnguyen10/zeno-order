import { z } from 'zod'

export interface RecentOrder {
  token: string
  publicCode: string
  storeSlug: string
  storeName: string
  totalVnd: number
  createdAt: string
}

const MAX_RECENT = 20
const DEFAULT_MAX_AGE_MS = 48 * 3_600_000

const entrySchema = z.object({
  token: z.string().min(1).max(128),
  publicCode: z.string().min(1).max(16),
  storeSlug: z.string().min(1).max(64),
  storeName: z.string().max(200),
  totalVnd: z.number().int().nonnegative(),
  createdAt: z.string().max(40),
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
