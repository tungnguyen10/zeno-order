import { sql } from 'drizzle-orm'
import {
  bigint, boolean, check, foreignKey, index, integer, pgEnum, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core'
import { PAYMENT_ATTEMPT_STATUSES, SEPAY_ENVIRONMENTS, SEPAY_INTEGRATION_STATUSES } from '../../../shared/payment'
import { organizations, stores, timestamps } from './identity'
import { orders } from './ordering'

export const sepayEnvironment = pgEnum('sepay_environment', SEPAY_ENVIRONMENTS)
export const sepayIntegrationStatus = pgEnum('sepay_integration_status', SEPAY_INTEGRATION_STATUSES)
export const paymentAttemptStatus = pgEnum('payment_attempt_status', PAYMENT_ATTEMPT_STATUSES)

export const storePaymentAccounts = pgTable('store_payment_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  storeId: uuid('store_id').notNull(),
  bankCode: text('bank_code').notNull(),
  /** Original bank account number; PR6 verifies its mapping to the provider payload. */
  accountNumber: text('account_number').notNull(),
  /** Official SePay virtual account encoded in the QR; PR6 verifies the provider payload mapping. */
  vaNumber: text('va_number'),
  accountHolder: text('account_holder').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  /** Owner scanned the check QR and the bank app showed the right holder. */
  qrCheckedAt: timestamp('qr_checked_at', { withTimezone: true }),
  /** QR-checked and linked to an ACTIVE integration that has received a valid webhook. */
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  ...timestamps,
}, t => [
  unique('store_payment_accounts_store_id_id_uq').on(t.storeId, t.id),
  unique('store_payment_accounts_org_id_id_uq').on(t.orgId, t.id),
  foreignKey({ name: 'store_payment_accounts_store_fk', columns: [t.orgId, t.storeId], foreignColumns: [stores.orgId, stores.id] }).onDelete('cascade'),
  uniqueIndex('store_payment_accounts_one_active_uq').on(t.storeId).where(sql`${t.isActive}`),
  check('store_payment_accounts_verified_requires_check', sql`${t.verifiedAt} is null or ${t.qrCheckedAt} is not null`),
])

export const sepayIntegrations = pgTable('sepay_integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  environment: sepayEnvironment('environment').notNull().default('live'),
  webhookEndpointKey: text('webhook_endpoint_key').notNull(),
  encryptedHmacSecret: text('encrypted_hmac_secret'),
  encryptedApiToken: text('encrypted_api_token'),
  keyVersion: integer('key_version').notNull().default(1),
  status: sepayIntegrationStatus('status').notNull().default('DRAFT'),
  secretUpdatedAt: timestamp('secret_updated_at', { withTimezone: true }),
  /** Set by PR6 on the first webhook whose signature verified. */
  lastValidWebhookAt: timestamp('last_valid_webhook_at', { withTimezone: true }),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
  ...timestamps,
}, t => [
  unique('sepay_integrations_endpoint_key_uq').on(t.webhookEndpointKey),
  unique('sepay_integrations_org_id_id_uq').on(t.orgId, t.id),
  uniqueIndex('sepay_integrations_org_env_open_uq').on(t.orgId, t.environment).where(sql`${t.status} <> 'DISABLED'`),
  check('sepay_integrations_secret_required', sql`${t.status} in ('DRAFT', 'DISABLED') or ${t.encryptedHmacSecret} is not null`),
])

export const integrationAccounts = pgTable('integration_accounts', {
  orgId: uuid('org_id').notNull(),
  integrationId: uuid('integration_id').notNull(),
  paymentAccountId: uuid('payment_account_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  primaryKey({ name: 'integration_accounts_pk', columns: [t.integrationId, t.paymentAccountId] }),
  foreignKey({ name: 'integration_accounts_integration_fk', columns: [t.orgId, t.integrationId], foreignColumns: [sepayIntegrations.orgId, sepayIntegrations.id] }).onDelete('cascade'),
  foreignKey({ name: 'integration_accounts_account_fk', columns: [t.orgId, t.paymentAccountId], foreignColumns: [storePaymentAccounts.orgId, storePaymentAccounts.id] }).onDelete('cascade'),
  index('integration_accounts_account_idx').on(t.paymentAccountId),
])

export const paymentAttempts = pgTable('payment_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  storeId: uuid('store_id').notNull(),
  orderId: uuid('order_id').notNull(),
  accountId: uuid('account_id').notNull(),
  // Snapshot of the receiving account when the attempt was created: later account edits never change an old QR.
  bankCode: text('bank_code').notNull(),
  accountNumber: text('account_number').notNull(),
  vaNumber: text('va_number'),
  accountHolder: text('account_holder').notNull(),
  paymentCode: text('payment_code').notNull(),
  transferContent: text('transfer_content').notNull(),
  expectedAmountVnd: bigint('expected_amount_vnd', { mode: 'number' }).notNull(),
  status: paymentAttemptStatus('status').notNull().default('PENDING'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ...timestamps,
}, t => [
  unique('payment_attempts_payment_code_uq').on(t.paymentCode),
  unique('payment_attempts_store_id_id_uq').on(t.storeId, t.id),
  foreignKey({ name: 'payment_attempts_store_fk', columns: [t.orgId, t.storeId], foreignColumns: [stores.orgId, stores.id] }).onDelete('cascade'),
  foreignKey({ name: 'payment_attempts_order_fk', columns: [t.storeId, t.orderId], foreignColumns: [orders.storeId, orders.id] }).onDelete('cascade'),
  foreignKey({ name: 'payment_attempts_account_fk', columns: [t.storeId, t.accountId], foreignColumns: [storePaymentAccounts.storeId, storePaymentAccounts.id] }),
  uniqueIndex('payment_attempts_one_pending_uq').on(t.orderId).where(sql`${t.status} = 'PENDING'`),
  index('payment_attempts_order_idx').on(t.orderId, t.createdAt),
  index('payment_attempts_expiry_idx').on(t.status, t.expiresAt),
  check('payment_attempts_amount_positive', sql`${t.expectedAmountVnd} > 0`),
])
