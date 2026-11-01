import type { CategoryDTO, ProductDTO } from '#shared/types/catalog'

export function useMenuAdmin() {
  const api = useApi()
  const { activeStore } = useActiveStore()
  const storeId = computed(() => activeStore.value?.id)
  const categories = ref<CategoryDTO[]>([])
  const products = ref<ProductDTO[]>([])
  const status = ref<'pending' | 'success' | 'error'>('pending')
  let generation = 0

  async function refresh() {
    const id = storeId.value
    const request = ++generation
    categories.value = []
    products.value = []
    status.value = 'pending'
    if (!id) return
    try {
      const [categoryResult, productResult] = await Promise.all([
        api<{ categories: CategoryDTO[] }>(`/api/stores/${id}/categories`),
        api<{ products: ProductDTO[] }>(`/api/stores/${id}/products`),
      ])
      if (request !== generation || storeId.value !== id) return
      categories.value = categoryResult.categories
      products.value = productResult.products
      status.value = 'success'
    }
    catch {
      if (request === generation && storeId.value === id) status.value = 'error'
    }
  }

  function replaceProduct(product: ProductDTO) {
    products.value = products.value.map(item => item.id === product.id ? product : item)
  }

  function currentStoreId() {
    const id = storeId.value
    if (!id) throw new Error('No active store')
    return id
  }

  async function addProduct(input: { name: string, basePriceVnd: number, categoryId: string | null }): Promise<ProductDTO> {
    const id = currentStoreId()
    const created = await api<ProductDTO>(`/api/stores/${id}/products`, { method: 'POST', body: input })
    if (storeId.value === id) products.value = [...products.value, created]
    return created
  }

  async function addCategory(name: string): Promise<CategoryDTO> {
    const id = currentStoreId()
    const created = await api<CategoryDTO>(`/api/stores/${id}/categories`, { method: 'POST', body: { name } })
    if (storeId.value === id) categories.value = [...categories.value, created]
    return created
  }

  async function patchProduct(productId: string, patch: Record<string, unknown>): Promise<ProductDTO> {
    const id = currentStoreId()
    const updated = await api<ProductDTO>(`/api/stores/${id}/products/${productId}`, { method: 'PATCH', body: patch })
    if (storeId.value === id) replaceProduct(updated)
    return updated
  }

  watch(storeId, refresh, { immediate: true })

  return { storeId, categories, products, status, refresh, addProduct, addCategory, patchProduct, replaceProduct }
}
