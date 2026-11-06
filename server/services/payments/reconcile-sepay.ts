import { withPaymentJobLease } from './job-lease'
import { and, asc, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import type { Db } from '../../db/client'
import {
  bankTransactions, integrationAccounts, reconcileCheckpoints, sepayIntegrations, storePaymentAccounts, paymentAttempts,
} from '../../db/schema'
import { logger } from '../../utils/logger'
import { loadIntegrationSecrets } from './integration-secrets'
import { matchTransaction } from './match-transaction'
import { recordBankTransaction } from './record-bank-transaction'
import { extractPaymentCode } from './sepay-payload'
import { SepayApiError, type SepayTransactionsClient } from './sepay-client'
import type { MatchOutcome } from './types'

export const RECONCILE_OVERLAP_MS = 30 * 60_000
export const RECONCILE_SETTLE_MS = 2 * 60_000
const FIRST_RUN_LOOKBACK_MS = 24 * 3_600_000
const REMATCH_AFTER_MS = 30_000
const REMATCH_BATCH = 200
const MAX_PAGES_PER_ACCOUNT = 20
const PAGE_PAUSE_MS = 400

export interface ReconcileDeps {
  createClient: (apiToken: string, environment: 'test' | 'live') => SepayTransactionsClient
  now: () => Date
  sleep: (ms: number) => Promise<void>
  match?: (db: Db, bankTransactionId: string) => Promise<MatchOutcome>
}

export interface ReconcileSummary {
  rematched: number
  imported: number
  duplicates: number
  integrations: { id: string, ok: boolean, error?: string }[]
}

type Matcher = NonNullable<ReconcileDeps['match']>
interface IntegrationRow { id: string, orgId: string, environment: 'test' | 'live' }

async function rematchPending(db: Db, now: Date, match: Matcher): Promise<number> {
  const pending = await db.select({ id: bankTransactions.id }).from(bankTransactions)
    .where(and(
      eq(bankTransactions.reconciliationStatus, 'RECEIVED'),
      lt(bankTransactions.receivedAt, new Date(now.getTime() - REMATCH_AFTER_MS)),
    ))
    .orderBy(asc(bankTransactions.receivedAt))
    .limit(REMATCH_BATCH)
  let done = 0
  for (const { id } of pending) {
    try {
      await match(db, id)
      done++
    }
    catch {
      logger.error('reconcile.rematch_failed', { transactionId: id })
    }
  }
  return done
}

async function reconcileIntegration(db: Db, deps: ReconcileDeps, match: Matcher, integration: IntegrationRow) {
  const now = deps.now()
  let to = new Date(now.getTime() - RECONCILE_SETTLE_MS)
  const [checkpoint] = await db.select().from(reconcileCheckpoints).where(eq(reconcileCheckpoints.integrationId, integration.id))
  let base = checkpoint?.lastSyncedAt?.getTime() ?? now.getTime() - FIRST_RUN_LOOKBACK_MS
  if (!checkpoint?.lastSyncedAt) {
    const [oldest] = await db.select({ at: sql<Date | null>`min(${paymentAttempts.createdAt})` }).from(paymentAttempts)
      .where(and(eq(paymentAttempts.orgId, integration.orgId), sql`exists (select 1 from orders o where o.id = ${paymentAttempts.orderId} and o.status = 'AWAITING_PAYMENT')`))
    if (oldest?.at) base = Math.min(base, new Date(oldest.at).getTime())
  }
  const from = new Date(base - RECONCILE_OVERLAP_MS)
  // Backfill old orders in bounded windows, catching up on subsequent schedules.
  const windowHours = Number(process.env.SEPAY_RECONCILE_MAX_WINDOW_HOURS ?? 48)
  if (!Number.isFinite(windowHours) || windowHours < 1 || windowHours > 48) throw new SepayApiError('BAD_RESPONSE')
  if (to.getTime() - from.getTime() > windowHours * 3_600_000) to = new Date(from.getTime() + Math.min(24, windowHours) * 3_600_000)

  const accounts = await db.selectDistinct({ id: storePaymentAccounts.id, accountNumber: storePaymentAccounts.accountNumber, vaNumber: storePaymentAccounts.vaNumber })
    .from(integrationAccounts)
    .innerJoin(storePaymentAccounts, eq(storePaymentAccounts.id, integrationAccounts.paymentAccountId))
    .where(eq(integrationAccounts.integrationId, integration.id))

  const secrets = await loadIntegrationSecrets(db, integration.id)
  if (!secrets?.apiToken) throw new SepayApiError('UNAUTHORIZED')
  const client = deps.createClient(secrets.apiToken, integration.environment)
  let imported = 0
  let duplicates = 0

  const snapshots = await db.select({ accountNumber: paymentAttempts.accountNumber, vaNumber: paymentAttempts.vaNumber }).from(paymentAttempts)
    .where(and(eq(paymentAttempts.orgId, integration.orgId), inArray(paymentAttempts.accountId, accounts.map(a => a.id))))
  const allowed = new Set([...accounts, ...snapshots].flatMap(a => [a.accountNumber, a.vaNumber].filter((v): v is string => !!v)))
  const deadline = Date.now() + 240_000
  let cursor: string | undefined
  if (accounts.length === 0) throw new SepayApiError('BAD_RESPONSE')
  // The endpoint is company-scoped. Read each page once, then scope to linked receiver snapshots.
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES_PER_ACCOUNT || Date.now() >= deadline) throw new SepayApiError('TOO_MANY_PAGES')
    await deps.sleep(PAGE_PAUSE_MS)
    const result = await client.list({ accountNumber: '*', from, to, cursor })
    for (const item of result.items) {
      if (Date.now() >= deadline) throw new SepayApiError('TOO_MANY_PAGES')
      if (item.transferType !== 'in' || item.amountIn <= 0 || ![item.accountNumber, item.va].some(v => v && allowed.has(v))) continue
      const record = await recordBankTransaction(db, {
        orgId: integration.orgId, integrationId: integration.id, bankCode: item.bankCode,
        providerTransactionId: item.id, source: 'RECONCILE', direction: 'IN',
        bankAccountNumber: item.accountNumber, subAccount: item.va, amountVnd: item.amountIn,
        paymentCode: extractPaymentCode(item.code, item.content), content: item.content,
        referenceCode: item.referenceNumber || null, transactionDate: item.transactionDate, rawPayload: item.raw,
      })
      if (record.created) imported++
      else duplicates++
      if (record.status === 'RECEIVED') await match(db, record.id)
    }
    if (!result.nextCursor) break
    if (result.nextCursor === cursor) throw new SepayApiError('BAD_RESPONSE')
    cursor = result.nextCursor
  }
  if (Date.now() >= deadline) throw new SepayApiError('TOO_MANY_PAGES')

  await db.insert(reconcileCheckpoints)
    .values({ integrationId: integration.id, coveredFrom: from, lastSyncedAt: to, lastRunAt: now, lastError: null })
    .onConflictDoUpdate({ target: reconcileCheckpoints.integrationId, set: { lastSyncedAt: sql`greatest(${reconcileCheckpoints.lastSyncedAt}, ${to.toISOString()}::timestamptz)`, coveredFrom: checkpoint?.coveredFrom ?? from, lastRunAt: now, lastError: null } })
  return { imported, duplicates }
}

