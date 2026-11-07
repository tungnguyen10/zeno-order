import { clientIp } from '../../../../utils/client-ip'
import { getRouterParam, setResponseHeader, setResponseStatus } from 'h3'
import { checkoutInputSchema } from '#shared/schemas/checkout'
import { getDb } from '../../../../db/client'
import { createOrder } from '../../../../services/ordering/create-order'
import { defineApiHandler } from '../../../../utils/api-handler'
import { parseBody } from '../../../../utils/validation'

export default defineApiHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const input = await parseBody(event, checkoutInputSchema)
  const ip = clientIp(event)
  const { response, replayed } = await createOrder(getDb(), { slug: getRouterParam(event, 'slug') ?? '', input, ip })
  setResponseStatus(event, replayed ? 200 : 201)
  return response
})
