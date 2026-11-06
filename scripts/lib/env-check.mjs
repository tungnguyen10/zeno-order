const REQUIRED = ['DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'NEON_AUTH_BASE_URL', 'NEON_AUTH_JWKS_URL', 'APP_ENCRYPTION_KEY', 'OPS_STATUS_SECRET', 'APP_BASE_URL', 'AWS_ENDPOINT_URL_S3', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION']
const PRIVATE = ['APP_ENCRYPTION_KEY', 'OPS_STATUS_SECRET', 'AWS_SECRET_ACCESS_KEY']
const databaseIdentity = (value) => {
  try { const url = new URL(value); return url.hostname.replace('-pooler.', '.') + url.pathname }
  catch { return null }
}
export function validateEnv({ target, env, other }) {
  const problems = []
  if (!['production', 'preview', 'test'].includes(target)) return ['Invalid environment target']
  for (const key of REQUIRED) if (!env[key]) problems.push(`Missing ${key}`)
  if (Buffer.from(env.APP_ENCRYPTION_KEY || '', 'base64').length !== 32 || Buffer.from(env.APP_ENCRYPTION_KEY || '', 'base64').toString('base64') !== env.APP_ENCRYPTION_KEY) problems.push('Invalid APP_ENCRYPTION_KEY')
  if (env.OPS_STATUS_SECRET && env.OPS_STATUS_SECRET === env.APP_ENCRYPTION_KEY) problems.push('OPS_STATUS_SECRET must differ from APP_ENCRYPTION_KEY')
  if ((env.OPS_STATUS_SECRET || '').length < 32) problems.push('OPS_STATUS_SECRET must be at least 32 characters')
  if (target === 'production') {
    for (const key of ['AUTH_TEST_JWKS', 'ZENO_TEST_DB', 'ZENO_SEED_CATALOG']) if (env[key]) problems.push(`Production forbids ${key}`)
    if (env.NEON_BRANCH !== 'production') problems.push('Production requires explicit NEON_BRANCH=production')
    try { const app = new URL(env.APP_BASE_URL); if (app.protocol !== 'https:' || /^(localhost|127\.|\[::1\])/.test(app.hostname)) problems.push('Production APP_BASE_URL must use public HTTPS') }
    catch { problems.push('Invalid APP_BASE_URL') }
  }
  if (target !== 'production' && (!env.NEON_BRANCH || env.NEON_BRANCH === 'production')) problems.push('Non-production requires its own explicit NEON_BRANCH')
  if (target === 'test' && env.ZENO_TEST_DB !== '1') problems.push('Test requires ZENO_TEST_DB=1')
  if (target === 'preview' && (env.AUTH_TEST_JWKS || env.ZENO_TEST_DB)) problems.push('Preview forbids test authentication overrides')
  if (env.TRUST_FORWARDED_FOR && env.TRUST_FORWARDED_FOR !== '0') problems.push('TRUST_FORWARDED_FOR requires ingress review; leave disabled until verified')
  if (!['true', 'false'].includes(env.PAYMENT_JOBS_ENABLED || '')) problems.push('Set explicit PAYMENT_JOBS_ENABLED=true or false')
  for (const key of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED']) {
    try { const url = new URL(env[key]); if (!['postgres:', 'postgresql:'].includes(url.protocol)) problems.push(`Invalid ${key}`) }
    catch { problems.push(`Invalid ${key}`) }
  }
  if (databaseIdentity(env.DATABASE_URL) !== databaseIdentity(env.DATABASE_URL_UNPOOLED)) problems.push('Pooled/unpooled database targets differ')
  try {
    const auth = new URL(env.NEON_AUTH_BASE_URL); const jwks = new URL(env.NEON_AUTH_JWKS_URL)
    if (auth.protocol !== 'https:' || auth.origin !== jwks.origin || !jwks.pathname.startsWith(auth.pathname.replace(/\/$/, '') + '/')) problems.push('Auth/JWKS endpoint mismatch')
  }
  catch { problems.push('Invalid auth endpoints') }
  if (other) {
    for (const key of PRIVATE) if (env[key] && env[key] === other[key]) problems.push(`Shared ${key} across environments`)
    if (databaseIdentity(env.DATABASE_URL) && databaseIdentity(env.DATABASE_URL) === databaseIdentity(other.DATABASE_URL)) problems.push('Shared database across environments')
    if (env.NEON_AUTH_BASE_URL && env.NEON_AUTH_BASE_URL === other.NEON_AUTH_BASE_URL) problems.push('Shared Neon Auth across environments')
  }
  return problems
}
