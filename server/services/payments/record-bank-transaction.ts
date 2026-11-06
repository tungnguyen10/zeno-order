import { and, asc, eq, ne, sql } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { bankTransactionEvents, bankTransactionIdentities, bankTransactions } from '../../db/schema'
import { AppError } from '../../utils/errors'
import { lockOrgPayments } from './payment-lock'
import type { BankTransactionInput, RecordResult } from './types'

/** Cross-source merging is opt-in per integration, after comparing real provider payloads. */
function canMerge(integrationId: string): boolean {
  return (process.env.SEPAY_VERIFIED_DEDUPE_INTEGRATIONS ?? '').split(',').includes(integrationId)
}

export async function recordBankTransaction(db: Db, input: BankTransactionInput): Promise<RecordResult> {
  if (!Number.isSafeInteger(input.amountVnd) || input.amountVnd <= 0) throw new AppError('VALIDATION_FAILED', 'Số tiền không hợp lệ')
  return db.transaction(async (tx) => {
    await lockOrgPayments(tx, input.orgId)
    const [same] = await tx.select({ id: bankTransactions.id, status: bankTransactions.reconciliationStatus })
      .from(bankTransactionIdentities).innerJoin(bankTransactions, eq(bankTransactions.id, bankTransactionIdentities.transactionId))
      .where(and(eq(bankTransactionIdentities.orgId, input.orgId), eq(bankTransactionIdentities.integrationId, input.integrationId),
        eq(bankTransactionIdentities.source, input.source), eq(bankTransactionIdentities.providerId, input.providerTransactionId)))
    if (same) return { ...same, created: false }

    // No amount/time fuzzy matching. Even verified references need identical bank, VA and instant,
    // and exactly one eligible row. Ambiguous candidates are preserved as separate money.
    const twins = canMerge(input.integrationId) && input.referenceCode && input.bankCode
      ? await tx.select().from(bankTransactions).where(and(
        eq(bankTransactions.orgId, input.orgId), eq(bankTransactions.integrationId, input.integrationId),
        ne(bankTransactions.source, input.source), eq(bankTransactions.bankCode, input.bankCode),
        eq(bankTransactions.bankAccountNumber, input.bankAccountNumber),
        sql`${bankTransactions.subAccount} is not distinct from ${input.subAccount}`,
        eq(bankTransactions.amountVnd, input.amountVnd), eq(bankTransactions.direction, input.direction),
        eq(bankTransactions.referenceCode, input.referenceCode), eq(bankTransactions.transactionDate, input.transactionDate),
        sql`not exists (select 1 from bank_transaction_identities i where i.transaction_id = ${bankTransactions.id} and i.source = ${input.source})`,
      )).orderBy(asc(bankTransactions.id)).limit(2)
      : []
    const twin = twins.length === 1 ? twins[0] : undefined
    let result: RecordResult
    if (twin) {
      await tx.update(bankTransactions).set({ providerAltIds: sql`array_append(${bankTransactions.providerAltIds}, ${input.providerTransactionId})` }).where(eq(bankTransactions.id, twin.id))
      result = { id: twin.id, status: twin.reconciliationStatus, created: false }
    }
    else {
      const status = input.direction === 'OUT' ? 'IGNORED' : 'RECEIVED'
      const [row] = await tx.insert(bankTransactions).values({
        orgId: input.orgId, integrationId: input.integrationId, bankCode: input.bankCode,
        // Source prefix separates the integer/UUID namespaces at the legacy unique constraint too.
        providerTransactionId: `${input.source}:${input.providerTransactionId}`, source: input.source,
        direction: input.direction, bankAccountNumber: input.bankAccountNumber, subAccount: input.subAccount,
        amountVnd: input.amountVnd, paymentCode: input.paymentCode, content: input.content,
        referenceCode: input.referenceCode, transactionDate: input.transactionDate, rawPayloadJson: input.rawPayload,
        reconciliationStatus: status,
      }).returning({ id: bankTransactions.id })
      result = { id: row!.id, status, created: true }
    }
    await tx.insert(bankTransactionIdentities).values({ orgId: input.orgId, integrationId: input.integrationId,
      source: input.source, providerId: input.providerTransactionId, transactionId: result.id })
    await tx.insert(bankTransactionEvents).values({ orgId: input.orgId, bankTransactionId: result.id,
      action: twin ? 'ALIAS_ADDED' : result.status === 'IGNORED' ? 'IGNORED' : 'RECEIVED',
      toStatus: result.status, metadata: { source: input.source } })
    return result
  })
}
