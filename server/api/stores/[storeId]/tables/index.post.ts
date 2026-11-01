import { getRouterParam, setResponseStatus } from 'h3'
import { useRuntimeConfig } from '#imports'
import { createTableInputSchema } from '#shared/schemas/tables'
import { requireStoreOwner } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { createTable } from '../../../../services/catalog/tables'
import { defineApiHandler } from '../../../../utils/api-handler'
import { parseBody } from '../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const input = await parseBody(event, createTableInputSchema)
  const table = await createTable(getDb(), ctx, input, useRuntimeConfig(event).public.appBaseUrl)
  setResponseStatus(event, 201)
  return table
})
