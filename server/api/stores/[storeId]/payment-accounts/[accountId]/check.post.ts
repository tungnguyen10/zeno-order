import { getRouterParam, setHeader } from 'h3'
import { requireStoreOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { checkPaymentAccount } from '../../../../../services/payments/accounts'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { requireUuidParam } from '../../../../../utils/ids'

export default defineApiHandler(async (event) => {
  setHeader(event, 'cache-control', 'no-store')
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const accountId = requireUuidParam(event, 'accountId')
  return checkPaymentAccount(getDb(), ctx, accountId)
})
