import { describe, expect, it } from 'vitest'
import {
  buildKitchenTicket,
  encodeTicketEscPos,
  stripVietnameseTones,
  ticketToText,
  type TicketOrder,
} from '#shared/kitchen-ticket'

const order = (over: Partial<TicketOrder> = {}): TicketOrder => ({
  publicCode: 'A1B2C3',
  fulfillmentType: 'PICKUP',
  createdAt: '2026-11-18T05:00:00Z', // VN 12:00
  items: [{ name: 'Trà sữa trân châu', qty: 2, options: ['Size L', 'Ít đá'], note: 'nhiều trân châu' }],
  ...over,
})

describe('buildKitchenTicket', () => {
  it('labels the pickup place and formats the VN time', () => {
    const ticket = buildKitchenTicket(order())
    expect(ticket).toMatchObject({ code: 'A1B2C3', placeLabel: 'Mang đi', timeLabel: '12:00' })
  })

  it('uses the table name for dine-in, and a generic label when missing', () => {
    expect(buildKitchenTicket(order({ fulfillmentType: 'DINE_IN', tableName: 'Bàn 05' })).placeLabel).toBe('Bàn 05')
    expect(buildKitchenTicket(order({ fulfillmentType: 'DINE_IN', tableName: null })).placeLabel).toBe('Tại bàn')
    expect(buildKitchenTicket(order({ fulfillmentType: 'DELIVERY' })).placeLabel).toBe('Giao hàng')
  })

  it('carries customer and order meta through', () => {
    const ticket = buildKitchenTicket(order({ customerName: 'Lan', customerPhone: '0912345678', address: '12 Lê Lợi', notes: 'gọi trước' }))
    expect(ticket).toMatchObject({ customerName: 'Lan', customerPhone: '0912345678', address: '12 Lê Lợi', note: 'gọi trước' })
  })
})

describe('stripVietnameseTones', () => {
  it('folds tones and đ to ASCII', () => {
    expect(stripVietnameseTones('Trà sữa trân châu đá')).toBe('Tra sua tran chau da')
    expect(stripVietnameseTones('ĐÁ ĐƯỜNG')).toBe('DA DUONG')
  })
})

describe('ticketToText', () => {
  it('includes code, place, items, options, note and customer meta', () => {
    const text = ticketToText(buildKitchenTicket(order({ customerPhone: '0912345678' })))
    expect(text).toContain('#A1B2C3')
    expect(text).toContain('Mang đi')
    expect(text).toContain('2x Trà sữa trân châu')
    expect(text).toContain('Size L, Ít đá')
    expect(text).toContain('* nhiều trân châu')
    expect(text).toContain('SDT: 0912345678')
  })

  it('wraps long item names to the column width', () => {
    const longName = 'Trà sữa đặc biệt topping đầy đủ size cực đại'
    const text = ticketToText(buildKitchenTicket(order({ items: [{ name: longName, qty: 1, options: [] }] })), 20)
    expect(text.split('\n').every(line => line.length <= 20)).toBe(true)
  })
})

describe('encodeTicketEscPos', () => {
  it('starts with the init sequence and ends with a partial cut', () => {
    const bytes = encodeTicketEscPos(buildKitchenTicket(order()))
    expect(Array.from(bytes.subarray(0, 2))).toEqual([0x1b, 0x40])
    expect(Array.from(bytes.subarray(-3))).toEqual([0x1d, 0x56, 0x01])
  })

  it('emits ASCII-only payload with diacritics folded', () => {
    const bytes = encodeTicketEscPos(buildKitchenTicket(order()))
    expect(bytes.every(byte => byte < 128)).toBe(true)
    const text = String.fromCharCode(...bytes)
    expect(text).toContain('#A1B2C3')
    expect(text).toContain('Mang di')
    expect(text).toContain('2x Tra sua tran chau')
  })
})
