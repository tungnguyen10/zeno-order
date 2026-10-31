import { renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import ZFormField from '~/components/z/FormField.vue'
import ZInput from '~/components/z/Input.vue'
import ZSwitch from '~/components/z/Switch.vue'

describe('ZInput', () => {
  it('toggles password visibility with an accessible button', async () => {
    await renderSuspended(ZInput, { props: { type: 'password', modelValue: 'secret12' } })
    const input = document.querySelector('input')!
    expect(input.type).toBe('password')

    const toggle = screen.getByRole('button', { name: 'Hiện mật khẩu' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    await fireEvent.click(toggle)

    expect(input.type).toBe('text')
    const hide = screen.getByRole('button', { name: 'Ẩn mật khẩu' })
    expect(hide.getAttribute('aria-pressed')).toBe('true')
  })

  it('does not render a toggle for non-password inputs', async () => {
    await renderSuspended(ZInput, { props: { type: 'email' } })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('emits v-model updates and uses 16px text', async () => {
    const onUpdate = vi.fn()
    await renderSuspended(ZInput, { props: { 'modelValue': '', 'onUpdate:modelValue': onUpdate } })
    const input = document.querySelector('input')!
    expect(input.className).toContain('text-base')
    await fireEvent.update(input, 'Trà sữa')
    expect(onUpdate).toHaveBeenLastCalledWith('Trà sữa')
  })
})

describe('ZFormField', () => {
  it('labels its input and shows help text', async () => {
    const Field = defineComponent({
      setup: () => () => h(ZFormField, { label: 'Email', name: 'email', help: 'Dùng email công việc' }, {
        default: () => h(ZInput, { type: 'email' }),
      }),
    })
    await renderSuspended(Field)
    const input = screen.getByLabelText('Email')
    expect(input.tagName).toBe('INPUT')
    expect(screen.getByText('Dùng email công việc')).toBeTruthy()
  })
})

describe('ZSwitch', () => {
  it('exposes a named switch that toggles its model', async () => {
    const Host = defineComponent({
      setup: () => {
        const on = ref(false)
        return () => [
          h(ZSwitch, { 'label': 'Đang nhận đơn', 'modelValue': on.value, 'onUpdate:modelValue': (v: boolean) => { on.value = v } }),
          h('output', on.value ? 'on' : 'off'),
        ]
      },
    })
    await renderSuspended(Host)
    const control = screen.getByRole('switch', { name: 'Đang nhận đơn' })
    expect(control.getAttribute('aria-checked')).toBe('false')
    await fireEvent.click(control)
    expect(screen.getByText('on')).toBeTruthy()
  })
})
