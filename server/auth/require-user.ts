import { getHeader, type H3Event } from 'h3'
import { AppError } from '../utils/errors'
import { getJwtVerifier, type VerifiedUser } from './jwt'

const BEARER = /^Bearer\s+(\S+)$/i

export async function requireUser(event: H3Event): Promise<VerifiedUser> {
  if (event.context.user) return event.context.user
  const match = getHeader(event, 'authorization')?.match(BEARER)
  if (!match?.[1]) throw new AppError('UNAUTHENTICATED', 'Bạn cần đăng nhập')
  const user = await getJwtVerifier()(match[1])
  event.context.user = user
  return user
}
