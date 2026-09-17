import { defineEventHandler } from 'h3'
import { catalogManagementHandlerDeps, createMemberCreateHandler } from '../../../../utils/catalog-management-http'

export default defineEventHandler(createMemberCreateHandler(catalogManagementHandlerDeps))
