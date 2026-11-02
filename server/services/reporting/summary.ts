import { toVnDate, vnDayRange } from '#shared/vn-date'
import type { DailySummary } from '#shared/types/reports'
import type { StoreContext } from '../../auth/guards'
import type { DbOrTx } from '../../db/client'
import { collectedByMethod, orderTotals, refundDueTotal } from '../../repositories/reporting'

export async function getDailySummary(db: DbOrTx, ctx: StoreContext, date?: string, now = new Date()): Promise<DailySummary> {
  const scope = { orgId: ctx.orgId, storeId: ctx.storeId }
  const day = date ?? toVnDate(now)
  const { from, to } = vnDayRange(day)
  const [totals, byMethod, refundDueVnd] = await Promise.all([
    orderTotals(db, scope, from, to),
    collectedByMethod(db, scope, from, to),
    refundDueTotal(db, scope, from, to),
  ])
  const collected = { SEPAY: byMethod.SEPAY ?? 0, CASH: byMethod.CASH ?? 0, BANK_MANUAL: byMethod.BANK_MANUAL ?? 0 }
  const collectedVnd = collected.SEPAY + collected.CASH + collected.BANK_MANUAL
  return {
    date: day,
    totalOrders: totals.total,
    completedCount: totals.completed,
    cancelledCount: totals.cancelled,
    grossVnd: totals.gross,
    collected,
    collectedVnd,
    outstandingVnd: Math.max(0, totals.gross - collectedVnd),
    refundDueVnd,
  }
}
