import { z } from 'zod'

export function assertSeedEnvironment(env: Record<string, string | undefined>): string {
  if (env.ZENO_SEED_CATALOG !== '1' || !['test', 'development'].includes(env.NEON_BRANCH ?? '')) {
    throw new Error('Catalog seed requires ZENO_SEED_CATALOG=1 and NEON_BRANCH=test or development')
  }

  const id = z.uuid().safeParse(env.SEED_STORE_ID)
  if (!id.success) throw new Error('SEED_STORE_ID must identify an existing development/test store')
  return id.data
}
