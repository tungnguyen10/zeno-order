import { getRouterParam } from 'h3'
import { requireStoreStaff } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { listZones } from '../../../../services/catalog/delivery-zones'
import { defineApiHandler } from '../../../../utils/api-handler'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreStaff(event, getRouterParam(event, 'storeId'))
  return { zones: await listZones(getDb(), ctx) }
})
