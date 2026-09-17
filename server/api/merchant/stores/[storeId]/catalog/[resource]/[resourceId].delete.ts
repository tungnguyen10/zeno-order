import { defineEventHandler } from 'h3'
import { catalogManagementHandlerDeps, createCatalogDeleteHandler } from '../../../../../../utils/catalog-management-http'

export default defineEventHandler(createCatalogDeleteHandler(catalogManagementHandlerDeps))
