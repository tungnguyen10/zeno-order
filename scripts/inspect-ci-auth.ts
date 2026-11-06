import { sql } from 'drizzle-orm'
import { closeDb, getDb } from '../server/db/client'
import { attestBranch } from './lib/branch-attestation.mjs'

try {
  const branch = process.env.CI_BRANCH
  if (process.env.GITHUB_ACTIONS !== 'true' || !branch || !/^ci-\d+-[a-z0-9-]+$/.test(branch) || process.env.NEON_BRANCH !== branch) throw new Error('CI scope required')
  attestBranch(branch, process.env.DATABASE_URL)
  // Privilege metadata only. Never query users, sessions, credentials or connection strings.
  const db = getDb()
  const { rows } = await db.execute(sql`
    select current_user as connected_role, pg_get_userbyid(d.datdba) as database_owner,
      has_database_privilege(current_user, d.datname, 'CONNECT') as connected_can_connect,
      has_database_privilege(current_user, d.datname, 'CREATE') as connected_can_create,
      (select json_agg(json_build_object('role', r.rolname,
        'connect', has_database_privilege(r.oid, d.oid, 'CONNECT'),
        'create', has_database_privilege(r.oid, d.oid, 'CREATE')))
        from pg_roles r where r.rolname like 'neon_auth%') as managed_auth_privileges
    from pg_database d where d.datname = current_database()
  `)
  console.log('CI_AUTH_PRIVILEGE_METADATA ' + JSON.stringify(rows))
}
catch { console.error('Read-only CI Auth privilege inspection failed'); process.exitCode = 1 }
finally { await closeDb() }
