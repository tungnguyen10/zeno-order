import { getRouterParam, setHeader } from 'h3'
import { reviewListQuerySchema } from '#shared/schemas/reconciliation'
import { requireStoreOwner } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { listReviewItems } from '../../../../services/payments/review-queue'
import { defineApiHandler } from '../../../../utils/api-handler'
import { parseQuery } from '../../../../utils/validation'

export default defineApiHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const { status } = parseQuery(event, reviewListQuerySchema)
  return { items: await listReviewItems(getDb(), { orgId: ctx.orgId }, status) }
})
