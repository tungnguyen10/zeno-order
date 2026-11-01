import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import MenuQuickAdd from '~/components/menu/QuickAdd.vue'
import ZSelect from '~/components/z/Select.vue'
import type { CategoryDTO, ProductDTO } from '#shared/types/catalog'

const category: CategoryDTO = { id: 'c1', name: 'Trà', active: true, position: 0 }
const product: ProductDTO = {
  id: 'p1', categoryId: null, name: 'Cà phê', description: null, basePriceVnd: 35000,
  isAvailable: true, active: true, position: 0, imageUrl: null, optionGroups: [],
}

describe('MenuQuickAdd', () => {
  it('clears the selected category when switching to a store without categories', async () => {
    const addProduct = vi.fn().mockResolvedValue(product)
    const wrapper = await mountSuspended(MenuQuickAdd, {
      props: { storeId: 's1', categories: [category], addProduct, addCategory: vi.fn() },
    })
    wrapper.findComponent(ZSelect).vm.$emit('update:modelValue', 'c1')
    await wrapper.findAll('input')[0]!.setValue('Old store draft')
    await wrapper.setProps({ storeId: 's2', categories: [] })
    const inputs = wrapper.findAll('input')
    expect((inputs[0]!.element as HTMLInputElement).value).toBe('')
    await inputs[0]!.setValue('Cà phê')
    await inputs[1]!.setValue('35k')
    await wrapper.find('form').trigger('submit')
    await vi.waitFor(() => expect(addProduct).toHaveBeenCalledWith({ name: 'Cà phê', basePriceVnd: 35000, categoryId: null }))
  })
})
