import { createLocalJWKSet } from 'jose'
import { describe, expect, it } from 'vitest'
import { createJwtVerifier } from '../../../../server/auth/jwt'
import { TEST_ISSUER, createTestAuth } from '../../../support/auth'

const auth = await createTestAuth()
const verify = createJwtVerifier({ jwks: createLocalJWKSet(JSON.parse(auth.jwksJson)), issuer: TEST_ISSUER })

describe('emailVerified claim', () => {
  it('is true only when the token says so', async () => {
    expect(await verify(await auth.sign({ sub: 'u1', email: 'a@example.com', emailVerified: true }))).toMatchObject({ emailVerified: true })
    expect((await verify(await auth.sign({ sub: 'u2', email: 'a@example.com', emailVerified: false }))).emailVerified).toBeUndefined()
    expect((await verify(await auth.sign({ sub: 'u3', email: 'a@example.com' }))).emailVerified).toBeUndefined()
    expect(await verify(await auth.sign({ sub: 'u4', email: 'a@example.com', email_verified: true }))).toMatchObject({ emailVerified: true })
    expect((await verify(await auth.sign({ sub: 'u5', email: 'a@example.com', email_verified: false }))).emailVerified).toBeUndefined()
  })
})
