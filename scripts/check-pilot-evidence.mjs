import { readFileSync } from 'node:fs'
const checks = ['physicalDevices', 'receiverVerified', 'sepayAuthAndApi', 'duplicateAndLatePayments', 'amountAndCancellationReview', 'neonSchedules', 'alertReceived', 'backupAuthStorageKeys', 'pilotReconciliation']
try {
  const record = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  if (!record.operator || !record.rollbackContact || record.decision !== 'GO' || !Number.isFinite(Date.parse(record.reviewedAt))) throw new Error('Sign-off missing')
  for (const key of checks) if (record.checks?.[key]?.passed !== true || typeof record.checks[key].evidenceRef !== 'string' || !record.checks[key].evidenceRef.trim()) throw new Error('Evidence missing')
  console.log('Pilot record complete; human verification of bank/operational evidence remains required')
}
catch { console.error(`Pilot evidence incomplete. Require operator, rollbackContact, reviewedAt, decision=GO and passed/evidenceRef for: ${checks.join(', ')}`); process.exitCode = 1 }
