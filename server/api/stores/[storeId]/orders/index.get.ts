import { getRouterParam, setHeader } from 'h3'
import { boardQuerySchema } from '#shared/schemas/orders'
import { requireStoreStaff } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { listBoard } from '../../../../services/ordering/board'
import { defineApiHandler } from '../../../../utils/api-handler'
import { parseQuery } from '../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreStaff(event, getRouterParam(event, 'storeId'))
  const query = parseQuery(event, boardQuerySchema)
  setHeader(event, 'Cache-Control', 'no-store')
  return listBoard(getDb(), ctx, query)
})
