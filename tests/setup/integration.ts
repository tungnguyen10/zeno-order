import { existsSync } from 'node:fs'

if (existsSync('.env.test')) process.loadEnvFile('.env.test')

if (process.env.ZENO_TEST_DB !== '1' || process.env.NEON_BRANCH === 'production') {
  throw new Error('Integration/API tests need .env.test (ZENO_TEST_DB=1) pointing at a non-production Neon branch')
}
