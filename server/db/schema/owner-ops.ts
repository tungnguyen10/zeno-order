import { sql } from 'drizzle-orm'
import { bigint, check, foreignKey, index, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { stores, userProfiles } from './identity'
import { bankTransactions } from './payment-webhook'
import { orders } from './ordering'

export const orderPaymentMethod = pgEnum('order_payment_method', ['CASH', 'SEPAY', 'BANK_MANUAL'])

export const orderPayments = pgTable('order_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  storeId: uuid('store_id').notNull(),
  orderId: uuid('order_id').notNull(),
  // FK tới bank_transactions được thêm ở PR6 cùng unique(bank_transaction_id) where not null.
  bankTransactionId: uuid('bank_transaction_id'),
  method: orderPaymentMethod('method').notNull(),
  amountVnd: bigint('amount_vnd', { mode: 'number' }).notNull(),
  note: text('note'),
  recordedBy: text('recorded_by').references(() => userProfiles.userId),
  refundedAt: timestamp('refunded_at', { withTimezone: true }),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  foreignKey({ name: 'order_payments_store_fk', columns: [t.orgId, t.storeId], foreignColumns: [stores.orgId, stores.id] }).onDelete('cascade'),
  foreignKey({ name: 'order_payments_order_fk', columns: [t.storeId, t.orderId], foreignColumns: [orders.storeId, orders.id] }).onDelete('cascade'),
  foreignKey({ name: 'order_payments_bank_tx_org_fk', columns: [t.orgId, t.bankTransactionId], foreignColumns: [bankTransactions.orgId, bankTransactions.id] }),
  uniqueIndex('order_payments_bank_tx_uq').on(t.bankTransactionId).where(sql`${t.bankTransactionId} is not null`),
  unique('order_payments_order_uq').on(t.orderId),
  check('order_payments_amount_nonneg', sql`${t.amountVnd} >= 0`),
  index('order_payments_store_recorded_idx').on(t.storeId, t.recordedAt),
])
