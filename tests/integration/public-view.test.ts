import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { checkoutInputSchema, type CheckoutBody } from '#shared/schemas/checkout'
import { closeDb, getDb } from '../../server/db/client'
import { orders } from '../../server/db/schema'
import { createOrder } from '../../server/services/ordering/create-order'
import { getPublicOrderView } from '../../server/services/ordering/public-view'
import { AppError } from '../../server/utils/errors'
import { deliveryBody, dineInBody, openStore, pickupBody, seedMenu, teaItem, type SeededMenu } from '../support/checkout-fixtures'
import { resetDb } from '../support/db'
import { createTenant } from '../support/fixtures'
import { findForbiddenKeys } from '../support/json'

let tenant: Awaited<ReturnType<typeof createTenant>>
let menu: SeededMenu

const place = (body: CheckoutBody) =>
  createOrder(getDb(), { slug: tenant.store.slug, input: checkoutInputSchema.parse(body), ip: '203.0.113.7' })

beforeEach(async () => {
  await resetDb()
  tenant = await createTenant('a')
  await openStore(tenant.store.id, { deliveryEnabled: true })
  menu = await seedMenu(tenant.store)
})

afterAll(async () => {
  await closeDb()
})

describe('getPublicOrderView', () => {
  it('returns the customer-facing view of a delivery order without internal ids or PII', async () => {
    const { response } = await place(deliveryBody(menu))
    const view = await getPublicOrderView(getDb(), response.guestToken)

    expect(view).toEqual({
      publicCode: response.publicCode,
      status: 'NEW',
      paymentStatus: 'UNPAID',
      paymentMethod: 'PAY_ON_RECEIPT',
      fulfillmentType: 'DELIVERY',
      tableLabel: null,
      deliveryZoneName: 'Quận 1',
      customerName: 'Lan',
      phoneMasked: '*******678',
      items: [{
        name: 'Trà sữa trân châu',
        quantity: 2,
        unitPriceVnd: 35_000,
        lineTotalVnd: 70_000,
        options: [{ name: 'M', priceDeltaVnd: 0 }],
        note: null,
      }],
      subtotalVnd: 70_000,
      deliveryFeeVnd: 15_000,
      totalVnd: 85_000,
      createdAt: expect.any(String),
      store: { name: tenant.store.name, slug: tenant.store.slug },
      qr: null,
    })

    expect(findForbiddenKeys(view)).toEqual([])
    const raw = JSON.stringify(view)
    for (const secret of ['0912345678', '12 Lê Lợi', tenant.org.id, tenant.store.id]) expect(raw).not.toContain(secret)
  })

  it('shows the table label for dine-in and keeps item notes verbatim', async () => {
    const { response } = await place(dineInBody(menu, { items: [teaItem(menu, { note: '<b>ít đá</b>' })] }))
    const view = await getPublicOrderView(getDb(), response.guestToken)
    expect(view).toMatchObject({ fulfillmentType: 'DINE_IN', tableLabel: 'Bàn 05', deliveryZoneName: null, customerName: null, phoneMasked: null })
    expect(view.items[0]!.note).toBe('<b>ít đá</b>')
  })

  it('follows status changes made by staff', async () => {
    const { response } = await place(pickupBody(menu))
    await getDb().update(orders).set({ status: 'PREPARING' }).where(eq(orders.publicCode, response.publicCode))
    expect((await getPublicOrderView(getDb(), response.guestToken)).status).toBe('PREPARING')
  })

  it('answers every kind of bad token with the same NOT_FOUND', async () => {
    const { response } = await place(pickupBody(menu))
    const [row] = await getDb().select().from(orders)
    const bad = ['', 'short', 'x'.repeat(43), 'a b c', '../../etc/passwd', response.guestToken.toUpperCase(), `${response.guestToken}x`, row!.guestTokenHash]
    for (const token of bad) {
      const error = await getPublicOrderView(getDb(), token).then(() => null, (e: unknown) => e)
      expect(error).toBeInstanceOf(AppError)
      expect(error).toMatchObject({ code: 'NOT_FOUND', message: 'Không tìm thấy đơn hàng' })
    }
  })
})
