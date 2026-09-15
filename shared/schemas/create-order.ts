import { z } from 'zod'

import { publicSlugSchema } from './public-slug'

const databaseUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
)
const trimmedRequired = (max: number) => z.string().transform(value => value.trim())
  .pipe(z.string().min(1).max(max))
const normalizedNote = z.string().max(500).transform(value => value.trim() || null)
  .optional().transform(value => value ?? null)

const createOrderItemSchema = z.object({
  productId: databaseUuidSchema,
  quantity: z.number().int().min(1).max(99),
  optionValueIds: z.array(databaseUuidSchema).max(50).refine(
    values => new Set(values).size === values.length,
    'Option values must be unique',
  ).transform(values => [...values].sort()),
  note: normalizedNote,
}).strict()

const deliverySchema = z.object({
  address: trimmedRequired(500),
  note: normalizedNote,
}).strict()

export const createOrderRequestSchema = z.object({
  publicSlug: publicSlugSchema,
  fulfillmentType: z.enum(['delivery', 'pickup']),
  customer: z.object({
    name: trimmedRequired(120),
    phone: z.string().transform(value => value.trim()).pipe(z.string().min(5).max(32)),
  }).strict(),
  delivery: deliverySchema.nullable(),
  customerNote: normalizedNote,
  paymentMethod: z.enum(['cash', 'bank_transfer']),
  items: z.array(createOrderItemSchema).min(1).max(50),
  idempotencyKey: z.uuidv4(),
  turnstileToken: z.string().min(1).max(2_048),
}).strict().superRefine((value, context) => {
  if (value.fulfillmentType === 'delivery' && value.delivery === null) {
    context.addIssue({
      code: 'custom',
      path: ['delivery'],
      message: 'Delivery details are required',
    })
  }
  if (value.fulfillmentType === 'pickup' && value.delivery !== null) {
    context.addIssue({
      code: 'custom',
      path: ['delivery'],
      message: 'Pickup cannot include delivery details',
    })
  }
})

export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>

export function orderRequestHashInput(request: CreateOrderRequest) {
  return {
    publicSlug: request.publicSlug,
    fulfillmentType: request.fulfillmentType,
    customer: request.customer,
    delivery: request.delivery,
    customerNote: request.customerNote,
    paymentMethod: request.paymentMethod,
    items: request.items,
  }
}
