import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { auditFindings } from './lib/audit-filter.mjs'

try {
  const result = spawnSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', maxBuffer: 10_000_000, timeout: 120_000 })
  if (result.error || ![0, 1].includes(result.status)) throw new Error('Audit unavailable')
  const report = JSON.parse(result.stdout)
  if (report.error || !report.metadata || !report.vulnerabilities) throw new Error('Invalid audit response')
  const findings = auditFindings(report, JSON.parse(readFileSync('docs/runtime-audit-allowlist.json', 'utf8')))
  for (const finding of findings) console.error(finding)
  if (findings.length) process.exitCode = 1
  else console.log('No unaccepted high/critical runtime advisories')
}
catch { console.error('Runtime audit could not be completed'); process.exitCode = 1 }
