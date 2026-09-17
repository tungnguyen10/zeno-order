import { defineEventHandler } from 'h3'
import { catalogManagementHandlerDeps, createMemberDeleteHandler } from '../../../../../utils/catalog-management-http'

export default defineEventHandler(createMemberDeleteHandler(catalogManagementHandlerDeps))
