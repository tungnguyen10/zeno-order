import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createPublicSupabaseClient } from '../../server/utils/public-supabase-client'

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(() => ({ rpc: vi.fn() })),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
}))

describe('createPublicSupabaseClient', () => {
  beforeEach(() => {
    createClientMock.mockClear()
  })

  it('creates a sessionless client from only the public URL and key', () => {
    createPublicSupabaseClient({
      url: 'http://127.0.0.1:54321',
      key: 'sb_publishable_local_test_key_123456',
    })

    expect(createClientMock).toHaveBeenCalledWith(
      'http://127.0.0.1:54321',
      'sb_publishable_local_test_key_123456',
      {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      },
    )
  })
})
