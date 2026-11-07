import { randomUUID, createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { Client } from '@neondatabase/serverless'
import { attestBranch, neon } from './lib/branch-attestation.mjs'
import { compareRestore } from './lib/restore-compare.mjs'

async function fingerprint(url: string): Promise<Record<string, string>> {
  const client = new Client(url)
  try {
    await client.connect()
    await client.query('begin isolation level repeatable read read only')
    const { rows } = await client.query<{ schema: string, name: string }>(`select schemaname as schema, tablename as name from pg_tables where schemaname in ('public', 'drizzle') order by 1,2`)
    const out: Record<string, string> = {}
    for (const row of rows) {
      // Catalog-owned identifiers are quoted, never interpolated user arguments.
      const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"'
      const result = await client.query(`select row_to_json(t)::text as data from ${quote(row.schema)}.${quote(row.name)} t`)
      const digest = createHash('sha256')
      for (const value of result.rows.map(row => row.data as string).sort()) digest.update(value).update('\n')
      out[`${row.schema}.${row.name}`] = digest.digest('hex')
    }
    await client.query('commit')
    return out
  }
  finally { await client.end() }
}

const source = process.argv[2]
const stamp = randomUUID().slice(0, 8)
const restoredName = `restore-drill-${stamp}`
let snapshotId: string | undefined
let createdRestore = false
let failed = false
try {
  // Always use a dedicated, quiescent rehearsal branch. Never operate on production here.
  if (!source?.startsWith('restore-source-') || !/^[a-z0-9-]+$/.test(source)) throw new Error('Dedicated rehearsal source required')
  if (!process.argv.includes('--execute')) console.log('Dry run: attest rehearsal branch → fingerprint → snapshot → restore without finalize → compare → delete rehearsal resources')
  else {
    if (process.env.ZENO_RESTORE_DRILL !== '1') throw new Error('Explicit drill opt-in required')
    const env = attestBranch(source)
    const before = await fingerprint(env.DATABASE_URL!)
    const created = neon(['snapshots', 'create', '--branch', source, '--name', `drill-${stamp}`, '--expires-at', new Date(Date.now() + 2 * 3_600_000).toISOString()])
    snapshotId = created.snapshot?.id ?? created.id
    if (!snapshotId) throw new Error('Snapshot identifier missing')
    createdRestore = true
    neon(['snapshots', 'restore', snapshotId, '--name', restoredName])
    const restoredEnv = attestBranch(restoredName)
    const after = await fingerprint(env.DATABASE_URL!)
    const restored = await fingerprint(restoredEnv.DATABASE_URL!)
    const problems = [...compareRestore(before, after), ...compareRestore(before, restored)]
    mkdirSync('test-results', { recursive: true })
    writeFileSync(`test-results/restore-drill-${stamp}.json`, JSON.stringify({ ok: !problems.length, problems, tables: Object.keys(before).length }, null, 2))
    if (problems.length) throw new Error('Restore comparison failed or source was not quiescent')
    console.log('DRILL OK: app data and migration fingerprints match; Neon Auth/storage/files require separate verification')
  }
}
catch { failed = true; console.error('Restore drill refused or failed; no production restore/finalize is supported by this script') }
finally {
  // Cleanup only our exact generated names. Never follow an untrusted provider-returned branch name.
  if (createdRestore) { try { neon(['branches', 'delete', restoredName]) } catch { failed = true; console.error('Rehearsal branch cleanup requires attention') } }
  if (snapshotId) { try { neon(['snapshots', 'delete', snapshotId]) } catch { failed = true; console.error('Rehearsal snapshot cleanup requires attention') } }
  if (failed) process.exitCode = 1
}
