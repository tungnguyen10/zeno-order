import { getRouterParam, setHeader, setResponseStatus } from 'h3'
import { inviteInputSchema } from '#shared/schemas/team'
import { requireStoreOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { createInvitation } from '../../../../../services/identity/team'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { appBaseUrl } from '../../../../../utils/env'
import { parseBody } from '../../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const body = await parseBody(event, inviteInputSchema)
  const result = await createInvitation(getDb(), ctx, body, appBaseUrl())
  setHeader(event, 'Cache-Control', 'no-store')
  setResponseStatus(event, 201)
  return result
})
