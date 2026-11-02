import { getRequestIP, getRouterParam, setResponseHeader, setResponseStatus } from 'h3'
import { checkoutInputSchema } from '#shared/schemas/checkout'
import { getDb } from '../../../../db/client'
import { createOrder } from '../../../../services/ordering/create-order'
import { defineApiHandler } from '../../../../utils/api-handler'
import { parseBody } from '../../../../utils/validation'

export default defineApiHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const input = await parseBody(event, checkoutInputSchema)
  // Vercel overwrites X-Forwarded-For with the real client address.
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? null
  const { response, replayed } = await createOrder(getDb(), { slug: getRouterParam(event, 'slug') ?? '', input, ip })
  setResponseStatus(event, replayed ? 200 : 201)
  return response
})
