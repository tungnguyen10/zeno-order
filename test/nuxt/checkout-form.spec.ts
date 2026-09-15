import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'

import CheckoutForm from '../../app/components/checkout/CheckoutForm.vue'

const turnstileStub = {
  props: ['siteKey'],
  emits: ['verified'],
  template: '<button data-turnstile-stub type="button" @click="$emit(\'verified\', \'verified-token\')">Verify</button>',
}

describe('CheckoutForm', () => {
  it('shows delivery fields conditionally and emits a normalized draft', async () => {
    const wrapper = await mountSuspended(CheckoutForm, {
      props: { pending: false, siteKey: 'test-site-key' },
      global: { stubs: { CheckoutTurnstileWidget: turnstileStub } },
    })

    expect(wrapper.find('[name="deliveryAddress"]').exists()).toBe(false)
    await wrapper.get('[value="delivery"]').setValue(true)
    expect(wrapper.find('[name="deliveryAddress"]').exists()).toBe(true)
    await wrapper.get('[name="customerName"]').setValue('Tú')
    await wrapper.get('[name="customerPhone"]').setValue('0900000000')
    await wrapper.get('[name="deliveryAddress"]').setValue('12 Nguyễn Huệ')
    await wrapper.get('[data-turnstile-stub]').trigger('click')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
      fulfillmentType: 'delivery',
      customer: { name: 'Tú', phone: '0900000000' },
      delivery: { address: '12 Nguyễn Huệ', note: '' },
      paymentMethod: 'cash',
      turnstileToken: 'verified-token',
    })
  })

  it('locks the call to action while a request is pending', async () => {
    const wrapper = await mountSuspended(CheckoutForm, {
      props: { pending: true, siteKey: 'test-site-key' },
      global: { stubs: { CheckoutTurnstileWidget: turnstileStub } },
    })
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('button[type="submit"]').text()).toContain('Đang đặt đơn')
  })
})
