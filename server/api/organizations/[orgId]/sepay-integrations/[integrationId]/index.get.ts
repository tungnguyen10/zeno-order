import { getRouterParam, setHeader } from 'h3'
import { requireOrgOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { getIntegration } from '../../../../../services/payments/integrations'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { getAppBaseUrl } from '../../../../../utils/env'
import { requireUuidParam } from '../../../../../utils/ids'

export default defineApiHandler(async (event) => {
  setHeader(event, 'cache-control', 'no-store')
  const { orgId } = await requireOrgOwner(event, getRouterParam(event, 'orgId'))
  const integrationId = requireUuidParam(event, 'integrationId')
  return getIntegration(getDb(), orgId, integrationId, getAppBaseUrl())
})
