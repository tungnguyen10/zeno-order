export function assertCiAuthScope(env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.ZENO_TEST_DB !== '1' || !/^\d+$/.test(env.GITHUB_RUN_ID || '') || env.CI_BRANCH !== `ci-${env.GITHUB_RUN_ID}-browser` || env.NEON_BRANCH !== env.CI_BRANCH || env.CI_TEST_AUTH_BRANCH !== 'test') throw new Error('Only run-scoped CI with the designated non-production test Auth is supported')
  return { branch: 'test', prefix: `e2e+ci${env.GITHUB_RUN_ID}-` }
}

export function selectCiAuthEnv(env) {
  const base = new URL(env.NEON_AUTH_BASE_URL)
  const jwks = new URL(env.NEON_AUTH_JWKS_URL)
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || jwks.username || jwks.password || jwks.search || jwks.hash || jwks.origin !== base.origin || !jwks.pathname.startsWith(base.pathname.replace(/\/$/, '') + '/')) throw new Error('Invalid test Auth endpoints')
  // Never export the source branch's database, branch label or server secrets.
  return { NEON_AUTH_BASE_URL: base.href.replace(/\/$/, ''), NEON_AUTH_JWKS_URL: jwks.href }
}
