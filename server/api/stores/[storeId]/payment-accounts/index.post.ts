import { getRouterParam, setHeader, setResponseStatus } from 'h3'
import { paymentAccountInputSchema } from '#shared/schemas/payment'
import { requireStoreOwner } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { createPaymentAccount } from '../../../../services/payments/accounts'
import { defineApiHandler } from '../../../../utils/api-handler'
import { parseBody } from '../../../../utils/validation'

export default defineApiHandler(async (event) => {
  setHeader(event, 'cache-control', 'no-store')
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const input = await parseBody(event, paymentAccountInputSchema)
  const account = await createPaymentAccount(getDb(), ctx, input)
  setResponseStatus(event, 201)
  return account
})
