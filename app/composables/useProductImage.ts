import { readonly, ref } from 'vue'
import { compressProductImage } from '../utils/product-image'

interface ProductImageResponse {
  imagePath: string | null
}

interface ProductImageDependencies {
  compress: (file: File) => Promise<File>
  request: <T>(url: string, options: { method: 'PUT' | 'DELETE', body?: FormData }) => Promise<T>
}

export function useProductImage(overrides: Partial<ProductImageDependencies> = {}) {
  const merchantApi = overrides.request ? null : useMerchantApi()
  const compress = overrides.compress ?? compressProductImage
  const request = overrides.request ?? merchantApi!.request
  const pending = ref(false)
  const error = ref<string | null>(null)

  async function run<T>(operation: () => Promise<T>) {
    pending.value = true
    error.value = null
    try {
      return await operation()
    }
    catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Không thể xử lý ảnh sản phẩm.'
      throw cause
    }
    finally {
      pending.value = false
    }
  }

  async function replace(storeId: string, productId: string, file: File) {
    return run(async () => {
      const compressed = await compress(file)
      const body = new FormData()
      body.append('image', compressed)
      const result = await request<ProductImageResponse>(
        `/api/merchant/stores/${storeId}/products/${productId}/image`,
        { method: 'PUT', body },
      )
      return result.imagePath
    })
  }

  async function remove(storeId: string, productId: string) {
    return run(async () => {
      const result = await request<ProductImageResponse>(
        `/api/merchant/stores/${storeId}/products/${productId}/image`,
        { method: 'DELETE' },
      )
      return result.imagePath
    })
  }

  return {
    pending: readonly(pending),
    error: readonly(error),
    replace,
    remove,
  }
}
