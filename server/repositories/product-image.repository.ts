import type { SupabaseClient } from '@supabase/supabase-js'
import { productImagePath } from '../../app/utils/product-image'

type ProductImageErrorCode = 'FORBIDDEN' | 'NOT_FOUND' | 'STORAGE' | 'COMPENSATION' | 'INTERNAL'
type DatabaseError = { code?: string } | null
type ProductImageRow = { id: string, store_id: string, image_path: string | null }

export class ProductImageError extends Error {
  constructor(readonly code: ProductImageErrorCode) {
    super(code)
    this.name = 'ProductImageError'
  }
}

function databaseError(error: DatabaseError): never {
  if (error?.code === '42501') throw new ProductImageError('FORBIDDEN')
  throw new ProductImageError('INTERNAL')
}

function row(result: { data: ProductImageRow | null, error: DatabaseError }) {
  if (result.error) return databaseError(result.error)
  if (!result.data) throw new ProductImageError('NOT_FOUND')
  return result.data
}

export function createProductImageRepository(client: SupabaseClient) {
  async function readProduct(storeId: string, productId: string) {
    return row(await client.from('products')
      .select('id,store_id,image_path')
      .eq('store_id', storeId)
      .eq('id', productId)
      .maybeSingle())
  }

  async function writePath(storeId: string, productId: string, imagePath: string | null) {
    return row(await client.from('products')
      .update({ image_path: imagePath })
      .eq('store_id', storeId)
      .eq('id', productId)
      .select('id,store_id,image_path')
      .maybeSingle())
  }

  async function compensatePath(storeId: string, productId: string, priorPath: string | null) {
    try {
      await writePath(storeId, productId, priorPath)
      return true
    }
    catch {
      return false
    }
  }

  async function storageOperationFailed(operation: () => Promise<{ error: unknown }>) {
    try {
      return Boolean((await operation()).error)
    }
    catch {
      return true
    }
  }

  return {
    async replace(storeId: string, productId: string, bytes: Uint8Array) {
      const current = await readProduct(storeId, productId)
      const path = productImagePath(storeId, productId)
      await writePath(storeId, productId, path)

      const bucket = client.storage.from('product-images')
      const uploadFailed = await storageOperationFailed(() => bucket.upload(path, bytes, {
          cacheControl: '31536000',
          contentType: 'image/webp',
          upsert: true,
        }))
      if (!uploadFailed) return { imagePath: path }

      const rowRestored = await compensatePath(storeId, productId, current.image_path)
      let orphanRemoved = true
      if (current.image_path === null) {
        try {
          const { error } = await bucket.remove([path])
          orphanRemoved = !error
        }
        catch {
          orphanRemoved = false
        }
      }
      if (!rowRestored || !orphanRemoved) throw new ProductImageError('COMPENSATION')
      throw new ProductImageError('STORAGE')
    },

    async remove(storeId: string, productId: string) {
      const current = await readProduct(storeId, productId)
      const path = productImagePath(storeId, productId)
      await writePath(storeId, productId, null)

      const removeFailed = await storageOperationFailed(() => client.storage.from('product-images').remove([path]))
      if (!removeFailed) return { imagePath: null }

      if (!await compensatePath(storeId, productId, current.image_path)) {
        throw new ProductImageError('COMPENSATION')
      }
      throw new ProductImageError('STORAGE')
    },
  }
}
