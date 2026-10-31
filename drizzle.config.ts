import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { defineConfig } from 'drizzle-kit'

const envFile = process.env.ENV_FILE ?? '.env'
// Override semantics: the file wins over variables already exported in the shell.
if (existsSync(envFile)) Object.assign(process.env, parseEnv(readFileSync(envFile, 'utf8')))

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
