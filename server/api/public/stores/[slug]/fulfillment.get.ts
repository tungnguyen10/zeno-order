import { getQuery, getRouterParam, setResponseHeader } from 'h3'
import { getDb } from '../../../../db/client'
import { getPublicFulfillment } from '../../../../services/catalog/public-fulfillment'
import { defineApiHandler } from '../../../../utils/api-handler'

export default defineApiHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  const raw = getQuery(event).t
  // Repeated query parameters are malformed; never choose one of them implicitly.
  const token = raw === undefined ? undefined : typeof raw === 'string' ? raw : ''
  return getPublicFulfillment(getDb(), getRouterParam(event, 'slug') ?? '', token)
})
