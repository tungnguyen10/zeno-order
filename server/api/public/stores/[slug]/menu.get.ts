import { getRouterParam, setResponseHeader } from 'h3'
import { getDb } from '../../../../db/client'
import { getPublicMenu } from '../../../../services/catalog/public-menu'
import { defineApiHandler } from '../../../../utils/api-handler'

export default defineApiHandler(async (event) => {
  const menu = await getPublicMenu(getDb(), getRouterParam(event, 'slug') ?? '')
  // Set only on success so a 404 is never cached by the CDN.
  setResponseHeader(event, 'cache-control', 'public, max-age=30, s-maxage=60')
  return menu
})
