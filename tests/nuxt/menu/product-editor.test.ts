import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { cleanup, fireEvent, screen } from '@testing-library/vue'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MenuProductEditor from '~/components/menu/ProductEditor.vue'
import ZSheet from '~/components/z/Sheet.vue'
import type { ProductDTO } from '#shared/types/catalog'

const { api } = vi.hoisted(() => ({ api: vi.fn() }))
mockNuxtImport('useApi', () => () => api)

const product = (overrides: Partial<ProductDTO> = {}): ProductDTO => ({
  id: 'p1', categoryId: null, name: 'Cà phê', description: null, basePriceVnd: 25000,
  isAvailable: true, active: true, position: 0, imageUrl: null, optionGroups: [], ...overrides,
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}

let unmount: (() => void) | undefined
beforeEach(() => api.mockReset())
afterEach(() => { unmount?.(); cleanup(); unmount = undefined })

describe('MenuProductEditor', () => {
  it('waits for an image upload before saving metadata', async () => {
    const upload = deferred<{ imageUrl: string }>()
    api.mockImplementation((_url: string, options?: { method: string }) => options?.method === 'POST' ? upload.promise : Promise.resolve(product({ name: 'Cà phê mới', imageUrl: '/coffee.png' })))
    const wrapper = await mountSuspended(MenuProductEditor, { props: { open: true, product: product(), categories: [], storeId: 's1' } })
    unmount = () => wrapper.unmount()
    await screen.findByRole('dialog')
    await fireEvent.update(screen.getByRole('textbox', { name: 'Tên món' }), 'Cà phê mới')
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    await fireEvent.change(input, { target: { files: [new File(['image'], 'coffee.png', { type: 'image/png' })] } })
    await vi.waitFor(() => expect(api).toHaveBeenCalledWith('/api/stores/s1/products/p1/image', expect.objectContaining({ method: 'POST' })))
    expect(screen.getByRole('button', { name: 'Lưu món' }).hasAttribute('disabled')).toBe(true)
    await fireEvent.click(screen.getByRole('button', { name: 'Lưu món' }))
    expect(api).toHaveBeenCalledTimes(1)
    upload.resolve({ imageUrl: '/coffee.png' })
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Lưu món' }).hasAttribute('disabled')).toBe(false))
    await fireEvent.click(screen.getByRole('button', { name: 'Lưu món' }))
    await vi.waitFor(() => expect(api).toHaveBeenCalledWith('/api/stores/s1/products/p1', expect.objectContaining({ method: 'PATCH' })))
    expect(wrapper.emitted('saved')?.at(-1)?.[0]).toMatchObject({ name: 'Cà phê mới', imageUrl: '/coffee.png' })
  })

  it('reflects a successful metadata PATCH when the options PUT fails', async () => {
    api.mockImplementation((_url: string, options?: { method: string }) => {
      if (options?.method === 'PATCH') return Promise.resolve(product({ name: 'Tên mới' }))
      if (options?.method === 'PUT') return Promise.reject(new Error('options unavailable'))
      return Promise.resolve({})
    })
    const wrapper = await mountSuspended(MenuProductEditor, { props: { open: true, product: product(), categories: [], storeId: 's1' } })
    unmount = () => wrapper.unmount()
    await screen.findByRole('dialog')
    await fireEvent.update(screen.getByRole('textbox', { name: 'Tên món' }), 'Tên mới')
    await fireEvent.click(screen.getByRole('button', { name: 'Thêm nhóm option' }))
    await fireEvent.update(screen.getByRole('textbox', { name: 'Tên nhóm' }), 'Size')
    await fireEvent.update(screen.getByRole('textbox', { name: 'Tên lựa chọn' }), 'M')
    await fireEvent.click(screen.getByRole('button', { name: 'Lưu món' }))
    await vi.waitFor(() => expect(api).toHaveBeenCalledWith('/api/stores/s1/products/p1/options', expect.objectContaining({ method: 'PUT' })))
    expect(wrapper.emitted('saved')?.[0]?.[0]).toMatchObject({ name: 'Tên mới' })
    expect(await screen.findByText(/Thông tin món đã lưu/)).toBeTruthy()
  })

  it('closes and clears a dirty draft when the store changes', async () => {
    const wrapper = await mountSuspended(MenuProductEditor, { props: { open: true, product: product(), categories: [], storeId: 's1' } })
    unmount = () => wrapper.unmount()
    await screen.findByRole('dialog')
    await fireEvent.update(screen.getByRole('textbox', { name: 'Tên món' }), 'Unsaved')
    await vi.waitFor(() => expect(wrapper.emitted('update:dirty')?.at(-1)?.[0]).toBe(true))
    await wrapper.setProps({ storeId: 's2' })
    await nextTick()
    expect(wrapper.emitted('update:open')?.at(-1)?.[0]).toBe(false)
    expect(wrapper.emitted('update:dirty')?.at(-1)?.[0]).toBe(false)
  })

  it('asks before closing a dirty sheet and resets the draft when reopened', async () => {
    const confirm = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', confirm)
    const wrapper = await mountSuspended(MenuProductEditor, { props: { open: true, product: product(), categories: [], storeId: 's1' } })
    unmount = () => { wrapper.unmount(); vi.unstubAllGlobals() }
    await screen.findByRole('dialog')
    await fireEvent.update(screen.getByRole('textbox', { name: 'Tên món' }), 'Unsaved')
    wrapper.findComponent(ZSheet).vm.$emit('update:open', false)
    await nextTick()
    expect(confirm).toHaveBeenCalledOnce()
    expect(wrapper.emitted('update:open')).toBeUndefined()
    confirm.mockReturnValue(true)
    wrapper.findComponent(ZSheet).vm.$emit('update:open', false)
    await nextTick()
    expect(wrapper.emitted('update:open')?.at(-1)?.[0]).toBe(false)
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    expect((screen.getByRole('textbox', { name: 'Tên món' }) as HTMLInputElement).value).toBe('Cà phê')
  })

  it('ignores an upload result from a previous store', async () => {
    const upload = deferred<{ imageUrl: string }>()
    api.mockImplementation((_url: string, options?: { method: string }) => options?.method === 'POST' ? upload.promise : Promise.resolve({}))
    const wrapper = await mountSuspended(MenuProductEditor, { props: { open: true, product: product(), categories: [], storeId: 's1' } })
    unmount = () => wrapper.unmount()
    await screen.findByRole('dialog')
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    await fireEvent.change(input, { target: { files: [new File(['image'], 'coffee.png', { type: 'image/png' })] } })
    await vi.waitFor(() => expect(api).toHaveBeenCalledWith('/api/stores/s1/products/p1/image', expect.objectContaining({ method: 'POST' })))
    await wrapper.setProps({ storeId: 's2' })
    upload.resolve({ imageUrl: '/old-store.png' })
    await nextTick()
    expect(wrapper.emitted('saved')).toBeUndefined()
  })
})
