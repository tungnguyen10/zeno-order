import { getRouterParam, readBody, setHeader, setResponseStatus } from 'h3'
import { createIntegrationInputSchema } from '#shared/schemas/payment'
import { requireOrgOwner } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { createOrGetIntegration } from '../../../../services/payments/integrations'
import { defineApiHandler } from '../../../../utils/api-handler'
import { getAppBaseUrl } from '../../../../utils/env'
import { parseWith } from '../../../../utils/validation'

export default defineApiHandler(async (event) => {
  setHeader(event, 'cache-control', 'no-store')
  const { orgId } = await requireOrgOwner(event, getRouterParam(event, 'orgId'))
  const raw = await readBody(event).catch(() => undefined)
  const input = parseWith(createIntegrationInputSchema, raw ?? {})
  const { integration, created } = await createOrGetIntegration(getDb(), orgId, input, getAppBaseUrl())
  setResponseStatus(event, created ? 201 : 200)
  return integration
})
