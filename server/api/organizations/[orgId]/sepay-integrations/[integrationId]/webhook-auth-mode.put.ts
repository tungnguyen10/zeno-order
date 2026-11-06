import { getRouterParam, setHeader } from 'h3'
import { z } from 'zod'
import { requireOrgOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { setWebhookAuthMode } from '../../../../../services/payments/webhook-auth-settings'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { parseBody } from '../../../../../utils/validation'

const bodySchema = z.object({ mode: z.enum(['HMAC', 'APIKEY']) })

export default defineApiHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ctx = await requireOrgOwner(event, getRouterParam(event, 'orgId'))
  const { mode } = await parseBody(event, bodySchema)
  await setWebhookAuthMode(getDb(), ctx.orgId, getRouterParam(event, 'integrationId') ?? '', mode)
  return { mode }
})
