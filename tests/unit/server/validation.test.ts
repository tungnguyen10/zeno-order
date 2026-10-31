import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AppError } from '../../../server/utils/errors'
import { parseWith } from '../../../server/utils/validation'

const schema = z.object({ qty: z.number().int().min(1) })

describe('parseWith', () => {
  it('returns parsed data on success', () => {
    expect(parseWith(schema, { qty: 2 })).toEqual({ qty: 2 })
  })

  it('throws AppError VALIDATION_FAILED with issues on failure', () => {
    try {
      parseWith(schema, { qty: 0 })
      throw new Error('should have thrown')
    }
    catch (err) {
      expect(err).toBeInstanceOf(AppError)
      const appError = err as AppError
      expect(appError.code).toBe('VALIDATION_FAILED')
      expect(appError.details).toEqual([{ path: 'qty', message: expect.any(String) }])
    }
  })
})
