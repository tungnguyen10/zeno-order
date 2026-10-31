import { requireUser } from '../auth/require-user'
import { getDb } from '../db/client'
import { getMe } from '../services/identity/me'
import { defineApiHandler } from '../utils/api-handler'

export default defineApiHandler(async (event) => {
  const user = await requireUser(event)
  return getMe(getDb(), user)
})
