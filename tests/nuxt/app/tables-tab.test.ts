import { mockNuxtImport, renderSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsTablesTab from '~/components/settings/TablesTab.vue'
import type { StoreDetail } from '#shared/types/identity'
import type { TableWithQr } from '#shared/types/catalog'

const { api } = vi.hoisted(() => ({ api: vi.fn() }))
mockNuxtImport('useApi', () => () => api)

afterEach(() => cleanup())
beforeEach(() => api.mockReset())

const store: StoreDetail = {
  id: 's1', orgId: 'o1', name: 'Quán', slug: 'quan', role: 'OWNER', isAcceptingOrders: true,
  dineInEnabled: true, pickupEnabled: true, deliveryEnabled: false,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const createdTable: TableWithQr = {
  id: 'table-1', code: '01', displayName: 'Bàn 01', active: true,
  qrUrl: 'https://zeno.vn/s/quan?t=abc123',
}

describe('SettingsTablesTab', () => {
  it('keeps a just-created table when the initial list request resolves later', async () => {
    const listRequest = deferred<{ tables: [] }>()
    const createRequest = deferred<TableWithQr>()
    api.mockImplementation((_url: string, options?: { method?: string }) => options?.method === 'POST' ? createRequest.promise : listRequest.promise)

    await renderSuspended(SettingsTablesTab, { props: { store } })
    await fireEvent.click(screen.getByRole('button', { name: 'Thêm bàn' }))
    createRequest.resolve(createdTable)
    const createdRows = () => [...document.querySelectorAll('li')].filter(row => row.textContent?.includes('Bàn 01'))
    await waitFor(() => expect(createdRows()).toHaveLength(1))

    listRequest.resolve({ tables: [] })
    await flushPromises()
    expect(createdRows()).toHaveLength(1)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})
