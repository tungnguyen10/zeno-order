import { getRouterParam, setHeader } from 'h3'
import { reportQuerySchema } from '#shared/schemas/reports'
import { requireStoreOwner } from '../../../auth/guards'
import { getDb } from '../../../db/client'
import { getReport } from '../../../services/reporting/reports'
import { defineApiHandler } from '../../../utils/api-handler'
import { parseQuery } from '../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const { range } = parseQuery(event, reportQuerySchema)
  setHeader(event, 'Cache-Control', 'no-store')
  return getReport(getDb(), ctx, range)
})
