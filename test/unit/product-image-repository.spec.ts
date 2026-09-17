import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { productImagePath } from '../../app/utils/product-image'
import { createProductImageRepository, ProductImageError } from '../../server/repositories/product-image.repository'

const storeId = '11111111-1111-4111-8111-111111111111'
const productId = '22222222-2222-4222-8222-222222222222'
const path = productImagePath(storeId, productId)
const bytes = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80])

function success(data: unknown) { return { data, error: null } }
function failure(code = 'XX000') { return { data: null, error: { code, message: 'secret database detail' } } }

function mockClient(databaseResults: unknown[], storageResults: { upload?: unknown[], remove?: unknown[] } = {}) {
  const queries: Array<{ table: string, query: ReturnType<typeof queryBuilder> }> = []
  function queryBuilder(result: unknown) {
    return {
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(result),
    }
  }
  const uploadResults = [...(storageResults.upload ?? [success(null)])]
  const removeResults = [...(storageResults.remove ?? [success(null)])]
  const bucket = {
    upload: vi.fn(async () => uploadResults.shift() ?? success(null)),
    remove: vi.fn(async () => removeResults.shift() ?? success(null)),
  }
  const client = {
    from: vi.fn((table: string) => {
      const query = queryBuilder(databaseResults.shift() ?? success(null))
      queries.push({ table, query })
      return query
    }),
    storage: { from: vi.fn().mockReturnValue(bucket) },
  }
  return { client: client as unknown as SupabaseClient, queries, bucket, storageFrom: client.storage.from }
}

describe('product image repository', () => {
  it('scopes ownership before product id and uploads to the exact bucket/path', async () => {
    const { client, queries, bucket, storageFrom } = mockClient([
      success({ id: productId, store_id: storeId, image_path: null }),
      success({ id: productId, store_id: storeId, image_path: path }),
    ])
    const result = await createProductImageRepository(client).replace(storeId, productId, bytes)
    expect(result).toEqual({ imagePath: path })
    expect(queries[0]!.query.eq.mock.calls).toEqual([['store_id', storeId], ['id', productId]])
    expect(queries[1]!.query.update).toHaveBeenCalledWith({ image_path: path })
    expect(queries[1]!.query.eq.mock.calls).toEqual([['store_id', storeId], ['id', productId]])
    expect(storageFrom).toHaveBeenCalledWith('product-images')
    expect(bucket.upload).toHaveBeenCalledWith(path, bytes, {
      cacheControl: '31536000',
      contentType: 'image/webp',
      upsert: true,
    })
  })

  it('does not touch Storage when the database image-path update fails', async () => {
    const { client, bucket } = mockClient([
      success({ id: productId, store_id: storeId, image_path: null }),
      failure('42501'),
    ])
    await expect(createProductImageRepository(client).replace(storeId, productId, bytes)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(bucket.upload).not.toHaveBeenCalled()
    expect(bucket.remove).not.toHaveBeenCalled()
  })

  it('restores a null row and removes a possible new orphan when upload fails', async () => {
    const { client, queries, bucket } = mockClient([
      success({ id: productId, store_id: storeId, image_path: null }),
      success({ id: productId, store_id: storeId, image_path: path }),
      success({ id: productId, store_id: storeId, image_path: null }),
    ], { upload: [failure('STORAGE')] })
    await expect(createProductImageRepository(client).replace(storeId, productId, bytes)).rejects.toMatchObject({ code: 'STORAGE' })
    expect(queries[2]!.query.update).toHaveBeenCalledWith({ image_path: null })
    expect(bucket.remove).toHaveBeenCalledWith([path])
  })

  it('restores an existing path without deleting the prior deterministic object on upload failure', async () => {
    const { client, queries, bucket } = mockClient([
      success({ id: productId, store_id: storeId, image_path: path }),
      success({ id: productId, store_id: storeId, image_path: path }),
      success({ id: productId, store_id: storeId, image_path: path }),
    ], { upload: [failure('STORAGE')] })
    await expect(createProductImageRepository(client).replace(storeId, productId, bytes)).rejects.toMatchObject({ code: 'STORAGE' })
    expect(queries[2]!.query.update).toHaveBeenCalledWith({ image_path: path })
    expect(bucket.remove).not.toHaveBeenCalled()
  })

  it('reports compensation failure instead of hiding a row/object invariant risk', async () => {
    const { client } = mockClient([
      success({ id: productId, store_id: storeId, image_path: null }),
      success({ id: productId, store_id: storeId, image_path: path }),
      failure('XX000'),
    ], { upload: [failure('STORAGE')] })
    await expect(createProductImageRepository(client).replace(storeId, productId, bytes)).rejects.toMatchObject({ code: 'COMPENSATION' })
  })

  it('reports compensation failure when a possible new orphan cannot be removed', async () => {
    const { client } = mockClient([
      success({ id: productId, store_id: storeId, image_path: null }),
      success({ id: productId, store_id: storeId, image_path: path }),
      success({ id: productId, store_id: storeId, image_path: null }),
    ], { upload: [failure('STORAGE')], remove: [failure('STORAGE')] })
    await expect(createProductImageRepository(client).replace(storeId, productId, bytes)).rejects.toMatchObject({ code: 'COMPENSATION' })
  })

  it('clears the row then removes only the deterministic Storage object', async () => {
    const { client, queries, bucket } = mockClient([
      success({ id: productId, store_id: storeId, image_path: path }),
      success({ id: productId, store_id: storeId, image_path: null }),
    ])
    await expect(createProductImageRepository(client).remove(storeId, productId)).resolves.toEqual({ imagePath: null })
    expect(queries[1]!.query.update).toHaveBeenCalledWith({ image_path: null })
    expect(bucket.remove).toHaveBeenCalledWith([path])
  })

  it('restores the prior row path when Storage removal fails', async () => {
    const { client, queries } = mockClient([
      success({ id: productId, store_id: storeId, image_path: path }),
      success({ id: productId, store_id: storeId, image_path: null }),
      success({ id: productId, store_id: storeId, image_path: path }),
    ], { remove: [failure('STORAGE')] })
    await expect(createProductImageRepository(client).remove(storeId, productId)).rejects.toMatchObject({ code: 'STORAGE' })
    expect(queries[2]!.query.update).toHaveBeenCalledWith({ image_path: path })
  })

  it('does not remove the object when clearing the database row fails', async () => {
    const { client, bucket } = mockClient([
      success({ id: productId, store_id: storeId, image_path: path }),
      failure('42501'),
    ])
    await expect(createProductImageRepository(client).remove(storeId, productId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(bucket.remove).not.toHaveBeenCalled()
  })

  it('maps missing products and database details to stable errors', async () => {
    for (const [result, code] of [[success(null), 'NOT_FOUND'], [failure('42501'), 'FORBIDDEN'], [failure('XX000'), 'INTERNAL']] as const) {
      const { client } = mockClient([result])
      const error = await createProductImageRepository(client).remove(storeId, productId).catch(error => error)
      expect(error).toBeInstanceOf(ProductImageError)
      expect(error).toMatchObject({ code })
      expect(error.message).not.toContain('secret')
    }
  })
})
