import type { SupabaseClient } from '@supabase/supabase-js'
import type { H3Event, MultiPartData } from 'h3'
import { createError, getRouterParam, readMultipartFormData, setResponseHeader } from 'h3'
import { MAX_PRODUCT_IMAGE_BYTES } from '../../app/utils/product-image'
import { resourceIdSchema } from '../../shared/schemas/catalog-management'
import { createProductImageRepository, ProductImageError } from '../repositories/product-image.repository'
import { requireMerchantClient } from './merchant-auth'

type Repository = ReturnType<typeof createProductImageRepository>

export interface ProductImageHandlerDeps {
  authenticate: (event: H3Event) => Promise<{ client: SupabaseClient, user: { id: string } }>
  repository: (client: SupabaseClient) => Repository
  readMultipartFormData: (event: H3Event) => Promise<MultiPartData[] | undefined>
}

export const productImageHandlerDeps: ProductImageHandlerDeps = {
  authenticate: requireMerchantClient,
  repository: createProductImageRepository,
  readMultipartFormData,
}

function uuidParam(event: H3Event, name: string, message: string) {
  const parsed = resourceIdSchema.safeParse(getRouterParam(event, name))
  if (!parsed.success) throw createError({ statusCode: 400, message })
  return parsed.data
}

function isWebP(data: Uint8Array) {
  return data.length >= 12
    && data[0] === 82 && data[1] === 73 && data[2] === 70 && data[3] === 70
    && data[8] === 87 && data[9] === 69 && data[10] === 66 && data[11] === 80
}

async function imageBytes(event: H3Event, deps: ProductImageHandlerDeps) {
  let parts: MultiPartData[] | undefined
  try {
    parts = await deps.readMultipartFormData(event)
  }
  catch {
    throw createError({ statusCode: 400, message: 'Ảnh tải lên không hợp lệ.' })
  }
  const part = parts?.length === 1 ? parts[0] : undefined
  if (!part || part.name !== 'image' || !part.filename || part.type !== 'image/webp'
    || part.data.length === 0 || part.data.length > MAX_PRODUCT_IMAGE_BYTES || !isWebP(part.data)) {
    throw createError({ statusCode: 400, message: 'Ảnh tải lên phải là WebP và không vượt quá 2 MiB.' })
  }
  return new Uint8Array(part.data)
}

function mapRepositoryError(error: unknown): never {
  if (error instanceof ProductImageError) {
    const statusCode = error.code === 'FORBIDDEN' ? 403 : error.code === 'NOT_FOUND' ? 404 : 500
    const message = error.code === 'FORBIDDEN'
      ? 'Bạn không có quyền thay đổi ảnh sản phẩm.'
      : error.code === 'NOT_FOUND'
        ? 'Không tìm thấy sản phẩm.'
        : error.code === 'COMPENSATION'
          ? 'Không thể đồng bộ ảnh sản phẩm; cần kiểm tra lại dữ liệu.'
          : 'Không thể xử lý ảnh sản phẩm.'
    throw createError({ statusCode, message })
  }
  throw createError({ statusCode: 500, message: 'Không thể xử lý ảnh sản phẩm.' })
}

function routeIds(event: H3Event) {
  return {
    storeId: uuidParam(event, 'storeId', 'Cửa hàng không hợp lệ.'),
    productId: uuidParam(event, 'productId', 'Sản phẩm không hợp lệ.'),
  }
}

export function createProductImagePutHandler(deps: ProductImageHandlerDeps) {
  return async (event: H3Event) => {
    setResponseHeader(event, 'cache-control', 'private, no-store')
    const { storeId, productId } = routeIds(event)
    const { client } = await deps.authenticate(event)
    const bytes = await imageBytes(event, deps)
    try {
      return await deps.repository(client).replace(storeId, productId, bytes)
    }
    catch (error) {
      return mapRepositoryError(error)
    }
  }
}

export function createProductImageDeleteHandler(deps: ProductImageHandlerDeps) {
  return async (event: H3Event) => {
    setResponseHeader(event, 'cache-control', 'private, no-store')
    const { storeId, productId } = routeIds(event)
    const { client } = await deps.authenticate(event)
    try {
      return await deps.repository(client).remove(storeId, productId)
    }
    catch (error) {
      return mapRepositoryError(error)
    }
  }
}
