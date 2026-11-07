/** Log route shapes only: URL paths, query strings and user-agent can contain credentials/PII. */
export function logPath(raw: string): string {
  const path = raw.split(/[?#]/, 1)[0] ?? ''
  // Only fixed, application-owned segments may reach logs. Unknown segments are redacted.
  const fixed = new Set(['api', 'public', 'stores', 'orders', 'payment-attempts', 'webhooks', 'sepay', 'o', 'invite', 'invitations', 'app', 'orgs', 'categories', 'products', 'tables', 'delivery-zones', 'members', 'status', 'internal', 'health', 'payment-account', 'payment-accounts', 'payments', 'integrations', 'sepay-integrations', 'reconciliation', 'bank-transactions', 'resolve', 'match', 'verify', 'mark-paid', 'refund', 'regenerate', 'accept', 'me', 'onboarding', 'login', 'signup', 's', 'checkout', 'menu'])
  return path.toLowerCase().split('/').map((part, i, parts) => {
    if (!part) return ''
    // A capability must be redacted even if it happens to equal a fixed word.
    if (['o', 'invite', 'invitations', 'sepay'].includes(parts[i - 1] ?? '') || (parts[i - 1] === 'orders' && parts[2] === 'public')) return ':credential'
    return fixed.has(part) ? part : ':id'
  }).join('/')
}
