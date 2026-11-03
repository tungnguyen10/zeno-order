import { getRouterParam, setHeader } from 'h3'
import { z } from 'zod'
import { requireStoreOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { confirmAccountQr } from '../../../../../services/payments/accounts'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { requireUuidParam } from '../../../../../utils/ids'
import { parseBody } from '../../../../../utils/validation'

const confirmQrInputSchema = z.object({ revision: z.string().regex(/^[a-f0-9]{64}$/) })

export default defineApiHandler(async (event) => {
  setHeader(event, 'cache-control', 'no-store')
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const accountId = requireUuidParam(event, 'accountId')
  const { revision } = await parseBody(event, confirmQrInputSchema)
  return confirmAccountQr(getDb(), ctx, accountId, revision)
})
