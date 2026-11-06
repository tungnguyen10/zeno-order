import { sql } from 'drizzle-orm'
import { closeDb, getDb } from '../server/db/client'
import { attestBranch } from './lib/branch-attestation.mjs'

// Schema-only branches contain no production rows, including migration history.
// Rebuild only app schemas on an attested ephemeral Actions branch; preserve Neon Auth.
try {
  const branch = process.env.CI_BRANCH
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.ZENO_TEST_DB !== '1' || !branch || !/^ci-\d+-[a-z0-9-]+$/.test(branch) || process.env.NEON_BRANCH !== branch) throw new Error('CI-only schema reset refused')
  attestBranch(branch, process.env.DATABASE_URL)
  await getDb().execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public`)
  console.log('Rebuilt empty app schemas on attested CI branch')
}
catch { console.error('CI schema reset refused or failed'); process.exitCode = 1 }
finally { await closeDb() }
