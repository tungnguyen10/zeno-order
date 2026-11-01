import { getRouterParam, setResponseStatus } from 'h3'
import { createProductInputSchema } from '#shared/schemas/catalog'
import { requireStoreOwner } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { createProduct } from '../../../../services/catalog/products'
import { defineApiHandler } from '../../../../utils/api-handler'
import { parseBody } from '../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const input = await parseBody(event, createProductInputSchema)
  const product = await createProduct(getDb(), ctx, input)
  setResponseStatus(event, 201)
  return product
})
