import type { Db } from '../../db/client'
import { consumeRateLimit } from '../ordering/rate-limit'

export interface RateOptions { limit: number, windowSec: number }

const TRAFFIC: RateOptions = { limit: 600, windowSec: 60 }
const FAILURES: RateOptions = { limit: 20, windowSec: 600 }

export function allowWebhookTraffic(db: Db, ip: string, options: RateOptions = TRAFFIC): Promise<boolean> {
  return consumeRateLimit(db, `webhook:${ip}`, options)
}

export function allowWebhookFailure(db: Db, ip: string, options: RateOptions = FAILURES): Promise<boolean> {
  return consumeRateLimit(db, `webhook-fail:${ip}`, options)
}
