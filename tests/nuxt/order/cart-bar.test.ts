import { renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OrderCartBar from '~/components/order/CartBar.vue'
import { addLine, emptyCart, serializeCart } from '~/utils/cart-storage'

const KEY = 'zeno:cart:demo'

function seed(quantity: number) {
  const cart = addLine(emptyCart(), {
    productId: 'p1',
    name: 'Trà sữa',
    optionValueIds: [],
    optionLabels: [],
    unitPriceVnd: 35_000,
    quantity,
    note: '',
  }, () => 'l1')
  localStorage.setItem(KEY, serializeCart(cart))
}

beforeEach(() => {
  localStorage.clear()
  clearNuxtState()
})

describe('OrderCartBar', () => {
  it('renders nothing while the cart is empty', async () => {
    const { container } = await renderSuspended(OrderCartBar, { props: { slug: 'demo' } })
    expect(container.querySelector('[data-testid="cart-bar"]')).toBeNull()
  })

  it('shows count and total with an accessible name, and opens the sheet', async () => {
    seed(2)
    const onOpen = vi.fn()
    await renderSuspended(OrderCartBar, { props: { slug: 'demo', onOpen } })
    const button = await screen.findByRole('button', { name: 'Xem giỏ hàng, 2 món, 70.000đ' })
    expect(button.textContent).toContain('Giỏ • 2 món')
    expect(button.textContent).toContain('70.000đ')
    await fireEvent.click(button)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
