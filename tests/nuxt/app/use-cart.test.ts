import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref, nextTick } from 'vue'
import { useCart } from '~/composables/useCart'
import { emptyCart, serializeCart, type NewCartLine } from '~/utils/cart-storage'

const KEY = 'zeno:cart:demo'
const wrappers: { unmount: () => void }[] = []

const tea: NewCartLine = {
  productId: 'p-tea',
  name: 'Trà sữa',
  optionValueIds: ['m'],
  optionLabels: ['M'],
  unitPriceVnd: 35_000,
  quantity: 2,
  note: '',
}

async function mountCart(slug = 'demo') {
  let cart!: ReturnType<typeof useCart>
  const wrapper = await mountSuspended(defineComponent({
    setup() {
      cart = useCart(slug)
      return () => h('p', String(cart.count.value))
    },
  }))
  wrappers.push(wrapper)
  return { cart, wrapper }
}

beforeEach(() => {
  localStorage.clear()
  clearNuxtState()
})

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  vi.restoreAllMocks()
})

describe('useCart', () => {
  it('becomes ready after mount with an empty cart', async () => {
    const { cart } = await mountCart()
    expect(cart.ready.value).toBe(true)
    expect(cart.count.value).toBe(0)
  })

  it('persists changes under zeno:cart:<slug>', async () => {
    const { cart } = await mountCart()
    cart.add(tea)
    cart.add({ ...tea, quantity: 1 })
    const stored = JSON.parse(localStorage.getItem(KEY)!)
    expect(stored.lines).toHaveLength(1)
    expect(stored.lines[0]).toMatchObject({ productId: 'p-tea', quantity: 3 })
    expect(cart.count.value).toBe(3)
    expect(cart.subtotalVnd.value).toBe(105_000)
  })

  it('restores a stored cart after a reload', async () => {
    const seeded = emptyCart()
    seeded.lines.push({ ...tea, lineId: 'l1', stale: null, currentUnitPriceVnd: null })
    localStorage.setItem(KEY, serializeCart(seeded))
    const { cart } = await mountCart()
    expect(cart.count.value).toBe(2)
  })

  it('falls back to an empty cart when storage is corrupted', async () => {
    localStorage.setItem(KEY, '{"version":1,"lines":"oops"')
    const { cart } = await mountCart()
    expect(cart.count.value).toBe(0)
    cart.add(tea)
    expect(cart.count.value).toBe(2)
  })

  it('keeps working in memory when localStorage refuses writes (Safari private mode, quota)', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    const { cart } = await mountCart()
    expect(() => cart.add(tea)).not.toThrow()
    expect(cart.count.value).toBe(2)
  })

  it('follows changes made in another tab', async () => {
    const { cart } = await mountCart()
    const other = emptyCart()
    other.lines.push({ ...tea, lineId: 'x', quantity: 4, stale: null, currentUnitPriceVnd: null })
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: serializeCart(other) }))
    expect(cart.count.value).toBe(4)
  })

  it('keeps the carts of different stores apart', async () => {
    const a = await mountCart('quan-a')
    const b = await mountCart('quan-b')
    a.cart.add(tea)
    expect(a.cart.count.value).toBe(2)
    expect(b.cart.count.value).toBe(0)
    expect(localStorage.getItem('zeno:cart:quan-b')).toBeNull()
  })

  it('reuses the idempotency key for an identical payload only, and forgets it after success', async () => {
    const { cart } = await mountCart()
    cart.add(tea)
    const first = cart.ensureIdempotencyKey('payload-A')
    expect(cart.ensureIdempotencyKey('payload-A')).toBe(first)
    expect(cart.ensureIdempotencyKey('payload-B')).not.toBe(first)
    cart.clearAfterSuccess()
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ lines: [], pendingIdempotencyKey: null })
  })

  it('remembers the customer form between visits', async () => {
    const { cart } = await mountCart()
    cart.updateForm({ fulfillmentType: 'DELIVERY', customer: { name: 'Lan', phone: '0912345678', address: '12 Lê Lợi' } })
    clearNuxtState()
    const again = await mountCart()
    expect(again.cart.customer.value).toEqual({ name: 'Lan', phone: '0912345678', address: '12 Lê Lợi' })
    expect(again.cart.fulfillmentType.value).toBe('DELIVERY')
  })
})


it('switches store state and storage keys when the slug changes', async () => {
  const slug = ref('first')
  let cart!: ReturnType<typeof useCart>
  const wrapper = await mountSuspended(defineComponent({
    setup() {
      cart = useCart(slug)
      return () => h('div')
    },
  }))
  cart.add(tea)
  slug.value = 'second'
  await nextTick()
  expect(cart.count.value).toBe(0)
  cart.add({ ...tea, quantity: 3 })
  expect(JSON.parse(localStorage.getItem('zeno:cart:second')!).lines[0].quantity).toBe(3)
  slug.value = 'first'
  await nextTick()
  expect(cart.count.value).toBe(2)
  wrapper.unmount()
})
