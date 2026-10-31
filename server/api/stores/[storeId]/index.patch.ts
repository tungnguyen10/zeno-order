import { getRouterParam } from 'h3'
import { updateStoreInputSchema } from '#shared/schemas/identity'
import { requireStoreOwner } from '../../../auth/guards'
import { getDb } from '../../../db/client'
import { updateStore } from '../../../services/store/settings'
import { defineApiHandler } from '../../../utils/api-handler'
import { parseBody } from '../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const patch = await parseBody(event, updateStoreInputSchema)
  return updateStore(getDb(), ctx, patch)
})
