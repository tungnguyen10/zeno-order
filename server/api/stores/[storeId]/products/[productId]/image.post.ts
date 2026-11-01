import { getHeader, getRouterParam, readMultipartFormData } from 'h3'
import { MAX_PRODUCT_IMAGE_BYTES } from '#shared/catalog-limits'
import { requireStoreOwner } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { replaceProductImage } from '../../../../../services/catalog/product-image'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { AppError } from '../../../../../utils/errors'
import { detectImageType } from '../../../../../utils/image-type'
import { requireUuidParam } from '../../../../../utils/ids'

const MULTIPART_OVERHEAD_BYTES = 64 * 1024

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const productId = requireUuidParam(event, 'productId')

  const declared = Number(getHeader(event, 'content-length') ?? 0)
  if (declared > MAX_PRODUCT_IMAGE_BYTES + MULTIPART_OVERHEAD_BYTES) {
    throw new AppError('VALIDATION_FAILED', 'Ảnh phải nhỏ hơn hoặc bằng 2 MB')
  }
  const parts = await readMultipartFormData(event)
  const file = parts?.find(part => part.name === 'file' && part.filename !== undefined)
  if (!file) throw new AppError('VALIDATION_FAILED', 'Thiếu file ảnh')

  if (!file.type || file.type !== detectImageType(file.data)) {
    throw new AppError('VALIDATION_FAILED', 'Loại file không khớp nội dung ảnh JPG, PNG hoặc WebP')
  }

  return replaceProductImage(getDb(), ctx, productId, file.data)
})
