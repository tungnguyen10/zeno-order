import { expect, it } from 'vitest'
import { assertCiAuthScope, selectCiAuthEnv } from '../../../scripts/lib/ci-auth-scope.mjs'
const valid = { GITHUB_ACTIONS: 'true', ZENO_TEST_DB: '1', GITHUB_RUN_ID: '123', CI_BRANCH: 'ci-123-browser', NEON_BRANCH: 'ci-123-browser', CI_TEST_AUTH_BRANCH: 'test' }
it('binds only a run-scoped browser job to the designated non-production Auth', () => {
  expect(assertCiAuthScope(valid)).toEqual({ branch: 'test', prefix: 'e2e+ci123-' })
  expect(() => assertCiAuthScope({ ...valid, CI_TEST_AUTH_BRANCH: 'production' })).toThrow()
  expect(() => assertCiAuthScope({ ...valid, NEON_BRANCH: 'production' })).toThrow()
  expect(() => assertCiAuthScope({ ...valid, GITHUB_RUN_ID: 'other' })).toThrow()
})
it('never exports a shared Auth source database, branch label or server secret', () => {
  expect(selectCiAuthEnv({ NEON_AUTH_BASE_URL: 'https://auth.test.example/neondb/auth', NEON_AUTH_JWKS_URL: 'https://auth.test.example/neondb/auth/jwks', DATABASE_URL: 'must-not-export', NEON_BRANCH: 'test', NEON_AUTH_SECRET: 'must-not-export' })).toEqual({ NEON_AUTH_BASE_URL: 'https://auth.test.example/neondb/auth', NEON_AUTH_JWKS_URL: 'https://auth.test.example/neondb/auth/jwks' })
  expect(() => selectCiAuthEnv({ NEON_AUTH_BASE_URL: 'https://auth.test.example/auth', NEON_AUTH_JWKS_URL: 'https://evil.example/jwks' })).toThrow()
})
