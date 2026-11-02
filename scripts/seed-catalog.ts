import { closeDb, getDb } from '../server/db/client'
import { seedCatalog } from '../server/services/catalog/seed'
import { assertSeedEnvironment } from '../shared/seed-environment'
import { loadEnvFileOverride } from '../tests/support/test-env'

let failed = false

try {
  loadEnvFileOverride(process.env.ENV_FILE ?? '.env.test')
  const storeId = assertSeedEnvironment(process.env)
  const result = await seedCatalog(getDb(), storeId)
  console.info(result.created ? 'Created sample menu' : 'Sample menu already exists; no changes')
}
catch {
  failed = true
}
finally {
  try {
    await closeDb()
  }
  catch {
    failed = true
  }
}

if (failed) {
  console.error('Catalog seed failed; check explicit seed opt-in, branch, store ID and database configuration')
  process.exitCode = 1
}
