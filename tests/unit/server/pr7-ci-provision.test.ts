import { afterEach, expect, it, vi } from 'vitest'
import { provisionCiStorage } from '../../../scripts/lib/ci-provision.mjs'

const valid = { GITHUB_ACTIONS: 'true', ZENO_TEST_DB: '1', GITHUB_RUN_ID: '123', CI_BRANCH: 'ci-123-browser', NEON_BRANCH: 'ci-123-browser', DATABASE_URL: 'postgres://owner:synthetic@ci.example/neondb' }
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })
it('keeps Auth provisioning disabled even in the browser slot', async () => {
  vi.stubEnv('GITHUB_ACTIONS', 'true')
  vi.stubEnv('CI_BRANCH', valid.CI_BRANCH)
  const { default: config } = await import('../../../neon.ci')
  expect(config.auth).toBe(false)
  expect(config).not.toHaveProperty('functions')
})
it('attests the database before deploying storage with the explicit CI config', () => {
  const order: string[] = []
  const attestBranch = vi.fn(() => { order.push('attest') })
  const neon = vi.fn(() => { order.push('deploy') })
  provisionCiStorage(valid, { attestBranch, neon })
  expect(order).toEqual(['attest', 'deploy'])
  expect(attestBranch).toHaveBeenCalledWith(valid.CI_BRANCH, valid.DATABASE_URL)
  expect(neon).toHaveBeenCalledExactlyOnceWith(['deploy', '--config', 'neon.ci.ts', '--branch', valid.CI_BRANCH, '--no-env-pull'], false)
})
it.each([
  { GITHUB_ACTIONS: 'false' }, { ZENO_TEST_DB: '0' }, { GITHUB_RUN_ID: '124' },
  { CI_BRANCH: 'production', NEON_BRANCH: 'production' }, { NEON_BRANCH: 'test' }, { DATABASE_URL: '' },
])('refuses invalid scope before any provider call: %j', (override) => {
  const deps = { attestBranch: vi.fn(), neon: vi.fn() }
  expect(() => provisionCiStorage({ ...valid, ...override }, deps)).toThrow('CI scope required')
  expect(deps.attestBranch).not.toHaveBeenCalled()
  expect(deps.neon).not.toHaveBeenCalled()
})
it('never deploys after failed endpoint attestation', () => {
  const neon = vi.fn()
  expect(() => provisionCiStorage(valid, { attestBranch: () => { throw new Error('mismatched endpoint') }, neon })).toThrow('mismatched endpoint')
  expect(neon).not.toHaveBeenCalled()
})
it('propagates provider failure without retrying Auth or broadening privileges', () => {
  const neon = vi.fn(() => { throw new Error('HTTP 412') })
  expect(() => provisionCiStorage(valid, { attestBranch: vi.fn(), neon })).toThrow('HTTP 412')
  expect(neon).toHaveBeenCalledTimes(1)
})
