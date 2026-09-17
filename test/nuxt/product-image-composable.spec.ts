import { describe, expect, it, vi } from 'vitest'
import { useProductImage } from '../../app/composables/useProductImage'

const storeId = '11111111-1111-4111-8111-111111111111'
const productId = '22222222-2222-4222-8222-222222222222'

describe('useProductImage', () => {
  it('compresses then sends FormData only through the merchant Nitro client', async () => {
    const source = new File(['source'], 'source.jpg', { type: 'image/jpeg' })
    const compressed = new File(['webp'], 'source.webp', { type: 'image/webp' })
    const compress = vi.fn().mockResolvedValue(compressed)
    const request = vi.fn().mockResolvedValue({ imagePath: 'stores/path/main.webp' })
    const image = useProductImage({ compress, request })

    await expect(image.replace(storeId, productId, source)).resolves.toBe('stores/path/main.webp')
    expect(compress).toHaveBeenCalledWith(source)
    expect(request).toHaveBeenCalledOnce()
    const [url, options] = request.mock.calls[0]!
    expect(url).toBe(`/api/merchant/stores/${storeId}/products/${productId}/image`)
    expect(options.method).toBe('PUT')
    expect(options.body).toBeInstanceOf(FormData)
    expect(options.body.get('image')).toBe(compressed)
    expect(image.pending.value).toBe(false)
    expect(image.error.value).toBeNull()
  })

  it('removes through Nitro and exposes readonly pending/error state', async () => {
    let rejectRequest: (reason: Error) => void = () => {}
    const request = vi.fn().mockImplementation(() => new Promise((_resolve, reject) => { rejectRequest = reject }))
    const image = useProductImage({ compress: vi.fn(), request })
    const operation = image.remove(storeId, productId)
    expect(image.pending.value).toBe(true)
    rejectRequest(new Error('network down'))
    await expect(operation).rejects.toThrow('network down')
    expect(request).toHaveBeenCalledWith(`/api/merchant/stores/${storeId}/products/${productId}/image`, { method: 'DELETE' })
    expect(image.pending.value).toBe(false)
    expect(image.error.value).toBe('network down')
  })
})
