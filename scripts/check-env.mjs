import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { validateEnv } from './lib/env-check.mjs'

const args = process.argv.slice(2)
const flag = key => args[args.indexOf(key) + 1]
try {
  if (!args.includes('--file') || !args.includes('--target')) throw new Error('Arguments required')
  const env = parseEnv(readFileSync(flag('--file'), 'utf8'))
  const other = args.includes('--compare') ? parseEnv(readFileSync(flag('--compare'), 'utf8')) : undefined
  const problems = validateEnv({ target: flag('--target'), env, other })
  for (const problem of problems) console.error(problem)
  if (problems.length) process.exitCode = 1
  else console.log('Environment checks passed; verify branch endpoint ownership separately in Neon')
}
catch { console.error('Usage: npm run check:env -- --file <dotenv> --target production|preview|test [--compare <dotenv>]'); process.exitCode = 1 }
