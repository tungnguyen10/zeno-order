import { sql } from 'drizzle-orm'
import { getDb } from '../db/client'
import { defineApiHandler } from '../utils/api-handler'
import { AppError } from '../utils/errors'

export default defineApiHandler(async () => {
  try {
    await getDb().execute(sql`select 1`)
  }
  catch (err) {
    throw new AppError('SERVICE_UNAVAILABLE', 'Cơ sở dữ liệu không khả dụng', undefined, { cause: err })
  }
  return { status: 'ok' as const }
})
