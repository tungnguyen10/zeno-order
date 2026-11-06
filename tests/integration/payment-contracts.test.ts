import { getTableColumns, sql, type Table } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import {
  integrationAccounts, orderEvents, orderPayments, orders, paymentAttempts, sepayIntegrations, storePaymentAccounts,
} from '../../server/db/schema'
import { consumeRateLimit } from '../../server/services/ordering/rate-limit'
import { findIntegrationByEndpointKey, loadIntegrationSecrets } from '../../server/services/payments/integration-secrets'
import { PAYMENT_TEST_CODE } from '../../server/services/payments/payment-code'
import { decryptSecret, encryptSecret } from '../../server/utils/crypto'
import { resetDb } from '../support/db'
import { insertRawOrder } from '../support/checkout-fixtures'
import { createIntegration, linkAccount, setupBankQr } from '../support/payment-fixtures'
import { createTenant } from '../support/fixtures'

const REQUIRED_COLUMNS: [string, Table, string[]][] = [
  ['orders', orders, ['id', 'orgId', 'storeId', 'publicCode', 'status', 'paymentStatus', 'totalVnd', 'latePayment', 'createdAt']],
  ['orderEvents', orderEvents, ['orgId', 'storeId', 'orderId', 'actorUserId', 'eventType', 'fromState', 'toState', 'metadata']],
  ['orderPayments', orderPayments, ['id', 'orgId', 'storeId', 'orderId', 'bankTransactionId', 'method', 'amountVnd', 'note', 'recordedBy', 'recordedAt']],
  ['paymentAttempts', paymentAttempts, ['id', 'orgId', 'storeId', 'orderId', 'accountId', 'bankCode', 'accountNumber', 'vaNumber', 'accountHolder', 'paymentCode', 'transferContent', 'expectedAmountVnd', 'status', 'expiresAt', 'createdAt']],
  ['storePaymentAccounts', storePaymentAccounts, ['id', 'orgId', 'storeId', 'bankCode', 'accountNumber', 'vaNumber', 'accountHolder', 'isActive', 'qrCheckedAt', 'verifiedAt']],
  ['sepayIntegrations', sepayIntegrations, ['id', 'orgId', 'name', 'environment', 'webhookEndpointKey', 'encryptedHmacSecret', 'encryptedApiToken', 'keyVersion', 'status', 'lastValidWebhookAt']],
  ['integrationAccounts', integrationAccounts, ['integrationId', 'paymentAccountId']],
]

const db = () => getDb()

async function enumLabels(typeName: string): Promise<string[]> {
  const { rows } = await db().execute<{ label: string }>(
    sql`select e.enumlabel as label from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = ${typeName}`,
  )
  return rows.map(row => row.label)
}

async function columnKind(table: string, column: string): Promise<{ dataType: string, udtName: string }> {
  const { rows } = await db().execute<{ data_type: string, udt_name: string }>(
    sql`select data_type, udt_name from information_schema.columns where table_schema = 'public' and table_name = ${table} and column_name = ${column}`,
  )
  return { dataType: rows[0]!.data_type, udtName: rows[0]!.udt_name }
}

beforeEach(async () => {
  await resetDb()
})
afterAll(async () => {
  await closeDb()
})

describe('PR6 contracts with PR3–PR5', () => {
  it.each(REQUIRED_COLUMNS)('%s exposes the columns PR6 reads/writes', (_name, table, columns) => {
    expect(Object.keys(getTableColumns(table))).toEqual(expect.arrayContaining(columns))
  })

  it('order_status and payment_status contain the values PR6 writes', async () => {
    expect(await enumLabels('order_status')).toEqual(expect.arrayContaining(['AWAITING_PAYMENT', 'NEW', 'CANCELLED']))
    expect(await enumLabels('payment_status')).toEqual(
      expect.arrayContaining(['UNPAID', 'PENDING', 'PAID', 'REVIEW_REQUIRED', 'REFUND_DUE', 'REFUNDED']),
    )
  })

  it('order_payments.method accepts SEPAY, CASH and BANK_MANUAL', async () => {
    const kind = await columnKind('order_payments', 'method')
    if (kind.dataType !== 'USER-DEFINED') return
    expect(await enumLabels(kind.udtName)).toEqual(expect.arrayContaining(['SEPAY', 'CASH', 'BANK_MANUAL']))
  })

  it('order_events.event_type is free text (PR6 adds new event types without ALTER TYPE)', async () => {
    expect((await columnKind('order_events', 'event_type')).dataType).not.toBe('USER-DEFINED')
  })

  it('consumeRateLimit returns true while under the limit and false once exceeded', async () => {
    const options = { limit: 2, windowSec: 60 }
    expect(await consumeRateLimit(db(), 'contract:k', options)).toBe(true)
    expect(await consumeRateLimit(db(), 'contract:k', options)).toBe(true)
    expect(await consumeRateLimit(db(), 'contract:k', options)).toBe(false)
  })

  it('encryptSecret/decryptSecret round-trip', () => {
    expect(decryptSecret(encryptSecret('whsec_abc'))).toBe('whsec_abc')
  })

  it('PAYMENT_TEST_CODE is the ZO-code PR5 uses for the account QR check', () => {
    expect(PAYMENT_TEST_CODE).toMatch(/^ZO[A-Z0-9]{8}$/)
  })

  it('PR5 integration helpers resolve a webhook endpoint key and decrypt its secrets', async () => {
    const tenant = await createTenant('contract')
    const { integration } = await setupBankQr(tenant.store)
    expect(await findIntegrationByEndpointKey(db(), integration.webhookEndpointKey)).toMatchObject({ id: integration.id, orgId: tenant.org.id })
    expect(await findIntegrationByEndpointKey(db(), 'x'.repeat(32))).toBeNull()
    expect(await loadIntegrationSecrets(db(), integration.id)).toMatchObject({ hmacSecret: expect.any(String) })
  })

  it('PR3/PR5 fixtures build the rows PR6 fixtures rely on', async () => {
    const tenant = await createTenant('fixtures')
    const order = await insertRawOrder(tenant.store, { paymentMethod: 'BANK_QR', status: 'AWAITING_PAYMENT', paymentStatus: 'PENDING' })
    expect(order.status).toBe('AWAITING_PAYMENT')
    const extra = await createIntegration(tenant.org, { environment: 'test' })
    expect(extra.environment).toBe('test')
    expect(typeof linkAccount).toBe('function')
  })
})
