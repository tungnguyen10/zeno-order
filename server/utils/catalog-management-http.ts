import type { SupabaseClient } from '@supabase/supabase-js'
import type { H3Event } from 'h3'

import {
  createError,
  getRouterParam,
  readBody,
  setResponseHeader,
} from 'h3'

import {
  catalogCreateSchemas,
  catalogResourceIdSchema,
  catalogResourceSchema,
  catalogUpdateSchemas,
  membershipSchema,
  membershipUpdateSchema,
  productSoldOutSchema,
  resourceIdSchema,
  storeHoursSchema,
  storeSettingsSchema,
} from '../../shared/schemas/catalog-management'
import {
  CatalogManagementError,
  createCatalogManagementRepository,
} from '../repositories/catalog-management.repository'
import { requireMerchantClient } from './merchant-auth'

type Repository = ReturnType<typeof createCatalogManagementRepository>

interface AuthenticatedMerchant {
  client: SupabaseClient
  user: { id: string }
}

export interface CatalogManagementHandlerDeps {
  authenticate: (event: H3Event) => Promise<AuthenticatedMerchant>
  repository: (client: SupabaseClient) => Repository
  readBody: (event: H3Event) => Promise<unknown>
}

export const catalogManagementHandlerDeps: CatalogManagementHandlerDeps = {
  authenticate: requireMerchantClient,
  repository: createCatalogManagementRepository,
  readBody,
}

class CatalogRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CatalogRequestError'
  }
}

function badRequest(message: string): never {
  throw new CatalogRequestError(message)
}

function requestError(error: CatalogRequestError): never {
  throw createError({ statusCode: 400, message: error.message })
}

function requiredUuidParam(event: H3Event, name: string, message: string) {
  const parsed = resourceIdSchema.safeParse(getRouterParam(event, name))
  if (!parsed.success) return badRequest(message)
  return parsed.data
}

function requiredStoreId(event: H3Event) {
  return requiredUuidParam(event, 'storeId', 'Cửa hàng không hợp lệ.')
}

function requiredCatalogResource(event: H3Event) {
  const parsed = catalogResourceSchema.safeParse(getRouterParam(event, 'resource'))
  if (!parsed.success) return badRequest('Loại dữ liệu danh mục không hợp lệ.')
  return parsed.data
}

function requiredResourceId(event: H3Event, resource: ReturnType<typeof requiredCatalogResource>) {
  const parsed = catalogResourceIdSchema(resource).safeParse(getRouterParam(event, 'resourceId'))
  if (!parsed.success) return badRequest('Dữ liệu danh mục không hợp lệ.')
  return parsed.data
}

