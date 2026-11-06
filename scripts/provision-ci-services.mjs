import { neon, attestBranch } from './lib/branch-attestation.mjs'

try {
  const branch = process.env.CI_BRANCH
  if (process.env.GITHUB_ACTIONS !== 'true' || !branch || !/^ci-\d+-[a-z0-9-]+$/.test(branch) || process.env.NEON_BRANCH !== branch) throw new Error('CI scope required')
  attestBranch(branch, process.env.DATABASE_URL)
  neon(['deploy', '--config', 'neon.ci.ts', '--branch', branch, '--no-env-pull'], false)
  const atBranch = ['--branch', branch]
  neon(['neon-auth', 'domain', 'allow-localhost', 'enable', ...atBranch], false)
  neon(['neon-auth', 'domain', 'add', 'http://127.0.0.1:3200', ...atBranch], false)
  neon(['neon-auth', 'domain', 'add', 'http://localhost:3100', ...atBranch], false)
  neon(['neon-auth', 'config', 'email-password', 'update', '--enabled', '--require-email-verification', 'false', '--disable-sign-up', 'false', '--send-verification-email-on-sign-up', 'false', '--send-verification-email-on-sign-in', 'false', ...atBranch], false)
  console.log('Provisioned isolated CI Auth/storage; no Functions or payment triggers deployed')
}
catch { console.error('Isolated CI service provisioning failed; production was not targeted'); process.exitCode = 1 }
