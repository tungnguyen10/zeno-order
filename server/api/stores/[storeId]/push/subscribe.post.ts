import { getRouterParam } from 'h3'
import { pushSubscriptionSchema } from '#shared/schemas/push'
import { requireStoreStaff } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { saveSubscription } from '../../../../services/push/subscriptions'
import { defineApiHandler } from '../../../../utils/api-handler'
import { parseBody } from '../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreStaff(event, getRouterParam(event, 'storeId'))
  const input = await parseBody(event, pushSubscriptionSchema)
  await saveSubscription(getDb(), ctx, input)
  return { ok: true }
})
