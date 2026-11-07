import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { Client } from '@neondatabase/serverless'
import { attestBranch, neon } from './lib/branch-attestation.mjs'
import { assertCiAuthScope, selectCiAuthEnv } from './lib/ci-auth-scope.mjs'

async function runUsers(source, prefix) {
  const client = new Client(source.DATABASE_URL_UNPOOLED || source.DATABASE_URL)
  try {
    await client.connect()
    await client.query('begin read only')
    const { rows } = await client.query('select id from neon_auth."user" where email like $1 limit 1001', [`${prefix}%@example.com`])
    await client.query('commit')
    if (rows.length > 1000 || rows.some(row => typeof row.id !== 'string' || !/^[\w-]{1,128}$/.test(row.id))) throw new Error('Unexpected CI Auth namespace')
    return rows.map(row => row.id)
  }
  finally { await client.end() }
}

try {
  const mode = process.argv[2]
  const scope = assertCiAuthScope(process.env)
  if (!['bind', 'cleanup'].includes(mode)) throw new Error('Explicit CI Auth mode required')
  // This source is never production. Its configuration is only read, never relaxed by CI.
  const source = attestBranch(scope.branch)
  if (mode === 'cleanup') {
    const ids = await runUsers(source, scope.prefix)
    for (const id of ids) neon(['neon-auth', 'user', 'delete', id, '--branch', scope.branch], false)
    console.log(`Cleaned ${ids.length} run-scoped test Auth users`)
  }
  else {
    attestBranch(process.env.CI_BRANCH, process.env.DATABASE_URL)
    const local = neon(['neon-auth', 'domain', 'allow-localhost', 'get', '--branch', scope.branch])
    const email = neon(['neon-auth', 'config', 'email-password', 'get', '--branch', scope.branch])
    const webhook = neon(['neon-auth', 'config', 'webhook', 'get', '--branch', scope.branch])
    console.log('CI_TEST_AUTH_SETTINGS ' + JSON.stringify({ allowLocalhost: local.allow_localhost, emailEnabled: email.enabled, verificationRequired: email.require_email_verification, signupDisabled: email.disable_sign_up, webhookEnabled: webhook.enabled }))
    if (local.allow_localhost !== true || email.enabled !== true || email.require_email_verification !== false || email.disable_sign_up === true || webhook.enabled !== false) throw new Error('Test Auth must already allow local noninteractive signup without external webhooks')
    await runUsers(source, scope.prefix) // Check scoped cleanup access before creating any users.
    const dir = mkdtempSync(join(tmpdir(), 'zeno-test-auth-'))
    try {
      const file = join(dir, 'auth.env')
      neon(['env', 'pull', '--branch', scope.branch, '--file', file, '--service', 'auth'], false)
      const env = selectCiAuthEnv(parseEnv(readFileSync(file, 'utf8')))
      let output = ''
      for (const [key, value] of Object.entries(env)) {
        console.log(`::add-mask::${value}`)
        const delimiter = `ZENO_EOF_${randomUUID()}`
        output += `${key}<<${delimiter}\n${value}\n${delimiter}\n`
      }
      if (!process.env.GITHUB_ENV) throw new Error('Actions environment required')
      appendFileSync(process.env.GITHUB_ENV, output)
    }
    finally { rmSync(dir, { recursive: true, force: true }) }
    console.log('Bound existing non-production test Auth; the app database and storage remain isolated per CI run')
  }
}
catch (error) {
  console.error('Run-scoped test Auth setup/cleanup failed; no production service or shared Auth configuration was changed')
  if (error instanceof Error && typeof error.cause?.diagnostic === 'string') console.error(error.cause.diagnostic)
  process.exitCode = 1
}
