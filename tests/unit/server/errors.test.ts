import { createError } from 'h3'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AppError, toApiError } from '../../../server/utils/errors'

describe('toApiError', () => {
  it('maps AppError to its status and body', () => {
    const result = toApiError(new AppError('SLUG_TAKEN', 'Slug đã được dùng', { field: 'storeSlug' }))
    expect(result).toEqual({
      status: 409,
      body: { code: 'SLUG_TAKEN', message: 'Slug đã được dùng', details: { field: 'storeSlug' } },
    })
  })

  it('omits details when not provided', () => {
    const result = toApiError(new AppError('NOT_FOUND', 'Không tìm thấy'))
    expect(result.status).toBe(404)
    expect(result.body).not.toHaveProperty('details')
  })

  it('maps ZodError to 400 VALIDATION_FAILED with flattened issues', () => {
    const parsed = z.object({ name: z.string() }).safeParse({})
    if (parsed.success) throw new Error('expected failure')
    const result = toApiError(parsed.error)
    expect(result.status).toBe(400)
    expect(result.body.code).toBe('VALIDATION_FAILED')
    expect(result.body.details).toEqual([{ path: 'name', message: expect.any(String) }])
  })

  it('maps h3 400-class errors (malformed JSON) to VALIDATION_FAILED', () => {
    const result = toApiError(createError({ statusCode: 400, statusMessage: 'Bad Request' }))
    expect(result).toEqual({ status: 400, body: { code: 'VALIDATION_FAILED', message: 'Yêu cầu không hợp lệ' } })
  })

  it.each([
    [401, 401, 'UNAUTHENTICATED'],
    [403, 403, 'FORBIDDEN'],
    [404, 404, 'NOT_FOUND'],
    [405, 404, 'NOT_FOUND'],
    [429, 429, 'RATE_LIMITED'],
    [413, 400, 'VALIDATION_FAILED'],
    [415, 400, 'VALIDATION_FAILED'],
  ])('maps h3 %i to %i %s with a generic message', (h3Status, status, code) => {
    const result = toApiError(createError({ statusCode: h3Status, statusMessage: 'raw h3 detail' }))
    expect(result.status).toBe(status)
    expect(result.body.code).toBe(code)
    expect(result.body.message).not.toContain('raw h3 detail')
    expect(result.body).not.toHaveProperty('details')
  })

  it('maps other h3 errors to INTERNAL', () => {
    expect(toApiError(createError({ statusCode: 502 })).body.code).toBe('INTERNAL')
  })

  it('keeps an optional cause on AppError without changing the body', () => {
    const cause = new Error('db down')
    const err = new AppError('SERVICE_UNAVAILABLE', 'Cơ sở dữ liệu không khả dụng', undefined, { cause })
    expect(err.cause).toBe(cause)
    expect(toApiError(err)).toEqual({
      status: 503,
      body: { code: 'SERVICE_UNAVAILABLE', message: 'Cơ sở dữ liệu không khả dụng' },
    })
  })

  it('hides unknown errors behind INTERNAL without leaking the message', () => {
    const result = toApiError(new Error('connect ECONNREFUSED ******host/db'))
    expect(result).toEqual({
      status: 500,
      body: { code: 'INTERNAL', message: 'Đã có lỗi xảy ra, vui lòng thử lại' },
    })
  })
})
