// Paths whose last segment is a credential (guest token, webhook endpoint key).
const CREDENTIAL_PATHS = /^(\/(?:api\/public\/orders|o|api\/webhooks\/sepay)\/)[^/?#]+/

export function safePath(rawPath: string): string {
  return rawPath.split('?')[0]!.replace(CREDENTIAL_PATHS, '$1[REDACTED]')
}
