import { getRouterParam, setHeader } from 'h3'
import { refundInputSchema } from '#shared/schemas/reconciliation'
import { requireStoreOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { markOrderRefunded } from '../../../../../services/payments/manual-payments'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { parseBody } from '../../../../../utils/validation'

export default defineApiHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const { note, expectedHeldVnd } = await parseBody(event, refundInputSchema)
  await markOrderRefunded(getDb(), ctx, { orderId: getRouterParam(event, 'orderId') ?? '', note, expectedHeldVnd })
  return { ok: true }
})
