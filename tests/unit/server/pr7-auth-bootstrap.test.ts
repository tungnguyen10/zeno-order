import { rmSync } from 'node:fs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ execute: vi.fn(), close: vi.fn(), attest: vi.fn() }))
vi.mock('../../../server/db/client', () => ({ getDb: () => ({ execute: mocks.execute }), closeDb: mocks.close }))
vi.mock('../../../scripts/lib/branch-attestation.mjs', () => ({ attestBranch: mocks.attest }))
const branch = 'ci-123-browser'
const marker = `.cache/ci-auth-bootstrap-${branch}.json`
const originalArgv = process.argv
const originalExitCode = process.exitCode
let allowed = false
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); process.exitCode = undefined
  vi.stubEnv('GITHUB_ACTIONS', 'true'); vi.stubEnv('ZENO_TEST_DB', '1')
  vi.stubEnv('CI_BRANCH', branch); vi.stubEnv('NEON_BRANCH', branch)
  vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'log').mockImplementation(() => {})
  rmSync(marker, { force: true })
  mocks.execute.mockImplementation((query) => {
    const text = JSON.stringify(query)
    if (text.includes('grant create')) { allowed = true; return { rows: [] } }
    if (text.includes('revoke create')) { allowed = false; return { rows: [] } }
    if (text.includes(' as allowed')) return { rows: [{ allowed }] }
    return { rows: [{ database_name: 'neondb', connected_role: 'owner', database_owner: 'owner', auth_connect: true, auth_create: allowed, schema_absent: true }] }
  })
})
afterEach(() => { process.argv = originalArgv; process.exitCode = originalExitCode; rmSync(marker, { force: true }); vi.restoreAllMocks(); vi.unstubAllEnvs() })
async function run(mode: string) {
  process.argv = [process.execPath, 'bootstrap-ci-auth.ts', mode]
  vi.resetModules()
  await import('../../../scripts/bootstrap-ci-auth')
}
it('grants only during CI bootstrap and restores a previously absent CREATE privilege', async () => {
  allowed = false
  await run('grant'); expect(allowed).toBe(true); expect(process.exitCode).not.toBe(1)
  await run('restore'); expect(allowed).toBe(false); expect(process.exitCode).not.toBe(1)
  expect(JSON.stringify(mocks.execute.mock.calls)).not.toMatch(/PUBLIC|grant option|grant all/i)
})
it('preserves an existing CREATE privilege instead of revoking it', async () => {
  allowed = true
  await run('grant'); await run('restore')
  expect(allowed).toBe(true); expect(process.exitCode).not.toBe(1)
  expect(JSON.stringify(mocks.execute.mock.calls)).not.toMatch(/grant create|revoke create/)
})
it('rejects production before reading DB metadata or changing privileges', async () => {
  vi.stubEnv('CI_BRANCH', 'production'); vi.stubEnv('NEON_BRANCH', 'production')
  await run('grant')
  expect(process.exitCode).toBe(1); expect(mocks.attest).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled()
})
