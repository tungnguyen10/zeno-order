import { sql } from 'drizzle-orm'
import { getDb } from '../db/client'
import { defineApiHandler } from '../utils/api-handler'
import { AppError } from '../utils/errors'
import { logger } from '../utils/logger'

export default defineApiHandler(async (event) => {
  try {
    await getDb().execute(sql`select 1`)
  }
  catch (err) {
    logger.error('health.db_failed', { requestId: event.context.requestId, err })
    throw new AppError('SERVICE_UNAVAILABLE', 'Cơ sở dữ liệu không khả dụng')
  }
  return { status: 'ok' as const }
})
