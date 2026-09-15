import { z } from 'zod'

export const storeIdSchema = z.uuid()
export const orderNumberSchema = z.string().regex(/^[A-Z][A-Z0-9-]{3,31}$/)
export const orderStatusSchema = z.enum([
  'pending', 'confirmed', 'preparing', 'ready', 'delivering', 'completed', 'cancelled',
])
export const orderListQuerySchema = z.object({
  status: orderStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})
export const transitionOrderSchema = z.object({
  status: orderStatusSchema,
  note: z.string().max(500).nullable().optional(),
}).strict()
