import { z } from 'zod'
import { RESOLUTIONS } from '../payments'

const note = z.string().trim().min(3, 'Cần ghi chú (ít nhất 3 ký tự)').max(300, 'Ghi chú tối đa 300 ký tự')

export const reviewListQuerySchema = z.object({
  status: z.enum(['REVIEW_REQUIRED', 'RESOLVED']).default('REVIEW_REQUIRED'),
})

export const assignInputSchema = z.object({
  orderId: z.uuid(),
  acceptAmountDifference: z.boolean().default(false),
})

export const resolveInputSchema = z.object({
  resolution: z.enum(RESOLUTIONS),
  note: z.string().trim().max(300, 'Ghi chú tối đa 300 ký tự').optional(),
}).refine(value => value.resolution !== 'OTHER' || (value.note?.length ?? 0) >= 3, {
  path: ['note'],
  message: 'Cần ghi chú khi chọn "Khác"',
})

export const noteInputSchema = z.object({ note })

export const bankManualInputSchema = z.object({
  method: z.literal('BANK_MANUAL'),
  expectedPaymentStatus: z.enum(['PENDING', 'REVIEW_REQUIRED']),
  note,
})

export const refundInputSchema = z.object({ note, expectedHeldVnd: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) })
