import { getRouterParam } from 'h3'
import { updateZoneInputSchema } from '#shared/schemas/fulfillment'
import { requireStoreOwner } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { updateZone } from '../../../../services/catalog/delivery-zones'
import { defineApiHandler } from '../../../../utils/api-handler'
import { requireUuidParam } from '../../../../utils/ids'
import { parseBody } from '../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const zoneId = requireUuidParam(event, 'zoneId')
  const patch = await parseBody(event, updateZoneInputSchema)
  return updateZone(getDb(), ctx, zoneId, patch)
})
