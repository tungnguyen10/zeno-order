import { getRouterParam } from 'h3'
import { updateFulfillmentInputSchema } from '#shared/schemas/fulfillment'
import { requireStoreOwner } from '../../../auth/guards'
import { getDb } from '../../../db/client'
import { updateFulfillment } from '../../../services/catalog/fulfillment'
import { defineApiHandler } from '../../../utils/api-handler'
import { parseBody } from '../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const patch = await parseBody(event, updateFulfillmentInputSchema)
  return updateFulfillment(getDb(), ctx, patch)
})
