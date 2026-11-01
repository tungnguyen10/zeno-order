import { z } from 'zod'
import { hasChange, nameField, NO_CHANGE } from './common'

export const createTableInputSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Không được để trống')
    .max(20, 'Tối đa 20 ký tự')
    .regex(/^[A-Za-z0-9-]+$/, 'Mã bàn chỉ gồm chữ không dấu, số và dấu gạch ngang')
    .optional(),
  displayName: nameField(40).optional(),
})
export type CreateTableInput = z.output<typeof createTableInputSchema>

export const updateTableInputSchema = z
  .object({ displayName: nameField(40).optional(), active: z.boolean().optional() })
  .refine(hasChange, NO_CHANGE)
export type UpdateTableInput = z.output<typeof updateTableInputSchema>
