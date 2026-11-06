import { sql } from 'drizzle-orm'
import { closeDb, getDb } from '../server/db/client'
import { attestBranch } from './lib/branch-attestation.mjs'

// Schema-only branches contain no production rows, including migration history.
// Schema-only clones retain empty neon_auth DDL but no Auth integration.
// Refuse any Auth rows before removing that empty schema for fresh CI-only provisioning.
try {
  const branch = process.env.CI_BRANCH
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.ZENO_TEST_DB !== '1' || !branch || !/^ci-\d+-[a-z0-9-]+$/.test(branch) || process.env.NEON_BRANCH !== branch) throw new Error('CI-only schema reset refused')
  attestBranch(branch, process.env.DATABASE_URL)
  const db = getDb()
  const tables = await db.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'neon_auth'`)
  for (const { tablename } of tables.rows) {
    const quoted = '"' + tablename.replaceAll('"', '""') + '"'
    const result = await db.execute<{ occupied: boolean }>(sql.raw(`select exists(select 1 from neon_auth.${quoted} limit 1) as occupied`))
    if (result.rows[0]?.occupied !== false) throw new Error('Refusing to remove populated managed Auth schema')
  }
  await db.execute(sql`drop schema if exists neon_auth cascade; drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public`)
  console.log('Rebuilt empty app schemas on attested CI branch')
}
catch { console.error('CI schema reset refused or failed'); process.exitCode = 1 }
finally { await closeDb() }
