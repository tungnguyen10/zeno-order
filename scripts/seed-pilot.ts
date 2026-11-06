import { z } from 'zod'
import { closeDb, getDb } from '../server/db/client'
import { seedCatalog } from '../server/services/catalog/seed'
import { attestBranch } from './lib/branch-attestation.mjs'

// No identities, payment account, verified flags or fabricated paid orders are seeded.
try {
  const branch = process.env.NEON_BRANCH
  const storeId = z.uuid().parse(process.env.SEED_STORE_ID)
  const production = branch === 'production'
  if (!branch || process.env.ZENO_SEED_PILOT !== '1' || (production && !(process.argv.includes('--production') && process.env.ZENO_ALLOW_PROD_SEED === 'YES'))) throw new Error('Seed opt-in missing')
  if (!process.argv.includes('--execute')) {
    console.log('Dry run: seed sample catalog into the explicit existing store after endpoint attestation; no changes made')
  }
  else {
    attestBranch(branch, process.env.DATABASE_URL)
    const result = await seedCatalog(getDb(), storeId)
    console.log(result.created ? 'Created sample catalog' : 'Sample catalog already exists')
  }
}
catch { console.error('Pilot seed refused or failed; verify store, project, branch and explicit flags'); process.exitCode = 1 }
finally { await closeDb() }
