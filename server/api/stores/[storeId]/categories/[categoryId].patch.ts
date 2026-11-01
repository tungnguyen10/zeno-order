import { getRouterParam } from 'h3'
import { updateCategoryInputSchema } from '#shared/schemas/catalog'
import { requireStoreOwner } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { updateCategory } from '../../../../services/catalog/categories'
import { defineApiHandler } from '../../../../utils/api-handler'
import { requireUuidParam } from '../../../../utils/ids'
import { parseBody } from '../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const categoryId = requireUuidParam(event, 'categoryId')
  const patch = await parseBody(event, updateCategoryInputSchema)
  return updateCategory(getDb(), ctx, categoryId, patch)
})
