import { z } from 'zod'

export const MAX_PRICE_VND = 100_000_000
export const NO_CHANGE = 'Không có thay đổi nào'

export const vndSchema = z
  .number('Giá phải là số')
  .int('Giá phải là số nguyên')
  .min(0, 'Giá không được âm')
  .max(MAX_PRICE_VND, 'Giá quá lớn')

export const nameField = (max: number) => z.string().trim().min(1, 'Không được để trống').max(max, `Tối đa ${max} ký tự`)

export const positionSchema = z.number().int().min(0).max(100_000)

export function hasChange(value: Record<string, unknown>): boolean {
  return Object.values(value).some(item => item !== undefined)
}
