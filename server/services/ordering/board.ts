import { z } from 'zod'
import type { OrderStatus } from '#shared/enums'
import { TAB_STATUSES, type BoardTab } from '#shared/order-flow'
import { optionLabels } from '#shared/order-snapshot'
import type { BoardOrder, BoardOrderItem, BoardResponse, OrderDetailResponse } from '#shared/types/orders'
import type { StoreContext } from '../../auth/guards'
import type { DbOrTx } from '../../db/client'
import {
  countByStatus,
  findBoardRow,
  findPayment,
  listEvents,
  listItems,
  listOrders,
  listStatusIds,
  type OrderCursor,
  type OrderRow,
} from '../../repositories/orders'
import { AppError } from '../../utils/errors'

const PAGE_SIZE = 30
const NEW_IDS_LIMIT = 100
const PG_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:?\d{2})?$/
const cursorTimestamp = z.string().regex(PG_TIMESTAMP).refine(value =>
  z.iso.date().safeParse(value.slice(0, 10)).success
  && z.iso.time().safeParse(value.slice(11).replace(/[+-].*$/, '')).success
  && Number.isFinite(Date.parse(value)),
)
const cursorSchema = z.object({ t: cursorTimestamp, id: z.uuid() })

export function encodeCursor(cursor: OrderCursor): string {
  return Buffer.from(JSON.stringify({ t: cursor.createdAt, id: cursor.id })).toString('base64url')
}

export function decodeCursor(raw: string): OrderCursor {
  try {
    const parsed = cursorSchema.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')))
    return { createdAt: parsed.t, id: parsed.id }
  }
  catch {
    throw new AppError('VALIDATION_FAILED', 'Cursor không hợp lệ', { field: 'cursor' })
  }
}

type ItemRow = Awaited<ReturnType<typeof listItems>>[number]

function toItem(row: ItemRow): BoardOrderItem {
  return {
    id: row.id,
    name: row.nameSnapshot,
    qty: row.qty,
    options: optionLabels(row.optionsSnapshotJson),
    unitPriceVnd: row.unitPriceVnd,
    lineTotalVnd: row.lineTotalVnd,
  }
}

function toBoardOrder(row: OrderRow, items: BoardOrderItem[]): BoardOrder {
  return {
    id: row.id,
    publicCode: row.publicCode,
    status: row.status,
    fulfillmentType: row.fulfillmentType,
    paymentMethod: row.paymentMethod,
    paymentStatus: row.paymentStatus,
    latePayment: row.latePayment,
    tableName: row.tableLabel,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    address: typeof row.addressSnapshot === 'string' ? row.addressSnapshot : null,
    notes: row.notes,
    totalVnd: row.totalVnd,
    createdAt: row.createdAt.toISOString(),
    items,
  }
}

function groupItems(rows: ItemRow[]): Map<string, BoardOrderItem[]> {
  const grouped = new Map<string, BoardOrderItem[]>()
  for (const row of rows) {
    const list = grouped.get(row.orderId) ?? []
    list.push(toItem(row))
    grouped.set(row.orderId, list)
  }
  return grouped
}

export async function listBoard(
  db: DbOrTx,
  ctx: StoreContext,
  input: { tab: BoardTab, cursor?: string, limit?: number },
): Promise<BoardResponse> {
  const scope = { orgId: ctx.orgId, storeId: ctx.storeId }
  const limit = input.limit ?? PAGE_SIZE
  const cursor = input.cursor ? decodeCursor(input.cursor) : undefined

  const [rows, counts, newOrderIds] = await Promise.all([
    listOrders(db, scope, {
      statuses: TAB_STATUSES[input.tab],
      direction: input.tab === 'other' ? 'desc' : 'asc',
      limit,
      cursor,
    }),
    countByStatus(db, scope),
    listStatusIds(db, scope, 'NEW', NEW_IDS_LIMIT),
  ])

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const items = groupItems(await listItems(db, scope, page.map(row => row.order.id)))
  const last = page.at(-1)

  return {
    orders: page.map(row => toBoardOrder(row.order, items.get(row.order.id) ?? [])),
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAtCursor, id: last.order.id }) : null,
    counts: {
      new: counts.NEW ?? 0,
      doing: counts.PREPARING ?? 0,
      ready: (counts.READY ?? 0) + (counts.DELIVERING ?? 0),
      awaiting_payment: counts.AWAITING_PAYMENT ?? 0,
      other: 0,
    },
    newOrderIds,
    serverTime: new Date().toISOString(),
  }
}

export async function getOrderDetail(db: DbOrTx, ctx: StoreContext, orderId: string): Promise<OrderDetailResponse> {
  const scope = { orgId: ctx.orgId, storeId: ctx.storeId }
  const found = await findBoardRow(db, scope, orderId)
  if (!found) throw new AppError('NOT_FOUND', 'Không tìm thấy')
  const [itemRows, eventRows, payment] = await Promise.all([
    listItems(db, scope, [orderId]),
    listEvents(db, scope, orderId),
    findPayment(db, scope, orderId),
  ])
  return {
    order: toBoardOrder(found, itemRows.map(toItem)),
    events: eventRows.map(event => ({
      id: event.id,
      eventType: event.eventType,
      fromState: event.fromState as OrderStatus | null,
      toState: event.toState as OrderStatus | null,
      actorName: event.actorName ?? event.actorEmail ?? null,
      metadata: (event.metadata as Record<string, unknown> | null) ?? null,
      createdAt: event.createdAt.toISOString(),
    })),
    payment: payment
      ? { method: payment.method, amountVnd: payment.amountVnd, note: payment.note, recordedAt: payment.recordedAt.toISOString() }
      : null,
  }
}
