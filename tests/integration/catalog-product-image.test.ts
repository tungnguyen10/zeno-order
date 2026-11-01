import { and, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { MAX_PRODUCT_IMAGE_BYTES } from '#shared/catalog-limits'
import type { StoreContext } from '../../server/auth/guards'
import { closeDb, getDb } from '../../server/db/client'
import { products } from '../../server/db/schema'
import { replaceProductImage, type ImageStorage } from '../../server/services/catalog/product-image'
import { resetDb } from '../support/db'
import { createProduct, createTenant } from '../support/fixtures'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0, 0])

const ctxOf = (t: { owner: { userId: string }, org: { id: string }, store: { id: string } }): StoreContext => ({
  userId: t.owner.userId,
  orgId: t.org.id,
  storeId: t.store.id,
  role: 'OWNER',
})

const imageKeyOf = async (productId: string) =>
  (await getDb().select({ key: products.imageKey }).from(products).where(eq(products.id, productId)))[0]!.key

function fakeStorage(opts: { failPut?: boolean, failRemove?: boolean } = {}) {
  const calls = {
    put: [] as { bucket: string, key: string, contentType: string, cacheControl?: string }[],
    remove: [] as { bucket: string, key: string }[],
    keyInDbWhenRemoving: [] as (string | null)[],
    productId: '',
  }
  const storage: ImageStorage = {
    put: async (input) => {
      if (opts.failPut) throw new Error('storage down')
      calls.put.push({ bucket: input.bucket, key: input.key, contentType: input.contentType, cacheControl: input.cacheControl })
    },
    remove: async (bucket, key) => {
      calls.keyInDbWhenRemoving.push(await imageKeyOf(calls.productId))
      calls.remove.push({ bucket, key })
      if (opts.failRemove) throw new Error('cleanup failed')
    },
  }
  return { storage, calls }
}

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('replaceProductImage', () => {
  it('uploads with a tenant-scoped key, stores it and returns the public url', async () => {
    const t = await createTenant('img')
    const product = await createProduct(t.store)
    const { storage, calls } = fakeStorage()
    const result = await replaceProductImage(getDb(), ctxOf(t), product.id, PNG, storage)

    expect(calls.put).toHaveLength(1)
    expect(calls.put[0]).toMatchObject({ bucket: 'product-images', contentType: 'image/png', cacheControl: 'public, max-age=31536000, immutable' })
    expect(calls.put[0]!.key).toMatch(new RegExp(`^stores/${t.store.id}/products/${product.id}/[A-Za-z0-9_-]{22}\\.png$`))
    expect(await imageKeyOf(product.id)).toBe(calls.put[0]!.key)
    expect(result.imageUrl).toMatch(new RegExp(`${calls.put[0]!.key}$`))
  })

  it('maps JPEG to .jpg', async () => {
    const t = await createTenant('jpg')
    const product = await createProduct(t.store)
    const { storage, calls } = fakeStorage()
    await replaceProductImage(getDb(), ctxOf(t), product.id, JPEG, storage)
    expect(calls.put[0]!.key).toMatch(/\.jpg$/)
  })

  it('deletes the previous image only after the new key is in the database', async () => {
    const t = await createTenant('swap')
    const product = await createProduct(t.store)
    const { storage, calls } = fakeStorage()
    calls.productId = product.id
    await replaceProductImage(getDb(), ctxOf(t), product.id, PNG, storage)
    const firstKey = calls.put[0]!.key
    await replaceProductImage(getDb(), ctxOf(t), product.id, JPEG, storage)
    const secondKey = calls.put[1]!.key

    expect(secondKey).not.toBe(firstKey)
    expect(calls.remove).toEqual([{ bucket: 'product-images', key: firstKey }])
    expect(calls.keyInDbWhenRemoving).toEqual([secondKey])
  })

  it('still succeeds when removing the old image fails', async () => {
    const t = await createTenant('cleanup')
    const product = await createProduct(t.store, { imageKey: 'stores/x/products/y/old.png' })
    const { storage, calls } = fakeStorage({ failRemove: true })
    calls.productId = product.id
    const result = await replaceProductImage(getDb(), ctxOf(t), product.id, PNG, storage)
    expect(result.imageUrl).toMatch(/\.png$/)
    expect(await imageKeyOf(product.id)).toBe(calls.put[0]!.key)
  })

  it('rejects non-image bytes, empty and oversized files without uploading anything', async () => {
    const t = await createTenant('bad')
    const product = await createProduct(t.store)
    const { storage, calls } = fakeStorage()
    const text = Uint8Array.from(Buffer.from('<?php echo 1; ?> pretending to be a.png'))
    const tooBig = new Uint8Array(MAX_PRODUCT_IMAGE_BYTES + 1)
    tooBig.set(PNG)
    for (const bytes of [text, new Uint8Array(), tooBig]) {
      await expect(replaceProductImage(getDb(), ctxOf(t), product.id, bytes, storage)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    }
    expect(calls.put).toEqual([])
    expect(await imageKeyOf(product.id)).toBeNull()
  })

  it('accepts a file of exactly 2 MB', async () => {
    const t = await createTenant('edge')
    const product = await createProduct(t.store)
    const exact = new Uint8Array(MAX_PRODUCT_IMAGE_BYTES)
    exact.set(PNG)
    const { storage, calls } = fakeStorage()
    await replaceProductImage(getDb(), ctxOf(t), product.id, exact, storage)
    expect(calls.put).toHaveLength(1)
  })

  it('leaves the product untouched when the storage upload fails', async () => {
    const t = await createTenant('down')
    const product = await createProduct(t.store, { imageKey: 'stores/x/products/y/keep.png' })
    const { storage } = fakeStorage({ failPut: true })
    await expect(replaceProductImage(getDb(), ctxOf(t), product.id, PNG, storage)).rejects.toThrow('storage down')
    expect(await imageKeyOf(product.id)).toBe('stores/x/products/y/keep.png')
  })

  it('removes the new object when the product disappears before the database commit', async () => {
    const t = await createTenant('deleted')
    const product = await createProduct(t.store)
    const removed: string[] = []
    let uploaded = ''
    const storage: ImageStorage = {
      put: async ({ key }) => {
        uploaded = key
        await getDb().delete(products).where(and(eq(products.id, product.id), eq(products.orgId, t.org.id), eq(products.storeId, t.store.id)))
      },
      remove: async (_bucket, key) => { removed.push(key) },
    }
    await expect(replaceProductImage(getDb(), ctxOf(t), product.id, PNG, storage)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(uploaded).not.toBe('')
    expect(removed).toEqual([uploaded])
  })

  it('rejects a mismatched organization even with the correct store id', async () => {
    const a = await createTenant('org-a')
    const b = await createTenant('org-b')
    const product = await createProduct(a.store)
    const { storage, calls } = fakeStorage()
    await expect(replaceProductImage(getDb(), { ...ctxOf(a), orgId: b.org.id }, product.id, PNG, storage)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(calls.put).toEqual([])
  })

  it('NOT_FOUND for a product of another store, without uploading', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const theirs = await createProduct(b.store)
    const { storage, calls } = fakeStorage()
    await expect(replaceProductImage(getDb(), ctxOf(a), theirs.id, PNG, storage)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(calls.put).toEqual([])
  })
})
