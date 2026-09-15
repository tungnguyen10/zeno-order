import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { cartStorageKey, useCartStore } from '../../app/stores/cart'

class MemoryStorage {
  readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  removeItem(key: string) {
    this.values.delete(key)
  }
}

const item = {
  productId: 'product-1',
  productName: 'Cà phê sữa đá',
  basePrice: '35000',
  options: [],
  quantity: 2,
  note: '',
}

describe('useCartStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('persists and hydrates a versioned cart for one public slug', () => {
    const storage = new MemoryStorage()
    const cart = useCartStore()

    cart.addItem('mochi-cafe', 'VND', item, storage, 'line-1')
    expect(JSON.parse(storage.getItem(cartStorageKey('mochi-cafe'))!)).toMatchObject({
      version: 1,
      publicSlug: 'mochi-cafe',
      items: [{ id: 'line-1', quantity: 2 }],
    })

    setActivePinia(createPinia())
    const restored = useCartStore()
    restored.hydrate('mochi-cafe', 'VND', storage)
    expect(restored.cartFor('mochi-cafe')?.items[0]?.id).toBe('line-1')
  })

  it('keeps separate stores in separate documents', () => {
    const storage = new MemoryStorage()
    const cart = useCartStore()

    cart.addItem('mochi-cafe', 'VND', item, storage, 'mochi-line')
    cart.addItem('tea-house', 'VND', { ...item, productName: 'Trà' }, storage, 'tea-line')

    expect(cart.cartFor('mochi-cafe')?.items.map(line => line.id)).toEqual(['mochi-line'])
    expect(cart.cartFor('tea-house')?.items.map(line => line.id)).toEqual(['tea-line'])
    expect(storage.values.size).toBe(2)
  })

  it.each([
    '{broken',
    JSON.stringify({ version: 2, publicSlug: 'mochi-cafe', currency: 'VND', items: [] }),
    JSON.stringify({ version: 1, publicSlug: 'other-store', currency: 'VND', items: [] }),
  ])('discards malformed, unsupported or wrong-store persisted data', (stored) => {
    const storage = new MemoryStorage()
    storage.setItem(cartStorageKey('mochi-cafe'), stored)
    const cart = useCartStore()

    cart.hydrate('mochi-cafe', 'VND', storage)

    expect(cart.cartFor('mochi-cafe')?.items).toEqual([])
    expect(storage.getItem(cartStorageKey('mochi-cafe'))).toBeNull()
  })

  it('updates quantity, removes lines and clears the final storage key', () => {
    const storage = new MemoryStorage()
    const cart = useCartStore()
    cart.addItem('mochi-cafe', 'VND', item, storage, 'line-1')

    cart.updateQuantity('mochi-cafe', 'line-1', 3, storage)
    expect(cart.cartFor('mochi-cafe')?.items[0]?.quantity).toBe(3)
    expect(cart.itemCount('mochi-cafe')).toBe(3)
    expect(cart.subtotal('mochi-cafe')).toBe('105000')

    cart.removeItem('mochi-cafe', 'line-1', storage)
    expect(cart.cartFor('mochi-cafe')?.items).toEqual([])
    expect(storage.getItem(cartStorageKey('mochi-cafe'))).toBeNull()
  })

  it('rejects invalid slugs and invalid item payloads', () => {
    const storage = new MemoryStorage()
    const cart = useCartStore()

    expect(() => cart.addItem('admin', 'VND', item, storage, 'line-1')).toThrow()
    expect(() => cart.addItem('mochi-cafe', 'VND', { ...item, quantity: 0 }, storage, 'line-1')).toThrow()
  })
})
