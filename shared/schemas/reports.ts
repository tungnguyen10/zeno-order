import { z } from 'zod'
import { REPORT_RANGES, isValidDateString } from '../vn-date'

export const summaryQuerySchema = z.object({
  date: z.string().refine(isValidDateString, 'Ngày không hợp lệ, dùng YYYY-MM-DD').optional(),
})

export const reportQuerySchema = z.object({
  range: z.enum(REPORT_RANGES).default('today'),
})
