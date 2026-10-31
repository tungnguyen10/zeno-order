import { renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppCopyField from '~/components/app/CopyField.vue'

const URL_VALUE = 'https://zeno.vn/s/tra-sua-may'

function setNavigator(key: 'clipboard' | 'share', value: unknown) {
  Object.defineProperty(navigator, key, { value, configurable: true, writable: true })
}

afterEach(() => {
  setNavigator('clipboard', undefined)
  setNavigator('share', undefined)
})

describe('AppCopyField', () => {
  it('copies the value and announces success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setNavigator('clipboard', { writeText })
    await renderSuspended(AppCopyField, { props: { value: URL_VALUE, label: 'Link đặt món' } })

    expect((screen.getByLabelText('Link đặt món') as HTMLInputElement).value).toBe(URL_VALUE)
    await fireEvent.click(screen.getByRole('button', { name: 'Sao chép liên kết' }))

    expect(writeText).toHaveBeenCalledWith(URL_VALUE)
    expect(await screen.findByText('Đã sao chép')).toBeTruthy()
  })

  it('falls back to selecting the text when the Clipboard API is unavailable', async () => {
    setNavigator('clipboard', undefined)
    await renderSuspended(AppCopyField, { props: { value: URL_VALUE, label: 'Link đặt món' } })
    const input = screen.getByLabelText('Link đặt món') as HTMLInputElement
    const select = vi.spyOn(input, 'select')

    await fireEvent.click(screen.getByRole('button', { name: 'Sao chép liên kết' }))

    expect(select).toHaveBeenCalled()
    expect((await screen.findAllByText('Nhấn giữ để sao chép')).length).toBeGreaterThan(0)
  })

  it('shows a share button only when Web Share is supported', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    setNavigator('share', share)
    await renderSuspended(AppCopyField, { props: { value: URL_VALUE, label: 'Link đặt món' } })
    await fireEvent.click(await screen.findByRole('button', { name: 'Chia sẻ liên kết' }))
    expect(share).toHaveBeenCalledWith({ url: URL_VALUE })
  })

  it('hides the share button without Web Share', async () => {
    await renderSuspended(AppCopyField, { props: { value: URL_VALUE, label: 'Link đặt món' } })
    expect(screen.queryByRole('button', { name: 'Chia sẻ liên kết' })).toBeNull()
  })
})
