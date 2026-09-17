import type { SupabaseClient } from '@supabase/supabase-js'
import type { EventHandler, H3Event, MultiPartData } from 'h3'
import { Buffer } from 'node:buffer'
import { createApp, createError, createRouter, getHeader, getResponseHeader, toWebHandler } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import { MAX_PRODUCT_IMAGE_BYTES } from '../../app/utils/product-image'
import imageDeleteRoute from '../../server/api/merchant/stores/[storeId]/products/[productId]/image.delete'
import imagePutRoute from '../../server/api/merchant/stores/[storeId]/products/[productId]/image.put'
import { ProductImageError } from '../../server/repositories/product-image.repository'
import type { ProductImageHandlerDeps } from '../../server/utils/product-image-http'
import { createProductImageDeleteHandler, createProductImagePutHandler, productImageHandlerDeps } from '../../server/utils/product-image-http'

const storeId = '11111111-1111-4111-8111-111111111111'
const productId = '22222222-2222-4222-8222-222222222222'

function webpData(size = 12) {
  const data = Buffer.alloc(size)
  data.set([82, 73, 70, 70], 0)
  data.set([87, 69, 66, 80], 8)
  return data
}

function filePart(overrides: Partial<MultiPartData> = {}): MultiPartData {
  return { name: 'image', filename: 'main.webp', type: 'image/webp', data: webpData(), ...overrides }
}

function setup(parts: MultiPartData[] | null = [filePart()], params: Record<string, string> = {}, authorization: string | undefined = 'Bearer valid-token') {
  const headers = new Map<string, string>()
  const event = { context: { params: { storeId, productId, ...params } }, node: { req: { headers: { authorization } }, res: { statusCode: 200, getHeader: (name: string) => headers.get(name.toLowerCase()), setHeader: (name: string, value: string) => headers.set(name.toLowerCase(), String(value)) } } } as unknown as H3Event
  const client = { jwtScoped: true } as unknown as SupabaseClient
  const repositoryMethods = {
    replace: vi.fn().mockResolvedValue({ imagePath: 'path' }),
    remove: vi.fn().mockResolvedValue({ imagePath: null }),
  }
  const repository = vi.fn().mockReturnValue(repositoryMethods)
  const authenticate = vi.fn(async (input: H3Event) => {
    if (getHeader(input, 'authorization') !== 'Bearer valid-token') throw createError({ statusCode: 401, message: 'Invalid bearer' })
    return { client, user: { id: 'user-a' } }
  })
  const readMultipartFormData = vi.fn().mockResolvedValue(parts ?? undefined)
  const deps: ProductImageHandlerDeps = { authenticate, repository, readMultipartFormData }
  return { event, client, repositoryMethods, repository, authenticate, readMultipartFormData, deps }
}

