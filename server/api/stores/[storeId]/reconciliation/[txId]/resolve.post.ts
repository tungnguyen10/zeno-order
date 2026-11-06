import { getRouterParam, setResponseStatus } from 'h3'
import { resolveInputSchema } from '#shared/schemas/reconciliation'
import { requireStoreOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { resolveTransaction } from '../../../../../services/payments/review-queue'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { parseBody } from '../../../../../utils/validation'

export default defineApiHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const input = await parseBody(event, resolveInputSchema)
  await resolveTransaction(getDb(), ctx, { transactionId: getRouterParam(event, 'txId') ?? '', ...input })
  setResponseStatus(event, 200)
  return { ok: true }
})
