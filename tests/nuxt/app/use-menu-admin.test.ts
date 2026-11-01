import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CategoryDTO, ProductDTO } from '#shared/types/catalog'

const { api } = vi.hoisted(() => ({ api: vi.fn() }))
mockNuxtImport('useApi', () => () => api)

const product = (overrides: Partial<ProductDTO> = {}): ProductDTO => ({
  id: 'p1', categoryId: null, name: 'Trà sữa', description: null,
  basePriceVnd: 35000, isAvailable: true, active: true, position: 0,
  imageUrl: null, optionGroups: [], ...overrides,
})
const category: CategoryDTO = { id: 'c1', name: 'Trà', position: 0, active: true }
const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

beforeEach(() => {
  api.mockReset()
  useState('me').value = {
    user: { id: 'u', email: 'a@b.vn', displayName: 'A' }, organizations: [],
    stores: [
      { id: 's1', orgId: 'o1', name: 'Quán 1', slug: 'quan-1', role: 'OWNER', isAcceptingOrders: true },
      { id: 's2', orgId: 'o1', name: 'Quán 2', slug: 'quan-2', role: 'OWNER', isAcceptingOrders: true },
    ],
  }
  useCookie('zeno_active_store').value = 's1'
})

describe('useMenuAdmin', () => {
  it('loads categories and products for the active store', async () => {
    api.mockImplementation(async (url: string) => url.endsWith('/categories') ? { categories: [category] } : { products: [product()] })
    const menu = useMenuAdmin()
    await vi.waitFor(() => expect(menu.status.value).toBe('success'))
    expect(api).toHaveBeenCalledWith('/api/stores/s1/categories')
    expect(api).toHaveBeenCalledWith('/api/stores/s1/products')
    expect(menu.categories.value).toEqual([category])
    expect(menu.products.value).toEqual([product()])
  })

  it('reports load failure', async () => {
    api.mockRejectedValue(new Error('offline'))
    const menu = useMenuAdmin()
    await vi.waitFor(() => expect(menu.status.value).toBe('error'))
  })

  it('adds a product and patches availability', async () => {
    api.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (options?.method === 'POST') return product({ id: 'p2', name: 'Cà phê' })
      if (options?.method === 'PATCH') return product({ isAvailable: false })
      return url.endsWith('/categories') ? { categories: [] } : { products: [product()] }
    })
    const menu = useMenuAdmin()
    await vi.waitFor(() => expect(menu.status.value).toBe('success'))
    await menu.addProduct({ name: 'Cà phê', basePriceVnd: 35000, categoryId: null })
    expect(api).toHaveBeenCalledWith('/api/stores/s1/products', { method: 'POST', body: { name: 'Cà phê', basePriceVnd: 35000, categoryId: null } })
    expect(menu.products.value.map(p => p.id)).toEqual(['p1', 'p2'])
    await menu.patchProduct('p1', { isAvailable: false })
    expect(api).toHaveBeenCalledWith('/api/stores/s1/products/p1', { method: 'PATCH', body: { isAvailable: false } })
    expect(menu.products.value[0]?.isAvailable).toBe(false)
  })

  it('clears the old store immediately and ignores its late load', async () => {
    const oldCategories = deferred<{ categories: CategoryDTO[] }>()
    const oldProducts = deferred<{ products: ProductDTO[] }>()
    api.mockImplementation((url: string) => {
      if (url.includes('/s1/')) return url.endsWith('/categories') ? oldCategories.promise : oldProducts.promise
      return Promise.resolve(url.endsWith('/categories') ? { categories: [{ ...category, id: 'c2' }] } : { products: [product({ id: 'p2' })] })
    })
    const menu = useMenuAdmin()
    useState<{ stores: Array<{ id: string }> }>('me').value.stores = [{ id: 's2' }]
    await nextTick()
    await vi.waitFor(() => expect(menu.status.value).toBe('success'))
    oldCategories.resolve({ categories: [category] })
    oldProducts.resolve({ products: [product()] })
    await oldProducts.promise
    await nextTick()
    expect(menu.storeId.value).toBe('s2')
    expect(menu.categories.value.map(c => c.id)).toEqual(['c2'])
    expect(menu.products.value.map(p => p.id)).toEqual(['p2'])
  })

  it('clears loaded rows during a switch and ignores a late old-store mutation', async () => {
    const oldPatch = deferred<ProductDTO>()
    const newCategories = deferred<{ categories: CategoryDTO[] }>()
    const newProducts = deferred<{ products: ProductDTO[] }>()
    api.mockImplementation((url: string, options?: { method?: string }) => {
      if (options?.method === 'PATCH') return oldPatch.promise
      if (url.includes('/s2/')) return url.endsWith('/categories') ? newCategories.promise : newProducts.promise
      return Promise.resolve(url.endsWith('/categories') ? { categories: [category] } : { products: [product()] })
    })
    const menu = useMenuAdmin()
    await vi.waitFor(() => expect(menu.status.value).toBe('success'))
    const patch = menu.patchProduct('p1', { isAvailable: false })
    useState<{ stores: Array<{ id: string }> }>('me').value.stores = [{ id: 's2' }]
    await nextTick()
    expect(menu.categories.value).toEqual([])
    expect(menu.products.value).toEqual([])
    expect(menu.status.value).toBe('pending')
    oldPatch.resolve(product({ isAvailable: false }))
    await patch
    expect(menu.products.value).toEqual([])
    newCategories.resolve({ categories: [] })
    newProducts.resolve({ products: [product({ id: 'p2' })] })
    await vi.waitFor(() => expect(menu.status.value).toBe('success'))
    expect(menu.products.value.map(p => p.id)).toEqual(['p2'])
  })
})
