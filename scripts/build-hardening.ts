import { spawnSync } from 'node:child_process'
import { assertTestDatabase, loadEnvFileOverride } from '../tests/support/test-env'

try {
  // Match fixture/server env deterministically; ambient production variables must not win.
  loadEnvFileOverride('.env.test')
  assertTestDatabase()
  const result = spawnSync(process.execPath, ['node_modules/nuxt/bin/nuxt.mjs', 'build', '--dotenv', '.env.test'], { env: process.env, stdio: 'inherit' })
  if (result.error || result.status !== 0) process.exitCode = 1
}
catch { console.error('Hardening build requires an explicitly flagged non-production test environment'); process.exitCode = 1 }
