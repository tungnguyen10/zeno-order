import { z } from 'zod'
import { FULFILLMENT_TYPES, PAYMENT_METHODS, type FulfillmentType, type PaymentMethod } from '../enums'
import { normalizeVnPhone } from '../phone'

export const CHECKOUT_LIMITS = { maxLines: 30, maxQuantity: 50, maxNote: 200, maxName: 80, maxAddress: 300 } as const

const text = (max: number) => z.string().trim().max(max, `Tối đa ${max} ký tự`).optional()
// zod 4: .int() already rejects values outside the safe-integer range.
const vnd = z.number().int().nonnegative()

const itemSchema = z.object({
  productId: z.uuid(),
  quantity: z.number().int().min(1, 'Số lượng tối thiểu là 1').max(CHECKOUT_LIMITS.maxQuantity, `Tối đa ${CHECKOUT_LIMITS.maxQuantity} phần mỗi món`),
  optionValueIds: z.array(z.uuid()).max(30).default([]),
  note: text(CHECKOUT_LIMITS.maxNote),
  expectedUnitPriceVnd: vnd,
})

const baseSchema = z.object({
  idempotencyKey: z.uuid(),
  fulfillmentType: z.enum(FULFILLMENT_TYPES),
  tableToken: z.string().trim().min(1).max(64).nullish(),
  customer: z.object({
    name: text(CHECKOUT_LIMITS.maxName),
    phone: z.string().trim().max(24, 'Số điện thoại không hợp lệ').optional(),
    address: text(CHECKOUT_LIMITS.maxAddress),
  }).default({}),
  deliveryZoneId: z.uuid().nullish(),
  items: z.array(itemSchema).min(1, 'Giỏ hàng trống').max(CHECKOUT_LIMITS.maxLines, `Tối đa ${CHECKOUT_LIMITS.maxLines} dòng mỗi đơn`),
  paymentMethod: z.enum(PAYMENT_METHODS),
  expectedTotalVnd: vnd,
  note: text(CHECKOUT_LIMITS.maxNote),
})

export interface CheckoutInput {
  idempotencyKey: string
  fulfillmentType: FulfillmentType
  tableToken: string | null
  customer: { name: string | null, phone: string | null, address: string | null }
  deliveryZoneId: string | null
  items: { productId: string, quantity: number, optionValueIds: string[], note: string | null, expectedUnitPriceVnd: number }[]
  expectedTotalVnd: number
  paymentMethod: PaymentMethod
  note: string | null
}

export const checkoutInputSchema = baseSchema
  .superRefine((value, ctx) => {
    const name = value.customer.name ?? ''
    const phoneRaw = value.customer.phone ?? ''
    const problem = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message })

    if (phoneRaw && !normalizeVnPhone(phoneRaw)) problem(['customer', 'phone'], 'Số điện thoại không hợp lệ')

    if (value.fulfillmentType === 'DINE_IN' && !value.tableToken) problem(['tableToken'], 'Thiếu mã bàn, vui lòng quét lại QR')
    if (value.fulfillmentType !== 'DINE_IN') {
      if (!name) problem(['customer', 'name'], 'Vui lòng nhập tên')
      if (!phoneRaw) problem(['customer', 'phone'], 'Vui lòng nhập số điện thoại')
    }
    if (value.fulfillmentType === 'DELIVERY') {
      if (!value.deliveryZoneId) problem(['deliveryZoneId'], 'Vui lòng chọn khu vực giao')
      if (!value.customer.address) problem(['customer', 'address'], 'Vui lòng nhập địa chỉ giao hàng')
    }
  })
  .transform((value): CheckoutInput => ({
    idempotencyKey: value.idempotencyKey,
    fulfillmentType: value.fulfillmentType,
    tableToken: value.fulfillmentType === 'DINE_IN' ? (value.tableToken ?? null) : null,
    customer: {
      name: value.customer.name || null,
      phone: value.customer.phone ? normalizeVnPhone(value.customer.phone) : null,
      address: value.fulfillmentType === 'DELIVERY' ? (value.customer.address || null) : null,
    },
    deliveryZoneId: value.fulfillmentType === 'DELIVERY' ? (value.deliveryZoneId ?? null) : null,
    items: value.items.map(item => ({
      productId: item.productId,
      quantity: item.quantity,
      optionValueIds: item.optionValueIds,
      note: item.note || null,
      expectedUnitPriceVnd: item.expectedUnitPriceVnd,
    })),
    expectedTotalVnd: value.expectedTotalVnd,
    paymentMethod: value.paymentMethod,
    note: value.note || null,
  }))

export type CheckoutBody = z.input<typeof checkoutInputSchema>
