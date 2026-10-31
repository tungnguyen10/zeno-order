import { getRouterParam } from 'h3'
import { requireStoreStaff } from '../../../auth/guards'
import { getDb } from '../../../db/client'
import { getStoreDetail } from '../../../services/store/settings'
import { defineApiHandler } from '../../../utils/api-handler'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreStaff(event, getRouterParam(event, 'storeId'))
  return getStoreDetail(getDb(), ctx)
})
