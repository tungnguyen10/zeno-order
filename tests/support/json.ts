export const FORBIDDEN_PUBLIC_KEYS = [
  'orgId', 'storeId', 'org_id', 'store_id', 'active', 'imageKey', 'image_key',
  'tokenHash', 'token_hash', 'customerPhone', 'address', 'secret', 'hmacSecret', 'apiToken',
] as const

function collectKeys(value: unknown, into: Set<string>): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into)
  }
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      into.add(key)
      collectKeys(child, into)
    }
  }
  return into
}

/** Keys that must never appear anywhere in a public response. */
export function findForbiddenKeys(value: unknown): string[] {
  const keys = collectKeys(value, new Set<string>())
  return FORBIDDEN_PUBLIC_KEYS.filter(key => keys.has(key))
}
