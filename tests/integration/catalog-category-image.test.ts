import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { MAX_PRODUCT_IMAGE_BYTES } from '#shared/catalog-limits'
import type { StoreContext } from '../../server/auth/guards'
import { closeDb, getDb } from '../../server/db/client'
import { categories } from '../../server/db/schema'
import { removeCategoryImage, replaceCategoryImage } from '../../server/services/catalog/category-image'
import type { ImageStorage } from '../../server/services/catalog/product-image'
import { listCategories } from '../../server/services/catalog/categories'
import { resetDb } from '../support/db'
import { createCategory, createTenant } from '../support/fixtures'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0, 0])

const ctxOf = (t: { owner: { userId: string }, org: { id: string }, store: { id: string } }): StoreContext => ({
  userId: t.owner.userId,
  orgId: t.org.id,
  storeId: t.store.id,
  role: 'OWNER',
})

const imageKeyOf = async (categoryId: string) =>
  (await getDb().select({ key: categories.imageKey }).from(categories).where(eq(categories.id, categoryId)))[0]!.key

function fakeStorage(opts: { failRemove?: boolean } = {}) {
  const calls = {
    put: [] as { bucket: string, key: string, contentType: string }[],
    remove: [] as { bucket: string, key: string }[],
  }
  const storage: ImageStorage = {
    put: async (input) => {
      calls.put.push({ bucket: input.bucket, key: input.key, contentType: input.contentType })
    },
    remove: async (bucket, key) => {
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

describe('replaceCategoryImage', () => {
  it('uploads with a tenant-scoped categories key, stores it and returns the public url', async () => {
    const t = await createTenant('cat-img')
    const category = await createCategory(t.store, 'Trà sữa')
    const { storage, calls } = fakeStorage()
    const result = await replaceCategoryImage(getDb(), ctxOf(t), category.id, PNG, storage)

    expect(calls.put).toHaveLength(1)
    expect(calls.put[0]).toMatchObject({ bucket: 'product-images', contentType: 'image/png' })
    expect(calls.put[0]!.key).toMatch(new RegExp(`^stores/${t.store.id}/categories/${category.id}/[A-Za-z0-9_-]{22}\\.png$`))
    expect(await imageKeyOf(category.id)).toBe(calls.put[0]!.key)
    expect(result.imageUrl).toMatch(new RegExp(`${calls.put[0]!.key}$`))
  })

  it('exposes the stored image as imageUrl on the category DTO', async () => {
    const t = await createTenant('cat-dto')
    const category = await createCategory(t.store, 'Cà phê')
    const { storage } = fakeStorage()
    const { imageUrl } = await replaceCategoryImage(getDb(), ctxOf(t), category.id, PNG, storage)
    const [dto] = await listCategories(getDb(), ctxOf(t))
    expect(dto!.imageUrl).toBe(imageUrl)
  })

  it('maps JPEG to .jpg', async () => {
    const t = await createTenant('cat-jpg')
    const category = await createCategory(t.store, 'Đá xay')
    const { storage, calls } = fakeStorage()
    await replaceCategoryImage(getDb(), ctxOf(t), category.id, JPEG, storage)
    expect(calls.put[0]!.key).toMatch(/\.jpg$/)
  })

  it('replaces the previous image and deletes the old object after the new key is committed', async () => {
    const t = await createTenant('cat-swap')
    const category = await createCategory(t.store, 'Topping', { imageKey: 'stores/x/categories/y/old.png' })
    const { storage, calls } = fakeStorage()
    await replaceCategoryImage(getDb(), ctxOf(t), category.id, PNG, storage)
    expect(calls.remove).toEqual([{ bucket: 'product-images', key: 'stores/x/categories/y/old.png' }])
    expect(await imageKeyOf(category.id)).toBe(calls.put[0]!.key)
  })

  it('still succeeds when removing the old image fails', async () => {
    const t = await createTenant('cat-cleanup')
    const category = await createCategory(t.store, 'Trà', { imageKey: 'stores/x/categories/y/old.png' })
    const { storage, calls } = fakeStorage({ failRemove: true })
    const result = await replaceCategoryImage(getDb(), ctxOf(t), category.id, PNG, storage)
    expect(result.imageUrl).toMatch(/\.png$/)
    expect(await imageKeyOf(category.id)).toBe(calls.put[0]!.key)
  })

  it('rejects non-image, empty and oversized files without uploading anything', async () => {
    const t = await createTenant('cat-bad')
    const category = await createCategory(t.store, 'Xấu')
    const { storage, calls } = fakeStorage()
    const text = Uint8Array.from(Buffer.from('<?php echo 1; ?> pretending to be a.png'))
    const tooBig = new Uint8Array(MAX_PRODUCT_IMAGE_BYTES + 1)
    tooBig.set(PNG)
    for (const bytes of [text, new Uint8Array(), tooBig]) {
      await expect(replaceCategoryImage(getDb(), ctxOf(t), category.id, bytes, storage)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    }
    expect(calls.put).toEqual([])
    expect(await imageKeyOf(category.id)).toBeNull()
  })

  it('NOT_FOUND for a category of another store, without uploading', async () => {
    const a = await createTenant('cat-a')
    const b = await createTenant('cat-b')
    const theirs = await createCategory(b.store, 'Của B')
    const { storage, calls } = fakeStorage()
    await expect(replaceCategoryImage(getDb(), ctxOf(a), theirs.id, PNG, storage)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(calls.put).toEqual([])
  })

  it('rejects a mismatched organization even with the correct store id', async () => {
    const a = await createTenant('cat-org-a')
    const b = await createTenant('cat-org-b')
    const category = await createCategory(a.store, 'Của A')
    const { storage, calls } = fakeStorage()
    await expect(replaceCategoryImage(getDb(), { ...ctxOf(a), orgId: b.org.id }, category.id, PNG, storage)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(calls.put).toEqual([])
  })
})

describe('removeCategoryImage', () => {
  it('clears the key and deletes the stored object', async () => {
    const t = await createTenant('cat-rm')
    const category = await createCategory(t.store, 'Trà', { imageKey: 'stores/x/categories/y/old.png' })
    const { storage, calls } = fakeStorage()
    const result = await removeCategoryImage(getDb(), ctxOf(t), category.id, storage)
    expect(result).toEqual({ imageUrl: null })
    expect(calls.remove).toEqual([{ bucket: 'product-images', key: 'stores/x/categories/y/old.png' }])
    expect(await imageKeyOf(category.id)).toBeNull()
    const [dto] = await listCategories(getDb(), ctxOf(t))
    expect(dto!.imageUrl).toBeNull()
  })

  it('is a no-op delete when the category has no image', async () => {
    const t = await createTenant('cat-rm-none')
    const category = await createCategory(t.store, 'Không ảnh')
    const { storage, calls } = fakeStorage()
    expect(await removeCategoryImage(getDb(), ctxOf(t), category.id, storage)).toEqual({ imageUrl: null })
    expect(calls.remove).toEqual([])
  })

  it('NOT_FOUND for a category of another store', async () => {
    const a = await createTenant('cat-rm-a')
    const b = await createTenant('cat-rm-b')
    const theirs = await createCategory(b.store, 'Của B', { imageKey: 'stores/x/categories/y/z.png' })
    const { storage } = fakeStorage()
    await expect(removeCategoryImage(getDb(), ctxOf(a), theirs.id, storage)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
