import { renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import type { ReviewItem } from '#shared/types/reconciliation'
import AppReconciliationReviewCard from '~/components/app/ReconciliationReviewCard.vue'

const order = (over: Record<string, unknown> = {}) => ({
  id: 'order-1', storeId: 's1', publicCode: 'AB12CD', status: 'AWAITING_PAYMENT', paymentStatus: 'PENDING', totalVnd: 70_000, ...over,
})

function item(over: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: 'tx-1',
    status: 'REVIEW_REQUIRED',
    reason: 'NO_CODE',
    amountVnd: 70_000,
    accountLast4: '1234',
    content: 'ck tra sua',
    referenceCode: 'FT1',
    source: 'WEBHOOK',
    transactionDate: '2026-11-01T11:30:00.000Z',
    receivedAt: '2026-11-01T11:30:05.000Z',
    resolution: null,
    matchedOrder: null,
    suggestedOrders: [order()],
    ...over,
  }
}

function render(props: { item: ReviewItem, busy?: boolean }) {
  const onAssign = vi.fn()
  const onResolve = vi.fn()
  return { onAssign, onResolve, done: renderSuspended(AppReconciliationReviewCard, { props: { onAssign, onResolve, ...props } }) }
}

describe('AppReconciliationReviewCard', () => {
  it('shows amount, reason, transfer content and masked account', async () => {
    await render({ item: item() }).done
    expect(screen.getByText('70.000đ')).toBeTruthy()
    expect(screen.getByText('Không thấy mã thanh toán trong nội dung chuyển khoản')).toBeTruthy()
    expect(screen.getByText('ck tra sua')).toBeTruthy()
    expect(screen.getByText(/1234/)).toBeTruthy()
  })

  it('assigns to the exact-amount order with a single tap', async () => {
    const { onAssign, done } = render({ item: item() })
    await done
    await fireEvent.click(screen.getByRole('button', { name: 'Gán vào đơn #AB12CD' }))
    expect(onAssign).toHaveBeenCalledTimes(1)
    expect(onAssign).toHaveBeenCalledWith('order-1', false)
  })

  it('needs a second tap to accept an amount difference, and says how much', async () => {
    const { onAssign, done } = render({ item: item({ amountVnd: 60_000, reason: 'AMOUNT_UNDER', matchedOrder: order({ totalVnd: 70_000 }), suggestedOrders: [order({ totalVnd: 70_000 })] }) })
    await done
    await fireEvent.click(screen.getByRole('button', { name: /Gán vào đơn #AB12CD/ }))
    expect(onAssign).not.toHaveBeenCalled()
    const confirm = screen.getByRole('button', { name: /Xác nhận nhận thiếu 10\.000đ/ })
    await fireEvent.click(confirm)
    expect(onAssign).toHaveBeenCalledWith('order-1', true)
  })

  it('offers no assign button when no order matches, but still lets the owner resolve', async () => {
    const { onResolve, done } = render({ item: item({ suggestedOrders: [] }) })
    await done
    expect(screen.queryByRole('button', { name: /Gán vào đơn/ })).toBeNull()
    expect(screen.getByText(/Chưa thấy đơn nào khớp/)).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Hoàn/bỏ qua' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Đã hoàn tiền cho khách' }))
    expect(onResolve).toHaveBeenCalledWith('REFUNDED_OUTSIDE', undefined)
  })

  it('"Khác" asks for a note of at least 3 characters before resolving', async () => {
    const { onResolve, done } = render({ item: item({ suggestedOrders: [] }) })
    await done
    await fireEvent.click(screen.getByRole('button', { name: 'Hoàn/bỏ qua' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Khác' }))
    const confirm = screen.getByRole('button', { name: 'Xác nhận' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    await fireEvent.update(screen.getByLabelText('Ghi chú'), 'Khách chuyển nhầm')
    expect(confirm.disabled).toBe(false)
    await fireEvent.click(confirm)
    expect(onResolve).toHaveBeenCalledWith('OTHER', 'Khách chuyển nhầm')
  })

  it('disables every action while busy', async () => {
    await render({ item: item(), busy: true }).done
    expect((screen.getByRole('button', { name: /Gán vào đơn/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Hoàn/bỏ qua' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows read-only history for resolved items (no actions)', async () => {
    await render({ item: item({ status: 'RESOLVED', resolution: 'DUPLICATE', suggestedOrders: [] }) }).done
    expect(screen.getByText('Giao dịch trùng')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Hoàn/bỏ qua' })).toBeNull()
  })
})
