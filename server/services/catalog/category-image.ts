import { and, eq } from 'drizzle-orm'
import { MAX_PRODUCT_IMAGE_BYTES, type ProductImageType } from '#shared/catalog-limits'
import type { StoreContext } from '../../auth/guards'
import type { Db } from '../../db/client'
import { categories } from '../../db/schema'
import { inStore } from '../../repositories/catalog'
import { AppError } from '../../utils/errors'
import { detectImageType } from '../../utils/image-type'
import { logger } from '../../utils/logger'
import { generateToken } from '../../utils/tokens'
import { deleteObject, PRODUCT_IMAGES_BUCKET, publicObjectUrl, putObject } from '../storage'
import type { ImageStorage } from './product-image'

const defaultStorage: ImageStorage = { put: putObject, remove: deleteObject }

const EXTENSIONS: Record<ProductImageType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

const notFound = () => new AppError('NOT_FOUND', 'Không tìm thấy')

export async function replaceCategoryImage(
  db: Db,
  ctx: StoreContext,
  categoryId: string,
  bytes: Uint8Array,
  storage: ImageStorage = defaultStorage,
): Promise<{ imageUrl: string }> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PRODUCT_IMAGE_BYTES) {
    throw new AppError('VALIDATION_FAILED', 'Ảnh phải nhỏ hơn hoặc bằng 2 MB')
  }
  const type = detectImageType(bytes)
  if (!type) throw new AppError('VALIDATION_FAILED', 'Chỉ nhận ảnh JPG, PNG hoặc WebP')

  const [existing] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), inStore(categories, ctx)))
    .limit(1)
  if (!existing) throw notFound()

  const key = `stores/${ctx.storeId}/categories/${categoryId}/${generateToken(16)}.${EXTENSIONS[type]}`
  await storage.put({
    bucket: PRODUCT_IMAGES_BUCKET,
    key,
    body: bytes,
    contentType: type,
    cacheControl: 'public, max-age=31536000, immutable',
  })

  let previousKey: string | null
  try {
    previousKey = await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ imageKey: categories.imageKey })
        .from(categories)
        .where(and(eq(categories.id, categoryId), inStore(categories, ctx)))
        .limit(1)
        .for('update')
      if (!current) throw notFound()
      await tx.update(categories).set({ imageKey: key, updatedAt: new Date() }).where(and(eq(categories.id, categoryId), inStore(categories, ctx)))
      return current.imageKey
    })
  }
  catch (err) {
    await storage.remove(PRODUCT_IMAGES_BUCKET, key).catch((cleanupError: unknown) => {
      logger.warn('catalog.category_image_rollback_cleanup_failed', { categoryId, key, err: cleanupError })
    })
    throw err
  }

  if (previousKey) {
    await storage.remove(PRODUCT_IMAGES_BUCKET, previousKey).catch((err: unknown) => {
      logger.warn('catalog.category_image_cleanup_failed', { categoryId, err })
    })
  }
  return { imageUrl: publicObjectUrl(PRODUCT_IMAGES_BUCKET, key) }
}

export async function removeCategoryImage(
  db: Db,
  ctx: StoreContext,
  categoryId: string,
  storage: ImageStorage = defaultStorage,
): Promise<{ imageUrl: null }> {
  const previousKey = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ imageKey: categories.imageKey })
      .from(categories)
      .where(and(eq(categories.id, categoryId), inStore(categories, ctx)))
      .limit(1)
      .for('update')
    if (!current) throw notFound()
    if (current.imageKey) {
      await tx.update(categories).set({ imageKey: null, updatedAt: new Date() }).where(and(eq(categories.id, categoryId), inStore(categories, ctx)))
    }
    return current.imageKey
  })

  if (previousKey) {
    await storage.remove(PRODUCT_IMAGES_BUCKET, previousKey).catch((err: unknown) => {
      logger.warn('catalog.category_image_cleanup_failed', { categoryId, err })
    })
  }
  return { imageUrl: null }
}
