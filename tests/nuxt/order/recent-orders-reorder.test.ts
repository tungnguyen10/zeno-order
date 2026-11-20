import { renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen, waitFor } from '@testing-library/vue'
import { beforeEach, describe, expect, it } from 'vitest'
import OrderRecentOrders from '~/components/order/RecentOrders.vue'
import type { PublicProduct } from '#shared/types/catalog'

const product: PublicProduct = {
  id: 'p1', categoryId: null, name: 'Trà sữa', description: null,
  basePriceVnd: 35_000, isAvailable: true, imageUrl: null, optionGroups: [],
}

function seedRecent() {
  localStorage.setItem('zeno:orders', JSON.stringify([{
    token: 't1', publicCode: 'ABC', storeSlug: 'demo', storeName: 'Demo', totalVnd: 70_000,
    createdAt: new Date().toISOString(),
    items: [{ productId: 'p1', name: 'Trà sữa', optionValueIds: [], quantity: 2, note: '' }],
  }]))
}

beforeEach(() => {
  localStorage.clear()
  clearNuxtState()
})

describe('OrderRecentOrders re-order', () => {
  it('rebuilds the cart from a past order and asks the page to open checkout', async () => {
    seedRecent()
    const { emitted } = await renderSuspended(OrderRecentOrders, { props: { slug: 'demo', products: [product], canOrder: true } })

    await fireEvent.click(await screen.findByRole('button', { name: 'Đặt lại đơn ABC' }))

    await waitFor(() => {
      const cart = JSON.parse(localStorage.getItem('zeno:cart:demo') ?? '{"lines":[]}')
      expect(cart.lines).toHaveLength(1)
      expect(cart.lines[0]).toMatchObject({ productId: 'p1', quantity: 2 })
    })
    expect(emitted().reordered).toHaveLength(1)
  })

  it('hides the re-order button when there are no current products to order', async () => {
    seedRecent()
    await renderSuspended(OrderRecentOrders, { props: { slug: 'demo', products: [], canOrder: true } })
    expect(screen.queryByRole('button', { name: 'Đặt lại đơn ABC' })).toBeNull()
  })
})
