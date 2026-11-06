import { describe, expect, it } from 'vitest'
import { createSepayHttpClient, formatSepayDate, sepayApiBaseUrl, SepayApiError } from '../../../server/services/payments/sepay-client'

const item = (over: Record<string, unknown> = {}) => ({
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  transaction_date: '2026-03-18T09:00:00+07:00',
  account_number: '19028745631',
  va: null,
  amount_in: 500000,
  amount_out: 0,
  accumulated: 1500000,
  transaction_content: 'ZO1A2B3C4D chuyen tien',
  reference_number: 'FT26069ABC',
  code: 'ZO1A2B3C4D',
  bank_brand_name: 'ACB',
  transfer_type: 'in',
  ...over,
})

function page(data: unknown[], hasMore = false, current = 1) {
  return { status: 'success', data, meta: { pagination: { total: data.length, per_page: 100, current_page: current, last_page: current, has_more: hasMore } } }
}

function fakeFetch(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: URL, init: RequestInit }[] = []
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push({ url, init: init ?? {} })
    return handler(url, init ?? {})
  }) as typeof fetch
  return { impl, calls }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

const WINDOW = { accountNumber: '19028745631', from: new Date('2026-11-01T02:00:00.000Z'), to: new Date('2026-11-01T03:00:00.000Z') }

describe('formatSepayDate', () => {
  it('formats in Vietnam time (UTC+7) as YYYY-MM-DD HH:mm:ss', () => {
    expect(formatSepayDate(new Date('2026-11-01T02:00:00.000Z'))).toBe('2026-11-01 09:00:00')
    expect(formatSepayDate(new Date('2026-11-01T18:30:05.000Z'))).toBe('2026-11-02 01:30:05')
  })
})

describe('sepayApiBaseUrl', () => {
  it('sends Test-mode integrations to the sandbox host (their tokens only work there)', () => {
    expect(sepayApiBaseUrl('live')).toBe('https://userapi.sepay.vn')
    expect(sepayApiBaseUrl('test')).toBe('https://userapi-sandbox.sepay.vn')
  })
})

describe('createSepayHttpClient', () => {
  it('requests incoming transactions of the window, oldest first, with the documented parameters', async () => {
    const { impl, calls } = fakeFetch(() => json(page([item()])))
    const client = createSepayHttpClient('tok-123', { fetchImpl: impl })
    await client.list(WINDOW)

    const { url, init } = calls[0]!
    expect(url.origin + url.pathname).toBe('https://userapi.sepay.vn/v2/transactions')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      transaction_date_from: '2026-11-01 09:00:00',
      transaction_date_to: '2026-11-01 10:00:00',
      transfer_type: 'in',
      transaction_date_sort: 'asc',
      per_page: '100',
      page: '1',
      timestamp_format: 'iso8601',
    })
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok-123')
  })

  it('maps rows, keeps the raw row, and returns the next page cursor while has_more', async () => {
    const { impl } = fakeFetch(() => json(page([item()], true, 2)))
    const result = await createSepayHttpClient('t', { fetchImpl: impl }).list({ ...WINDOW, cursor: '2' })
    expect(result.nextCursor).toBe('3')
    expect(result.items[0]).toMatchObject({
      id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      accountNumber: '19028745631',
      va: null,
      amountIn: 500000,
      referenceNumber: 'FT26069ABC',
      code: 'ZO1A2B3C4D',
      transferType: 'in',
    })
    expect(result.items[0]!.transactionDate.toISOString()).toBe('2026-03-18T02:00:00.000Z')
    expect(result.items[0]!.raw).toMatchObject({ bank_brand_name: 'ACB' })
  })

  it('returns nextCursor null on the last page', async () => {
    const { impl } = fakeFetch(() => json(page([item()], false)))
    expect((await createSepayHttpClient('t', { fetchImpl: impl }).list(WINDOW)).nextCursor).toBeNull()
  })

  it('keeps only rows of the requested account (account_number or VA) and tolerates plain-format dates', async () => {
    const rows = [
      item({ id: '11111111-1111-4111-8111-111111111111' }),
      item({ id: '22222222-2222-4222-8222-222222222222', account_number: 'OTHER' }),
      item({ id: '33333333-3333-4333-8333-333333333333', account_number: 'MAIN', va: '19028745631', transaction_date: '2026-03-18 09:00:00' }),
    ]
    const { impl } = fakeFetch(() => json(page(rows)))
    const { items } = await createSepayHttpClient('t', { fetchImpl: impl }).list(WINDOW)
    expect(items.map(i => i.id)).toEqual(['11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333'])
    expect(items[1]!.transactionDate.toISOString()).toBe('2026-03-18T02:00:00.000Z')
  })

  it.each([
    [401, 'UNAUTHORIZED'],
    [429, 'RATE_LIMITED'],
    [500, 'UNAVAILABLE'],
    [503, 'UNAVAILABLE'],
    [418, 'BAD_RESPONSE'],
  ] as const)('maps HTTP %i to %s', async (status, kind) => {
    const { impl } = fakeFetch(() => json({ status: 'error' }, status, { 'retry-after': '2' }))
    await expect(createSepayHttpClient('t', { fetchImpl: impl }).list(WINDOW)).rejects.toMatchObject({ kind })
  })

  it('exposes Retry-After on 429', async () => {
    const { impl } = fakeFetch(() => json({}, 429, { 'retry-after': '2' }))
    await expect(createSepayHttpClient('t', { fetchImpl: impl }).list(WINDOW)).rejects.toMatchObject({ retryAfterSec: 2 })
  })

  it('maps network failures and malformed bodies', async () => {
    const down = createSepayHttpClient('t', { fetchImpl: (async () => { throw new TypeError('fetch failed') }) as typeof fetch })
    await expect(down.list(WINDOW)).rejects.toMatchObject({ kind: 'UNAVAILABLE' })
    const garbage = fakeFetch(() => json({ nope: true }))
    await expect(createSepayHttpClient('t', { fetchImpl: garbage.impl }).list(WINDOW)).rejects.toBeInstanceOf(SepayApiError)
  })

  it('never puts the token in an error message', async () => {
    const { impl } = fakeFetch(() => json({}, 401))
    const err = await createSepayHttpClient('super-secret-token', { fetchImpl: impl }).list(WINDOW).catch((e: Error) => e)
    expect((err as Error).message).not.toContain('super-secret-token')
  })
})
