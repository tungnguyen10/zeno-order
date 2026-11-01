import { getRouterParam, setResponseStatus } from 'h3'
import { createCategoryInputSchema } from '#shared/schemas/catalog'
import { requireStoreOwner } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { createCategory } from '../../../../services/catalog/categories'
import { defineApiHandler } from '../../../../utils/api-handler'
import { parseBody } from '../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const input = await parseBody(event, createCategoryInputSchema)
  const category = await createCategory(getDb(), ctx, input)
  setResponseStatus(event, 201)
  return category
})
