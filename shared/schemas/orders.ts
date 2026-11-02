import { z } from 'zod'
import { ORDER_STATUSES, PAYMENT_STATUSES } from '../enums'
import { BOARD_TABS } from '../order-flow'

export const BOARD_PAGE_SIZE = 30

export const boardQuerySchema = z.object({
  tab: z.enum(BOARD_TABS),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(BOARD_PAGE_SIZE),
})
export type BoardQuery = z.output<typeof boardQuerySchema>

const orderStatus = z.enum(ORDER_STATUSES)

export const statusChangeSchema = z.object({
  expectedStatus: orderStatus,
  nextStatus: orderStatus,
}).refine(value => value.expectedStatus !== value.nextStatus, 'Trạng thái mới phải khác trạng thái hiện tại')
export type StatusChangeInput = z.output<typeof statusChangeSchema>

export const cancelOrderSchema = z.object({
  expectedStatus: orderStatus,
  reason: z.string().trim().min(2, 'Nhập lý do hủy').max(200, 'Lý do tối đa 200 ký tự'),
})
export type CancelOrderInput = z.output<typeof cancelOrderSchema>

export const markPaidSchema = z.object({
  expectedPaymentStatus: z.enum(PAYMENT_STATUSES),
  method: z.literal('CASH'),
  note: z.string().trim().max(200, 'Ghi chú tối đa 200 ký tự').optional(),
})
export type MarkPaidInput = z.output<typeof markPaidSchema>
