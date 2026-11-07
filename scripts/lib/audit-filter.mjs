export function auditFindings(report, allowlist = [], now = new Date()) {
  const issues = []
  for (const entry of allowlist) {
    if (!entry.id || !entry.reason || !entry.expires || !Number.isFinite(Date.parse(entry.expires)) || Date.parse(entry.expires) <= now.getTime()) issues.push('Invalid or expired audit exception')
  }
  for (const [name, item] of Object.entries(report.vulnerabilities || {})) {
    if (!['high', 'critical'].includes(item.severity)) continue
    const advisories = item.via.filter(v => typeof v === 'object')
    // Transitive string-only entries are still rejected, never implicitly waived.
    if (!advisories.length || advisories.some(v => !allowlist.some(e => e.id === String(v.source) && e.package === name && Date.parse(e.expires) > now.getTime() && e.reason))) issues.push(`Unaccepted ${item.severity} runtime advisory in ${name}`)
  }
  return issues
}
