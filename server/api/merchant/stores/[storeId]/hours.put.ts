import { defineEventHandler } from 'h3'
import { catalogManagementHandlerDeps, createHoursHandler } from '../../../../utils/catalog-management-http'

export default defineEventHandler(createHoursHandler(catalogManagementHandlerDeps))
