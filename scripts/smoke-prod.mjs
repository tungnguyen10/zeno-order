import { runSmoke } from './lib/smoke.mjs'
try {
  const args = process.argv.slice(2)
  const failures = await runSmoke({ baseUrl: args[0], slug: args.includes('--slug') ? args[args.indexOf('--slug') + 1] : undefined, opsSecret: process.env.OPS_STATUS_SECRET })
  for (const failure of failures) console.error(failure)
  if (failures.length) process.exitCode = 1
  else console.log('Read-only deployment smoke passed')
}
catch { console.error('Usage: npm run smoke:prod -- https://your-origin [--slug store-slug]'); process.exitCode = 1 }
