import { Pool } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
import { requireEnv } from '../utils/env'
import { logger } from '../utils/logger'
import * as schema from './schema'

function createDb(pool: Pool) {
  return drizzle({ client: pool, schema })
}

export type Db = ReturnType<typeof createDb>
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
export type DbOrTx = Db | Tx

let pool: Pool | undefined
let db: Db | undefined

export function getDb(): Db {
  if (!db) {
    pool = new Pool({ connectionString: requireEnv('DATABASE_URL') })
    // Idle-client failures (compute suspend, network drop) emit 'error' on the pool; unhandled it crashes Node.
    pool.on('error', (err: Error) => logger.error('db.pool_error', { err }))
    db = createDb(pool)
  }
  return db
}

export async function closeDb(): Promise<void> {
  const current = pool
  pool = undefined
  db = undefined
  await current?.end()
}
