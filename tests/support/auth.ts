import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { TEST_JWT_ISSUER } from '../../server/auth/jwt'

export const TEST_ISSUER = TEST_JWT_ISSUER

export async function createTestAuth() {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' })
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'EdDSA', use: 'sig' }
  const jwksJson = JSON.stringify({ keys: [jwk] })

  async function sign(claims: { sub: string, email?: string, name?: string, expiresIn?: string, issuer?: string }) {
    const builder = new SignJWT({ email: claims.email, name: claims.name })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'test-key' })
      .setIssuer(claims.issuer ?? TEST_ISSUER)
      .setIssuedAt()
      .setExpirationTime(claims.expiresIn ?? '10m')
    if (claims.sub) builder.setSubject(claims.sub)
    return builder.sign(privateKey)
  }

  return { jwksJson, sign }
}
