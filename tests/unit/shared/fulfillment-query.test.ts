import { describe, expect, it } from 'vitest'
import { tableTokenFromQuery } from '#shared/fulfillment-query'

describe('tableTokenFromQuery', () => {
  it('preserves a single token and represents repeated or empty query values as invalid', () => {
    expect(tableTokenFromQuery('abc123')).toBe('abc123')
    expect(tableTokenFromQuery(undefined)).toBeUndefined()
    expect(tableTokenFromQuery('')).toBe('')
    expect(tableTokenFromQuery(null)).toBe('')
    expect(tableTokenFromQuery(['one', 'two'])).toBe('')
    expect(tableTokenFromQuery(['one'])).toBe('')
    expect(tableTokenFromQuery([null])).toBe('')
  })
})
