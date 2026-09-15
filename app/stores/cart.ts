import { defineStore } from 'pinia'
import { z } from 'zod'

import { publicSlugSchema } from '../../shared/schemas/public-slug'
import type {
  NewCartItem,
  StoreCartDocument,
} from '../../shared/types/cart'
import { calculateCartSubtotal } from '../domain/cart'

export interface CartStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

const moneySchema = z.string().regex(/^\d+$/)
const cartItemSchema = z.object({
  id: z.string().min(1),
  productId: z.string().min(1),
  productName: z.string().min(1),
  basePrice: moneySchema,
  options: z.array(z.object({
    optionGroupId: z.string().min(1),
    optionGroupName: z.string().min(1),
    optionValueId: z.string().min(1),
    optionValueName: z.string().min(1),
    priceAdjustment: moneySchema,
  })),
  quantity: z.number().int().min(1).max(99),
  note: z.string().max(500),
})
const newCartItemSchema = cartItemSchema.omit({ id: true })
const cartDocumentSchema = z.object({
  version: z.literal(1),
  publicSlug: publicSlugSchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
  items: z.array(cartItemSchema),
})

function defaultStorage(): CartStorage | null {
  return typeof window === 'undefined' ? null : window.localStorage
}

function createLineId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

function emptyCart(publicSlug: string, currency: string): StoreCartDocument {
  return { version: 1, publicSlug, currency, items: [] }
}

export function cartStorageKey(publicSlug: string): string {
  return `zeno-order:cart:v1:${publicSlugSchema.parse(publicSlug)}`
}

export const useCartStore = defineStore('storefront-cart', {
  state: () => ({
    carts: {} as Record<string, StoreCartDocument>,
  }),

  getters: {
    cartFor: state => (publicSlug: string) => state.carts[publicSlug] ?? null,
    itemCount: state => (publicSlug: string) => (state.carts[publicSlug]?.items ?? [])
      .reduce((count, item) => count + item.quantity, 0),
    subtotal: state => (publicSlug: string) => calculateCartSubtotal(
      state.carts[publicSlug]?.items ?? [],
    ),
  },

  actions: {
    hydrate(publicSlug: string, currency: string, storage?: CartStorage) {
      const validSlug = publicSlugSchema.parse(publicSlug)
      const validCurrency = z.string().regex(/^[A-Z]{3}$/).parse(currency)
      const target = storage ?? defaultStorage()
      const key = cartStorageKey(validSlug)

      if (!target) {
        this.carts[validSlug] ??= emptyCart(validSlug, validCurrency)
        return
      }

      const serialized = target.getItem(key)
      if (!serialized) {
        this.carts[validSlug] = emptyCart(validSlug, validCurrency)
        return
      }

      try {
        const parsed = cartDocumentSchema.parse(JSON.parse(serialized))
        if (parsed.publicSlug !== validSlug || parsed.currency !== validCurrency) {
          throw new Error('Cart namespace mismatch')
        }
        this.carts[validSlug] = parsed
      }
      catch {
        target.removeItem(key)
        this.carts[validSlug] = emptyCart(validSlug, validCurrency)
      }
    },

    addItem(
      publicSlug: string,
      currency: string,
      item: NewCartItem,
      storage?: CartStorage,
      lineId = createLineId(),
    ) {
      const validSlug = publicSlugSchema.parse(publicSlug)
      const validCurrency = z.string().regex(/^[A-Z]{3}$/).parse(currency)
      const validItem = newCartItemSchema.parse(item)
      const cart = this.carts[validSlug] ?? emptyCart(validSlug, validCurrency)

      if (cart.currency !== validCurrency) {
        throw new Error('Cart currency mismatch')
      }

      cart.items.push(cartItemSchema.parse({ ...validItem, id: lineId }))
      this.carts[validSlug] = cart
      this.persist(validSlug, storage)
    },

    updateQuantity(
      publicSlug: string,
      lineId: string,
      quantity: number,
      storage?: CartStorage,
    ) {
      const cart = this.carts[publicSlug]
      const item = cart?.items.find(line => line.id === lineId)
      if (!item) {
        return
      }

      item.quantity = z.number().int().min(1).max(99).parse(quantity)
      this.persist(publicSlug, storage)
    },

    removeItem(publicSlug: string, lineId: string, storage?: CartStorage) {
      const cart = this.carts[publicSlug]
      if (!cart) {
        return
      }

      cart.items = cart.items.filter(item => item.id !== lineId)
      this.persist(publicSlug, storage)
    },

    clear(publicSlug: string, storage?: CartStorage) {
      const cart = this.carts[publicSlug]
      if (cart) {
        cart.items = []
      }
      this.persist(publicSlug, storage)
    },

    persist(publicSlug: string, storage?: CartStorage) {
      const target = storage ?? defaultStorage()
      const cart = this.carts[publicSlug]
      if (!target || !cart) {
        return
      }

      const key = cartStorageKey(publicSlug)
      if (cart.items.length === 0) {
        target.removeItem(key)
        return
      }

      target.setItem(key, JSON.stringify(cartDocumentSchema.parse(cart)))
    },
  },
})
