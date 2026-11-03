import { getRouterParam, setHeader } from 'h3'
import { requireOrgOwner } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { listIntegrations } from '../../../../services/payments/integrations'
import { defineApiHandler } from '../../../../utils/api-handler'
import { getAppBaseUrl } from '../../../../utils/env'

export default defineApiHandler(async (event) => {
  setHeader(event, 'cache-control', 'no-store')
  const { orgId } = await requireOrgOwner(event, getRouterParam(event, 'orgId'))
  return { integrations: await listIntegrations(getDb(), orgId, getAppBaseUrl()) }
})
