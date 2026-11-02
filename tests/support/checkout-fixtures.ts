import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getDb } from '../../server/db/client'
import { orders, stores } from '../../server/db/schema'
import type { CheckoutBody } from '../../shared/schemas/checkout'
import { createOptionGroup, createProduct, createTable, createZone } from './fixtures'

type StoreRef = { id: string, orgId: string }
type BodyItem = CheckoutBody['items'][number]

export const TEA_PRICE = 35_000
export const BREAD_PRICE = 20_000

export async function seedMenu(store: StoreRef) {
  const tea = await createProduct(store, { name: 'Trà sữa trân châu', basePriceVnd: TEA_PRICE, position: 0 })
  const size = await createOptionGroup(store, tea, {
    name: 'Size',
    required: true,
    values: [{ name: 'M' }, { name: 'L', priceDeltaVnd: 7_000 }],
  })
  const topping = await createOptionGroup(store, tea, {
    name: 'Topping',
    required: false,
    minSelect: 0,
    maxSelect: 2,
    position: 1,
    values: [{ name: 'Trân châu', priceDeltaVnd: 5_000 }, { name: 'Thạch', priceDeltaVnd: 5_000 }],
  })
  const bread = await createProduct(store, { name: 'Bánh mì que', basePriceVnd: BREAD_PRICE, position: 1 })
  const zone = await createZone(store, { name: 'Quận 1', feeVnd: 15_000 })
  const { table, token } = await createTable(store, '05')
  const value = (values: { id: string, name: string }[], name: string) => values.find(v => v.name === name)!

  return {
    tea: {
      id: tea.id,
      name: tea.name,
      basePriceVnd: TEA_PRICE,
      size: { groupId: size.group.id, m: value(size.values, 'M'), l: value(size.values, 'L') },
      topping: { groupId: topping.group.id, pearl: value(topping.values, 'Trân châu'), jelly: value(topping.values, 'Thạch') },
    },
    bread: { id: bread.id, name: bread.name, basePriceVnd: BREAD_PRICE },
    zone: { id: zone.id, name: zone.name, feeVnd: 15_000 },
    table: { id: table.id, token, displayName: table.displayName },
  }
}

export type SeededMenu = Awaited<ReturnType<typeof seedMenu>>

export async function openStore(storeId: string, patch: Partial<typeof stores.$inferInsert> = {}) {
  await getDb().update(stores).set({ isAcceptingOrders: true, ...patch }).where(eq(stores.id, storeId))
}

export const teaItem = (menu: SeededMenu, over: Partial<BodyItem> = {}): BodyItem => ({
  productId: menu.tea.id,
  quantity: 2,
  optionValueIds: [menu.tea.size.m.id],
  expectedUnitPriceVnd: TEA_PRICE,
  ...over,
})

export const breadItem = (menu: SeededMenu, over: Partial<BodyItem> = {}): BodyItem => ({
  productId: menu.bread.id,
  quantity: 1,
  optionValueIds: [],
  expectedUnitPriceVnd: BREAD_PRICE,
  ...over,
})

export function pickupBody(menu: SeededMenu, over: Partial<CheckoutBody> = {}): CheckoutBody {
  return {
    idempotencyKey: randomUUID(),
    fulfillmentType: 'PICKUP',
    customer: { name: 'Lan', phone: '0912345678' },
    items: [teaItem(menu)],
    expectedTotalVnd: 2 * TEA_PRICE,
    paymentMethod: 'PAY_ON_RECEIPT',
    ...over,
  }
}

export function dineInBody(menu: SeededMenu, over: Partial<CheckoutBody> = {}): CheckoutBody {
  return pickupBody(menu, { fulfillmentType: 'DINE_IN', tableToken: menu.table.token, customer: {}, ...over })
}

export function deliveryBody(menu: SeededMenu, over: Partial<CheckoutBody> = {}): CheckoutBody {
  return pickupBody(menu, {
    fulfillmentType: 'DELIVERY',
    deliveryZoneId: menu.zone.id,
    customer: { name: 'Lan', phone: '0912345678', address: '12 Lê Lợi, Quận 1' },
    expectedTotalVnd: 2 * TEA_PRICE + menu.zone.feeVnd,
    ...over,
  })
}

/** Raw insert that bypasses createOrder; defaults satisfy every constraint. */
export async function insertRawOrder(store: StoreRef, over: Partial<typeof orders.$inferInsert> = {}) {
  const [row] = await getDb().insert(orders).values({
    orgId: store.orgId,
    storeId: store.id,
    publicCode: randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase(),
    guestTokenHash: randomUUID(),
    guestTokenEncrypted: 'v1.x.y.z',
    fulfillmentType: 'PICKUP',
    customerName: 'Lan',
    customerPhone: '0912345678',
    subtotalVnd: 50_000,
    deliveryFeeVnd: 0,
    totalVnd: 50_000,
    status: 'NEW',
    paymentMethod: 'PAY_ON_RECEIPT',
    paymentStatus: 'UNPAID',
    idempotencyKey: randomUUID(),
    ...over,
  }).returning()
  return row!
}

/** localStorage payload (`zeno:cart:<slug>`) for e2e: two Size-M teas, nothing else filled in. */
export function seedCartJson(menu: SeededMenu, quantity = 2): string {
  return JSON.stringify({
    version: 1,
    lines: [{
      lineId: randomUUID(),
      productId: menu.tea.id,
      name: menu.tea.name,
      optionValueIds: [menu.tea.size.m.id],
      optionLabels: ['M'],
      unitPriceVnd: TEA_PRICE,
      quantity,
      note: '',
      stale: null,
      currentUnitPriceVnd: null,
    }],
    pendingIdempotencyKey: null,
    pendingFingerprint: null,
    fulfillmentType: null,
    customer: { name: '', phone: '', address: '' },
    deliveryZoneId: null,
    note: '',
  })
}
