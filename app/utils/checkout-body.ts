import { assertVnd } from '#shared/money'
import type { FulfillmentType, PaymentMethod } from '#shared/enums'
import type { CheckoutBody } from '#shared/schemas/checkout'
import type { CartLine } from './cart-storage'

export interface CheckoutForm {
  customer: { name: string, phone: string, address: string }
  deliveryZoneId: string | null
  note: string
}

export type CheckoutPayload = Omit<CheckoutBody, 'idempotencyKey'>

export function buildCheckoutPayload(args: {
  lines: CartLine[]
  form: CheckoutForm
  fulfillmentType: FulfillmentType
  tableToken: string | null
  paymentMethod: PaymentMethod
  deliveryFeeVnd: number
}): CheckoutPayload {
  const { lines, form, fulfillmentType } = args
  const isDelivery = fulfillmentType === 'DELIVERY'
  const subtotal = lines.reduce((sum, line) => assertVnd(sum + assertVnd(line.unitPriceVnd * line.quantity)), 0)

  const customer: NonNullable<CheckoutBody['customer']> = {}
  const name = form.customer.name.trim()
  const phone = form.customer.phone.trim()
  const address = form.customer.address.trim()
  if (name) customer.name = name
  if (phone) customer.phone = phone
  if (isDelivery && address) customer.address = address

  const note = form.note.trim()
  return {
    fulfillmentType,
    ...(fulfillmentType === 'DINE_IN' && args.tableToken ? { tableToken: args.tableToken } : {}),
    customer,
    ...(isDelivery && form.deliveryZoneId ? { deliveryZoneId: form.deliveryZoneId } : {}),
    items: lines.map((line) => {
      const lineNote = line.note.trim()
      return {
        productId: line.productId,
        quantity: line.quantity,
        optionValueIds: [...line.optionValueIds],
        ...(lineNote ? { note: lineNote } : {}),
        expectedUnitPriceVnd: line.unitPriceVnd,
      }
    }),
    paymentMethod: args.paymentMethod,
    expectedTotalVnd: assertVnd(subtotal + (isDelivery ? assertVnd(args.deliveryFeeVnd) : 0)),
    ...(note ? { note } : {}),
  }
}

/** Same string for the same intent; any edit to the cart or form changes it, which forces a fresh idempotency key. */
export function checkoutFingerprint(payload: CheckoutPayload): string {
  return JSON.stringify(payload)
}
