import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { neon } from './lib/branch-attestation.mjs'

try {
  const branch = process.env.CI_BRANCH
  const services = process.argv.slice(2)
  if (process.env.GITHUB_ACTIONS !== 'true' || !branch || !/^ci-\d+-[a-z0-9-]+$/.test(branch) || !process.env.GITHUB_ENV || !services.length || services.some(s => !['postgres', 'auth', 'object-storage'].includes(s))) throw new Error('CI scope required')
  const dir = mkdtempSync(join(tmpdir(), 'zeno-ci-env-'))
  try {
    const file = join(dir, 'branch.env')
    neon(['env', 'pull', '--branch', branch, '--file', file, ...services.flatMap(s => ['--service', s])], false)
    const env = parseEnv(readFileSync(file, 'utf8'))
    if (env.NEON_BRANCH !== branch) throw new Error('Exported branch mismatch')
    const mask = value => { for (const line of value.split(/\r?\n/)) if (line.trim()) console.log(`::add-mask::${line}`) }
    let out = ''
    for (const [key, value] of Object.entries(env)) {
      if (key !== 'NEON_BRANCH') {
        mask(value)
        if (/^postgres(?:ql)?:\/\//i.test(value)) {
          const password = new URL(value).password
          if (password) { mask(password); mask(decodeURIComponent(password)) }
        }
      }
      const delimiter = `ZENO_EOF_${randomUUID()}`
      out += `${key}<<${delimiter}\n${value}\n${delimiter}\n`
    }
    appendFileSync(process.env.GITHUB_ENV, out)
  }
  finally { rmSync(dir, { recursive: true, force: true }) }
}
catch { console.error('CI environment export failed; explicit branch/services or provider provisioning require attention'); process.exitCode = 1 }
