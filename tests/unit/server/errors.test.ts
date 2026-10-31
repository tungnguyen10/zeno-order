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

  it('hides unknown errors behind INTERNAL without leaking the message', () => {
    const result = toApiError(new Error('connect ECONNREFUSED ******host/db'))
    expect(result).toEqual({
      status: 500,
      body: { code: 'INTERNAL', message: 'Đã có lỗi xảy ra, vui lòng thử lại' },
    })
  })
})
