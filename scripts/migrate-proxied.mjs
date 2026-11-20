// Runs Drizzle migrations against Neon, tunneling the driver WebSocket through an HTTP proxy
// when one is configured (corporate networks). Falls back to a direct connection otherwise.
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { Pool, neonConfig } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
import { migrate } from 'drizzle-orm/neon-serverless/migrator'

const envFile = process.env.ENV_FILE ?? '.env'
try {
  Object.assign(process.env, parseEnv(readFileSync(envFile, 'utf8')))
}
catch {
  // No env file: rely on the shell environment.
}

const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy
if (proxy) {
  const { default: WebSocket } = await import('ws')
  const { HttpsProxyAgent } = await import('https-proxy-agent')
  const agent = new HttpsProxyAgent(proxy)
  neonConfig.webSocketConstructor = class extends WebSocket {
    constructor(address, protocols) {
      super(address, protocols, { agent })
    }
  }
}

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL(_UNPOOLED) is not set')

const pool = new Pool({ connectionString: url })
const db = drizzle(pool)
await migrate(db, { migrationsFolder: './drizzle' })
await pool.end()
console.log('Migrations applied.')
