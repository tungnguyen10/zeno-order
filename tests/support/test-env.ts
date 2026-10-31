import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

/** Loads an env file, overriding variables already set in the shell. */
export function loadEnvFileOverride(file: string): void {
  if (existsSync(file)) Object.assign(process.env, parseEnv(readFileSync(file, 'utf8')))
}

export function assertTestDatabase(env: NodeJS.ProcessEnv = process.env): void {
  if (env.ZENO_TEST_DB !== '1') {
    throw new Error('Refusing to touch the database: ZENO_TEST_DB=1 is required (load .env.test)')
  }
  if (!env.NEON_BRANCH) {
    throw new Error('Refusing to touch the database: NEON_BRANCH must name the test branch')
  }
  if (env.NEON_BRANCH === 'production') {
    throw new Error('Refusing to touch the database: NEON_BRANCH is production')
  }
}
