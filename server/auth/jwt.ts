import { createLocalJWKSet, createRemoteJWKSet, errors, jwtVerify, type JSONWebKeySet, type JWTVerifyGetKey } from 'jose'
import { AppError } from '../utils/errors'
import { requireEnv } from '../utils/env'

export interface VerifiedUser {
  userId: string
  email: string | null
  name: string | null
  emailVerified?: boolean
}

export type JwtVerifier = (token: string) => Promise<VerifiedUser>

export const TEST_JWT_ISSUER = 'zeno-test'

export function createJwtVerifier(config: { jwks: JWTVerifyGetKey, issuer: string }): JwtVerifier {
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, config.jwks, {
        issuer: config.issuer,
        algorithms: ['EdDSA', 'Ed25519'],
      })
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw new errors.JWTClaimValidationFailed('missing "sub" claim', payload, 'sub', 'missing')
      }
      return {
        userId: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : null,
        name: typeof payload.name === 'string' ? payload.name : null,
        ...(payload.emailVerified === true || payload.email_verified === true ? { emailVerified: true } : {}),
      }
    }
    catch (err) {
      throw toAuthError(err)
    }
  }
}

// JWKS outages must surface as 503 (and get logged), not masquerade as an expired session.
function toAuthError(err: unknown): AppError {
  const jwksUnavailable = err instanceof errors.JWKSTimeout || err instanceof errors.JWKSInvalid
  if (jwksUnavailable || !(err instanceof errors.JOSEError)) {
    return new AppError('SERVICE_UNAVAILABLE', 'Không xác thực được phiên đăng nhập, vui lòng thử lại', undefined, { cause: err })
  }
  return new AppError('UNAUTHENTICATED', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn', undefined, { cause: err })
}

let cached: JwtVerifier | undefined

export function getJwtVerifier(): JwtVerifier {
  if (cached) return cached
  const testJwks = process.env.AUTH_TEST_JWKS
  if (testJwks) {
    if (process.env.VERCEL_ENV === 'production') {
      throw new Error('AUTH_TEST_JWKS must not be set in production')
    }
    cached = createJwtVerifier({
      jwks: createLocalJWKSet(JSON.parse(testJwks) as JSONWebKeySet),
      issuer: TEST_JWT_ISSUER,
    })
    return cached
  }
  const jwksUrl = requireEnv('NEON_AUTH_JWKS_URL')
  const issuer = new URL(requireEnv('NEON_AUTH_BASE_URL')).origin
  cached = createJwtVerifier({ jwks: createRemoteJWKSet(new URL(jwksUrl)), issuer })
  return cached
}

export function resetJwtVerifierForTests(): void {
  cached = undefined
}
