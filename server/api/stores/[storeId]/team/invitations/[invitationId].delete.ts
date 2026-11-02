import { getRouterParam } from 'h3'
import { requireStoreOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { revokeInvitation } from '../../../../../services/identity/team'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { requireUuidParam } from '../../../../../utils/ids'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  await revokeInvitation(getDb(), ctx, requireUuidParam(event, 'invitationId'))
  return { ok: true }
})
