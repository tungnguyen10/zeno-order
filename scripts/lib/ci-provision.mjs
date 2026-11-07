/** Fail closed before invoking the provider; no SQL privilege mutations or Auth enable calls. */
export function provisionCiStorage(env, { attestBranch, neon }) {
  const branch = env.CI_BRANCH
  if (env.GITHUB_ACTIONS !== 'true' || env.ZENO_TEST_DB !== '1'
    || !/^\d+$/.test(env.GITHUB_RUN_ID ?? '')
    || !branch?.startsWith(`ci-${env.GITHUB_RUN_ID}-`)
    || !/^ci-\d+-[a-z0-9-]+$/.test(branch)
    || env.NEON_BRANCH !== branch || !env.DATABASE_URL) throw new Error('CI scope required')
  attestBranch(branch, env.DATABASE_URL)
  neon(['deploy', '--config', 'neon.ci.ts', '--branch', branch, '--no-env-pull'], false)
}
