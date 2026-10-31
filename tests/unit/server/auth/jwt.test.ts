import { createLocalJWKSet, SignJWT } from 'jose'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createJwtVerifier, getJwtVerifier, resetJwtVerifierForTests } from '../../../../server/auth/jwt'
import { AppError } from '../../../../server/utils/errors'
import { createTestAuth, TEST_ISSUER } from '../../../support/auth'

let auth: Awaited<ReturnType<typeof createTestAuth>>
let verify: ReturnType<typeof createJwtVerifier>

beforeAll(async () => {
  auth = await createTestAuth()
  verify = createJwtVerifier({ jwks: createLocalJWKSet(JSON.parse(auth.jwksJson)), issuer: TEST_ISSUER })
})

afterEach(() => {
  vi.unstubAllEnvs()
  resetJwtVerifierForTests()
})

async function expectUnauthenticated(promise: Promise<unknown>) {
  await expect(promise).rejects.toBeInstanceOf(AppError)
  await expect(promise).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
}

describe('createJwtVerifier', () => {
  it('returns the user for a valid token', async () => {
    const token = await auth.sign({ sub: 'user-1', email: 'a@example.com', name: 'An' })
    await expect(verify(token)).resolves.toEqual({ userId: 'user-1', email: 'a@example.com', name: 'An' })
  })

  it('returns null email/name when claims are absent', async () => {
    const token = await auth.sign({ sub: 'user-2' })
    await expect(verify(token)).resolves.toEqual({ userId: 'user-2', email: null, name: null })
  })

  it('rejects an expired token', async () => {
    const token = await auth.sign({ sub: 'u', expiresIn: '-1m' })
    await expectUnauthenticated(verify(token))
  })

  it('rejects a token from another issuer', async () => {
    const token = await auth.sign({ sub: 'u', issuer: 'https://evil.example.com' })
    await expectUnauthenticated(verify(token))
  })

  it('rejects a token signed by an unknown key', async () => {
    const other = await createTestAuth()
    await expectUnauthenticated(verify(await other.sign({ sub: 'u' })))
  })

  it('rejects a token without sub', async () => {
    await expectUnauthenticated(verify(await auth.sign({ sub: '' })))
  })

  it('rejects HS256 tokens even with a matching kid', async () => {
    const secret = new TextEncoder().encode('x'.repeat(32))
    const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256', kid: 'test-key' })
      .setSubject('u').setIssuer(TEST_ISSUER).setExpirationTime('5m').sign(secret)
    await expectUnauthenticated(verify(token))
  })

  it('rejects garbage', async () => {
    await expectUnauthenticated(verify('not-a-jwt'))
  })
})

describe('getJwtVerifier', () => {
  it('uses AUTH_TEST_JWKS when provided outside production', async () => {
    vi.stubEnv('AUTH_TEST_JWKS', auth.jwksJson)
    vi.stubEnv('VERCEL_ENV', 'preview')
    const token = await auth.sign({ sub: 'user-3' })
    await expect(getJwtVerifier()(token)).resolves.toMatchObject({ userId: 'user-3' })
  })

  it('refuses AUTH_TEST_JWKS in Vercel production', () => {
    vi.stubEnv('AUTH_TEST_JWKS', auth.jwksJson)
    vi.stubEnv('VERCEL_ENV', 'production')
    expect(() => getJwtVerifier()).toThrow('AUTH_TEST_JWKS must not be set in production')
  })

  it('requires Neon Auth env when no test JWKS', () => {
    vi.stubEnv('AUTH_TEST_JWKS', '')
    vi.stubEnv('NEON_AUTH_JWKS_URL', '')
    expect(() => getJwtVerifier()).toThrow('Missing env NEON_AUTH_JWKS_URL')
  })

  it('builds a remote verifier when Neon Auth env is present', () => {
    vi.stubEnv('AUTH_TEST_JWKS', '')
    vi.stubEnv('NEON_AUTH_JWKS_URL', 'https://auth.example.neon.tech/neondb/auth/.well-known/jwks.json')
    vi.stubEnv('NEON_AUTH_BASE_URL', 'https://auth.example.neon.tech/neondb/auth')
    expect(typeof getJwtVerifier()).toBe('function')
  })

  it('caches the verifier instance', () => {
    vi.stubEnv('AUTH_TEST_JWKS', auth.jwksJson)
    expect(getJwtVerifier()).toBe(getJwtVerifier())
  })
})
