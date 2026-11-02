import { describe, expect, it } from 'vitest'
import { describeEvent, formatDateTime, orderActionToast, paymentTone } from '../../../app/utils/order-view'

const event = (over: Partial<Parameters<typeof describeEvent>[0]>) => ({
  id: 'e', eventType: 'STATUS_CHANGED', fromState: null, toState: null, actorName: null, metadata: null, createdAt: '2026-10-31T08:20:00Z', ...over,
})

describe('orderActionToast', () => {
  it('turns STATUS_CONFLICT into a friendly warning', () => {
    expect(orderActionToast({ data: { code: 'STATUS_CONFLICT', message: 'x' } })).toMatchObject({ color: 'warning', title: 'Đơn vừa được người khác cập nhật' })
  })

  it('maps FORBIDDEN and passes other messages through', () => {
    expect(orderActionToast({ data: { code: 'FORBIDDEN', message: 'x' } })).toMatchObject({ color: 'error', title: 'Bạn không có quyền thực hiện thao tác này' })
    expect(orderActionToast({ data: { code: 'VALIDATION_FAILED', message: 'Nhập lý do hủy' } })).toMatchObject({ color: 'error', title: 'Nhập lý do hủy' })
    expect(orderActionToast(new TypeError('Failed to fetch'))).toMatchObject({ color: 'error', title: 'Không kết nối được máy chủ, vui lòng thử lại' })
  })
})

describe('paymentTone', () => {
  it.each([
    ['PAID', 'success'], ['UNPAID', 'warning'], ['PENDING', 'info'], ['REVIEW_REQUIRED', 'error'], ['REFUND_DUE', 'error'], ['REFUNDED', 'neutral'],
  ] as const)('%s → %s', (status, tone) => {
    expect(paymentTone(status)).toBe(tone)
  })
})

describe('describeEvent', () => {
  it('describes each event type', () => {
    expect(describeEvent(event({ toState: 'PREPARING' }))).toBe('Đang làm')
    expect(describeEvent(event({ eventType: 'CANCELLED', metadata: { reason: 'Hết nguyên liệu' } }))).toBe('Đã hủy — Hết nguyên liệu')
    expect(describeEvent(event({ eventType: 'PAYMENT_RECORDED' }))).toBe('Đã thu tiền mặt')
    expect(describeEvent(event({ eventType: 'CREATED' }))).toBe('Khách đặt đơn')
  })
})

describe('formatDateTime', () => {
  it('renders Vietnam time', () => {
    const text = formatDateTime('2026-10-31T08:20:00Z')
    expect(text).toContain('15:20')
    expect(text).toContain('31/10')
  })
})
