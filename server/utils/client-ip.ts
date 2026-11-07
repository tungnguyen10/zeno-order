import { isIP } from 'node:net'
import { getHeader, getRequestIP, type H3Event } from 'h3'

/** Forwarded headers are trustworthy only behind an ingress that OVERWRITES them. */
export function clientIp(event: H3Event): string {
  const forwarded = process.env.VERCEL === '1'
    ? getHeader(event, 'x-vercel-forwarded-for')
    : process.env.TRUST_FORWARDED_FOR === '1' ? getHeader(event, 'x-forwarded-for') : undefined
  const candidate = forwarded?.split(',')[0]?.trim()
  if (candidate && isIP(candidate)) return candidate
  return getRequestIP(event, { xForwardedFor: false }) ?? 'unknown'
}
