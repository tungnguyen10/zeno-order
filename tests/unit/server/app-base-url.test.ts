import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAppBaseUrl } from '../../../server/utils/env'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getAppBaseUrl', () => {
  it('returns APP_BASE_URL without a trailing slash', () => {
    vi.stubEnv('APP_BASE_URL', 'https://zeno.vn//')
    expect(getAppBaseUrl()).toBe('https://zeno.vn')
  })

  it('falls back to localhost when unset or empty', () => {
    vi.stubEnv('APP_BASE_URL', '')
    expect(getAppBaseUrl()).toBe('http://localhost:3000')
  })
})
