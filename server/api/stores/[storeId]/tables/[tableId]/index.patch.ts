import { getRouterParam } from 'h3'
import { updateTableInputSchema } from '#shared/schemas/tables'
import { requireStoreOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { updateTable } from '../../../../../services/catalog/tables'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { requireUuidParam } from '../../../../../utils/ids'
import { parseBody } from '../../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const tableId = requireUuidParam(event, 'tableId')
  const patch = await parseBody(event, updateTableInputSchema)
  return updateTable(getDb(), ctx, tableId, patch)
})
