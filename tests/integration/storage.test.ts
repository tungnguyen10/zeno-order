import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { deleteObject, PRODUCT_IMAGES_BUCKET, publicObjectUrl, putObject } from '../../server/services/storage'

describe('storage service (Neon Object Storage)', () => {
  it('uploads to the public bucket and serves it anonymously', async () => {
    const key = `tests/${randomUUID()}.txt`
    const body = new TextEncoder().encode('xin chào')
    await putObject({ bucket: PRODUCT_IMAGES_BUCKET, key, body, contentType: 'text/plain; charset=utf-8' })
    try {
      const res = await fetch(publicObjectUrl(PRODUCT_IMAGES_BUCKET, key))
      expect(res.status).toBe(200)
      expect(await res.text()).toBe('xin chào')
    }
    finally {
      await deleteObject(PRODUCT_IMAGES_BUCKET, key)
    }
  })
})
