import { spawnSync } from 'node:child_process'
import { neon, attestBranch } from './lib/branch-attestation.mjs'
import { provisionCiStorage } from './lib/ci-provision.mjs'

try {
  provisionCiStorage(process.env, { attestBranch, neon })
  console.log('Provisioned isolated CI storage; no Auth, Functions or payment triggers deployed')
}
catch (error) {
  console.error('Isolated CI storage provisioning failed; production was not targeted')
  if (error instanceof Error && typeof error.cause?.diagnostic === 'string') console.error(error.cause.diagnostic)
  const inspection = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/inspect-ci-auth.ts'], { encoding: 'utf8', timeout: 120_000 })
  if (inspection.stdout) process.stdout.write(inspection.stdout)
  process.exitCode = 1
}
