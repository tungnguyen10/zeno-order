import { eachDate, reportWindow, type ReportRange } from '#shared/vn-date'
import type { Report } from '#shared/types/reports'
import type { StoreContext } from '../../auth/guards'
import type { DbOrTx } from '../../db/client'
import { collectedByMethod, dailyCollected, dailyValue, orderTotals, topProducts } from '../../repositories/reporting'

const TOP_LIMIT = 5

export async function getReport(db: DbOrTx, ctx: StoreContext, range: ReportRange, now = new Date()): Promise<Report> {
  const scope = { orgId: ctx.orgId, storeId: ctx.storeId }
  const { fromDate, toDate, from, to } = reportWindow(range, now)
  const [totals, byMethod, top, valueByDay, collectedByDay] = await Promise.all([
    orderTotals(db, scope, from, to),
    collectedByMethod(db, scope, from, to),
    topProducts(db, scope, from, to, TOP_LIMIT),
    dailyValue(db, scope, from, to),
    dailyCollected(db, scope, from, to),
  ])
  const value = new Map(valueByDay.map(row => [row.day, row]))
  const collected = new Map(collectedByDay.map(row => [row.day, row.amount]))
  const orderCount = totals.total - totals.cancelled
  return {
    range,
    fromDate,
    toDate,
    orderCount,
    cancelledCount: totals.cancelled,
    grossVnd: totals.gross,
    collectedVnd: (byMethod.SEPAY ?? 0) + (byMethod.CASH ?? 0) + (byMethod.BANK_MANUAL ?? 0),
    averageOrderVnd: orderCount > 0 ? Math.round(totals.gross / orderCount) : 0,
    topProducts: top,
    daily: eachDate(fromDate, toDate).map(date => ({
      date,
      orderCount: value.get(date)?.orderCount ?? 0,
      grossVnd: value.get(date)?.gross ?? 0,
      collectedVnd: collected.get(date) ?? 0,
    })),
  }
}
