import { getRouterParam } from 'h3'
import { requireStoreOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { removeCategoryImage } from '../../../../../services/catalog/category-image'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { requireUuidParam } from '../../../../../utils/ids'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const categoryId = requireUuidParam(event, 'categoryId')
  return removeCategoryImage(getDb(), ctx, categoryId)
})
