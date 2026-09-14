import { describe, expect, it } from 'vitest'

import { parseSupabaseEnvironment } from '../../server/utils/environment'

describe('parseSupabaseEnvironment', () => {
  it('accepts a valid public Supabase URL and publishable key', () => {
    expect(parseSupabaseEnvironment({
      url: 'http://127.0.0.1:54321',
      key: 'sb_publishable_local_test_key_123456',
    })).toEqual({
      url: 'http://127.0.0.1:54321',
      key: 'sb_publishable_local_test_key_123456',
    })
  })

  it.each([
    { url: '', key: 'sb_publishable_local_test_key_123456' },
    { url: 'not-a-url', key: 'sb_publishable_local_test_key_123456' },
    { url: 'http://127.0.0.1:54321', key: 'short' },
    { url: 'http://127.0.0.1:54321', key: 'local-publishable-key' },
  ])('rejects invalid runtime configuration %#', (config) => {
    expect(() => parseSupabaseEnvironment(config)).toThrow('Invalid Supabase runtime configuration')
  })
})
