import { getRouterParam } from 'h3'
import { requireStoreStaff } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { listCategories } from '../../../../services/catalog/categories'
import { defineApiHandler } from '../../../../utils/api-handler'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreStaff(event, getRouterParam(event, 'storeId'))
  return { categories: await listCategories(getDb(), ctx) }
})
