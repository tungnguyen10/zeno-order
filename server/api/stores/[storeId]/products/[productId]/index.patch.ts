import { getRouterParam } from 'h3'
import { updateProductInputSchema } from '#shared/schemas/catalog'
import { requireStoreOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { updateProduct } from '../../../../../services/catalog/products'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { requireUuidParam } from '../../../../../utils/ids'
import { parseBody } from '../../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const productId = requireUuidParam(event, 'productId')
  const patch = await parseBody(event, updateProductInputSchema)
  return updateProduct(getDb(), ctx, productId, patch)
})
