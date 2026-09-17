import { defineEventHandler } from 'h3'
import { catalogManagementHandlerDeps, createMemberUpdateHandler } from '../../../../../utils/catalog-management-http'

export default defineEventHandler(createMemberUpdateHandler(catalogManagementHandlerDeps))
