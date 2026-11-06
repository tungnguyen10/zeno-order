import { describe, expect, it } from 'vitest'
import { validateEnv } from '../../../scripts/lib/env-check.mjs'
import { auditFindings } from '../../../scripts/lib/audit-filter.mjs'
import { compareRestore } from '../../../scripts/lib/restore-compare.mjs'
import { runSmoke } from '../../../scripts/lib/smoke.mjs'

const production = { DATABASE_URL: 'postgresql://u:p@ep-prod-pooler.aws.neon.tech/neondb', DATABASE_URL_UNPOOLED: 'postgresql://u:p@ep-prod.aws.neon.tech/neondb', NEON_AUTH_BASE_URL: 'https://prod.neonauth.com/auth', NEON_AUTH_JWKS_URL: 'https://prod.neonauth.com/auth/jwks', APP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'), OPS_STATUS_SECRET: 'p'.repeat(32), APP_BASE_URL: 'https://order.example.com', AWS_ENDPOINT_URL_S3: 'https://s3.example.com', AWS_ACCESS_KEY_ID: 'id', AWS_SECRET_ACCESS_KEY: 'secret', AWS_REGION: 'auto', NEON_BRANCH: 'production', PAYMENT_JOBS_ENABLED: 'false' }
describe('environment separation', () => {
  it('accepts an explicit production env and detects shared resources without exposing values', () => {
    expect(validateEnv({ target: 'production', env: production })).toEqual([])
    const issues = validateEnv({ target: 'production', env: production, other: production })
    expect(issues).toContain('Shared database across environments')
    expect(issues.join()).not.toContain(production.OPS_STATUS_SECRET)
  })
  it('forbids test overrides, mismatched endpoints, and unreviewed proxy trust', () => {
    const issues = validateEnv({ target: 'production', env: { ...production, ZENO_TEST_DB: '1', AUTH_TEST_JWKS: '{}', NEON_BRANCH: 'test', TRUST_FORWARDED_FOR: '1', DATABASE_URL_UNPOOLED: 'postgres://u:p@other/db' } })
    expect(issues).toContain('Production forbids AUTH_TEST_JWKS')
    expect(issues).toContain('Pooled/unpooled database targets differ')
  })
})
describe('audit gate', () => {
  const report = { vulnerabilities: { package: { severity: 'critical', via: [{ source: 123 }] } } }
  it('fails unreviewed and expired vulnerabilities; requires exact advisory and package', () => {
    expect(auditFindings(report)).toHaveLength(1)
    expect(auditFindings(report, [{ id: '123', package: 'package', expires: '2020-01-01', reason: 'test' }])).toHaveLength(2)
    expect(auditFindings(report, [{ id: '123', package: 'package', expires: '2099-01-01', reason: 'reviewed' }])).toEqual([])
  })
})
it('rejects a restore with changed data or a different table inventory', () => {
  expect(compareRestore({ orders: 'hash' }, { orders: 'hash' })).toEqual([])
  expect(compareRestore({ orders: 'hash' }, { orders: 'other' })).toHaveLength(1)
  expect(compareRestore({ orders: 'hash' }, {})).toHaveLength(2)
})
it('smoke only GETs read-only URLs and rejects an unhealthy private status', async () => {
  const calls: string[] = []
  const fetchImpl = async (url: string) => {
    calls.push(url)
    return new Response('', { status: url.endsWith('/status') ? 503 : 200, headers: { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'strict-transport-security': 'max-age=31536000', 'content-security-policy': "frame-ancestors 'none'", 'cache-control': 'no-store' } })
  }
  expect(await runSmoke({ baseUrl: 'https://order.example.com', opsSecret: 'ops', fetchImpl })).toContain('Unexpected status for ops probe')
  expect(calls).toHaveLength(3)
  await expect(runSmoke({ baseUrl: 'http://localhost:3000', fetchImpl })).rejects.toThrow()
})
