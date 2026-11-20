import { getRouterParam } from 'h3'
import { pushUnsubscribeSchema } from '#shared/schemas/push'
import { requireStoreStaff } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { removeSubscription } from '../../../../services/push/subscriptions'
import { defineApiHandler } from '../../../../utils/api-handler'
import { parseBody } from '../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreStaff(event, getRouterParam(event, 'storeId'))
  const { endpoint } = await parseBody(event, pushUnsubscribeSchema)
  await removeSubscription(getDb(), ctx, endpoint)
  return { ok: true }
})
