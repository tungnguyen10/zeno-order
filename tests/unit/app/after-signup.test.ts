import { describe, expect, it } from 'vitest'
import { afterSignUpTarget } from '../../../app/utils/after-signup'

describe('afterSignUpTarget', () => {
  it.each([
    ['/invite/abc123', '/invite/abc123'],
    ['/app/settings', '/onboarding'],
    ['//evil.example.com/invite/x', '/onboarding'],
    ['https://evil.example.com/invite/x', '/onboarding'],
    ['/invite', '/onboarding'],
    [undefined, '/onboarding'],
    [['/invite/a'], '/onboarding'],
  ])('%j → %s', (input, expected) => {
    expect(afterSignUpTarget(input)).toBe(expected)
  })
})
