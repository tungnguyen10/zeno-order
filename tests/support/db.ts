import { sql } from 'drizzle-orm'
import { getDb } from '../../server/db/client'

export async function resetDb(): Promise<void> {
  const db = getDb()
  const { rows } = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  )
  if (rows.length === 0) return
  const list = rows.map(row => `"public"."${row.tablename}"`).join(', ')
  await db.execute(sql.raw(`truncate table ${list} restart identity cascade`))
}
