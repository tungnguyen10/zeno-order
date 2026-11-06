import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createWriteStream, mkdirSync } from 'node:fs'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { createSharedAuthKeys, type SharedAuthKeys } from './shared-auth'
import { assertTestDatabase, loadEnvFileOverride } from './test-env'

export interface ProductionContext { baseUrl: string, logFile: string, keys: SharedAuthKeys, opsSecret: string, appEncryptionKey: string }

export async function startProductionServer() {
  loadEnvFileOverride('.env.test')
  assertTestDatabase()
  const keys = await createSharedAuthKeys()
  mkdirSync('test-results', { recursive: true })
  const context: ProductionContext = {
    baseUrl: 'http://127.0.0.1:3200', logFile: 'test-results/hardening-server.log', keys,
    opsSecret: process.env.OPS_STATUS_SECRET || randomBytes(32).toString('hex'),
    appEncryptionKey: process.env.APP_ENCRYPTION_KEY || randomBytes(32).toString('base64'),
  }
  process.env.APP_ENCRYPTION_KEY = context.appEncryptionKey
  const output = createWriteStream(context.logFile)
  const child = spawn(process.execPath, ['.output/server/index.mjs'], {
    env: { ...process.env, NODE_ENV: 'production', NITRO_HOST: '127.0.0.1', NITRO_PORT: '3200',
      AUTH_TEST_JWKS: keys.jwksJson, OPS_STATUS_SECRET: context.opsSecret, VERCEL: '', VERCEL_ENV: '', TRUST_FORWARDED_FOR: '',
      PAYMENT_JOBS_ENABLED: 'true', APP_ENCRYPTION_KEY: context.appEncryptionKey },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.pipe(output); child.stderr.pipe(output)
  let spawnFailed = false
  child.once('error', () => { spawnFailed = true })
  async function stop() {
    if (child.exitCode === null && !spawnFailed) {
      const closed = once(child, 'close')
      child.kill('SIGTERM')
      const kill = setTimeout(() => child.kill('SIGKILL'), 5000)
      await closed; clearTimeout(kill)
    }
    output.end()
    await once(output, 'finish')
  }
  try {
    for (let i = 0; i < 120; i++) {
      if (spawnFailed || child.exitCode !== null) throw new Error('Production test server exited; inspect sanitized artifact')
      try {
        // The route is public; DB readiness is required, not just an open port.
        const res = await fetch(`${context.baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) })
        if (res.status === 200) return { context, stop }
      }
      catch { /* Startup/compute wake-up. */ }
      await delay(250)
    }
    throw new Error('Production test server did not become healthy')
  }
  catch (error) { await stop(); throw error }
}
