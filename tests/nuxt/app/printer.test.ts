import { mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { usePrinter } from '~/composables/usePrinter'
import type { TicketOrder } from '#shared/kitchen-ticket'

const order: TicketOrder = {
  publicCode: 'A1B2C3',
  fulfillmentType: 'PICKUP',
  createdAt: '2026-11-18T05:00:00Z',
  items: [{ name: 'Trà sữa', qty: 1, options: [] }],
}

async function mountPrinter() {
  let printer!: ReturnType<typeof usePrinter>
  const wrapper = await mountSuspended(defineComponent({ setup() { printer = usePrinter(); return () => h('div') } }))
  return { printer, wrapper }
}

beforeEach(() => {
  localStorage.clear()
  clearNuxtState()
})

describe('usePrinter', () => {
  it('writes ESC/POS bytes to a connected Bluetooth printer', async () => {
    const { printer, wrapper } = await mountPrinter()
    const write = vi.fn().mockResolvedValue(undefined)
    printer.setMethod('bluetooth')
    printer.connection.value = { name: 'Máy in', write, disconnect: vi.fn() }

    expect(await printer.print(order)).toBe(true)
    expect(write).toHaveBeenCalledTimes(1)
    const bytes = write.mock.calls[0]![0] as Uint8Array
    expect(Array.from(bytes.subarray(0, 2))).toEqual([0x1b, 0x40])
    wrapper.unmount()
  })

  it('reports failure when the Bluetooth method has no connection', async () => {
    const { printer, wrapper } = await mountPrinter()
    printer.setMethod('bluetooth')
    expect(await printer.print(order)).toBe(false)
    wrapper.unmount()
  })

  it('persists the method and auto-print preferences', async () => {
    const { printer, wrapper } = await mountPrinter()
    printer.setMethod('bluetooth')
    printer.setAutoPrint(true)
    expect(localStorage.getItem('zeno:printer-method')).toBe('bluetooth')
    expect(localStorage.getItem('zeno:printer-autoprint')).toBe('on')
    wrapper.unmount()
  })

  it('defaults to 80mm and persists the chosen paper width', async () => {
    const { printer, wrapper } = await mountPrinter()
    expect(printer.paperWidth.value).toBe('80')
    printer.setPaperWidth('58')
    expect(localStorage.getItem('zeno:printer-width')).toBe('58')
    wrapper.unmount()
  })

  it('encodes a narrower ESC/POS ticket at 58mm than at 80mm', async () => {
    const { printer, wrapper } = await mountPrinter()
    const write = vi.fn().mockResolvedValue(undefined)
    printer.setMethod('bluetooth')
    printer.connection.value = { name: 'P', write, disconnect: vi.fn() }

    printer.setPaperWidth('80')
    await printer.print(order)
    const wide = (write.mock.calls[0]![0] as Uint8Array).length
    printer.setPaperWidth('58')
    await printer.print(order)
    const narrow = (write.mock.calls[1]![0] as Uint8Array).length
    expect(wide).toBeGreaterThan(narrow)
    wrapper.unmount()
  })
})
