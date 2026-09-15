import type { H3Event } from 'h3'

import { createError, getRouterParam } from 'h3'
import { orderNumberSchema, storeIdSchema } from '../../shared/schemas/merchant'

export function requireStoreId(event: H3Event) {
  const parsed = storeIdSchema.safeParse(getRouterParam(event, 'storeId'))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Cửa hàng không hợp lệ.' })
  return parsed.data
}

export function requireOrderNumber(event: H3Event) {
  const parsed = orderNumberSchema.safeParse(getRouterParam(event, 'orderNumber'))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Mã đơn không hợp lệ.' })
  return parsed.data
}

export function merchantRepositoryError(error: unknown): never {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('INVALID_ORDER_STATUS_TRANSITION')) {
    throw createError({ statusCode: 409, statusMessage: 'Không thể chuyển đơn sang trạng thái này.' })
  }
  if (message.includes('ORDER_NOT_FOUND')) {
    throw createError({ statusCode: 404, statusMessage: 'Không tìm thấy đơn hàng.' })
  }
  throw createError({ statusCode: 500, statusMessage: 'Không thể xử lý dữ liệu vận hành.' })
}
