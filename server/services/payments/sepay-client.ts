import { normalizeBank } from './bank-identity'
import { z } from 'zod'
import { parseSepayTransactionDate } from './sepay-payload'

export interface SepayApiTransaction {
  id: string
  bankCode?: string | null
  accountNumber: string
  va: string | null
  amountIn: number
  amountOut: number
  content: string | null
  referenceNumber: string | null
  code: string | null
  transactionDate: Date
  transferType: 'in' | 'out'
  raw: unknown
}

export interface SepayTransactionsClient {
  list(args: { accountNumber: string, from: Date, to: Date, cursor?: string }): Promise<{ items: SepayApiTransaction[], nextCursor: string | null }>
}

export type SepayApiErrorKind = 'UNAUTHORIZED' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'BAD_RESPONSE' | 'TOO_MANY_PAGES'

export class SepayApiError extends Error {
  constructor(public readonly kind: SepayApiErrorKind, public readonly retryAfterSec?: number) {
    super(`SePay API ${kind}`)
    this.name = 'SepayApiError'
  }
}

export const SEPAY_API_BASE_URL = 'https://userapi.sepay.vn'
export const SEPAY_SANDBOX_API_BASE_URL = 'https://userapi-sandbox.sepay.vn'
// Docs show the scheme masked; Bearer is expected and confirmed by gate G2 (Task 0).
export const AUTH_SCHEME = 'Bearer'
const PAGE_SIZE = 100
const REQUEST_TIMEOUT_MS = 15_000

export function sepayApiBaseUrl(environment: 'test' | 'live'): string {
  return environment === 'test' ? SEPAY_SANDBOX_API_BASE_URL : SEPAY_API_BASE_URL
}

export function formatSepayDate(date: Date): string {
  return new Date(date.getTime() + 7 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ')
}

function parseApiDate(value: string): Date {
  const date = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? parseSepayTransactionDate(value) : new Date(value)
  if (Number.isNaN(date.getTime())) throw new SepayApiError('BAD_RESPONSE')
  return date
}

const rowSchema = z.looseObject({
  id: z.uuid(),
  bank_brand_name: z.string().nullish(),
  transaction_date: z.string(),
  account_number: z.string(),
  va: z.string().nullish(),
  amount_in: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  amount_out: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  transaction_content: z.string().nullish(),
  reference_number: z.string().nullish(),
  code: z.string().nullish(),
  transfer_type: z.enum(['in', 'out']),
})

const pageSchema = z.object({
  data: z.array(rowSchema),
  meta: z.object({ pagination: z.object({ has_more: z.boolean(), current_page: z.number().int() }) }),
})

export function createSepayHttpClient(
  apiToken: string,
  opts: { baseUrl?: string, fetchImpl?: typeof fetch } = {},
): SepayTransactionsClient {
  const baseUrl = opts.baseUrl ?? SEPAY_API_BASE_URL
  const fetchImpl = opts.fetchImpl ?? fetch

  return {
    async list({ accountNumber, from, to, cursor }) {
      const page = cursor ? Number(cursor) : 1
      const url = new URL('/v2/transactions', baseUrl)
      url.search = new URLSearchParams({
        transaction_date_from: formatSepayDate(from),
        transaction_date_to: formatSepayDate(to),
        transfer_type: 'in',
        transaction_date_sort: 'asc',
        per_page: String(PAGE_SIZE),
        page: String(page),
        timestamp_format: 'iso8601',
      }).toString()

      let res: Response
      try {
        res = await fetchImpl(url, {
          headers: { authorization: `${AUTH_SCHEME} ${apiToken}`, 'content-type': 'application/json' },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
      }
      catch {
        throw new SepayApiError('UNAVAILABLE')
      }
      if (res.status === 401) throw new SepayApiError('UNAUTHORIZED')
      if (res.status === 429) throw new SepayApiError('RATE_LIMITED', Number(res.headers.get('retry-after')) || undefined)
      if (res.status >= 500) throw new SepayApiError('UNAVAILABLE')
      if (!res.ok) throw new SepayApiError('BAD_RESPONSE')

      const parsed = pageSchema.safeParse(await res.json().catch(() => null))
      if (!parsed.success) throw new SepayApiError('BAD_RESPONSE')

      const items = parsed.data.data
        .filter(row => accountNumber === '*' || row.account_number === accountNumber || row.va === accountNumber)
        .map((row): SepayApiTransaction => ({
          id: row.id,
          bankCode: normalizeBank(row.bank_brand_name),
          accountNumber: row.account_number,
          va: row.va ?? null,
          amountIn: row.amount_in,
          amountOut: row.amount_out,
          content: row.transaction_content ?? null,
          referenceNumber: row.reference_number ?? null,
          code: row.code ?? null,
          transactionDate: parseApiDate(row.transaction_date),
          transferType: row.transfer_type,
          raw: row,
        }))
      return { items, nextCursor: parsed.data.meta.pagination.has_more ? String(page + 1) : null }
    },
  }
}
