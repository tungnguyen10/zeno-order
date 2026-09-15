import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMerchantSupabaseClient, parseBearerToken } from '../../server/utils/merchant-auth'

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(() => ({ auth: { getUser: vi.fn() } })),
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))

describe('merchant auth boundary', () => {
  beforeEach(() => createClientMock.mockClear())

  it.each([
    ['Bearer signed.jwt.value', 'signed.jwt.value'],
    ['bearer token', null],
    ['Bearer token with spaces', null],
    [undefined, null],
  ])('parses strict bearer credentials', (header, expected) => {
    expect(parseBearerToken(header)).toBe(expected)
  })

  it('forwards the user JWT using only the publishable key', () => {
    createMerchantSupabaseClient({
      url: 'https://project.supabase.co',
      key: 'sb_publishable_browser_key',
      accessToken: 'user.jwt.token',
    })
    expect(createClientMock).toHaveBeenCalledWith(
      'https://project.supabase.co',
      'sb_publishable_browser_key',
      {
        auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
        global: { headers: { Authorization: 'Bearer user.jwt.token' } },
      },
    )
  })
})
