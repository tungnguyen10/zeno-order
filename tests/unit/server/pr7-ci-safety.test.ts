import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), close: vi.fn(), attest: vi.fn() }))
vi.mock('../../../server/db/client', () => ({ getDb: () => ({ execute: mocks.execute }), closeDb: mocks.close }))
vi.mock('../../../scripts/lib/branch-attestation.mjs', () => ({ attestBranch: mocks.attest }))
const originalExitCode = process.exitCode
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); process.exitCode = undefined
  vi.stubEnv('GITHUB_ACTIONS', 'true'); vi.stubEnv('ZENO_TEST_DB', '1')
  vi.stubEnv('CI_BRANCH', 'ci-123-safety'); vi.stubEnv('NEON_BRANCH', 'ci-123-safety')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => { process.exitCode = originalExitCode; vi.restoreAllMocks(); vi.unstubAllEnvs() })
it('refuses all schema drops when even one managed Auth table contains data', async () => {
  mocks.execute
    .mockResolvedValueOnce({ rows: [{ tablename: 'session' }, { tablename: 'user' }] })
    .mockResolvedValueOnce({ rows: [{ occupied: false }] })
    .mockResolvedValueOnce({ rows: [{ occupied: true }] })
  await import('../../../scripts/reset-ci-schema')
  expect(mocks.attest).toHaveBeenCalledTimes(1)
  expect(mocks.execute).toHaveBeenCalledTimes(3)
  expect(JSON.stringify(mocks.execute.mock.calls)).not.toContain('drop schema')
  expect(process.exitCode).toBe(1)
  expect(mocks.close).toHaveBeenCalledTimes(1)
})
it('only rebuilds empty CI schemas after endpoint attestation and Auth emptiness checks', async () => {
  mocks.execute
    .mockResolvedValueOnce({ rows: [{ tablename: 'user' }] })
    .mockResolvedValueOnce({ rows: [{ occupied: false }] })
    .mockResolvedValueOnce({ rows: [] })
  await import('../../../scripts/reset-ci-schema')
  expect(mocks.attest).toHaveBeenCalledTimes(1)
  expect(mocks.execute).toHaveBeenCalledTimes(3)
  expect(JSON.stringify(mocks.execute.mock.calls.at(-1))).toContain('drop schema if exists neon_auth')
  expect(process.exitCode).not.toBe(1)
  expect(mocks.close).toHaveBeenCalledTimes(1)
})
