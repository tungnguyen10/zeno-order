import { defineEventHandler } from 'h3'
import { catalogManagementHandlerDeps, createCatalogCreateHandler } from '../../../../../utils/catalog-management-http'

export default defineEventHandler(createCatalogCreateHandler(catalogManagementHandlerDeps))
