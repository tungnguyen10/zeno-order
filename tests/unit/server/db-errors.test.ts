import { describe, expect, it } from 'vitest'
import { getPgError, isUniqueViolation } from '../../../server/db/errors'

const pg = (code: string, constraint?: string) => Object.assign(new Error('pg'), { code, constraint })

describe('getPgError', () => {
  it('reads code/constraint from the error itself', () => {
    expect(getPgError(pg('23505', 'stores_slug_unique'))).toEqual({ code: '23505', constraint: 'stores_slug_unique' })
  })

  it('reads code/constraint from a wrapped cause (DrizzleQueryError)', () => {
    const wrapped = Object.assign(new Error('Failed query'), { cause: pg('23503', 'store_members_store_fk') })
    expect(getPgError(wrapped)).toEqual({ code: '23503', constraint: 'store_members_store_fk' })
  })

  it('returns empty object for non-pg errors', () => {
    expect(getPgError(new Error('x'))).toEqual({})
    expect(getPgError('x')).toEqual({})
  })
})

describe('isUniqueViolation', () => {
  it('matches 23505 and optional constraint', () => {
    expect(isUniqueViolation(pg('23505', 'stores_slug_unique'))).toBe(true)
    expect(isUniqueViolation(pg('23505', 'stores_slug_unique'), 'stores_slug_unique')).toBe(true)
    expect(isUniqueViolation(pg('23505', 'other'), 'stores_slug_unique')).toBe(false)
    expect(isUniqueViolation(pg('23503'))).toBe(false)
  })
})
