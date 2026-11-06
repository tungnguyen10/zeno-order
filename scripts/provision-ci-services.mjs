import { spawnSync } from 'node:child_process'
import { neon, attestBranch } from './lib/branch-attestation.mjs'

function bootstrap(mode) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/bootstrap-ci-auth.ts', mode], { encoding: 'utf8', timeout: 120_000 })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.error || result.status !== 0) throw new Error('CI Auth bootstrap failed')
}
let restoreBootstrap = false
let stage = 'attest'
try {
  const branch = process.env.CI_BRANCH
  if (process.env.GITHUB_ACTIONS !== 'true' || !branch || !/^ci-\d+-[a-z0-9-]+$/.test(branch) || process.env.NEON_BRANCH !== branch) throw new Error('CI scope required')
  attestBranch(branch, process.env.DATABASE_URL)
  if (branch.endsWith('-browser')) {
    stage = 'bootstrap-ci-auth'
    restoreBootstrap = true
    bootstrap('grant')
  }
  stage = 'deploy-auth-storage'
  neon(['deploy', '--config', 'neon.ci.ts', '--branch', branch, '--no-env-pull'], false)
  if (!branch.endsWith('-browser')) {
    console.log('Provisioned isolated CI storage; HTTP/API suites use their existing local JWK issuer')
  }
  else {
  const atBranch = ['--branch', branch]
  stage = 'allow-local-origins'
  neon(['neon-auth', 'domain', 'allow-localhost', 'enable', ...atBranch], false)
  neon(['neon-auth', 'domain', 'add', 'http://127.0.0.1:3200', ...atBranch], false)
  neon(['neon-auth', 'domain', 'add', 'http://localhost:3100', ...atBranch], false)
  stage = 'configure-ci-email-auth'
  neon(['neon-auth', 'config', 'email-password', 'update', '--enabled', '--require-email-verification', 'false', '--disable-sign-up', 'false', '--send-verification-email-on-sign-up', 'false', '--send-verification-email-on-sign-in', 'false', ...atBranch], false)
  console.log('Provisioned isolated CI Auth/storage; no Functions or payment triggers deployed')
  }
}
catch (error) {
  console.error(`Isolated CI provisioning failed at ${stage}; production was not targeted`)
  if (error instanceof Error && typeof error.cause?.diagnostic === 'string') console.error(error.cause.diagnostic)
  const inspection = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/inspect-ci-auth.ts'], { encoding: 'utf8', timeout: 120_000 })
  if (inspection.stdout) process.stdout.write(inspection.stdout)
  process.exitCode = 1
}

finally {
  if (restoreBootstrap) {
    try { bootstrap('restore') }
    catch { console.error('CI Auth bootstrap restoration failed; delete the ephemeral branch and inspect before retrying'); process.exitCode = 1 }
  }
}
