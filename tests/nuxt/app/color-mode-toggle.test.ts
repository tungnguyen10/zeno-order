import { renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import AppColorModeToggle from '~/components/app/ColorModeToggle.vue'

describe('AppColorModeToggle', () => {
  it('switches the preference between light and dark', async () => {
    const colorMode = useColorMode()
    colorMode.preference = 'light'
    await renderSuspended(AppColorModeToggle)

    await fireEvent.click(await screen.findByRole('button', { name: 'Chuyển sang giao diện tối' }))
    expect(colorMode.preference).toBe('dark')
  })

  it('row variant exposes a labelled switch', async () => {
    const colorMode = useColorMode()
    colorMode.preference = 'light'
    await renderSuspended(AppColorModeToggle, { props: { variant: 'row' } })

    await fireEvent.click(await screen.findByRole('switch', { name: 'Giao diện tối' }))
    expect(colorMode.preference).toBe('dark')
  })
})
