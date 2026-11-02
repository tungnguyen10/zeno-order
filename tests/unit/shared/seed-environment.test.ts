import { describe, expect, it } from 'vitest'
import { assertSeedEnvironment } from '#shared/seed-environment'

const storeId = '11111111-1111-4111-8111-111111111111'
const allowed = { ZENO_SEED_CATALOG: '1', NEON_BRANCH: 'test', SEED_STORE_ID: storeId }

describe('seed environment', () => {
  it('requires an explicit development/test branch and store', () => {
    expect(assertSeedEnvironment(allowed)).toBe(storeId)
    expect(assertSeedEnvironment({ ...allowed, NEON_BRANCH: 'development' })).toBe(storeId)
    for (const patch of [
      { ZENO_SEED_CATALOG: undefined },
      { NEON_BRANCH: 'production' },
      { NEON_BRANCH: undefined },
      { SEED_STORE_ID: undefined },
      { SEED_STORE_ID: 'bad' },
    ]) {
      expect(() => assertSeedEnvironment({ ...allowed, ...patch })).toThrow()
    }
  })
})
