import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { discoverRoutes } from '../../support/route-inventory'
import { redact } from '../../../server/utils/logger'

it('discovers tenant routes from their actual filesystem handlers', () => {
  const routes = discoverRoutes()
  expect(routes).toContainEqual(expect.objectContaining({ method: 'POST', path: '/api/stores/:storeId/reconciliation/:txId/assign', guard: 'requireStoreOwner' }))
  expect(routes).toContainEqual(expect.objectContaining({ method: 'GET', path: '/api/internal/status', guard: null }))
  expect(routes).toContainEqual(expect.objectContaining({ method: 'PUT', path: '/api/organizations/:orgId/sepay-integrations/:integrationId/secret', guard: 'requireOrgOwner' }))
})
it('also redacts invitation/order page capabilities and query values inside errors', () => {
  for (const path of ['/o/order-secret?t=table-secret', '/invite/invite-secret', '/api/invitations/invite-secret/accept?phone=0912345678']) {
    expect(JSON.stringify(redact(new Error(`Request ${path} failed`)))).not.toMatch(/order-secret|table-secret|invite-secret|0912345678/)
  }
})
it('refuses production restore and production pilot seed without both explicit flags before any DB call', () => {
  const env = { ...process.env, NEON_BRANCH: 'production', ZENO_SEED_PILOT: '1', ZENO_ALLOW_PROD_SEED: '', TSX_TSCONFIG_PATH: '.nuxt/tsconfig.server.json', SEED_STORE_ID: 'f4a82c8c-2329-4f55-9020-1142bd51d4af', DATABASE_URL: '', DATABASE_URL_UNPOOLED: '', NEON_API_KEY: '', NEON_PROJECT_ID: '' }
  const seed = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/seed-pilot.ts', '--execute'], { env, encoding: 'utf8', timeout: 10_000 })
  expect(seed.status).toBe(1); expect(seed.stderr).toContain('Pilot seed refused')
  const restore = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/restore-drill.ts', 'production', '--execute'], { env, encoding: 'utf8', timeout: 10_000 })
  expect(restore.status).toBe(1); expect(restore.stderr).toContain('Restore drill refused')
})
it('keeps production activation opt-in and every go-live checklist row has a concrete verify command', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8')
  expect(ci).toContain('branch_type: schema-only')
  expect(ci).toContain('scripts/reset-ci-schema.ts')
  expect(readFileSync('.github/workflows/ops-watch.yml', 'utf8')).toContain("if: vars.OPS_WATCH_ENABLED == 'true'")
  const checklist = readFileSync('docs/go-live-checklist.md', 'utf8')
  const items = checklist.split('- [ ] ').slice(1)
  expect(items.length).toBeGreaterThan(0)
  for (const item of items) expect(item).toMatch(/Verify:.*`[^`]+`/)
  expect(readFileSync('docs/pilot-report.md', 'utf8')).toContain('NOT RUN')
})
