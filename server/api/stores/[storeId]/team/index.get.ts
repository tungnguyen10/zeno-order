import { getRouterParam, setHeader } from 'h3'
import { requireStoreOwner } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { listTeam } from '../../../../services/identity/team'
import { defineApiHandler } from '../../../../utils/api-handler'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  setHeader(event, 'Cache-Control', 'no-store')
  return listTeam(getDb(), ctx)
})
