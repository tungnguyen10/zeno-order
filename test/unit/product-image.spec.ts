import { describe, expect, it, vi } from 'vitest'
import { compressProductImage, MAX_PRODUCT_IMAGE_BYTES, productImagePath, scaleWithin } from '../../app/utils/product-image'

function sourceFile(type = 'image/jpeg') {
  return new File([new Uint8Array([1, 2, 3])], 'product.photo.jpg', { type })
}

describe('product image utility', () => {
  it('builds the single deterministic Storage path', () => {
    expect(productImagePath('store-a', 'product-b')).toBe('stores/store-a/products/product-b/main.webp')
  })

  it('scales the longest edge to 1200 without upscaling', () => {
    expect(scaleWithin(2400, 1200, 1200)).toEqual({ width: 1200, height: 600 })
    expect(scaleWithin(800, 1600, 1200)).toEqual({ width: 600, height: 1200 })
    expect(scaleWithin(640, 480, 1200)).toEqual({ width: 640, height: 480 })
  })

  it('rejects unsupported input MIME before decoding', async () => {
    const decode = vi.fn()
    await expect(compressProductImage(sourceFile('image/svg+xml'), { decode, encode: vi.fn() })).rejects.toThrow('Định dạng ảnh không được hỗ trợ')
    expect(decode).not.toHaveBeenCalled()
  })

  it('encodes bounded WebP qualities until the payload fits', async () => {
    const close = vi.fn()
    const decode = vi.fn().mockResolvedValue({ width: 2400, height: 1200, source: {}, close })
    const sizes = [MAX_PRODUCT_IMAGE_BYTES + 2, MAX_PRODUCT_IMAGE_BYTES + 1, MAX_PRODUCT_IMAGE_BYTES]
    const encode = vi.fn(async () => new Blob([new Uint8Array(sizes.shift()!)], { type: 'image/webp' }))
    const result = await compressProductImage(sourceFile(), { decode, encode })
    expect(encode.mock.calls.map(call => call.slice(1))).toEqual([
      [1200, 600, 0.86],
      [1200, 600, 0.76],
      [1200, 600, 0.66],
    ])
    expect(result).toBeInstanceOf(File)
    expect(result.name).toBe('product.photo.webp')
    expect(result.type).toBe('image/webp')
    expect(result.size).toBe(MAX_PRODUCT_IMAGE_BYTES)
    expect(close).toHaveBeenCalledOnce()
  })

  it('rejects after the finite minimum-quality attempt remains too large', async () => {
    const close = vi.fn()
    const encode = vi.fn(async () => new Blob([new Uint8Array(MAX_PRODUCT_IMAGE_BYTES + 1)], { type: 'image/webp' }))
    await expect(compressProductImage(sourceFile('image/png'), {
      decode: vi.fn().mockResolvedValue({ width: 500, height: 300, source: {}, close }),
      encode,
    })).rejects.toThrow('Ảnh vẫn vượt quá 2 MiB')
    expect(encode.mock.calls.map(call => call[3])).toEqual([0.86, 0.76, 0.66, 0.56, 0.46])
    expect(close).toHaveBeenCalledOnce()
  })
})
