import { getRouterParam, setResponseStatus } from 'h3'
import { createZoneInputSchema } from '#shared/schemas/fulfillment'
import { requireStoreOwner } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { createZone } from '../../../../services/catalog/delivery-zones'
import { defineApiHandler } from '../../../../utils/api-handler'
import { parseBody } from '../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const input = await parseBody(event, createZoneInputSchema)
  const zone = await createZone(getDb(), ctx, input)
  setResponseStatus(event, 201)
  return zone
})
