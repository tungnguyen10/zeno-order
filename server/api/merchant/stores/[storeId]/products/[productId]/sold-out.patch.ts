import { defineEventHandler } from 'h3'
import { catalogManagementHandlerDeps, createSoldOutHandler } from '../../../../../../utils/catalog-management-http'

export default defineEventHandler(createSoldOutHandler(catalogManagementHandlerDeps))
