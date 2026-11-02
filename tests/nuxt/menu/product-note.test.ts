import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import ProductSheet from '~/components/menu/ProductSheet.vue'
import { CHECKOUT_LIMITS } from '#shared/schemas/checkout'
import type { PublicProduct } from '#shared/types/catalog'

const product: PublicProduct = {
  id: 'tea', categoryId: null, name: 'Trà', description: null,
  basePriceVnd: 35000, isAvailable: true, imageUrl: null, optionGroups: [],
}
const sheetStub = { template: '<div><slot /><slot name="footer" /></div>' }

async function mountSheet() {
  return mountSuspended(ProductSheet, {
    props: { open: true, product, canOrder: true },
    global: { stubs: { ZSheet: sheetStub } },
  })
}

describe('product item note', () => {
  it('limits the optional note and emits it trimmed with the existing selection', async () => {
    const wrapper = await mountSheet()
    const input = wrapper.get('textarea')
    expect(input.attributes('maxlength')).toBe(String(CHECKOUT_LIMITS.maxNote))
    await input.setValue('  Ít đá, không đường  ')
    const add = wrapper.findAll('button').find(button => button.text().startsWith('Thêm'))!
    await add.trigger('click')
    expect(wrapper.emitted('add')?.[0]).toEqual([{ valueIds: [], quantity: 1, note: 'Ít đá, không đường' }])
    wrapper.unmount()
  })

  it('clears the note when reopening or choosing a different product', async () => {
    const wrapper = await mountSheet()
    await wrapper.get('textarea').setValue('first note')
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('')
    await wrapper.get('textarea').setValue('second note')
    await wrapper.setProps({ product: { ...product, id: 'coffee', name: 'Cà phê' } })
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('')
    wrapper.unmount()
  })
})
