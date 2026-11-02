import { getRouterParam, setHeader } from 'h3'
import { summaryQuerySchema } from '#shared/schemas/reports'
import { requireStoreStaff } from '../../../auth/guards'
import { getDb } from '../../../db/client'
import { getDailySummary } from '../../../services/reporting/summary'
import { defineApiHandler } from '../../../utils/api-handler'
import { parseQuery } from '../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreStaff(event, getRouterParam(event, 'storeId'))
  const { date } = parseQuery(event, summaryQuerySchema)
  setHeader(event, 'Cache-Control', 'no-store')
  return getDailySummary(getDb(), ctx, date)
})
