import { sql } from 'drizzle-orm'
import { bigint, boolean, check, foreignKey, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { FULFILLMENT_TYPES, ORDER_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES } from '../../../shared/enums'
import type { OrderItemOptionSnapshot } from '../../../shared/types/order'
import { deliveryZones, products, storeTables } from './catalog'
import { stores, timestamps, userProfiles } from './identity'

export const fulfillmentType = pgEnum('fulfillment_type', FULFILLMENT_TYPES)
export const orderStatus = pgEnum('order_status', ORDER_STATUSES)
export const paymentMethod = pgEnum('payment_method', PAYMENT_METHODS)
export const paymentStatus = pgEnum('payment_status', PAYMENT_STATUSES)

const vnd = (name: string) => bigint(name, { mode: 'number' }).notNull()

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  storeId: uuid('store_id').notNull(),
  publicCode: text('public_code').notNull(),
  guestTokenHash: text('guest_token_hash').notNull(),
  guestTokenEncrypted: text('guest_token_encrypted').notNull(),
  fulfillmentType: fulfillmentType('fulfillment_type').notNull(),
  tableId: uuid('table_id'),
  tableLabel: text('table_label'),
  customerName: text('customer_name'),
  customerPhone: text('customer_phone'),
  deliveryZoneId: uuid('delivery_zone_id'),
  deliveryZoneName: text('delivery_zone_name'),
  addressSnapshot: text('address_snapshot'),
  notes: text('notes'),
  subtotalVnd: vnd('subtotal_vnd'),
  deliveryFeeVnd: vnd('delivery_fee_vnd'),
  totalVnd: vnd('total_vnd'),
  status: orderStatus('status').notNull(),
  paymentMethod: paymentMethod('payment_method').notNull(),
  paymentStatus: paymentStatus('payment_status').notNull(),
  idempotencyKey: uuid('idempotency_key').notNull(),
  latePayment: boolean('late_payment').notNull().default(false),
  ...timestamps,
}, t => [
  unique('orders_guest_token_hash_uq').on(t.guestTokenHash),
  unique('orders_store_idem_uq').on(t.storeId, t.idempotencyKey),
  unique('orders_store_public_code_uq').on(t.storeId, t.publicCode),
  unique('orders_store_id_id_uq').on(t.storeId, t.id),
  foreignKey({ name: 'orders_store_fk', columns: [t.orgId, t.storeId], foreignColumns: [stores.orgId, stores.id] }).onDelete('cascade'),
  foreignKey({ name: 'orders_table_fk', columns: [t.storeId, t.tableId], foreignColumns: [storeTables.storeId, storeTables.id] }),
  foreignKey({ name: 'orders_zone_fk', columns: [t.storeId, t.deliveryZoneId], foreignColumns: [deliveryZones.storeId, deliveryZones.id] }),
  check('orders_money_check', sql`${t.subtotalVnd} >= 0 and ${t.deliveryFeeVnd} >= 0 and ${t.totalVnd} = ${t.subtotalVnd} + ${t.deliveryFeeVnd}`),
  // The board index (store, status, created_at) is added by PR4's `owner_ops` migration, which owns the board query.
])

export const orderItems = pgTable('order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  storeId: uuid('store_id').notNull(),
  orderId: uuid('order_id').notNull(),
  // Nullable per PRD §6; the FK has no ON DELETE action because catalog rows are only ever soft-disabled.
  productId: uuid('product_id'),
  position: integer('position').notNull(),
  nameSnapshot: text('name_snapshot').notNull(),
  optionsSnapshotJson: jsonb('options_snapshot_json').$type<OrderItemOptionSnapshot[]>().notNull().default([]),
  qty: integer('qty').notNull(),
  unitPriceVnd: vnd('unit_price_vnd'),
  lineTotalVnd: vnd('line_total_vnd'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  unique('order_items_store_id_id_uq').on(t.storeId, t.id),
  foreignKey({ name: 'order_items_store_fk', columns: [t.orgId, t.storeId], foreignColumns: [stores.orgId, stores.id] }).onDelete('cascade'),
  foreignKey({ name: 'order_items_order_fk', columns: [t.storeId, t.orderId], foreignColumns: [orders.storeId, orders.id] }).onDelete('cascade'),
  foreignKey({ name: 'order_items_product_fk', columns: [t.storeId, t.productId], foreignColumns: [products.storeId, products.id] }),
  check('order_items_qty_check', sql`${t.qty} between 1 and 50`),
  check('order_items_money_check', sql`${t.unitPriceVnd} >= 0 and ${t.lineTotalVnd} = ${t.unitPriceVnd} * ${t.qty}`),
  index('order_items_order_idx').on(t.storeId, t.orderId, t.position),
])

export const orderEvents = pgTable('order_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  storeId: uuid('store_id').notNull(),
  orderId: uuid('order_id').notNull(),
  actorUserId: text('actor_user_id').references(() => userProfiles.userId),
  // Plain text so later PRs can add event types without a migration.
  eventType: text('event_type').notNull(),
  fromState: text('from_state'),
  toState: text('to_state'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  unique('order_events_store_id_id_uq').on(t.storeId, t.id),
  foreignKey({ name: 'order_events_store_fk', columns: [t.orgId, t.storeId], foreignColumns: [stores.orgId, stores.id] }).onDelete('cascade'),
  foreignKey({ name: 'order_events_order_fk', columns: [t.storeId, t.orderId], foreignColumns: [orders.storeId, orders.id] }).onDelete('cascade'),
  index('order_events_order_idx').on(t.storeId, t.orderId, t.createdAt),
])

// Infrastructure table, deliberately not tenant-scoped: keys are opaque "<scope>:<store>:<ip-hash>" strings.
export const rateLimits = pgTable('rate_limits', {
  key: text('key').notNull(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  count: integer('count').notNull().default(0),
}, t => [
  primaryKey({ name: 'rate_limits_pk', columns: [t.key, t.windowStart] }),
])
