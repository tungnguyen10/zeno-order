import { getRouterParam } from 'h3'
import { useRuntimeConfig } from '#imports'
import { requireStoreOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { regenerateTable } from '../../../../../services/catalog/tables'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { requireUuidParam } from '../../../../../utils/ids'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const tableId = requireUuidParam(event, 'tableId')
  return regenerateTable(getDb(), ctx, tableId, useRuntimeConfig(event).public.appBaseUrl)
})
