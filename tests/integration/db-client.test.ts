import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'

afterAll(async () => {
  await getDb().execute(sql`drop table if exists zeno_tx_probe`)
  await closeDb()
})

describe('getDb', () => {
  it('runs a query against the test branch', async () => {
    const result = await getDb().execute<{ ok: number }>(sql`select 1 as ok`)
    expect(result.rows[0]?.ok).toBe(1)
  })

  it('supports interactive transactions with rollback', async () => {
    const db = getDb()
    await db.execute(sql`create table if not exists zeno_tx_probe (v int)`)
    await expect(db.transaction(async (tx) => {
      await tx.execute(sql`insert into zeno_tx_probe values (1)`)
      throw new Error('rollback')
    })).rejects.toThrow('rollback')
    const result = await db.execute<{ n: number }>(sql`select count(*)::int as n from zeno_tx_probe`)
    expect(result.rows[0]?.n).toBe(0)
  })
})
