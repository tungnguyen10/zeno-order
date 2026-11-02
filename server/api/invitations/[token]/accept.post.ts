import { getRouterParam, setHeader } from 'h3'
import { requireUser } from '../../../auth/require-user'
import { getDb } from '../../../db/client'
import { acceptInvitation } from '../../../services/identity/invitations'
import { defineApiHandler } from '../../../utils/api-handler'
import { inviteRequiresVerifiedEmail } from '../../../utils/env'

export default defineApiHandler(async (event) => {
  const user = await requireUser(event)
  setHeader(event, 'Cache-Control', 'no-store')
  return acceptInvitation(getDb(), user, getRouterParam(event, 'token') ?? '', { requireVerifiedEmail: inviteRequiresVerifiedEmail() })
})
