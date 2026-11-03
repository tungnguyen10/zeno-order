import { renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import type { PaymentAccountCheck, PaymentAccountDto } from '#shared/types/payment'
import PaymentAccountCard from '~/components/settings/PaymentAccountCard.vue'

const account = (over: Partial<PaymentAccountDto> = {}): PaymentAccountDto => ({
  id: 'acc-1', bankCode: 'VCB', bankName: 'Vietcombank', accountNumber: '9988776655', vaNumber: null,
  accountHolder: 'NGUYEN VAN A', qrCheckedAt: null, verifiedAt: null, linkedIntegrationId: null, ...over,
})
const okCheck: PaymentAccountCheck = {
  ok: true, revision: 'revision-1', issues: [], warnings: [],
  preview: {
    bankName: 'Vietcombank', accountNumber: '9988776655', accountHolder: 'NGUYEN VAN A', amountVnd: 2000,
    transferContent: 'ZOTEST0000', imageUrl: 'https://vietqr.app/img?acc=9988776655&bank=970436&amount=2000&des=ZOTEST0000&template=qronly',
  },
}
const base = { account: null as PaymentAccountDto | null, check: null as PaymentAccountCheck | null, busy: null, fieldErrors: {} }

describe('PaymentAccountCard', () => {
  it('emits the draft when the owner presses "Kiểm tra"', async () => {
    const { emitted } = await renderSuspended(PaymentAccountCard, { props: { ...base, account: account() } })
    await fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra' }))
    expect(emitted().check).toEqual([[{ bankCode: 'VCB', accountNumber: '9988776655', accountHolder: 'NGUYEN VAN A', vaNumber: null }]])
  })

  it('keeps "Kiểm tra" disabled until bank, number and name are filled', async () => {
    await renderSuspended(PaymentAccountCard, { props: base })
    expect((screen.getByRole('button', { name: 'Kiểm tra' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('asks for a VA number only for banks that require one', async () => {
    const view = await renderSuspended(PaymentAccountCard, { props: { ...base, account: account({ bankCode: 'MSB', bankName: 'MSB' }) } })
    expect(screen.getByLabelText('Số tài khoản ảo (VA)')).toBeTruthy()
    expect(screen.getByText(/chỉ nhận tiền qua tài khoản ảo/i)).toBeTruthy()
    view.unmount()
    await renderSuspended(PaymentAccountCard, { props: { ...base, account: account() } })
    expect(screen.queryByLabelText('Số tài khoản ảo (VA)')).toBeNull()
  })

  it('shows the check QR with the holder to look for, and confirms on one tap', async () => {
    const { emitted } = await renderSuspended(PaymentAccountCard, { props: { ...base, account: account(), check: okCheck } })
    const qr = screen.getByAltText('Mã QR kiểm tra 2.000đ') as HTMLImageElement
    expect(qr.getAttribute('src')).toBe(okCheck.preview!.imageUrl)
    expect(qr.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(screen.getByTestId('payment-preview').textContent).toContain('NGUYEN VAN A')
    await fireEvent.click(screen.getByRole('button', { name: 'Đúng tên, xác nhận' }))
    expect(emitted().confirm).toHaveLength(1)
  })

  it('shows a success state, not the confirm button, once the QR check is recorded', async () => {
    await renderSuspended(PaymentAccountCard, { props: { ...base, account: account({ qrCheckedAt: '2026-11-01T05:00:00.000Z' }) } })
    expect(screen.getByText('Đã kiểm tra tài khoản')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Đúng tên, xác nhận' })).toBeNull()
  })

  it('lists issues and warnings from the check', async () => {
    const check: PaymentAccountCheck = {
      ok: false, revision: null, preview: null, warnings: [],
      issues: [{ field: 'vaNumber', message: 'MSB chỉ nhận tiền qua tài khoản ảo (VA), hãy nhập số VA' }],
    }
    await renderSuspended(PaymentAccountCard, { props: { ...base, account: account({ bankCode: 'MSB', bankName: 'MSB' }), check } })
    expect(screen.getAllByRole('alert').some(el => el.textContent?.includes('hãy nhập số VA'))).toBe(true)
    expect(screen.queryByTestId('payment-preview')).toBeNull()
  })

  it('hides a checked preview when the draft changes', async () => {
    await renderSuspended(PaymentAccountCard, { props: { ...base, account: account(), check: okCheck } })
    await fireEvent.update(screen.getByLabelText('Số tài khoản'), '111111111')
    expect(screen.queryByRole('button', { name: 'Đúng tên, xác nhận' })).toBeNull()
  })

  it('surfaces server-side field errors', async () => {
    await renderSuspended(PaymentAccountCard, { props: { ...base, account: account(), fieldErrors: { accountNumber: 'Số tài khoản gồm 6–19 chữ hoặc số' } } })
    expect(screen.getByText('Số tài khoản gồm 6–19 chữ hoặc số')).toBeTruthy()
  })
})

it('keeps confirmation available through image failure and resets loading on retry or URL change', async () => {
  const view = await renderSuspended(PaymentAccountCard, { props: { ...base, account: account(), check: okCheck } })
  const original = screen.getByAltText('Mã QR kiểm tra 2.000đ')
  expect(screen.getByText('Đang tải mã QR…')).toBeTruthy()
  await fireEvent.load(original)
  expect(screen.queryByText('Đang tải mã QR…')).toBeNull()
  await fireEvent.error(original)
  expect(screen.getByText('Chưa tải được mã QR')).toBeTruthy()
  await fireEvent.click(screen.getByRole('button', { name: 'Đúng tên, xác nhận' }))
  expect(view.emitted().confirm).toHaveLength(1)
  await fireEvent.click(screen.getByRole('button', { name: 'Thử tải lại QR' }))
  const retried = screen.getByAltText('Mã QR kiểm tra 2.000đ')
  expect(retried).not.toBe(original)
  expect(retried.getAttribute('referrerpolicy')).toBe('no-referrer')
  expect(screen.getByText('Đang tải mã QR…')).toBeTruthy()
  await fireEvent.load(retried)
  await fireEvent.error(original)
  expect(screen.queryByText('Chưa tải được mã QR')).toBeNull()
  await fireEvent.error(retried)
  await view.rerender({ check: { ...okCheck, preview: { ...okCheck.preview!, imageUrl: `${okCheck.preview!.imageUrl}&retry=new` } } })
  expect(screen.getByText('Đang tải mã QR…')).toBeTruthy()
  expect(screen.queryByText('Chưa tải được mã QR')).toBeNull()
  const current = screen.getByAltText('Mã QR kiểm tra 2.000đ')
  await fireEvent.load(current)
  await fireEvent.error(retried)
  expect(screen.queryByText('Chưa tải được mã QR')).toBeNull()
  expect(screen.queryByText('Đang tải mã QR…')).toBeNull()
})
