import { afterEach, describe, expect, it } from 'vitest'
import { appBaseUrl, inviteRequiresVerifiedEmail } from '../../../server/utils/env'

const saved = { base: process.env.APP_BASE_URL, verified: process.env.INVITE_REQUIRE_VERIFIED_EMAIL }
afterEach(() => {
  if (saved.base === undefined) delete process.env.APP_BASE_URL
  else process.env.APP_BASE_URL = saved.base
  if (saved.verified === undefined) delete process.env.INVITE_REQUIRE_VERIFIED_EMAIL
  else process.env.INVITE_REQUIRE_VERIFIED_EMAIL = saved.verified
})

describe('appBaseUrl', () => {
  it('strips trailing slashes and falls back to localhost', () => {
    process.env.APP_BASE_URL = 'https://zeno.vn///'
    expect(appBaseUrl()).toBe('https://zeno.vn')
    delete process.env.APP_BASE_URL
    expect(appBaseUrl()).toBe('http://localhost:3000')
  })
})

describe('inviteRequiresVerifiedEmail', () => {
  it('is on by default and only the literal "false" turns it off', () => {
    delete process.env.INVITE_REQUIRE_VERIFIED_EMAIL
    expect(inviteRequiresVerifiedEmail()).toBe(true)
    process.env.INVITE_REQUIRE_VERIFIED_EMAIL = 'true'
    expect(inviteRequiresVerifiedEmail()).toBe(true)
    process.env.INVITE_REQUIRE_VERIFIED_EMAIL = '0'
    expect(inviteRequiresVerifiedEmail()).toBe(true)
    process.env.INVITE_REQUIRE_VERIFIED_EMAIL = 'false'
    expect(inviteRequiresVerifiedEmail()).toBe(false)
  })
})
