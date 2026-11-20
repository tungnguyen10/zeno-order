import { VN_OFFSET_MINUTES } from './store-hours'

export type TicketFulfillment = 'DINE_IN' | 'PICKUP' | 'DELIVERY'

export interface TicketOrderItem {
  name: string
  qty: number
  options: string[]
  note?: string | null
}

/** The minimal order shape a kitchen ticket needs; a BoardOrder satisfies it. */
export interface TicketOrder {
  publicCode: string
  fulfillmentType: TicketFulfillment
  tableName?: string | null
  customerName?: string | null
  customerPhone?: string | null
  address?: string | null
  notes?: string | null
  createdAt: string
  items: TicketOrderItem[]
}

export interface KitchenTicket {
  code: string
  placeLabel: string
  timeLabel: string
  items: TicketOrderItem[]
  customerName: string | null
  customerPhone: string | null
  address: string | null
  note: string | null
}

const PLACE_LABELS: Record<TicketFulfillment, string> = {
  DINE_IN: 'Tại bàn',
  PICKUP: 'Mang đi',
  DELIVERY: 'Giao hàng',
}

function vnTimeLabel(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const vn = new Date(ms + VN_OFFSET_MINUTES * 60_000)
  return `${String(vn.getUTCHours()).padStart(2, '0')}:${String(vn.getUTCMinutes()).padStart(2, '0')}`
}

export function buildKitchenTicket(order: TicketOrder): KitchenTicket {
  const placeLabel = order.fulfillmentType === 'DINE_IN' && order.tableName
    ? order.tableName
    : PLACE_LABELS[order.fulfillmentType]
  return {
    code: order.publicCode,
    placeLabel,
    timeLabel: vnTimeLabel(order.createdAt),
    items: order.items.map(item => ({ name: item.name, qty: item.qty, options: item.options, note: item.note ?? null })),
    customerName: order.customerName ?? null,
    customerPhone: order.customerPhone ?? null,
    address: order.address ?? null,
    note: order.notes ?? null,
  }
}

const DIACRITIC_MAP: Record<string, string> = { đ: 'd', Đ: 'D' }

/** Thermal printers in the ESC/POS path rarely render Vietnamese tones, so fold them to ASCII for legibility. */
export function stripVietnameseTones(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, ch => DIACRITIC_MAP[ch]!)
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (current && current.length + 1 + word.length > width) {
      lines.push(current)
      current = word
    }
    else {
      current = current ? `${current} ${word}` : word
    }
  }
  if (current) lines.push(current)
  return lines
}

/** A plain-text ticket for a given column width (32 for 58mm, 48 for 80mm). Used for the ESC/POS body and tests. */
export function ticketToText(ticket: KitchenTicket, width = 32): string {
  const divider = '-'.repeat(width)
  const lines: string[] = [`#${ticket.code}`, ticket.placeLabel]
  if (ticket.timeLabel) lines.push(ticket.timeLabel)
  lines.push(divider)
  for (const item of ticket.items) {
    wrap(`${item.qty}x ${item.name}`, width).forEach(line => lines.push(line))
    if (item.options.length) wrap(`  ${item.options.join(', ')}`, width).forEach(line => lines.push(line))
    if (item.note) wrap(`  * ${item.note}`, width).forEach(line => lines.push(line))
  }
  lines.push(divider)
  if (ticket.customerName) lines.push(`Ten: ${ticket.customerName}`)
  if (ticket.customerPhone) lines.push(`SDT: ${ticket.customerPhone}`)
  if (ticket.address) wrap(`Dia chi: ${ticket.address}`, width).forEach(line => lines.push(line))
  if (ticket.note) wrap(`Ghi chu: ${ticket.note}`, width).forEach(line => lines.push(line))
  return lines.join('\n')
}

// ESC/POS control sequences.
const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

/** Encodes a ticket to ESC/POS bytes for a Bluetooth thermal printer (diacritics folded to ASCII). */
export function encodeTicketEscPos(ticket: KitchenTicket, width = 32): Uint8Array {
  const bytes: number[] = []
  const ascii = (text: string) => {
    for (const code of stripVietnameseTones(text)) bytes.push(code.charCodeAt(0) & 0x7f)
  }
  const line = (text: string) => { ascii(text); bytes.push(LF) }

  bytes.push(ESC, 0x40) // initialize
  bytes.push(ESC, 0x61, 0x01) // center
  bytes.push(GS, 0x21, 0x11) // double width + height
  line(`#${ticket.code}`)
  bytes.push(GS, 0x21, 0x00) // normal size
  line(ticket.placeLabel)
  bytes.push(ESC, 0x61, 0x00) // left align

  // Skip the first two lines (#code and place) already printed centered above; keep time + body.
  for (const bodyLine of ticketToText(ticket, width).split('\n').slice(2)) {
    line(bodyLine)
  }

  bytes.push(LF, LF, LF)
  bytes.push(GS, 0x56, 0x01) // partial cut
  return Uint8Array.from(bytes)
}
