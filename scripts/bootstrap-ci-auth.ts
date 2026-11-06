import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { closeDb, getDb } from '../server/db/client'
import { attestBranch } from './lib/branch-attestation.mjs'

interface Metadata extends Record<string, unknown> { database_name: string, connected_role: string, database_owner: string, auth_connect: boolean, auth_create: boolean, schema_absent: boolean }
try {
  const branch = process.env.CI_BRANCH
  const mode = process.argv[2]
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.ZENO_TEST_DB !== '1' || !branch || !/^ci-\d+-browser$/.test(branch) || process.env.NEON_BRANCH !== branch || !['grant', 'restore'].includes(mode ?? '')) throw new Error('CI bootstrap scope required')
  attestBranch(branch, process.env.DATABASE_URL)
  const db = getDb()
  const { rows } = await db.execute<Metadata>(sql`
    select current_database() as database_name, current_user as connected_role,
      pg_get_userbyid(d.datdba) as database_owner,
      has_database_privilege('neon_auth', d.datname, 'CONNECT') as auth_connect,
      has_database_privilege('neon_auth', d.datname, 'CREATE') as auth_create,
      to_regnamespace('neon_auth') is null as schema_absent
    from pg_database d where d.datname = current_database()
  `)
  const meta = rows[0]
  if (!meta || meta.connected_role !== meta.database_owner || meta.auth_connect !== true) throw new Error('Owner/managed role prerequisite missing')
  const file = `.cache/ci-auth-bootstrap-${branch}.json`
  if (mode === 'grant') {
    if (meta.schema_absent !== true) throw new Error('Bootstrap requires a fresh empty managed schema')
    mkdirSync('.cache', { recursive: true })
    // Record first, so a later failure can still restore the original privilege.
    writeFileSync(file, JSON.stringify({ branch, database: meta.database_name, originalCreate: meta.auth_create }), { mode: 0o600, flag: 'wx' })
    if (!meta.auth_create) await db.execute(sql`grant create on database ${sql.identifier(meta.database_name)} to neon_auth`)
    console.log('Prepared temporary CREATE for the existing managed Auth role on the attested CI database only')
  }
  else {
    const original: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (!original || typeof original !== 'object' || !('branch' in original) || original.branch !== branch || !('database' in original) || original.database !== meta.database_name || !('originalCreate' in original) || typeof original.originalCreate !== 'boolean') throw new Error('Bootstrap record does not match this CI database')
    if (!original.originalCreate) await db.execute(sql`revoke create on database ${sql.identifier(meta.database_name)} from neon_auth`)
    const check = await db.execute<{ allowed: boolean }>(sql`select has_database_privilege('neon_auth', current_database(), 'CREATE') as allowed`)
    if (check.rows[0]?.allowed !== original.originalCreate) throw new Error('Managed role privilege was not restored')
    rmSync(file)
    console.log('Restored the managed Auth role to its original database CREATE privilege')
  }
}
catch { console.error('CI Auth bootstrap refused or failed; no production bootstrap is supported'); process.exitCode = 1 }
finally { await closeDb() }
