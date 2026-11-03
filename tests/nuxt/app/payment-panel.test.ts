import { renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PaymentQr } from '#shared/types/order'
import { nextTick } from 'vue'
import PaymentPanel from '~/components/order/PaymentPanel.vue'

const qr = (over: Partial<PaymentQr> = {}): PaymentQr => ({
  bankName: 'Vietcombank',
  accountNumber: '9988776655',
  accountHolder: 'NGUYEN VAN A',
  amountVnd: 70_000,
  transferContent: 'ZOABCD1234',
  imageUrl: 'https://vietqr.app/img?acc=9988776655&bank=970436&amount=70000&des=ZOABCD1234&template=qronly',
  expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  ...over,
})
const props = (over: Record<string, unknown> = {}) => ({ qr: qr(), totalVnd: 70_000, publicCode: 'K7M2PQ', repaying: false, ...over })

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true, writable: true })
})

describe('PaymentPanel (QR still valid)', () => {
  it('shows the QR with the exact image url, size, alt and no-referrer policy', async () => {
    await renderSuspended(PaymentPanel, { props: props() })
    const img = screen.getByAltText('Mã QR chuyển khoản') as HTMLImageElement
    expect(img.getAttribute('src')).toBe(qr().imageUrl)
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(img.getAttribute('width')).toBe('240')
    expect(img.getAttribute('height')).toBe('240')
  })

  it('shows order code, amount, bank details and a running countdown', async () => {
    await renderSuspended(PaymentPanel, { props: props() })
    expect(screen.getByRole('heading', { name: /Chuyển khoản để hoàn tất đơn #K7M2PQ/ })).toBeTruthy()
    expect(screen.getAllByText('70.000đ').length).toBeGreaterThan(0)
    expect(screen.getByTestId('payment-account').textContent).toBe('9988776655')
    expect(screen.getByTestId('payment-content').textContent).toBe('ZOABCD1234')
    expect(screen.getByTestId('payment-countdown').textContent).toMatch(/Còn \d{2}:\d{2} để thanh toán/)
    expect(screen.getByText(/NGUYEN VAN A/)).toBeTruthy()
  })

  it('copies the transfer content and the raw amount', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true })
    await renderSuspended(PaymentPanel, { props: props() })
    await fireEvent.click(screen.getByRole('button', { name: 'Sao chép nội dung chuyển khoản' }))
    expect(writeText).toHaveBeenLastCalledWith('ZOABCD1234')
    await fireEvent.click(screen.getByRole('button', { name: 'Sao chép số tiền' }))
    expect(writeText).toHaveBeenLastCalledWith('70000')
    await fireEvent.click(screen.getByRole('button', { name: 'Sao chép số tài khoản' }))
    expect(writeText).toHaveBeenLastCalledWith('9988776655')
  })

  it('falls back to a hint when the Clipboard API is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true, writable: true })
    await renderSuspended(PaymentPanel, { props: props() })
    await fireEvent.click(screen.getByRole('button', { name: 'Sao chép nội dung chuyển khoản' }))
    expect((await screen.findAllByText('Nhấn giữ để sao chép')).length).toBeGreaterThan(0)
  })

  it('offers to save the QR image through the download parameter (no CORS fetch)', async () => {
    await renderSuspended(PaymentPanel, { props: props() })
    const link = screen.getByRole('link', { name: /Lưu ảnh QR/ })
    expect(link.getAttribute('href')).toBe(`${qr().imageUrl}&download=true`)
  })

  it('tells the customer to type the exact content', async () => {
    await renderSuspended(PaymentPanel, { props: props() })
    expect(screen.getByText('Nhập đúng nội dung chuyển khoản')).toBeTruthy()
  })

  it('does not show the expired state or ask to repay', async () => {
    await renderSuspended(PaymentPanel, { props: props() })
    expect(screen.queryByRole('button', { name: 'Tạo mã mới' })).toBeNull()
  })
})

describe('PaymentPanel (expired or no live QR)', () => {
  it('shows the expired state for a lapsed QR, hides the image and emits expired once', async () => {
    const { emitted } = await renderSuspended(PaymentPanel, { props: props({ qr: qr({ expiresAt: new Date(Date.now() - 1000).toISOString() }) }) })
    expect(screen.getByText('Mã QR đã hết hạn')).toBeTruthy()
    expect(screen.queryByAltText('Mã QR chuyển khoản')).toBeNull()
    expect(emitted().expired).toHaveLength(1)
  })

  it('warns not to pay twice and lets the customer create a new code', async () => {
    const { emitted } = await renderSuspended(PaymentPanel, { props: props({ qr: null }) })
    expect(screen.getByText(/đừng chuyển lại/i)).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Tạo mã mới' }))
    expect(emitted().repay).toHaveLength(1)
    expect(emitted().expired).toBeUndefined()
  })

  it('disables the button while a new code is being created', async () => {
    await renderSuspended(PaymentPanel, { props: props({ qr: null, repaying: true }) })
    expect((screen.getByRole('button', { name: 'Tạo mã mới' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

it('expires on the ticking clock once and clears its interval on unmount', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
  const baseline = vi.getTimerCount()
  const view = await renderSuspended(PaymentPanel, { props: props({ qr: qr({ expiresAt: new Date(Date.now() + 1000).toISOString() }) }) })
  await vi.advanceTimersByTimeAsync(1000)
  await nextTick()
  expect(screen.queryByAltText('Mã QR chuyển khoản')).toBeNull()
  expect(view.emitted().expired).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(5000)
  expect(view.emitted().expired).toHaveLength(1)
  view.unmount()
  expect(vi.getTimerCount()).toBe(baseline)
})

it('shows QR loading, supports provider failure retry, and resets for a new URL', async () => {
  const view = await renderSuspended(PaymentPanel, { props: props() })
  const original = screen.getByAltText('Mã QR chuyển khoản')
  expect(screen.getByText('Đang tải mã QR…')).toBeTruthy()
  await fireEvent.load(original)
  expect(screen.queryByText('Đang tải mã QR…')).toBeNull()
  await fireEvent.error(original)
  expect(screen.getByText('Chưa tải được mã QR')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Sao chép nội dung chuyển khoản' })).toBeTruthy()
  await fireEvent.click(screen.getByRole('button', { name: 'Thử tải lại QR' }))
  const retried = screen.getByAltText('Mã QR chuyển khoản')
  expect(retried).not.toBe(original)
  expect(retried.getAttribute('src')).toBe(qr().imageUrl)
  expect(screen.getByText('Đang tải mã QR…')).toBeTruthy()
  await fireEvent.load(retried)
  await fireEvent.error(original)
  expect(screen.queryByText('Chưa tải được mã QR')).toBeNull()
  await view.rerender({ qr: qr({ imageUrl: `${qr().imageUrl}&retry=new` }) })
  expect(screen.getByText('Đang tải mã QR…')).toBeTruthy()
  expect(screen.queryByText('Chưa tải được mã QR')).toBeNull()
  const current = screen.getByAltText('Mã QR chuyển khoản')
  await fireEvent.load(current)
  await fireEvent.error(retried)
  expect(screen.queryByText('Chưa tải được mã QR')).toBeNull()
  expect(screen.queryByText('Đang tải mã QR…')).toBeNull()
})
