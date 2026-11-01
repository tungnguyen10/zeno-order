import { z } from 'zod'
import { hasChange, nameField, NO_CHANGE, positionSchema, vndSchema } from './common'

export const createCategoryInputSchema = z.object({ name: nameField(60) })
export type CreateCategoryInput = z.output<typeof createCategoryInputSchema>

export const updateCategoryInputSchema = z
  .object({ name: nameField(60).optional(), position: positionSchema.optional(), active: z.boolean().optional() })
  .refine(hasChange, NO_CHANGE)
export type UpdateCategoryInput = z.output<typeof updateCategoryInputSchema>

const descriptionSchema = z.string().trim().max(300, 'Tối đa 300 ký tự')

export const createProductInputSchema = z.object({
  name: nameField(80),
  basePriceVnd: vndSchema,
  categoryId: z.uuid().nullable().optional(),
  description: descriptionSchema.optional(),
})
export type CreateProductInput = z.output<typeof createProductInputSchema>

export const updateProductInputSchema = z
  .object({
    name: nameField(80).optional(),
    basePriceVnd: vndSchema.optional(),
    categoryId: z.uuid().nullable().optional(),
    description: descriptionSchema.nullable().optional(),
    isAvailable: z.boolean().optional(),
    active: z.boolean().optional(),
    position: positionSchema.optional(),
  })
  .refine(hasChange, NO_CHANGE)
export type UpdateProductInput = z.output<typeof updateProductInputSchema>

const optionValueSchema = z.object({
  name: nameField(60),
  priceDeltaVnd: vndSchema.default(0),
  active: z.boolean().default(true),
})

const optionGroupSchema = z
  .object({
    name: nameField(60),
    required: z.boolean(),
    minSelect: z.number().int().min(0).max(30),
    maxSelect: z.number().int().min(1).max(30),
    values: z.array(optionValueSchema).min(1, 'Nhóm cần ít nhất 1 lựa chọn').max(30),
  })
  .superRefine((group, ctx) => {
    const minSelect = group.required ? Math.max(group.minSelect, 1) : group.minSelect
    const activeCount = group.values.filter(value => value.active).length
    if (group.maxSelect < minSelect) {
      ctx.addIssue({ code: 'custom', path: ['maxSelect'], message: 'Số lựa chọn tối đa phải lớn hơn hoặc bằng số tối thiểu' })
    }
    if (minSelect > activeCount) {
      ctx.addIssue({ code: 'custom', path: ['minSelect'], message: 'Số lựa chọn tối thiểu vượt quá số lựa chọn đang bật' })
    }
  })
  .transform(group => ({ ...group, minSelect: group.required ? Math.max(group.minSelect, 1) : group.minSelect }))

export const replaceOptionsInputSchema = z.object({ groups: z.array(optionGroupSchema).max(10, 'Tối đa 10 nhóm') })
export type ReplaceOptionsInput = z.output<typeof replaceOptionsInputSchema>
