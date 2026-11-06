import { getWebhookAuthMode } from './webhook-auth-settings'
import { and, asc, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm'
import type { CreateIntegrationInput, SepaySecretInput } from '../../../shared/schemas/payment'
import type { SepayIntegrationDto } from '../../../shared/types/payment'
import type { Db, DbOrTx } from '../../db/client'
import { isUniqueViolation } from '../../db/errors'
import { integrationAccounts, sepayIntegrations, storePaymentAccounts } from '../../db/schema'
import { encryptSecret } from '../../utils/crypto'
import { AppError } from '../../utils/errors'
import { generateToken } from '../../utils/tokens'
import { verifyAccountIfIntegrationActive } from './accounts'
import { PAYMENT_SECRET_KEY_VERSION } from './constants'

type IntegrationRow = typeof sepayIntegrations.$inferSelect

const notFound = () => new AppError('NOT_FOUND', 'Không tìm thấy')

export function buildWebhookUrl(baseUrl: string, endpointKey: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/webhooks/sepay/${endpointKey}`
}

/** The only place an integration row becomes an API shape: an explicit whitelist, never a spread of the row. */
async function toDto(db: DbOrTx, row: IntegrationRow, baseUrl: string): Promise<SepayIntegrationDto> {
  const links = await db
    .select({ id: integrationAccounts.paymentAccountId })
    .from(integrationAccounts)
    .where(and(eq(integrationAccounts.orgId, row.orgId), eq(integrationAccounts.integrationId, row.id)))
    .orderBy(asc(integrationAccounts.createdAt))
  return {
    id: row.id,
    name: row.name,
    environment: row.environment,
    status: row.status,
    hasSecret: row.encryptedHmacSecret !== null,
    hasApiToken: row.encryptedApiToken !== null,
    secretUpdatedAt: row.secretUpdatedAt?.toISOString() ?? null,
    lastValidWebhookAt: row.lastValidWebhookAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    webhookAuthMode: await getWebhookAuthMode(db, row.id),
    webhookUrl: buildWebhookUrl(baseUrl, row.webhookEndpointKey),
    accountIds: links.map(link => link.id),
  }
}

async function lockIntegration(db: DbOrTx, orgId: string, integrationId: string): Promise<IntegrationRow> {
  const [row] = await db
    .select()
    .from(sepayIntegrations)
    .where(and(eq(sepayIntegrations.orgId, orgId), eq(sepayIntegrations.id, integrationId)))
    .for('update')
  if (!row) throw notFound()
  return row
}

async function findOpen(db: DbOrTx, orgId: string, environment: IntegrationRow['environment']): Promise<IntegrationRow | undefined> {
  const [row] = await db
    .select()
    .from(sepayIntegrations)
    .where(and(
      eq(sepayIntegrations.orgId, orgId),
      eq(sepayIntegrations.environment, environment),
      ne(sepayIntegrations.status, 'DISABLED'),
    ))
    .limit(1)
  return row
}

export async function createOrGetIntegration(
  db: Db,
  orgId: string,
  input: CreateIntegrationInput,
  baseUrl: string,
): Promise<{ integration: SepayIntegrationDto, created: boolean }> {
  const existing = await findOpen(db, orgId, input.environment)
  if (existing) return { integration: await toDto(db, existing, baseUrl), created: false }
  try {
    const [row] = await db
      .insert(sepayIntegrations)
      .values({ orgId, name: input.name, environment: input.environment, webhookEndpointKey: generateToken(24) })
      .returning()
    return { integration: await toDto(db, row!, baseUrl), created: true }
  }
  catch (err) {
    if (!isUniqueViolation(err, 'sepay_integrations_org_env_open_uq')) throw err
    const winner = await findOpen(db, orgId, input.environment)
    if (!winner) throw err
    return { integration: await toDto(db, winner, baseUrl), created: false }
  }
}

export async function listIntegrations(db: DbOrTx, orgId: string, baseUrl: string): Promise<SepayIntegrationDto[]> {
  const rows = await db
    .select()
    .from(sepayIntegrations)
    .where(and(eq(sepayIntegrations.orgId, orgId), ne(sepayIntegrations.status, 'DISABLED')))
    .orderBy(asc(sepayIntegrations.createdAt))
  return Promise.all(rows.map(row => toDto(db, row, baseUrl)))
}

export async function getIntegration(db: DbOrTx, orgId: string, integrationId: string, baseUrl: string): Promise<SepayIntegrationDto> {
  const [row] = await db
    .select()
    .from(sepayIntegrations)
    .where(and(eq(sepayIntegrations.orgId, orgId), eq(sepayIntegrations.id, integrationId)))
  if (!row) throw notFound()
  return toDto(db, row, baseUrl)
}

export async function saveIntegrationSecret(
  db: Db,
  orgId: string,
  integrationId: string,
  input: SepaySecretInput,
  baseUrl: string,
  now = new Date(),
): Promise<SepayIntegrationDto> {
  return db.transaction(async (tx) => {
    const row = await lockIntegration(tx, orgId, integrationId)
    if (row.status === 'DISABLED') throw new AppError('STATUS_CONFLICT', 'Kết nối SePay này đã bị tắt')
    const [updated] = await tx
      .update(sepayIntegrations)
      .set({
        encryptedHmacSecret: encryptSecret(input.hmacSecret),
        ...(input.apiToken === undefined ? {} : { encryptedApiToken: encryptSecret(input.apiToken) }),
        keyVersion: PAYMENT_SECRET_KEY_VERSION,
        status: row.status === 'DRAFT' ? 'TESTING' : row.status,
        secretUpdatedAt: now,
        updatedAt: now,
      })
      .where(eq(sepayIntegrations.id, row.id))
      .returning()
    return toDto(tx, updated!, baseUrl)
  })
}

export async function linkAccountToIntegration(
  db: Db,
  orgId: string,
  integrationId: string,
  paymentAccountId: string,
  baseUrl: string,
  now = new Date(),
): Promise<SepayIntegrationDto> {
  return db.transaction(async (tx) => {
    const row = await lockIntegration(tx, orgId, integrationId)
    if (row.status === 'DISABLED') throw new AppError('STATUS_CONFLICT', 'Kết nối SePay này đã bị tắt')
    const [account] = await tx
      .select({ id: storePaymentAccounts.id })
      .from(storePaymentAccounts)
      .where(and(
        eq(storePaymentAccounts.orgId, orgId),
        eq(storePaymentAccounts.id, paymentAccountId),
        eq(storePaymentAccounts.isActive, true),
      ))
    if (!account) throw notFound()
    await tx.insert(integrationAccounts).values({ orgId, integrationId: row.id, paymentAccountId: account.id }).onConflictDoNothing()
    await verifyAccountIfIntegrationActive(tx, orgId, account.id, now)
    return toDto(tx, row, baseUrl)
  })
}

export async function activateIntegration(
  db: Db,
  orgId: string,
  integrationId: string,
  baseUrl: string,
  now = new Date(),
): Promise<SepayIntegrationDto> {
  return db.transaction(async (tx) => {
    const row = await lockIntegration(tx, orgId, integrationId)
    if (row.status === 'ACTIVE') return toDto(tx, row, baseUrl)
    if (row.status !== 'TESTING') {
      throw new AppError('STATUS_CONFLICT', 'Cần lưu Secret Key trước khi bật', { reason: 'NOT_TESTING' })
    }
    if (!row.lastValidWebhookAt) {
      throw new AppError('STATUS_CONFLICT', 'Chưa nhận được giao dịch hợp lệ nào từ SePay', { reason: 'NO_VALID_WEBHOOK' })
    }
    const checked = await tx
      .select({ id: storePaymentAccounts.id })
      .from(integrationAccounts)
      .innerJoin(storePaymentAccounts, and(
        eq(storePaymentAccounts.orgId, integrationAccounts.orgId),
        eq(storePaymentAccounts.id, integrationAccounts.paymentAccountId),
      ))
      .where(and(
        eq(integrationAccounts.orgId, orgId),
        eq(integrationAccounts.integrationId, row.id),
        eq(storePaymentAccounts.isActive, true),
        isNotNull(storePaymentAccounts.qrCheckedAt),
      ))
      .for('update', { of: storePaymentAccounts })
    if (checked.length === 0) {
      throw new AppError('STATUS_CONFLICT', 'Chưa có tài khoản nào đã kiểm tra mã QR', { reason: 'NO_CHECKED_ACCOUNT' })
    }
    const [updated] = await tx
      .update(sepayIntegrations)
      .set({ status: 'ACTIVE', activatedAt: now, updatedAt: now })
      .where(eq(sepayIntegrations.id, row.id))
      .returning()
    await tx
      .update(storePaymentAccounts)
      .set({ verifiedAt: now, updatedAt: now })
      .where(and(
        eq(storePaymentAccounts.orgId, orgId),
        inArray(storePaymentAccounts.id, checked.map(account => account.id)),
        isNull(storePaymentAccounts.verifiedAt),
      ))
    return toDto(tx, updated!, baseUrl)
  })
}