async function parsedBody<T>(
  event: H3Event,
  deps: CatalogManagementHandlerDeps,
  schema: { safeParse: (input: unknown) => { success: true, data: T } | { success: false } },
  message: string,
) {
  let body: unknown
  try {
    body = await deps.readBody(event)
  }
  catch {
    return badRequest(message)
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return badRequest(message)
  return parsed.data
}

function repositoryError(error: unknown): never {
  if (error instanceof CatalogManagementError) {
    const status = {
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      INTERNAL: 500,
    }[error.code]
    const message = {
      FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
      NOT_FOUND: 'Không tìm thấy dữ liệu quản lý.',
      CONFLICT: 'Dữ liệu xung đột hoặc không hợp lệ.',
      INTERNAL: 'Không thể xử lý dữ liệu quản lý.',
    }[error.code]
    throw createError({ statusCode: status, message })
  }
  throw createError({ statusCode: 500, message: 'Không thể xử lý dữ liệu quản lý.' })
}

function managementHandler(
  action: (event: H3Event, repository: () => Repository, userId: string) => Promise<unknown>,
  deps: CatalogManagementHandlerDeps,
) {
  return async (event: H3Event) => {
    setResponseHeader(event, 'cache-control', 'private, no-store')
    try {
      requiredStoreId(event)
    }
    catch (error) {
      if (error instanceof CatalogRequestError) return requestError(error)
      throw error
    }
    const { client, user } = await deps.authenticate(event)
    try {
      return await action(event, () => deps.repository(client), user.id)
    }
    catch (error) {
      if (error instanceof CatalogRequestError) return requestError(error)
      return repositoryError(error)
    }
  }
}

export function createManagementHandler(deps: CatalogManagementHandlerDeps) {
  return managementHandler((event, repository, userId) => repository().getSnapshot(requiredStoreId(event), userId), deps)
}

export function createCatalogCreateHandler(deps: CatalogManagementHandlerDeps) {
  return managementHandler(async (event, repository) => {
    const storeId = requiredStoreId(event)
    const resource = requiredCatalogResource(event)
    const body = await parsedBody<unknown>(event, deps, catalogCreateSchemas[resource], 'Dữ liệu danh mục không hợp lệ.')
    return repository().createResource(storeId, resource, body as Record<string, unknown>)
  }, deps)
}

export function createCatalogUpdateHandler(deps: CatalogManagementHandlerDeps) {
  return managementHandler(async (event, repository) => {
    const storeId = requiredStoreId(event)
    const resource = requiredCatalogResource(event)
    const resourceId = requiredResourceId(event, resource)
    const body = await parsedBody<unknown>(event, deps, catalogUpdateSchemas[resource], 'Dữ liệu danh mục không hợp lệ.')
    return repository().updateResource(storeId, resource, resourceId, body as Record<string, unknown>)
  }, deps)
}

export function createCatalogDeleteHandler(deps: CatalogManagementHandlerDeps) {
  return managementHandler((event, repository) => {
    const storeId = requiredStoreId(event)
    const resource = requiredCatalogResource(event)
    const resourceId = requiredResourceId(event, resource)
    return repository().deleteResource(storeId, resource, resourceId)
  }, deps)
}

export function createSoldOutHandler(deps: CatalogManagementHandlerDeps) {
  return managementHandler(async (event, repository) => {
    const storeId = requiredStoreId(event)
    const productId = requiredUuidParam(event, 'productId', 'Sản phẩm không hợp lệ.')
    const body = await parsedBody(event, deps, productSoldOutSchema, 'Trạng thái sản phẩm không hợp lệ.')
    return repository().setSoldOut(storeId, productId, body.isSoldOut)
  }, deps)
}

export function createSettingsHandler(deps: CatalogManagementHandlerDeps) {
  return managementHandler(async (event, repository) => {
    const storeId = requiredStoreId(event)
    const body = await parsedBody(event, deps, storeSettingsSchema, 'Cài đặt cửa hàng không hợp lệ.')
    return repository().updateSettings(storeId, body)
  }, deps)
}

export function createHoursHandler(deps: CatalogManagementHandlerDeps) {
  return managementHandler(async (event, repository) => {
    const storeId = requiredStoreId(event)
    const body = await parsedBody(event, deps, storeHoursSchema, 'Giờ mở cửa không hợp lệ.')
    return repository().replaceHours(storeId, body)
  }, deps)
}

export function createMemberCreateHandler(deps: CatalogManagementHandlerDeps) {
  return managementHandler(async (event, repository) => {
    const storeId = requiredStoreId(event)
    const body = await parsedBody(event, deps, membershipSchema, 'Thành viên không hợp lệ.')
    return repository().addMember(storeId, body)
  }, deps)
}

export function createMemberUpdateHandler(deps: CatalogManagementHandlerDeps) {
  return managementHandler(async (event, repository) => {
    const storeId = requiredStoreId(event)
    const memberUserId = requiredUuidParam(event, 'userId', 'Thành viên không hợp lệ.')
    const body = await parsedBody(event, deps, membershipUpdateSchema, 'Vai trò thành viên không hợp lệ.')
    return repository().updateMember(storeId, memberUserId, body)
  }, deps)
}

export function createMemberDeleteHandler(deps: CatalogManagementHandlerDeps) {
  return managementHandler((event, repository) => {
    const storeId = requiredStoreId(event)
    const memberUserId = requiredUuidParam(event, 'userId', 'Thành viên không hợp lệ.')
    return repository().removeMember(storeId, memberUserId)
  }, deps)
}
