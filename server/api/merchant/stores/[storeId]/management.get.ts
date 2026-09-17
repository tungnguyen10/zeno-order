import { defineEventHandler } from 'h3'
import { catalogManagementHandlerDeps, createManagementHandler } from '../../../../utils/catalog-management-http'

export default defineEventHandler(createManagementHandler(catalogManagementHandlerDeps))
