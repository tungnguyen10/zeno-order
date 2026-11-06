import { renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import AppReconciliationOrderCard from '~/components/app/ReconciliationOrderCard.vue'

const order = { id: 'o1', publicCode: 'ZZ99XY', totalVnd: 55_000, heldVnd: 55_000 }

function render(props: { kind: 'refund' | 'overdue', order?: typeof order | Omit<typeof order, 'heldVnd'> & { heldVnd?: number }, busy?: boolean }) {
  const onConfirm = vi.fn()
  return { onConfirm, done: renderSuspended(AppReconciliationOrderCard, { props: { order, onConfirm, ...props } }) }
}

describe('AppReconciliationOrderCard', () => {
  it('refund: shows the amount to return and confirms with a prefilled editable note', async () => {
    const { onConfirm, done } = render({ kind: 'refund' })
    await done
    expect(screen.getByText('#ZZ99XY')).toBeTruthy()
    expect(screen.getByText(/Cần hoàn 55\.000đ/)).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Đã hoàn tiền' }))
    expect((screen.getByLabelText('Ghi chú') as HTMLInputElement).value).toBe('Đã hoàn tiền qua chuyển khoản')
    await fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }))
    expect(onConfirm).toHaveBeenCalledWith('Đã hoàn tiền qua chuyển khoản')
  })

  it('overdue: manual bank confirmation needs a note and cannot be confirmed empty', async () => {
    const { onConfirm, done } = render({ kind: 'overdue', order: { ...order, heldVnd: undefined } })
    await done
    await fireEvent.click(screen.getByRole('button', { name: 'Đã nhận tiền thủ công' }))
    await fireEvent.update(screen.getByLabelText('Ghi chú'), ' ')
    expect((screen.getByRole('button', { name: 'Xác nhận' }) as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.update(screen.getByLabelText('Ghi chú'), 'Thấy tiền trong app VCB')
    await fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }))
    expect(onConfirm).toHaveBeenCalledWith('Thấy tiền trong app VCB')
  })

  it('can be cancelled without emitting', async () => {
    const { onConfirm, done } = render({ kind: 'refund' })
    await done
    await fireEvent.click(screen.getByRole('button', { name: 'Đã hoàn tiền' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Hủy' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Ghi chú')).toBeNull()
  })
})
