import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { spawnSync } from 'node:child_process'

export function neon(args, json = true) {
  const result = spawnSync('npx', ['-y', 'neon@8.4.1', ...args, '--project-id', process.env.NEON_PROJECT_ID, ...(json ? ['--output', 'json'] : [])], { encoding: 'utf8', maxBuffer: 5_000_000, timeout: 120_000 })
  if (result.error || result.status !== 0) throw new Error('Neon operation failed; inspect provider console without printing credentials')
  return json ? JSON.parse(result.stdout) : result.stdout
}
const identity = (value) => {
  const url = new URL(value)
  return url.hostname.replace('-pooler.', '.') + url.pathname
}
/** Pull the authoritative endpoint for an explicit project/branch; an env label alone is not proof. */
export function attestBranch(branch, expectedUrl) {
  if (!process.env.NEON_PROJECT_ID || !process.env.NEON_API_KEY || !branch) throw new Error('Explicit Neon project, API credential and branch required')
  const dir = mkdtempSync(join(tmpdir(), 'zeno-attest-'))
  try {
    const file = join(dir, 'branch.env')
    neon(['env', 'pull', '--branch', branch, '--file', file, '--service', 'postgres'], false)
    const env = parseEnv(readFileSync(file, 'utf8'))
    if (env.NEON_BRANCH !== branch || !env.DATABASE_URL || (expectedUrl && identity(env.DATABASE_URL) !== identity(expectedUrl))) throw new Error('Database endpoint does not belong to requested branch')
    return env
  }
  finally { rmSync(dir, { recursive: true, force: true }) }
}
