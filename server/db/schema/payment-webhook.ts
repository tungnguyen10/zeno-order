import { sql } from 'drizzle-orm'
import { bigint, check, foreignKey, index, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import {
  BANK_TX_ACTIONS, BANK_TX_DIRECTIONS, BANK_TX_SOURCES, BANK_TX_STATUSES, RESOLUTIONS, REVIEW_REASONS,
} from '../../../shared/payments'
import { organizations, stores } from './identity'
import { orders } from './ordering'
import { sepayIntegrations } from './payment-setup'

export const reconciliationStatus = pgEnum('reconciliation_status', BANK_TX_STATUSES)
export const bankTxSource = pgEnum('bank_tx_source', BANK_TX_SOURCES)
export const bankTxDirection = pgEnum('bank_tx_direction', BANK_TX_DIRECTIONS)
export const bankTxReviewReason = pgEnum('bank_tx_review_reason', REVIEW_REASONS)
export const bankTxResolution = pgEnum('bank_tx_resolution', RESOLUTIONS)
export const bankTxAction = pgEnum('bank_tx_action', BANK_TX_ACTIONS)
export const webhookAuthMode = pgEnum('webhook_auth_mode', ['HMAC', 'APIKEY'])

export const bankTransactions = pgTable('bank_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  integrationId: uuid('integration_id').notNull().references(() => sepayIntegrations.id),
  bankCode: text('bank_code'),
  providerTransactionId: text('provider_transaction_id').notNull(),
  providerAltIds: text('provider_alt_ids').array().notNull().default(sql`'{}'::text[]`),
  source: bankTxSource('source').notNull(),
  direction: bankTxDirection('direction').notNull(),
  bankAccountNumber: text('bank_account_number').notNull(),
  subAccount: text('sub_account'),
  amountVnd: bigint('amount_vnd', { mode: 'number' }).notNull(),
  paymentCode: text('payment_code'),
  content: text('content'),
  referenceCode: text('reference_code'),
  transactionDate: timestamp('transaction_date', { withTimezone: true }).notNull(),
  rawPayloadJson: jsonb('raw_payload_json').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  reconciliationStatus: reconciliationStatus('reconciliation_status').notNull().default('RECEIVED'),
  reviewReason: bankTxReviewReason('review_reason'),
  matchedStoreId: uuid('matched_store_id'),
  matchedOrderId: uuid('matched_order_id'),
  resolution: bankTxResolution('resolution'),
  resolutionNote: text('resolution_note'),
  resolvedBy: text('resolved_by'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, t => [
  unique('bank_transactions_org_id_id_uq').on(t.orgId, t.id),
  foreignKey({ name: 'bank_transactions_integration_org_fk', columns: [t.orgId, t.integrationId], foreignColumns: [sepayIntegrations.orgId, sepayIntegrations.id] }),
  unique('bank_transactions_integration_provider_uq').on(t.integrationId, t.providerTransactionId),
  check('bank_transactions_amount_positive', sql`${t.amountVnd} > 0 and ${t.amountVnd} <= 9007199254740991`),
  check('bank_transactions_match_pair', sql`(${t.matchedStoreId} is null) = (${t.matchedOrderId} is null)`),
  foreignKey({ name: 'bank_transactions_order_fk', columns: [t.matchedStoreId, t.matchedOrderId], foreignColumns: [orders.storeId, orders.id] }),
  foreignKey({ name: 'bank_transactions_store_fk', columns: [t.orgId, t.matchedStoreId], foreignColumns: [stores.orgId, stores.id] }),
  index('bank_transactions_queue_idx').on(t.orgId, t.reconciliationStatus, t.receivedAt),
  index('bank_transactions_payment_code_idx').on(t.paymentCode),
  index('bank_transactions_twin_idx').on(t.integrationId, t.referenceCode, t.amountVnd),
  index('bank_transactions_alt_ids_idx').using('gin', t.providerAltIds),
  index('bank_transactions_matched_order_idx').on(t.matchedOrderId),
])

export const bankTransactionEvents = pgTable('bank_transaction_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  bankTransactionId: uuid('bank_transaction_id').notNull().references(() => bankTransactions.id, { onDelete: 'cascade' }),
  action: bankTxAction('action').notNull(),
  fromStatus: reconciliationStatus('from_status'),
  toStatus: reconciliationStatus('to_status'),
  orderId: uuid('order_id'),
  actorUserId: text('actor_user_id'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  foreignKey({ name: 'bank_transaction_events_tx_org_fk', columns: [t.orgId, t.bankTransactionId], foreignColumns: [bankTransactions.orgId, bankTransactions.id] }).onDelete('cascade'),
  index('bank_transaction_events_tx_idx').on(t.bankTransactionId, t.createdAt),
])

export const reconcileCheckpoints = pgTable('reconcile_checkpoints', {
  integrationId: uuid('integration_id').primaryKey().references(() => sepayIntegrations.id, { onDelete: 'cascade' }),
  coveredFrom: timestamp('covered_from', { withTimezone: true }),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastError: text('last_error'),
})

export const sepayWebhookAuth = pgTable('sepay_webhook_auth', {
  integrationId: uuid('integration_id').primaryKey().references(() => sepayIntegrations.id, { onDelete: 'cascade' }),
  mode: webhookAuthMode('mode').notNull().default('HMAC'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
})

// Authoritative provider identities are unique even after cross-source aliases are attached.
export const bankTransactionIdentities = pgTable('bank_transaction_identities', {
  integrationId: uuid('integration_id').notNull(),
  source: bankTxSource('source').notNull(),
  providerId: text('provider_id').notNull(),
  orgId: uuid('org_id').notNull(),
  transactionId: uuid('transaction_id').notNull(),
}, t => [
  unique('bank_transaction_identity_uq').on(t.integrationId, t.source, t.providerId),
  foreignKey({ columns: [t.orgId, t.integrationId], foreignColumns: [sepayIntegrations.orgId, sepayIntegrations.id] }),
  foreignKey({ columns: [t.orgId, t.transactionId], foreignColumns: [bankTransactions.orgId, bankTransactions.id] }).onDelete('cascade'),
])

export const paymentJobLeases = pgTable('payment_job_leases', {
  key: text('key').primaryKey(),
  owner: uuid('owner').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})
