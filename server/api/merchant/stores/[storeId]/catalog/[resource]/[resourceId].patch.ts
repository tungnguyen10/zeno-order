import { defineEventHandler } from 'h3'
import { catalogManagementHandlerDeps, createCatalogUpdateHandler } from '../../../../../../utils/catalog-management-http'

export default defineEventHandler(createCatalogUpdateHandler(catalogManagementHandlerDeps))
