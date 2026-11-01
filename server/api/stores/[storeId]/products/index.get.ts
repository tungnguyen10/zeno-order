import { getRouterParam } from 'h3'
import { requireStoreStaff } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { listProducts } from '../../../../services/catalog/products'
import { defineApiHandler } from '../../../../utils/api-handler'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreStaff(event, getRouterParam(event, 'storeId'))
  return { products: await listProducts(getDb(), ctx) }
})
