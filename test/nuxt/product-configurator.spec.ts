import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'

import ProductConfigurator from '../../app/components/storefront/ProductConfigurator.vue'

const product = {
  id: 'product-1',
  name: 'Cà phê sữa đá',
  slug: 'ca-phe-sua-da',
  description: 'Đậm vị',
  basePrice: '35000',
  imagePath: null,
}

const sizeGroup = {
  id: 'size',
  name: 'Kích cỡ',
  selectionType: 'single' as const,
  required: true,
  minSelect: 1,
  maxSelect: 1,
  values: [
    { id: 'small', name: 'Nhỏ', priceAdjustment: '0', isDefault: true },
    { id: 'large', name: 'Lớn', priceAdjustment: '12000', isDefault: false },
  ],
}

describe('ProductConfigurator', () => {
  it('opens with defaults and emits a valid configured cart item', async () => {
    const wrapper = await mountSuspended(ProductConfigurator, {
      props: {
        open: true,
        product,
        optionGroups: [sizeGroup],
        currency: 'VND',
      },
    })

    expect(wrapper.get('[role="dialog"]').attributes('aria-modal')).toBe('true')
    expect((wrapper.get('input[value="small"]').element as HTMLInputElement).checked).toBe(true)
    await wrapper.get('input[value="large"]').setValue(true)
    await wrapper.get('textarea').setValue('Ít đá')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('add')?.[0]?.[0]).toEqual({
      productId: 'product-1',
      productName: 'Cà phê sữa đá',
      basePrice: '35000',
      options: [{
        optionGroupId: 'size',
        optionGroupName: 'Kích cỡ',
        optionValueId: 'large',
        optionValueName: 'Lớn',
        priceAdjustment: '12000',
      }],
      quantity: 1,
      note: 'Ít đá',
    })
  })

  it('shows a visible error and emits nothing for a missing required choice', async () => {
    const wrapper = await mountSuspended(ProductConfigurator, {
      props: {
        open: true,
        product,
        optionGroups: [{ ...sizeGroup, values: sizeGroup.values.map(value => ({ ...value, isDefault: false })) }],
        currency: 'VND',
      },
    })

    await wrapper.get('form').trigger('submit')

    expect(wrapper.text()).toContain('Vui lòng chọn ít nhất 1 mục cho Kích cỡ.')
    expect(wrapper.emitted('add')).toBeUndefined()
  })
})
