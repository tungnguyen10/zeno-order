import { getRouterParam, setHeader } from 'h3'
import { linkAccountInputSchema } from '#shared/schemas/payment'
import { requireOrgOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { linkAccountToIntegration } from '../../../../../services/payments/integrations'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { getAppBaseUrl } from '../../../../../utils/env'
import { requireUuidParam } from '../../../../../utils/ids'
import { parseBody } from '../../../../../utils/validation'

export default defineApiHandler(async (event) => {
  setHeader(event, 'cache-control', 'no-store')
  const { orgId } = await requireOrgOwner(event, getRouterParam(event, 'orgId'))
  const integrationId = requireUuidParam(event, 'integrationId')
  const input = await parseBody(event, linkAccountInputSchema)
  return linkAccountToIntegration(getDb(), orgId, integrationId, input.paymentAccountId, getAppBaseUrl())
})