describe('product image API', () => {
  it('validates and forwards a WebP upload through the JWT-scoped repository', async () => {
    const test = setup()
    await expect(createProductImagePutHandler(test.deps)(test.event)).resolves.toEqual({ imagePath: 'path' })
    expect(test.repository).toHaveBeenCalledWith(test.client)
    expect(test.repositoryMethods.replace).toHaveBeenCalledWith(storeId, productId, expect.any(Uint8Array))
    expect(getResponseHeader(test.event, 'cache-control')).toBe('private, no-store')
  })

  it('deletes through the repository and returns private no-store', async () => {
    const test = setup(undefined)
    await expect(createProductImageDeleteHandler(test.deps)(test.event)).resolves.toEqual({ imagePath: null })
    expect(test.repositoryMethods.remove).toHaveBeenCalledWith(storeId, productId)
    expect(test.readMultipartFormData).not.toHaveBeenCalled()
    expect(getResponseHeader(test.event, 'cache-control')).toBe('private, no-store')
  })

  it.each([createProductImagePutHandler, createProductImageDeleteHandler])('rejects invalid route UUIDs before repository creation', async (factory) => {
    const invalidParams: Record<string, string>[] = [{ storeId: 'bad' }, { productId: 'bad' }]
    for (const params of invalidParams) {
      const test = setup(undefined, params)
      await expect(factory(test.deps)(test.event)).rejects.toMatchObject({ statusCode: 400 })
      expect(test.repository).not.toHaveBeenCalled()
    }
  })

  it.each([createProductImagePutHandler, createProductImageDeleteHandler])('preserves authentication errors before repository creation', async (factory) => {
    const test = setup(undefined, {}, '')
    await expect(factory(test.deps)(test.event)).rejects.toMatchObject({ statusCode: 401 })
    expect(test.repository).not.toHaveBeenCalled()
  })

  it.each([
    null,
    [],
    [filePart(), filePart()],
    [filePart({ name: 'other' })],
    [filePart({ type: 'image/png' })],
    [filePart({ data: Buffer.alloc(0) })],
    [filePart({ data: Buffer.alloc(MAX_PRODUCT_IMAGE_BYTES + 1) })],
    [filePart({ data: Buffer.alloc(12) })],
  ])('rejects malformed multipart or non-WebP payloads without repository access', async (parts) => {
    const test = setup(parts)
    await expect(createProductImagePutHandler(test.deps)(test.event)).rejects.toMatchObject({ statusCode: 400 })
    expect(test.repository).not.toHaveBeenCalled()
  })

  it('maps multipart parser failures to a safe 400 before repository access', async () => {
    const test = setup()
    test.readMultipartFormData.mockRejectedValue(new Error('secret parser detail'))
    const error = await createProductImagePutHandler(test.deps)(test.event).catch(error => error) as { statusCode: number, message: string }
    expect(error.statusCode).toBe(400)
    expect(error.message).not.toContain('secret')
    expect(test.repository).not.toHaveBeenCalled()
  })

  it.each([['FORBIDDEN', 403], ['NOT_FOUND', 404], ['STORAGE', 500], ['COMPENSATION', 500], ['INTERNAL', 500]] as const)('maps %s repository errors to safe HTTP %i', async (code, statusCode) => {
    const test = setup()
    test.repositoryMethods.replace.mockRejectedValue(new ProductImageError(code))
    const error = await createProductImagePutHandler(test.deps)(test.event).catch(error => error) as { statusCode: number, message: string }
    expect(error.statusCode).toBe(statusCode)
    expect(error.message).not.toContain('secret')
  })

  it('does not pass through untrusted H3 or Storage details', async () => {
    const test = setup()
    test.repositoryMethods.replace.mockRejectedValue(createError({ statusCode: 403, message: 'secret storage detail' }))
    const error = await createProductImagePutHandler(test.deps)(test.event).catch(error => error) as { statusCode: number, message: string }
    expect(error.statusCode).toBe(500)
    expect(error.message).not.toContain('secret')
  })
})

describe('product image route adapters', () => {
  it.each([
    { method: 'PUT' as const, handler: imagePutRoute, repositoryMethod: 'replace' as const },
    { method: 'DELETE' as const, handler: imageDeleteRoute, repositoryMethod: 'remove' as const },
  ])('$method executes the exported adapter through an H3 Web Request', async ({ method, handler, repositoryMethod }) => {
    const test = setup()
    const originalDeps = { ...productImageHandlerDeps }
    Object.assign(productImageHandlerDeps, {
      authenticate: test.authenticate,
      repository: test.repository,
    })
    try {
      const app = createApp()
      const router = createRouter()
      router.add('/stores/:storeId/products/:productId/image', handler as EventHandler, method.toLowerCase() as Lowercase<typeof method>)
      app.use(router)
      const body = method === 'PUT' ? new FormData() : undefined
      if (body) body.append('image', new Blob([new Uint8Array(webpData())], { type: 'image/webp' }), 'main.webp')
      const response = await toWebHandler(app)(new Request(`http://management.test/stores/${storeId}/products/${productId}/image`, {
        method,
        headers: { authorization: 'Bearer valid-token' },
        body,
      }))
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(test.repositoryMethods[repositoryMethod]).toHaveBeenCalledOnce()
    }
    finally {
      Object.assign(productImageHandlerDeps, originalDeps)
    }
  })
})
