import { defineEventHandler } from 'h3'
import { catalogManagementHandlerDeps, createSettingsHandler } from '../../../../utils/catalog-management-http'

export default defineEventHandler(createSettingsHandler(catalogManagementHandlerDeps))
