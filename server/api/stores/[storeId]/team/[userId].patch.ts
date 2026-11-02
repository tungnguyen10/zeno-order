import { getRouterParam } from 'h3'
import { memberStatusSchema } from '#shared/schemas/team'
import { requireStoreOwner } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { setMemberStatus } from '../../../../services/identity/team'
import { defineApiHandler } from '../../../../utils/api-handler'
import { AppError } from '../../../../utils/errors'
import { parseBody } from '../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const userId = getRouterParam(event, 'userId')
  if (!userId || userId.length > 128) throw new AppError('NOT_FOUND', 'Không tìm thấy')
  const body = await parseBody(event, memberStatusSchema)
  await setMemberStatus(getDb(), ctx, userId, body.status)
  return { ok: true }
})
