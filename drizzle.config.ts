import { existsSync } from 'node:fs'
import { defineConfig } from 'drizzle-kit'

const envFile = process.env.ENV_FILE ?? '.env'
if (existsSync(envFile)) process.loadEnvFile(envFile)

const url = process.env.DATABASE_URL_UNPOOLED
if (!url) throw new Error(`DATABASE_URL_UNPOOLED missing (env file: ${envFile})`)

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url },
  schemaFilter: ['public'],
  strict: true,
  verbose: true,
})
