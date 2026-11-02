import { getRouterParam, setHeader } from 'h3'
import { requireUser } from '../../../auth/require-user'
import { getDb } from '../../../db/client'
import { previewInvitation } from '../../../services/identity/invitations'
import { defineApiHandler } from '../../../utils/api-handler'

export default defineApiHandler(async (event) => {
  const user = await requireUser(event)
  setHeader(event, 'Cache-Control', 'no-store')
  return previewInvitation(getDb(), user, getRouterParam(event, 'token') ?? '')
})
