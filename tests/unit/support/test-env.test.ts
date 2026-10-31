import { describe, expect, it } from 'vitest'
import { assertTestDatabase } from '../../support/test-env'

describe('assertTestDatabase', () => {
  it('throws when ZENO_TEST_DB is not 1', () => {
    expect(() => assertTestDatabase({ NEON_BRANCH: 'dev' })).toThrow(/ZENO_TEST_DB/)
    expect(() => assertTestDatabase({ ZENO_TEST_DB: 'true', NEON_BRANCH: 'dev' })).toThrow(/ZENO_TEST_DB/)
  })

  it('throws when NEON_BRANCH is missing or empty', () => {
    expect(() => assertTestDatabase({ ZENO_TEST_DB: '1' })).toThrow(/NEON_BRANCH/)
    expect(() => assertTestDatabase({ ZENO_TEST_DB: '1', NEON_BRANCH: '' })).toThrow(/NEON_BRANCH/)
  })

  it('throws when NEON_BRANCH is production', () => {
    expect(() => assertTestDatabase({ ZENO_TEST_DB: '1', NEON_BRANCH: 'production' })).toThrow(/production/)
  })

  it('passes for a flagged non-production branch', () => {
    expect(() => assertTestDatabase({ ZENO_TEST_DB: '1', NEON_BRANCH: 'test' })).not.toThrow()
  })
})
