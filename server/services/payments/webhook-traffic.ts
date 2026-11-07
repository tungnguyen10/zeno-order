import { createHash } from 'node:crypto'
import { RATE_POLICIES } from '../../utils/rate-limit-policies'
import type { Db } from '../../db/client'
import { consumeRateLimit } from '../ordering/rate-limit'

export interface RateOptions { limit: number, windowSec: number }

const TRAFFIC: RateOptions = RATE_POLICIES.webhook
const FAILURES: RateOptions = RATE_POLICIES.webhookFailure

export function allowWebhookTraffic(db: Db, ip: string, options: RateOptions = TRAFFIC): Promise<boolean> {
  return consumeRateLimit(db, `webhook:${createHash('sha256').update(ip).digest('hex')}`, options)
}

export function allowWebhookFailure(db: Db, ip: string, options: RateOptions = FAILURES): Promise<boolean> {
  return consumeRateLimit(db, `webhook-fail:${createHash('sha256').update(ip).digest('hex')}`, options)
}
