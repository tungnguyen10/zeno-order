import { requireUser } from '../../auth/require-user'
import { getDb } from '../../db/client'
import { listAccessibleStores } from '../../repositories/membership'
import { defineApiHandler } from '../../utils/api-handler'

export default defineApiHandler(async (event) => {
  const user = await requireUser(event)
  return { stores: await listAccessibleStores(getDb(), user.userId) }
})
