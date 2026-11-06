import { exportJWK, generateKeyPair, importJWK, SignJWT, type JWK } from 'jose'
import { TEST_JWT_ISSUER } from '../../server/auth/jwt'

export interface SharedAuthKeys {
  jwksJson: string
  privateJwk: JWK
}

export async function createSharedAuthKeys(): Promise<SharedAuthKeys> {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true })
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'EdDSA', use: 'sig' }
  return { jwksJson: JSON.stringify({ keys: [jwk] }), privateJwk: await exportJWK(privateKey) }
}

export async function createSharedAuth(keys: SharedAuthKeys) {
  const privateKey = await importJWK(keys.privateJwk, 'EdDSA')

  async function sign(claims: {
    sub: string
    email?: string
    name?: string
    emailVerified?: boolean
    expiresIn?: string
    issuer?: string
  }) {
    const builder = new SignJWT({ email: claims.email, name: claims.name, emailVerified: claims.emailVerified })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'test-key' })
      .setIssuer(claims.issuer ?? TEST_JWT_ISSUER)
      .setIssuedAt()
      .setExpirationTime(claims.expiresIn ?? '10m')
    if (claims.sub) builder.setSubject(claims.sub)
    return builder.sign(privateKey)
  }

  return { jwksJson: keys.jwksJson, sign }
}
