import type { Db } from '../../db/client'
import { getPgError } from '../../db/errors'
import { AppError } from '../../utils/errors'
import { logger } from '../../utils/logger'
import { matchTransaction } from './match-transaction'
import { recordBankTransaction } from './record-bank-transaction'
import { toBankTransactionInput, type SepayWebhookPayload } from './sepay-payload'
import type { MatchOutcome } from './types'

export interface WebhookProcessingInput {
  integration: { id: string, orgId: string }
  payload: SepayWebhookPayload
}

export interface WebhookProcessingDeps {
  match: (db: Db, bankTransactionId: string) => Promise<MatchOutcome>
}

export interface WebhookProcessingResult {
  transactionId: string
  created: boolean
  outcome: MatchOutcome | null
}

// Tx1 persists, Tx2 matches. A duplicate whose first delivery stopped after Tx1 (status RECEIVED) is matched here,
// so a SePay retry heals a half-processed transaction.
export async function processSepayWebhook(
  db: Db,
  input: WebhookProcessingInput,
  deps: WebhookProcessingDeps = { match: matchTransaction },
): Promise<WebhookProcessingResult> {
  const record = await recordBankTransaction(db, toBankTransactionInput(input.integration, input.payload))
  if (record.status !== 'RECEIVED') return { transactionId: record.id, created: record.created, outcome: null }
  const outcome = await deps.match(db, record.id)
  return { transactionId: record.id, created: record.created, outcome }
}

// Drizzle errors embed query params (transfer content, phone numbers); only the error class and pg code are logged.
export async function runWebhookProcessing(
  db: Db,
  input: WebhookProcessingInput,
  deps: WebhookProcessingDeps = { match: matchTransaction },
): Promise<WebhookProcessingResult> {
  let stage: 'record' | 'match' = 'record'
  try {
    const result = await processSepayWebhook(db, input, {
      match: (innerDb, id) => {
        stage = 'match'
        return deps.match(innerDb, id)
      },
    })
    logger.info('webhook.processed', {
      integrationId: input.integration.id,
      transactionId: result.transactionId,
      created: result.created,
      outcome: result.outcome?.kind ?? 'NOT_MATCHED_AGAIN',
      reason: result.outcome?.kind === 'REVIEW' ? result.outcome.reason : undefined,
    })
    return result
  }
  catch (err) {
    logger.error('webhook.processing_failed', {
      integrationId: input.integration.id,
      stage,
      errorName: err instanceof Error ? err.name : 'unknown',
      pgCode: getPgError(err).code,
    })
    throw new AppError('INTERNAL', 'Không xử lý được webhook')
  }
}
