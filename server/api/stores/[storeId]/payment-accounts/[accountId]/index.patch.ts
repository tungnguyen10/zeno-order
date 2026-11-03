import { getRouterParam, setHeader } from 'h3'
import { paymentAccountPatchSchema } from '#shared/schemas/payment'
import { requireStoreOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { updatePaymentAccount } from '../../../../../services/payments/accounts'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { requireUuidParam } from '../../../../../utils/ids'
import { parseBody } from '../../../../../utils/validation'

export default defineApiHandler(async (event) => {
  setHeader(event, 'cache-control', 'no-store')
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const accountId = requireUuidParam(event, 'accountId')
  const patch = await parseBody(event, paymentAccountPatchSchema)
  return updatePaymentAccount(getDb(), ctx, accountId, patch)
})
