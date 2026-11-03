import { renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import type { SepayIntegrationDto } from '#shared/types/payment'
import SepayCard from '~/components/settings/SepayCard.vue'

const integration = (over: Partial<SepayIntegrationDto> = {}): SepayIntegrationDto => ({
  id: 'int-1', name: 'SePay', environment: 'live', status: 'DRAFT', hasSecret: false, hasApiToken: false,
  secretUpdatedAt: null, lastValidWebhookAt: null, updatedAt: '2026-11-01T05:00:00.000Z',
  webhookUrl: 'https://zeno.example/api/webhooks/sepay/abcdefghijklmnopqrstuvwxyz012345', accountIds: [], ...over,
})
const base = { integration: null as SepayIntegrationDto | null, step: 'CONNECT_SEPAY' as const, busy: null }

describe('SepayCard', () => {
  it('asks the owner to finish the account first', async () => {
    await renderSuspended(SepayCard, { props: { ...base, step: 'CONFIRM_QR' } })
    expect(screen.getByText(/Hoàn tất tài khoản nhận tiền trước/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Kết nối SePay' })).toBeNull()
  })

  it('connects with one tap', async () => {
    const { emitted } = await renderSuspended(SepayCard, { props: base })
    await fireEvent.click(screen.getByRole('button', { name: 'Kết nối SePay' }))
    expect(emitted().connect).toHaveLength(1)
  })

  it('shows the webhook URL and the verified SePay setup (prefix ZO, 8 chars, Số và chữ, HMAC-SHA256)', async () => {
    const dto = integration()
    await renderSuspended(SepayCard, { props: { ...base, integration: dto, step: 'SAVE_SECRET' } })
    expect((screen.getByLabelText('URL webhook') as HTMLInputElement).value).toBe(dto.webhookUrl)
    const text = document.body.textContent ?? ''
    for (const expected of ['ZO', 'Số và chữ', 'HMAC-SHA256', 'Tiền vào', 'chỉ hiện đầy đủ một lần']) expect(text).toContain(expected)
  })

  it('emits a trimmed secret, omits an empty API token, and clears the field once the save lands', async () => {
    const { emitted, rerender } = await renderSuspended(SepayCard, { props: { ...base, integration: integration(), step: 'SAVE_SECRET' } })
    await fireEvent.update(screen.getByLabelText('Secret Key (HMAC-SHA256)'), '  whsec_0123456789 ')
    await fireEvent.click(screen.getByRole('button', { name: 'Lưu Secret' }))
    expect(emitted()['save-secret']).toEqual([[{ hmacSecret: 'whsec_0123456789' }]])

    await rerender({ integration: integration({ hasSecret: true, status: 'TESTING', secretUpdatedAt: '2026-11-01T05:05:00.000Z' }), step: 'LINK_ACCOUNT' })
    expect(document.body.innerHTML).not.toContain('whsec_0123456789')
  })

  it('never renders a saved secret: only a flag and a "change" action', async () => {
    await renderSuspended(SepayCard, { props: { ...base, integration: integration({ hasSecret: true, status: 'TESTING', secretUpdatedAt: '2026-11-01T05:05:00.000Z' }), step: 'WAIT_WEBHOOK' } })
    expect(screen.getByText('Đã lưu Secret Key')).toBeTruthy()
    expect(screen.queryByLabelText('Secret Key (HMAC-SHA256)')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'Đổi Secret' }))
    expect(screen.getByLabelText('Secret Key (HMAC-SHA256)')).toBeTruthy()
  })

  it('explains the wait for the first SePay transaction and lets the owner reload', async () => {
    const { emitted } = await renderSuspended(SepayCard, { props: { ...base, integration: integration({ hasSecret: true, status: 'TESTING' }), step: 'WAIT_WEBHOOK' } })
    expect(screen.getByText('Chờ giao dịch đầu tiên từ SePay')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Tải lại' }))
    expect(emitted().refresh).toHaveLength(1)
  })

  it('offers to turn bank transfer on once a valid webhook arrived, and shows success when ready', async () => {
    const { emitted } = await renderSuspended(SepayCard, { props: { ...base, integration: integration({ hasSecret: true, status: 'TESTING' }), step: 'ACTIVATE' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Bật nhận chuyển khoản' }))
    expect(emitted().activate).toHaveLength(1)
  })

  it('shows the success state when ready', async () => {
    await renderSuspended(SepayCard, { props: { ...base, integration: integration({ hasSecret: true, status: 'ACTIVE' }), step: 'READY' } })
    expect(screen.getByText('Đang nhận chuyển khoản tự động')).toBeTruthy()
  })
})