async function recordFailure(db: Db, integrationId: string, kind: string, now: Date): Promise<void> {
  await db.insert(reconcileCheckpoints)
    .values({ integrationId, lastRunAt: now, lastError: kind })
    .onConflictDoUpdate({ target: reconcileCheckpoints.integrationId, set: { lastRunAt: now, lastError: kind } })
}

export async function reconcileSepay(db: Db, deps: ReconcileDeps): Promise<ReconcileSummary> {
  const match = deps.match ?? matchTransaction
  const summary: ReconcileSummary = { rematched: 0, imported: 0, duplicates: 0, integrations: [] }
  summary.rematched = await rematchPending(db, deps.now(), match)

  const integrations = await db
    .select({ id: sepayIntegrations.id, orgId: sepayIntegrations.orgId, environment: sepayIntegrations.environment })
    .from(sepayIntegrations)
    .where(and(inArray(sepayIntegrations.status, ['TESTING', 'ACTIVE']), isNotNull(sepayIntegrations.encryptedApiToken)))

  for (const integration of integrations) {
    try {
      const counts = await withPaymentJobLease(db, `reconcile:${integration.id}`, () => reconcileIntegration(db, deps, match, integration))
      if (!counts) continue
      summary.imported += counts.imported
      summary.duplicates += counts.duplicates
      summary.integrations.push({ id: integration.id, ok: true })
    }
    catch (err) {
      const kind = err instanceof SepayApiError ? err.kind : 'UNEXPECTED'
      if (err instanceof SepayApiError && err.kind === 'RATE_LIMITED') await deps.sleep(Math.min(30, Math.max(1, err.retryAfterSec ?? 1)) * 1000)
      logger.error('reconcile.integration_failed', { integrationId: integration.id, kind })
      await recordFailure(db, integration.id, kind, deps.now())
      summary.integrations.push({ id: integration.id, ok: false, error: kind })
    }
  }
  return summary
}
