import { getRouterParam } from 'h3'
import { replaceOptionsInputSchema } from '#shared/schemas/catalog'
import { requireStoreOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { replaceProductOptions } from '../../../../../services/catalog/options'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { requireUuidParam } from '../../../../../utils/ids'
import { parseBody } from '../../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const productId = requireUuidParam(event, 'productId')
  const { groups } = await parseBody(event, replaceOptionsInputSchema)
  return { optionGroups: await replaceProductOptions(getDb(), ctx, productId, { groups }) }
})
