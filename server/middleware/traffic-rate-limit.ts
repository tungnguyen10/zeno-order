import { createHash } from 'node:crypto'
import { getDb } from '../db/client'
import { consumeRateLimit } from '../services/ordering/rate-limit'
import { defineApiHandler } from '../utils/api-handler'
import { clientIp } from '../utils/client-ip'
import { AppError } from '../utils/errors'
import { RATE_POLICIES } from '../utils/rate-limit-policies'
import { setResponseHeader } from 'h3'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

export default defineApiHandler(async (event) => {
  if (event.method !== 'GET') return
  const path = event.path.split('?')[0]!
  const tracking = path.match(/^\/api\/public\/orders\/([^/]+)$/i)
  const menu = path.match(/^\/api\/public\/stores\/([^/]+)\/(?:menu|fulfillment)$/i)
  if (!tracking && !menu) return
  const db = getDb()
  const ip = hash(clientIp(event))
  const entries = tracking
    ? [[`tracking-ip:${ip}`, RATE_POLICIES.trackingIp], [`tracking:${hash(tracking[1]!)}`, RATE_POLICIES.tracking]] as const
    : [[`menu:${hash(menu![1]!)}:${ip}`, RATE_POLICIES.menu]] as const
  for (const [key, policy] of entries) {
    if (!(await consumeRateLimit(db, key, policy))) {
      setResponseHeader(event, 'Retry-After', policy.windowSec)
      setResponseHeader(event, 'Cache-Control', 'no-store')
      throw new AppError('RATE_LIMITED', 'Quá nhiều yêu cầu, vui lòng thử lại sau')
    }
  }
})
