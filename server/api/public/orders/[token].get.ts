import { getRouterParam, setResponseHeader } from 'h3'
import { getDb } from '../../../db/client'
import { getPublicOrderView } from '../../../services/ordering/public-view'
import { defineApiHandler } from '../../../utils/api-handler'

export default defineApiHandler(async (event) => {
  // Set before any throw so even the 404 is never cached, and crawlers/links in chat apps skip it.
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'X-Robots-Tag', 'noindex')
  return getPublicOrderView(getDb(), getRouterParam(event, 'token') ?? '')
})
