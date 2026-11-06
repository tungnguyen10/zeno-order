import { timingSafeEqual } from 'node:crypto'
import { getHeader, type H3Event } from 'h3'
import { AppError } from './errors'

export function requireOps(event: H3Event): void {
  const secret = process.env.OPS_STATUS_SECRET
  const value = getHeader(event, 'authorization') ?? ''
  if (!secret || secret.length < 32) throw new AppError('SERVICE_UNAVAILABLE', 'Giám sát chưa được cấu hình')
  const expected = Buffer.from(`Bearer ${secret}`)
  const actual = Buffer.from(value)
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new AppError('UNAUTHENTICATED', 'Không xác thực được')
}
